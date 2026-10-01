const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
const context = {}; vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function savedRecordingParts('), source.indexOf('async function stitchWholeChapter(')), context);
const record = (n, overrides = {}) => ({filename: `Perry - Chapter I - Part ${n} - Ryan.wav`, url: `/api/tts/audio/${String(n).padStart(64, '0')}/reading.wav`, voice:'masculine', provider:'local', model:'Qwen3-TTS', ...overrides});
const keys = records => Array.from(context.savedRecordingParts(records, 'masculine', 'local', 'local'));
assert.deepEqual(keys([record(3), record(1), record(2), record(1, {voice:'feminine'})]), [1,2,3].map(n => String(n).padStart(64,'0')));
assert.deepEqual(keys([record(1),record(3)]), []);
assert.deepEqual(keys([record(1),record(1)]), []);
assert.deepEqual(keys([record(1, {provider:'gemini'})]), []);
assert.deepEqual(keys([record(1, {filename:'Complete chapter.wav'})]), []);
console.log('PASS: saved parts ordered numerically; gaps, ambiguous versions, other voices and models excluded');
const requests = [];
let remembered;
Object.assign(context, {
    currentPoem: {title:'Chapter I'}, currentBook: {id:'colony-to-province'}, currentChatSession: {},
    poemVoice: {value:'masculine'}, selectedTtsProvider: () => 'local',
    getNarrationParts: () => ['new first part','new second part'],
    stitchChapterAudio: {}, setPoemAudioStatus: () => {}, ttsVoiceName: () => 'Ryan',
    buildDownloadName: () => 'Saved chapter.wav', ttsModelKey: () => 'local',
    narrationRequestTitle: (poem, index) => `${poem.title} ${index}`,
    Reader: {active:true, capture: () => ({id:'snapshot'}), rememberComplete: (...args) => { remembered = args; }},
    downloadAudio: {}, setDownloadLink: () => {}, downloadableAudioUrl: url => url,
    formatFileSize: () => '1 KB', URL,
    fetch: async (url, options) => {
        requests.push([url,JSON.parse(options.body)]);
        if (requests.length === 1) return {status:409,ok:false};
        if (requests.length === 2) return {ok:true,json:async () => ({recordings:[record(2),record(1)]})};
        return {ok:true,status:200,blob:async () => ({size:1024}),headers:{get:name => name === 'X-Audio-Path' ? '/saved-chapter.wav' : 'saved recording version'}};
    }
});
vm.runInContext(source.slice(source.indexOf('async function stitchWholeChapter('),source.indexOf('\nfunction playWholeChapter()', source.indexOf('async function stitchWholeChapter('))), context);
(async () => {
    await context.stitchWholeChapter();
    assert.equal(requests.length,3);
    assert.deepEqual(requests[2][1].savedKeys,[1,2].map(n => String(n).padStart(64,'0')));
    assert.equal(remembered[1],'/saved-chapter.wav');
    assert.equal(remembered[2],'Saved recording version');
    console.log('PASS: current-text miss assembles and remembers the saved Ryan version without a generation request');
})().catch(error => {console.error(error);process.exitCode=1;});
