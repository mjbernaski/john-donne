// Keep each generation below the speech engine's output limit.
function splitStreamingText(input, limit = 850) {
    let remaining = String(input).replace(/\r\n?/g, '\n').trim();
    const parts = [];
    while (remaining.length > limit) {
        let split = 0;
        for (const boundary of [/\n[ \t]*\n+/g, /[.!?]["'”’»)\]]*\s+/g, /\n/g, /\s+/g]) {
            for (const match of remaining.matchAll(boundary)) {
                const end = match.index + match[0].trimEnd().length;
                if (end > limit) break;
                if (end > 0) split = end;
            }
            if (split) break;
        }
        split ||= limit;
        parts.push(remaining.slice(0, split).trim());
        remaining = remaining.slice(split).trim();
    }
    if (remaining) parts.push(remaining);
    return parts;
}
// Schedule arriving 24 kHz PCM buffers immediately; keep byte boundaries intact.
let livePreview = null;
let lastStream = null;
let speechContext = null;
// iPhone Safari needs the context unlocked by the original Listen tap.
// Retain it across parts instead of asking for permission from a finish timer.
function prepareLocalSpeech() {
    configureStreamingSession(null);
    if (!speechContext || speechContext.state === 'closed')
        speechContext = new AudioContext({ sampleRate: 24000 });
    speechContext.resume().catch(() => {});
    return speechContext;
}
function cancelPreview(preview) {
    clearInterval(preview.progressTimer);
    preview.controller.abort();
    for (const source of preview.sources) {
        try { source.stop(); } catch {}
        source.disconnect();
    }
    preview.sources.clear();
}
function streamingMediaState(state) {
    window.dispatchEvent?.(new Event('speechstatechange'));
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    try { navigator.mediaSession.playbackState = state; } catch {}
}
function configureStreamingSession(recording) {
    if (typeof navigator === 'undefined') return;
    // Safari uses this category to distinguish narration from incidental sound.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    if (!navigator.mediaSession) return;
    if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: recording?.title || 'Reading stream', artist: 'Reading Room'
        });
    }
    for (const [action, handler] of [['play', resumeLocalSpeech], ['pause', pauseLocalSpeech], ['stop', stopLocalSpeech]]) {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    }
}

async function streamLocalSpeech(input, voice, note, provider = 'elevenlabs', recording = null, onSaved = null, onEnded = null) {
    lastStream = [input, voice, note, provider, recording, onSaved, onEnded];
    if (livePreview) cancelPreview(livePreview);
    const context = prepareLocalSpeech();
    configureStreamingSession(recording);
    const controller = new AbortController();
    const preview = { context, controller, paused: false, note, sources: new Set(), buffers: [], nextTime: context.currentTime + 0.08 };
    livePreview = preview;
    const playbackParts = [];
    let totalWeight = 0;
    let streamStatus = 'Streaming…';
    let allAudioReceived = false;
    const updateProgress = () => {
        if (livePreview !== preview) { clearInterval(preview.progressTimer); return; }
        let played = 0;
        for (const part of playbackParts) {
            const fraction = part.complete
                ? Math.max(0, Math.min(1, (context.currentTime - part.start) / (part.end - part.start || 1)))
                : 0;
            played += part.weight * fraction;
        }
        const percent = totalWeight ? Math.min(99, Math.floor(100 * played / totalWeight)) : 0;
        const completeDuration = allAudioReceived && playbackParts.length && playbackParts.every(part => part.complete)
            ? playbackParts.reduce((sum, part) => sum + Math.max(0, part.end - part.start), 0) : null;
        const playedSeconds = playbackParts.reduce((sum, part) => sum + (part.complete
            ? Math.max(0, Math.min(part.end - part.start, context.currentTime - part.start)) : 0), 0);
        const progressLabel = globalThis.Reader?.updatePlaybackProgress?.(percent, recording,
            completeDuration ? { elapsed: playedSeconds, duration: completeDuration, rate: 1 } : null) || `${percent}% complete`;
        note.textContent = `${preview.paused ? 'Paused' : streamStatus} · ${progressLabel}`;
        if (!preview.paused && totalWeight) {
            let offset = 0;
            for (const part of playbackParts) {
                if (part.start === null || context.currentTime < part.start) break;
                const fraction = Math.max(0, Math.min(1,
                    (context.currentTime - part.start) / (part.end - part.start || 1)));
                offset = part.offset + Math.floor(part.weight * fraction);
                if (fraction < 1 || !part.complete) break;
            }
            globalThis.updateStreamingReadingPosition?.(input, offset, recording);
        }
    };
    preview.updateProgress = updateProgress;
    preview.playbackParts = playbackParts;
    preview.progressTimer = setInterval(updateProgress, 250);
    updateProgress();
    try {
        await context.resume();
        streamingMediaState('playing');

        const captured = [];
        let saved = false;
        let saveError = false;
        const parts = splitStreamingText(input, provider === 'elevenlabs' ? 4500 : 850);
        totalWeight = parts.reduce((sum, part) => sum + part.length, 0);
        let textOffset = 0;
        for (const [index, part] of parts.entries()) {
        if (controller.signal.aborted) return;
        streamStatus = `Streaming… ${index + 1} of ${parts.length}`;
        updateProgress();
        const offset = input.indexOf(part, textOffset);
        textOffset = offset + part.length;
        const playbackPart = { offset, weight: part.length, start: null, end: preview.nextTime, complete: false };
        playbackParts.push(playbackPart);
            const response = await fetch('/api/tts/stream', {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: part, voice, provider, response_format: 'pcm' })
            });
            if (!response.ok) throw new Error((await response.json()).error || `Speech failed (${response.status})`);
            const reader = response.body.getReader();
            let pending = new Uint8Array(0);
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                if (recording) captured.push(value.slice());
                const bytes = new Uint8Array(pending.length + value.length);
                bytes.set(pending); bytes.set(value, pending.length);
                const count = Math.floor(bytes.length / 2);
                pending = bytes.slice(count * 2);
                if (!count) continue;
                const buffer = context.createBuffer(1, count, 24000);
                const samples = buffer.getChannelData(0);
                const view = new DataView(bytes.buffer);
                for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
                preview.nextTime = Math.max(preview.nextTime, context.currentTime + 0.02);
                if (playbackPart.start === null) playbackPart.start = preview.nextTime;
                const chunk = { buffer, start: preview.nextTime };
                preview.buffers.push(chunk);
                scheduleSpeechBuffer(preview, chunk);
                preview.nextTime += buffer.duration;
                playbackPart.end = preview.nextTime;
            }
            if (pending.length) throw new Error('Speech ended with incomplete audio.');
            playbackPart.complete = true;
        }
        if (controller.signal.aborted) return;
        allAudioReceived = true;
        const delay = Math.max(0, (preview.nextTime - context.currentTime) * 1000);
        const finish = () => {
            if (livePreview !== preview) return;
            if (preview.paused) return;
            const remaining = (preview.nextTime - context.currentTime) * 1000;
            if (remaining > 10) { setTimeout(finish, remaining); return; }
            if (livePreview === preview) {
                // Text-follow UI must never prevent the next character cue.
                let progressLabel = '100% complete';
                try {
                    globalThis.updateStreamingReadingPosition?.(input, input.length, recording);
                    progressLabel = globalThis.Reader?.updatePlaybackProgress?.(100, recording) || progressLabel;
                } catch (error) { console.warn('Could not update reading position', error); }
                livePreview = null;
                streamingMediaState('none');
                clearInterval(preview.progressTimer);
                note.textContent = saved ? `Stream finished · recording saved · ${progressLabel}` : saveError ? `${streamStatus} · ${progressLabel}` : `Stream finished · ${progressLabel}`;
                onEnded?.();
            }
        };
        preview.finish = finish;
        setTimeout(finish, delay);
        if (recording) {
            streamStatus = 'Saving streamed recording…';
            updateProgress();
            try {
                const bytes = new Uint8Array(await new Blob(captured).arrayBuffer());
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += 8192)
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
                if (controller.signal.aborted) return;
                const response = await fetch('/api/tts/stream/save', {
                    method: 'POST', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...recording, provider, pcm: btoa(binary) })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not save recording');
                saved = true;

                if (onSaved) onSaved(result);
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                saveError = true;
                streamStatus = `Saving failed: ${error.message}`;
                if (livePreview === preview) updateProgress();
            }
        }
    } catch (error) {
        clearInterval(preview.progressTimer);
        if (livePreview === preview && error.name !== 'AbortError') note.textContent = error.message;
        if (livePreview === preview) {
            cancelPreview(preview); livePreview = null;
            streamingMediaState('none');
        }
    }
}

