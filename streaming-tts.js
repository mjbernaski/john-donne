// Schedule arriving 24 kHz PCM buffers immediately; keep byte boundaries intact.
let livePreview = null;
async function streamLocalSpeech(input, voice, note) {
    if (livePreview) {
        livePreview.controller.abort();
        await livePreview.context.close();
    }
    const context = new AudioContext({ sampleRate: 24000 });
    const controller = new AbortController();
    const preview = { context, controller };
    livePreview = preview;
    try {
        await context.resume();
        note.textContent = 'Streaming…';
        const response = await fetch('/api/tts/stream', {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input, voice, response_format: 'pcm' })
        });
        if (!response.ok) throw new Error((await response.json()).error || `Speech failed (${response.status})`);
        const reader = response.body.getReader();
        let nextTime = context.currentTime + 0.08;
        let pending = new Uint8Array(0);
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const bytes = new Uint8Array(pending.length + value.length);
            bytes.set(pending); bytes.set(value, pending.length);
            const count = Math.floor(bytes.length / 2);
            pending = bytes.slice(count * 2);
            if (!count) continue;
            const buffer = context.createBuffer(1, count, 24000);
            const samples = buffer.getChannelData(0);
            const view = new DataView(bytes.buffer);
            for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
            const source = context.createBufferSource();
            source.buffer = buffer; source.connect(context.destination);
            nextTime = Math.max(nextTime, context.currentTime + 0.02);
            source.start(nextTime); nextTime += buffer.duration;
        }
        if (pending.length) throw new Error('Speech ended with incomplete audio.');
        const delay = Math.max(0, (nextTime - context.currentTime) * 1000);
        setTimeout(() => {
            if (livePreview === preview) {
                context.close(); livePreview = null; note.textContent = 'Stream finished';
            }
        }, delay);
    } catch (error) {
        if (error.name !== 'AbortError') note.textContent = error.message;
        if (livePreview === preview) {
            await context.close(); livePreview = null;
        }
    }
}

function stopLocalSpeech() {
    if (!livePreview) return;
    livePreview.controller.abort(); livePreview.context.close(); livePreview = null;
}
window.LocalSpeech = { play: streamLocalSpeech, stop: stopLocalSpeech };
window.addEventListener('pagehide', stopLocalSpeech);
