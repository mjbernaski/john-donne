# John Donne Poetry Website

A beautiful, modern website displaying complete poetry collections sourced from
Project Gutenberg. It began with the poems of John Donne and now serves several
collections from the same interface.

## Features

- **Multiple Collections**: Switch between the poetry books listed in `books.json` from the site header
- **289 Donne Poems**: Complete collection of John Donne's poetry from the 1912 edition edited by Herbert J. C. Grierson
- **376 Whitman Poems**: The complete 1891-92 arrangement of *Leaves of Grass*
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
- `books.json` - The list of collections the site offers, and everything specific to each
- `poems.json` - Parsed Donne poem data (289 poems)
- `poems-whitman.json` - Parsed *Leaves of Grass* data (376 poems)
- `parse_poems.py` - Python script to parse the Donne text from Project Gutenberg source
- `parse_whitman.py` - Python script to parse *Leaves of Grass* from Project Gutenberg source

## Collections

The site does not hard-code a single poet. On load it reads `books.json` and
builds a switcher in the header from it. Today two collections are listed:

| Collection | Poems file | Source |
| --- | --- | --- |
| The Poems of John Donne | `poems.json` | Grierson edition, 1912 — Gutenberg ebook 48688 |
| Leaves of Grass, by Walt Whitman | `poems-whitman.json` | Gutenberg ebook 1322 — 376 poems |

Choosing a collection swaps the poems, the page's titles and description, the
source credit, and the persona the AI companion speaks with. The choice is
remembered in browser storage, so a reader returns to the book they left.

Recently-visited lists are kept per collection, since a poem identifier from one
book never resolves in another. Saved chat sessions and generated audio, by
contrast, are keyed by a hash of the poem's title and text rather than by its
position in a file, so they never collide between collections and survive a
re-parse that reorders the poems.

### What a book entry holds

Each entry in `books.json` carries that collection's display strings — `title`,
`subtitle`, `description`, `sourceUrl`, `sourceNote`, `chatContext`, and
`companionLabel` — alongside the text used to build prompts:

| Field | Used for |
| --- | --- |
| `poet`, `authorProfile`, `sourceProfile` | The chat companion's briefing and the image prompts |
| `readerProfile`, `readingScene`, `readingNotes` | The Gemini narration voice and its performance direction |

Adding a collection is a matter of adding a JSON entry and a poems file. No
front-end code changes.

### `stripEditorialApparatus`

This per-book boolean controls whether the front end applies the
Grierson-specific cleanup that removes textual variants and manuscript sigla
from a poem before displaying it. It is `true` for Donne and **must be `false`
for any edition without such an apparatus**. One of its rules ends a poem at the
first line containing a year between 1500 and 1899, which would truncate many
Whitman poems — "Year of Meteors (1859-60)" would lose its title line and
everything after it.

## Usage

### Local Development

Simply open `index.html` in a web browser, or use a local server:

```bash
# Python 3 (serves the site and proxies authenticated image requests)
python3 server.py

# On the host itself:   http://localhost:8000
# Elsewhere on the LAN:  http://<host>.local:8000
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

### Moving the site to another host

Almost nothing in the application is tied to a machine. The bind address, port,
and both upstream servers live in `config.json`, and the browser only ever talks
to this server's own origin, so readers need no knowledge of where it runs.

Four things are host-specific and need attention on a move:

| Item | What to do |
| --- | --- |
| Service definition | `launchd/com.johndonne.poetry-server.plist` is macOS-only. On a Linux host use `deploy/poetry-server.service` instead, editing `User`, `WorkingDirectory`, and the `server.py` path. |
| Python interpreter | The plist hardcodes the Homebrew path. The systemd unit assumes `/usr/bin/python3`. Only the standard library is used, so any Python 3.9+ works. |
| `.env` | Holds `FLUX_API_KEY` and optionally `GEMINI_API_KEY`. It is gitignored, so copy it across by hand — cloning the repo will not bring it. |
| Reachability | The new host must be able to reach the FLUX and vLLM machines in `config.json`. Confirm with `curl` from the host before starting the service. |

`config.json` itself usually needs no change, since the upstreams are addressed
by IP rather than relative to the server.

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

Every Project Gutenberg edition is marked up differently, so there is one parser
per source. A new collection needs its own parser; there is no generic importer
that accepts an arbitrary Gutenberg URL.

To re-parse the Donne text:

```bash
python3 parse_poems.py <gutenberg-source-file> -o poems.json
```

To re-parse *Leaves of Grass*:

```bash
python3 parse_whitman.py 1322-h.htm -o poems-whitman.json
```

`parse_whitman.py` reads the structure of ebook 1322 directly rather than
guessing at it. It relies on three properties of that edition:

- Every poem is a `<div class="chapter">` holding an `<h2>` and one or more `<pre>` blocks.
- Long poems are split across several `<pre>` blocks, which are rejoined into one body.
- Where a poem opens a cluster, the `<h2>` holds only the book number — "BOOK III" — and the real title sits in a `<p>` above the verse. That is where "Song of Myself" lives.

It also records the cluster name as an optional `section` field on each poem.

## About John Donne

John Donne (1572-1631) was an English poet, scholar, soldier, and secretary born into a recusant family, who later became a cleric in the Church of England. He is considered the pre-eminent representative of the metaphysical poets. His works are notable for their realistic and sensual style and include sonnets, love poems, religious poems, Latin translations, epigrams, elegies, songs, and satires.

## About Walt Whitman

Walt Whitman (1819-1892) was an American poet, essayist, and journalist, and the
central figure of nineteenth-century American verse. *Leaves of Grass* grew
across nine editions from 1855 until his death; the collection here is the
complete 1891-92 arrangement. His long unrhymed line, expansive catalogues, and
direct address to the reader reshaped American poetry.

## Sources

The Donne collection is based on:
- **The Poems of John Donne**
- Edited from the old editions and numerous manuscripts
- By Herbert J. C. Grierson M.A.
- Oxford: Clarendon Press, 1912
- Available at [Project Gutenberg](https://www.gutenberg.org/files/48688/48688-h/48688-h.htm) (ebook 48688)

The Whitman collection is based on:
- **Leaves of Grass**
- By Walt Whitman
- The complete 1891-92 arrangement
- Available at [Project Gutenberg](https://www.gutenberg.org/files/1322/1322-h/1322-h.htm) (ebook 1322)

## License

The source text is in the public domain. This web implementation is provided as-is for educational and personal use.
