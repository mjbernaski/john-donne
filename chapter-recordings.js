// Saved chapter audio is independent of the currently selected generation model.
(() => {
    const panel = document.getElementById('chapterRecordingPanel');
    const status = document.getElementById('chapterRecordingStatus');
    const selector = document.getElementById('chapterRecordingPart');
    const player = document.getElementById('chapterRecordingPlayer');
    const download = document.getElementById('chapterRecordingDownload');
    let chapterId = '', lastCheck = 0, pending = false, optionsSignature = '';

    function selectAudio() {
        if (selector.value && player.getAttribute('src') !== selector.value) {
            player.pause();
            player.src = selector.value;
        }
        player.hidden = !selector.value;
    }

    window.refreshChapterRecording = async () => {
        const chapter = currentPoem?.title.match(/^Chapter ([IVXLCDM]+)\s*[·:]/)?.[1];
        const id = chapter && currentBook ? `${currentBook.id}-${chapter}` : '';
        if (id !== chapterId) {
            chapterId = id;
            lastCheck = 0;
            optionsSignature = '';
            panel.hidden = true;
            player.pause();
            player.removeAttribute('src');
            player.load();
            selector.replaceChildren();
            download.hidden = true;
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
            status.textContent = `${recording.label} · ${recording.saved} of ${recording.total} parts saved · `
                + (ready ? 'Complete chapter ready.' : recording.state === 'stopped'
                    ? `Stopped: ${recording.error}` : 'Generating remaining parts. You can leave this page.');
            const choices = (ready && recording.url ? [{ text: 'Complete chapter', url: recording.url }] : [])
                .concat((recording.parts || []).map(part => ({ text: `Part ${part.index}`, url: part.url })));
            const signature = JSON.stringify(choices);
            if (signature !== optionsSignature) {
                const selected = selector.value;
                const wasPlaying = !player.paused;
                selector.replaceChildren(...choices.map(choice => new Option(choice.text, choice.url)));
                // Preserve ongoing playback when newly saved parts arrive.
                if (choices.some(choice => choice.url === selected) && (wasPlaying || !ready)) selector.value = selected;
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
        else player.pause();
    }, 15000);
})();
