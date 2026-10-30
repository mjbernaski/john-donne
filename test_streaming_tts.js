const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const requests = [], starts = [], timers = [], offsets = [];
let closed = false;
let audioContext;
let contextsCreated = 0;
let userGesture = true;
let progressTick;
const followUpdates = [];
const sandbox = {
    navigator: { audioSession: {type: 'auto'}, mediaSession: {setActionHandler(action, handler) { this[action] = handler; }} },
    window: { addEventListener() {} }, AbortController, Uint8Array, DataView, Blob, btoa,
    updateStreamingReadingPosition(input, offset) { followUpdates.push({ input, offset }); },
    setInterval(fn) { progressTick = fn; return 1; }, clearInterval() {},
    setTimeout(fn, delay) { timers.push(() => { audioContext.currentTime += (delay || 0) / 1000; fn(); }); },
    AudioContext: class {
        constructor() { audioContext = this; contextsCreated++; }
        currentTime = 0;
        state = "running";
        async suspend() { this.state = "suspended"; }
        destination = {};
        async resume() {
            if (!userGesture && !this.unlocked) throw new Error('Safari requires a user gesture for a new context');
            this.unlocked = true; this.state = "running";
        }
        async close() { closed = true; }
        createBuffer(channels, count, rate) {
            return { duration: count / rate, getChannelData: () => new Float32Array(count) };
        }
        createBufferSource() { return { stop() {}, disconnect() {}, connect() {}, start(time, offset = 0) { starts.push(time); offsets.push(offset); } }; }
    },
    async fetch(url, options) {
        requests.push(JSON.parse(options.body));
        if (url.endsWith('/save')) return { ok: true, json: async () => ({url: '/saved.wav'}) };
        // Network packets may split a 16-bit sample across byte boundaries.
        let packets = [new Uint8Array([1]), new Uint8Array([0, 2, 0])];
        return { ok: true, body: { getReader: () => ({ async read() {
            return packets.length ? {value: packets.shift(), done: false} : {done: true};
        } }) } };
    }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('streaming-tts.js', 'utf8'), sandbox);
