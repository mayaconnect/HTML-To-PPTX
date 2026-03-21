# HTML → PPTX Converter

Converts one or multiple HTML files into a single PowerPoint (.pptx) file with pixel-perfect visual fidelity by rendering each HTML file in a headless browser and inserting high-resolution screenshots as full-bleed slide images.

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- A Chromium-compatible environment (Puppeteer downloads its own Chromium)

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open **http://localhost:3000** in your browser.

## Usage

1. Open the web UI at `http://localhost:3000`
2. Drag & drop (or click to browse) one or more `.html` files
3. Choose resolution: **720p** (1280×720) or **1080p** (1920×1080)
4. Click **Convert to PPTX**
5. The generated `presentation.pptx` downloads automatically

### File Ordering

Files are sorted alphabetically by filename. Name your files accordingly to control slide order:
- `slide01.html`
- `slide02.html`
- `slide03.html`

## Architecture

```
WeeklyAcacia/
├── package.json
├── server/
│   ├── index.js          # Express API + Puppeteer + pptxgenjs
│   ├── uploads/          # Temp uploaded HTML files (auto-cleaned)
│   ├── output/           # Temp PPTX output (auto-cleaned)
│   └── screenshots/      # Temp PNG screenshots (auto-cleaned)
├── client/
│   ├── index.html        # Upload UI
│   └── script.js         # Frontend logic
└── slide1.html           # Example HTML slide
```

### Pipeline

1. **Upload** — HTML files are sent to `POST /api/convert` via multipart form
2. **Render** — Each HTML is opened in Puppeteer (headless Chromium) at the chosen viewport size with 2× device scale for crisp images
3. **Screenshot** — A pixel-perfect PNG is captured for each slide
4. **PPTX Build** — `pptxgenjs` creates a 16:9 presentation with each screenshot as a full-bleed slide image
5. **Download** — The `.pptx` file is streamed to the browser
6. **Cleanup** — All temp files (uploads, screenshots, output) are deleted after download

## API

### `POST /api/convert`

Multipart form with:
- `htmlFiles` — one or more `.html` files
- `resolution` — `720p` (default) or `1080p`

Returns the `.pptx` file as a binary download.

### `GET /api/health`

Returns `{ "status": "ok", "resolutions": ["720p", "1080p"] }`.

## Tips

- HTML slides should have a fixed container matching the target resolution (e.g., 1280×720) for best results
- Web fonts loaded via Google Fonts / CDN are fully supported (Puppeteer waits for `document.fonts.ready`)
- Local CSS, images, and assets referenced with relative paths work when the HTML is self-contained or paths resolve correctly from the uploaded file location
