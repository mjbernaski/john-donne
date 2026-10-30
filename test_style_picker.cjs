const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const code = fs.readFileSync('app.js', 'utf8');
class Element {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.value = ''; this.scrollTop = 0; this.classList = { toggle() {} }; }
    replaceChildren() { this.children = []; }
    appendChild(child) { this.children.push(child); }
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) { this.events[name] = fn; }
    querySelectorAll() { return this.children; }
    get firstElementChild() { return this.children[0]; }
    focus() { context.document.activeElement = this; }
}
const context = { console, selectedStyleLabels: new Set(), currentPoem: {}, currentChatSession: {},
    IMAGE_STYLES_STORAGE: 'styles', localStorage: { getItem: () => '[]', setItem(key, value) { this.saved = value; } },
    getPoemImageCount: () => 3, renderPoemImages() {}, activeStyleCategory: 'All',
    document: { activeElement: null, createElement: () => new Element() }
};
for (const id of ['imageStyleOptions', 'imageSelectedStyles', 'imageStyleSearch', 'imageStyleCategories', 'imageStyleResults', 'imageStylesSummary', 'clearImageStyles']) context[id] = new Element();
for (const category of ['All', 'TV & animation', 'Artists', 'Techniques']) {
    const button = new Element(); button.dataset.styleCategory = category; context.imageStyleCategories.appendChild(button);
}
vm.createContext(context);
vm.runInContext(code.slice(code.indexOf('const VISUAL_STYLES = ['), code.indexOf('function getPoemAuthor(')), context);
vm.runInContext(code.slice(code.indexOf('function getSelectedStyles()'), code.indexOf('const IMAGE_DIRECTIONS =')), context);
const labels = () => Array.from(context.getVisibleVisualStyles(), s => s.label);
context.activeStyleCategory = 'TV & animation';
assert.equal(labels().length, 11);
context.renderStylePicker();
assert.equal(context.imageStyleOptions.children.length, 11);
context.imageStyleOptions.children.find(b => b.dataset.styleLabel === 'Samurai Jack').events.click();
assert.deepEqual([...context.selectedStyleLabels], ['Samurai Jack']);
assert.equal(context.imageSelectedStyles.children[0].dataset.removeStyle, 'Samurai Jack');
assert.equal(context.imageStyleOptions.children.find(b => b.dataset.styleLabel === 'Samurai Jack').attributes['aria-pressed'], 'true');
context.activeStyleCategory = 'Artists'; context.imageStyleSearch.value = 'adams'; context.renderStylePicker();
assert.deepEqual(labels(), ['Ansel Adams']);
context.imageStyleOptions.children[0].events.click();
assert.deepEqual(Array.from(context.getSelectedStyles(), s => s.label), ['Ansel Adams', 'Samurai Jack']);
assert.equal(context.imageSelectedStyles.children.length, 2, 'Selections remain visible across category filters');
context.imageStyleSearch.value = 'no-such-style'; context.renderStylePicker();
assert.equal(context.imageStyleOptions.children.length, 0);
assert.match(context.imageStyleResults.textContent, /No styles match/);
assert.equal(context.getSelectedStyles().length, 2, 'Search does not change the selected generation pool');
context.imageSelectedStyles.children.find(b => b.dataset.removeStyle === 'Ansel Adams').events.click();
assert.deepEqual([...context.selectedStyleLabels], ['Samurai Jack']);
context.imageSelectedStyles.children[0].focus();
context.imageSelectedStyles.children[0].events.click();
assert.equal(context.document.activeElement, context.imageStyleSearch, 'Removing the last chip restores a usable focus target');
assert.equal(context.getSelectedStyles().length, 47, 'An empty mix restores all styles');
assert.equal(context.localStorage.saved, '[]');
context.localStorage.getItem = () => '["Scooby Doo","Raphael","Old deleted style"]';
context.restoreSelectedStyles();
assert.deepEqual(Array.from(context.getSelectedStyles(), s => s.label), ['Scooby Doo', 'Raphael'], 'Saved mixes retain supported styles');
console.log('PASS: TV categories, search, mixed selections, selected cards, removal, focus, reset, and saved preferences.');
