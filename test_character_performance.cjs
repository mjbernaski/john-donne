const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const book = JSON.parse(fs.readFileSync('books.json')).books.find(b => b.id === 'doctor-faustus');
const poem = JSON.parse(fs.readFileSync(book.poems))[0];
const app = fs.readFileSync('app.js', 'utf8');
const reader = fs.readFileSync('reader.js', 'utf8');
const context = { window: {}, currentBook: book, currentPoem: poem, performanceMode: true,
    snapshots: new Map(), read: (_, fallback) => fallback, entryKey: () => 'faustus:full',
    stableHash: value => require('node:crypto').createHash('sha256').update(value).digest('hex').slice(0, 8) };
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf('function splitNarrationText('), app.indexOf('function getNarrationParts(')), context);
vm.runInContext(fs.readFileSync('character-performance.js', 'utf8'), context);
context.CharacterPerformance = context.window.CharacterPerformance;
vm.runInContext(reader.slice(reader.indexOf('    function snapshot('), reader.indexOf('    async function refreshAvailability(')), context);
const { castFor, requestsFor, voices } = context.CharacterPerformance;
const cast = castFor(book);
assert.equal(cast.MINOR, cast.NARRATOR, 'Minor roles share the neutral narrator');
const majorVoices = Object.entries(cast).filter(([role]) => !['MINOR', 'NARRATOR'].includes(role)).map(([, voice]) => voice);
assert.equal(new Set(majorVoices).size, majorVoices.length, 'Each main character has a distinct default voice');
assert(Object.values(cast).every(v => voices[v]));
const requests = requestsFor(poem, book, cast);
assert(requests.length >= poem.performance.length);
assert(requests.every(r => r.model === 'eleven_flash_v2_5' && r.provider === 'elevenlabs' && !r.speakTitle));
assert(requests.every(r => r.text.length > 0 && r.text.length <= 4500));
for (const speaker of new Set(poem.performance.map(t => t.speaker))) {
    assert(requests.filter(r => r.speaker === speaker).every(r => r.voice === (cast[speaker] || cast.MINOR)), speaker);
}
assert.equal(requests.map(r => r.text).join('').replace(/\s/g, ''), poem.performance.map(t => t.text).join('').replace(/\s/g, ''), 'No spoken text omitted, reordered, or duplicated');
const changed = castFor(book, { FAUSTUS: 'lily', MINOR: 'daniel', WAGNER: 'unsupported' });
assert.equal(changed.WAGNER, cast.WAGNER);
assert(requestsFor(poem, book, changed).filter(r => r.speaker === 'FAUSTUS').every(r => r.voice === 'lily'));
assert(requestsFor(poem, book, changed).filter(r => r.speaker === 'VALDES').every(r => r.voice === 'daniel'));
const snap = context.snapshot();
assert.equal(snap.performance, true);
assert.equal(snap.model, 'eleven_flash_v2_5');
assert.equal(snap.requests.length, requests.length);
assert.equal(snap.browserKeys.length, requests.length);
assert.equal(new Set(snap.browserKeys).size, requests.length);
assert.equal(context.snapshot(), snap, 'Unchanged cast reuses the snapshot');
context.read = () => ({ FAUSTUS: 'lily' });
assert.notEqual(context.snapshot().id, snap.id, 'Changing the cast invalidates playback snapshot');
console.log(`PASS: Doctor Faustus import, ${requests.length} ordered cues, distinct main cast, shared minor voice, custom cast, and cache identities.`);

const compactSource = poem.content.replace(/\s/g, '');
let lastEnd = 0;
for (const request of requests) {
    assert(request.performanceTextRanges.length, request.title);
    let spoken = '';
    for (const range of request.performanceTextRanges) {
        assert(range.start >= lastEnd, 'Repeated dialogue and directions follow source order');
        spoken += compactSource.slice(range.start, range.start + range.length);
        lastEnd = range.start + range.length;
    }
    assert.equal(spoken, request.text.replace(/\s/g, ''), request.title);
}
assert(requests.at(-1).performanceTextRanges[0].start > compactSource.length * .99, 'Cue 540 follows the final Exit, not the opening Exit');
console.log('PASS: all 540 cues track their exact source occurrence through the ending.');

