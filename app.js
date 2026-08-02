// Poetry Website Application
let allPoems = [];
let filteredPoems = [];
const poemChatSessions = new WeakMap();
const CHAT_PROXY_URL = '/api/chat';
const FALLBACK_MODEL = 'unsloth/gemma-4-26B-A4B-it-NVFP4';
const FLUX_PROXY_URL = '/api/flux';
const CHAT_STORAGE_PREFIX = 'john-donne-poem-session-v1:';
const RECENT_POEMS_STORAGE = 'john-donne-recent-poems-v1';
const SELECTED_BOOK_STORAGE = 'john-donne-selected-book';
const IMAGE_STYLES_STORAGE = 'john-donne-image-styles';
const IMAGE_STEER_STORAGE = 'john-donne-image-steer';
const VOICE_NAMES = { feminine: 'Gacrux', masculine: 'Algieba', companion: 'Iapetus' };
let selectedStyleLabels = new Set();
const RECENT_POEMS_LIMIT = 8;
const IMAGE_API_KEY_STORAGE = 'john-donne-flux-api-key';
const GEMINI_API_KEY_STORAGE = 'john-donne-gemini-api-key';
const BRIEF_MODE_STORAGE = 'john-donne-chat-brief';
const READ_REPLIES_STORAGE = 'john-donne-chat-read-replies';
const poemSceneCache = new Map();
const AUDIO_DB_NAME = 'john-donne-media-v1';
const AUDIO_STORE_NAME = 'audio';
let allBooks = [];
let currentBook = null;
let modelRequest = null;
let currentPoem = null;
let currentChatSession = null;
let pendingGeminiRetry = null;
let audioDatabaseRequest = null;
const responseAudioRequests = new Map();
let recentPoemIds = [];

// DOM Elements
const bookSwitcher = document.getElementById('bookSwitcher');
const bookTitle = document.getElementById('bookTitle');
const bookSubtitle = document.getElementById('bookSubtitle');
const bookDescription = document.getElementById('bookDescription');
const bookSourceLink = document.getElementById('bookSourceLink');
const bookSourceNote = document.getElementById('bookSourceNote');
const chatContext = document.getElementById('chatContext');
const poemsList = document.getElementById('poemsList');
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const resultCount = document.getElementById('resultCount');
const randomPoem = document.getElementById('randomPoem');
const recentPoemsSection = document.getElementById('recentPoemsSection');
const recentPoemsList = document.getElementById('recentPoemsList');
const poemModal = document.getElementById('poemModal');
const modalTitle = document.getElementById('modalTitle');
const modalContent = document.getElementById('modalContent');
const closeModal = document.getElementById('closeModal');
const chatStatus = document.getElementById('chatStatus');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const clearChat = document.getElementById('clearChat');
const chatBrief = document.getElementById('chatBrief');
const chatReadReplies = document.getElementById('chatReadReplies');
const generateImages = document.getElementById('generateImages');
const imageKeySetup = document.getElementById('imageKeySetup');
const imageApiKey = document.getElementById('imageApiKey');
const saveImageApiKey = document.getElementById('saveImageApiKey');
const imageSteer = document.getElementById('imageSteer');
const imageStyleOptions = document.getElementById('imageStyleOptions');
const imageStylesSummary = document.getElementById('imageStylesSummary');
const clearImageStyles = document.getElementById('clearImageStyles');
const poemImagesStatus = document.getElementById('poemImagesStatus');
const poemImagesGrid = document.getElementById('poemImagesGrid');
const poemVoice = document.getElementById('poemVoice');
const generateAudio = document.getElementById('generateAudio');
const geminiKeySetup = document.getElementById('geminiKeySetup');
const geminiApiKey = document.getElementById('geminiApiKey');
const saveGeminiApiKey = document.getElementById('saveGeminiApiKey');
const poemAudioStatus = document.getElementById('poemAudioStatus');
const poemAudioPlayer = document.getElementById('poemAudioPlayer');
const downloadAudio = document.getElementById('downloadAudio');
const audioTimeRemaining = document.getElementById('audioTimeRemaining');
const audioTimeRemainingValue = document.getElementById('audioTimeRemainingValue');
let activeTimedAudio = null;
let audioRemainingFrame = null;

function formatAudioTime(seconds) {
    const wholeSeconds = Math.max(0, Math.ceil(seconds));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainder = wholeSeconds % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function hideAudioTimeRemaining(audio = activeTimedAudio) {
    if (audio !== activeTimedAudio) return;
    activeTimedAudio = null;
    audioTimeRemaining.hidden = true;
    if (audioRemainingFrame !== null) cancelAnimationFrame(audioRemainingFrame);
    audioRemainingFrame = null;
}

function updateAudioTimeRemaining() {
    const audio = activeTimedAudio;
    if (!audio || audio.paused || audio.ended || !audio.isConnected) {
        hideAudioTimeRemaining(audio);
        return;
    }

    const remaining = audio.duration - audio.currentTime;
    audioTimeRemainingValue.textContent = Number.isFinite(remaining)
        ? formatAudioTime(remaining)
        : '--:--';
    audioRemainingFrame = requestAnimationFrame(updateAudioTimeRemaining);
}

function showAudioTimeRemaining(audio) {
    activeTimedAudio = audio;
    audioTimeRemaining.hidden = false;
    if (audioRemainingFrame !== null) cancelAnimationFrame(audioRemainingFrame);
    updateAudioTimeRemaining();
}

// Load the collection manifest, then the poems of the selected book
async function loadBooks() {
    try {
        const response = await fetch('books.json');
        if (!response.ok) throw new Error(`books.json returned ${response.status}`);
        const manifest = await response.json();
        allBooks = Array.isArray(manifest.books) ? manifest.books : [];
        if (!allBooks.length) throw new Error('books.json lists no collections.');
    } catch (error) {
        console.error('Error loading collections:', error);
        showError('Failed to load the collection list. Please try again later.');
        return;
    }

    renderBookSwitcher();
    await selectBook(getStoredBookId() || allBooks[0].id);
}

function getStoredBookId() {
    try {
        const stored = localStorage.getItem(SELECTED_BOOK_STORAGE);
        return allBooks.some(book => book.id === stored) ? stored : '';
    } catch {
        return '';
    }
}

function renderBookSwitcher() {
    bookSwitcher.replaceChildren();
    // A single collection needs no switcher.
    bookSwitcher.hidden = allBooks.length < 2;
    if (bookSwitcher.hidden) return;

    allBooks.forEach(book => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'book-switch';
        button.dataset.bookId = book.id;
        button.textContent = book.name;
        button.addEventListener('click', () => selectBook(book.id));
        bookSwitcher.appendChild(button);
    });
}

async function selectBook(bookId) {
    const book = allBooks.find(item => item.id === bookId);
    if (!book || book === currentBook) return;

    currentBook = book;
    try {
        localStorage.setItem(SELECTED_BOOK_STORAGE, book.id);
    } catch {
        // A blocked storage quota should not prevent the switch.
    }

    closePoemModal();
    searchInput.value = '';
    clearSearch.style.display = 'none';
    applyBookIdentity(book);

    try {
        const response = await fetch(book.poems);
        if (!response.ok) throw new Error(`${book.poems} returned ${response.status}`);
        allPoems = await response.json();
    } catch (error) {
        console.error('Error loading poems:', error);
        showError('Failed to load poems. Please try again later.');
        return;
    }

    filteredPoems = allPoems;
    displayPoems(allPoems);
    updateResultCount(allPoems.length, allPoems.length);
    loadRecentlyVisited();
}

function applyBookIdentity(book) {
    document.title = book.title;
    bookTitle.textContent = book.title;
    bookSubtitle.textContent = book.subtitle;
    bookDescription.textContent = book.description;
    bookSourceLink.href = book.sourceUrl;
    bookSourceNote.textContent = book.sourceNote;
    chatContext.textContent = book.chatContext;
    searchInput.placeholder = `Search ${book.name} by title or content…`;
    bookSwitcher.querySelectorAll('.book-switch').forEach(button => {
        const selected = button.dataset.bookId === book.id;
        button.classList.toggle('book-switch--active', selected);
        button.setAttribute('aria-current', selected ? 'true' : 'false');
    });
}

function getPoemId(poem) {
    return stableHash(`${poem.title}\n${poem.content}`);
}

// Recents are per collection; ids from one book never resolve in another.
function getRecentPoemsKey() {
    return `${RECENT_POEMS_STORAGE}:${currentBook.id}`;
}

