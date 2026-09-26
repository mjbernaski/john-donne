// Run with node test_tts_access.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(`${__dirname}/app.js`, 'utf8');
let requests = 0;
let status = '';
const session = { audioByVoice: new Map() };
const context = {
    Headers, AbortController, setTimeout, clearTimeout,
    console: { error() {} }, currentPoem: {}, currentChatSession: session,
    currentBook: { id: 'test' }, selectedTtsProvider: () => 'gemini',
    selectedGeminiTtsModel: () => 'test', getGeminiApiKey: () => 'replacement',
    geminiKeySetup: { hidden: true },
    fetch: async (url, options) => {
        requests++;
        assert.equal(options.headers.get('X-Gemini-API-Key'), 'replacement');
        return { ok: false, status: 403, text: async () => JSON.stringify({ error: 'Consumer suspended' }) };
    },
    getNarrationParts: () => Array(55).fill('text'),
    ttsAudioSlot: (_, index) => index, getPoemAudioKey: () => 'key',
    getStoredAudio: async () => null, buildDownloadName: () => 'test.wav',
    ttsVoiceName: () => 'voice', narrationRequestTitle: () => 'test',
    formatWholeWorkGeminiCost: () => '', formatCompactDuration: () => '',
    setPoemAudioStatus: text => { status = text; }, renderPoemAudio() {},
    WHOLE_CHAPTER_GEMINI_TTS_CONCURRENCY: 3, WHOLE_CHAPTER_LOCAL_TTS_CONCURRENCY: 1,
};
for (const name of ['poemVoice', 'poemAudioPart', 'generateAudio', 'generateAllAudio',
    'playAllAudio', 'ttsProvider', 'geminiTtsModel']) context[name] = { value: '0' };
vm.createContext(context);
for (const [start, end] of [
    ['async function getApiError(', 'async function readStreamingCompletion('],
    ['async function requestGeminiTts(', 'function getReadableResponseText('],
    ['async function runNarrationQueue(', 'async function stitchWholeChapter(']
]) vm.runInContext(code.slice(code.indexOf(start), code.indexOf(end)), context);
(async () => {
    assert.equal(await context.getApiError({ status: 403, text: async () => '{"error":{"message":"nested"}}' }), 'nested');
    await assert.rejects(context.runNarrationQueue([{ text: 'test' }], () => true, 'Test'), /Consumer suspended/);
    assert.equal(requests, 1, 'Access failure must not start more requests');
    assert.equal(context.geminiKeySetup.hidden, false);
    console.log('PASS: provider error details, replacement key, access failure batch stop, queue submission stopped');
})().catch(error => { console.error(error); process.exitCode = 1; });
