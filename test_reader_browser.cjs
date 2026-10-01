// Run with PLAYWRIGHT_MODULE=/path/to/playwright node test_reader_browser.cjs
// All generation and chat requests are mocked; the test uses its own HTTP server.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = spawn('python3', ['-u', '-c', `import socket; socket.getfqdn=lambda *args: 'localhost'
import server
from http.server import ThreadingHTTPServer
httpd=ThreadingHTTPServer(('127.0.0.1',0),server.PoetryRequestHandler)
print(httpd.server_port,flush=True)
httpd.serve_forever()`], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
const wav = Buffer.alloc(44 + 24000 * 2 * 180);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
async function run() {
    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Test server startup timeout')), 10000);
        server.stdout.once('data', data => { clearTimeout(timer); resolve(Number(data.toString().trim())); });
        server.once('exit', code => reject(new Error(`Server exited: ${code}`)));
    });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    let saved = false, failAvailability = false, submits = 0, polls = 0;
    // Keep enough parts to exercise resumed ranges at the 5,000-character default.
    await page.route('**/poems-sherlock-holmes.json', async route => {
        const response = await route.fetch();
        const poems = await response.json();
        poems[0].content = Array(4).fill(poems[0].content).join('\n\n');
        return route.fulfill({ json: poems });
    });
    await page.route('**/api/tts', route => { errors.push('Unexpected direct generation request'); return route.fulfill({ status: 500, json: { error: 'Paid generation disabled in tests' } }); });
    await page.route('**/api/flux/generate', route => route.fulfill({ status: 500, json: { error: 'Generation disabled in tests' } }));
    await page.route('**/api/chat/**', route => route.fulfill({ json: { data: [{ id: 'test-model' }], choices: [{ message: { content: 'Test' } }] } }));
    await page.route('**/api/tts/availability', route => {
        if (failAvailability) return route.abort();
        const { parts } = route.request().postDataJSON();
        return route.fulfill({ json: { parts: parts.map((_, i) => ({ saved: saved && i < 2, url: saved && i < 2 ? `/test-audio-${i}.wav` : null })) } });
    });
    await page.route('**/test-audio-*.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
    await page.route('**/api/tts/lookup', route => route.fulfill({ status: 404, json: { error: 'No saved reading' } }));
    await page.route('**/api/tts/jobs', route => { submits++; return route.fulfill({ json: { id: 'ui-test', state: 'running', total: 2, completed: 0, reused: 0, part: 1, stage: 'generating', attempt: 1, maxAttempts: 4, stageStartedAt: Date.now() / 1000 - 30 } }); });
    await page.route('**/api/tts/jobs/ui-test', route => {
        polls++;
        return route.fulfill({ json: { id: 'ui-test', state: polls < 3 ? 'running' : 'failed', total: 2, completed: 1, reused: 0, part: 2, stage: 'retrying', attempt: 1, maxAttempts: 4, retryAt: Date.now() / 1000 + 15, retryReason: 'Rate limit', error: 'Stopped at part 2 of 2. Resume missing parts.' } });
    });
    const base = `http://127.0.0.1:${port}`;
    await page.goto(base + '/library.html');
    await page.waitForFunction(() => window.Reader?.active);
    assert(await page.locator('#readerLibrary').isVisible());
    await page.locator('.reader-shell-bar [data-reader-preview]').check();
    await page.locator('.library-card').filter({ hasText: 'The Complete Sherlock Holmes' }).locator('.library-open').click();
    await page.waitForSelector('.reader-contents-section');
    assert.equal(await page.locator('.reader-contents-section').count(), 9);
    await page.locator('.reader-contents-section a').first().click();
    await page.waitForSelector('#readerParts button');
    assert(await page.locator('#readerListen').isVisible());
    assert.equal(await page.locator('#readerAudioSettings').getAttribute('open'), null);
    assert.equal(await page.locator('#readerPrevious').isDisabled(), true);
    const firstUrl = page.url();
    await page.locator('#readerListen').click();
    await page.waitForSelector('#readerGeneration[open]');
    assert.equal(submits, 0, 'Listen must not generate before a choice');
    await page.locator('#readerGenerationCancel').click();
    await page.locator('#discussTab').click();
    assert(await page.locator('#poemPanel').isVisible());
    assert(await page.locator('#chatPanel').isVisible());
    await page.locator('#chatInput').fill('Draft kept while browsing');
    await page.evaluate(() => document.getElementById('poemPanel').scrollTop = 400);
    await page.locator('#readTab').click();
    await page.evaluate(() => document.getElementById('poemPanel').scrollTop = 400);
    await page.locator('#readerNext').evaluate(button => button.click());
    await page.goBack();
    await page.waitForURL(firstUrl);
    await page.waitForFunction(() => document.getElementById('chatInput').value === 'Draft kept while browsing');
    assert(await page.locator('#poemPanel').evaluate(el => el.scrollTop >= 300), 'Restore reading position');
    await page.locator('#readerAppearance summary').click();
    await page.locator('[data-appearance="theme"]').selectOption('dark');
    assert.equal(await page.locator('body').getAttribute('data-reader-theme'), 'dark');
    await page.locator('#readerAppearance summary').click();
    saved = true;
    await page.locator('#readerListen').click();
    await page.waitForFunction(() => !document.getElementById('poemAudioPlayer').paused);
    const playingTitle = await page.locator('#readerPlayingTitle').textContent();
    await page.locator('#readerNext').click();
    assert.equal(await page.locator('#readerPlayingTitle').textContent(), playingTitle);
    assert(await page.evaluate(() => !document.getElementById('poemAudioPlayer').paused));
    await page.locator('#closeModal').click();
    await page.locator('.reader-shell-bar > a').click();
    assert(await page.locator('#readerLibrary').isVisible());
    assert(await page.evaluate(() => !document.getElementById('poemAudioPlayer').paused));
    await page.locator('#readerReturn').click();
    await page.waitForSelector('#poemModal.show');
    // A saved next part advances, but a missing part stops without generation.
    await page.evaluate(() => Reader.ended());
    await page.waitForFunction(() => document.getElementById('poemAudioPlayer').getAttribute('src') === '/test-audio-1.wav');
    await page.evaluate(() => Reader.ended());
    await page.waitForFunction(() => document.getElementById('readerPlayerStatus').textContent.includes('not saved'));
    assert.equal(submits, 0);
    await page.locator('#readerPartSelect').selectOption('0');
    await page.locator('#readerListen').click();
    await page.waitForFunction(() => !document.getElementById('poemAudioPlayer').paused);
    // Settings affect browsing only, not the active recording.
    await page.locator('#readerAudioSettings summary').click();
    await page.locator('#ttsProvider').selectOption('gemini');
    assert(await page.evaluate(() => !document.getElementById('poemAudioPlayer').paused));
    await page.locator('#readerAudioSettings summary').click();
    // Generation can be followed after leaving the reading.
    saved = false;
    await page.locator('#readerPartSelect').selectOption('2');
    await page.locator('#readerListen').click();
    await page.locator('#readerGenerateRemaining').click();
    await page.waitForFunction(() => document.getElementById('readerQueue').textContent.includes('generating'));
    assert.match(await page.locator('#poemAudioStatus').textContent(), /Part 3.*generating.*elapsed/);
    assert(await page.locator('#readerGenerationProgress').isVisible());
    assert.match(await page.locator('#readerGenerationCounts').textContent(), /0 done · 1 underway · 1 queued/);
    assert.equal(await page.locator('#readerGenerationDots [data-state="generating"]').getAttribute('aria-label'), 'Part 3: underway');
    assert.equal(await page.locator('#readerGenerationDots [data-state="queued"]').textContent(), '4');
    await page.locator('.reader-shell-bar [data-reader-preview]').uncheck();
    assert(await page.locator('#readerGenerationProgress').isVisible(), 'Progress is visible without the new reader');
    await page.locator('.reader-shell-bar [data-reader-preview]').check();
    await page.waitForFunction(() => document.getElementById('poemAudioStatus').textContent.includes('Part 4 · Rate limit'));
    assert.match(await page.locator('#readerGenerationCounts').textContent(), /1 done · 1 underway · 0 queued/);
    assert.equal(await page.locator('#readerGenerationMeter').getAttribute('value'), '1');
    assert.equal(await page.locator('#readerGenerationDots [data-state="done"]').textContent(), '3');
    assert.equal(await page.locator('#readerGenerationDots [data-state="retrying"]').textContent(), '4');
    assert.match(await page.locator('#readerPartSummary').textContent(), /1 saved · Retrying/);
    assert.equal(await page.locator('#readerParts [data-index="2"]').getAttribute('data-state'), 'saved');
    assert.equal(await page.locator('#readerParts [data-index="3"]').getAttribute('data-state'), 'retrying');
    await page.locator('#closeModal').click();
    await page.locator('.reader-shell-bar > a').click();
    await page.waitForFunction(() => document.getElementById('readerQueue').textContent.includes('Part 4 · Resume missing parts'));
    assert.match(await page.locator('#readerQueue').textContent(), /1 done · 1 failed · 0 not started/);
    assert(polls >= 2);
    // Return and validate unknown availability and mobile tabs.
    await page.locator('#readerQueue button').first().click();
    assert.equal(await page.locator('#readerGenerationDots [data-state="failed"]').getAttribute('aria-label'), 'Part 4: failed');
    failAvailability = true;
    await page.locator('#readerCheckAudio').click();
    await page.waitForFunction(() => document.querySelector('[data-state="unknown"]'));
    // Audio stored only in this browser is still available during a server failure.
    await page.evaluate(async () => {
        const blob = await (await fetch('/test-audio-0.wav')).blob();
        const parts = getNarrationParts(currentPoem);
        await storeAudio(getPoemAudioKey(currentPoem, poemVoice.value, parts[2], 2), blob, {});
    });
    await page.locator('#readerCheckAudio').click();
    await page.waitForFunction(() => document.querySelector('#readerParts [data-index="2"]').dataset.state === 'saved');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#discussTab').click();
    assert(!await page.locator('#poemPanel').isVisible());
    assert(await page.locator('#chatPanel').isVisible());
    await page.locator('#readTab').click();
    assert(await page.locator('#readerListen').isVisible());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!overflow, 'Mobile page must not overflow horizontally');
    const header = await page.locator('.reader-shell-bar').boundingBox();
    assert(header.y === 0, 'Shell navigation stays visible');
    const tabs = await page.locator('.modal-tabs').boundingBox();
    assert(tabs.y >= 64 && tabs.y < 130, 'Mobile tabs stay at the top, clear of the player');
    await page.screenshot({ path: '/tmp/reader-mobile.png', fullPage: false });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('#discussTab').click();
    await page.screenshot({ path: '/tmp/reader-desktop.png', fullPage: false });
    // Reload keeps the preferences and restores paused, without a paid request.
    // Switching the presentation preserves the playing recording.
    const sourceBeforeToggle = await page.locator('#poemAudioPlayer').getAttribute('src');
    await page.locator('.reader-shell-bar [data-reader-preview]').uncheck();
    assert.equal(await page.locator('#poemAudioPlayer').getAttribute('src'), sourceBeforeToggle);
    await page.locator('#readTab').click();
    assert(await page.locator('#generateAllAudio').isVisible());
    await page.locator('.reader-shell-bar [data-reader-preview]').check();
    failAvailability = false; saved = true;
    const submittedBeforeReload = submits;
    await page.reload();
    await page.waitForFunction(() => window.Reader?.active);
    assert(await page.locator('body').evaluate(el => el.classList.contains('reader-preview')));
    assert.equal(await page.locator('body').getAttribute('data-reader-theme'), 'dark');
    assert(await page.evaluate(() => document.getElementById('poemAudioPlayer').paused));
    assert.equal(submits, submittedBeforeReload);
    await page.waitForSelector('#readerPlayer:not([hidden])');
    assert((await page.locator('#readerPlayingDetail').textContent()).includes('Local voice 1'), 'Reload freezes the original playback voice');
    await page.evaluate(() => Reader.rememberComplete(Reader.capture(), '/test-audio-0.wav'));
    await page.locator('#readTab').click();
    await page.locator('#readerAudioSettings summary').click();
    await page.locator('#playCompleteChapter').click();
    await page.waitForFunction(() => document.getElementById('readerPlayingDetail').textContent.includes('Complete chapter'));
    await page.locator('#closeModal').click();
    assert(await page.evaluate(() => !document.getElementById('poemAudioPlayer').paused));
    assert.deepEqual(errors, []);
    console.log('PASS: shared Library, contents, Listen confirmation, persistent playback, drafts, history, themes, queue tracking, mobile tabs, and paused reload.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill(); });
