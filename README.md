# John Donne Poetry Website

A beautiful, modern website displaying the complete poems of John Donne, sourced from Project Gutenberg.

## Features

- **289 Poems**: Complete collection of John Donne's poetry from the 1912 edition edited by Herbert J. C. Grierson
- **Beautiful UI**: Modern, responsive design with elegant typography
- **Search Functionality**: Search poems by title or content
- **Modal View**: Read full poems in a clean, focused modal interface
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
- `poems.json` - Parsed poem data (289 poems)
- `parse_poems.py` - Python script to parse poems from Project Gutenberg source

## Usage

### Local Development

Simply open `index.html` in a web browser, or use a local server:

```bash
# Python 3
python3 -m http.server 8000

# Then open http://localhost:8000
```

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
