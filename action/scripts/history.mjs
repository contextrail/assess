import process from 'node:process';
import { loadAssessModule } from './common.mjs';
const presentation = await loadAssessModule('presentation');
const github = await loadAssessModule('github');
export const { readHistory, withHistory, runRecord, assessmentMarker } = presentation;
export const findAssessmentComment = (c) =>
    github.findAssessmentComment(c, github.githubRequester(c.repository, process.env.GH_READ_TOKEN));
