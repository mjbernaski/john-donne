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
