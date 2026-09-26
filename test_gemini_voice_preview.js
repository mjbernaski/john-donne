// No paid requests: verify sample reuse, frozen settings, and stale-preview handling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('app.js', 'utf8');
const elements = new Map();
const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: true, disabled: false, textContent: '',
        pause() {}, load() {}, removeAttribute() {}, play: async () => {} });
    return elements.get(id);
};
let calls = [], replies = [], model = 'gemini-3.8-flash-lite-tts';
const c = {
    Headers, console,
    document: { getElementById: element },
    selectedTtsProvider: () => 'gemini', selectedGeminiTtsModel: () => model,
    poemVoice: { value: 'Kore' }, GEMINI_VOICE_SAMPLE: 'A short passage.',
    GEMINI_STUDIO_VOICES: { Kore: 'Firm', Sulafat: 'Warm' },
    ttsVoiceName: voice => voice, getGeminiApiKey: () => '',
    getApiError: async () => 'Provider unavailable', geminiKeySetup: { hidden: true },
    formatGeminiTtsCost: () => 'preview estimate',
    URL: { createObjectURL: () => 'blob:sample', revokeObjectURL() {} },
    async fetch(url, options) {
        calls.push({ url, body: JSON.parse(options.body) });
        assert(replies.length, 'Unexpected request');
        return replies.shift()();
    }
};
vm.createContext(c);
vm.runInContext(code.slice(code.indexOf('let geminiPreviewVersion ='), code.indexOf('function formatAudioTime(')), c);
const ok = () => ({ ok: true, status: 200, blob: async () => new Blob(['wav']) });
(async () => {
    replies = [ok];
    await c.previewSelectedGeminiVoice();
    assert.deepEqual(calls.map(x => x.url), ['/api/tts/lookup']);
    assert.equal(element('geminiVoicePreviewPlayer').src, 'blob:sample');
    assert.equal(element('previewGeminiVoice').disabled, false);
    calls = [];
    replies = [() => ({ status: 404 }), () => { c.poemVoice.value = 'Sulafat'; model = 'gemini-3.8-flash-tts'; c.updateGeminiVoicePreview(); return ok(); }];
    await c.previewSelectedGeminiVoice();
    assert.deepEqual(calls.map(x => x.url), ['/api/tts/lookup', '/api/tts']);
    assert.equal(calls[1].body.voice, 'Kore');
    assert.equal(calls[1].body.model, 'gemini-3.8-flash-lite-tts');
    assert.equal(calls[1].body.speakTitle, false);
    assert.equal(element('geminiVoicePreviewPlayer').hidden, true, 'Old voice must not play after selection changes');
    calls = [];
    replies = [() => ({ ok: false, status: 503 })];
    await c.previewSelectedGeminiVoice();
    assert.equal(calls.length, 1, 'Lookup errors must not trigger paid generation');
    assert.match(element('geminiVoicePreviewStatus').textContent, /Preview failed/);
    console.log('PASS: preview cache reuse, frozen voice/model, stale result suppression, no generation on lookup errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
