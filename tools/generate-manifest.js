import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');
const AMBIENT_DIR = path.join(__dirname, '..', 'public', 'ambient');
const OUT = path.join(__dirname, '..', 'public', 'manifest.json');

const EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

function deriveTitle(file) {
  const stem = file.replace(/\.[A-Za-z0-9]+$/, '');
  const clean = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'Photo';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function runPythonGenerator() {
  const py = process.platform === 'win32' ? 'py' : 'python3';
  const script = path.join(__dirname, 'generate-manifest.py');
  if (!fs.existsSync(script)) return { ok: false };
  const r = spawnSync(py, [script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return { ok: r.status === 0 };
}

const preferPython = process.env.MANIFEST_USE_PYTHON === '1' || process.argv.includes('--python');
if (preferPython) {
  const { ok } = runPythonGenerator();
  if (ok) process.exit(0);
  console.warn('Python manifest failed or unavailable; falling back to Node (center focal only).');
}

const files = fs.existsSync(IMAGES_DIR)
  ? fs.readdirSync(IMAGES_DIR).filter((f) => EXT.test(f) && !f.startsWith('.')).sort((a, b) => a.localeCompare(b))
  : [];

const manifest = {
  generatedAt: new Date().toISOString(),
  images: files.map((file) => ({
    src: `images/${file}`,
    title: deriveTitle(file),
    focal_point: { x: 0.5, y: 0.5 },
    focal_source: 'fallback',
    ambient: fs.existsSync(path.join(AMBIENT_DIR, `${path.parse(file).name}.jpg`))
      ? `ambient/${path.parse(file).name}.jpg`
      : '',
  })),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`Wrote ${manifest.images.length} entries to ${OUT}`);
