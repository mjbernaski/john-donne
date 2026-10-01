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
