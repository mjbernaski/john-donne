const grid = document.getElementById('libraryGrid');
const status = document.getElementById('libraryStatus');
const search = document.getElementById('librarySearch');
const sort = document.getElementById('librarySort');
const filters = document.getElementById('libraryFilters');
const reset = document.getElementById('libraryReset');
let books = [];
let category = 'All';

function author(book) {
    return book.userPoems ? 'Your own shelf' : book.poet || book.name;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = books.filter(book => (category === 'All' || book.category === category)
        && [book.title, author(book), book.subtitle, book.name].join(' ').toLocaleLowerCase().includes(query));
    const sortKey = book => sort.value === 'author' ? author(book) : book[sort.value];
    visible.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title));
    grid.replaceChildren();
    for (const book of visible) {
        const card = element('article', 'library-card', '');
        card.dataset.category = book.category;
        const label = element('p', 'library-card-label', `${book.category} · ${book.format || 'Reader'}`);
        const title = element('h2', '', book.title);
        const byline = element('p', 'library-author', author(book));
        const edition = element('p', 'library-edition', book.subtitle || '');
        const link = element('a', 'library-open', book.format === 'PDF' ? 'Open PDF ↗' : 'Open collection →');
        link.href = book.format === 'PDF' ? book.sourceUrl : `index.html?book=${encodeURIComponent(book.id)}`;
        link.setAttribute('aria-label', `${book.format === 'PDF' ? 'Open PDF' : 'Open collection'}: ${book.title}`);
        if (book.format === 'PDF') {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            edition.append(document.createTextNode(' · Opens in a new tab'));
        }
        card.append(label, title, byline, edition, link);
        grid.appendChild(card);
    }
    status.textContent = visible.length ? `${visible.length} of ${books.length} titles` : 'No titles match. Try another search or category.';
    reset.hidden = !query && category === 'All';
    filters.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
}

async function loadLibrary() {
    try {
        const response = await fetch('books.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const manifest = await response.json();
        books = [...manifest.books, ...(manifest.externalBooks || [])];
        for (const name of ['All', ...new Set(books.map(book => book.category))]) {
            const button = element('button', '', name);
            button.type = 'button';
            button.dataset.category = name;
            button.addEventListener('click', () => { category = name; render(); });
            filters.appendChild(button);
        }
        try {
            const current = books.find(book => book.id === localStorage.getItem('john-donne-selected-book'));
            if (current) {
                const resume = document.getElementById('continueReading');
                resume.href = `index.html?book=${encodeURIComponent(current.id)}`;
                resume.textContent = `Continue reading: ${current.title} →`;
                resume.hidden = false;
            }
        } catch { /* Browsing remains available when storage is blocked. */ }
        render();
    } catch (error) {
        status.textContent = 'The library could not load. Refresh the page to try again.';
        console.error(error);
    }
}

search.addEventListener('input', render);
sort.addEventListener('change', render);
reset.addEventListener('click', () => { search.value = ''; category = 'All'; render(); search.focus(); });
loadLibrary();
