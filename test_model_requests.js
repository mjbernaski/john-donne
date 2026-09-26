// Run with node test_model_requests.js; exercises transport without a live model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
let replies = [], calls = [], timeOut = false;
const context = {
    AbortController, CHAT_PROXY_URL: '/api/chat', modelRequest: null,
    setTimeout(fn, delay) { if (delay < 10000 || timeOut) queueMicrotask(fn); return 1; },
    clearTimeout() {},
    getApiError: async response => `HTTP ${response.status}`,
    fetch: async (url, options) => {
        calls.push({ url, options });
        assert(replies.length, 'Unexpected extra request');
        return replies.shift()(options);
    }
};
vm.createContext(context);
vm.runInContext(code.slice(code.indexOf('async function requestModelJson('), code.indexOf('function usesNarrativeImages(')), context);
vm.runInContext(code.slice(code.indexOf('async function resolveModel('), code.indexOf('async function connectChatSession(')), context);
const ok = (data = { success: true }) => () => ({ ok: true, json: async () => data });
const status = status => () => ({ ok: false, status });
const disconnected = () => { throw new TypeError('Load failed'); };
function setup(next) { replies = next; calls = []; timeOut = false; }

async function run() {
    setup([disconnected, disconnected, ok()]);
    assert.equal((await context.requestModelJson('/v1/models')).success, true);
    assert.equal(calls.length, 3);
    assert.notEqual(calls[0].options.signal, calls[1].options.signal);

    setup([() => ({ ok: true, json: async () => { throw new TypeError('Load failed'); } }), ok()]);
    await context.requestModelJson('/v1/models');
    assert.equal(calls.length, 2);

    setup([status(503), ok()]);
    await context.requestModelJson('/v1/models');
    assert.equal(calls.length, 2);

    setup([status(400)]);
    await assert.rejects(context.requestModelJson('/v1/models'), error => error.status === 400);
    assert.equal(calls.length, 1);

    setup([disconnected, disconnected, disconnected]);
    await assert.rejects(context.requestModelJson('/v1/models', {}, 'Model discovery'), /Model discovery failed after 3 attempts: the connection/);
    assert.equal(calls.length, 3);

    const hanging = options => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('Aborted'); error.name = 'AbortError'; reject(error);
        });
    });
    setup([hanging, hanging, hanging]); timeOut = true;
    await assert.rejects(context.requestModelJson('/v1/models'), /timed out/);
    assert.equal(calls.length, 3);

    setup([status(404), ok({ data: [{ id: 'replacement-model' }] }), ok()]);
    context.modelRequest = Promise.resolve('old-model');
    await context.requestSceneJson({ method: 'POST', body: JSON.stringify({ model: 'old-model', messages: [] }) });
    assert.equal(calls[1].url, '/api/chat/v1/models');
    assert.equal(JSON.parse(calls[2].options.body).model, 'replacement-model');
    assert.equal(calls.length, 3);
    console.log('PASS: connection and body retries, transient HTTP errors, permanent errors, timeouts, bounded failures, stale model refresh');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
