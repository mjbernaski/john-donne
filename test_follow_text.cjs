const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('reader.js', 'utf8');
const context = {
    playback: null, currentBook: { id: 'book' }, currentPoem: { id: 'chapter' },
    poemAudioPart: { value: '4' }, getPoemId: poem => poem.id,
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('    function readingFollowPart()'), source.indexOf("    document.addEventListener('DOMContentLoaded'")), context);
assert.equal(context.readingFollowPart(), 4);
context.playback = { book: { id: 'book' }, poem: { id: 'chapter' }, external: true, index: 0, requests: [{}] };
assert.equal(context.matchesPlaying(), true, 'Saved recordings match by chapter identity');
assert.equal(context.readingFollowPart(), null, 'Complete recording follows every text part');
context.playback.requests.push({});
context.playback.index = 1;
assert.equal(context.readingFollowPart(), 1, 'Recording lists follow the playing part');
context.playback.external = false;
assert.equal(context.readingFollowPart(), 1, 'Browsing part settings do not move the playback cue');
context.currentPoem = { id: 'other' };
assert.equal(context.matchesPlaying(), false);
context.currentPoem = { id: 'chapter' };
context.currentBook.id = 'other-book';
assert.equal(context.matchesPlaying(), false);
console.log('PASS: follow text for complete recordings, recording lists, and chapter navigation.');

const appSource = fs.readFileSync('app.js', 'utf8');
vm.runInContext(appSource.slice(appSource.indexOf('function readingFollowProgress('), appSource.indexOf('function updateReadingPosition(')), context);
assert.equal(context.readingFollowProgress(0, 100), 0);
assert.equal(context.readingFollowProgress(1, 100), 0);
assert.equal(context.readingFollowProgress(0, 0), 0);
assert(context.readingFollowProgress(50, 100) < 0.5, 'Cue stays behind in the middle');
assert.equal(context.readingFollowProgress(99.5, 100), 1, 'Final text is reached before playback ends');
for (const duration of [1, 10, 100, 600]) {
    let previous = 0;
    for (let step = 0; step <= 1000; step++) {
        const progress = context.readingFollowProgress(duration * step / 1000, duration);
        assert(progress >= previous && progress <= 1, 'Cue moves forward smoothly within each part');
        previous = progress;
    }
    assert.equal(previous, 1, 'Every part reaches its final text');
}
assert.equal(context.readingFollowProgress(100, 100, true), 1, 'Finished recording reaches the final text');
assert.equal(context.readingFollowProgress(0, 100), 0, 'A new part resets the cue');
console.log('PASS: follow-text pacing, complete part endings, and part reset.');

context.modalContentElement = { dataset: { modalTab: 'visualize' } };
vm.runInContext(appSource.slice(appSource.indexOf('function updateReadingPosition()'), appSource.indexOf('function toggleFollowReading()')), context);
assert.doesNotThrow(() => context.updateReadingPosition(), 'Images never run text tracking or touch the shared scroll panel');
console.log('PASS: image browsing is independent of follow-text scrolling.');
const transitions = [];
const transitionContext = {
    playback: { index: 0, requests: [{}, {}] },
    updateReadingPosition: () => transitions.push('final-row'),
    $: () => ({}),
    stepPlayback: () => transitions.push('next-part'),
    updateDock: () => transitions.push('finished'), persistPlayback: () => {},
};
vm.createContext(transitionContext);
vm.runInContext(source.slice(source.indexOf('    function ended()'), source.indexOf('    function closePlayer()')), transitionContext);
transitionContext.ended();
assert.deepEqual(transitions, ['final-row', 'next-part'], 'Flush the outgoing ending and advance without an artificial pause');
transitionContext.playback.index = 1;
transitionContext.ended();
assert.deepEqual(transitions, ['final-row', 'next-part', 'final-row', 'finished'], 'Final part finishes without advancing');
console.log('PASS: outgoing final row and immediate part transition.');

const markerProperties = {};
context.markerLine = {
    getBoundingClientRect: () => ({ top: 120 }),
    style: { setProperty: (name, value) => { markerProperties[name] = value; } },
};
context.positionReadingMarker(context.markerLine, { top: 196, height: 27 });
assert.equal(markerProperties['--reading-row-offset'], '76px');
assert.equal(markerProperties['--reading-row-height'], '27px', 'Marker uses the actual glyph-row height');
context.positionReadingMarker(context.markerLine, { top: 158, height: 34 });
assert.equal(markerProperties['--reading-row-offset'], '38px');
assert.equal(markerProperties['--reading-row-height'], '34px', 'Marker adjusts to a changed text size or wrap');
console.log('PASS: reading marker aligns with measured text-row geometry.');

const requestContext = { playback: { index: 1, requests: [{ text: 'First' }, { text: 'Second' }] }, matchesPlaying: () => true };
vm.createContext(requestContext);
vm.runInContext(source.slice(source.indexOf('    function performanceFollowRequest()'), source.indexOf('    function readingFollowPart()')), requestContext);
assert.equal(requestContext.performanceFollowRequest().text, 'Second', 'Ordinary saved audio follows its spoken text after a part transition');
requestContext.playback.requests[1] = {};
assert.equal(requestContext.performanceFollowRequest(), null, 'External recordings retain the part-based fallback');
console.log('PASS: spoken-text alignment for ordinary saved narration parts.');
