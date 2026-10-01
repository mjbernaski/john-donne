const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
let provider = 'local', catalog, deferred;
const saved = new Map();
const select = { value: 'feminine', dataset: {}, options: [], replaceChildren(...options) { this.options = options; } };
const context = {
    console, poemVoice: select,
    document: { getElementById: () => null },
    Option: function(text, value) { this.textContent = text; this.value = value; },
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    GEMINI_VOICE_STORAGE: 'gemini', GEMINI_STUDIO_VOICES: { Kore: 'Firm', Gacrux: 'Mature' },
    GEMINI_VOICE_NAMES: { feminine: 'Gacrux' }, VOICE_NAMES: {},
    selectedTtsProvider: () => provider,
    currentPoem: null, currentChatSession: null,
    window: {},
    fetch: async () => deferred ? await deferred : { ok: true, json: async () => catalog },
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const LOCAL_VOICE_STORAGE'), source.indexOf('let geminiPreviewVersion')), context);
(async () => {
    catalog = { voices: ['ryan','vivian','aiden','serena','custom_reader'].map(name => ({ name })), roles: { feminine:'vivian', masculine:'ryan', companion:'aiden' } };
    context.populateNarrationVoices('local');
    await context.refreshLocalNarrationVoices();
    assert.deepEqual(Array.from(select.options, o => o.textContent), ['ryan','vivian','aiden','serena','custom_reader']);
    assert.deepEqual(Array.from(select.options, o => o.value), ['masculine','feminine','companion','serena','custom_reader']);
    select.value = 'custom_reader';
    await context.refreshLocalNarrationVoices();
    assert.equal(select.value, 'custom_reader');
    saved.set('john-donne-local-reading-voice', 'serena');
    provider = 'gemini'; context.populateNarrationVoices('gemini');
    provider = 'local'; context.populateNarrationVoices('local');
    await context.refreshLocalNarrationVoices();
    assert.equal(select.value, 'serena');
    catalog.voices.push(...['amber','atlas','clara','felix','leo','willow'].map(name => ({name})));
    context.populateNarrationVoices('local');
    await context.refreshLocalNarrationVoices();
    for (const name of ['amber','atlas','clara','felix','leo','willow']) {
        assert(select.options.some(option => option.value === name), `Missing ${name}`);
    }
    assert.equal(select.value, 'serena');
    let resolve;
    deferred = new Promise(r => { resolve = r; });
    const pending = context.refreshLocalNarrationVoices();
    provider = 'gemini'; context.populateNarrationVoices('gemini');
    resolve({ok:true, json:async () => catalog});
    await pending;
    assert.deepEqual(Array.from(select.options, o => o.textContent), ['Kore · Firm', 'Gacrux · Mature']);
    console.log('PASS: dynamic local voices, named custom voices, remembered selection, and stale catalog response handling');
})().catch(error => { console.error(error); process.exitCode = 1; });
