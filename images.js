const statusElement = document.getElementById('managerStatus');
const grid = document.getElementById('managerGrid');
const selectAll = document.getElementById('managerSelectAll');
const deleteButton = document.getElementById('managerDelete');
const refreshButton = document.getElementById('managerRefresh');
let images = [];

function selectedImages() {
    const selected = new Set([...grid.querySelectorAll('input:checked')].map(input => input.value));
    return images.filter(image => selected.has(`${image.poemId}:${image.filename}`));
}

function updateSelection() {
    const count = selectedImages().length;
    deleteButton.disabled = count === 0;
    deleteButton.textContent = count ? `Delete selected (${count})` : 'Delete selected';
    selectAll.checked = Boolean(images.length && count === images.length);
    selectAll.indeterminate = count > 0 && count < images.length;
}

function render() {
    grid.replaceChildren();
    selectAll.checked = false;
    selectAll.indeterminate = false;
    if (!images.length) {
        statusElement.textContent = 'No managed images are saved.';
        deleteButton.disabled = true;
        return;
    }
    statusElement.textContent = `${images.length} managed image${images.length === 1 ? '' : 's'}`;
    images.forEach(item => {
        const card = document.createElement('label');
        card.className = 'image-library-card';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = `${item.poemId}:${item.filename}`;
        checkbox.addEventListener('change', updateSelection);
        const image = document.createElement('img');
        image.src = `/${item.filename}`;
        image.alt = `${item.style || 'Generated'} image for “${item.poemTitle || 'poem'}”`;
        image.loading = 'lazy';
        const caption = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = item.poemTitle || 'Saved poem image';
        const details = document.createElement('small');
        details.textContent = [item.collection, item.style].filter(Boolean).join(' · ');
        caption.append(title, details);
        card.append(checkbox, image, caption);
        grid.appendChild(card);
    });
    updateSelection();
}

async function loadImages() {
    refreshButton.disabled = true;
    statusElement.textContent = 'Loading images…';
    try {
        const response = await fetch('/api/image-library', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
        images = Array.isArray(payload.images) ? payload.images : [];
        render();
    } catch (error) {
        statusElement.textContent = `Could not load images: ${error.message}`;
    } finally {
        refreshButton.disabled = false;
    }
}

async function deleteSelected() {
    const selected = selectedImages();
    if (!selected.length) return;
    if (!window.confirm(`Permanently delete ${selected.length} selected image${selected.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    deleteButton.disabled = true;
    statusElement.textContent = 'Deleting selected images…';
    try {
        const response = await fetch('/api/image-library', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: selected.map(({ poemId, filename }) => ({ poemId, filename })) })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Deletion failed (${response.status})`);
        await loadImages();
    } catch (error) {
        statusElement.textContent = `Could not delete images: ${error.message}`;
        updateSelection();
    }
}

selectAll.addEventListener('change', () => {
    grid.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.checked = selectAll.checked;
    });
    updateSelection();
});
deleteButton.addEventListener('click', deleteSelected);
refreshButton.addEventListener('click', loadImages);
loadImages();
