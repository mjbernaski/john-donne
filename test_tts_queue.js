const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('app.js', 'utf8');
const source = code.slice(code.indexOf('async function runNarrationQueue('), code.indexOf('async function generateWholeChapter('));
const job = (state, extra = {}) => ({ id: 'test', state, completed: state === 'done' ? 2 : 0, total: 2, reused: 0, ...extra });
const response = data => ({ ok: true, json: async () => data });

async function check({ steps, navigate = false, error, messages = [] }) {
    const requests = [], statuses = [], deadlines = new Map();
    let current = true, timerId = 0;
    const c = {
        Headers, AbortController, Date, encodeURIComponent,
        getGeminiApiKey: () => '', geminiKeySetup: { hidden: true },
        getApiError: async () => 'Rejected',
        setPoemAudioStatus: message => statuses.push(message),
        setTimeout(callback, ms) {
            const id = ++timerId;
            if (ms === 15000) deadlines.set(id, callback);
            else { if (navigate && ms === 1500) current = false; callback(); }
            return id;
        },
        clearTimeout(id) { deadlines.delete(id); },
        fetch: async (url, options) => {
            requests.push([url, options]);
            assert(steps.length, 'Unexpected request');
            const step = steps.shift();
            if (step === 'timeout') {
                return new Promise((resolve, reject) => {
                    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Timeout'), { name: 'AbortError' })));
                    [...deadlines.values()].forEach(callback => callback());
                });
            }
            if (step instanceof Error) throw step;
            return step;
        }
    };
    vm.createContext(c);
    vm.runInContext(source, c);
    const promise = c.runNarrationQueue([{ text: 'one' }, { text: 'two' }], () => current, 'Test');
    if (error) await assert.rejects(promise, error);
    else assert.equal(await promise, !navigate);
    assert.equal(JSON.parse(requests[0][1].body).parts.length, 2);
    assert.equal(deadlines.size, 0, 'Clear all request deadlines');
    assert.equal(steps.length, 0);
    for (const message of messages) assert(statuses.some(s => s.includes(message)), message);
    return requests;
}
(async () => {
    await check({ steps: [response(job('running')), response(job('done'))] });
    await check({ steps: [response(job('running'))], navigate: true });
    const polls = await check({ steps: [response(job('running')), new TypeError('Offline'), 'timeout', response(job('done'))], messages: ['reconnecting'] });
    assert(polls.slice(1).every(([url]) => url === '/api/tts/jobs/test'), 'Reconnect to the same queue');
    const submissions = await check({ steps: [new TypeError('Response lost'), response(job('done'))] });
    assert.equal(submissions[0][1].body, submissions[1][1].body, 'Resubmit identical parts for server deduplication');
    await check({ steps: [response(job('running')), ...Array.from({ length: 5 }, () => new TypeError('Offline'))], error: /may still be running/ });
    await check({ steps: [response(job('running')), { ok: false, status: 404 }], error: /restart/ });
    await check({ steps: [{ ok: false, status: 401 }], error: /Rejected/ });
    await check({ steps: [response(job('failed', { error: 'Stopped at part 2. Saved parts will be reused.' }))], error: /Stopped at part 2/ });
    await check({ steps: [response(job('running', { stage: 'retrying', part: 2, attempt: 1, maxAttempts: 4, retryAt: Date.now() / 1000 + 20, retryReason: 'Provider rate limit' })), response(job('done'))], messages: ['Provider rate limit', 'attempt 2/4'] });
    console.log('PASS: queue reconnects after network failures and timeouts, bounds retries, preserves submission identity, handles navigation and permanent failures, and displays provider retries');
})().catch(error => { console.error(error); process.exitCode = 1; });
