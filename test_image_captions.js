const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('app.js', 'utf8');
let calls = 0, saves = 0;
const session = {}, image = { filename: 'poem-images/assets/test.png', scene: 'A confrontation.' };
const sentence = 'Dolly confronts her husband Oblonsky after discovering his betrayal, while his involuntary smile deepens her anger and distress.';
const context = {
    console, currentChatSession: session,
    getPoemId: () => 'abc', imageIdentity: i => i.filename,
    getSceneSource: () => ({ context: 'Anna Karenina', text: 'Dolly discovers the letter.' }),
    getSavedImageScene: i => i.scene, resolveModel: async () => 'vision-model',
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,aA=='; this.onload(); } },
    fetch: async (url, options) => {
        if (options) { assert.equal(JSON.parse(options.body).caption, sentence); return { ok: true }; }
        return { blob: async () => ({}) };
    },
    requestModelJson: async (url, options) => {
        calls++;
        const body = JSON.parse(options.body);
        assert.equal(body.chat_template_kwargs.enable_thinking, false);
        assert.equal(body.max_tokens, 12288);
        assert.equal(body.messages[1].content[1].type, 'image_url');
        assert(body.messages[1].content[0].text.includes('Dolly discovers'));
        return { choices: [{ message: { content: sentence }, finish_reason: 'stop' }] };
    },
    responseText: s => s, savePoemSession: () => saves++, renderPoemImages: () => {},
    setPoemImagesStatus: message => { throw new Error(message); }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const imageCaptionRequests ='), source.indexOf('const expandedImagePrompts =')), context);
(async () => {
    context.ensureImageSceneCaption({}, session, image, 'blob:test');
    context.ensureImageSceneCaption({}, session, image, 'blob:test');
    await vm.runInContext('imageCaptionQueue', context);
    assert.equal(calls, 1);
    assert.equal(saves, 1);
    assert.equal(image.caption, sentence);
    assert.equal(image.captionVersion, 'vision-scene-v1');
    const labeled = { ...image, filename: 'poem-images/assets/labeled.png', nameLabels: true, prompt: 'Dolly at left, Oblonsky at right.' };
    const labels = [{name: 'Dolly', x: 0.2, y: 0.8, targetX: 0.25, targetY: 0.5}];
    context.requestModelJson = async (url, options) => {
        const body = JSON.parse(options.body);
        assert(body.messages[0].content.includes('targetX'));
        assert(body.messages[1].content[0].text.includes(labeled.prompt));
        return {choices: [{message: {content: JSON.stringify({caption: sentence, labels})}, finish_reason: 'stop'}]};
    };
    context.ensureImageSceneCaption({}, session, labeled, 'blob:labeled');
    await vm.runInContext('imageCaptionQueue', context);
    assert.equal(labeled.labelVersion, 'vision-labels-v1');
    assert.equal(JSON.stringify(labeled.labels), JSON.stringify(labels));
    // A saved preference must also label older images with finished captions.
    context.imageNameLabels = { checked: true };
    const older = { ...image, filename: 'poem-images/assets/older.png' };
    let attempts = 0;
    context.setPoemImagesStatus = () => {};
    context.requestModelJson = async () => {
        attempts++;
        if (attempts === 1) throw new Error('Temporary model failure');
        return { choices: [{ message: { content: JSON.stringify({caption: sentence, labels}) }, finish_reason: 'stop' }] };
    };
    context.ensureImageSceneCaption({}, session, older, 'blob:older');
    await vm.runInContext('imageCaptionQueue', context);
    assert.equal(older.nameLabels, true);
    assert.equal(older.labelVersion, undefined);
    context.ensureImageSceneCaption({}, session, older, 'blob:older');
    await vm.runInContext('imageCaptionQueue', context);
    assert.equal(attempts, 2, 'Failed labeling can retry on the next render');
    assert.equal(JSON.stringify(older.labels), JSON.stringify(labels));
    console.log('PASS: vision input, reasoning budget, source context, saved caption, duplicate suppression, second-pass label plan');
})().catch(error => { console.error(error); process.exitCode = 1; });