function saveRecentlyVisited() {
    try {
        localStorage.setItem(getRecentPoemsKey(), JSON.stringify(recentPoemIds));
    } catch (error) {
        console.warn('Could not save recently visited poems:', error);
    }
}

function loadRecentlyVisited() {
    try {
        const stored = JSON.parse(localStorage.getItem(getRecentPoemsKey()) || '[]');
        recentPoemIds = Array.isArray(stored)
            ? stored.filter(id => typeof id === 'string').slice(0, RECENT_POEMS_LIMIT)
            : [];
    } catch (error) {
        console.warn('Could not restore recently visited poems:', error);
        recentPoemIds = [];
    }
    renderRecentlyVisited();
}

function renderRecentlyVisited() {
    const poemsById = new Map(allPoems.map(poem => [getPoemId(poem), poem]));
    const recentPoems = recentPoemIds.map(id => poemsById.get(id)).filter(Boolean);
    recentPoemsSection.hidden = recentPoems.length === 0;
    recentPoemsList.replaceChildren();

    recentPoems.forEach(poem => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-poem-link';
        button.textContent = poem.title;
        button.addEventListener('click', () => openPoemModal(poem));
        recentPoemsList.appendChild(button);
    });
}

function recordPoemVisit(poem) {
    const poemId = getPoemId(poem);
    recentPoemIds = [poemId, ...recentPoemIds.filter(id => id !== poemId)]
        .slice(0, RECENT_POEMS_LIMIT);
    saveRecentlyVisited();
    renderRecentlyVisited();
}

function openRandomPoem() {
    if (!allPoems.length) return;
    const candidates = allPoems.length > 1 && currentPoem
        ? allPoems.filter(poem => poem !== currentPoem)
        : allPoems;
    openPoemModal(candidates[Math.floor(Math.random() * candidates.length)]);
}

