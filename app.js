// Poetry Website Application
let allPoems = [];
let filteredPoems = [];

// DOM Elements
const poemsList = document.getElementById('poemsList');
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const resultCount = document.getElementById('resultCount');
const poemModal = document.getElementById('poemModal');
const modalTitle = document.getElementById('modalTitle');
const modalContent = document.getElementById('modalContent');
const closeModal = document.getElementById('closeModal');

// Load poems from JSON
async function loadPoems() {
    try {
        const response = await fetch('poems.json');
        allPoems = await response.json();
        filteredPoems = allPoems;
        displayPoems(allPoems);
        updateResultCount(allPoems.length, allPoems.length);
    } catch (error) {
        console.error('Error loading poems:', error);
        showError('Failed to load poems. Please try again later.');
    }
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

// Open poem modal
function openPoemModal(poem) {
    modalTitle.textContent = poem.title;
    renderPoemContent(poem.content, poem.title);
    poemModal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

// Close poem modal
function closePoemModal() {
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
closeModal.addEventListener('click', closePoemModal);

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
    loadPoems();
});
