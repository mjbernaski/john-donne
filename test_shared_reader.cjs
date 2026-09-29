// Two independent clients discover recordings; find-in-text preserves source text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-audio-test-'));
const poem = JSON.parse(fs.readFileSync('poems-sherlock-holmes.json'))[0];
const child = spawn('python3', ['-u', '-c', `
import server,sys,io
from pathlib import Path
from http.server import ThreadingHTTPServer
server.AUDIO_LIBRARY_PATH=Path(sys.argv[1])
server.BASE_DIR=Path(sys.argv[1])
server.IMAGE_ASSETS_PATH=server.BASE_DIR/'poem-images/assets'
server.IMAGE_LIBRARY_PATH=server.BASE_DIR/'poem-images/manifest.json'
server.IMAGE_DELETIONS_PATH=server.BASE_DIR/'poem-images/deleted.json'
def image_response(request, **kwargs):
    if '/images/test-shared.png' not in request.full_url: raise AssertionError('Unexpected upstream request')
    response=io.BytesIO(b'image-fixture')
    response.headers={'Content-Type':'image/png'}
    return response
server.urlopen=image_response
httpd=ThreadingHTTPServer(('127.0.0.1',0),server.PoetryRequestHandler)
print(httpd.server_port,flush=True)
httpd.serve_forever()
`, directory], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
child.stderr.on('data', () => {});
let browser, submissions = 0, submittedParts = [];
function recording(number, voice, model) {
    const key = number.toString(16).padStart(64, '0');
    const filename = `Test - Part ${number} - ${voice}.wav`;
    fs.writeFileSync(path.join(directory, `${key}.json`), JSON.stringify({filename, book:'sherlock-holmes',entryTitle:poem.title,kind:'poem',provider:'gemini',voice,model}));
    const wav = Buffer.alloc(44 + 48000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000,24); wav.writeUInt32LE(48000,28); wav.writeUInt16LE(2,32);
    wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
    fs.writeFileSync(path.join(directory, `${key}.wav`), wav);
}
async function run() {
    const port = await new Promise((resolve,reject) => {
        const timer=setTimeout(()=>reject(new Error('Server startup timeout')),10000);
        child.stdout.once('data',data=>{clearTimeout(timer);resolve(Number(data.toString().trim()));});
        child.once('exit',code=>reject(new Error(`Server exited ${code}`)));
    });
    recording(1,'Gacrux','saved-model-a');
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const pages=[],errors=[];
    for (let i=0;i<2;i++) {
        const context=await browser.newContext();
        const page=await context.newPage(); pages.push(page);
        page.on('pageerror',e=>errors.push(e.message)); page.setDefaultTimeout(10000);
        await page.route('**/api/chat/**',route=>route.fulfill({json:{data:[{id:'test'}]}}));
        await page.route('**/api/tts/voices',route=>route.fulfill({json:{voices:{},roles:{}}}));
        await page.route('**/api/tts/jobs',route=>{submissions++; submittedParts = route.request().postDataJSON().parts; return route.fulfill({json:{id:'mock-done',state:'done',total:submittedParts.length,completed:submittedParts.length,reused:0}});});
        await page.route('**/poem-images/manifest.json',route=>route.fulfill({json:fs.existsSync(path.join(directory,'poem-images/manifest.json'))?JSON.parse(fs.readFileSync(path.join(directory,'poem-images/manifest.json'))):{}}));
        await page.route('**/poem-images/assets/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1kAAAAASUVORK5CYII=','base64')}));
        await page.goto(`http://127.0.0.1:${port}/index.html?book=sherlock-holmes`);
        await page.waitForFunction(()=>window.Reader?.active);
        await page.evaluate(()=>openPoemModal(allPoems[0]));
        await page.waitForFunction(()=>document.querySelector('#readerSavedSelect').options.length===1);
    }
    await pages[1].evaluate(()=>{ttsProvider.value='gemini';ttsProvider.dispatchEvent(new Event('change'));});
    await pages[1].waitForFunction(()=>document.querySelector('#readerSavedSelect').options.length===1);
    assert.equal(await pages[0].locator('#readerSavedSelect').inputValue(),await pages[1].locator('#readerSavedSelect').inputValue());
    await pages[1].evaluate(()=>{ void Reader.generateSelected(false); });
    await pages[1].waitForSelector('#readerDuplicateWarning[open]');
    assert.match(await pages[1].locator('#readerDuplicateMessage').textContent(), /already has 1 saved recording/);
    assert.equal(submissions,0);
    await pages[1].locator('#readerDuplicateSaved').click();
    assert.equal(submissions,0);
    await pages[1].evaluate(()=>{ void Reader.generateSelected(false); });
    await pages[1].waitForSelector('#readerDuplicateWarning[open]');
    await pages[1].locator('#readerDuplicateContinue').click();
    await pages[1].waitForFunction(()=>document.querySelector('#readerGenerationCounts').textContent.includes('done'));
    assert.equal(submissions,1);
    // Range generation skips saved parts, including gaps, without the chapter warning.
    const requests = await pages[1].evaluate(() => Reader.capture().requests);
    assert(requests.length > 3);
    await pages[1].route('**/api/tts/availability', route => route.fulfill({json:{parts: requests.map((_, i) => ({saved: i === 0 || i === 2, url: i === 0 || i === 2 ? '/saved.wav' : null}))}}));
    await pages[1].evaluate(async () => { poemAudioPart.value = '1'; await Reader.generateSelected(true); });
    assert.equal(submissions,2);
    assert.deepEqual(submittedParts, requests.filter((_, i) => i >= 1 && i !== 2));
    assert.equal(await pages[1].locator('#readerDuplicateWarning').evaluate(el => el.open), false);
    // An entirely saved range plays existing audio without submitting a job.
    await pages[1].route('**/api/tts/availability', route => route.fulfill({json:{parts: requests.map(() => ({saved:true,url:'/saved.wav'}))}}));
    await pages[1].evaluate(async () => { await Reader.generateSelected(true); });
    assert.equal(submissions,2);

    recording(2,'Charon','saved-model-b');
    // Both open clients discover new server files without a reload or a local generation job.
    await Promise.all(pages.map(p=>p.waitForFunction(()=>document.querySelector('#readerSavedSelect').options.length===2,{},{timeout:22000})));
    await pages[1].locator('#readerSavedSelect').selectOption({index:1});
    await pages[1].locator('#readerSavedPlay').click();
    await pages[1].waitForFunction(()=>document.querySelector('audio#poemAudioPlayer')?.getAttribute('src')?.includes('0000000002/'));
    assert.match(await pages[1].locator('#readerSavedDownload').getAttribute('href'), /download=1/);
    assert.deepEqual(await pages[1].locator('#readerPlaybackSpeed option').evaluateAll(options=>options.map(o=>o.value)), ['0.8','0.9','1','1.2','1.4']);
    await pages[1].locator('#readerPlaybackSpeed').selectOption('1.2');
    assert.equal(await pages[1].evaluate(()=>poemAudioPlayer.playbackRate),1.2);
    await pages[1].reload();
    await pages[1].waitForFunction(()=>window.Reader?.active);
    assert.equal(await pages[1].evaluate(()=>poemAudioPlayer.playbackRate),1.2);
    const page=pages[0];
    const before=await page.locator('.poem-line-text').allTextContents();
    const query=before.join(' ').match(/\b[a-zA-Z]{5,}\b/)[0];
    await page.locator('#readerFind').fill(query);
    assert(await page.locator('.reader-find-match').count()>0);
    await page.locator('#readerFindNext').click();
    assert.equal(await page.locator('.reader-find-match.is-current').count(),1);
    await page.locator('#readerFind').fill('[.*]');
    assert.equal(await page.locator('#readerFindCount').textContent(),'No matches');
    await page.locator('#readerFindClear').click();
    assert.deepEqual(await page.locator('.poem-line-text').allTextContents(),before);
    await page.locator('.reader-shell-bar [data-reader-part-lines]').uncheck();
    assert.equal(await page.locator('.narration-part-marker:visible').count(),0);
    await page.evaluate(async()=>{
        currentChatSession.images.push({prompt:'A shared scene',style:'Ink',filename:'test-shared.png',status:'done'});
        savePoemSession(currentPoem,currentChatSession);
        await refreshSharedImages();
    });
    await pages[1].evaluate(()=>refreshSharedImages());
    assert.equal(await pages[1].locator('.poem-image-card').count(),1);
    await pages[1].goto(`http://127.0.0.1:${port}/images.html`);
    await pages[1].waitForSelector('#managerGrid .image-library-card');
    assert.equal(await pages[1].locator('#managerGrid .image-library-card').count(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS: cross-client audio and images, gallery, automatic refresh, playback, download, literal search, and unchanged text.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    await browser?.close(); child.kill(); fs.rmSync(directory,{recursive:true,force:true});
});