(async () => {
    const chapters = JSON.parse(fs.readFileSync('poems-colony-to-province.json', 'utf8'));
    for (const chapter of chapters) {
        const parts = sandbox.splitStreamingText(chapter.content);
        assert(parts.every(p => p.length > 0 && p.length <= 850));
        assert.equal(parts.join('').replace(/\s/g, ''), chapter.content.replace(/\s/g, ''));
    }
    const input = chapters.find(c => c.content.length > 5000).content.slice(0, 5000);
    const note = {};
    assert.equal(sandbox.window.LocalSpeech.state, 'idle');
    sandbox.window.LocalSpeech.prepare();
    userGesture = false;
    await sandbox.window.LocalSpeech.play(input, 'masculine', note);
    assert.equal(sandbox.window.LocalSpeech.state, 'playing');
    assert(requests.every(r => r.provider === 'elevenlabs'), 'New streams default to ElevenLabs');
    assert(requests.length > 1);
    assert.equal(requests.map(r => r.input).join('').replace(/\s/g, ''), input.replace(/\s/g, ''));
    assert(requests.every(r => r.voice === 'masculine' && r.response_format === 'pcm'));
    assert(starts.every((time, i) => !i || time > starts[i - 1]));
    assert.equal(closed, false, 'Keep queued audio alive until playback finishes');
    assert.equal(timers.length, 1);
    progressTick();
    assert.equal(followUpdates.at(-1).input, input, 'Streaming supplies the spoken text to the reading cue');
    await sandbox.window.LocalSpeech.pause();
    assert.equal(sandbox.window.LocalSpeech.state, 'paused');
    const updateCount = followUpdates.length;
    progressTick();
    assert.equal(followUpdates.length, updateCount, 'Paused streams do not move the cue');
    await sandbox.window.LocalSpeech.resume();
    timers[0]();
    assert.equal(followUpdates.at(-1).offset, input.length, 'Finished streams reach the final text');
    assert.equal(note.textContent, 'Stream finished · 100% complete');
    assert.equal(closed, false, 'Retain the unlocked context for the next part');
    assert.equal(sandbox.window.LocalSpeech.state, 'idle');
    requests.length = 0;
    await sandbox.window.LocalSpeech.play(input, 'masculine', note, 'elevenlabs');
    assert.equal(contextsCreated, 1, 'Successive parts reuse the original unlocked context');
    assert.equal(requests.length, 2);
    assert(requests.every(r => r.provider === 'elevenlabs' && r.voice === 'masculine'));
    assert.equal(requests.map(r => r.input).join('').replace(/\s/g, ''), input.replace(/\s/g, ''));
    requests.length = 0;
    let savedRecording = null;
    let completed = 0;
    await sandbox.window.LocalSpeech.play('Hello.', 'masculine', note, 'elevenlabs', {title: 'Test', text: 'Hello.', voice: 'masculine'}, result => savedRecording = result, () => completed++);
    assert.equal(contextsCreated, 1, 'Successive parts reuse the original unlocked context');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].pcm, 'AQACAA==');
    assert.equal(savedRecording.url, '/saved.wav');
    assert.equal(completed, 0, 'Saving must not advance before audio finishes');
    timers.at(-1)();
    assert.equal(note.textContent, 'Stream finished · recording saved · 100% complete');
    assert.equal(completed, 1, 'Natural completion advances exactly once');
    timers.at(-1)();
    assert.equal(completed, 1);
    requests.length = 0;
    await sandbox.window.LocalSpeech.play('Pause test.', 'ryan', note);
    await sandbox.window.LocalSpeech.pause();
    assert.equal(audioContext.state, 'suspended');
    assert.equal(sandbox.navigator.audioSession.type, 'playback');
    assert.equal(sandbox.navigator.mediaSession.playbackState, 'paused');
    assert.equal(typeof sandbox.navigator.mediaSession.play, 'function');
    closed = false;
    timers.at(-1)();
    assert.equal(closed, false, 'Paused playback must stay alive past its original finish timer');
    await sandbox.window.LocalSpeech.resume();
    assert.equal(audioContext.state, 'running');
    assert.equal(note.textContent, 'Stream finished · 100% complete');
    requests.length = 0;
    await sandbox.window.LocalSpeech.restart();
    assert.equal(requests[0].input, 'Pause test.');
    sandbox.window.LocalSpeech.stop();
    let stoppedCompletions = 0;
    await sandbox.window.LocalSpeech.play('Stop test.', 'masculine', note, 'elevenlabs', null, null, () => stoppedCompletions++);
    sandbox.window.LocalSpeech.stop();
    timers.at(-1)();
    assert.equal(stoppedCompletions, 0, 'Stop cancels continuation without discarding Safari audio permission');
    assert.equal(contextsCreated, 1);
    const normalFetch = sandbox.fetch;
    sandbox.fetch = async () => {
        let delivered = false;
        return {ok: true, body: {getReader: () => ({read: async () => {
            if (delivered) return {done: true};
            delivered = true;
            return {done: false, value: new Uint8Array(24000 * 2 * 40)};
        }})}};
    };
    let rewindCompleted = 0;
    await sandbox.window.LocalSpeech.play('Rewind test.', 'masculine', note, 'elevenlabs', null, null, () => rewindCompleted++);
    const originalStart = starts.at(-1);
    audioContext.currentTime = originalStart + 25;
    const beforeRewindRequests = requests.length;
    sandbox.window.LocalSpeech.rewind(15);
    assert(Math.abs(offsets.at(-1) - 10) < 0.001, 'Rewind replays audio from 15 seconds earlier');
    assert.equal(requests.length, beforeRewindRequests, 'Rewind uses buffered audio without another TTS request');
    sandbox.window.LocalSpeech.rewind(15);
    assert.equal(offsets.at(-1), 0, 'Repeated rewind clamps to the beginning');
    await sandbox.window.LocalSpeech.pause();
    sandbox.window.LocalSpeech.rewind(15);
    assert.equal(sandbox.window.LocalSpeech.state, 'paused', 'Rewind preserves paused playback');
    await sandbox.window.LocalSpeech.resume();
    sandbox.window.LocalSpeech.stop();
    timers.at(-1)();
    assert.equal(rewindCompleted, 0, 'Stopped rewound streams do not advance');
    sandbox.fetch = normalFetch;
    let releaseSave;
    let delayedCompletions = 0;
    sandbox.fetch = async (url, options) => {
        if (url.endsWith('/save')) {
            await new Promise(resolve => { releaseSave = resolve; });
            return { ok: true, json: async () => ({ url: '/delayed.wav' }) };
        }
        return normalFetch(url, options);
    };
    const delayedStream = sandbox.window.LocalSpeech.play('Cue before a stage direction.', 'masculine', note,
        'elevenlabs', { title: 'Delayed save', text: 'Cue before a stage direction.' }, null, () => delayedCompletions++);
    while (!releaseSave) await new Promise(resolve => setImmediate(resolve));
    timers.at(-1)();
    assert.equal(delayedCompletions, 1, 'Next character cue starts even while saving is stalled');
    assert.equal(sandbox.window.LocalSpeech.state, 'idle', 'Saving does not hold playback open');
    releaseSave();
    await delayedStream;
    assert.equal(delayedCompletions, 1, 'Completing the upload must not advance twice');
    sandbox.fetch = normalFetch;
    requests.length = 0;
    sandbox.fetch = async (url, options) => {
        requests.push(JSON.parse(options.body));
        return {ok: true, body: {getReader: () => ({read: async () => { throw new Error('Stream disconnected'); }})}};
    };
    await sandbox.window.LocalSpeech.play('Hello.', 'masculine', note, 'elevenlabs', {title: 'Test'});
    assert.equal(requests.length, 1, 'Failed streams must never upload a recording');
    console.log('Streaming regression checks passed for all Perry Miller sequel sections.');
})().catch(error => { console.error(error); process.exitCode = 1; });
