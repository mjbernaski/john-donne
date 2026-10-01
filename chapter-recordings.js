// Saved chapter audio is independent of the currently selected generation model.
(() => {
    const panel = document.getElementById('chapterRecordingPanel');
    const status = document.getElementById('chapterRecordingStatus');
    const selector = document.getElementById('chapterRecordingPart');
    const play = document.getElementById('chapterRecordingPlay');
    const download = document.getElementById('chapterRecordingDownload');
    const stop = document.getElementById('chapterRecordingStop');
    let activeJob = null;
    stop.addEventListener('click', async () => {
        if (!activeJob) return;
        stop.disabled = true;
        try {
            const response = await fetch(`/api/tts/jobs/${encodeURIComponent(activeJob)}/cancel`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not stop narration.');
            status.textContent = 'Stop requested. The current request may finish; saved parts will be kept.';
        } catch (error) {
            status.textContent = error.message;
            stop.disabled = false;
        }
    });
    let chapterId = '', lastCheck = 0, pending = false, optionsSignature = '';

    function selectAudio() { play.disabled = !selector.value; }
    play.addEventListener('click', () => {
        const urls = [...selector.options].filter(option => option.textContent.startsWith('Part ')).map(option => option.value);
        window.Reader?.playExternal(selector.value, 'Saved chapter recording', urls.includes(selector.value) ? urls : null);
    });

    window.refreshChapterRecording = async () => {
        const chapter = currentPoem?.title.match(/^Chapter ([IVXLCDM]+)\s*[·:]/)?.[1];
        const id = chapter && currentBook ? `${currentBook.id}-${chapter}` : '';
        if (id !== chapterId) {
            chapterId = id;
            lastCheck = 0;
            optionsSignature = '';
            panel.hidden = true;
            play.disabled = true;
            selector.replaceChildren();
            download.hidden = true;
            stop.hidden = true;
            activeJob = null;
        }
        if (!id || pending || Date.now() - lastCheck < 5000) return;
        pending = true;
        lastCheck = Date.now();
        try {
            const response = await fetch(`/audio-library/chapter-recording-${encodeURIComponent(id)}.json`, { cache: 'no-store' });
            if (!response.ok) return;
            const recording = await response.json();
            if (id !== chapterId || recording.chapter !== currentPoem?.title) return;
            panel.hidden = false;
            const ready = recording.state === 'complete';
            activeJob = ['queued', 'running'].includes(recording.state) ? recording.job : null;
            stop.hidden = !activeJob;
            status.textContent = `${recording.label} · ${recording.saved} of ${recording.total} parts saved · `
                + (ready ? 'Complete chapter ready.' : recording.state === 'stopped'
                    ? `Stopped: ${recording.error}` : 'Generating remaining parts. You can leave this page.');
            const choices = (ready && recording.url ? [{ text: 'Complete chapter', url: recording.url }] : [])
                .concat((recording.parts || []).map(part => ({ text: `Part ${part.index}`, url: part.url })));
            const signature = JSON.stringify(choices);
            if (signature !== optionsSignature) {
                const selected = selector.value;
                selector.replaceChildren(...choices.map(choice => new Option(choice.text, choice.url)));
                // Preserve ongoing playback when newly saved parts arrive.
                if (choices.some(choice => choice.url === selected)) selector.value = selected;
                optionsSignature = signature;
                selectAudio();
            }
            selector.disabled = !choices.length;
            if (ready && recording.url) {
                download.href = `${recording.url}?download=1`;
                download.download = recording.filename || 'Complete chapter.wav';
                download.hidden = false;
            }
        } catch {
            // Keep saved playback working through a temporary network outage.
        } finally {
            pending = false;
        }
    };
    selector.addEventListener('change', selectAudio);
    setInterval(() => {
        if (document.getElementById('poemModal')?.classList.contains('show')) window.refreshChapterRecording();
    }, 15000);
})();
