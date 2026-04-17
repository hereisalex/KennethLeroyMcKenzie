# Kenneth Leroy McKenzie — Memorial Slideshow

A lean, full-screen memorial site: double-buffered photo cross-fades with Ken Burns zoom, configurable slide duration, YouTube playlist audio, and browsing tools (filmstrip + archive grid). Built with vanilla HTML, CSS, and JavaScript (no framework).

**How the zoom focal point is chosen:** The Ken Burns effect zooms around a single **focal point** per image, stored in the manifest as normalized coordinates `focal_point: { "x", "y" }` (each 0–1, relative to the full image). The browser does not guess this at runtime; it is **set when `public/manifest.json` is generated**. The **Python generator** (`tools/generate-manifest.py`) locates faces in order: **MediaPipe** face detection, then **OpenCV Haar** frontal faces if MediaPipe finds nothing. When several faces are detected, the **center of the face nearest the image center** is used as the focal point, and `focal_source` is `"face"`. If no face is detected, the focal point is the image center `(0.5, 0.5)` with `focal_source: "fallback"`. The **Node-only generator** (`tools/generate-manifest.js`) always uses that center fallback. During playback, the slideshow applies that point as **CSS `transform-origin`** and `**object-position**`, together with **safe zoom** limits so edge-heavy focals do not reveal obvious letterboxing.

## Quick start (Windows, PowerShell)

From the **project root** (the folder that contains `index.html`, `package.json`, and `public/`). Requires **PowerShell 5.1+** (Windows ships this).


| Script                | What it does                                                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**quick-start.ps1`** | Wrapper for `**scripts/dev.ps1 -Start**`: checks Node/npm and manifest, runs setup if needed, then serves the project root with `**npx --yes serve**` and opens the default browser. `**-Port**` (default **3000**), `**-SkipBrowser`** to only start the server.                         |
| `**auto-setup.ps1**`  | Wrapper for `**scripts/dev.ps1 -Setup**`: creates `public/images` if missing, verifies Node/npm, installs Python/OpenCV deps when Python is present, generates `**public/manifest.json**` if it is missing. `**-ForceManifest**` regenerates the manifest after you add or change photos. |
| `**scripts/dev.ps1**` | Single source of truth: `**-Doctor**` prints Node, npm, Python/OpenCV, image count, manifest, and port status; `**-Setup**` same as `auto-setup.ps1`; `**-Start**` same as `quick-start.ps1`.                                                                                             |


```powershell
# If running local scripts is blocked (one-time for your user account is typical):
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

.\scripts\dev.ps1 -Doctor
.\auto-setup.ps1
.\quick-start.ps1
.\quick-start.ps1 -Port 8080 -SkipBrowser
```

To run a helper **without** changing the persistent execution policy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\quick-start.ps1
```

Stop the dev server with **Ctrl+C** in that window. You must open the site over **http://** or **https://** (not `file://`). For macOS/Linux, `npx serve`, and other static servers, see **[Run the app locally](#4-run-the-app-locally)** below.

---

## What you need


| Requirement              | Purpose                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js** (recent LTS) | Run the manifest script (`npm run manifest`). Node is built in; no extra npm packages are required for that script.                                     |
| **A local HTTP server**  | Browsers block `fetch()` for `file://` URLs. You must open the site over `http://` or `https://`.                                                       |
| **Optional: Python 3**   | Richer manifest: face-based focal points, JPEG thumbnails for the filmstrip/archive. Uses OpenCV and optional MediaPipe (see `tools/requirements.txt`). |


---

## 1. Get the project and add photos

1. Clone or copy this repository.
2. Add your images under `**public/images/`** (JPEG, PNG, GIF, WebP, AVIF, or BMP).
3. All commands below assume your **current working directory is the project root** (the folder that contains `index.html`, `package.json`, and `public/`).

---

## 2. Build the manifest (`public/manifest.json`)

The slideshow reads `**public/manifest.json`**. Generate it whenever you add, remove, or rename files in `public/images/`.

### Option A — Node only (simplest)

Uses `**tools/generate-manifest.js**`: scans `public/images/`, writes each image with a `**title**` (derived from the filename), `**focal_point**` at center `(0.5, 0.5)`, and `**focal_source`: `"fallback"**`. No thumbnails.

```bash
npm run manifest
```

Requires Node on your PATH. No `npm install` is required for this script (it uses only Node built-ins).

### Option B — Python (recommended for quality)

Uses `**tools/generate-manifest.py**`: face detection for **focal points**, plus **JPEG thumbnails** in `public/thumbnails/` and a `**thumb`** field per entry (better filmstrip and archive).

**Install Python dependencies once:**

```bash
pip install -r tools/requirements.txt
```

On Windows, if `pip` targets the wrong Python, use the same interpreter you will use to run the script, for example:

```bash
py -m pip install -r tools/requirements.txt
```

**Generate the manifest:**

```bash
npm run manifest:python
```

