const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
    constructor() { this.children = []; this.attributes = {}; this.dataset = {}; this.classList = { toggle() {} }; }
    insert(node, index) {
        if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
        this.children.splice(index, 0, node); node.parent = this;
    }
    append(...nodes) { for (const node of nodes) this.insert(node, this.children.length); }
    before(node) { this.parent.insert(node, this.parent.children.indexOf(this)); }
    after(node) { this.parent.insert(node, this.parent.children.indexOf(this) + 1); }
    setAttribute(key, value) { this.attributes[key] = value; }
    focus() { this.focused = true; }
}
const nodes = Object.fromEntries(['poemImages', 'chatPanel', 'poemPanel'].map(id => [id, new Element()]));
const layout = new Element(), body = new Element();
layout.append(nodes.poemPanel, nodes.chatPanel); nodes.poemPanel.append(body); body.append(nodes.poemImages);
const tabs = ['read', 'visualize', 'discuss', 'combo'].map(name => { const el = new Element(); el.dataset.modalTab = name; return el; });
let starts = 0, stops = 0;
const context = {
    document: { getElementById: id => nodes[id], createElement: () => new Element(), createComment: () => new Element() },
    modalContentElement: { dataset: {}, querySelector: () => layout },
    currentPoem: {}, modalTabs: tabs,
    startReadingFollowTracking: () => starts++, stopReadingFollowTracking: () => stops++,
};
vm.createContext(context);
const source = fs.readFileSync('app.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('let comboLayout = null;'), source.indexOf('// Mobile browser chrome')), context);
context.setModalTab('combo', true);
const rail = layout.children.find(el => el.id === 'comboRail');
assert.equal(rail.hidden, false);
assert.deepEqual(rail.children, [nodes.poemImages], 'Combo reuses the original images without discussion');
assert.equal(nodes.poemPanel.attributes['aria-labelledby'], 'comboTab modalTitle');
assert.equal(nodes.chatPanel.parent, layout, 'Discussion stays outside Combo');
assert.equal(tabs[3].attributes['aria-selected'], 'true');
assert.equal(tabs[3].focused, true);
assert.equal(starts, 1, 'Follow Text stays available in Combo');
assert.equal(stops, 0);
context.setModalTab('visualize');
assert.equal(rail.hidden, true);
assert.equal(nodes.poemImages.parent, body, 'Visualize restores the original image panel');
assert.equal(nodes.chatPanel.parent, layout);

assert.equal(stops, 1);
context.setModalTab('combo');
context.setModalTab('discuss');
assert.equal(rail.children.length, 0, 'Repeated switching leaves no duplicate panels');
context.currentPoem.discussionScope = 'collection';
context.setModalTab('combo');
assert.equal(context.modalContentElement.dataset.modalTab, 'discuss', 'Collection discussion remains on its dedicated tab');
console.log('PASS: Combo panel reuse, restoration, accessibility, focus, and Follow Text.');