// Display poems in grid
function displayPoems(poems) {
    if (poems.length === 0) {
        poemsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📖</div>
                <div class="empty-state-text">No poems found matching your search.</div>
            </div>
        `;
        return;
    }

    poemsList.innerHTML = poems.map((poem, index) => {
        const preview = getPreview(poem.content);
        return `
            <div class="poem-card" data-index="${index}">
                <h3 class="poem-title">${escapeHtml(poem.title)}</h3>
                <p class="poem-preview">${escapeHtml(preview)}</p>
                <span class="read-more">Read Full Poem →</span>
            </div>
        `;
    }).join('');

    // Add click event listeners to poem cards
    document.querySelectorAll('.poem-card').forEach(card => {
        card.addEventListener('click', () => {
            const index = parseInt(card.dataset.index);
            openPoemModal(filteredPoems[index]);
        });
    });
}

// Get preview text from poem content
function getPreview(content) {
    // Get first few lines, max 150 characters
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    let preview = lines.slice(0, 3).join(' ');
    
    if (preview.length > 150) {
        preview = preview.substring(0, 150) + '...';
    } else if (lines.length > 3) {
        preview += '...';
    }
    
    return preview;
}

// Clean poem content for display
function cleanPoemContent(content, title = '') {
    // These rules strip Grierson's textual apparatus. Editions without one are
    // returned untouched: the year test alone would cut a poem at any date.
    if (!currentBook || !currentBook.stripEditorialApparatus) return content.trim();

    const lines = content.split('\n');
    const cleanedLines = [];
    const normalizedTitle = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    let hasContent = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Printed page markers can occur in the middle of longer poems.
        if (/^\[(?:pg|page)\s+\d+\]$/i.test(trimmed)) continue;

        const normalizedLine = trimmed.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const repeatsTitle = (
            normalizedTitle
            && (
                normalizedLine === normalizedTitle
                || (normalizedTitle.length >= 8 && normalizedLine.startsWith(`${normalizedTitle} `))
            )
        );
        const containsEditionYear = (
            !/^\d{4}\s/.test(trimmed)
            && /\b(?:15|16|17|18)\d{2}(?:-\d{2,4})?\b/.test(trimmed)
        );
        const containsManuscriptSiglum = /\b(?:A\d{2}|H\d{2}|L\d{2}|S96|RP\d+|TCC|TCD|O'F)\b/.test(trimmed);
        const beginsEditorialApparatus = (
            containsEditionYear
            || /^##(?!#)\s/.test(trimmed)
            || /^(?:footnote|probably by|query|stanza prefixed)\b/i.test(trimmed)
            || /\bEd(?:itor)?[.:]/i.test(trimmed)
            || /\b(?:MSS?|manuscript|no title|first printed|printed here|published here)\b\.?/i.test(trimmed)
            || /punctuation (?:mainly )?(?:the )?editor/i.test(trimmed)
            || containsManuscriptSiglum
        );

        // A few entries begin with a short editorial description followed by
        // an attribution. Discard that preface and continue to the verse.
        if (/^probably by\b/i.test(trimmed) && cleanedLines.filter(item => item.trim()).length <= 2) {
            cleanedLines.length = 0;
            hasContent = false;
            continue;
        }

        if (!hasContent && beginsEditorialApparatus) continue;

        // Once verse has begun, the first apparatus marker ends the poem. The
        // remaining source lines are variant readings, not additional verse.
        if (hasContent && (repeatsTitle || beginsEditorialApparatus)) break;

        cleanedLines.push(line);
        if (trimmed) hasContent = true;
    }

    return cleanedLines.join('\n').trim();
}

// Render source line numbers in a separate gutter so they do not run into the verse.
function renderPoemContent(content, title) {
    const fragment = document.createDocumentFragment();
    const cleanedContent = cleanPoemContent(content, title);

    // Gutenberg separates each printed verse with two newlines and stanzas with
    // three. Remove the paragraph-export newline while retaining stanza space.
    const normalizedContent = cleanedContent.replace(/\n{2,}/g, newlines => (
        newlines.length === 2 ? '\n' : '\n\n'
    ));
    const lines = normalizedContent.split('\n');
    let startsNewStanza = false;

    lines.forEach(line => {
        // Preserve stanza structure without rendering a full-height empty row.
        if (!line.trim()) {
            startsNewStanza = true;
            return;
        }

        const lineElement = document.createElement('div');
        lineElement.className = 'poem-line';
        if (startsNewStanza) {
            lineElement.classList.add('poem-line--stanza-start');
            startsNewStanza = false;
        }

        const numberElement = document.createElement('span');
        numberElement.className = 'poem-line-number';
        numberElement.setAttribute('aria-hidden', 'true');

        const textElement = document.createElement('span');
        textElement.className = 'poem-line-text';

        // Gutenberg attaches verse numbers directly to their text (for example,
        // "5Take"). Only treat an unspaced numeric prefix as a line number.
        const numberedLine = (
            line.match(/^(\s*)(\d+)(?=[\p{L}'‘’“"(&])(.*)$/u)
            || line.match(/^(\s*)(\d*[05])(?=\d+\s)(.*)$/)
        );
        if (numberedLine) {
            numberElement.textContent = numberedLine[2];
            textElement.textContent = numberedLine[1] + numberedLine[3];
        } else {
            textElement.textContent = line;
        }

        lineElement.append(numberElement, textElement);
        fragment.appendChild(lineElement);
    });

    modalContent.replaceChildren(fragment);
}

function createSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `poem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function getPoemStorageKey(poem) {
    return `${CHAT_STORAGE_PREFIX}${stableHash(`${poem.title}\n${poem.content}`)}`;
}

// Blob URLs download as "download.wav" unless the anchor names them, so every
// saved file is titled "Poet - Poem - detail.ext".
function buildDownloadName(poem, parts, extension) {
    const clean = value => String(value)
        .replace(/[\\/:*?"<>|]+/g, ' ')     // characters filesystems reject
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const title = clean(poem.title).slice(0, 70).replace(/[.\s]+$/, '');
    const segments = [clean(currentBook.poet), title, ...parts.map(clean)].filter(Boolean);
    return `${segments.join(' - ')}.${extension}`;
}

function setDownloadLink(link, url, filename) {
    if (!url) {
        link.hidden = true;
        link.removeAttribute('href');
        return;
    }
    link.href = url;
    link.download = filename;
    link.title = `Download ${filename}`;
    link.hidden = false;
}

function getPoemAudioKey(poem, voice) {
    return `poem:${stableHash(`${poem.title}\n${poem.content}`)}:${voice}`;
}

function getResponseAudioKey(poem, content) {
    const poemHash = stableHash(`${poem.title}\n${poem.content}`);
    return `response:${poemHash}:${stableHash(content)}`;
}

function loadStoredPoemSession(poem) {
    try {
        const stored = JSON.parse(localStorage.getItem(getPoemStorageKey(poem)) || 'null');
        if (!stored || stored.context?.poemTitle !== poem.title) return null;
        return {
            id: typeof stored.id === 'string' ? stored.id : createSessionId(),
            messages: Array.isArray(stored.messages)
                ? stored.messages.filter(message => (
                    ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string'
                ))
                : [],
            model: typeof stored.model === 'string' ? stored.model : null,
            images: Array.isArray(stored.images)
                ? stored.images
                    .filter(image => (
                        image
                        && typeof image.prompt === 'string'
                        && image.status !== 'error'
                        && (!['queued', 'generating'].includes(image.status) || image.jobId)
                    ))
                : [],
            loading: false,
            imagesLoading: false,
            imagePollActive: false,
            audioLoading: false,
            abortController: null,
            imageObjectUrls: new Map(),
            audioByVoice: new Map(),
            audioCheckedVoices: new Set(),
            audioRestoringVoices: new Set(),
            responseAudioByText: new Map()
        };
    } catch (error) {
        console.warn('Could not restore saved poem session:', error);
        return null;
    }
}

function savePoemSession(poem, session) {
    try {
        localStorage.setItem(getPoemStorageKey(poem), JSON.stringify({
            version: 1,
            id: session.id,
            model: session.model,
            context: {
                poemTitle: poem.title,
                book: currentBook.id,
                author: currentBook.poet,
                source: currentBook.sourceNote
            },
            messages: session.messages,
            images: session.images,
            updatedAt: new Date().toISOString()
        }));
    } catch (error) {
        console.warn('Could not save poem session:', error);
        setChatStatus('Conversation active · browser storage unavailable', 'error');
    }
}

function getPoemChatSession(poem) {
    if (!poemChatSessions.has(poem)) {
        const restoredSession = loadStoredPoemSession(poem);
        poemChatSessions.set(poem, restoredSession || {
            id: createSessionId(),
            messages: [],
            model: null,
            images: [],
            loading: false,
            imagesLoading: false,
            imagePollActive: false,
            audioLoading: false,
            abortController: null,
            imageObjectUrls: new Map(),
            audioByVoice: new Map(),
            audioCheckedVoices: new Set(),
            audioRestoringVoices: new Set(),
            responseAudioByText: new Map()
        });
    }
    return poemChatSessions.get(poem);
}

function isBriefMode() {
    return chatBrief.checked;
}

function isReadRepliesMode() {
    return chatReadReplies.checked;
}

// Both chat toggles are read at send time, so a change applies to the next turn.
function restoreChatToggles() {
    try {
        chatBrief.checked = localStorage.getItem(BRIEF_MODE_STORAGE) === 'true';
        chatReadReplies.checked = localStorage.getItem(READ_REPLIES_STORAGE) === 'true';
    } catch {
        chatBrief.checked = false;
        chatReadReplies.checked = false;
    }
}

function saveChatToggles() {
    try {
        localStorage.setItem(BRIEF_MODE_STORAGE, String(chatBrief.checked));
        localStorage.setItem(READ_REPLIES_STORAGE, String(chatReadReplies.checked));
    } catch {
        // A blocked storage quota should not disable the toggles themselves.
    }
}

function buildPoemSystemPrompt(poem) {
    const poemText = cleanPoemContent(poem.content, poem.title)
        .replace(/\n{2,}/g, newlines => (newlines.length === 2 ? '\n' : '\n\n'));

    const lengthInstruction = isBriefMode()
        ? `\n\nBREVITY
Answer in at most three or four sentences. Lead with the direct answer, keep quotations to a few words, and omit preamble, restatement of the question, and closing offers of further help. Depth matters more than coverage: make one point well rather than surveying every reading. Expand only if the reader explicitly asks for more.`
        : '';

    return `You are a thoughtful literary conversation partner dedicated to the selected poem below.

AUTHOR
${currentBook.authorProfile}

SOURCE
${currentBook.sourceProfile}

SELECTED POEM
Title: ${poem.title}${poem.section ? `\nCluster: ${poem.section}` : ''}

${poemText}

INSTRUCTIONS
Discuss this specific poem with the reader. Ground close readings in the supplied text and quote briefly when useful. Explain archaic language and historical or literary context clearly. Distinguish established facts from interpretation, and say when something is uncertain. Do not invent lines, biographical details, or source claims. Keep answers conversational and responsive to the reader's level of detail.${lengthInstruction}`;
}

function setChatStatus(message, state = 'ready') {
    chatStatus.textContent = message;
    chatStatus.dataset.state = state;
}

function appendChatMessage(role, content, pending = false, options = {}) {
    const message = document.createElement('article');
    message.className = `chat-message chat-message--${role}`;
    if (pending) message.classList.add('chat-message--pending');

    const label = document.createElement('span');
    label.className = 'chat-message-label';
    label.textContent = role === 'user' ? 'You' : currentBook.companionLabel;

    const body = document.createElement('div');
    body.className = 'chat-message-body';
    body.textContent = content;

    message.append(label, body);
    if (role === 'assistant' && !pending && options.listen !== false) {
        addChatListenControl(message, content, options.session || currentChatSession);
    }
    chatMessages.appendChild(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return { message, body };
}

function renderChatWelcome() {
    appendChatMessage(
        'assistant',
        `I have the full text of “${currentPoem.title},” along with context about ${currentBook.poet} and the Project Gutenberg source. What would you like to explore?`,
        false,
        { listen: false }
    );

    const suggestions = document.createElement('div');
    suggestions.className = 'chat-suggestions';
    [
        'Give me a close reading',
        'Explain the central conceit',
        'What should I notice first?'
    ].forEach(prompt => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-suggestion';
        button.textContent = prompt;
        button.addEventListener('click', () => {
            chatInput.value = prompt;
            chatForm.requestSubmit();
        });
        suggestions.appendChild(button);
    });
    chatMessages.appendChild(suggestions);
}

function renderChatSession(session) {
    chatMessages.replaceChildren();
    if (session.messages.length === 0) {
        renderChatWelcome();
    } else {
        session.messages.forEach(message => appendChatMessage(message.role, message.content, false, { session }));
    }

    chatInput.disabled = session.loading;
    chatSend.disabled = session.loading;
    clearChat.disabled = session.loading;
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function resolveModel(session) {
    if (session.model) return session.model;
    if (!modelRequest) {
        modelRequest = fetch(`${CHAT_PROXY_URL}/v1/models`)
            .then(async response => {
                if (!response.ok) throw new Error(`Model discovery failed (${response.status})`);
                const payload = await response.json();
                return payload.data?.[0]?.id || FALLBACK_MODEL;
            })
            .catch(error => {
                modelRequest = null;
                throw error;
            });
    }
    session.model = await modelRequest;
    return session.model;
}

async function connectChatSession(session) {
    setChatStatus('Connecting to model…', 'connecting');
    try {
        const model = await resolveModel(session);
        if (currentChatSession === session && !session.loading) {
            setChatStatus(`Ready · ${model.split('/').pop()}`, 'ready');
        }
    } catch (error) {
        console.error('Unable to connect to vLLM:', error);
        if (currentChatSession === session) {
            setChatStatus('Model unavailable · retry by sending', 'error');
        }
    }
}

async function getApiError(response) {
    const text = await response.text();
    try {
        const payload = JSON.parse(text);
        return payload.error?.message || payload.detail || `Request failed (${response.status})`;
    } catch {
        return text || `Request failed (${response.status})`;
    }
}

async function readStreamingCompletion(response, onToken) {
    if (!response.body) {
        const payload = await response.json();
        const content = payload.choices?.[0]?.message?.content || '';
        onToken(content);
        return content;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completeText = '';

    const processLine = line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return false;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return true;

        try {
            const payload = JSON.parse(data);
            const token = payload.choices?.[0]?.delta?.content || '';
            if (token) {
                completeText += token;
                onToken(completeText);
            }
        } catch (error) {
            console.warn('Ignored malformed streaming event:', error);
        }
        return false;
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        if (lines.some(processLine)) break;
    }

    buffer += decoder.decode();
    if (buffer) processLine(buffer);
    return completeText;
}

async function sendChatMessage(event) {
    event.preventDefault();
    const prompt = chatInput.value.trim();
    const poem = currentPoem;
    const session = currentChatSession;
    if (!prompt || !poem || !session || session.loading) return;

    session.messages.push({ role: 'user', content: prompt });
    savePoemSession(poem, session);
    chatInput.value = '';
    session.loading = true;
    renderChatSession(session);
    const assistant = appendChatMessage('assistant', 'Thinking…', true);
    setChatStatus('Reading and responding…', 'working');

    session.abortController = new AbortController();
    try {
        const model = await resolveModel(session);
        const response = await fetch(`${CHAT_PROXY_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: session.abortController.signal,
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: buildPoemSystemPrompt(poem) },
                    ...session.messages
                ],
                temperature: 0.7,
                max_tokens: isBriefMode() ? 320 : 1200,
                stream: true,
                user: session.id
            })
        });

        if (!response.ok) throw new Error(await getApiError(response));
        const answer = await readStreamingCompletion(response, text => {
            assistant.message.classList.remove('chat-message--pending');
            assistant.body.textContent = text;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
        if (!answer.trim()) throw new Error('The model returned an empty response.');
        session.messages.push({ role: 'assistant', content: answer });
        savePoemSession(poem, session);
        addChatListenControl(assistant.message, answer, session, isReadRepliesMode());
    } catch (error) {
        const wasAborted = error.name === 'AbortError';
        assistant.message.classList.remove('chat-message--pending');
        assistant.message.classList.add('chat-message--error');
        assistant.body.textContent = wasAborted
            ? 'This response was stopped.'
            : `I could not reach the model. ${error.message}`;
        if (!wasAborted) console.error('Chat request failed:', error);
    } finally {
        session.loading = false;
        session.abortController = null;
        if (currentChatSession === session) {
            chatInput.disabled = false;
            chatSend.disabled = false;
            clearChat.disabled = false;
            setChatStatus(session.model ? `Ready · ${session.model.split('/').pop()}` : 'Ready to retry', session.model ? 'ready' : 'error');
            chatInput.focus();
        }
    }
}

function clearCurrentChat() {
    if (!currentChatSession) return;
    if (currentChatSession.abortController) currentChatSession.abortController.abort();
    currentChatSession.messages = [];
    currentChatSession.loading = false;
    currentChatSession.abortController = null;
    savePoemSession(currentPoem, currentChatSession);
    renderChatSession(currentChatSession);
    setChatStatus(
        currentChatSession.model ? `Ready · ${currentChatSession.model.split('/').pop()}` : 'Connecting to model…',
        currentChatSession.model ? 'ready' : 'connecting'
    );
    chatInput.focus();
}

function getImageApiKey() {
    try {
        return localStorage.getItem(IMAGE_API_KEY_STORAGE) || '';
    } catch {
        return '';
    }
}

function getPoemImageCount(poem) {
    const lineCount = cleanPoemContent(poem.content, poem.title)
        .replace(/\n{2,}/g, '\n')
        .split('\n')
        .filter(line => line.trim()).length;
    if (lineCount <= 12) return 1;
    if (lineCount <= 30) return 2;
    if (lineCount <= 60) return 3;
    if (lineCount <= 120) return 4;
    return 5;
}

// The image model renders any poem text it is shown, so the poem is distilled
// into a purely visual scene before it reaches FLUX.
async function describePoemScene(poem) {
    const cached = poemSceneCache.get(poem.title);
    if (cached) return cached;

    const poemText = cleanPoemContent(poem.content, poem.title)
        .replace(/^\s*\d+(?=[\p{L}'‘’“"(&])/gmu, '')
        .replace(/\s+/g, ' ')
        .slice(0, 1400);

    const pending = (async () => {
        const model = await resolveModel({});
        const response = await fetch(`${CHAT_PROXY_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You turn poems into concrete visual scene descriptions for an image generator. '
                            + 'Reply with 40 to 70 words of purely visual description: setting, figures, objects, light, weather, and mood. '
                            + 'Never quote or restate the poem, never use quotation marks, and never mention writing, reading, books, paper, letters, or the poem itself. '
                            + 'Reply with the description only.'
                    },
                    { role: 'user', content: `A poem by ${currentBook.poet} titled ${poem.title}.\n\n${poemText}` }
                ],
                temperature: 0.6,
                max_tokens: 200,
                stream: false
            })
        });
        if (!response.ok) throw new Error(await getApiError(response));
        const payload = await response.json();
        const scene = (payload.choices?.[0]?.message?.content || '')
            .replace(/["“”]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!scene) throw new Error('The model returned no scene description.');
        return scene;
    })().catch(error => {
        console.warn('Scene description unavailable; using style direction alone:', error);
        poemSceneCache.delete(poem.title);
        return '';
    });

    poemSceneCache.set(poem.title, pending);
    return pending;
}

// The visual styles a reader can choose from in the Visual Companions panel.
const VISUAL_STYLES = [
    {
        label: 'Fine-art photograph',
        prompt: 'Fine-art cinematic photograph with natural skin and material detail, dramatic practical lighting, shallow depth of field, subtle film grain, and historically plausible staging. It must read unmistakably as a photograph, not a painting.'
    },
    {
        label: 'Oil painting',
        prompt: 'Expressive oil painting on linen with visible brushwork, layered glazes, rich chiaroscuro, museum-quality texture, and a restrained seventeenth-century palette broken by luminous highlights.'
    },
    {
        label: 'Editorial cartoon',
        prompt: 'Sophisticated literary editorial cartoon with bold simplified shapes, witty visual exaggeration, crisp ink contours, selective color, and an intelligent graphic composition; elegant rather than childish.'
    },
    {
        label: 'Charcoal sketch',
        prompt: 'Loose charcoal, graphite, and ink sketch on warm textured paper, energetic searching lines, expressive cross-hatching, smudged shadows, and selective unfinished negative space.'
    },
    {
        label: 'Warhol-style pop art',
        prompt: '1960s Warhol-style pop-art screen print with a repeated iconic motif, flattened high-contrast forms, off-register ink, halftone texture, and audacious blocks of saturated color.'
    },
    {
        label: 'Watercolor',
        prompt: 'Luminous watercolor painting on cold-pressed paper with transparent washes, blooms of pigment, soft lost edges, restrained detail, and generous areas of untouched paper.'
    },
    {
        label: 'Linocut print',
        prompt: 'Hand-carved linocut print with forceful black-and-ivory shapes, visible gouge marks, compressed perspective, and one sparingly applied accent color.'
    },
    {
        label: 'Cyanotype',
        prompt: 'Experimental cyanotype photogram in deep Prussian blue and ghostly white, with botanical silhouettes, antique paper fibers, solar exposure artifacts, and poetic negative space.'
    },
    {
        label: 'Surrealist collage',
        prompt: 'Dreamlike surrealist collage assembled from antique engravings, astronomical diagrams, torn paper, uncanny changes of scale, and seamless impossible juxtapositions.'
    },
    {
        label: 'Illuminated manuscript',
        prompt: 'Lavish illuminated-manuscript miniature on aged vellum with jewel-like pigments, burnished gold leaf, intricate marginal imagery, and medieval visual symbolism, but absolutely no writing or letterforms.'
    },
    {
        label: 'Stained glass',
        prompt: 'Radiant stained-glass composition with hand-cut colored panes, dark lead came, glowing transmitted light, simplified figures, and richly symbolic jewel tones.'
    },
    {
        label: 'Japanese woodblock',
        prompt: 'Elegant ukiyo-e-inspired Japanese woodblock print with flat mineral colors, graceful contour lines, patterned surfaces, asymmetrical framing, and expressive weather or water.'
    },
    {
        label: 'Art Nouveau poster',
        prompt: 'Ornamental Art Nouveau poster image with sinuous botanical curves, poised figures, decorative borders, muted jewel tones, and flat lithographic color, with no typography or lettering.'
    },
    {
        label: 'Bauhaus abstraction',
        prompt: 'Bauhaus-inspired geometric abstraction using circles, planes, grids, primary accents, disciplined negative space, and a precise visual rhythm that translates the poem into shape.'
    },
    {
        label: 'Film noir',
        prompt: 'Black-and-white film-noir still photographed in hard chiaroscuro, rain-slick atmosphere, deep shadows, expressive silhouettes, oblique camera angles, and fine 35mm grain.'
    },
    {
        label: 'Renaissance fresco',
        prompt: 'Monumental Renaissance fresco with balanced figural composition, architectural perspective, mineral pigments embedded in weathered plaster, and quiet symbolic gestures.'
    },
    {
        label: 'Paper cutout',
        prompt: 'Intricate layered paper-cut diorama with tactile deckled edges, cast shadows between layers, limited colors, delicate silhouettes, and theatrical depth.'
    },
    {
        label: 'Mosaic',
        prompt: 'Hand-laid mosaic made from irregular glass and stone tesserae, shimmering gold pieces, fractured contours, iconic frontal forms, and luminous surface variation.'
    },
    {
        label: 'Graphic novel',
        prompt: 'Dramatic graphic-novel panel with expressive brush-ink shadows, cinematic framing, controlled spot color, dynamic anatomy, and sophisticated sequential-art energy without speech balloons.'
    },
    {
        label: 'Pastel drawing',
        prompt: 'Velvety soft-pastel drawing on dark toothed paper with layered color, powdery edges, vigorous hand marks, atmospheric light, and intimate emotional immediacy.'
    },
    {
        label: 'Ceramic tableau',
        prompt: 'Handmade glazed-ceramic tableau with sculpted figures and symbols, crackled surfaces, pooled glaze, kiln variations, and the tactile charm of an art-object photographed in a studio.'
    },
    {
        label: 'Retro science fiction',
        prompt: 'Retro-futurist 1950s science-fiction paperback cover aesthetic with cosmic scale, airbrushed celestial forms, bold dramatic lighting, aged printing texture, and no title or lettering.'
    },
    {
        label: 'Embroidery',
        prompt: 'Elaborate hand-embroidered textile image with visible silk and metallic threads, varied stitches, dimensional knots, fabric grain, and symbolic motifs arranged like a narrative tapestry.'
    },
    {
        label: 'Minimalist ink wash',
        prompt: 'Contemplative monochrome ink-wash painting with fluid tonal gradients, a few decisive brushstrokes, misty spatial depth, and radical, expressive emptiness.'
    }
];

function getSteerText() {
    return imageSteer.value.trim().replace(/\s+/g, ' ').slice(0, 200);
}

function restoreSteerText() {
    try {
        imageSteer.value = localStorage.getItem(IMAGE_STEER_STORAGE) || '';
    } catch {
        imageSteer.value = '';
    }
}

function saveSteerText() {
    try {
        localStorage.setItem(IMAGE_STEER_STORAGE, getSteerText());
    } catch {
        // A blocked storage quota should not disable the field.
    }
}

// An empty selection means every style, cycled in order across a poem's images.
function getSelectedStyles() {
    const chosen = VISUAL_STYLES.filter(style => selectedStyleLabels.has(style.label));
    return chosen.length ? chosen : VISUAL_STYLES;
}

function restoreSelectedStyles() {
    try {
        const stored = JSON.parse(localStorage.getItem(IMAGE_STYLES_STORAGE) || '[]');
        const known = new Set(VISUAL_STYLES.map(style => style.label));
        selectedStyleLabels = new Set(
            (Array.isArray(stored) ? stored : []).filter(label => known.has(label))
        );
    } catch {
        selectedStyleLabels = new Set();
    }
}

function saveSelectedStyles() {
    try {
        localStorage.setItem(IMAGE_STYLES_STORAGE, JSON.stringify([...selectedStyleLabels]));
    } catch {
        // A blocked storage quota should not disable the picker.
    }
}

function renderStylePicker() {
    imageStyleOptions.replaceChildren();

    VISUAL_STYLES.forEach(style => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'image-style';
        option.textContent = style.label;
        option.dataset.styleLabel = style.label;
        const selected = selectedStyleLabels.has(style.label);
        option.classList.toggle('image-style--selected', selected);
        option.setAttribute('aria-pressed', selected ? 'true' : 'false');
        option.addEventListener('click', () => toggleStyle(style.label));
        imageStyleOptions.appendChild(option);
    });

    updateStyleSummary();
}

function toggleStyle(label) {
    if (selectedStyleLabels.has(label)) {
        selectedStyleLabels.delete(label);
    } else {
        selectedStyleLabels.add(label);
    }
    saveSelectedStyles();
    renderStylePicker();
}

function clearStyleSelection() {
    if (!selectedStyleLabels.size) return;
    selectedStyleLabels.clear();
    saveSelectedStyles();
    renderStylePicker();
}

function updateStyleSummary() {
    const chosen = selectedStyleLabels.size;
    const planned = currentPoem ? getPoemImageCount(currentPoem) : 0;
    clearImageStyles.hidden = chosen === 0;

    if (!chosen) {
        imageStylesSummary.textContent = `Cycling through all ${VISUAL_STYLES.length} styles. Pick one or more to choose for yourself.`;
        return;
    }
    if (!planned) {
        imageStylesSummary.textContent = `${chosen} style${chosen === 1 ? '' : 's'} selected.`;
        return;
    }
    // Fewer styles than images means the selection repeats; more means only the first are reached.
    const used = Math.min(chosen, planned);
    const note = chosen < planned
        ? ` They repeat across the ${planned} images.`
        : (chosen > planned ? ` This poem receives ${planned}, so the first ${used} are used.` : '');
    imageStylesSummary.textContent = `${chosen} style${chosen === 1 ? '' : 's'} selected.${note}`;
}

function getImagePrompts(poem, count, variationOffset = 0, scene = '') {
    const directions = [
        'Center the poem’s strongest symbolic image in an intimate, dramatic composition.',
        'Interpret its governing figure of speech as a surprising visual relationship between human figures and the natural world.',
        'Place the emotional argument in an atmospheric early-seventeenth-century English setting with historically plausible details.',
        'Create a more abstract, dreamlike interpretation using light, shadow, scale, and celestial imagery.',
        'Compose a wide, cinematic culmination that unites the poem’s major images without becoming a literal collage.'
    ];

    const styles = getSelectedStyles();
    const steer = getSteerText();

    return Array.from({ length: count }, (_, index) => {
        const variationIndex = variationOffset + index;
        const style = styles[variationIndex % styles.length];
        const direction = directions[variationIndex % directions.length];
        return {
            style: style.label,
            // The medium leads and is restated at the end: placed after the scene
            // description it was outweighed by it, and every style came out alike.
            prompt: `${style.prompt} The medium above governs the entire image. `
                + `${scene ? `Subject: ${scene} ` : `Subject: a poem by ${currentBook.poet}. `}`
                + `${direction} `
                // The reader's steer is stated last among the content directions
                // and given precedence, so it can override the scene it follows.
                + `${steer ? `The reader asks specifically for: ${steer}. Follow that even where it departs from the subject above. ` : ''}`
                + `Emotionally intelligent and visually coherent. Tasteful, fully clothed sensuality is welcome through intimacy, longing, gesture, and atmosphere. `
                + `No nudity, explicit sexual activity, pornographic imagery, or graphic violence. `
                + `Purely pictorial: no lettering, captions, signatures, or written words anywhere. `
                + `Render every part of it as ${style.label}, not as a generic digital illustration or photograph.`
        };
    });
}

async function fluxFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const apiKey = getImageApiKey();
    if (apiKey) headers.set('X-API-Key', apiKey);
    let response;
    try {
        response = await fetch(`${FLUX_PROXY_URL}${path}`, { ...options, headers });
    } catch (error) {
        throw new Error(`Could not reach the image service. Start this site with “python3 server.py” and try again. (${error.message})`);
    }
    if (response.status === 401) {
        imageKeySetup.hidden = false;
        throw new Error('The FLUX access key is required or was rejected.');
    }
    const contentType = response.headers.get('Content-Type') || '';
    if ([404, 405, 501].includes(response.status) && contentType.includes('text/html')) {
        throw new Error('The image proxy is not running. Start this site with “python3 server.py”, then reload the page.');
    }
    return response;
}

