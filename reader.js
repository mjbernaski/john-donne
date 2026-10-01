// Shared navigation, playback, and the opt-in literary reader.
// Playback snapshots deliberately do not read the currently browsed collection.
window.Reader = (() => {
    const $ = id => document.getElementById(id);
    const KEY = 'reading-room-v1';
    const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`${KEY}:${key}`)) ?? fallback; } catch { return fallback; } };
    const write = (key, value) => { try { localStorage.setItem(`${KEY}:${key}`, JSON.stringify(value)); } catch {} };
    const defaults = { theme: 'paper', size: 22, spacing: 1.65, width: 68 };
    let preview = read('preview', false) === true;
    let partLines = read('part-lines', true) !== false;
    const playbackSpeeds = [0.8, 0.9, 1, 1.2, 1.4];
    let playbackSpeed = read('playback-speed', 1);
    if (!playbackSpeeds.includes(playbackSpeed)) playbackSpeed = 1;
    let appearance = { ...defaults, ...read('appearance', {}) };
    let ready = false, routing = false, selectingBook = false, routeVersion = 0, returnFocus = null;
    let positions = read('positions', {}), drafts = new Map(), activeEntry = null;
    let manifest = [], category = 'All', libraryQuery = '', librarySort = 'author';
    let selected = null, playback = null, playVersion = 0, lastPlaybackSave = 0;
    let findMatches = [], findIndex = -1;
    let generationCheckPending = false, resolveDuplicateChoice = null;
    const snapshots = new Map(), jobs = new Map();
    const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text) el.textContent = text; return el; };
    const entryKey = (book, poem) => `${book.id}:${getPoemId(poem)}`;
    const panel = () => $('poemPanel');
    const isOpen = () => poemModal.classList.contains('show');
    function urlFor(book, poem) {
        const url = new URL('index.html', location.href);
        url.searchParams.set('book', book.id);
        if (poem) url.searchParams.set('entry', getPoemId(poem));
        return url;
    }
    function recordUrl(url) {
        if (!routing && location.href !== String(url)) history.pushState(null, '', url);
    }
    function savePosition() {
        if (!activeEntry || !isOpen()) return;
        positions[activeEntry] = { scroll: panel().scrollTop, title: currentPoem.title, book: currentBook.id, entry: getPoemId(currentPoem) };
        drafts.set(activeEntry, chatInput.value);
        write('positions', positions);
        write('last', positions[activeEntry]);
    }
    function applyAppearance() {
        if (!['paper', 'sepia', 'dark'].includes(appearance.theme)) appearance.theme = 'paper';
        for (const [name, min, max] of [['size', 16, 28], ['spacing', 1.4, 2], ['width', 52, 80]]) {
            appearance[name] = Math.max(min, Math.min(max, Number(appearance[name]) || defaults[name]));
        }
        const wasPreview = document.body.classList.contains('reader-preview');
        document.body.classList.toggle('reader-preview', preview);
        const audioSettings = $('readerAudioSettings');
        if (audioSettings && (!preview || !wasPreview)) audioSettings.open = !preview;
        document.body.dataset.readerTheme = appearance.theme;
        document.body.style.setProperty('--reader-size', `${appearance.size}px`);
        document.body.style.setProperty('--reader-leading', appearance.spacing);
        document.body.style.setProperty('--reader-width', `${appearance.width}ch`);
        document.querySelectorAll('[data-reader-preview]').forEach(el => { el.checked = preview; });
        document.querySelectorAll('[data-appearance]').forEach(el => {
            el.value = appearance[el.dataset.appearance];
            const output = el.parentElement.querySelector('output');
            if (output) output.textContent = el.value;
        });
        write('appearance', appearance);
        updatePanelSemantics();
    }
    function applyPartLines() {
        document.body.classList.toggle('reader-hide-part-lines', !partLines);
        document.querySelectorAll('[data-reader-part-lines]').forEach(el => { el.checked = partLines; });
    }
    function updatePanelSemantics() {
        const split = preview && matchMedia('(min-width: 1100px)').matches && modalContentElement.dataset.modalTab === 'discuss';
        panel().setAttribute('role', split ? 'region' : 'tabpanel');
        panel().setAttribute('aria-labelledby', split ? 'modalTitle' : modalContentElement.dataset.modalTab === 'visualize' ? 'visualizeTab' : 'readTab');
    }
    function install() {
        const toolbar = node('div', 'reader-tools');
        toolbar.innerHTML = `<div class="reader-entry-nav"><button id="readerPrevious" type="button">← Previous</button><button id="readerContents" type="button">Contents</button><button id="readerNext" type="button">Next →</button></div>
            <div class="reader-tools-options"><label class="reader-preview-toggle"><input type="checkbox" data-reader-part-lines checked> Part lines</label><label class="reader-preview-toggle"><input type="checkbox" data-reader-preview> New reader</label>
            <details id="readerAppearance"><summary>Appearance</summary><div class="reader-appearance-fields">
            <label>Theme<select data-appearance="theme"><option value="paper">Paper</option><option value="sepia">Sepia</option><option value="dark">Dark</option></select></label>
            <label>Text size <output></output><input aria-label="Text size" data-appearance="size" type="range" min="16" max="28" step="1"></label>
            <label>Line spacing <output></output><input aria-label="Line spacing" data-appearance="spacing" type="range" min="1.4" max="2" step="0.05"></label>
            <label>Reading width <output></output><input aria-label="Reading width" data-appearance="width" type="range" min="52" max="80" step="2"></label>
            <button id="readerReset" type="button">Reset appearance</button></div></details></div>`;
        modalContentElement.querySelector('.modal-body').prepend(toolbar);
        const finder = node('form', 'reader-find');
        finder.setAttribute('role', 'search'); finder.setAttribute('aria-label', 'Find in current text');
        finder.innerHTML = '<label for="readerFind">Find in this text</label><input id="readerFind" type="search" placeholder="Word or phrase" autocomplete="off"><span id="readerFindCount" role="status" aria-live="polite"></span><button id="readerFindPrevious" type="button" aria-label="Previous match">↑</button><button id="readerFindNext" type="button" aria-label="Next match">↓</button><button id="readerFindClear" type="button">Clear</button>';
        toolbar.after(finder);
        finder.onsubmit = event => { event.preventDefault(); moveFind(1); };
        $('readerFind').oninput = () => findInText();
        $('readerFind').onkeydown = event => {
            if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); moveFind(-1); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clearFind(); }
        };
        $('readerFindPrevious').onclick = () => moveFind(-1);
        $('readerFindNext').onclick = () => moveFind(1);
        $('readerFindClear').onclick = () => { clearFind(); $('readerFind').focus(); };
        document.addEventListener('keydown', event => {
            if (isOpen() && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault(); $('readerFind').focus(); $('readerFind').select();
            }
        });
        new MutationObserver(() => findInText(false)).observe(modalContent, { childList: true });
        findInText(false);
        modalTitle.tabIndex = -1; bookTitle.tabIndex = -1;
        const audio = document.querySelector('.poem-audio');
        const details = node('details', 'reader-audio-settings'); details.id = 'readerAudioSettings';
        const summary = node('summary', '', 'Audio settings & downloads'); details.append(summary);
        while (audio.firstChild) details.append(audio.firstChild);
        audio.append(details);
        const listen = node('div', 'reader-listen');
        listen.innerHTML = '<button id="readerListen" type="button">Listen</button><button id="readerStream" type="button">Stream</button><button id="readerStopStream" type="button">Stop stream</button><span id="readerListenNote">Listen to this text</span>';
        audio.prepend(listen);
        const generation = node('section', 'reader-generation-progress'); generation.id = 'readerGenerationProgress'; generation.hidden = true;
        generation.setAttribute('aria-label', 'Generation progress');
        generation.innerHTML = '<strong id="readerGenerationCounts" role="status"></strong><progress id="readerGenerationMeter" aria-label="Requested narration parts completed"></progress><div id="readerGenerationDots" class="reader-generation-dots" role="group" aria-label="Generation status by part"></div><div class="reader-generation-legend"><span data-state="done">Done</span><span data-state="generating">Underway</span><span data-state="retrying">Retrying</span><span data-state="queued">Queued</span><span data-state="failed">Failed</span></div><p id="readerGenerationDetail"></p>';
        audio.insertBefore(generation, details);
        const progress = node('details', 'reader-part-progress'); progress.setAttribute('aria-label', 'Narration parts');
        progress.innerHTML = '<summary id="readerPartSummary">Audio parts</summary><div class="reader-part-heading"><strong>Audio parts</strong><label>Part <select id="readerPartSelect" aria-label="Select narration part"></select></label><button id="readerCheckAudio" type="button">Check saved audio</button></div><div id="readerParts" class="reader-parts" role="group" aria-label="Narration part status"></div><p id="readerProgress" role="status"></p><button id="readerResume" type="button" hidden>Resume missing parts</button>';
        audio.insertBefore(progress, details);
        const recordings = node('section', 'reader-saved-recordings');
        recordings.innerHTML = '<strong>Saved recordings</strong><p id="readerSavedStatus" role="status">Checking shared audio…</p><label>Recording <select id="readerSavedSelect" aria-label="Saved recordings from all voices and models"></select></label><div><button id="readerSavedPlay" type="button" disabled>Play recording</button> <a id="readerSavedDownload" hidden>Download</a> <button id="readerSavedRefresh" type="button">Refresh recordings</button></div>';
        audio.insertBefore(recordings, details);
        $('readerSavedSelect').onchange = updateSavedChoice;
        $('readerSavedPlay').onclick = () => {
            const recording = selected?.recordings?.find(item => item.url === $('readerSavedSelect').value);
            if (recording) playExternal(recording.url, recording.filename.replace(/\.wav$/i, ''));
        };
        $('readerSavedRefresh').onclick = () => { if (selected) { refreshRecordings(selected); refreshAvailability(selected); } };
        const refreshShared = () => {
            if (!document.hidden && isOpen() && selected) {
                refreshRecordings(selected); refreshAvailability(selected);
            }
        };
        setInterval(refreshShared, 15000);
        document.addEventListener('visibilitychange', refreshShared);
        window.addEventListener('focus', refreshShared);
        const progressLayout = matchMedia('(min-width: 768px)');
        const updateProgressLayout = () => { progress.open = progressLayout.matches; };
        progressLayout.addEventListener('change', updateProgressLayout); updateProgressLayout();
        const dock = node('section', 'reader-player'); dock.id = 'readerPlayer'; dock.hidden = true; dock.setAttribute('aria-label', 'Now playing');
        dock.innerHTML = '<div class="reader-player-title"><strong id="readerPlayingTitle"></strong><span id="readerPlayingDetail"></span></div><div class="reader-player-controls"><button id="readerPlayPause" type="button">Play</button><button id="readerReturn" type="button">Return to text</button><details class="reader-player-more"><summary>More</summary><button id="readerPrevPart" type="button">Previous part</button><button id="readerNextPart" type="button">Next part</button></details><button id="readerClosePlayer" type="button">Close player</button></div><p id="readerPlayerStatus" role="status"></p>';
        dock.append(poemAudioPlayer); poemAudioPlayer.hidden = false; document.body.append(dock);
        const speed = node('label', 'reader-playback-speed', 'Speed ');
        const speedSelect = node('select', ''); speedSelect.id = 'readerPlaybackSpeed';
        speedSelect.setAttribute('aria-label', 'Playback speed');
        speedSelect.append(...playbackSpeeds.map(value => new Option(`${value.toFixed(1)}×`, String(value))));
        speed.append(speedSelect); $('readerClosePlayer').before(speed);
        const applySpeed = () => {
            speedSelect.value = String(playbackSpeed);
            poemAudioPlayer.defaultPlaybackRate = playbackSpeed;
            poemAudioPlayer.playbackRate = playbackSpeed;
            poemAudioPlayer.preservesPitch = true;
        };
        speedSelect.onchange = () => { playbackSpeed = Number(speedSelect.value); write('playback-speed', playbackSpeed); applySpeed(); };
        poemAudioPlayer.addEventListener('loadedmetadata', applySpeed);
        applySpeed();
        const measureViewport = () => {
            document.body.style.setProperty('--reader-player-height', `${dock.hidden ? 0 : dock.getBoundingClientRect().height}px`);
            document.body.style.setProperty('--reader-viewport', `${window.visualViewport?.height || innerHeight}px`);
        };
        new ResizeObserver(measureViewport).observe(dock);
        window.visualViewport?.addEventListener('resize', measureViewport);
        window.addEventListener('resize', measureViewport); measureViewport();
        const queueJump = node('button', 'reader-queue-jump', 'Generation'); queueJump.id = 'readerQueueJump'; queueJump.type = 'button'; queueJump.hidden = true;
        document.querySelector('.reader-shell-bar > div').prepend(queueJump);
        queueJump.onclick = () => { closePoemModal(); $('readerQueue').scrollIntoView({ block: 'center' }); };
        const queue = node('aside', 'reader-queue'); queue.id = 'readerQueue'; queue.hidden = true; queue.setAttribute('aria-label', 'Narration generation'); document.body.append(queue);
        const dialog = node('dialog', 'reader-generate-dialog'); dialog.id = 'readerGeneration';
        dialog.innerHTML = '<h2>Prepare a reading</h2><p id="readerGenerationInfo"></p><div><button id="readerGeneratePart" type="button">Generate this part</button><button id="readerGenerateRemaining" type="button">Generate remaining parts</button><button id="readerGenerationSettings" type="button">Change voice or model</button><button id="readerGenerationCancel" type="button">Cancel</button></div>';
        const duplicateDialog = node('dialog', 'reader-generate-dialog'); duplicateDialog.id = 'readerDuplicateWarning';
        duplicateDialog.setAttribute('aria-labelledby', 'readerDuplicateTitle');
        duplicateDialog.innerHTML = '<h2 id="readerDuplicateTitle">Saved audio already exists</h2><p id="readerDuplicateMessage"></p><ul id="readerDuplicateVersions"></ul><div><button id="readerDuplicateSaved" type="button" autofocus>Use saved recordings</button><button id="readerDuplicateContinue" type="button">Generate another version</button><button id="readerDuplicateCancel" type="button">Cancel</button></div>';
        document.body.append(duplicateDialog);
        const finishDuplicate = choice => { const resolve = resolveDuplicateChoice; resolveDuplicateChoice = null; duplicateDialog.close(); resolve?.(choice); };
        $('readerDuplicateSaved').onclick = () => finishDuplicate('saved');
        $('readerDuplicateContinue').onclick = () => finishDuplicate('generate');
        $('readerDuplicateCancel').onclick = () => finishDuplicate('cancel');
        duplicateDialog.addEventListener('cancel', event => { event.preventDefault(); finishDuplicate('cancel'); });
        duplicateDialog.addEventListener('close', () => { const resolve = resolveDuplicateChoice; resolveDuplicateChoice = null; resolve?.('cancel'); });
        document.body.append(dialog);
        document.querySelectorAll('[data-reader-part-lines]').forEach(el => el.addEventListener('change', () => {
            partLines = el.checked; write('part-lines', partLines); applyPartLines();
        }));
        applyPartLines();
        document.querySelectorAll('[data-reader-preview]').forEach(el => el.addEventListener('change', () => {
            preview = el.checked; write('preview', preview); applyAppearance(); if (currentBook) displayPoems(filteredPoems); renderParts();
        }));
        document.querySelectorAll('[data-appearance]').forEach(el => el.addEventListener('input', () => { appearance[el.dataset.appearance] = el.value; applyAppearance(); }));
        $('readerReset').onclick = () => { appearance = { ...defaults }; applyAppearance(); };
        $('readerPrevious').onclick = () => adjacent(-1); $('readerNext').onclick = () => adjacent(1);
        $('readerContents').onclick = () => closePoemModal();
        $('readerListen').onclick = () => { LocalSpeech.stop(); listenCurrent(); };
        $('readerStream').onclick = () => {
            if (!selected || selected.provider !== 'local') return;
            poemAudioPlayer.pause();
            const part = selected.requests[Number(poemAudioPart.value) || 0];
            const input = part.speakTitle ? `${part.title}.\n\n${part.text}` : part.text;
            LocalSpeech.play(input, part.voice, $('readerListenNote'));
        };
        $('readerStopStream').onclick = () => LocalSpeech.stop();
        $('readerCheckAudio').onclick = () => { if (selected) refreshAvailability(selected); };
        $('readerPartSelect').onchange = () => choosePart(Number($('readerPartSelect').value));
        $('readerResume').onclick = () => generationChoice();
        $('readerGenerationCancel').onclick = () => dialog.close();
        $('readerGenerationSettings').onclick = () => { dialog.close(); details.open = true; poemVoice.focus(); };
        $('readerGeneratePart').onclick = () => { dialog.close(); generateSelected(false); };
        $('readerGenerateRemaining').onclick = () => { dialog.close(); generateSelected(true); };
        $('readerPlayPause').onclick = () => { if (poemAudioPlayer.paused) safePlay(); else poemAudioPlayer.pause(); };
        $('readerClosePlayer').onclick = closePlayer;
        $('readerReturn').onclick = () => { if (playback) navigate(urlFor(playback.book, playback.poem)); };
        $('readerPrevPart').onclick = () => stepPlayback(-1); $('readerNextPart').onclick = () => stepPlayback(1);
        poemAudioPlayer.addEventListener('play', updateDock); poemAudioPlayer.addEventListener('pause', updateDock);
        poemAudioPlayer.addEventListener('timeupdate', () => { if (Date.now() - lastPlaybackSave > 2000) persistPlayback(); });
        poemAudioPlayer.addEventListener('error', () => { $('readerPlayerStatus').textContent = 'This recording could not be loaded. Return to the text to check saved audio.'; });
        document.addEventListener('play', event => {
            if (!(event.target instanceof HTMLAudioElement)) return;
            document.querySelectorAll('audio').forEach(other => { if (other !== event.target) other.pause(); });
        }, true);
        document.addEventListener('click', event => {
            const link = event.target.closest('a');
            if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank' || link.hasAttribute('download')) return;
            const url = new URL(link.href, location.href);
            if (url.origin === location.origin && /\/(?:index|library)\.html$/.test(url.pathname)) { event.preventDefault(); navigate(url); }
        });
        panel().addEventListener('scroll', () => { if (activeEntry) positions[activeEntry] = { ...positions[activeEntry], scroll: panel().scrollTop }; }, { passive: true });
        window.addEventListener('pagehide', () => { savePosition(); persistPlayback(); });
        window.addEventListener('popstate', () => navigate(new URL(location.href), false));
        const playerLayout = matchMedia('(min-width: 1100px)');
        const updatePlayerLayout = () => { document.querySelector('.reader-player-more').open = playerLayout.matches; };
        playerLayout.addEventListener('change', updatePlayerLayout); updatePlayerLayout();
        window.addEventListener('resize', updatePanelSemantics);
        for (const id of ['poemVoice', 'ttsProvider', 'geminiTtsModel']) $(id).addEventListener('change', () => syncAudio());
        poemAudioPart.addEventListener('change', renderParts);
        $('librarySearch').oninput = event => { libraryQuery = event.target.value.toLocaleLowerCase(); renderLibrary(); };
        $('librarySort').onchange = event => { librarySort = event.target.value; renderLibrary(); };
        $('libraryReset').onclick = () => { category = 'All'; libraryQuery = ''; $('librarySearch').value = ''; renderLibrary(); };
        applyAppearance();
    }
    function showLibrary(show) {
        $('readerLibrary').hidden = !show; $('readerCollection').hidden = show;
        document.body.classList.toggle('reader-library-open', show);
        if (show) { document.title = 'Library · Reading room'; renderLibrary(); }
    }
    async function navigate(url, push = true) {
        if (!ready) return;
        const version = ++routeVersion;
        savePosition();
        if (push) recordUrl(url);
        routing = true;
        try {
            if (url.pathname.endsWith('/library.html') || url.searchParams.get('view') === 'library') {
                closePoemModal(); showLibrary(true); $('librarySearch').focus(); return;
            }
            showLibrary(false);
            const book = allBooks.find(b => b.id === url.searchParams.get('book')) || currentBook || allBooks[0];
            await selectBook(book.id);
            if (version !== routeVersion) return;
            const entry = url.searchParams.get('entry');
            const poem = entry && allPoems.find(p => getPoemId(p) === entry);
            if (poem) openPoemModal(poem); else { closePoemModal(); bookTitle.focus(); }
        } finally { if (version === routeVersion) routing = false; }
    }
    function renderLibrary() {
        const categories = ['All', ...new Set(manifest.map(b => b.category || 'Other'))];
        $('libraryFilters').replaceChildren(...categories.map(name => {
            const button = node('button', '', name); button.type = 'button'; button.setAttribute('aria-pressed', String(name === category)); button.onclick = () => { category = name; renderLibrary(); }; return button;
        }));
        const author = b => b.poet || b.name || '';
        const visible = manifest.filter(b => (category === 'All' || (b.category || 'Other') === category) && [b.title, author(b), b.subtitle].join(' ').toLocaleLowerCase().includes(libraryQuery));
        visible.sort((a, b) => String(librarySort === 'author' ? author(a) : a[librarySort]).localeCompare(String(librarySort === 'author' ? author(b) : b[librarySort])) || a.title.localeCompare(b.title));
        $('libraryGrid').replaceChildren(...visible.map(book => {
            const card = node('article', 'library-card'); card.dataset.category = book.category;
            card.append(node('p', 'library-card-label', book.category || 'Collection'), node('h2', '', book.title), node('p', 'library-author', author(book)), node('p', 'library-edition', book.subtitle));
            const link = node('a', 'library-open', book.format === 'PDF' ? 'Open PDF ↗' : 'Open collection →');
            link.href = book.format === 'PDF' ? book.sourceUrl : urlFor(book);
            if (book.format === 'PDF') { link.target = '_blank'; link.rel = 'noopener'; }
            card.append(link); return card;
        }));
        $('libraryStatus').textContent = visible.length ? `${visible.length} of ${manifest.length} titles` : 'No titles match. Try another search or category.';
        $('libraryReset').hidden = !libraryQuery && category === 'All';
        const last = read('last', null), book = last && allBooks.find(b => b.id === last.book);
        $('continueReading').hidden = !book;
        if (book) { const url = urlFor(book); url.searchParams.set('entry', last.entry); $('continueReading').href = url; $('continueReading').textContent = `Continue reading: ${last.title} →`; }
    }
    function renderContents(poems) {
        poemsList.classList.toggle('reader-contents', preview && currentBook?.chapterCollection);
        if (!preview || !currentBook?.chapterCollection) return false;
        poemsList.replaceChildren();
        if (!poems.length) { poemsList.append(node('p', '', 'No entries match your search.')); return true; }
        const sections = new Map();
        for (const poem of poems) {
            const name = poem.section || currentBook.title;
            if (!sections.has(name)) sections.set(name, []);
            sections.get(name).push(poem);
        }
        for (const [name, entries] of sections) {
            const section = node('section', 'reader-contents-section'); section.append(node('h2', '', name));
            const list = node('ol', '');
            for (const poem of entries) {
                const item = node('li', ''); const link = node('a', '', poem.title); link.href = urlFor(currentBook, poem);
                const key = entryKey(currentBook, poem), last = read('last', null);
                if (currentPoem === poem) link.setAttribute('aria-current', 'page');
                if (last?.book === currentBook.id && last?.entry === getPoemId(poem)) link.append(node('span', 'reader-bookmark', 'Last read'));
                else if (positions[key]) link.append(node('span', 'reader-bookmark', 'Visited'));
                item.append(link); list.append(item);
            }
            section.append(list); poemsList.append(section);
        }
        return true;
    }
    function adjacent(direction) {
        const index = allPoems.indexOf(currentPoem) + direction;
        if (index >= 0 && index < allPoems.length) openPoemModal(allPoems[index]);
    }
    function beforeOpen() { savePosition(); if (!isOpen()) returnFocus = document.activeElement; }
    function clearFind() { $('readerFind').value = ''; findInText(false); }
    function findInText(scroll = true) {
        const query = $('readerFind').value.trim();
        const expression = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
        findMatches = []; findIndex = -1;
        for (const line of modalContent.querySelectorAll('.poem-line-text')) {
            const text = line.textContent;
            if (!expression) { if (line.querySelector('mark')) line.textContent = text; continue; }
            const fragment = document.createDocumentFragment();
            let end = 0;
            for (const match of text.matchAll(expression)) {
                fragment.append(document.createTextNode(text.slice(end, match.index)));
                const mark = node('mark', 'reader-find-match', match[0]);
                fragment.append(mark); findMatches.push(mark); end = match.index + match[0].length;
            }
            fragment.append(document.createTextNode(text.slice(end))); line.replaceChildren(fragment);
        }
        if (findMatches.length) findIndex = 0;
        updateFind(scroll);
    }
    function moveFind(direction) {
        if (!findMatches.length) return;
        findMatches[findIndex]?.classList.remove('is-current');
        findIndex = (findIndex + direction + findMatches.length) % findMatches.length;
        updateFind(true);
    }
    function updateFind(scroll) {
        $('readerFindCount').textContent = !$('readerFind').value.trim() ? '' : findMatches.length ? `${findIndex + 1} of ${findMatches.length}` : 'No matches';
        $('readerFindPrevious').disabled = $('readerFindNext').disabled = !findMatches.length;
        const current = findMatches[findIndex];
        current?.classList.add('is-current');
        if (scroll && current) current.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    function opened(poem) {
        showLibrary(false); activeEntry = entryKey(currentBook, poem);
        chatInput.value = drafts.get(activeEntry) || '';
        const saved = positions[activeEntry];
        requestAnimationFrame(() => { panel().scrollTop = saved?.scroll || 0; modalTitle.focus({ preventScroll: true }); });
        const index = allPoems.indexOf(poem);
        $('readerPrevious').disabled = index <= 0; $('readerNext').disabled = index < 0 || index >= allPoems.length - 1;
        recordUrl(urlFor(currentBook, poem));
        positions[activeEntry] = { scroll: saved?.scroll || 0, title: poem.title, book: currentBook.id, entry: getPoemId(poem) };
        write('last', positions[activeEntry]); write('positions', positions);
        syncAudio();
    }
    function closed() {
        activeEntry = null;
        if (ready && !routing && !selectingBook && currentBook) recordUrl(urlFor(currentBook));
        if (ready && currentBook && !selectingBook) {
            displayPoems(filteredPoems);
            const target = returnFocus?.isConnected ? returnFocus : bookTitle;
            target.focus({ preventScroll: true });
        }
    }
    function snapshot(poem = currentPoem, book = currentBook) {
        const provider = selectedTtsProvider(), model = selectedGeminiTtsModel(), voice = poemVoice.value;
        const texts = getNarrationParts(poem, provider, book);
        const requests = texts.map((text, index) => ({ title: narrationRequestTitle(poem, index, texts.length), text, voice, provider, model, kind: 'poem', book: book.id, speakTitle: index === 0, filename: `${book.poet || book.name} - ${poem.title} - Part ${index + 1} - ${ttsVoiceName(voice, provider)}.wav` }));
        const id = `${entryKey(book, poem)}:${provider}:${model}:${voice}`;
        if (!snapshots.has(id)) snapshots.set(id, { id, poem, book, provider, model, voice, requests, browserKeys: texts.map((text, i) => getPoemAudioKey(poem, voice, text, i, provider)), availability: texts.map(() => ({ state: 'checking', url: null })), checked: 0, checking: null });
        return snapshots.get(id);
    }
    async function refreshAvailability(snap) {
        if (snap.checking) return snap.checking;
        snap.checking = (async () => {
            let serverParts;
            try {
                const payload = await fetchJson('/api/tts/availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts: snap.requests }) });
                if (!Array.isArray(payload.parts) || payload.parts.length !== snap.requests.length) throw new Error('Invalid availability response');
                serverParts = payload.parts;
            } catch { /* Unknown must not look like a missing recording. */ }
            // Check browser records in small batches, never load all WAVs at once.
            for (let start = 0; start < snap.requests.length; start += 12) {
                await Promise.all(snap.requests.slice(start, start + 12).map(async (_, offset) => {
                    const i = start + offset, previous = snap.availability[i];
                    if (serverParts?.[i]?.saved) {
                        if (previous.url?.startsWith('blob:') && poemAudioPlayer.getAttribute('src') !== previous.url) URL.revokeObjectURL(previous.url);
                        snap.availability[i] = { state: 'saved', url: serverParts[i].url }; return;
                    }
                    if (previous.state === 'saved' && previous.url?.startsWith('blob:')) return;
                    let blob = null, browserKnown = true;
                    try { blob = await getStoredAudio(snap.browserKeys[i]); } catch { browserKnown = false; }
                    snap.availability[i] = blob ? { state: 'saved', url: previous.url?.startsWith('blob:') ? previous.url : URL.createObjectURL(blob) }
                        : { state: serverParts && browserKnown ? 'missing' : 'unknown', url: null };
                }));
            }
            snap.checked = Date.now();
        })().finally(() => { snap.checking = null; if (selected === snap) { renderParts(); updateAudioControls(); } });
        return snap.checking;
    }
    async function fetchJson(url, options = {}) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
            if (!response.ok) { const error = new Error(await getApiError(response)); error.status = response.status; throw error; }
            return await response.json();
        } finally { clearTimeout(timer); }
    }
    function updateSavedChoice() {
        const recording = selected?.recordings?.find(item => item.url === $('readerSavedSelect').value);
        $('readerSavedPlay').disabled = !recording;
        const download = $('readerSavedDownload');
        download.hidden = !recording;
        if (recording) { download.href = `${recording.url}?download=1`; download.download = recording.filename; }
        else download.removeAttribute('href');
    }
    function renderRecordings() {
        if (!selected) return;
        const select = $('readerSavedSelect'), previous = select.value;
        const recordings = selected.recordings || [];
        const signature = JSON.stringify(recordings);
        if (select.dataset.signature !== signature) {
            select.replaceChildren(...recordings.map(item => new Option(
                item.filename.replace(/\.wav$/i, '') + (item.model ? ` · ${item.model}` : ''), item.url)));
            if (recordings.some(item => item.url === previous)) select.value = previous;
            select.dataset.signature = signature;
        }
        select.disabled = !recordings.length;
        $('readerSavedStatus').textContent = selected.recordingsError ? 'Could not refresh shared recordings. Try again.'
            : selected.recordings === undefined ? 'Checking shared audio…'
            : recordings.length ? `${recordings.length} saved recordings · all voices and models`
            : 'No shared recordings found for this entry. Older browser-only audio stays on its original device.';
        updateSavedChoice();
        updateAudioControls();
    }
    async function refreshRecordings(snap) {
        if (snap.recordingsPending) return snap.recordingsPending;
        snap.recordingsPending = (async () => {
            try {
                const payload = await fetchJson('/api/tts/recordings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book: snap.book.id, title: snap.poem.title }) });
                if (!Array.isArray(payload.recordings)) throw new Error('Invalid recordings response');
                snap.recordings = payload.recordings; snap.recordingsError = false;
            } catch { snap.recordingsError = true; }
            finally { snap.recordingsChecked = Date.now(); }
        })().finally(() => { snap.recordingsPending = null; if (selected === snap) renderRecordings(); });
        return snap.recordingsPending;
    }
    function syncAudio() {
        if (!currentPoem || !ready) return;
        selected = snapshot(); renderParts();
        renderRecordings();
        if (!selected.recordingsChecked || Date.now() - selected.recordingsChecked > 5000) refreshRecordings(selected);
        if (Date.now() - selected.checked > 5000) refreshAvailability(selected);
    }
    function partState(snap, i) {
        if (snap.availability[i]?.state === 'saved') return 'saved';
        let work = jobs.get(snap.id);
        const baseState = snap.availability[i]?.state || 'checking';
        if (!work && snap.provider === 'local' && snap.voice === 'feminine') {
            const collectionWork = jobs.get(`collection:${snap.book.id}`);
            const offset = collectionWork?.snap.requests.findIndex(request => request.title === snap.requests[0].title && request.text === snap.requests[0].text) ?? -1;
            if (offset >= 0) { work = collectionWork; i += offset; }
        }
        if (!work || i < work.start || i >= work.end) return baseState;
        const offset = work.indices ? work.indices.indexOf(i) : i - work.start;
        if (offset < 0) return baseState;
        const job = work.job;
        if (!job) return 'queued';
        if (job.partProgress) {
            const stage = job.partProgress[offset]?.stage;
            return stage === 'done' ? 'saved' : stage === 'failed' ? 'failed' : stage === 'retrying' ? 'retrying' : ['starting', 'generating'].includes(stage) ? 'generating' : baseState;
        }
        if (offset < job.completed || job.state === 'done') return 'saved';
        if (work.error) return 'unknown';
        const active = generationPartIndex(work, (job.part || job.completed + 1) - 1);
        if (job.state === 'failed') return i === active ? 'failed' : baseState;
        if (i === active && job.state === 'running') return job.stage === 'retrying' ? 'retrying' : ['waiting', 'pacing'].includes(job.stage) ? 'queued' : 'generating';
        return 'queued';
    }
    function renderParts() {
        if (!selected || !$('readerParts')) return;
        const index = Number(poemAudioPart.value) || 0;
        const options = [...$('readerPartSelect').options];
        if (options.length !== selected.requests.length) $('readerPartSelect').replaceChildren(...selected.requests.map((_, i) => new Option(`Part ${i + 1}`, i)));
        $('readerPartSelect').value = index;
        // Window the strip for large works; the selector still reaches every part.
        const start = Math.max(0, Math.min(index - 20, selected.requests.length - 60));
        const focusedIndex = $('readerParts').contains(document.activeElement) ? document.activeElement.dataset.index : null;
        $('readerParts').replaceChildren(...selected.requests.slice(start, start + 60).map((_, offset) => {
            const i = start + offset, state = partState(selected, i);
            const button = node('button', 'reader-part', `${i + 1} · ${state === 'unknown' ? 'check unavailable' : state}`);
            button.type = 'button'; button.dataset.index = i; button.dataset.state = state; button.setAttribute('aria-pressed', String(i === index)); button.onclick = () => choosePart(i); return button;
        }));
        if (focusedIndex !== null) $('readerParts').querySelector(`[data-index="${focusedIndex}"]`)?.focus({ preventScroll: true });
        $('readerListenNote').textContent = `${ttsVoiceName(selected.voice, selected.provider)} · Part ${index + 1} of ${selected.requests.length}`;
        const work = jobs.get(selected.id);
        $('readerGenerationProgress').hidden = !work;
        if (work) {
            $('readerGenerationCounts').textContent = generationCounts(work);
            $('readerGenerationMeter').max = work.job?.total || work.indices?.length || work.end - work.start;
            $('readerGenerationMeter').value = generationStates(work).filter(state => state === 'done').length;
            $('readerGenerationDetail').textContent = generationMessage(work);
            const total = work.job?.total || work.indices?.length || work.end - work.start;
            $('readerGenerationDots').replaceChildren(...Array.from({ length: total }, (_, offset) => {
                const state = generationPartState(work, offset), number = generationPartIndex(work, offset) + 1;
                const dot = node('span', 'reader-generation-dot', String(number));
                dot.dataset.state = state;
                dot.title = `Part ${number}: ${state === 'generating' ? 'underway' : state.replace('-', ' ')}`;
                dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', dot.title);
                return dot;
            }));
        }
        const savedCount = selected.requests.filter((_, i) => partState(selected, i) === 'saved').length;
        const phase = work?.running ? work.error ? 'Reconnecting' : work.job?.stage === 'retrying' ? 'Retrying' : work.job?.state === 'queued' || ['waiting', 'pacing'].includes(work.job?.stage) ? 'Queued' : 'Generating' : work?.error ? 'Progress unavailable' : work?.job?.state === 'failed' ? 'Stopped' : '';
        $('readerPartSummary').textContent = `Audio parts · ${savedCount} saved${phase ? ` · ${phase}` : ''}`;
        $('readerProgress').textContent = work ? generationMessage(work) : (selected.availability.some(p => p.state === 'unknown') ? 'Some saved audio could not be checked. Try Check saved audio again.' : `${savedCount} of ${selected.requests.length} parts saved`);
        $('readerResume').hidden = work?.job?.state !== 'failed' && !work?.error;
        $('readerListen').disabled = false;
        $('readerStream').hidden = $('readerStopStream').hidden = selected.provider !== 'local';
    }
    function choosePart(index) {
        poemAudioPart.value = index; poemAudioPart.dispatchEvent(new Event('change')); renderParts();
    }
    function generationChoice() {
        if (!selected) return;
        const index = Number(poemAudioPart.value) || 0;
        const work = jobs.get(selected.id);
        if (work?.running) { $('readerProgress').textContent = work.message || 'This reading is already queued.'; return; }
        $('readerGenerationInfo').textContent = `${ttsVoiceName(selected.voice, selected.provider)} · ${selected.provider === 'gemini' ? selected.model : 'Local narration'} · Part ${index + 1} of ${selected.requests.length}. `
            + (selected.provider === 'gemini' ? `${formatGeminiTtsCost(selected.requests[index].text, 'Current part')}; ${formatGeminiTtsCost(selected.requests.slice(index).map(p => p.text).join('\n'), 'Remaining range before saved-part reuse')}. ` : '')
            + 'Saved parts are reused. Change voice or model in Audio settings.';
        $('readerGenerateRemaining').hidden = selected.requests.length - index <= 1;
        $('readerGeneration').showModal();
    }
    async function listenCurrent() {
        if (!selected) return;
        const snap = selected, index = Number(poemAudioPart.value) || 0;
        await refreshAvailability(snap);
        if (selected !== snap) return;
        if (snap.availability[index].state === 'saved') await startPlayback(snap, index);
        else generationChoice();
    }
    async function playSelected() { selected = snapshot(); await startPlayback(selected, Number(poemAudioPart.value) || 0); }
    async function startPlayback(snap, index, autoPlay = true, resumeAt = 0) {
        const version = ++playVersion;
        LocalSpeech.stop();
        poemAudioPlayer.pause();
        if (!snap.availability[index]?.url) await refreshAvailability(snap);
        if (version !== playVersion) return;
        playback = { ...snap, index }; updateDock();
        const part = snap.availability[index];
        if (!part?.url) {
            poemAudioPlayer.removeAttribute('src'); poemAudioPlayer.load();
            $('readerPlayerStatus').textContent = `Part ${index + 1} ${part?.state === 'unknown' ? 'could not be checked' : 'is not saved'}. Return to the text to check or generate it.`;
            persistPlayback(); return;
        }
        $('readerPlayerStatus').textContent = '';
        poemAudioPlayer.src = part.url;
        if (resumeAt > 0) poemAudioPlayer.addEventListener('loadedmetadata', () => {
            if (version === playVersion && Number.isFinite(poemAudioPlayer.duration)) poemAudioPlayer.currentTime = Math.min(resumeAt, Math.max(0, poemAudioPlayer.duration - 0.1));
        }, { once: true });
        if (currentBook?.id === snap.book.id && currentPoem && getPoemId(currentPoem) === getPoemId(snap.poem) && selected?.id === snap.id) { poemAudioPart.value = index; renderParts(); }
        if (autoPlay) await safePlay();
        persistPlayback(); updateDock();
    }
    async function safePlay() {
        if (!poemAudioPlayer.getAttribute('src')) return;
        try { await poemAudioPlayer.play(); } catch { $('readerPlayerStatus').textContent = 'Press Play to start this recording.'; }
    }
    function stepPlayback(direction) {
        if (!playback) return;
        const index = playback.index + direction;
        if (index >= 0 && index < playback.requests.length) startPlayback(playback, index);
    }
    function ended() {
        if (!playback) return;
        if (playback.index + 1 < playback.requests.length) stepPlayback(1);
        else { $('readerPlayerStatus').textContent = 'Reading finished.'; updateDock(); persistPlayback(); }
    }
    function closePlayer() {
        ++playVersion;
        playback = null;
        poemAudioPlayer.pause();
        poemAudioPlayer.removeAttribute('src');
        poemAudioPlayer.load();
        write('playback', null);
        $('readerPlayer').hidden = true;
        document.body.classList.remove('reader-has-player');
        (isOpen() ? $('readerListen') : bookTitle).focus({ preventScroll: true });
    }
    function updateDock() {
        if (!playback) return;
        $('readerPlayer').hidden = false; document.body.classList.add('reader-has-player');
        $('readerPlayingTitle').textContent = playback.poem.title;
        $('readerPlayingDetail').textContent = `${playback.book.name} · ${ttsVoiceName(playback.voice, playback.provider)} · Part ${playback.index + 1} of ${playback.requests.length}`;
        $('readerPlayPause').textContent = poemAudioPlayer.paused ? 'Play' : 'Pause';
        $('readerPrevPart').disabled = playback.index === 0; $('readerNextPart').disabled = playback.index >= playback.requests.length - 1;
    }
    function persistPlayback() {
        if (!playback) return;
        lastPlaybackSave = Date.now();
        write('playback', { book: playback.book.id, entry: getPoemId(playback.poem), voice: playback.voice, provider: playback.provider, model: playback.model, requests: playback.requests, browserKeys: playback.browserKeys, index: playback.index, time: poemAudioPlayer.currentTime || 0, urls: playback.external ? playback.availability.map(p => p.url?.startsWith('/') ? p.url : null) : undefined });
    }
    async function restorePlayback() {
        const restoreVersion = playVersion;
        const saved = read('playback', null), book = saved && allBooks.find(b => b.id === saved.book);
        if (!book || !Array.isArray(saved.requests) || !saved.requests.length || saved.requests.length > 10000) return;
        try {
            const poems = book.id === currentBook?.id ? allPoems : book.userPoems ? await loadUserPoems() : await fetchJson(book.poems);
            const poem = poems.find(p => getPoemId(p) === saved.entry); if (!poem || playVersion !== restoreVersion) return;
            const snap = { id: `${entryKey(book, poem)}:${saved.provider}:${saved.model}:${saved.voice}`, poem, book, provider: saved.provider, model: saved.model, voice: saved.voice, requests: saved.requests, browserKeys: saved.browserKeys || [], availability: saved.requests.map((_, i) => ({ state: saved.urls?.[i] ? 'saved' : 'checking', url: saved.urls?.[i] || null })), external: Boolean(saved.urls) };
            if (snap.external && snap.availability.every(p => !p.url)) return;
            await startPlayback(snap, Math.max(0, Math.min(saved.index || 0, snap.requests.length - 1)), false, saved.time || 0);
        } catch { /* Stale or offline history must not prevent reading. */ }
    }
    function playExternal(url, label = 'Saved recording', urls = null) {
        if (!currentPoem || !currentBook) return;
        const list = urls?.length ? urls : [url];
        const snap = { id: `${entryKey(currentBook, currentPoem)}:recording`, poem: currentPoem, book: currentBook, voice: label, provider: 'recording', model: '', requests: list.map(() => ({})), browserKeys: [], availability: list.map(url => ({ state: 'saved', url })), external: true };
        startPlayback(snap, Math.max(0, list.indexOf(url)));
    }
    function generationPartState(work, offset) {
        const job = work.job;
        if (work.snap.availability[generationPartIndex(work, offset)]?.state === 'saved') return 'done';
        if (job?.partProgress) {
            const stage = job.partProgress[offset]?.stage;
            return stage === 'done' ? 'done' : stage === 'failed' ? 'failed' : stage === 'retrying' ? 'retrying' : ['starting', 'generating'].includes(stage) ? 'generating' : 'queued';
        }
        if (job && (offset < job.completed || job.state === 'done')) return 'done';
        if (work.error) return 'unknown';
        if (!job) return 'connecting';
        const active = (job.part || job.completed + 1) - 1;
        if (job.state === 'failed') return offset === active ? 'failed' : 'not-started';
        if (job.state === 'running' && offset === active && !['waiting', 'pacing'].includes(job.stage)) {
            return job.stage === 'retrying' ? 'retrying' : 'generating';
        }
        return 'queued';
    }
    function generationPartIndex(work, offset) {
        return work.indices ? work.indices[offset] : work.start + offset;
    }
    function generationStates(work) {
        return Array.from({ length: work.job?.total || work.indices?.length || work.end - work.start }, (_, offset) => generationPartState(work, offset));
    }
    function generationCounts(work) {
        const job = work.job, states = generationStates(work), total = states.length;
        const done = states.filter(state => state === 'done').length;
        const range = `Parts ${work.start + 1}–${work.end}`;
        if (work.error) return `${range} · ${done} of ${total} done at last update · progress unavailable`;
        if (!job) return `${range} · connecting to generation progress…`;
        if (job.state === 'failed') return `${range} · ${done} done · ${states.filter(state => state === 'failed').length} failed · ${states.filter(state => state === 'not-started').length} not started`;
        const underway = states.filter(state => state === 'generating' || state === 'retrying').length;
        return `${range} · ${done} done · ${underway} underway · ${states.filter(state => state === 'queued').length} queued`;
    }
    function generationMessage(work) {
        if (work.error) return work.error;
        const job = work.job;
        if (!job) return work.error || 'Connecting to the narration queue…';
        if (job.state === 'failed') return `Part ${generationPartIndex(work, (job.part || job.completed + 1) - 1) + 1} · ${(job.error || 'Narration stopped. Resume missing parts to retry.').replace(/^Stopped at part \d+ of \d+\.\s*/, '')}`;
        if (job.state === 'done') return `Ready · ${job.total} parts · ${job.reused} reused.`;
        const index = generationPartIndex(work, (job.part || job.completed + 1) - 1) + 1;
        const count = `${generationStates(work).filter(state => state === 'done').length} of ${job.total} requested parts saved`;
        const elapsed = job.stageStartedAt ? ` · ${Math.max(0, Math.floor(Date.now() / 1000 - job.stageStartedAt))}s elapsed` : '';
        if (job.stage === 'pacing') return `${count} · Part ${index} · pacing requests · starts in ${Math.max(0, Math.ceil(job.retryAt - Date.now() / 1000))}s`;
        if (job.stage === 'retrying') return `${count} · Part ${index} · ${job.retryReason || 'Temporary provider error'} · retry in ${Math.max(0, Math.ceil(job.retryAt - Date.now() / 1000))}s · attempt ${job.attempt + 1}/${job.maxAttempts}`;
        if (job.state === 'queued' || job.stage === 'waiting') return `${count} · Part ${index} · waiting for the narration queue${elapsed}`;
        return `${count} · Part ${index} · ${job.stage || 'generating'}${job.chunks > 1 ? ` · segment ${job.chunk}/${job.chunks}` : ''}${job.attempt ? ` · attempt ${job.attempt}/${job.maxAttempts || 1}` : ''}${elapsed}`;
    }
    function renderJobs() {
        const queue = $('readerQueue'); queue.hidden = !jobs.size;
        $('readerQueueJump').hidden = !jobs.size;
        $('readerQueueJump').textContent = `${jobs.size} ${jobs.size === 1 ? 'job' : 'jobs'}`;
        queue.replaceChildren(...[...jobs.values()].map(work => {
            work.message = generationMessage(work);
            const row = node('div', 'reader-queue-row');
            const button = node('button', '', work.snap.poem.title); button.onclick = () => navigate(urlFor(work.snap.book, work.snap.collection ? null : work.snap.poem));
            row.append(button, node('span', '', `${generationCounts(work)} · ${work.message}`));
            if (work.running && work.job?.id) {
                const stop = node('button', '', work.job.stopRequested ? 'Stopping…' : 'Stop');
                stop.disabled = Boolean(work.job.stopRequested);
                stop.onclick = async () => {
                    stop.disabled = true;
                    try {
                        work.job = await fetchJson(`/api/tts/jobs/${encodeURIComponent(work.job.id)}/cancel`, { method: 'POST' });
                    } catch (error) { work.error = `Could not stop narration: ${error.message}`; }
                    renderJobs();
                };
                row.append(stop);
            }
            if (!work.running) { const dismiss = node('button', '', 'Dismiss'); dismiss.onclick = () => { jobs.delete(work.snap.id); renderJobs(); renderParts(); }; row.append(dismiss); }
            return row;
        }));
        renderParts(); updateAudioControls();
    }
    async function generateSelected(remaining) {
        if (generationCheckPending) return;
        if (!selected) selected = snapshot();
        selected = snapshot();
        const snap = selected, start = Number(poemAudioPart.value) || 0;
        if (jobs.get(snap.id)?.running) return;
        const end = remaining ? snap.requests.length : start + 1;
        generationCheckPending = true;
        try {
            await Promise.all([refreshAvailability(snap), refreshRecordings(snap)]);
            if (selected !== snap || !isOpen()) return;
            if (snap.availability.slice(start, end).every(part => part.state === 'saved')) {
                return startPlayback(snap, start);
            }
            const rangeKnown = snap.availability.slice(start, end).every(part => ['saved', 'missing'].includes(part.state));
            if ((!remaining && snap.recordings?.length) || (!rangeKnown && remaining) || (!remaining && snap.recordingsError)) {
                const unknown = snap.recordingsError || !rangeKnown;
                $('readerDuplicateTitle').textContent = unknown ? 'Could not check saved audio' : 'Saved audio already exists';
                $('readerDuplicateMessage').textContent = (unknown
                    ? 'The shared library could not be checked. Generating now could repeat audio you already have. '
                    : `“${snap.poem.title}” already has ${snap.recordings.length} saved recording${snap.recordings.length === 1 ? '' : 's'}. Some or all of the requested text may already be recorded, including versions with different part boundaries. `)
                    + `You selected ${ttsVoiceName(snap.voice, snap.provider)} · ${snap.provider === 'gemini' ? snap.model : 'Local narration'}, part${end - start > 1 ? 's' : ''} ${start + 1}${end - start > 1 ? `–${end}` : ''}. Creating another version will generate new audio${snap.provider === 'gemini' ? ' and may incur charges' : ''}.`;
                $('readerDuplicateVersions').replaceChildren(...(snap.recordings || []).map(record => node('li', '', record.filename.replace(/\.wav$/i, '') + (record.model ? ` · ${record.model}` : ''))));
                $('readerDuplicateSaved').hidden = !snap.recordings?.length;
                $('readerDuplicateContinue').textContent = unknown ? 'Generate without checking' : 'Generate another version';
                const choice = await new Promise(resolve => {
                    resolveDuplicateChoice = resolve; $('readerDuplicateWarning').showModal();
                    $(snap.recordings?.length ? 'readerDuplicateSaved' : 'readerDuplicateCancel').focus();
                });
                if (selected !== snap || !isOpen()) return;
                if (choice === 'saved') {
                    renderRecordings(); $('readerSavedSelect').scrollIntoView({block:'center'}); $('readerSavedSelect').focus(); return;
                }
                if (choice !== 'generate') return;
            }
        } finally { generationCheckPending = false; }
        return runGeneration(snap, start, end);
    }
    async function runGeneration(snap, start, end) {
        const indices = snap.requests.map((_, i) => i).filter(i => i >= start && i < end && snap.availability[i]?.state !== 'saved');
        if (!indices.length) return;
        const work = { snap, start, end, indices, running: true, job: null, message: '', error: '' };
        jobs.set(snap.id, work); renderJobs();
        const headers = { 'Content-Type': 'application/json' }, key = getGeminiApiKey();
        if (key) headers['X-Gemini-API-Key'] = key;
        async function request(url, options) {
            for (let attempt = 0; attempt < 5; attempt++) {
                try { return await fetchJson(url, options); }
                catch (error) {
                    if (error.status && ![408, 429, 500, 502, 503, 504].includes(error.status)) throw error;
                    if (attempt === 4) throw new Error('Progress connection lost. Resume missing parts to reconnect; saved audio is kept.');
                    work.error = `Reconnecting (${attempt + 1}/4)…`; renderJobs();
                    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
                }
            }
        }
        try {
            work.job = await request('/api/tts/jobs', { method: 'POST', headers, body: JSON.stringify({ parts: indices.map(i => snap.requests[i]) }) });
            while (true) {
                if (!['queued', 'running', 'done', 'failed'].includes(work.job?.state) || !work.job.id) throw new Error('Invalid queue response. Resume to reconnect.');
                renderJobs();
                if (work.job.state === 'failed') break;
                if (work.job.state === 'done') break;
                if (!snap.collection && Date.now() - snap.checked > 10000) refreshAvailability(snap);
                await new Promise(resolve => setTimeout(resolve, 1500));
                work.job = await request(`/api/tts/jobs/${encodeURIComponent(work.job.id)}`); work.error = '';
            }
        } catch (error) {
            work.error = error.message;
            if ([401, 403].includes(error.status)) geminiKeySetup.hidden = false;
        } finally {
            work.running = false; if (!snap.collection) await refreshAvailability(snap); else if (selected?.book.id === snap.book.id) await refreshAvailability(selected); renderJobs();
        }
    }
    async function boot(data) {
        manifest = [...data.books, ...(data.externalBooks || [])]; ready = true;
        await navigate(new URL(location.href), false);
        restorePlayback();
    }
    function beforeBook() { savePosition(); selectingBook = true; }
    function bookSelected(book) { selectingBook = false; if (ready) { showLibrary(false); recordUrl(urlFor(book)); } }
    function updateAudioControls() {
        if (!selected) return;
        const i = Number(poemAudioPart.value) || 0, available = selected.availability[i];
        const work = jobs.get(selected.id);
        const busy = Boolean(work?.running);
        const saved = available?.state === 'saved';
        const savedKeys = savedRecordingParts(selected.recordings, selected.voice, selected.provider, ttsModelKey(selected.provider));
        const savedVersion = !selected.availability.every(part => part.state === 'saved') && savedKeys.length > 0;
        if (!stitchChapterAudio.disabled) stitchChapterAudio.textContent = savedVersion ? `Join ${savedKeys.length} saved recording parts` : 'Make one chapter file';
        generateAudio.hidden = saved; playSavedAudio.hidden = !saved;
        generateAudio.disabled = busy; generateAllAudio.disabled = busy;
        generateAudio.textContent = `Generate part ${i + 1}`;
        generateAllAudio.textContent = `Generate missing parts ${i + 1}–${selected.requests.length}`;
        playAllAudio.textContent = `Play part ${i + 1} to end`;
        generateAllAudio.hidden = playAllAudio.hidden = stitchChapterAudio.hidden = selected.requests.length <= 1;
        ttsProvider.disabled = geminiTtsModel.disabled = poemVoice.disabled = poemAudioPart.disabled = false;
        playCompleteChapter.hidden = downloadCompleteChapter.hidden = !selected.completeUrl;
        if (selected.completeUrl) {
            downloadCompleteChapter.href = downloadableAudioUrl(selected.completeUrl);
            downloadCompleteChapter.download = `${selected.poem.title} - Complete chapter.wav`;
        }
        setDownloadLink(downloadAudio, saved ? downloadableAudioUrl(available.url) : '', selected.requests[i].filename);
        if (work && (busy || work.error || work.job?.state === 'failed')) setPoemAudioStatus(generationMessage(work), work.error || work.job?.state === 'failed' ? 'error' : 'working');
        else if (savedVersion) setPoemAudioStatus(`${savedKeys.length} saved recording parts available · Current text uses different parts. Choose Join saved recording parts to download the saved version.`, 'ready');
        else setPoemAudioStatus(saved ? `Selected part ${i + 1} saved · ${ttsVoiceName(selected.voice, selected.provider)}` : `Selected part ${i + 1} · ${available?.state || 'checking'} · Choose Listen or Generate.`, saved ? 'ready' : 'idle');
    }
    function rememberComplete(snap, url, label = 'Complete chapter') {
        if (!snap) return;
        snap.completeUrl = url;
        snap.completeLabel = label;
        if (selected === snap) updateAudioControls();
    }
    function playComplete() {
        if (!selected?.completeUrl) return;
        playExternal(selected.completeUrl, selected.completeLabel || 'Complete chapter');
    }
    function renderAudio() {
        syncAudio(); updateAudioControls();
        const snap = selected;
        if (snap?.book.id === 'new-england-mind' && snap.poem.title === 'Chapter V · The Instrument of Reason' && !snap.checkedComplete) {
            snap.checkedComplete = true;
            fetch(chapterVCompleteUrl, { method: 'HEAD' }).then(response => {
                if (response.ok) rememberComplete(snap, chapterVCompleteUrl);
            }).catch(() => { snap.checkedComplete = false; });
        }
    }
    function readingFollowPart() {
        if (!playback) return Number(poemAudioPart.value) || 0;
        if (!currentPoem || currentBook?.id !== playback.book.id
            || getPoemId(currentPoem) !== getPoemId(playback.poem)) return undefined;
        // A single external recording covers the chapter; a recording list
        // follows its own part index, independently of the generation settings.
        if (playback.external) return playback.requests.length === 1 ? null : playback.index;
        return playback.index;
    }
    function matchesPlaying() { return readingFollowPart() !== undefined; }
    document.addEventListener('DOMContentLoaded', install);
    return { boot, beforeOpen, opened, closed, savePosition, renderContents, beforeBook, bookSelected, updatePanelSemantics, syncAudio, renderAudio,
        playSelected, playExternal, ended, matchesPlaying, readingFollowPart, generateSelected, rememberComplete, playComplete, capture: () => snapshot(),
        get active() { return ready; }, get preview() { return preview; },
        // Pure state projection is also used by the regression checks.
        partState };
})();
