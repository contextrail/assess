import { readFileSync } from 'node:fs';

// Both src/ and dist/ resolve the prepared package manifest at the public root.
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const packageVersion: string = manifest.version;

// The exporter creates this exact tag before npm publication. Local checkouts have no public asset ref.
export const assessLogoBaseUrl: string | null =
    manifest.repository?.url === 'git+https://github.com/contextrail/assess.git' &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-alpha\.[1-9]\d*)?$/.test(packageVersion)
        ? `https://raw.githubusercontent.com/contextrail/assess/v${packageVersion}/assets/brand`
        : null;
