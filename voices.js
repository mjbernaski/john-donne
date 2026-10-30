const grid = document.getElementById('voicesGrid');
const status = document.getElementById('voicesStatus');
const sample = 'No man is an island, entire of itself. Every man is a piece of the continent, a part of the main.';
const accountPreviews = new Map();
const voices = [['feminine', 'Rachel'], ['masculine', 'George'], ['companion', 'Adam']];
document.getElementById('voiceSampleText').textContent = sample;
function render() {
    let selected = 'masculine';
    try { selected = localStorage.getItem('john-donne-elevenlabs-reading-voice') || selected; } catch {}
    document.getElementById('voiceRoles').textContent = `Reading voice: ${voices.find(([id]) => id === selected)?.[1] || 'George'}`;
    grid.replaceChildren();
    for (const [id, name] of voices) {
        const card = document.createElement('article'); card.className = 'voice-card';
        const title = document.createElement('h2'); title.textContent = name;
        const note = document.createElement('p'); note.className = 'voice-card-note'; note.textContent = 'ElevenLabs';
        const actions = document.createElement('div'); actions.className = 'voice-card-actions';
        const preview = document.createElement('button'); preview.className = 'voice-play'; preview.textContent = 'Preview';
        preview.onclick = () => {
            if (accountPreviews.has(id)) {
                LocalSpeech.stop();
                const audio = document.getElementById('accountVoicePreview') || document.createElement('audio');
                audio.id = 'accountVoicePreview'; audio.controls = true; audio.src = accountPreviews.get(id);
                card.append(audio); audio.play().catch(() => {});
            } else LocalSpeech.play(sample, id, status, 'elevenlabs');
        };
        const choose = document.createElement('button'); choose.className = 'voice-play';
        choose.textContent = selected === id ? 'Selected' : 'Use this voice'; choose.disabled = selected === id;
        choose.onclick = () => {
            try { localStorage.setItem('john-donne-elevenlabs-reading-voice', id); } catch {
                status.textContent = 'Voice could not be saved in this browser.'; return;
            }
            render();
        };
        actions.append(preview, choose); card.append(title, note, actions); grid.append(card);
    }
}
const pause = document.getElementById('voicesPause');
const stop = document.getElementById('voicesStop');
window.addEventListener('speechstatechange', () => {
    pause.hidden = stop.hidden = LocalSpeech.state === 'idle';
    pause.textContent = LocalSpeech.state === 'paused' ? 'Resume' : 'Pause';
});
pause.onclick = () => LocalSpeech.state === 'paused' ? LocalSpeech.resume() : LocalSpeech.pause();
stop.onclick = () => LocalSpeech.stop();
status.textContent = 'ElevenLabs · choose a voice or play a short preview.';
render();

fetch('/api/elevenlabs/catalog').then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Account voices could not be loaded.');
    for (const voice of data.voices) {
        const id = `eleven:${voice.id}`;
        voices.push([id, voice.name]);
        if (voice.previewUrl) accountPreviews.set(id, voice.previewUrl);
    }
    render();
    status.textContent = `${data.voices.length} account voices loaded, alongside the default voices.`;
}).catch(error => { status.textContent = error.message; });