function scheduleSpeechBuffer(preview, chunk, offset = 0) {
    const source = preview.context.createBufferSource();
    source.buffer = chunk.buffer;
    source.connect(preview.context.destination);
    preview.sources.add(source);
    source.onended = () => { preview.sources.delete(source); source.disconnect(); };
    source.start(chunk.start + offset, offset);
}
function rewindLocalSpeech(seconds = 15) {
    const preview = livePreview;
    if (!preview?.buffers.length) return;
    const now = preview.context.currentTime;
    const target = Math.max(preview.buffers[0].start, now - seconds);
    const shift = now + 0.02 - target;
    for (const source of preview.sources) {
        try { source.stop(); } catch {}
        source.disconnect();
    }
    preview.sources.clear();
    for (const chunk of preview.buffers) {
        const offset = Math.max(0, target - chunk.start);
        chunk.start += shift;
        if (offset < chunk.buffer.duration) scheduleSpeechBuffer(preview, chunk, offset);
    }
    for (const part of preview.playbackParts) {
        if (part.start !== null) part.start += shift;
        part.end += shift;
    }
    preview.nextTime += shift;
    preview.updateProgress();
}

function stopLocalSpeech() {
    if (!livePreview) return;
    clearInterval(livePreview.progressTimer);
    livePreview.note.textContent = 'Stream stopped';
    cancelPreview(livePreview); livePreview = null;
    streamingMediaState('none');
}
async function pauseLocalSpeech() {
    const preview = livePreview;
    if (!preview || preview.paused) return;
    preview.paused = true;
    await preview.context.suspend();
    streamingMediaState('paused');
}
async function resumeLocalSpeech() {
    const preview = livePreview;
    if (!preview || !preview.paused) return;
    await preview.context.resume();
    preview.paused = false;
    streamingMediaState('playing');
    preview.finish?.();
}
function restartLocalSpeech() {
    if (lastStream) return streamLocalSpeech(...lastStream);
}
window.LocalSpeech = { prepare: prepareLocalSpeech, get state() { return !livePreview ? 'idle' : livePreview.paused ? 'paused' : 'playing'; }, play: streamLocalSpeech, stop: stopLocalSpeech,
    rewind: rewindLocalSpeech, pause: pauseLocalSpeech, resume: resumeLocalSpeech, restart: restartLocalSpeech };
window.addEventListener('pagehide', () => {
    stopLocalSpeech();
    speechContext?.close(); speechContext = null;
});