async function readFluxJson(response, fallbackMessage) {
    const body = await response.text();
    let payload = {};
    try {
        payload = body ? JSON.parse(body) : {};
    } catch {
        // Preserve a short upstream message when a proxy returns plain text.
    }
    if (!response.ok) {
        const detail = payload.error || payload.detail || body.slice(0, 240).trim();
        throw new Error(detail || `${fallbackMessage} (${response.status})`);
    }
    return payload;
}

async function getFluxStatus() {
    const response = await fluxFetch('/status', { cache: 'no-store' });
    return readFluxJson(response, 'Image status request failed');
}

function setPoemImagesStatus(message, state = '') {
    poemImagesStatus.textContent = message;
    poemImagesStatus.dataset.state = state;
}

async function loadFluxImage(filename, imageElement, session, onReady = () => {}) {
    if (session.imageObjectUrls.has(filename)) {
        imageElement.src = session.imageObjectUrls.get(filename);
        onReady(session.imageObjectUrls.get(filename));
        return;
    }
    try {
        const response = await fluxFetch(`/images/${encodeURIComponent(filename)}`);
        if (!response.ok) throw new Error(`Image request failed (${response.status})`);
        const objectUrl = URL.createObjectURL(await response.blob());
        session.imageObjectUrls.set(filename, objectUrl);
        imageElement.src = objectUrl;
        onReady(objectUrl);
    } catch (error) {
        imageElement.replaceWith(document.createTextNode('Image unavailable'));
        console.error('Could not load generated image:', error);
    }
}

