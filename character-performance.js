// Exact, source-labelled dialogue; minor roles share a single configurable voice.
window.CharacterPerformance = (() => {
    const voices = {
        masculine: 'George', companion: 'Adam', feminine: 'Rachel',
        charlie: 'Charlie', callum: 'Callum', harry: 'Harry', brian: 'Brian',
        alice: 'Alice', daniel: 'Daniel', bill: 'Bill', river: 'River', lily: 'Lily'
    };
    let catalogPromise;
    function loadVoices() {
        return catalogPromise ||= fetch('/api/elevenlabs/catalog').then(async response => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not load ElevenLabs voices.');
            for (const voice of data.voices) voices[`eleven:${voice.id}`] = voice.name;
            return data;
        });
    }
    function castFor(book, overrides = {}) {
        const cast = { ...book.performanceCast };
        for (const role of Object.keys(cast)) if (voices[overrides[role]]) cast[role] = overrides[role];
        return cast;
    }
    function requestsFor(poem, book, cast) {
        const requests = [];
        const source = poem.content.replace(/\s/g, '');
        let sourceCursor = 0;
        for (const turn of poem.performance || []) {
            const voice = cast[turn.speaker] || cast.MINOR;
            for (const text of splitNarrationText(turn.text, 4500)) {
                const cue = requests.length + 1;
                const performanceTextRanges = [];
                for (const line of text.split('\n')) {
                    const fragment = line.replace(/\s/g, '');
                    if (!fragment) continue;
                    const start = source.indexOf(fragment, sourceCursor);
                    if (start < 0) continue;
                    performanceTextRanges.push({ start, length: fragment.length });
                    sourceCursor = start + fragment.length;
                }
                requests.push({ title: `${poem.title} · Performance · Cue ${cue} · ${turn.speaker}`,
                    text, performanceTextRanges, voice, speaker: turn.speaker, provider: 'elevenlabs', model: 'eleven_flash_v2_5',
                    kind: 'poem', book: book.id, speakTitle: false,
                    filename: `${book.poet} - ${book.id === 'doctor-faustus' ? 'Doctor Faustus' : poem.title} - Cue ${cue} - ${turn.speaker} - ${voices[voice]}.wav` });
            }
        }
        return requests;
    }
    return { voices, loadVoices, castFor, requestsFor };
})();
