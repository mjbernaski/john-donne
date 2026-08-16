const statusElement = document.getElementById('voicesStatus');
const grid = document.getElementById('voicesGrid');
const rolesList = document.getElementById('voiceRoles');
const sampleTextElement = document.getElementById('voiceSampleText');
const prepareButton = document.getElementById('voicesPrepare');
const refreshButton = document.getElementById('voicesRefresh');
const player = document.getElementById('voicePlayer');

const ROLE_LABELS = {
    feminine: 'Poem · feminine',
    masculine: 'Poem · masculine',
    companion: 'Companion replies'
};

let catalog = { voices: [], roles: {}, defaults: {}, sampleText: '' };
// Samples are fetched once per visit and kept as object URLs, so replaying a
// voice while comparing it against another costs nothing.
const sampleUrls = new Map();
let preparing = false;

function setStatus(message) {
    statusElement.textContent = message;
}

async function loadVoices() {
    refreshButton.disabled = true;
    setStatus('Loading voices…');
    try {
        const response = await fetch('/api/tts/voices', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
        catalog = payload;
        sampleTextElement.textContent = (payload.sampleText || '').replace(/\n/g, ' / ');
        render();
    } catch (error) {
        setStatus(`Could not load the voices: ${error.message}`);
    } finally {
        refreshButton.disabled = false;
    }
}

function render() {
    renderRoles();
    grid.replaceChildren();
    catalog.voices.forEach(voice => grid.appendChild(voiceCard(voice)));
    const saved = catalog.voices.filter(voice => voice.sampled).length;
    setStatus(`${catalog.voices.length} voices · ${saved} sampled`);
    prepareButton.disabled = saved === catalog.voices.length;
}

function renderRoles() {
    rolesList.replaceChildren();
    Object.entries(ROLE_LABELS).forEach(([role, label]) => {
        const item = document.createElement('div');
        item.className = 'voice-role';
        const name = document.createElement('strong');
        name.textContent = catalog.roles[role] || '—';
        const caption = document.createElement('small');
        const isDefault = catalog.roles[role] === catalog.defaults[role];
        caption.textContent = `${label}${isDefault ? '' : ` · was ${catalog.defaults[role]}`}`;
        item.append(name, caption);
        rolesList.appendChild(item);
    });
}

function voiceCard(voice) {
    const card = document.createElement('article');
    card.className = 'voice-card';
    if (voice.roles.length) card.classList.add('is-assigned');

    const heading = document.createElement('div');
    heading.className = 'voice-card-heading';
    const name = document.createElement('strong');
    name.textContent = voice.name;
    const character = document.createElement('small');
    character.textContent = voice.character;
    heading.append(name, character);

    const note = document.createElement('p');
    note.className = 'voice-card-note';
    note.textContent = voice.roles.length
        ? `In use: ${voice.roles.map(role => ROLE_LABELS[role] || role).join(', ')}`
        : voice.sampled ? 'Sample saved' : 'No sample yet';

    const actions = document.createElement('div');
    actions.className = 'voice-card-actions';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'voice-play';
    play.textContent = voice.sampled ? 'Play' : 'Generate';
    play.addEventListener('click', () => playSample(voice, play, note));

    const assign = document.createElement('select');
    assign.className = 'voice-assign';
    assign.setAttribute('aria-label', `Assign ${voice.name} to a role`);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Use for…';
    assign.appendChild(placeholder);
    Object.entries(ROLE_LABELS).forEach(([role, label]) => {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = label;
        option.disabled = catalog.roles[role] === voice.name;
        assign.appendChild(option);
    });
    assign.addEventListener('change', () => {
        if (assign.value) assignVoice(voice, assign.value, note);
        assign.value = '';
    });

    actions.append(play, assign);
    card.append(heading, note, actions);
    return card;
}

async function playSample(voice, button, note) {
    if (sampleUrls.has(voice.name)) {
        player.src = sampleUrls.get(voice.name);
        player.play().catch(() => {});
        return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
        const response = await fetch('/api/tts/sample', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: voice.name })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `Sample failed (${response.status})`);
        }
        const url = URL.createObjectURL(await response.blob());
        sampleUrls.set(voice.name, url);
        voice.sampled = true;
        note.textContent = voice.roles.length ? note.textContent : 'Sample saved';
        button.textContent = 'Play';
        player.src = url;
        player.play().catch(() => {});
    } catch (error) {
        note.textContent = error.message;
        button.textContent = original;
    } finally {
        button.disabled = false;
    }
}

async function assignVoice(voice, role, note) {
    try {
        const response = await fetch('/api/tts/roles', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, voice: voice.name })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Assignment failed (${response.status})`);
        catalog.roles = payload.roles;
        catalog.voices.forEach(entry => {
            entry.roles = Object.entries(payload.roles)
                .filter(([, bound]) => bound === entry.name)
                .map(([boundRole]) => boundRole)
                .sort();
        });
        render();
    } catch (error) {
        note.textContent = error.message;
    }
}

async function prepareAll() {
    if (preparing) return;
    preparing = true;
    prepareButton.disabled = true;
    // One at a time: thirty simultaneous requests to Gemini would be rate limited,
    // and each is written to the shared library as it lands, so a stop midway keeps
    // everything already generated.
    const pending = catalog.voices.filter(voice => !voice.sampled);
    for (const [index, voice] of pending.entries()) {
        setStatus(`Generating sample ${index + 1} of ${pending.length}: ${voice.name}…`);
        try {
            const response = await fetch('/api/tts/sample', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice: voice.name })
            });
            if (!response.ok) throw new Error(`${response.status}`);
            sampleUrls.set(voice.name, URL.createObjectURL(await response.blob()));
            voice.sampled = true;
        } catch (error) {
            console.warn(`Could not sample ${voice.name}:`, error);
        }
    }
    preparing = false;
    render();
}

prepareButton.addEventListener('click', prepareAll);
refreshButton.addEventListener('click', loadVoices);
loadVoices();
