// Migrate browser-held image references into the shared library, without regenerating.
window.SharedImages = (() => {
    let pending = null;
    const prefix = 'john-donne-poem-session-v1:';
    async function sync() {
        if (pending) return pending;
        pending = (async () => {
            const records = new Map(), replacements = new Map();
            const stored = [];
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key?.startsWith(prefix)) continue;
                    try {
                        const value = JSON.parse(localStorage.getItem(key));
                        if (!value) continue;
                        const groups = [value.images, value.media?.images, ...(value.conversations || []).map(c => c.images)].filter(Array.isArray);
                        stored.push({key, groups});
                        for (const image of groups.flat()) {
                            if (!image?.filename || image.filename.startsWith('poem-images/') || image.status === 'error') continue;
                            const poemId = key.slice(prefix.length), id = `${poemId}:${image.filename}`;
                            records.set(id, { ...image, poemId, poemTitle: value.context?.poemTitle || '', collection: value.context?.book || '' });
                        }
                    } catch { /* One damaged browser record must not hide other images. */ }
                }
            } catch { return {failed:0}; }
            let failed = 0;
            for (const [id, record] of records) {
                try {
                    const response = await fetch('/api/image-library', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(record), signal:AbortSignal.timeout(35000) });
                    const payload = await response.json();
                    if (!response.ok) throw new Error(payload.error);
                    if (payload.image || payload.deleted) replacements.set(id, payload.deleted ? null : payload.image);
                } catch { failed = records.size - replacements.size; break; }
            }
            // Re-read before writing so conversations changed during downloads are preserved.
            for (const {key} of stored) {
                try {
                    const value = JSON.parse(localStorage.getItem(key));
                    if (!value) continue;
                    const replace = images => Array.isArray(images) ? images.flatMap(image => {
                        const id = `${key.slice(prefix.length)}:${image?.filename}`;
                        return replacements.has(id) ? (replacements.get(id) ? [{...image,...replacements.get(id)}] : []) : [image];
                    }) : images;
                    if (value.images) value.images = replace(value.images);
                    if (value.media?.images) value.media.images = replace(value.media.images);
                    for (const conversation of value.conversations || []) if (conversation.images) conversation.images = replace(conversation.images);
                    localStorage.setItem(key, JSON.stringify(value));
                } catch { /* Existing records remain available if storage is full. */ }
            }
            return {failed, deleted:[...replacements].filter(([,image]) => !image).map(([id]) => id)};
        })().finally(() => { pending = null; });
        return pending;
    }
    return {sync};
})();