`package.json` calls `python tools/generate-manifest.py`. If `python` is not on your PATH on Windows, run the script directly:

```bash
py -3 tools/generate-manifest.py
```

### Option C — Node tries Python first, then falls back

Sets `**MANIFEST_USE_PYTHON=1**` so `npm run manifest` runs the Python generator when possible, otherwise Node.

**Windows (Command Prompt):**

```bat
set MANIFEST_USE_PYTHON=1
npm run manifest
```

**Windows (PowerShell):**

```powershell
$env:MANIFEST_USE_PYTHON="1"; npm run manifest
```

**Linux / macOS:**

```bash
MANIFEST_USE_PYTHON=1 npm run manifest
```

### Option D — Windows batch helper

`**run-manifest.bat**` (in the project root) uses `**py**`, ensures OpenCV is importable (installs `tools/requirements.txt` if needed), then runs `**tools/generate-manifest.py**`.

```bat
run-manifest.bat
```

Double-click it from Explorer or run it from a terminal with the project root as the current directory.

### Manifest commands summary


| Command                                  | What it runs                        | Output                                                        |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| `npm run manifest`                       | `node tools/generate-manifest.js`   | `title`, center focal, no `thumb`                             |
| `npm run manifest:python`                | `python tools/generate-manifest.py` | `title`, face focal (when found), `thumb`, thumbnails on disk |
| `MANIFEST_USE_PYTHON=1 npm run manifest` | Python first, else Node             | Same as whichever succeeds                                    |


---

## 3. Configure the YouTube playlist (optional)

Music comes from a **YouTube playlist** (IFrame API). Set the playlist ID (the `list=` value from a playlist URL):

- **Preferred:** In `**index.html`**, set `**data-youtube-playlist**` on `**#app**` to your playlist ID, **or**
- Edit `**DEFAULT_PLAYLIST_ID`** in `**src/js/app.js**`.

If YouTube fails to load, the slideshow still runs; a status message appears and track controls are disabled.

---

## 4. Run the app locally

You **must** serve the **project root** as the HTTP document root—the folder that contains `**index.html`**, `**src/**`, and `**public/**`. Do **not** point the server only at `public/`, or URLs like `src/js/app.js` and `public/manifest.json` will break.

### Windows: PowerShell helpers

