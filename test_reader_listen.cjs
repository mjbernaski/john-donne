const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('reader.js', 'utf8');
const calls = [];
const imageRequests = [];
const snap = { id: 'test', requests: [{ text: 'Hello.', title: 'Chapter', speakTitle: true, voice: 'masculine' }], availability: [{ state: 'saved' }] };
const context = {
    generatePoemImageSet: options => { imageRequests.push(options); return Promise.resolve(); },
    playVersion: 0, playback: null, choosePart: i => { context.poemAudioPart.value = String(i); }, selected: snap, poemAudioPart: { value: '0' },
    refreshAvailability: async () => {}, startPlayback: async (s, i) => calls.push(['saved', s, i]),
    poemAudioPlayer: { pause: () => calls.push(['pause']) },
    LocalSpeech: { prepare: () => {}, stop: () => {}, play: (...args) => calls.push(['stream', ...args]) },
    $: () => ({}), refreshRecordings: () => {},
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('    async function listenCurrent()'), source.indexOf('    async function playSelected()')), context);
(async () => {
    await context.listenCurrent();
    assert.equal(imageRequests.length, 1, 'Listen queues an image alongside saved narration');
    assert.equal(imageRequests[0].count, 1, 'Listen requests exactly one image');
    assert.equal(calls[0][0], 'saved', 'Listen reuses available recordings');
    calls.length = 0;
    snap.availability[0].state = 'missing';
    await context.listenCurrent();
    assert.equal(imageRequests.length, 2, 'Streaming Listen also queues a new image');
    assert.equal(calls[0][0], 'pause');
    assert.equal(calls[1][0], 'stream', 'Listen streams missing audio without opening a generation dialog');
    assert.equal(calls[1][1], 'Chapter.\n\nHello.');
    assert.equal(calls[1][4], 'elevenlabs');
    assert.equal(calls[1][5], snap.requests[0], 'Complete streams retain recording metadata for saving');
    snap.requests.push({ text: 'Second.', voice: 'masculine' });
    snap.availability.push({ state: 'saved' });
    calls[1][7]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1)[0], 'saved', 'Stream completion advances to saved next part');
    assert.equal(calls.at(-1)[2], 1);
    assert.equal(imageRequests.length, 2, 'Automatic part advancement does not queue additional images');
    assert.equal(calls.at(-1)[1].continuousListen, true);
    calls.length = 0;
    await context.listenCurrent();
    const stream = calls.find(call => call[0] === 'stream');
    if (stream) {
        context.playVersion++;
        stream[7]();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls.filter(call => call[0] === 'saved').length, 0, 'Superseded streams cannot advance');
    }
    // Saved-performance Play must retain continuous Listen at the scene boundary.
    vm.runInContext(source.slice(source.indexOf('    async function playSelected()'), source.indexOf('    async function startPlayback(')), context);
    context.snapshot = () => snap;
    snap.performance = true;
    snap.requests = Array.from({ length: 540 }, (_, i) => ({ text: `Cue ${i + 1}`, voice: 'masculine' }));
    snap.availability = snap.requests.map(() => ({ state: 'saved' }));
    context.poemAudioPart.value = '126';
    await context.playSelected();
    assert.equal(calls.at(-1)[2], 126);
    assert.equal(calls.at(-1)[1].continuousListen, true, 'Playing saved cue 127 keeps automatic continuation');
    // Playing one saved cast cue must continue the scene, including missing cues.
    vm.runInContext(source.slice(source.indexOf('    function playExternal('), source.indexOf('    function generationPartState(')), context);
    context.currentPoem = {};
    context.currentBook = {};
    snap.availability[1].url = '/faust-first-speech.wav';
    context.playExternal('/faust-first-speech.wav', 'Saved first speech');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1)[2], 1, 'Saved character recording retains its cue position');
    assert.equal(calls.at(-1)[1].continuousListen, true, 'Saved character recording continues into the next speech');
    assert.equal(calls.at(-1)[1].requests.length, 540, 'Saved cue retains the complete performance');
    context.updateReadingPosition = () => {};
    context.stepPlayback = () => { throw new Error('Continuous Listen must use the saved/streaming path'); };
    vm.runInContext(source.slice(source.indexOf('    function ended()'), source.indexOf('    function closePlayer()')), context);
    context.playback = { ...snap, index: 126, continuousListen: true };
    context.ended();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1)[2], 127, 'Stage direction cue 127 advances to Faustus cue 128');
    vm.runInContext(source.slice(source.indexOf('    function rewindPlayback()'), source.indexOf('    function stepPlayback(')), context);
    let persisted = 0, streamRewinds = 0;
    context.persistPlayback = () => persisted++;
    context.poemAudioPlayer.getAttribute = () => '/saved.wav';
    context.poemAudioPlayer.currentTime = 22;
    context.LocalSpeech.state = 'idle';
    context.rewindPlayback();
    assert.equal(context.poemAudioPlayer.currentTime, 7);
    context.rewindPlayback();
    assert.equal(context.poemAudioPlayer.currentTime, 0, 'Saved rewind clamps to the start');
    assert.equal(persisted, 2);
    context.LocalSpeech.state = 'paused';
    context.LocalSpeech.rewind = seconds => { assert.equal(seconds, 15); streamRewinds++; };
    context.rewindPlayback();
    assert.equal(streamRewinds, 1, 'Stream rewind uses the buffered player');
    vm.runInContext(source.slice(source.indexOf('    function updateTransportControls()'), source.indexOf('    function updatePlaybackProgress(')), context);
    const button = { setAttribute(name, value) { this[name] = value; } };
    context.$ = id => id === 'readerTransport' ? button : {};
    context.LocalSpeech.pause = async () => { context.LocalSpeech.state = 'paused'; };
    context.LocalSpeech.resume = async () => { context.LocalSpeech.state = 'playing'; };
    context.LocalSpeech.state = 'playing';
    context.updateTransportControls();
    assert.equal(button.textContent, 'Pause');
    assert.equal(button.disabled, false);
    await context.togglePlaybackPause();
    assert.equal(button.textContent, 'Continue');
    assert.equal(button['aria-label'], 'Continue narration');
    await context.togglePlaybackPause();
    assert.equal(context.LocalSpeech.state, 'playing');
    assert.equal(button.textContent, 'Pause');
    context.LocalSpeech.state = 'idle';
    context.poemAudioPlayer.paused = false;
    context.poemAudioPlayer.currentTime = 42;
    context.poemAudioPlayer.pause = () => { context.poemAudioPlayer.paused = true; };
    context.safePlay = async () => { context.poemAudioPlayer.paused = false; };
    await context.togglePlaybackPause();
    assert.equal(button.textContent, 'Continue');
    assert.equal(context.poemAudioPlayer.currentTime, 42, 'Pause preserves saved playback position');
    await context.togglePlaybackPause();
    assert.equal(button.textContent, 'Pause');
    assert.equal(context.poemAudioPlayer.currentTime, 42, 'Continue resumes without restarting');
    context.poemAudioPlayer.getAttribute = () => null;
    context.updateTransportControls();
    assert.equal(button.disabled, true, 'Visible transport is disabled when there is no audio');
    console.log('PASS: simplified Listen reuses saved audio or starts ElevenLabs streaming.');
})().catch(error => { console.error(error); process.exitCode = 1; });
