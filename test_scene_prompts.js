// Run with node test_scene_prompts.js. No model or image generation is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const code = read('app.js');
const manifest = JSON.parse(read('books.json'));
const chapter = JSON.parse(read('poems-anna-karenina.json'))[0];
const book = manifest.books.find(item => item.id === 'anna-karenina');
const requests = [];
let responses = [];
const context = {
    AbortController, setTimeout, clearTimeout,
    currentBook: book,
    cleanPoemContent: text => text.trim(),
    getPoemAuthor: () => 'Leo Tolstoy',
    isBriefMode: () => false,
    resolveModel: async () => 'test-model',
    CHAT_PROXY_URL: '/api/chat',
    fetch: async (url, options) => {
        requests.push(JSON.parse(options.body));
        assert(responses.length, 'Unexpected extra model request');
        const content = responses.shift();
        return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
    },
};
vm.createContext(context);
for (const [start, end] of [
    ['function buildPoemSystemPrompt(', 'function setChatStatus('],
    ['function getSavedImageScene(', '// The visual styles a reader'],
    ['const IMAGE_DIRECTIONS =', 'async function fluxFetch('],
]) {
    vm.runInContext(code.slice(code.indexOf(start), code.indexOf(end)), context);
}

async function run() {
    const source = context.getSceneSource(chapter);
    assert.equal(source.text, chapter.content.replace(/\s+/g, ' ').trim());
    assert(source.text.length > 1400);
    assert(source.context.includes('Anna Karenina'));
    assert(source.context.includes('Part One · Chapter I'));
    const scene = 'Stepan Arkadyich Oblonsky stands in his wife Dolly’s bedroom, fully dressed after returning from the theatre. Dolly holds the discovered letter with its markings turned away. His involuntary smile meets her anger.';
    responses = ['A generic romantic couple.', '{"grounded":false,"reason":"Show the specific Oblonsky household event, not a generic romance."}', scene, '{"grounded":true,"reason":"The chapter describes the remembered discovery and smile."}'];
    assert.equal(await context.describePoemScene(chapter, context.getImageDirection(0), ''), scene);
    assert.equal(requests.length, 4);
    assert(requests[0].messages[1].content.includes(source.text));
    assert(requests[0].messages[0].content.includes('Letters, books, and other narrative props are allowed'));
    assert(!requests[0].messages[0].content.includes('make them one man and one woman'));
    assert(requests[2].messages[1].content.includes('Show the specific Oblonsky household event'));
    assert.equal(JSON.parse(requests[1].messages[1].content).chapter, source.text);
    const prompts = context.getImagePrompts(chapter, [scene], 0, [{ label: 'Oil painting', prompt: 'Oil painting.' }], '');
    assert(prompts[0].prompt.includes(scene));
    assert(!prompts[0].prompt.includes('Any couple is one man and one woman'));
    assert(!prompts[0].prompt.includes('strongest symbolic image'));
    assert(prompts[0].prompt.includes('Preserve the specified people'));
    const oldImage = { scene: 'A couple with a swan on a riverbank.', prompt: 'Interpret its governing figure of speech.' };
    const newImage = { scene, sceneMode: 'chapter-scene-v1' };
    assert.equal(context.isChapterSceneImage(oldImage), false);
    assert.equal(context.isChapterSceneImage(newImage), true);
    assert.equal(context.isChapterSceneImage(prompts[0]), true);
    assert.deepEqual(Array.from(context.getPreviousImageScenes([oldImage, newImage])), [scene]);

    // Repeating a previously illustrated scene must not trigger a diversity gate.
    const variations = Array.from({length: 16}, (_, i) => context.getSceneVariation(source, i));
    assert.equal(new Set(variations).size, 16, 'Different framing and passage focus across successive batches');
    assert(variations.every(v => v.includes('Reader direction takes precedence')));
    const repeatStart = requests.length;
    responses = [scene, '{"grounded":true,"reason":"Supported by the chapter"}'];
    assert.equal(await context.describePoemScene(chapter, context.getImageDirection(0), '', [scene]), scene);
    assert.equal(requests.length - repeatStart, 2, 'Only planning and source grounding, no diversity rejection');
    assert(requests[repeatStart].messages[1].content.includes('revisiting any scene or perspective is allowed'));
    assert(context.getSceneRetryFocus(source, 1).includes('same characters and action may recur'));
    assert(requests[0].messages[0].content.includes('Explicitly describe the viewing position'));

    responses = ['unparseable review'];
    await assert.rejects(context.reviewChapterScene('test-model', source, scene, ''), /Could not verify/);
    responses = Array.from({ length: 3 }, () => ['generic scene', '{"grounded":false,"reason":"Wrong characters"}']).flat();
    await assert.rejects(context.describePoemScene(chapter, context.getImageDirection(0), ''), /Wrong characters/);
    assert.equal(responses.length, 0);
    const discussion = context.buildPoemSystemPrompt(chapter);
    assert(discussion.includes('SELECTED CHAPTER'));
    assert(discussion.includes('visibly depicted from inferred character identities'));
    assert(discussion.includes('Before assigning an image to a different chapter or canto'));
    assert(discussion.includes('generation prompt describes intent, not proof'));
    assert(discussion.includes('Distinguish an inaccurate detail within the correct scene'));
    assert(discussion.includes(chapter.content.replace(/\n{2,}/g, '\n\n')));

    context.currentBook = manifest.books.find(item => item.id === 'donne');
    assert.equal(context.getPreviousImageScenes([oldImage, newImage]).length, 2);
    assert.equal(context.getSceneSource(chapter).text.length, 1400);
    assert(context.getImageDirection(0).includes('symbolic image'));

    context.currentBook = manifest.books.find(item => item.userPoems);
    const essay = JSON.parse(read('user-poems.json')).find(item => item.content.includes('TypeSafe ai'));
    const essaySource = context.getSceneSource(essay);
    assert.equal(essaySource.text, essay.content.replace(/\s+/g, ' ').trim());
    assert(essaySource.text.includes('Radiologist'));
    const editorial = 'Separate research and product workspaces connect to a coding agent routing tasks through many small fast decision units and a larger reasoning system.';
    const essayStart = requests.length;
    responses = ['A couple across a ravine with gulls.', '{"grounded":false,"reason":"Unrelated romance and scenery; depict AI research and decision systems."}', editorial, '{"grounded":true,"reason":"Shows the institutional split and System 1/System 2 architecture."}'];
    assert.equal(await context.describePoemScene(essay, context.getImageDirection(0), ''), editorial);
    assert(requests[essayStart].messages[0].content.includes('actual genre'));
    assert(!requests[essayStart].messages[0].content.includes('one man and one woman'));
    assert(requests[essayStart + 1].messages[0].content.includes('For nonfiction'));
    const essayPrompt = context.getImagePrompts(essay, [editorial], 0, [{ label: 'Oil painting', prompt: 'Oil painting.' }], '')[0].prompt;
    assert(!essayPrompt.includes('period dress'));
    assert(!essayPrompt.includes('Any couple'));
    assert(!essayPrompt.includes('natural world'));

    for (const dante of manifest.books.filter(item => item.id.startsWith('dante-'))) {
        context.currentBook = dante;
        const canto = JSON.parse(read(dante.poems))[0];
        const source = context.getSceneSource(canto);
        assert(source.chapter, dante.id);
        assert.equal(source.text, canto.content.replace(/\s+/g, ' ').trim());
        assert(source.text.length > 1400);
        const focus = context.getSceneRetryFocus(source, 2);
        assert(focus.includes(source.text.split(/\s+/).slice(-20).join(' ')));
        const start = requests.length;
        responses = ['A scene with the pilgrim and his guide.', '{"grounded":true,"reason":"Supported by the canto"}'];
        await context.describePoemScene(canto, context.getImageDirection(0), '');
        assert(!requests[start].messages[0].content.includes('make them one man and one woman'));
        assert(requests[start].messages[1].content.includes(source.text));
    }

    vm.runInContext(code.slice(code.indexOf('async function generatePoemImageSet('), code.indexOf('function saveFluxApiKey(')), context);
    async function checkPartialPlan(accepted, switchCollection = false, count = 3) {
        const session = { images: [] };
        const submitted = [];
        let planned = 0;
        Object.assign(context, {
            currentBook: book, currentPoem: chapter, currentChatSession: session,
            generateImages: { disabled: false }, stopImages: { hidden: true, disabled: false }, console: { warn() {} },
            getFluxStatus: async () => ({}), getPoemImageCount: () => 3,
            getSelectedStyles: () => [{ label: 'Oil painting', prompt: 'Oil painting.' }],
            getSteerText: () => '', setPoemImagesStatus: () => {},
            renderPoemImages: () => {}, savePoemSession: () => {}, pollPoemImageJobs: () => {},
            describePoemScene: async () => {
                assert.equal(submitted.length, Math.min(planned, accepted), 'Submit each approved scene before planning the next');
                if (planned++ < accepted) return scene;
                if (switchCollection) context.currentPoem = {};
                const error = new Error('Repeated leopard scene');
                error.code = 'SCENE_PLANNING_EXHAUSTED';
                throw error;
            },
            submitFluxImage: async prompt => { submitted.push(prompt); return 'job-1'; }
        });
        await context.generatePoemImageSet(count === 1 ? { count: 1 } : undefined);
        assert.equal(submitted.length, accepted);
        assert.equal(session.images.length, accepted);
        if (accepted && accepted < count) assert(session.imagePlanningNotice.includes(`Planned ${accepted} of ${count}`));
        assert.equal(session.imagesLoading, Boolean(accepted));
        assert.equal(session.imagePlanningActive, false);
    }
    await checkPartialPlan(1);
    await checkPartialPlan(0);
    await checkPartialPlan(1, true);
    await checkPartialPlan(3);
    await checkPartialPlan(1, false, 1);

    vm.runInContext(code.slice(code.indexOf('function completeImageJob('), code.indexOf('async function reconcilePoemImageJobs(')), context);
    for (const stillPlanning of [true, false]) {
        const session = { images: [{ jobId: 'job-1', status: 'queued' }], imagePlanningActive: stillPlanning };
        Object.assign(context, {
            currentChatSession: session, wait: async () => {},
            getFluxStatus: async () => ({ recent_done: [{ id: 'job-1', state: 'done', images: [{ filename: 'first.png' }] }] })
        });
        await context.pollPoemImageJobs(chapter, session);
        assert.equal(session.images[0].status, 'done');
        assert.equal(session.imagesLoading, stillPlanning, 'A completed render must not clear active planning');
        assert.equal(session.imagePollActive, false);
    }
    console.log('PASS: prompt submission precedes next planning call, completed renders retain planning state, submitted images survive later rejection, full-canto fidelity and retries');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
