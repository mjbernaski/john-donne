'use strict';
const el = id => document.getElementById(id);
let catalog = null, excerpt = null, busy = false, savedComparison = null;
async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}
function voiceFor(id) { return catalog?.voices.find(v => v.id === el(id).value); }
function controls() {
    const ready = !!catalog?.voices.length && !!excerpt && !busy;
    for (const id of ['faust', 'mephistopheles', 'model']) el(id).disabled = busy || !catalog;
    el('flash').disabled = !ready || !catalog.models.some(m => m.id === 'eleven_flash_v2_5');
    el('v4').disabled = !ready || !el('model').value;
    el('previewFaust').disabled = !voiceFor('faust')?.previewUrl || busy;
    el('previewMephistopheles').disabled = !voiceFor('mephistopheles')?.previewUrl || busy;
    if (excerpt) {
        el('flashCost').textContent = `Estimated base cost: $${(excerpt.characters * .04 / 1000).toFixed(3)} for ${excerpt.characters} characters.`;
        const rate = el('model').value.includes('turbo') ? .04 : .08;
        el('v4Cost').textContent = el('model').value ? `Estimated base cost: $${(excerpt.characters * rate / 1000).toFixed(3)}. Saved samples are reused.` : 'v4 is not available in the account’s model catalog.';
    }
}
function pauseAudio() { document.querySelectorAll('audio').forEach(audio => audio.pause()); }
function preview(id) {
    const voice = voiceFor(id);
    if (!voice?.previewUrl) return;
    pauseAudio(); el('preview').src = voice.previewUrl; el('preview').hidden = false;
    el('preview').play().catch(() => {});
}
function renderVoices() {
    const query = el('search').value.toLowerCase();
    const voices = (catalog?.voices || []).filter(v => `${v.name} ${v.description} ${Object.values(v.labels).join(' ')}`.toLowerCase().includes(query));
    el('count').textContent = `${voices.length} account voices`;
    el('voiceList').replaceChildren(...voices.map(v => {
        const card = document.createElement('article');
        const name = document.createElement('h3'); name.textContent = v.name;
        const description = document.createElement('p'); description.textContent = v.description || Object.values(v.labels).join(' · ');
        card.append(name, description);
        for (const [id, label] of [['faust', 'Use for Faust'], ['mephistopheles', 'Use for Mephistopheles']]) {
            const button = document.createElement('button'); button.textContent = label;
            button.onclick = () => { if (busy) return; el(id).value = v.id; resetSamples(); controls(); };
            card.append(button);
        }
        return card;
    }));
}
function showSavedSamples() {
    if (!savedComparison || savedComparison.cast.FAUST !== el('faust').value
        || savedComparison.cast.MEPHISTOPHELES !== el('mephistopheles').value) return;
    for (const sample of savedComparison.samples) {
        const id = sample.model === 'eleven_flash_v2_5' ? 'flashAudio'
            : sample.model === el('model').value ? 'v4Audio' : null;
        if (id) { el(id).src = sample.url; el(id).hidden = false; }
    }
}
function resetSamples() {
    pauseAudio();
    for (const id of ['flashAudio', 'v4Audio']) { el(id).hidden = true; el(id).removeAttribute('src'); }
    el('generationStatus').textContent = '';
    showSavedSamples();
}
async function loadCatalog() {
    el('status').textContent = 'Loading account voices…'; el('retry').disabled = true;
    try {
        catalog = await api('/api/elevenlabs/catalog');
        for (const [id, defaultName] of [['faust', 'George'], ['mephistopheles', 'Adam']]) {
            const previous = el(id).value;
            el(id).replaceChildren(...catalog.voices.map(v => new Option(`${v.name} · ${v.labels.accent || v.category || 'voice'}`, v.id)));
            el(id).value = catalog.voices.find(v => v.id === previous)?.id || catalog.voices.find(v => v.name.startsWith(defaultName))?.id || catalog.voices[0]?.id || '';
        }
        const models = catalog.models.filter(m => /^eleven_v4(?:_[a-z0-9]+)*$/.test(m.id));
        el('model').replaceChildren(...models.map(m => new Option(m.name, m.id)));
        el('status').textContent = `${catalog.voices.length} voices loaded. Choose the cast and generate one sample at a time.`;
        renderVoices();
        try { savedComparison = await api('/faust-comparison/comparison.json'); showSavedSamples(); }
        catch { /* No prepared comparison has been saved yet. */ }
    } catch (error) { catalog = null; el('status').textContent = error.message; }
    finally { el('retry').disabled = false; controls(); }
}
async function generate(which) {
    if (busy || !catalog || !excerpt) return;
    busy = true; controls(); pauseAudio();
    const cast = { FAUST: el('faust').value, MEPHISTOPHELES: el('mephistopheles').value };
    const model = which === 'flash' ? 'eleven_flash_v2_5' : el('model').value;
    el('generationStatus').textContent = 'Preparing sample… This may take a minute.';
    try {
        const result = await api('/api/elevenlabs/faust-audition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, cast }) });
        const audio = el(which + 'Audio'); audio.src = result.url; audio.hidden = false;
        el('generationStatus').textContent = result.reused ? 'Loaded the saved sample. No new generation.' : 'Sample saved. Press Play to listen.';
    } catch (error) { el('generationStatus').textContent = error.message; }
    finally { busy = false; controls(); }
}
el('retry').onclick = loadCatalog;
el('search').oninput = renderVoices;
el('flash').onclick = () => generate('flash'); el('v4').onclick = () => generate('v4');
el('previewFaust').onclick = () => preview('faust'); el('previewMephistopheles').onclick = () => preview('mephistopheles');
for (const id of ['faust', 'mephistopheles', 'model']) el(id).onchange = () => { resetSamples(); controls(); };
api('/api/elevenlabs/faust-scene').then(data => {
    excerpt = data; el('excerptInfo').textContent = `${data.title} · ${data.characters} spoken characters`;
    el('excerpt').textContent = data.turns.map(t => `${t.speaker}\n${t.text}`).join('\n\n'); controls();
}).catch(error => { el('excerptInfo').textContent = error.message; });
void loadCatalog();
