// Migrate browser-held image references into the shared library, without regenerating.
window.SharedImages = (() => {
    // Reuse the planned scene for existing images without another model call.
    function sceneCaption(image) {
        if (image.captionVersion === 'vision-scene-v1' && image.caption) return image.caption;
        const scene = String(image.caption || image.scene || image.prompt?.split('Subject: ')[1] || '')
            .split(/ Every figure wears| Use clothing and objects| Preserve the specified/)[0]
            .replace(/\s+/g, ' ').trim();
        if (!scene) return '';
        const sentence = scene.match(/^.*?[.!?](?=\s|$)/)?.[0] || scene;
        if (sentence.length <= 240) return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
        const clause = sentence.slice(0, 237).replace(/\s+\S*$/, '').replace(/[,;:]$/, '');
        return `${clause}…`;
    }
    function labelStatus(image) {
        if (image.labels?.length) return 'Character name labels added';
        if (image.nameLabels && image.labelVersion !== 'vision-labels-v1') return 'Character name labels pending';
        return 'No character name labels added';
    }
    const labeledImages = new Map();
    async function labeledUrl(url, labels) {
        const key = JSON.stringify([url, labels]);
        if (labeledImages.has(key)) return labeledImages.get(key);
        const work = (async () => {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const fontSize = Math.max(14, Math.round(canvas.width / 48));
            ctx.font = `600 ${fontSize}px Georgia, serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const boxes = [];
            for (const label of labels) {
                const width = Math.min(canvas.width - 8, ctx.measureText(label.name).width + 18);
                const height = fontSize + 14;
                const x = Math.max(width / 2 + 4, Math.min(canvas.width - width / 2 - 4, label.x * canvas.width));
                let y = Math.max(height / 2 + 4, Math.min(canvas.height - height / 2 - 4, label.y * canvas.height));
                for (let step = 0; step < 30 && boxes.some(b => Math.abs(b.x - x) < (b.width + width) / 2 + 4 && Math.abs(b.y - y) < height + 4); step++) {
                    y = height / 2 + 4 + ((y + height + 8) % Math.max(1, canvas.height - height - 8));
                }
                boxes.push({x, y, width});
                const tx = label.targetX * canvas.width, ty = label.targetY * canvas.height;
                ctx.lineWidth = Math.max(1, canvas.width / 800);
                ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
                ctx.strokeStyle = '#43392e'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
                ctx.fillStyle = 'rgba(255,253,246,0.94)';
                ctx.fillRect(x - width / 2, y - height / 2, width, height);
                ctx.strokeRect(x - width / 2, y - height / 2, width, height);
                ctx.fillStyle = '#29241e'; ctx.fillText(label.name, x, y, width - 12);
            }
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Could not create labeled image.');
            return URL.createObjectURL(blob);
        })();
        labeledImages.set(key, work);
        return work;
    }
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
    return {sync, sceneCaption, labeledUrl, labelStatus};
})();
