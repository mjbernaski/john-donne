const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('app.js', 'utf8');
async function check(saved, cancel = false, fail = false) {
    let played = 0, restored = 0, status = '';
    const session = { audioByVoice: new Map() }, poem = {};
    const playback = { poem, session, voice: 'feminine', provider: 'gemini', parts: ['a', 'b'], index: 1, startIndex: 0 };
    const c = {
        wholeChapterPlayback: playback, currentPoem: poem, currentChatSession: session,
        poemAudioPart: {}, poemAudioPlayer: { play() { played++; return Promise.resolve(); } },
        ttsAudioSlot: () => 'part2', renderPoemAudio() {},
        setPoemAudioStatus(message) { status = message; },
        async restorePoemAudio() {
            restored++;
            if (fail) throw new Error('offline');
            if (saved) session.audioByVoice.set('part2', '/saved.wav');
            if (cancel) c.wholeChapterPlayback = null;
        }
    };
    vm.createContext(c);
    vm.runInContext(code.slice(code.indexOf('async function playWholeChapterPart()'), code.indexOf('function advanceWholeChapterPlayback()')), c);
    await c.playWholeChapterPart();
    assert.equal(restored, 1);
    assert.equal(played, saved && !cancel && !fail ? 1 : 0);
    if (!saved && !fail) assert.match(status, /not saved for this voice and model/);
    if (fail) assert.match(status, /Could not load saved audio/);
}
(async () => {
    await check(true);
    await check(false);
    await check(true, true);
    await check(false, false, true);
    console.log('Saved chapter playback tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
