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
function cleanPoemContent(content) {
    // Split by lines
    let lines = content.split('\n');
    
    // Remove lines that look like editorial notes (contain manuscript references, edition numbers, etc.)
    lines = lines.filter(line => {
        const trimmed = line.trim();
        
        // Skip lines that look like editorial notes
        if (/^\d+/.test(trimmed) && /\d{4}/.test(trimmed)) return false;
        if (/^[A-Z\d\s,]+\d{4}/.test(trimmed)) return false;
        if (trimmed.match(/^\w+\.\s+\d{4}/)) return false;
        if (trimmed.match(/^[A-Z][a-z]+\s+\d{4}/)) return false;
        
        return true;
    });
    
    return lines.join('\n').trim();
}

// Open poem modal
function openPoemModal(poem) {
    modalTitle.textContent = poem.title;
    modalContent.textContent = cleanPoemContent(poem.content);
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