function renderPoemImages(poem, session) {
    poemImagesGrid.replaceChildren();
    updateStyleSummary();

    const count = getPoemImageCount(poem);
    const visibleImages = session.images.filter(image => image.status !== 'error');
    generateImages.textContent = visibleImages.length ? `Generate ${count} more` : `Generate ${count} image${count === 1 ? '' : 's'}`;
    generateImages.disabled = session.imagesLoading;

    if (session.images.length === 0) {
        setPoemImagesStatus(`This ${count === 1 ? 'short poem receives one image' : `poem receives ${count} images`} based on its length.`, 'idle');
        return;
    }

    visibleImages.forEach((image, index) => {
        const figure = document.createElement('figure');
        figure.className = 'poem-image-card';
        figure.dataset.state = image.status;

        const downloadLink = document.createElement('a');
        downloadLink.className = 'media-download';
        downloadLink.textContent = 'Download';
        downloadLink.hidden = true;
        const downloadName = buildDownloadName(poem, [String(index + 1), image.style], 'png');

        if (image.filename) {
            const imageElement = document.createElement('img');
            imageElement.alt = `${image.style ? `${image.style} visual` : 'Visual interpretation'} ${index + 1} of “${poem.title}”`;
            imageElement.loading = 'lazy';
            figure.appendChild(imageElement);
            loadFluxImage(image.filename, imageElement, session, objectUrl => {
                setDownloadLink(downloadLink, objectUrl, downloadName);
            });
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'poem-image-placeholder';
            const spinner = document.createElement('span');
            spinner.className = 'poem-image-spinner';
            const label = document.createElement('span');
            label.textContent = image.status === 'generating' ? 'Creating image…' : 'Waiting in queue…';
            placeholder.append(spinner, label);
            figure.appendChild(placeholder);
        }

        const caption = document.createElement('figcaption');
        caption.textContent = image.style ? `${image.style} · Interpretation ${index + 1}` : `Interpretation ${index + 1}`;
        if (image.filename) caption.appendChild(downloadLink);
        figure.appendChild(caption);
        poemImagesGrid.appendChild(figure);
    });

    const completed = session.images.filter(image => image.status === 'done').length;
    const failed = session.images.filter(image => image.status === 'error').length;
    if (session.imagesLoading) {
        const pending = session.images.filter(image => (
            image.jobId && ['queued', 'generating'].includes(image.status)
        )).length;
        setPoemImagesStatus(`Generating ${completed} complete · ${pending} remaining…`, 'working');
    } else if (failed) {
        const latestError = [...session.images].reverse().find(image => image.status === 'error')?.error;
        setPoemImagesStatus(
            completed ? `${completed} generated. ${latestError || `${failed} attempt${failed === 1 ? '' : 's'} failed.`}` : latestError || 'Image generation failed.',
            'error'
        );
    } else {
        setPoemImagesStatus(`${completed} visual companion${completed === 1 ? '' : 's'} generated for this poem.`, 'done');
    }
}

