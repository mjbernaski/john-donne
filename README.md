# John Donne Poetry Website

A beautiful, modern website displaying the complete poems of John Donne, sourced from Project Gutenberg.

## Features

- **289 Poems**: Complete collection of John Donne's poetry from the 1912 edition edited by Herbert J. C. Grierson
- **Beautiful UI**: Modern, responsive design with elegant typography
- **Search Functionality**: Search poems by title or content
- **Modal View**: Read full poems in a clean, focused modal interface
- **Per-Poem AI Chat**: Discuss each poem in a dedicated conversation with a local vLLM model
- **Persistent Conversations**: Keep each poem's discussion and context across page reloads
- **Visual Companions**: Generate a length-scaled set of FLUX illustrations for each poem
- **Gemini Narration**: Hear poems and model responses performed with distinct voices
- **Responsive Design**: Works perfectly on desktop, tablet, and mobile devices

## Technology Stack

- **HTML5**: Semantic markup
- **CSS3**: Modern styling with CSS Grid and Flexbox
- **Vanilla JavaScript**: No frameworks, pure JS for performance
- **Python**: Parser script to extract poems from Project Gutenberg HTML

## Files

- `index.html` - Main website structure
- `styles.css` - Complete styling and responsive design
- `app.js` - JavaScript for interactivity, search, and modal functionality
- `server.py` - Static development server and authenticated FLUX request proxy
- `poems.json` - Parsed poem data (289 poems)
- `parse_poems.py` - Python script to parse poems from Project Gutenberg source

## Usage

### Local Development

Simply open `index.html` in a web browser, or use a local server:

```bash
# Python 3 (serves the site and proxies authenticated image requests)
python3 server.py

# On this Mac: http://localhost:8000
# Elsewhere on the LAN: http://mjblaptop.local:8000
```

By default, the server binds to `0.0.0.0`, so it accepts connections on every
network interface. On this machine it is installed as the macOS launch agent
`com.johndonne.poetry-server`: it starts at login and is restarted by `launchd`
if it exits. Its output is written to `server.log` and `server.error.log`.

Useful service commands:

```bash
launchctl print gui/$(id -u)/com.johndonne.poetry-server
launchctl kickstart -k gui/$(id -u)/com.johndonne.poetry-server
```

## Service addresses

Both upstream machines are configured in `config.json`, along with the bind
address and port:

```json
{
  "server": { "host": "0.0.0.0", "port": 8000 },
  "upstreams": {
    "flux": "http://192.168.5.40:2222",
    "vllm": "http://192.168.5.46:8100"
  }
}
```

Change an address there and restart the service; nothing else needs editing.
The environment variables `FLUX_BASE_URL` and `VLLM_BASE_URL` override the file,
and `--host`/`--port` override the `server` block.

The browser only ever talks to this server's own origin. Both upstreams are
reached through allow-listed reverse proxies, so a reader's device never needs
LAN access to either machine:

| Browser path | Upstream | Allowed endpoints |
| --- | --- | --- |
| `/api/chat/*` | vLLM | `/v1/models`, `/v1/chat/completions` |
| `/api/flux/*` | FLUX | `/status`, `/generate`, `/images/*` |

The chat proxy forwards its response body chunk by chunk, so streamed tokens
still arrive as they are generated. Conversation history is kept separately for
each poem and restored from browser storage after a reload.

The **Be brief** toggle in the chat header asks for answers of three or four
sentences and lowers the reply token ceiling. It applies from the next message
onward, including in conversations already underway, and the setting persists
across reloads.

Image generation requires the FLUX access key. Enter it once in the Visual
Companions panel; it is saved only in browser storage. Alternatively, provide
the key to the local server process without exposing it to browser JavaScript:

```bash
FLUX_API_KEY=your-key python3 server.py
```

The server also reads `FLUX_API_KEY` and `GEMINI_API_KEY` from a local `.env`
file. That file is ignored by Git.

Images are meant to carry no text. Sending the poem's own lines to FLUX made it
render them onto pages and banners, so each poem is first distilled by the model
server into a short visual scene description, and only that description reaches
the image server. If the model server is unreachable, generation still proceeds
from the style and composition direction alone — the poem's words are never sent
to FLUX. (`negative_prompt` is left `null`: this FLUX build rejects it unless
started with `--sdxl`.)

Short poems receive one image, with progressively longer poems receiving up to
five distinct visual interpretations. Conversation history and generated-image
records are stored separately for each poem in browser storage.

Poem narration uses `gemini-3.1-flash-tts-preview`. Set the Gemini key on the
local server (recommended), or enter it once in the narration panel:

```bash
GEMINI_API_KEY=gemini-key FLUX_API_KEY=flux-key python3 server.py
```

The narration proxy breaks long poems at stanza boundaries, synthesizes each
section with consistent performance direction, and joins the PCM output into a
single WAV player. The feminine option uses the mature Gacrux voice; the
masculine option uses the smooth Algieba voice. Each completed model response
also has its own listen control using the distinct, clear Iapetus voice. The
WAV performances are stored in IndexedDB and automatically reused for the same
poem, selected voice, or saved model response on later visits.

### Parsing Poems

To re-parse poems from the Project Gutenberg source:

```bash
python3 parse_poems.py
```

## About John Donne

John Donne (1572-1631) was an English poet, scholar, soldier, and secretary born into a recusant family, who later became a cleric in the Church of England. He is considered the pre-eminent representative of the metaphysical poets. His works are notable for their realistic and sensual style and include sonnets, love poems, religious poems, Latin translations, epigrams, elegies, songs, and satires.

## Source

This collection is based on:
- **The Poems of John Donne**
- Edited from the old editions and numerous manuscripts
- By Herbert J. C. Grierson M.A.
- Oxford: Clarendon Press, 1912
- Available at [Project Gutenberg](https://www.gutenberg.org/files/48688/48688-h/48688-h.htm)

## License

The source text is in the public domain. This web implementation is provided as-is for educational and personal use.