Use the **[Quick start (Windows, PowerShell)](#quick-start-windows-powershell)** section at the top of this README for `**quick-start.ps1`**, `**auto-setup.ps1**`, and `**scripts/dev.ps1**`. The dev server is `**serve**` via `**npx**` (no global install).

### Using npx (no global install)

From the project root:

```bash
npx --yes serve .
```

Open the URL it prints (often `http://localhost:3000`). Other ports are fine.

### Other static servers (same rule: root = project root)

Examples:

```bash
npx --yes http-server . -p 8080
```

```bash
python -m http.server 8080
```

(Python serves the current directory; run the command from the project root.)

### Using the site

1. Open the site in a browser.
2. Click **Begin memorial** so audio can start (browser autoplay rules require a user gesture).
3. Use the bottom bar for slides, timing, music, archive, fullscreen, etc.

---

## 5. Shared reactions and comments (database-backed)

Reactions and comments are **live and shared with everyone** who visits the memorial. They are persisted in Upstash Redis via the serverless function at `api/feedback.js`, which this project expects to be hosted same-origin on Vercel (see **Deploy to Vercel** below).

The `#app` element in `index.html` points at the endpoint via `data-feedback-api="/api/feedback"`. If you host the static site elsewhere (for example, GitHub Pages) and the API on a separate Vercel deployment, change that attribute to the absolute API URL (e.g. `https://your-api.vercel.app/api/feedback`) and set `FEEDBACK_ALLOWED_ORIGINS` on the Vercel project to your site's origin.

---

## Slide timing (control bar)

- **Slide speed:** range control (1–60 seconds per photo, saved in `localStorage`). Sets photo duration and Ken Burns cycle length.

## Controls and shortcuts

- **Bottom bar (single row):** slideshow prev / play-pause / next / fullscreen / settings, download / share / feedback, slide-speed slider, music prev / play-pause / next, volume. The gear opens a settings popover that holds the **Full photo (no crop)** toggle.
- **Carousel row:** the "all photos" archive button sits to the left of the filmstrip; the rest of the row is a horizontal thumbnail scrubber around the current slide.
- **Mouse / touch:** move or touch to show the bar; it hides after idle time.


| Input     | Action                                                        |
| --------- | ------------------------------------------------------------- |
| `Space`   | Play / pause                                                  |
| `←` / `→` | Previous / next photo                                         |
| `F`       | Toggle fullscreen                                             |
| `G`       | Open photo archive (close with `G` or `Esc`)                  |
| `Esc`     | Close archive or feedback, or exit fullscreen when applicable |


**Media keys / lock screen:** Media Session controls play, pause, and YouTube previous/next **track** (not photo skip).

## Director features (focal + safe zoom)

- Ken Burns **oscillates** between base scale and a safe maximum over each slide (same length as **Slide speed**).
- Each manifest image may include `**focal_point`**: `{ "x": 0–1, "y": 0–1 }` (Python generator or hand-edited).
- The slide uses that point for **transform-origin** and **object-position**, with **safe zoom** so edge-heavy focals do not reveal obvious letterboxing.

## Metadata fields (optional)

Each image in `public/manifest.json` can include storytelling fields used for captions and image alt text:

- `**title`** (string): display title.
- `**date**` or `**year**` (string): detail line.
- `**location**` (string): detail line.
- `**people**` (string[]): detail line.
- `**caption**` / `**description**` / `**memory**` / `**story**` (string): long caption.

Example:

```json
{
  "src": "images/1966 Germany.jpg",
  "title": "Germany, 1966",
  "date": "1966",
  "location": "Germany",
  "people": ["Ken"],
  "caption": "One of his early military years overseas.",
  "focal_point": { "x": 0.38, "y": 0.47 },
  "focal_source": "face",
  "thumb": "thumbnails/1966 Germany.jpg"
}
```

## Project layout

```text
index.html              # Entry; optional data-youtube-playlist, data-feedback-api on #app
quick-start.ps1         # Windows: dev.ps1 -Start (local server + browser)
auto-setup.ps1          # Windows: dev.ps1 -Setup (idempotent manifest + deps)
public/
  images/               # Your photos
  thumbnails/           # JPEG previews (Python manifest); optional
  manifest.json         # Generated — run a manifest script after image changes
src/
  css/style.css
  js/app.js             # Slideshow, UI, browsing
  js/youtube.js         # IFrame API loader + playlist player
scripts/
  dev.ps1               # Windows: -Doctor / -Setup / -Start (single source of truth)
tools/
  generate-manifest.js  # Node manifest
  generate-manifest.py  # Python manifest + focal + thumbnails
  requirements.txt
api/
  feedback.js           # Optional serverless API for shared feedback
package.json
run-manifest.bat        # Windows: Python manifest with dependency check
```

## Deploy to Vercel (recommended)

Vercel hosts both the static site and the serverless comments API in one place, same-origin. That means `data-feedback-api="/api/feedback"` works as-is with no CORS configuration.

1. **Create an Upstash Redis database.** Free tier works. Copy the two REST credentials: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. **Import the repo on Vercel.** Framework preset: **Other**. Build command: leave blank. Output directory: leave blank. The included `vercel.json` handles caching headers; `api/feedback.js` is picked up automatically as a serverless function.
3. **Add env vars** in **Settings → Environment Variables**:
   - `UPSTASH_REDIS_REST_URL` — from Upstash.
   - `UPSTASH_REDIS_REST_TOKEN` — from Upstash.
   - *(Optional)* `FEEDBACK_ALLOWED_ORIGINS` — comma-separated list of origins allowed to POST (e.g. `https://mckenzie-memorial.vercel.app`). Leave empty to allow any origin.
   - *(Optional)* `FEEDBACK_MAX_POSTS_PER_MINUTE`, `FEEDBACK_MAX_COMMENTS_PER_15MIN`, `FEEDBACK_COMMENT_BLOCKLIST` for rate-limit / moderation tuning.
4. **Deploy.** Visit the Vercel URL; reactions and comments will round-trip through `api/feedback` and appear for every visitor.
5. **Update photos:** regenerate `public/manifest.json` locally (`npm run manifest` or the Python equivalent), commit, and push. Vercel redeploys automatically.

### Deploy static only to GitHub Pages (API elsewhere)

If you prefer to keep the site on GitHub Pages, host only `api/feedback.js` on Vercel and set `data-feedback-api` on `#app` in `index.html` to the absolute function URL (e.g. `https://klm-feedback.vercel.app/api/feedback`). Add your Pages origin to `FEEDBACK_ALLOWED_ORIGINS` on the Vercel project so the API accepts cross-origin posts. Everything else in this README applies unchanged.

**First-time push (after creating an empty repo on GitHub, no README added by GitHub):**

```bash
git init
git add .
git commit -m "Initial commit: memorial slideshow"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## Troubleshooting

- **PowerShell “running scripts is disabled”:** Use `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\quick-start.ps1`.
- **Blank images or manifest errors:** Serve the **project root** (not only `public/`). Ensure `public/manifest.json` exists (`npm run manifest`, `**.\auto-setup.ps1`**, or Python equivalent).
- **No audio until click:** Expected; use **Begin memorial** or the play control after a gesture.
- **YouTube unavailable:** Slideshow continues without music; status message and disabled track controls.
- **Fullscreen:** Some mobile browsers only support fullscreen for `<video>`; desktop fullscreen targets `#app`.
- **Python `python` not found (Windows):** Use `py -3 tools/generate-manifest.py` or `run-manifest.bat`.

## License / use

Private memorial project; use and adapt as you see fit for your own family site.