const goethe = JSON.parse(fs.readFileSync('books.json')).books.find(b => b.id === 'goethe-faust');
const scenes = JSON.parse(fs.readFileSync(goethe.poems));
let cueCount = 0;
for (const scene of scenes) {
    const cues = requestsFor(scene, goethe, castFor(goethe));
    assert(cues.length, scene.title);
    const source = scene.content.replace(/\s/g, '');
    let cursor = 0;
    for (const cue of cues) {
        assert(cue.voice && voices[cue.voice], cue.title);
        assert(cue.text.length > 0 && cue.text.length <= 4500, cue.title);
        assert(!cue.filename.includes('Doctor Faustus'), cue.filename);
        assert(cue.filename.includes(scene.title), cue.filename);
        let spoken = '';
        for (const range of cue.performanceTextRanges) {
            assert(range.start >= cursor, cue.title);
            spoken += source.slice(range.start, range.start + range.length);
            cursor = range.start + range.length;
        }
        assert.equal(spoken, cue.text.replace(/\s/g, ''), cue.title);
    }
    assert.equal(cues.map(c => c.text).join('').replace(/\s/g, ''), scene.performance.map(c => c.text).join('').replace(/\s/g, ''));
    cueCount += cues.length;
}
console.log(`PASS: Goethe Faust, all ${scenes.length} sections and ${cueCount} cues have voices and exact ordered text tracking.`);

// The normal Listen control must keep the selected cue and character cast.
const controls = {};
let listened = 0, resets = 0;
const listenContext = {
    $: id => controls[id] ||= {}, currentBook: goethe, currentPoem: scenes[3],
    performanceMode: true, syncAudio: () => {}, choosePart: () => resets++,
    listenCurrent: () => listened++
};
vm.createContext(listenContext);
vm.runInContext(reader.slice(reader.indexOf("        $('readerListen').onclick ="), reader.indexOf("        $('readerRewindStream').onclick")), listenContext);
controls.readerListen.onclick();
assert.equal(listenContext.performanceMode, true);
assert.equal(resets, 0, 'Listen keeps the current performance cue');
listenContext.performanceMode = false;
controls.readerListen.onclick();
assert.equal(listenContext.performanceMode, true, 'Listen activates the cast for supported plays');
assert.equal(resets, 1, 'Switching from single voice starts at the first cue');
listenContext.currentBook = {};
controls.readerListen.onclick();
assert.equal(listenContext.performanceMode, false, 'Books without a cast keep normal narration');
assert.equal(listened, 3);
console.log('PASS: Listen preserves character voices and cue selection for supported plays.');

for (const index of [1, 2, 3]) {
    const scene = scenes[index];
    const requests = requestsFor(scene, goethe, castFor(goethe));
    const characters = [...new Set(scene.performance.map(t => t.speaker))].filter(r => r !== 'NARRATOR');
    assert(characters.every(role => goethe.performanceCast[role]), `${scene.title}: all opening speakers need an explicit cast`);
    assert(new Set(requests.filter(r => r.speaker !== 'NARRATOR').map(r => r.voice)).size >= 3,
        `${scene.title}: opening dialogue must not collapse to the minor voice`);
}
const preludeVoices = ['MANAGER', 'POET', 'MERRY-ANDREW'].map(role => goethe.performanceCast[role]);
assert.equal(new Set(preludeVoices).size, 3, 'All three theatre characters have different voices');
assert(!preludeVoices.includes(goethe.performanceCast.NARRATOR));
console.log('PASS: Theatre prelude, heavenly prologue, and Night route their speakers to distinct cast voices.');