async function submitFluxImage(prompt) {
    const response = await fluxFetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            negative_prompt: null,  // Rejected unless the FLUX server runs the SDXL backend.
            orientation: 'landscape',
            size: '1mp',
            steps: 25,
            seed: null,
            guidance: null,
            batch: 1,
            spectrum_grid: false,
            spectrum_same_seed: true,
            show_preview: false,
            save_previews: false,
            selected_cells: []
        })
    });
    const payload = await readFluxJson(response, 'Image submission failed');
    if (!payload.success || !payload.job_id) {
        throw new Error(payload.error || 'The image service did not return a job ID.');
    }
    return payload.job_id;
}

function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function pollPoemImageJobs(poem, session) {
    if (session.imagePollActive) return;
    session.imagePollActive = true;
    session.imagesLoading = true;
    if (currentChatSession === session) renderPoemImages(poem, session);
    const deadline = Date.now() + (30 * 60 * 1000);
    let consecutiveStatusFailures = 0;

    try {
        while (session.images.some(image => image.jobId && ['queued', 'generating'].includes(image.status))) {
            if (Date.now() > deadline) throw new Error('Image generation timed out.');
            await wait(2000);
            let status;
            try {
                status = await getFluxStatus();
                consecutiveStatusFailures = 0;
            } catch (error) {
                consecutiveStatusFailures += 1;
                if (consecutiveStatusFailures >= 5) throw error;
                continue;
            }

            session.images.forEach(image => {
                if (!image.jobId || !['queued', 'generating'].includes(image.status)) return;
                const completed = (status.recent_done || []).find(job => job.id === image.jobId);
                if (completed) {
                    delete image.missingStatusChecks;
                    if (completed.state === 'done' && completed.images?.[0]?.filename) {
                        image.status = 'done';
                        image.filename = completed.images[0].filename;
                    } else {
                        image.status = 'error';
                        image.error = completed.error || `Job ${completed.state}`;
                    }
                    return;
                }
                if (status.running?.id === image.jobId) {
                    image.status = 'generating';
                    delete image.missingStatusChecks;
                    return;
                }
                if ((status.queued || []).some(job => job.id === image.jobId)) {
                    image.status = 'queued';
                    delete image.missingStatusChecks;
                    return;
                }
                image.missingStatusChecks = (image.missingStatusChecks || 0) + 1;
                if (image.missingStatusChecks >= 5) {
                    image.status = 'error';
                    image.error = 'This image job is no longer available. Please generate it again.';
                }
            });

            savePoemSession(poem, session);
            if (currentChatSession === session) renderPoemImages(poem, session);
        }
    } catch (error) {
        session.images.forEach(image => {
            if (['queued', 'generating'].includes(image.status)) {
                image.status = 'error';
                image.error = error.message;
            }
        });
        console.error('Image generation failed:', error);
    } finally {
        session.imagePollActive = false;
        session.imagesLoading = false;
        savePoemSession(poem, session);
        if (currentChatSession === session) renderPoemImages(poem, session);
    }
}

async function reconcilePoemImageJobs(poem, session) {
    const recoverable = session.images.filter(image => image.jobId && image.status !== 'done');
    if (!recoverable.length || session.imagePollActive) return;

    try {
        const status = await getFluxStatus();
        recoverable.forEach(image => {
            const completed = (status.recent_done || []).find(job => job.id === image.jobId);
            if (completed?.state === 'done' && completed.images?.[0]?.filename) {
                image.status = 'done';
                image.filename = completed.images[0].filename;
                delete image.error;
                delete image.missingStatusChecks;
            } else if (completed) {
                image.status = 'error';
                image.error = completed.error || `Job ${completed.state}`;
            } else if (status.running?.id === image.jobId) {
                image.status = 'generating';
                delete image.error;
                delete image.missingStatusChecks;
            } else if ((status.queued || []).some(job => job.id === image.jobId)) {
                image.status = 'queued';
                delete image.error;
                delete image.missingStatusChecks;
            }
        });
        savePoemSession(poem, session);
        if (currentChatSession === session) renderPoemImages(poem, session);
        if (session.images.some(image => image.jobId && ['queued', 'generating'].includes(image.status))) {
            pollPoemImageJobs(poem, session);
        }
    } catch (error) {
        console.warn('Could not reconcile saved image jobs:', error);
        if (currentChatSession === session && session.images.some(image => image.status === 'error')) {
            setPoemImagesStatus(error.message, 'error');
        }
    }
}

