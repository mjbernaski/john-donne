// Out-of-order saved recordings must not be shown as queued work.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('reader.js', 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('    function generationPartState('), source.indexOf('    function renderJobs(')), context);
const work = {
    start: 0, end: 51,
    snap: { availability: Array.from({length: 51}, (_, i) => ({state: i < 27 || i >= 44 ? 'saved' : 'missing'})) },
    job: {state: 'running', total: 51, completed: 27, part: 28, stage: 'generating'},
};
assert.equal(context.generationPartState(work, 44), 'done');
assert.equal(context.generationPartState(work, 50), 'done');
assert.equal(context.generationCounts(work), 'Parts 1–51 · 34 done · 1 underway · 16 queued');
assert.match(context.generationMessage(work), /^34 of 51 requested parts saved/);
// Resuming from 28 keeps absolute part identities and counts only this range.
work.start = 27;
Object.assign(work.job, {total: 24, completed: 0, part: 1});
assert.equal(context.generationPartState(work, 17), 'done');
assert.equal(context.generationCounts(work), 'Parts 28–51 · 7 done · 1 underway · 16 queued');
work.job.state = 'failed';
assert.equal(context.generationCounts(work), 'Parts 28–51 · 7 done · 1 failed · 16 not started');
work.error = 'Reconnecting';
assert.equal(context.generationPartState(work, 17), 'done');
assert.equal(context.generationPartState(work, 0), 'unknown');
console.log('PASS: saved tail parts, resumed ranges, failures, and reconnects.');

// Filtered submissions retain original part numbers across saved gaps.
work.indices = [27, 29, 31];
work.error = '';
Object.assign(work.job, {state: 'running', total: 3, completed: 1, part: 2});
assert.equal(context.generationPartState(work, 0), 'done');
assert.equal(context.generationPartState(work, 1), 'generating');
assert.equal(context.generationPartState(work, 2), 'queued');
assert.match(context.generationMessage(work), /Part 30/);
work.job.state = 'failed';
assert.match(context.generationMessage(work), /^Part 30/);

// Overall scene progress is weighted by spoken text, not by cue count.
const outputs = {};
context.$ = id => outputs[id] ||= {};
context.playback = { performance: true, index: 1, requests: [{text: 'x'.repeat(100)}, {text: 'x'.repeat(300)}] };
context.selected = context.playback;
vm.runInContext(source.slice(source.indexOf('    function scenePlaybackPercent('), source.indexOf('    function rewindPlayback(')), context);
assert.equal(context.updatePlaybackProgress(0), '25% complete · scene');
assert.equal(context.updatePlaybackProgress(50), '62% complete · scene');
assert.equal(context.updatePlaybackProgress(100), '100% complete · scene');
assert.equal(context.updatePlaybackProgress(50, context.selected.requests[0]), '12% complete · scene');
assert.equal(outputs.readerAlwaysProgress.textContent, outputs.readerPlaybackPercent.textContent);
assert.equal(context.updatePlaybackProgress(null), 'Loading progress…');
console.log('PASS: saved and streaming progress covers the whole scene with text-weighted cues.');

context.playback.requests[1].speaker = 'FAUST';
context.updatePlaybackProgress(50);
assert.equal(outputs.readerCurrentCue.textContent, 'Cue 2 of 2 · FAUST');
context.updatePlaybackProgress(50, context.selected.requests[0]);
assert.equal(outputs.readerCurrentCue.textContent, 'Cue 1 of 2');
console.log('PASS: visible playing cue follows both saved and streamed playback.');

// Timing covers the whole scene, calibrates from recordings, and respects speed.
const timed = {requests: [{text: Array(150).fill('word').join(' ')}, {text: Array(300).fill('word').join(' ')}]};
assert.equal(context.playbackTimeEstimate(timed, 0, 50), '~0:30 elapsed · ~2:30 remaining');
assert.equal(context.playbackTimeEstimate(timed, 0, 50, {elapsed: 60, duration: 120, rate: 2}), '~0:30 elapsed · ~2:30 remaining');
assert.equal(context.playbackTimeEstimate(timed, 1, 50, {elapsed: 90, duration: 180, rate: 1}), '3:30 elapsed · 1:30 remaining');
assert.equal(context.playbackTimeEstimate(timed, 1, 100, {elapsed: 180, duration: 180, rate: 1}), '5:00 elapsed · 0:00 remaining');
assert.equal(context.playbackTimeEstimate(timed, 1, null), '');
console.log('PASS: elapsed/remaining estimation, measured durations, playback speed, and finish.');
