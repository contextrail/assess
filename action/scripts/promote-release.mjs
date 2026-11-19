import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import console from 'node:console';

const repository = 'contextrail/assess';
const packageName = '@contextrail/assess';
const shaPattern = /^[a-f0-9]{40}$/;

export function releaseChannel(release) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-alpha\.([1-9]\d*))?$/.exec(release.version);
    if (
        !match ||
        !shaPattern.test(release.sourceSha) ||
        release.branch !== (match[4] ? 'alpha' : 'main') ||
        release.channel !== (match[4] ? 'alpha' : 'latest')
    )
        throw new Error('Invalid release identity');
    return {
        tag: `v${match[1]}${match[4] ? '-alpha' : ''}`,
        order: match.slice(1).map((value) => BigInt(value || '0')),
    };
}

export async function promoteRelease({
    release,
    sha,
    ref,
    repo,
    token,
    fetcher = globalThis.fetch,
    pause = setTimeout,
}) {
    const selected = releaseChannel(release);
    assertPromotionRequest(release, { sha, ref, repo, token });
    const api = githubApi(token, fetcher);
    // The immutable version tag must still identify the commit checked by the publisher.
    const exact = await api(`commits/${encodeURIComponent(ref)}`);
    if (exact?.sha !== sha) throw new Error('Release tag moved');
    const current = await api(`git/ref/tags/${selected.tag}`);
    if (current) {
        const settled = await settledByCurrentChannel(api, current, selected, sha);
        if (settled) return settled;
    }
    if (!(await registryServes(release.version, fetcher, pause)))
        throw new Error('Package still unavailable; release channel unchanged. Retry the promotion job later.');
    const result = current
        ? await api(`git/refs/tags/${selected.tag}`, 'PATCH', { sha, force: true })
        : await api('git/refs', 'POST', { ref: `refs/tags/${selected.tag}`, sha });
    if (result?.object?.sha !== sha) throw new Error('Release channel update was not confirmed');
    return { status: 'promoted', tag: selected.tag, sha };
}

/** Only the public repository's exact version tag, at a full commit, with a token may promote. */
function assertPromotionRequest(release, { sha, ref, repo, token }) {
    if (repo !== repository || !shaPattern.test(sha) || ref !== `v${release.version}` || !token)
        throw new Error('Promotion requires the exact public release tag and commit');
}

/** GitHub REST calls for the release repository; a missing resource on GET reads as null. */
function githubApi(token, fetcher) {
    return async (path, method = 'GET', body) => {
        const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
            method,
            redirect: 'error',
            signal: globalThis.AbortSignal.timeout(30000),
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (response.status === 404 && method === 'GET') return null;
        if (!response.ok) throw new Error(`Release API failed: ${method} ${path} (${response.status})`);
        return response.json();
    };
}

/**
 * The channel's current release decides the outcome when it is this version (unchanged) or a
 * newer one (skipped); otherwise promotion continues.
 */
async function settledByCurrentChannel(api, current, selected, sha) {
    if (current.object?.type !== 'commit' || !shaPattern.test(current.object.sha))
        throw new Error('Expected a lightweight release channel tag');
    const file = await api(`contents/release.json?ref=${current.object.sha}`);
    if (file?.encoding !== 'base64') throw new Error('Current channel release is unavailable');
    const previous = releaseChannel(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
    if (previous.tag !== selected.tag) throw new Error('Current channel identity mismatch');
    const differing = previous.order.findIndex((value, index) => value !== selected.order[index]);
    if (differing < 0) {
        if (current.object.sha !== sha) throw new Error('Same release version has different commits');
        return { status: 'unchanged', tag: selected.tag, sha };
    }
    if (previous.order[differing] > selected.order[differing])
        return { status: 'skipped_older', tag: selected.tag, sha: current.object.sha };
    return null;
}

/** npm validation can outlast `npm publish`; neither metadata nor a queued upload is enough. */
async function registryServes(version, fetcher, pause) {
    for (let attempt = 0; attempt < 20; attempt++) {
        if (await tarballAvailable(version, fetcher)) return true;
        if (attempt < 19) await pause(15000);
    }
    return false;
}

/** The registry lists exactly this package version and serves its tarball; a 404 means not yet. */
async function tarballAvailable(version, fetcher) {
    const response = await fetcher(`https://registry.npmjs.org/@contextrail%2fassess/${version}`, {
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(30000),
    });
    if (!response.ok) {
        if (response.status !== 404) throw new Error(`Registry unavailable (${response.status})`);
        return false;
    }
    const pkg = await response.json();
    if (
        pkg.name !== packageName ||
        pkg.version !== version ||
        pkg.dist?.tarball !== `https://registry.npmjs.org/@contextrail/assess/-/assess-${version}.tgz` ||
        typeof pkg.dist.integrity !== 'string'
    )
        throw new Error('Registry package identity mismatch');
    const tarball = await fetcher(pkg.dist.tarball, {
        method: 'HEAD',
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(30000),
    });
    if (!tarball.ok && tarball.status !== 404) throw new Error(`Registry tarball unavailable (${tarball.status})`);
    return tarball.ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = await promoteRelease({
        release: JSON.parse(readFileSync('release.json', 'utf8')),
        sha: process.env.GITHUB_SHA,
        ref: process.env.GITHUB_REF_NAME,
        repo: process.env.GITHUB_REPOSITORY,
        token: process.env.GH_TOKEN,
    });
    const message = `Assess channel ${result.tag}: ${result.status} (${result.sha})`;
    console.log(message);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}