async function generatePoemImageSet() {
    const poem = currentPoem;
    const session = currentChatSession;
    if (!poem || !session || session.imagesLoading) return;

    try {
        await getFluxStatus();
    } catch (error) {
        setPoemImagesStatus(error.message, 'error');
        return;
    }

    setPoemImagesStatus('Reading the poem for its imagery…', 'working');
    const scene = await describePoemScene(poem);
    if (currentPoem !== poem || currentChatSession !== session) return;

    const prompts = getImagePrompts(poem, getPoemImageCount(poem), session.images.length, scene);
    const newImages = prompts.map(({ prompt, style }) => ({ prompt, style, status: 'queued', jobId: null, filename: null }));
    session.images.push(...newImages);
    session.imagesLoading = true;
    renderPoemImages(poem, session);
    savePoemSession(poem, session);

    for (const image of newImages) {
        try {
            image.jobId = await submitFluxImage(image.prompt);
        } catch (error) {
            image.status = 'error';
            image.error = error.message;
            if (/access key/i.test(error.message)) {
                newImages.forEach(pendingImage => {
                    if (!pendingImage.jobId && pendingImage.status === 'queued') {
                        pendingImage.status = 'error';
                        pendingImage.error = error.message;
                    }
                });
                break;
            }
        }
        savePoemSession(poem, session);
        if (currentChatSession === session) renderPoemImages(poem, session);
    }

    if (newImages.some(image => image.jobId)) {
        pollPoemImageJobs(poem, session);
    } else {
        session.imagesLoading = false;
        renderPoemImages(poem, session);
    }
}

function saveFluxApiKey() {
    const key = imageApiKey.value.trim();
    if (!key) return;
    try {
        localStorage.setItem(IMAGE_API_KEY_STORAGE, key);
        imageApiKey.value = '';
        imageKeySetup.hidden = true;
        setPoemImagesStatus('Access key saved in this browser. Ready to generate.', 'done');
        if (currentPoem && currentChatSession && currentChatSession.images.every(image => image.status === 'error')) {
            currentChatSession.images = [];
            renderPoemImages(currentPoem, currentChatSession);
            generatePoemImageSet();
        }
    } catch (error) {
        setPoemImagesStatus(`Could not save the access key: ${error.message}`, 'error');
    }
}

function getGeminiApiKey() {
    try {
        return localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
    } catch {
        return '';
    }
}

function openAudioDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable.'));
    if (audioDatabaseRequest) return audioDatabaseRequest;

    audioDatabaseRequest = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(AUDIO_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(AUDIO_STORE_NAME)) {
                database.createObjectStore(AUDIO_STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open audio storage.'));
        request.onblocked = () => reject(new Error('Audio storage is blocked by another page.'));
    }).catch(error => {
        audioDatabaseRequest = null;
        throw error;
    });
    return audioDatabaseRequest;
}

async function getStoredAudio(key) {
    try {
        const database = await openAudioDatabase();
        return await new Promise((resolve, reject) => {
            const request = database.transaction(AUDIO_STORE_NAME, 'readonly')
                .objectStore(AUDIO_STORE_NAME)
                .get(key);
            request.onsuccess = () => resolve(request.result?.blob || null);
            request.onerror = () => reject(request.error || new Error('Could not read saved audio.'));
        });
    } catch (error) {
        console.warn('Persistent audio storage is unavailable:', error);
        return null;
    }
}

async function storeAudio(key, blob, metadata) {
    try {
        const database = await openAudioDatabase();
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(AUDIO_STORE_NAME, 'readwrite');
            transaction.objectStore(AUDIO_STORE_NAME).put({
                key,
                blob,
                ...metadata,
                updatedAt: new Date().toISOString()
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error('Could not save audio.'));
            transaction.onabort = () => reject(transaction.error || new Error('Audio save was aborted.'));
        });
        return true;
    } catch (error) {
        console.warn('Could not persist generated audio:', error);
        return false;
    }
}

function getReadablePoemText(poem) {
    return cleanPoemContent(poem.content, poem.title)
        .replace(/^\s*#{3,}\s*/gmu, '')
        .replace(/^\s*\d+(?=[\p{L}'‘’“"(&])/gmu, '')
        .replace(/^\s*(\d*[05])(?=\d+\s)/gmu, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function setPoemAudioStatus(message, state = '') {
    poemAudioStatus.textContent = message;
    poemAudioStatus.dataset.state = state;
}

async function requestGeminiTts(title, text, voice, kind = 'poem', filename = '') {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const apiKey = getGeminiApiKey();
    if (apiKey) headers.set('X-Gemini-API-Key', apiKey);
    const response = await fetch('/api/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title, text, voice, kind, book: currentBook.id, filename })
    });
    if (response.status === 401) {
        geminiKeySetup.hidden = false;
        throw new Error('A Gemini API key is required or was rejected.');
    }
    if (!response.ok) throw new Error(await getApiError(response));
    // The server also parks the reading at a named path, so the browser's own
    // player menu downloads it as a title rather than as "download.wav".
    return {
        blob: await response.blob(),
        namedPath: response.headers.get('X-Audio-Path') || ''
    };
}

function getReadableResponseText(content) {
    return content
        .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^\s{0,3}(?:#{1,6}|[-*+] |\d+[.)] )\s*/gmu, '')
        .replace(/[*_~`]+/g, '')
        .trim();
}

async function getOrCreateResponseAudio(poem, content, onGenerate) {
    const audioKey = getResponseAudioKey(poem, content);
    if (!responseAudioRequests.has(audioKey)) {
        const request = (async () => {
            const storedBlob = await getStoredAudio(audioKey);
            if (storedBlob) return { blob: storedBlob, saved: true, reused: true };

            if (onGenerate) onGenerate();
            const { blob, namedPath } = await requestGeminiTts(
                `Discussion of ${poem.title}`,
                getReadableResponseText(content),
                'companion',
                'response',
                buildDownloadName(poem, ['commentary', VOICE_NAMES.companion], 'wav')
            );
            const saved = await storeAudio(audioKey, blob, {
                kind: 'response',
                poemTitle: poem.title,
                voice: 'Iapetus'
            });
            return { blob, namedPath, saved, reused: false };
        })();
        responseAudioRequests.set(audioKey, request);
        request.catch(() => responseAudioRequests.delete(audioKey));
    }
    return responseAudioRequests.get(audioKey);
}

function addChatListenControl(messageElement, content, session, autoPlay = false) {
    if (!session || messageElement.querySelector('.chat-message-audio')) return;
    const poem = currentPoem;
    const audioKey = poem ? getResponseAudioKey(poem, content) : null;

    const controls = document.createElement('div');
    controls.className = 'chat-message-audio';
    const listenButton = document.createElement('button');
    listenButton.type = 'button';
    listenButton.className = 'chat-listen';
    listenButton.textContent = 'Listen · Iapetus';
    const player = document.createElement('audio');
    player.className = 'chat-response-player';
    player.controls = true;
    player.hidden = true;
    const download = document.createElement('a');
    download.className = 'media-download';
    download.textContent = 'Download';
    download.hidden = true;
    const downloadName = poem
        ? buildDownloadName(poem, ['commentary', VOICE_NAMES.companion], 'wav')
        : '';
    controls.append(listenButton, player, download);
    messageElement.appendChild(controls);

    const playResponse = async () => {
        const cachedAudio = session.responseAudioByText.get(content);
        if (cachedAudio) {
            player.src = cachedAudio;
            player.hidden = false;
            setDownloadLink(download, cachedAudio, downloadName);
            player.play().catch(() => {});
            return;
        }

        listenButton.disabled = true;
        listenButton.textContent = 'Checking saved performance…';
        try {
            if (!poem || !audioKey) throw new Error('The poem context for this response is unavailable.');
            const audio = await getOrCreateResponseAudio(poem, content, () => {
                listenButton.textContent = 'Preparing Iapetus…';
            });
            const playbackUrl = audio.namedPath || URL.createObjectURL(audio.blob);
            session.responseAudioByText.set(content, playbackUrl);
            player.src = playbackUrl;
            player.hidden = false;
            setDownloadLink(download, playbackUrl, downloadName);
            listenButton.textContent = 'Play again · Iapetus';
            pendingGeminiRetry = null;
            player.play().catch(() => {});
        } catch (error) {
            console.error('Could not read model response:', error);
            listenButton.textContent = 'Try listening again';
            if (/Gemini API key/i.test(error.message)) pendingGeminiRetry = playResponse;
        } finally {
            listenButton.disabled = false;
        }
    };

    listenButton.addEventListener('click', playResponse);
    // Restored conversations re-run this on load, so only a fresh reply auto-plays.
    if (autoPlay) playResponse();
}

async function restorePoemAudio(poem, session, voice) {
    if (session.audioRestoringVoices.has(voice)) return;
    session.audioRestoringVoices.add(voice);
    try {
        const storedBlob = await getStoredAudio(getPoemAudioKey(poem, voice));
        if (storedBlob && !session.audioByVoice.has(voice)) {
            session.audioByVoice.set(voice, URL.createObjectURL(storedBlob));
        }
    } finally {
        session.audioCheckedVoices.add(voice);
        session.audioRestoringVoices.delete(voice);
        if (currentPoem === poem && currentChatSession === session && poemVoice.value === voice) {
            renderPoemAudio(session);
        }
    }
}

function renderPoemAudio(session) {
    const voice = poemVoice.value;
    const cachedAudio = session.audioByVoice.get(voice);
    poemAudioPlayer.pause();
    if (cachedAudio) {
        poemAudioPlayer.src = cachedAudio;
        poemAudioPlayer.hidden = false;
        setDownloadLink(
            downloadAudio,
            cachedAudio,
            buildDownloadName(currentPoem, [VOICE_NAMES[voice] || voice], 'wav')
        );
        generateAudio.textContent = 'Play reading';
        setPoemAudioStatus(
            voice === 'feminine' ? 'Gacrux · mature feminine voice' : 'Algieba · smooth masculine voice',
            'ready'
        );
    } else {
        poemAudioPlayer.removeAttribute('src');
        poemAudioPlayer.load();
        poemAudioPlayer.hidden = true;
        setDownloadLink(downloadAudio, '', '');
        if (!session.audioCheckedVoices.has(voice)) {
            generateAudio.textContent = 'Checking saved reading…';
            setPoemAudioStatus('Looking for an earlier performance in this browser…', 'working');
            generateAudio.disabled = true;
            poemVoice.disabled = session.audioLoading;
            if (!session.audioRestoringVoices.has(voice)) {
                restorePoemAudio(currentPoem, session, voice);
            }
            return;
        }
        generateAudio.textContent = 'Read poem';
        setPoemAudioStatus(
            voice === 'feminine'
                ? 'Gacrux offers a mature, composed reading.'
                : 'Algieba offers a smooth, measured reading.',
            'idle'
        );
    }
    generateAudio.disabled = session.audioLoading;
    poemVoice.disabled = session.audioLoading;
}

async function generatePoemReading() {
    const poem = currentPoem;
    const session = currentChatSession;
    const voice = poemVoice.value;
    if (!poem || !session || session.audioLoading) return;

    const cachedAudio = session.audioByVoice.get(voice);
    if (cachedAudio) {
        poemAudioPlayer.play().catch(() => {});
        return;
    }

    session.audioLoading = true;
    generateAudio.disabled = true;
    poemVoice.disabled = true;
    generateAudio.textContent = 'Preparing…';
    setPoemAudioStatus('Gemini is preparing the performance. Long poems are read in joined sections…', 'working');

    try {
        const downloadName = buildDownloadName(poem, [VOICE_NAMES[voice] || voice], 'wav');
        const { blob: audioBlob, namedPath } = await requestGeminiTts(
            poem.title, getReadablePoemText(poem), voice, 'poem', downloadName
        );
        const saved = await storeAudio(getPoemAudioKey(poem, voice), audioBlob, {
            kind: 'poem',
            poemTitle: poem.title,
            voice
        });
        // Prefer the server's named path so the player's own download menu
        // sees a filename; a blob URL always saves as "download.wav".
        const playbackUrl = namedPath || URL.createObjectURL(audioBlob);
        session.audioByVoice.set(voice, playbackUrl);
        poemAudioPlayer.src = playbackUrl;
        poemAudioPlayer.hidden = false;
        setDownloadLink(downloadAudio, playbackUrl, downloadName);
        setPoemAudioStatus(
            saved
                ? 'Reading ready and saved for future visits. Use the player to pause, seek, or replay.'
                : 'Reading ready for this visit. Browser storage was unavailable.',
            saved ? 'ready' : 'error'
        );
        poemAudioPlayer.play().catch(() => {});
    } catch (error) {
        console.error('Could not generate poem narration:', error);
        setPoemAudioStatus(error.message, 'error');
        if (/Gemini API key/i.test(error.message)) pendingGeminiRetry = generatePoemReading;
    } finally {
        session.audioLoading = false;
        if (currentChatSession === session) {
            generateAudio.disabled = false;
            poemVoice.disabled = false;
            generateAudio.textContent = session.audioByVoice.has(voice) ? 'Play reading' : 'Read poem';
        }
    }
}

function saveGeminiKey() {
    const key = geminiApiKey.value.trim();
    if (!key) return;
    try {
        localStorage.setItem(GEMINI_API_KEY_STORAGE, key);
        geminiApiKey.value = '';
        geminiKeySetup.hidden = true;
        const retry = pendingGeminiRetry;
        pendingGeminiRetry = null;
        setPoemAudioStatus('Gemini key saved in this browser.', 'ready');
        if (retry) retry();
    } catch (error) {
        setPoemAudioStatus(`Could not save the Gemini key: ${error.message}`, 'error');
    }
}

// Open poem modal
function openPoemModal(poem) {
    recordPoemVisit(poem);
    currentPoem = poem;
    currentChatSession = getPoemChatSession(poem);
    modalTitle.textContent = poem.title;
    renderPoemContent(poem.content, poem.title);
    renderChatSession(currentChatSession);
    renderPoemImages(poem, currentChatSession);
    renderPoemAudio(currentChatSession);
    poemModal.classList.add('show');
    document.body.style.overflow = 'hidden';
    connectChatSession(currentChatSession);
    reconcilePoemImageJobs(poem, currentChatSession);
    window.setTimeout(() => chatInput.focus(), 100);
}

// Close poem modal
function closePoemModal() {
    poemAudioPlayer.pause();
    poemModal.classList.remove('show');
    document.body.style.overflow = 'auto';
}

// Search functionality
function handleSearch() {
    const query = searchInput.value.toLowerCase().trim();
    
    if (query === '') {
        filteredPoems = allPoems;
        clearSearch.style.display = 'none';
    } else {
        filteredPoems = allPoems.filter(poem => {
            const titleMatch = poem.title.toLowerCase().includes(query);
            const contentMatch = poem.content.toLowerCase().includes(query);
            return titleMatch || contentMatch;
        });
        clearSearch.style.display = 'block';
    }
    
    displayPoems(filteredPoems);
    updateResultCount(filteredPoems.length, allPoems.length);
}

// Update result count
function updateResultCount(showing, total) {
    if (showing === total) {
        resultCount.textContent = `Showing all ${total} poems`;
    } else {
        resultCount.textContent = `Showing ${showing} of ${total} poems`;
    }
}

// Clear search
function handleClearSearch() {
    searchInput.value = '';
    handleSearch();
    searchInput.focus();
}

// Show error message
function showError(message) {
    poemsList.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <div class="empty-state-text">${escapeHtml(message)}</div>
        </div>
    `;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event Listeners
searchInput.addEventListener('input', handleSearch);
clearSearch.addEventListener('click', handleClearSearch);
randomPoem.addEventListener('click', openRandomPoem);
closeModal.addEventListener('click', closePoemModal);
chatForm.addEventListener('submit', sendChatMessage);
clearChat.addEventListener('click', clearCurrentChat);
chatBrief.addEventListener('change', saveChatToggles);
chatReadReplies.addEventListener('change', saveChatToggles);
clearImageStyles.addEventListener('click', clearStyleSelection);
imageSteer.addEventListener('change', saveSteerText);
generateImages.addEventListener('click', generatePoemImageSet);
saveImageApiKey.addEventListener('click', saveFluxApiKey);
imageApiKey.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveFluxApiKey();
    }
});
generateAudio.addEventListener('click', generatePoemReading);
poemVoice.addEventListener('change', () => {
    if (currentChatSession) renderPoemAudio(currentChatSession);
});
saveGeminiApiKey.addEventListener('click', saveGeminiKey);
geminiApiKey.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveGeminiKey();
    }
});
document.addEventListener('play', event => {
    if (event.target instanceof HTMLAudioElement) showAudioTimeRemaining(event.target);
}, true);
document.addEventListener('pause', event => {
    if (event.target instanceof HTMLAudioElement) hideAudioTimeRemaining(event.target);
}, true);
document.addEventListener('ended', event => {
    if (event.target instanceof HTMLAudioElement) hideAudioTimeRemaining(event.target);
}, true);
chatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        chatForm.requestSubmit();
    }
});

// Close modal when clicking outside
poemModal.addEventListener('click', (e) => {
    if (e.target === poemModal) {
        closePoemModal();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && poemModal.classList.contains('show')) {
        closePoemModal();
    }
});

// Debounce search for better performance
let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(handleSearch, 300);
});

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    restoreChatToggles();
    restoreSelectedStyles();
    restoreSteerText();
    renderStylePicker();
    loadBooks();
});
