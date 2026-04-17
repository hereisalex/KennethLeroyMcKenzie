import { createPlaylistPlayer } from './youtube.js';

/** Resolve from this module’s URL so manifest and assets load even when the page URL is not at site root. */
const MANIFEST_URL = new URL('../../public/manifest.json', import.meta.url).href;
const PUBLIC_BASE = new URL('../../public/', import.meta.url).href;
const CONTROLS_HIDE_MS = 3_000;
/** Max Ken Burns scale at image center; safe zoom raises min scale and tightens max near edges. */
const KEN_BURNS_MAX_SCALE = 1.15;
/** Keep at least 80% of any image visible while Ken Burns runs. */
const MIN_VISIBLE_IMAGE_FRACTION = 0.8;
/** Max base upscale used to close the letterbox on aspect-mismatched photos. 1.20 caps crop at ~17%
    of the short axis so we reduce dead space without lopping heads off square portraits. */
const MAX_FIT_SCALE = 1.2;
const GRAB_RUBBER_SOFT_PX = 72;
const GRAB_RUBBER_HARD_PX = 140;
const GESTURE_MIN_SCALE = 0.5;
const GESTURE_MAX_SCALE = 4;
const SNAP_BACK_MS = 550;
const SNAP_BACK_EASE = 'cubic-bezier(0.175, 0.885, 0.32, 1.275)';
const PRELOAD_AHEAD_COUNT = 3;
const STATUS_BANNER_MS = 5200;
const AUDIO_STORAGE_KEY = 'klm-memorial-audio';
const SLIDE_TIMING_KEY = 'klm-memorial-slide-sec';
const FIT_CONTAIN_KEY = 'klm-memorial-fit-full';
const PHOTO_REACTION_IDS = new Set(['heart', 'pray', 'smile', 'tear', 'flower']);
/** Half-window each side of current index → 9 thumbnails when possible */
const FILMSTRIP_HALF = 4;
/** Default playlist ID; override with <div id="app" data-youtube-playlist="PL…"> */
const DEFAULT_PLAYLIST_ID = 'PLN-SBKLnxgwvH4TKfsWG6YMYLPzg5aGXp';
const VISITOR_ID_KEY = 'klm-memorial-visitor-id';
/** Session flag after unlocking Director tools with #focal=&lt;secret&gt;. */
const FOCAL_SESSION_KEY = 'klm-focal-unlocked';

const appRoot = document.getElementById('app');
const statusBanner = document.getElementById('status-banner');
const slideMetaTitle = document.getElementById('slide-meta-title');
const slideMetaDetail = document.getElementById('slide-meta-detail');
const slideMetaCaption = document.getElementById('slide-meta-caption');
const fatalOverlay = document.getElementById('fatal-overlay');
const fatalMessage = document.getElementById('fatal-message');
const fatalRetryBtn = document.getElementById('fatal-retry');
const PLAYLIST_ID =
  appRoot?.dataset?.youtubePlaylist != null && String(appRoot.dataset.youtubePlaylist).trim() !== ''
    ? String(appRoot.dataset.youtubePlaylist).trim()
    : DEFAULT_PLAYLIST_ID;

function getFeedbackApiBase() {
  const raw = appRoot?.dataset?.feedbackApi;
  if (raw == null) return '';
  return String(raw).trim().replace(/\/$/, '');
}

function feedbackApiConfigured() {
  return getFeedbackApiBase().length > 0;
}

function getOrCreateVisitorId() {
  try {
    let v = localStorage.getItem(VISITOR_ID_KEY);
    if (v && v.length > 8) return v;
    v =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(VISITOR_ID_KEY, v);
    return v;
  } catch {
    return `anon-${Date.now()}`;
  }
}
const stageEl = document.querySelector('#stage');
const bufferA = document.querySelector('#buffer-a');
const bufferB = document.querySelector('#buffer-b');
const bgA = bufferA?.querySelector('.slide-bg');
const bgB = bufferB?.querySelector('.slide-bg');
const wrapA = bufferA?.querySelector('.slide-img-wrap');
const wrapB = bufferB?.querySelector('.slide-img-wrap');
const imgA = bufferA?.querySelector('.slide-img');
const imgB = bufferB?.querySelector('.slide-img');
const startOverlay = document.querySelector('#start-overlay');
const startBtn = document.querySelector('#start-memorial');
const startHint = startOverlay?.querySelector('.start-overlay__hint');
const chromeDock = document.querySelector('#chrome-dock');
const filmstripEl = document.querySelector('#filmstrip');
const archiveOverlay = document.querySelector('#archive-overlay');
const archiveGridEl = document.querySelector('#archive-grid');
const archiveBackdrop = document.querySelector('#archive-backdrop');
const archiveCloseBtn = document.querySelector('#archive-close');
const feedbackOverlay = document.querySelector('#feedback-overlay');
const feedbackBackdrop = document.querySelector('#feedback-backdrop');
const feedbackCloseBtn = document.querySelector('#feedback-close');
const feedbackPhotoLabel = document.querySelector('#feedback-photo-label');
const feedbackCommentList = document.querySelector('#feedback-comment-list');
const feedbackCommentEmpty = document.querySelector('#feedback-comments-empty');
const feedbackCommentForm = document.querySelector('#feedback-comment-form');
const feedbackCommentInput = document.querySelector('#feedback-comment-input');
const ctrlSlidePrev = document.querySelector('#ctrl-slide-prev');
const ctrlSlideNext = document.querySelector('#ctrl-slide-next');
const ctrlDownloadSlide = document.querySelector('#ctrl-download-slide');
const ctrlShareSlide = document.querySelector('#ctrl-share-slide');
const ctrlPhotoFeedback = document.querySelector('#ctrl-photo-feedback');
const ctrlPlayPause = document.querySelector('#ctrl-play-pause');
const ctrlTrackPrev = document.querySelector('#ctrl-track-prev');
const ctrlTrackNext = document.querySelector('#ctrl-track-next');
const ctrlMute = document.querySelector('#ctrl-mute');
const ctrlVolume = document.querySelector('#ctrl-volume');
const ctrlVolumeReadout = document.querySelector('#ctrl-volume-readout');
const ctrlFullscreen = document.querySelector('#ctrl-fullscreen');
const ctrlArchive = document.querySelector('#ctrl-archive');
const ctrlSlideSec = document.querySelector('#ctrl-slide-sec');
const ctrlSlideSecVal = document.querySelector('#ctrl-slide-sec-val');
const ctrlFitFull = document.querySelector('#ctrl-fit-full');
const ctrlSettings = document.querySelector('#ctrl-settings');
const ctrlSettingsWrap = document.querySelector('#ctrl-settings-wrap');
const ctrlSettingsPopover = document.querySelector('#ctrl-settings-popover');
const ctrlMore = document.querySelector('#ctrl-more');
const ctrlMusicPlayPause = document.querySelector('#ctrl-music-play-pause');
const controlsTray = document.querySelector('#controls-tray');
const controlsTrayBackdrop = document.querySelector('#controls-tray-backdrop');
const focalEditorRoot = document.getElementById('focal-editor-root');
const focalEditorToggle = document.getElementById('focal-editor-toggle');
const focalEditorPanel = document.getElementById('focal-editor-panel');
const focalEditorVals = document.getElementById('focal-editor-vals');
const focalEditorCopy = document.getElementById('focal-editor-copy');
const focalEditorLock = document.getElementById('focal-editor-lock');

let activeEl = bufferA;
let inactiveEl = bufferB;
let activeBg = bgA;
let inactiveBg = bgB;
let activeImg = imgA;
let inactiveImg = imgB;
let activeWrap = wrapA;
let inactiveWrap = wrapB;
let images = [];
let index = 0;
let slideshowTimerId = 0;
let controlsHideTimerId = 0;
let audioSaveTimerId = 0;
let statusBannerTimerId = 0;
let ytPlayer = null;
/** When true, slideshow timer is cleared and no automatic advances run. */
let slideshowPaused = false;
let audioVolume = 80;
let audioMuted = false;
let archiveGridBuilt = false;
let ytPlayerAvailable = false;
let lastYtVideoId = '';
/** Seconds per slide (slider + localStorage). */
let manualSlideSeconds = 5;
/** Letterbox full image; disables Ken Burns and elastic drag on the stage. */
let fitContainMode = false;
/**
 * Per photo cache mirroring the database: myReactions = this visitor's picks; reactionCounts =
 * shared totals; comments = list. Entries are populated lazily as the feedback overlay opens
 * each photo, and refreshed against the API whenever the panel is re-rendered.
 * @type {Record<string, { myReactions: string[]; reactionCounts: Record<string, number>; comments: Array<{ id: string; text: string; at: string }> }>}
 */
let feedbackStoreCache = {};
/** True from stage pointerdown until snap-back transition finishes (or no-op release). */
let grabInteractionActive = false;
/** Active pointers on the stage (multitouch zoom / pan / rotate). */
const touchPointers = new Map();
let gestureMode = 'none';
/** @type {{ sx: number; sy: number; tx0: number; ty0: number } | null} */
let panStart = null;
/** @type {{ dist0: number; ang0: number; midX0: number; midY0: number; tx0: number; ty0: number; s0: number; r0: number } | null} */
let pinchStart = null;
let panCapturePointerId = null;
let userTx = 0;
let userTy = 0;
let userScale = 1;
let userDeg = 0;
let focusTrapCleanup = null;
let lastFocusBeforeModal = null;
/** Focal preview dot (created when Director tools first used). */
let focalEditorDot = null;
let mobileControlsExpanded = false;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function prettyFilename(src) {
  if (!src) return '';
  const leaf = src.includes('/') ? src.split('/').pop() ?? src : src;
  const noExt = leaf.replace(/\.[A-Za-z0-9]+$/, '');
  const withSpaces = noExt
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withSpaces) return '';
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

/** User-facing label without filenames (used for thumbs, aria, alt). */
function slideOrdinalLabel(i) {
  const n = images.length;
  if (n <= 0) return 'Memorial photo';
  return `Photo ${i + 1} of ${n}`;
}

function metadataDetail(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const out = [];
  if (typeof entry.date === 'string' && entry.date.trim()) out.push(entry.date.trim());
  else if (typeof entry.year === 'string' && entry.year.trim()) out.push(entry.year.trim());
  if (typeof entry.location === 'string' && entry.location.trim()) out.push(entry.location.trim());
  if (Array.isArray(entry.people) && entry.people.length > 0) {
    const people = entry.people
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim());
    if (people.length > 0) out.push(people.join(', '));
  }
  return out.join(' - ');
}

function metadataCaption(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const candidates = [entry.caption, entry.description, entry.memory, entry.story];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function buildImageAlt(entry, i = index) {
  const detail = metadataDetail(entry);
  const caption = metadataCaption(entry);
  const parts = [caption, detail].filter(Boolean);
  if (parts.length) return parts.join('. ');
  return slideOrdinalLabel(i);
}

function updateSlideMeta(entry, i = index) {
  if (!slideMetaTitle || !slideMetaDetail || !slideMetaCaption) return;
  slideMetaTitle.textContent = '';
  slideMetaTitle.hidden = true;
  const detail = metadataDetail(entry);
  const caption = metadataCaption(entry);
  slideMetaDetail.textContent = detail;
  slideMetaDetail.hidden = detail.length === 0;
  slideMetaCaption.textContent = caption;
  slideMetaCaption.hidden = caption.length === 0;
}

function showStatusBanner(message) {
  if (!statusBanner || !message) return;
  statusBanner.textContent = message;
  statusBanner.hidden = false;
  clearTimeout(statusBannerTimerId);
  statusBannerTimerId = window.setTimeout(() => {
    if (statusBanner) statusBanner.hidden = true;
  }, STATUS_BANNER_MS);
}

function showFatalOverlay(message) {
  if (!fatalOverlay || !fatalMessage) return;
  fatalMessage.textContent = message;
  fatalOverlay.hidden = false;
  appRoot?.classList.add('has-fatal');
  document.body.classList.remove('body--chrome-hidden');
  chromeDock?.classList.add('chrome-dock--hidden');
  clearSlideshowTimer();
  activateFocusTrap(fatalOverlay, fatalRetryBtn ?? null);
}

function hideFatalOverlay() {
  if (!fatalOverlay) return;
  fatalOverlay.hidden = true;
  appRoot?.classList.remove('has-fatal');
  releaseFocusTrap();
}

function activateFocusTrap(root, initialFocusEl) {
  if (!root) return;
  if (focusTrapCleanup) focusTrapCleanup();
  lastFocusBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const getFocusables = () => {
    const nodes = root.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    return [...nodes].filter((el) => el instanceof HTMLElement && !el.hasAttribute('hidden'));
  };
  const onKeydown = (e) => {
    if (e.key !== 'Tab') return;
    const list = getFocusables();
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      }
      return;
    }
    if (active === last || !root.contains(active)) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  };
  document.addEventListener('keydown', onKeydown, true);
  focusTrapCleanup = () => {
    document.removeEventListener('keydown', onKeydown, true);
    focusTrapCleanup = null;
    const restore = lastFocusBeforeModal;
    lastFocusBeforeModal = null;
    if (restore?.isConnected) restore.focus({ preventScroll: true });
  };
  const target = initialFocusEl instanceof HTMLElement ? initialFocusEl : getFocusables()[0];
  target?.focus({ preventScroll: true });
}

function releaseFocusTrap() {
  if (!focusTrapCleanup) return;
  focusTrapCleanup();
}

function loadSlideTimingPrefs() {
  try {
    const raw = localStorage.getItem(SLIDE_TIMING_KEY);
    if (raw == null) return;
    const n = parseFloat(raw);
    if (Number.isFinite(n)) manualSlideSeconds = clamp(n, 1, 60);
  } catch {
    /* ignore */
  }
}

function saveSlideTimingPrefs() {
  try {
    localStorage.setItem(SLIDE_TIMING_KEY, String(manualSlideSeconds));
  } catch {
    /* ignore */
  }
}

function loadFitContainPrefs() {
  try {
    const raw = localStorage.getItem(FIT_CONTAIN_KEY);
    if (raw === '1' || raw === 'true') fitContainMode = true;
    else if (raw === '0' || raw === 'false') fitContainMode = false;
  } catch {
    /* ignore */
  }
}

function saveFitContainPrefs() {
  try {
    localStorage.setItem(FIT_CONTAIN_KEY, fitContainMode ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function syncRootFitContainClass() {
  appRoot?.classList.toggle('slideshow-fit-contain', fitContainMode);
}

function syncFitContainUi() {
  if (ctrlFitFull) ctrlFitFull.checked = fitContainMode;
}

function formatSecLabel(sec) {
  const r = Math.round(sec * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + 's';
}

function syncSlideTimingUi() {
  if (ctrlSlideSec) {
    ctrlSlideSec.value = String(manualSlideSeconds);
    ctrlSlideSec.setAttribute('aria-valuenow', String(manualSlideSeconds));
  }
  if (ctrlSlideSecVal) ctrlSlideSecVal.textContent = formatSecLabel(manualSlideSeconds);
}

function loadAudioPrefs() {
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (typeof o.volume === 'number' && Number.isFinite(o.volume)) {
      audioVolume = clamp(Math.round(o.volume), 0, 100);
    }
    if (typeof o.muted === 'boolean') {
      audioMuted = o.muted;
    }
  } catch {
    /* ignore */
  }
}

function scheduleSaveAudioPrefs() {
  clearTimeout(audioSaveTimerId);
  audioSaveTimerId = window.setTimeout(() => {
    try {
      localStorage.setItem(
        AUDIO_STORAGE_KEY,
        JSON.stringify({ volume: audioVolume, muted: audioMuted }),
      );
    } catch {
      /* ignore */
    }
  }, 250);
}

function applyVolumeToPlayer() {
  if (!ytPlayer) return;
  try {
    ytPlayer.setVolume?.(audioVolume);
    if (audioMuted) ytPlayer.mute?.();
    else ytPlayer.unMute?.();
  } catch {
    /* ignore */
  }
}

function syncVolumeUi() {
  if (ctrlVolume) {
    ctrlVolume.value = String(audioVolume);
    ctrlVolume.setAttribute('aria-valuenow', String(audioVolume));
  }
  if (ctrlVolumeReadout) {
    ctrlVolumeReadout.textContent = audioMuted ? '0' : String(audioVolume);
  }
  if (ctrlMute) {
    ctrlMute.classList.toggle('is-muted', audioMuted);
    ctrlMute.setAttribute('aria-label', audioMuted ? 'Unmute' : 'Mute');
  }
}

function swapBuffers() {
  [activeEl, inactiveEl] = [inactiveEl, activeEl];
  [activeBg, inactiveBg] = [inactiveBg, activeBg];
  [activeImg, inactiveImg] = [inactiveImg, activeImg];
  [activeWrap, inactiveWrap] = [inactiveWrap, activeWrap];
}

function preload(url) {
  const i = new Image();
  i.decoding = 'async';
  i.src = url;
}

function getManifestEntryAt(i) {
  const n = images.length;
  if (n === 0) return null;
  const idx = ((i % n) + n) % n;
  return images[idx];
}

function getFocalPoint(entry) {
  let x = 0.5;
  let y = 0.5;
  if (entry && typeof entry === 'object' && entry.focal_point) {
    const fp = entry.focal_point;
    if (typeof fp.x === 'number' && Number.isFinite(fp.x)) x = clamp(fp.x, 0, 1);
    if (typeof fp.y === 'number' && Number.isFinite(fp.y)) y = clamp(fp.y, 0, 1);
  }
  return { x, y };
}

function hashString32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Use manifest focal_source when present; legacy manifests use focal drift if point is off-center.
 */
function usesFaceFocalForKenBurns(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.focal_source === 'face') return true;
  if (entry.focal_source === 'fallback') return false;
  const { x, y } = getFocalPoint(entry);
  return Math.hypot(x - 0.5, y - 0.5) > 0.04;
}

/** Deterministically pick one item from `items` using the provided seeded RNG and weights. */
function weightedPick(rnd, items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    if (r < weights[i]) return items[i];
    r -= weights[i];
  }
  return items[items.length - 1];
}

/**
 * Build a per-slide Ken Burns plan: start/end scale and translate in image-local percent, plus
 * the chosen `mode` for debugging/telemetry. Output is deterministic so the same photo always
 * gets the same motion (no jarring variation when revisiting a slide).
 *
 * Modes roughly mirror Apple Photos' cinematic Ken Burns vocabulary:
 *  - `zoom-in`       slow push toward the subject (most common with a face focal)
 *  - `zoom-out`      pull-back reveal starting tight, ending wide
 *  - `pan`           steady slide across the photo at a held mid-zoom
 *  - `zoom-in-pan`   push while drifting diagonally toward the focal
 *  - `zoom-out-pan`  reveal while drifting away from the subject
 */
function planKenBurns(entry, img) {
  const focal = getFocalPoint(entry);
  const useFaceFocal = usesFaceFocalForKenBurns(entry);
  const { minScale, maxScale } = calculateSafeScale(img);
  const range = Math.max(0.04, maxScale - minScale);
  const driftLimitPct = clamp(range * 28, 1.8, 4.6);
  const midScale = minScale + range * 0.7;
  const endSettleScale = Math.max(1.015, minScale + range * 0.12);

  const key = imageUrl(entry) || 'slide';
  const rnd = mulberry32(hashString32(`${key}|ken-burns-v2`));

  // Face focals prefer push-in motion so the viewer's eye lands on the subject; generic photos
  // get a more even mix so the overall reel never feels repetitive.
  const modes = ['zoom-in', 'zoom-out', 'pan', 'zoom-in-pan', 'zoom-out-pan'];
  const weights = useFaceFocal ? [3, 1, 0.6, 2.4, 1.2] : [2, 1.8, 1.4, 2, 1.6];
  const mode = weightedPick(rnd, modes, weights);

  const fx = useFaceFocal ? (focal.x - 0.5) * 2 : 0;
  const fy = useFaceFocal ? (focal.y - 0.5) * 2 : 0;
  const rndAngle = rnd() * Math.PI * 2;
  const cosA = Math.cos(rndAngle);
  const sinA = Math.sin(rndAngle);

  let s0 = minScale;
  let s1 = maxScale;
  let tx0 = 0;
  let ty0 = 0;
  let tx1 = 0;
  let ty1 = 0;

  switch (mode) {
    case 'zoom-in': {
      s0 = minScale;
      s1 = maxScale;
      tx0 = useFaceFocal ? -fx * driftLimitPct * 0.35 : cosA * driftLimitPct * 0.22;
      ty0 = useFaceFocal ? -fy * driftLimitPct * 0.35 : sinA * driftLimitPct * 0.22;
      tx1 = useFaceFocal ? fx * driftLimitPct * 0.55 : -cosA * driftLimitPct * 0.38;
      ty1 = useFaceFocal ? fy * driftLimitPct * 0.55 : -sinA * driftLimitPct * 0.38;
      break;
    }
    case 'zoom-out': {
      s0 = maxScale;
      s1 = endSettleScale;
      tx0 = useFaceFocal ? fx * driftLimitPct * 0.5 : cosA * driftLimitPct * 0.42;
      ty0 = useFaceFocal ? fy * driftLimitPct * 0.5 : sinA * driftLimitPct * 0.42;
      tx1 = useFaceFocal ? fx * driftLimitPct * 0.1 : 0;
      ty1 = useFaceFocal ? fy * driftLimitPct * 0.1 : 0;
      break;
    }
    case 'pan': {
      s0 = midScale;
      s1 = midScale;
      // Pan across the midline; face focals slide toward the subject so it crosses screen center.
      const dirA = useFaceFocal ? Math.atan2(fy || 1e-3, fx || 1e-3) + Math.PI : rndAngle;
      const mag = driftLimitPct * 1.1;
      tx0 = Math.cos(dirA) * mag * 0.55;
      ty0 = Math.sin(dirA) * mag * 0.55;
      tx1 = -Math.cos(dirA) * mag * 0.55;
      ty1 = -Math.sin(dirA) * mag * 0.55;
      break;
    }
    case 'zoom-in-pan': {
      s0 = minScale + range * 0.08;
      s1 = maxScale;
      const dx = cosA * driftLimitPct * 0.55;
      const dy = sinA * driftLimitPct * 0.55;
      tx0 = dx;
      ty0 = dy;
      tx1 = -dx * 0.65 + (useFaceFocal ? fx * driftLimitPct * 0.45 : 0);
      ty1 = -dy * 0.65 + (useFaceFocal ? fy * driftLimitPct * 0.45 : 0);
      break;
    }
    case 'zoom-out-pan': {
      s0 = maxScale;
      s1 = Math.max(1.03, minScale + range * 0.22);
      const dx = cosA * driftLimitPct * 0.5;
      const dy = sinA * driftLimitPct * 0.5;
      tx0 = dx;
      ty0 = dy;
      tx1 = -dx * 0.55;
      ty1 = -dy * 0.55;
      break;
    }
    default:
      break;
  }

  return {
    mode,
    s0,
    s1,
    tx0: `${tx0.toFixed(2)}%`,
    ty0: `${ty0.toFixed(2)}%`,
    tx1: `${tx1.toFixed(2)}%`,
    ty1: `${ty1.toFixed(2)}%`,
  };
}

function maxScaleForVisibilityFloor(imgEl, viewEl) {
  const vw = Math.max(2, viewEl?.clientWidth || window.innerWidth || 2);
  const vh = Math.max(2, viewEl?.clientHeight || window.innerHeight || 2);
  const iw = Math.max(2, imgEl?.naturalWidth || vw);
  const ih = Math.max(2, imgEl?.naturalHeight || vh);
  const imageAspect = iw / ih;
  const viewportAspect = vw / vh;
  const mismatchRatio =
    imageAspect >= viewportAspect ? imageAspect / viewportAspect : viewportAspect / imageAspect;
  const oneOverFloor = 1 / MIN_VISIBLE_IMAGE_FRACTION;
  const byArea =
    mismatchRatio >= oneOverFloor
      ? oneOverFloor
      : Math.sqrt(mismatchRatio / MIN_VISIBLE_IMAGE_FRACTION);
  return clamp(byArea, 1.02, 1.35);
}

function calculateSafeScale(imgEl) {
  const minScale = 1;
  const visibilityBound = maxScaleForVisibilityFloor(imgEl, stageEl);
  const maxScale = clamp(Math.min(KEN_BURNS_MAX_SCALE, visibilityBound), 1.02, KEN_BURNS_MAX_SCALE);
  return { minScale, maxScale };
}

/** Upscale a contain-fitted image just enough to swallow most of the letterbox, capped so we never
    crop more than `MAX_FIT_SCALE` worth off the short axis. Photos whose aspect already matches the
    viewport return 1 (no change); extreme mismatches clamp at the cap and keep some letterbox
    rather than chopping the subject. */
function computeSmartFitScale(imgEl) {
  const view = stageEl || document.documentElement;
  const vw = Math.max(2, view?.clientWidth || window.innerWidth || 2);
  const vh = Math.max(2, view?.clientHeight || window.innerHeight || 2);
  const iw = Math.max(2, imgEl?.naturalWidth || 0);
  const ih = Math.max(2, imgEl?.naturalHeight || 0);
  if (iw < 2 || ih < 2) return 1;
  const imageAspect = iw / ih;
  const viewportAspect = vw / vh;
  const mismatch =
    imageAspect >= viewportAspect ? imageAspect / viewportAspect : viewportAspect / imageAspect;
  return clamp(mismatch, 1, MAX_FIT_SCALE);
}

function applyKenBurnsForEntry(img, entry) {
  const focal = getFocalPoint(entry);
  const useFaceFocal = usesFaceFocalForKenBurns(entry);
  const plan = planKenBurns(entry, img);
  // object-position shifts the focal inside the letterboxed area so "zoom in on the face" lands
  // on the actual face; generic photos stay centered to avoid asymmetric letterboxing. When
  // `--fit-scale` upscales past 1 to close the letterbox, the same object-position also biases
  // what gets cropped, keeping faces in frame.
  const objX = useFaceFocal ? focal.x : 0.5;
  const objY = useFaceFocal ? focal.y : 0.5;
  img.style.transformOrigin = '50% 50%';
  img.style.objectPosition = `${(objX * 100).toFixed(2)}% ${(objY * 100).toFixed(2)}%`;
  // Fit scale depends on natural image dimensions; set a best-effort value synchronously and
  // refresh once the image decodes, so freshly-loaded slides settle to the correct framing.
  img.style.setProperty('--fit-scale', computeSmartFitScale(img).toFixed(4));
  whenImgLoaded(img, () => {
    img.style.setProperty('--fit-scale', computeSmartFitScale(img).toFixed(4));
  });
  img.style.setProperty('--ken-s0', String(plan.s0));
  img.style.setProperty('--ken-s1', String(plan.s1));
  img.style.setProperty('--ken-tx0', plan.tx0);
  img.style.setProperty('--ken-ty0', plan.ty0);
  img.style.setProperty('--ken-tx1', plan.tx1);
  img.style.setProperty('--ken-ty1', plan.ty1);
  img.dataset.kenMode = plan.mode;
}

function restartKenBurns(img, entry) {
  applyKenBurnsForEntry(img, entry ?? null);
  img.classList.remove('ken-burns');
  requestAnimationFrame(() => {
    void img.offsetHeight;
    requestAnimationFrame(() => {
      img.classList.add('ken-burns');
    });
  });
}

function clearKenBurnsInline(img) {
  if (!img) return;
  clearColorRevealClasses(img);
  img.classList.remove('ken-burns');
  img.style.removeProperty('transform');
  img.style.removeProperty('transform-origin');
  img.style.removeProperty('object-position');
  img.style.removeProperty('--fit-scale');
  img.style.removeProperty('--ken-s0');
  img.style.removeProperty('--ken-s1');
  img.style.removeProperty('--ken-tx0');
  img.style.removeProperty('--ken-ty0');
  img.style.removeProperty('--ken-tx1');
  img.style.removeProperty('--ken-ty1');
  delete img.dataset.kenMode;
}

function findImageIndexForImg(img) {
  if (!img?.src) return -1;
  for (let i = 0; i < images.length; i++) {
    try {
      if (new URL(resolveAssetUrl(images[i]), window.location.href).href === img.src) return i;
    } catch {
      /* ignore */
    }
  }
  return -1;
}

function applySlidePresentStyle(img, entry) {
  if (fitContainMode) {
    clearKenBurnsInline(img);
    return;
  }
  restartKenBurns(img, entry ?? null);
}

function refreshAllSlidePresentStyles() {
  if (!activeImg || !inactiveImg || images.length === 0) return;
  const ia = findImageIndexForImg(activeImg);
  const ib = findImageIndexForImg(inactiveImg);
  if (ia >= 0) applySlidePresentStyle(activeImg, images[ia]);
  else clearKenBurnsInline(activeImg);
  if (ib >= 0) applySlidePresentStyle(inactiveImg, images[ib]);
  else clearKenBurnsInline(inactiveImg);
}

function setFitContainMode(enabled) {
  fitContainMode = Boolean(enabled);
  syncRootFitContainClass();
  saveFitContainPrefs();
  syncFitContainUi();
  resetSlideWrapTransforms();
  refreshAllSlidePresentStyles();
  if (!slideshowPaused) scheduleSlideshowTick();
}

function syncKenBurnsDurationCss(ms) {
  const bounded = clamp(Math.round(ms), 1000, 60_000);
  document.documentElement.style.setProperty('--slide-ms', `${bounded}ms`);
}

function getSlideDurationMs() {
  return clamp(Math.round(manualSlideSeconds * 1000), 1000, 60_000);
}

function clearSlideshowTimer() {
  clearTimeout(slideshowTimerId);
  slideshowTimerId = 0;
}

function scheduleSlideshowTick() {
  clearSlideshowTimer();
  if (slideshowPaused || images.length === 0 || grabInteractionActive) return;
  const ms = getSlideDurationMs();
  syncKenBurnsDurationCss(ms);
  slideshowTimerId = window.setTimeout(() => {
    slideshowTimerId = 0;
    step(1);
    scheduleSlideshowTick();
  }, ms);
}

async function loadManifest() {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Manifest ${res.status}`);
  const data = await res.json();
  const raw = Array.isArray(data.images) ? data.images : [];
  images = raw
    .map((entry) => normalizeManifestEntry(entry))
    .filter((entry) => typeof imageUrl(entry) === 'string' && imageUrl(entry).length > 0);
  if (!images.length) throw new Error('No images in manifest');
}

function imageUrl(entry) {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && typeof entry.src === 'string') return entry.src;
  return '';
}

function imageLeaf(entry) {
  const s = imageUrl(entry);
  if (!s) return '';
  return s.includes('/') ? (s.split('/').pop() ?? s) : s;
}

function stemFilename(leaf) {
  return leaf.replace(/\.[^.]+$/i, '');
}

function isColorizedLeaf(leaf) {
  return /colorized/i.test(leaf);
}

/**
 * True when advancing from a B&W file to its paired colorized file (e.g. 1_Goat.png → 1_GoatColorized.png).
 */
function isBwToColorizedTransition(prevEntry, nextEntry) {
  const pl = imageLeaf(prevEntry);
  const nl = imageLeaf(nextEntry);
  if (!pl || !nl || isColorizedLeaf(pl) || !isColorizedLeaf(nl)) return false;
  const ps = stemFilename(pl).toLowerCase();
  const ns = stemFilename(nl).toLowerCase();
  if (!ns.startsWith(ps) || ns === ps) return false;
  const rest = ns.slice(ps.length);
  return /^[_-]?colorized/i.test(rest);
}

function whenImgLoaded(img, fn) {
  if (!img) return;
  if (img.complete && img.naturalWidth > 0) {
    fn();
    return;
  }
  img.addEventListener('load', fn, { once: true });
}

function clearColorRevealClasses(img) {
  if (!img) return;
  img.classList.remove('slide-img--color-reveal', 'slide-img--color-reveal-on');
}

function getConfiguredFocalEditorSecret() {
  const raw = appRoot?.dataset?.focalEditorSecret;
  if (raw == null) return '';
  return String(raw).trim();
}

function showFocalEditorChrome(visible) {
  if (!focalEditorRoot) return;
  focalEditorRoot.hidden = !visible;
}

function tryUnlockFocalEditorFromHash() {
  const secret = getConfiguredFocalEditorSecret();
  if (!secret) {
    try {
      sessionStorage.removeItem(FOCAL_SESSION_KEY);
    } catch {
      /* ignore */
    }
    showFocalEditorChrome(false);
    return false;
  }
  try {
    if (sessionStorage.getItem(FOCAL_SESSION_KEY) === '1') {
      showFocalEditorChrome(true);
      return true;
    }
  } catch {
    /* ignore */
  }
  const raw = location.hash;
  const m = /^#focal=(.+)$/.exec(raw);
  if (!m) {
    showFocalEditorChrome(false);
    return false;
  }
  let candidate = m[1];
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    /* keep raw */
  }
  if (candidate !== secret) {
    showFocalEditorChrome(false);
    return false;
  }
  try {
    sessionStorage.setItem(FOCAL_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  } catch {
    /* ignore */
  }
  showFocalEditorChrome(true);
  return true;
}

function clientToFocalNormalized(imgEl, clientX, clientY) {
  const rect = imgEl.getBoundingClientRect();
  const nw = imgEl.naturalWidth;
  const nh = imgEl.naturalHeight;
  if (nw < 2 || nh < 2) return { x: 0.5, y: 0.5 };
  const rw = rect.width;
  const rh = rect.height;
  const scale = Math.min(rw / nw, rh / nh);
  const dispW = nw * scale;
  const dispH = nh * scale;
  const ox = rect.left + (rw - dispW) / 2;
  const oy = rect.top + (rh - dispH) / 2;
  const x = (clientX - ox) / dispW;
  const y = (clientY - oy) / dispH;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

function ensureFocalEditorDot() {
  if (focalEditorDot) return focalEditorDot;
  const el = document.createElement('div');
  el.className = 'focal-editor-dot';
  el.setAttribute('aria-hidden', 'true');
  focalEditorDot = el;
  return el;
}

function syncFocalEditorDotPosition() {
  if (!focalEditorDot || !activeImg || !activeWrap || !images.length) return;
  const fp = getFocalPoint(images[index]);
  focalEditorDot.style.left = `${fp.x * 100}%`;
  focalEditorDot.style.top = `${fp.y * 100}%`;
}

function mountFocalEditorDot() {
  if (!focalEditorPanel || focalEditorPanel.hidden || focalEditorRoot?.hidden) return;
  const dot = ensureFocalEditorDot();
  if (dot.parentNode !== activeWrap) {
    activeWrap?.appendChild(dot);
  }
  dot.classList.add('is-visible');
  syncFocalEditorDotPosition();
}

function updateFocalEditorValsText() {
  if (!focalEditorVals || !images.length) return;
  const fp = getFocalPoint(images[index]);
  focalEditorVals.textContent = `x: ${fp.x.toFixed(3)} · y: ${fp.y.toFixed(3)}`;
}

function wireFocalEditor() {
  if (!focalEditorRoot || !focalEditorToggle || !focalEditorPanel) return;

  focalEditorToggle.addEventListener('click', () => {
    if (focalEditorRoot.hidden) return;
    const open = focalEditorPanel.hidden;
    focalEditorPanel.hidden = !open;
    focalEditorToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    appRoot?.classList.toggle('focal-editor-placing', open);
    if (open) {
      updateFocalEditorValsText();
      mountFocalEditorDot();
    } else {
      appRoot?.classList.remove('focal-editor-placing');
      if (focalEditorDot) {
        focalEditorDot.classList.remove('is-visible');
      }
    }
  });

  focalEditorLock?.addEventListener('click', () => {
    try {
      sessionStorage.removeItem(FOCAL_SESSION_KEY);
    } catch {
      /* ignore */
    }
    focalEditorPanel.hidden = true;
    focalEditorToggle.setAttribute('aria-expanded', 'false');
    appRoot?.classList.remove('focal-editor-placing');
    showFocalEditorChrome(false);
    if (focalEditorDot) {
      focalEditorDot.remove();
      focalEditorDot = null;
    }
  });

  focalEditorCopy?.addEventListener('click', async () => {
    if (!images.length) return;
    const entry = images[index];
    const snippet = JSON.stringify(
      {
        src: imageUrl(entry),
        focal_point: getFocalPoint(entry),
        focal_source: 'manual',
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(snippet);
      showStatusBanner('Focal JSON copied — paste into manifest for this image.');
    } catch {
      showStatusBanner('Could not copy — select JSON from the console or try HTTPS.');
    }
  });

  if (!stageEl) return;
  stageEl.addEventListener(
    'pointerdown',
    (e) => {
      if (!appRoot?.classList.contains('focal-editor-placing')) return;
      if (e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Element) || !t.closest('.buffer.is-active')) return;
      if (!t.closest('.slide-img-wrap')) return;
      const img = activeImg;
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      const fp = clientToFocalNormalized(img, e.clientX, e.clientY);
      const entry = images[index];
      if (entry && typeof entry === 'object') {
        entry.focal_point = { x: fp.x, y: fp.y };
        entry.focal_source = 'manual';
      }
      updateFocalEditorValsText();
      syncFocalEditorDotPosition();
      refreshAllSlidePresentStyles();
    },
    true,
  );
}

function normalizeManifestEntry(entry) {
  if (typeof entry === 'string') {
    const src = entry.trim();
    return {
      src,
      title: prettyFilename(src) || src,
      focal_point: { x: 0.5, y: 0.5 },
      focal_source: 'fallback',
      ambient: '',
    };
  }
  if (!entry || typeof entry !== 'object') return { src: '', title: '' };
  const src = imageUrl(entry).trim();
  const out = { ...entry, src };
  if (typeof out.title !== 'string' || out.title.trim() === '') {
    out.title = prettyFilename(src) || `Photo`;
  } else {
    out.title = out.title.trim();
  }
  return out;
}

function resolveAssetUrl(entry) {
  return PUBLIC_BASE + imageUrl(entry);
}

function resolveAmbientUrl(entry) {
  if (entry && typeof entry === 'object' && typeof entry.ambient === 'string' && entry.ambient.trim()) {
    return PUBLIC_BASE + entry.ambient.trim();
  }
  return resolveAssetUrl(entry);
}

/** Smaller JPEG in public/thumbnails/ when manifest includes `thumb` (from Python generator). */
function resolveThumbUrl(entry) {
  if (entry && typeof entry === 'object' && typeof entry.thumb === 'string' && entry.thumb.length > 0) {
    return PUBLIC_BASE + entry.thumb;
  }
  return resolveAssetUrl(entry);
}

function preloadAheadFrom(baseIndex) {
  const n = images.length;
  if (n < 2) return;
  const steps = Math.min(PRELOAD_AHEAD_COUNT, n - 1);
  for (let k = 1; k <= steps; k++) {
    const e = getManifestEntryAt(baseIndex + k);
    if (!e) continue;
    preload(resolveAssetUrl(e));
    preload(resolveAmbientUrl(e));
  }
}

function setAmbientBackground(bgEl, entry) {
  if (!bgEl) return;
  const ambientUrl = resolveAmbientUrl(entry);
  bgEl.src = ambientUrl;
  const isFallback =
    !entry ||
    typeof entry !== 'object' ||
    typeof entry.ambient !== 'string' ||
    entry.ambient.trim().length === 0;
  bgEl.classList.toggle('slide-bg--fallback', isFallback);
}

function suggestedDownloadFilename(entry) {
  const src = imageUrl(entry);
  const leaf = src.includes('/') ? src.split('/').pop() : src;
  if (leaf && /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(leaf)) return leaf;
  if (leaf) return leaf;
  return 'photo.jpg';
}

function triggerAssetDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.setAttribute('download', filename);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Resolve the current slide as an absolute URL + filename, or null if the slideshow is empty. */
function currentSlideAssetInfo() {
  if (!images.length) return null;
  const entry = images[index];
  const path = resolveAssetUrl(entry);
  let absUrl;
  try {
    absUrl = new URL(path, window.location.href).href;
  } catch {
    return null;
  }
  return { entry, absUrl, filename: suggestedDownloadFilename(entry) };
}

async function downloadCurrentSlide() {
  const info = currentSlideAssetInfo();
  if (!info) return;
  // Prefer a blob download so the browser uses the original bytes with our filename; fall back
  // to a plain href so offline/file:// still saves something sensible.
  try {
    const res = await fetch(info.absUrl);
    if (res.ok) {
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      triggerAssetDownload(objUrl, info.filename);
      URL.revokeObjectURL(objUrl);
      return;
    }
  } catch {
    /* fall through to direct-URL download */
  }
  triggerAssetDownload(info.absUrl, info.filename);
}

async function shareCurrentSlide() {
  if (!navigator.share) return;
  const info = currentSlideAssetInfo();
  if (!info) return;
  const shareTitle = 'Memorial photo';

  let blob = null;
  try {
    const res = await fetch(info.absUrl);
    if (res.ok) blob = await res.blob();
  } catch {
    /* e.g. file:// or offline */
  }

  if (blob) {
    const mime =
      blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'image/jpeg';
    const file = new File([blob], info.filename, { type: mime });
    const withFiles = { files: [file], title: shareTitle };
    try {
      if (navigator.canShare?.(withFiles)) {
        await navigator.share(withFiles);
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  try {
    await navigator.share({ title: shareTitle, text: shareTitle, url: info.absUrl });
  } catch (e) {
    if (e.name !== 'AbortError') {
      // As a last resort, hand the user the file so they can share it manually.
      await downloadCurrentSlide();
    }
  }
}

/** Reveal the Share button only when the Web Share API is actually available. */
function syncShareButtonAvailability() {
  if (!ctrlShareSlide) return;
  const supported = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  ctrlShareSlide.hidden = !supported;
}

function syncSlideChromeButtons() {
  const dis = images.length === 0;
  if (ctrlDownloadSlide) ctrlDownloadSlide.disabled = dis;
  if (ctrlShareSlide) ctrlShareSlide.disabled = dis;
  if (ctrlPhotoFeedback) ctrlPhotoFeedback.disabled = dis;
  if (ctrlTrackPrev) ctrlTrackPrev.disabled = !ytPlayerAvailable;
  if (ctrlTrackNext) ctrlTrackNext.disabled = !ytPlayerAvailable;
  updateMusicPlayPauseButton();
}

function resetSlideWrapTransforms() {
  touchPointers.clear();
  gestureMode = 'none';
  panStart = null;
  pinchStart = null;
  panCapturePointerId = null;
  userTx = 0;
  userTy = 0;
  userScale = 1;
  userDeg = 0;
  grabInteractionActive = false;
  stageEl?.classList.remove('is-grabbing');
  for (const w of [wrapA, wrapB]) {
    if (!w) continue;
    w.style.transition = '';
    w.style.transform = '';
  }
}

function applyUserTransformToWrap(wrap) {
  if (!wrap) return;
  wrap.style.transform = `translate3d(${userTx}px, ${userTy}px, 0) rotate(${userDeg}deg) scale(${userScale})`;
}

function resistPanAxis(value) {
  const sign = Math.sign(value) || 1;
  const ax = Math.abs(value);
  if (ax <= GRAB_RUBBER_SOFT_PX) return value;
  const over = ax - GRAB_RUBBER_SOFT_PX;
  const extra = Math.sqrt(over) * 14;
  return sign * Math.min(GRAB_RUBBER_SOFT_PX + extra, GRAB_RUBBER_HARD_PX);
}

function finishGrabSpringBack(wrap) {
  const near =
    Math.hypot(userTx, userTy) < 0.5 &&
    Math.abs(userScale - 1) < 0.02 &&
    Math.abs(userDeg) < 0.6;
  if (near) {
    userTx = 0;
    userTy = 0;
    userScale = 1;
    userDeg = 0;
    wrap.style.transition = '';
    wrap.style.transform = '';
    grabInteractionActive = false;
    if (!slideshowPaused) scheduleSlideshowTick();
    return;
  }
  const onEnd = (ev) => {
    if (ev.target !== wrap || ev.propertyName !== 'transform') return;
    wrap.removeEventListener('transitionend', onEnd);
    wrap.style.transition = '';
    wrap.style.transform = '';
    userTx = 0;
    userTy = 0;
    userScale = 1;
    userDeg = 0;
    grabInteractionActive = false;
    if (!slideshowPaused) scheduleSlideshowTick();
  };
  wrap.addEventListener('transitionend', onEnd);
  requestAnimationFrame(() => {
    wrap.style.transition = `transform ${SNAP_BACK_MS}ms ${SNAP_BACK_EASE}`;
    wrap.style.transform = 'translate3d(0, 0, 0) rotate(0deg) scale(1)';
  });
}

function wireStageGrab() {
  if (!stageEl || !activeWrap) return;

  // Native <img> drag uses a “not allowed” cursor and steals the gesture from pointer pan.
  stageEl.addEventListener('dragstart', (e) => e.preventDefault(), { capture: true });

  function getTwoPointerSnapshot() {
    const ids = [...touchPointers.keys()];
    if (ids.length < 2) return null;
    const a = touchPointers.get(ids[0]);
    const b = touchPointers.get(ids[1]);
    if (!a || !b) return null;
    return { p0: a, p1: b };
  }

  function dist2(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function angle2(a, b) {
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  function beginPinchGesture() {
    const snap = getTwoPointerSnapshot();
    if (!snap) return;
    const d0 = Math.max(dist2(snap.p0, snap.p1), 8);
    pinchStart = {
      dist0: d0,
      ang0: angle2(snap.p0, snap.p1),
      midX0: (snap.p0.x + snap.p1.x) / 2,
      midY0: (snap.p0.y + snap.p1.y) / 2,
      tx0: userTx,
      ty0: userTy,
      s0: userScale,
      r0: userDeg,
    };
  }

  stageEl.addEventListener('pointerdown', (e) => {
    if (appRoot?.classList.contains('focal-editor-placing')) return;
    if (fitContainMode) return;
    if (e.button !== 0) return;
    if (isStartOverlayVisible() || isArchiveOpen() || isFeedbackOpen()) return;
    const t = e.target;
    if (!(t instanceof Element) || !t.closest('.buffer.is-active')) return;

    e.preventDefault();
    touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearSlideshowTimer();
    stageEl.classList.add('is-grabbing');
    grabInteractionActive = true;
    activeWrap.style.transition = 'none';

    if (touchPointers.size === 1) {
      gestureMode = 'pan';
      panStart = { sx: e.clientX, sy: e.clientY, tx0: userTx, ty0: userTy };
      try {
        stageEl.setPointerCapture(e.pointerId);
        panCapturePointerId = e.pointerId;
      } catch {
        /* ignore */
      }
    } else if (touchPointers.size === 2) {
      if (panCapturePointerId != null) {
        try {
          stageEl.releasePointerCapture(panCapturePointerId);
        } catch {
          /* ignore */
        }
        panCapturePointerId = null;
      }
      gestureMode = 'pinch';
      beginPinchGesture();
    }
  });

  stageEl.addEventListener('pointermove', (e) => {
    if (!touchPointers.has(e.pointerId)) return;
    touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gestureMode === 'pan' && touchPointers.size === 1 && panStart) {
      const dx = e.clientX - panStart.sx;
      const dy = e.clientY - panStart.sy;
      userTx = resistPanAxis(panStart.tx0 + dx);
      userTy = resistPanAxis(panStart.ty0 + dy);
      applyUserTransformToWrap(activeWrap);
      return;
    }
    if (gestureMode === 'pinch' && touchPointers.size >= 2 && pinchStart) {
      const snap = getTwoPointerSnapshot();
      if (!snap) return;
      const d = Math.max(dist2(snap.p0, snap.p1), 8);
      const ang = angle2(snap.p0, snap.p1);
      const midX = (snap.p0.x + snap.p1.x) / 2;
      const midY = (snap.p0.y + snap.p1.y) / 2;
      const ps = pinchStart;
      userScale = clamp(ps.s0 * (d / ps.dist0), GESTURE_MIN_SCALE, GESTURE_MAX_SCALE);
      userDeg = ps.r0 + ((ang - ps.ang0) * 180) / Math.PI;
      userTx = ps.tx0 + (midX - ps.midX0);
      userTy = ps.ty0 + (midY - ps.midY0);
      applyUserTransformToWrap(activeWrap);
    }
  });

  function endPointer(e) {
    if (!touchPointers.has(e.pointerId)) return;
    touchPointers.delete(e.pointerId);
    try {
      if (panCapturePointerId === e.pointerId) {
        stageEl.releasePointerCapture(e.pointerId);
        panCapturePointerId = null;
      }
    } catch {
      /* ignore */
    }

    if (touchPointers.size === 0) {
      gestureMode = 'none';
      panStart = null;
      pinchStart = null;
      stageEl.classList.remove('is-grabbing');
      const wrap = activeWrap;
      wrap.style.transition = '';
      finishGrabSpringBack(wrap);
      return;
    }

    if (touchPointers.size === 1) {
      gestureMode = 'pan';
      pinchStart = null;
      const remainingId = [...touchPointers.keys()][0];
      const p = touchPointers.get(remainingId);
      if (p) {
        panStart = { sx: p.x, sy: p.y, tx0: userTx, ty0: userTy };
      }
      try {
        stageEl.setPointerCapture(remainingId);
        panCapturePointerId = remainingId;
      } catch {
        /* ignore */
      }
    } else {
      gestureMode = 'pinch';
      beginPinchGesture();
    }
  }

  stageEl.addEventListener('pointerup', endPointer);
  stageEl.addEventListener('pointercancel', endPointer);
}

/**
 * Scale the active slide to `newScale` while keeping the pixel under (cursorX, cursorY) fixed on
 * screen. The wrap's CSS transform is `translate(tx, ty) rotate(deg) scale(s)` with the default
 * center origin, so we can work entirely in screen space via getBoundingClientRect().
 */
function zoomAtPoint(newScale, cursorX, cursorY) {
  if (!activeWrap) return;
  const clamped = clamp(newScale, GESTURE_MIN_SCALE, GESTURE_MAX_SCALE);
  if (Math.abs(clamped - userScale) < 0.001) return;
  const rect = activeWrap.getBoundingClientRect();
  const wrapCenterX = rect.left + rect.width / 2;
  const wrapCenterY = rect.top + rect.height / 2;
  const dx = cursorX - wrapCenterX;
  const dy = cursorY - wrapCenterY;
  const k = clamped / userScale;
  userTx += (1 - k) * dx;
  userTy += (1 - k) * dy;
  userScale = clamped;
  applyUserTransformToWrap(activeWrap);
}

function resetUserZoom(animated = true) {
  if (!activeWrap) return;
  const atIdentity =
    Math.abs(userScale - 1) < 0.01 && Math.hypot(userTx, userTy) < 0.5 && Math.abs(userDeg) < 0.5;
  if (atIdentity) return;
  if (animated) {
    finishGrabSpringBack(activeWrap);
  } else {
    resetSlideWrapTransforms();
    if (!slideshowPaused) scheduleSlideshowTick();
  }
}

function wireWheelZoom() {
  if (!stageEl) return;

  stageEl.addEventListener(
    'wheel',
    (e) => {
      if (fitContainMode) return;
      if (isStartOverlayVisible() || isArchiveOpen() || isFeedbackOpen()) return;
      if (appRoot?.classList.contains('focal-editor-placing')) return;
      const t = e.target;
      if (!(t instanceof Element) || !t.closest('.buffer.is-active')) return;
      if (!activeWrap) return;

      e.preventDefault();

      clearSlideshowTimer();
      grabInteractionActive = true;
      activeWrap.style.transition = 'none';

      // Exponential step keeps zoom feel consistent for both mouse wheels (large deltaY) and
      // trackpad pinch gestures (small deltaY with ctrlKey). Scroll up = zoom in.
      const factor = Math.exp(-e.deltaY * 0.0016);
      const target = userScale * factor;
      zoomAtPoint(target, e.clientX, e.clientY);

      showControls();
    },
    { passive: false },
  );

  // Double-click on the active photo snaps the zoom back to 1:1 with a gentle spring.
  stageEl.addEventListener('dblclick', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.closest('.buffer.is-active')) return;
    if (userScale === 1 && userTx === 0 && userTy === 0) return;
    e.preventDefault();
    resetUserZoom(true);
    showControls();
  });
}

function applySlideIndex(rawIndex) {
  const n = images.length;
  if (n === 0) return;
  resetSlideWrapTransforms();
  const prevIndex = index;
  const i = ((rawIndex % n) + n) % n;
  index = i;
  const currentEntry = images[index];
  const prevEntry = images[prevIndex];
  const url = resolveAssetUrl(currentEntry);
  setAmbientBackground(inactiveBg, currentEntry);

  // Capture before swapBuffers() so the closures below reliably target the incoming image.
  const incomingImg = inactiveImg;
  clearColorRevealClasses(incomingImg);
  const useColorBloom =
    !fitContainMode && !prefersReducedMotion() && isBwToColorizedTransition(prevEntry, currentEntry);

  incomingImg.src = url;
  incomingImg.alt = buildImageAlt(currentEntry, index);

  if (useColorBloom) {
    incomingImg.classList.add('slide-img--color-reveal');
    whenImgLoaded(incomingImg, () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          incomingImg.classList.add('slide-img--color-reveal-on');
        });
      });
    });
    incomingImg.addEventListener(
      'transitionend',
      (e) => {
        if (e.propertyName !== 'filter') return;
        clearColorRevealClasses(incomingImg);
      },
      { once: true },
    );
  }

  applySlidePresentStyle(incomingImg, currentEntry);

  inactiveEl.classList.add('is-active');
  activeEl.classList.remove('is-active');

  swapBuffers();
  // Deliberately DO NOT restart Ken Burns on the outgoing image. With animation-fill-mode:both
  // its current transform is preserved, so it keeps drifting through the cross-fade instead of
  // snapping back to identity scale — that snap was the "previous photo shrinks before swapping"
  // glitch. The outgoing buffer will get a fresh plan when it next becomes the incoming slide.
  preloadAheadFrom(index);
  updateSlideMeta(currentEntry, index);
  renderFilmstrip();
  updateArchiveGridActiveState();
  scrollBrowseThumbnailsIntoView();
  syncSlideChromeButtons();
  syncPhotoFeedbackPanelIfOpen();
  syncFocalEditorAfterSlideChange();
}

function syncFocalEditorAfterSlideChange() {
  if (!focalEditorPanel || focalEditorPanel.hidden || focalEditorRoot?.hidden) return;
  mountFocalEditorDot();
  updateFocalEditorValsText();
}

function step(delta) {
  if (images.length === 0) return;
  applySlideIndex(index + delta);
}

function showInitial() {
  if (!activeImg || !inactiveImg || !activeEl || !inactiveEl) {
    throw new Error(
      'Slideshow markup is missing (#buffer-a / #buffer-b / .slide-img). Ensure index.html loaded completely.',
    );
  }
  resetSlideWrapTransforms();
  const firstEntry = images[0];
  const first = resolveAssetUrl(firstEntry);
  setAmbientBackground(activeBg, firstEntry);
  setAmbientBackground(inactiveBg, getManifestEntryAt(1) ?? firstEntry);
  activeImg.src = first;
  activeImg.alt = buildImageAlt(firstEntry, 0);
  applySlidePresentStyle(activeImg, firstEntry);
  syncKenBurnsDurationCss(getSlideDurationMs());
  activeEl.classList.add('is-active');
  inactiveEl.classList.remove('is-active');
  clearKenBurnsInline(inactiveImg);
  index = 0;
  preloadAheadFrom(index);
  updateSlideMeta(firstEntry, 0);
  renderFilmstrip();
  updateArchiveGridActiveState();
  scrollBrowseThumbnailsIntoView();
  syncSlideChromeButtons();
  syncPhotoFeedbackPanelIfOpen();
  syncFocalEditorAfterSlideChange();
}

function manualStep(delta) {
  if (!images.length) return;
  step(delta);
  if (!slideshowPaused) scheduleSlideshowTick();
  showControls();
}

function goToIndexFromFilmstrip(targetIndex) {
  if (!images.length) return;
  applySlideIndex(targetIndex);
  if (!slideshowPaused) scheduleSlideshowTick();
  showControls();
}

function goToIndexFromArchive(targetIndex) {
  if (!images.length) return;
  applySlideIndex(targetIndex);
  if (!slideshowPaused) scheduleSlideshowTick();
  closeArchive();
  showControls();
}

function renderFilmstrip() {
  if (!filmstripEl) return;
  const n = images.length;
  filmstripEl.replaceChildren();
  if (n === 0) return;

  const maxCells = FILMSTRIP_HALF * 2 + 1;
  const count = Math.min(n, maxCells);
  let start = index - Math.floor(count / 2);
  start = clamp(start, 0, Math.max(0, n - count));

  const frag = document.createDocumentFragment();
  for (let k = 0; k < count; k++) {
    const i = start + k;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filmstrip__btn thumb-nav';
    btn.dataset.slideIndex = String(i);
    if (i === index) btn.classList.add('is-active');
    btn.setAttribute('aria-label', slideOrdinalLabel(i));
    btn.setAttribute('aria-current', i === index ? 'true' : 'false');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = resolveThumbUrl(images[i]);
    img.alt = slideOrdinalLabel(i);
    btn.appendChild(img);
    frag.appendChild(btn);
  }
  filmstripEl.appendChild(frag);
}

function buildArchiveGrid() {
  if (!archiveGridEl || archiveGridBuilt) return;
  archiveGridBuilt = true;
  const frag = document.createDocumentFragment();
  images.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'archive-grid__cell thumb-nav';
    btn.dataset.slideIndex = String(i);
    btn.setAttribute('aria-label', buildImageAlt(images[i], i));
    // Inner card is absolutely positioned and pointer-events:none so the sliver-sized
    // button itself is the only hover target — this keeps reverse-direction traversal
    // through the stack smooth when the lifted card visually overlaps its neighbours.
    const card = document.createElement('span');
    card.className = 'archive-grid__cell-card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = resolveThumbUrl(images[i]);
    img.alt = '';
    card.appendChild(img);
    btn.appendChild(card);
    frag.appendChild(btn);
  });
  archiveGridEl.appendChild(frag);
  updateArchiveGridActiveState();
}

function updateArchiveGridActiveState() {
  if (!archiveGridEl || !archiveGridBuilt) return;
  archiveGridEl.querySelectorAll('[data-slide-index]').forEach((el) => {
    const i = Number(el.dataset.slideIndex);
    el.classList.toggle('is-active', i === index);
  });
}

function scrollBrowseThumbnailsIntoView() {
  const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
  requestAnimationFrame(() => {
    const sel = `[data-slide-index="${index}"]`;
    filmstripEl?.querySelector(sel)?.scrollIntoView({
      behavior,
      block: 'nearest',
      inline: 'center',
    });
    archiveGridEl?.querySelector(sel)?.scrollIntoView({
      behavior,
      block: 'center',
    });
  });
}

function isArchiveOpen() {
  return Boolean(archiveOverlay?.classList.contains('archive-overlay--open'));
}

function openArchive() {
  if (!archiveOverlay) return;
  buildArchiveGrid();
  archiveOverlay.classList.add('archive-overlay--open');
  archiveOverlay.setAttribute('aria-hidden', 'false');
  appRoot?.classList.add('archive-open');
  document.body.classList.add('archive-open');
  document.body.classList.remove('body--chrome-hidden');
  clearTimeout(controlsHideTimerId);
  updateArchiveGridActiveState();
  scrollBrowseThumbnailsIntoView();
  activateFocusTrap(archiveOverlay, archiveCloseBtn ?? null);
  showControls();
}

function closeArchive() {
  if (!archiveOverlay) return;
  archiveOverlay.classList.remove('archive-overlay--open');
  archiveOverlay.setAttribute('aria-hidden', 'true');
  appRoot?.classList.remove('archive-open');
  document.body.classList.remove('archive-open');
  releaseFocusTrap();
  armHideChrome();
}

function toggleArchive() {
  if (isArchiveOpen()) closeArchive();
  else openArchive();
}

function emptyFeedbackEntry() {
  return { myReactions: [], reactionCounts: {}, comments: [] };
}

function initFeedbackStore() {
  feedbackStoreCache = {};
}

function photoFeedbackKeyFromIndex(i) {
  if (i < 0 || i >= images.length) return '';
  return imageUrl(images[i]) || '';
}

function ensurePhotoFeedbackEntry(key) {
  if (!key) return null;
  if (!feedbackStoreCache[key]) {
    feedbackStoreCache[key] = emptyFeedbackEntry();
  }
  return feedbackStoreCache[key];
}

function isFeedbackOpen() {
  return Boolean(feedbackOverlay?.classList.contains('feedback-overlay--open'));
}

function syncFeedbackPrivacyNote() {
  const el = document.getElementById('feedback-privacy-note');
  if (!el) return;
  el.textContent = feedbackApiConfigured()
    ? 'Reactions and comments are shared with everyone who visits this memorial.'
    : 'Comments are currently unavailable — please try again later.';
}

async function refreshCurrentPhotoFeedbackFromApi() {
  const photo = photoFeedbackKeyFromIndex(index);
  if (!photo) return;
  const base = getFeedbackApiBase();
  const visitor = getOrCreateVisitorId();
  const url = `${base}?${new URLSearchParams({ photo, visitor }).toString()}`;
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`feedback ${res.status}`);
  applyFeedbackApiResponse(photo, await res.json(), feedbackStoreCache[photo]);
}

function renderPhotoFeedbackPanel() {
  const key = photoFeedbackKeyFromIndex(index);
  if (feedbackPhotoLabel) {
    feedbackPhotoLabel.textContent = slideOrdinalLabel(index);
  }
  const entry = ensurePhotoFeedbackEntry(key);
  const mine = entry?.myReactions ?? [];
  const counts = entry?.reactionCounts;
  feedbackOverlay?.querySelectorAll('.feedback-reaction-btn').forEach((btn) => {
    const id = btn.getAttribute('data-reaction');
    const on = Boolean(id && mine.includes(id));
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    let badge = btn.querySelector('.feedback-reaction-btn__count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'feedback-reaction-btn__count';
      badge.setAttribute('aria-hidden', 'true');
      btn.appendChild(badge);
    }
    const n = id && counts && typeof counts[id] === 'number' ? counts[id] : 0;
    if (n > 0) {
      badge.textContent = String(n);
      badge.removeAttribute('hidden');
    } else {
      badge.textContent = '';
      badge.setAttribute('hidden', '');
    }
  });
  if (!feedbackCommentList) return;
  feedbackCommentList.replaceChildren();
  const comments = (entry?.comments ?? []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (comments.length === 0) {
    feedbackCommentEmpty?.removeAttribute('hidden');
  } else {
    feedbackCommentEmpty?.setAttribute('hidden', '');
    for (const c of comments) {
      const li = document.createElement('li');
      li.className = 'feedback-comment-item';
      const time = document.createElement('time');
      time.className = 'feedback-comment-item__time';
      time.dateTime = c.at;
      try {
        const d = new Date(c.at);
        time.textContent = Number.isNaN(d.getTime())
          ? ''
          : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      } catch {
        time.textContent = '';
      }
      const p = document.createElement('p');
      p.className = 'feedback-comment-item__text';
      p.textContent = c.text;
      li.appendChild(time);
      li.appendChild(p);
      feedbackCommentList.appendChild(li);
    }
  }
}

function syncPhotoFeedbackPanelIfOpen() {
  void (async () => {
    if (!isFeedbackOpen()) return;
    if (feedbackApiConfigured()) {
      try {
        await refreshCurrentPhotoFeedbackFromApi();
      } catch {
        /* keep cached entry */
      }
    }
    renderPhotoFeedbackPanel();
  })();
}

async function openPhotoFeedback() {
  if (!feedbackOverlay || !images.length) return;
  if (feedbackApiConfigured()) {
    try {
      await refreshCurrentPhotoFeedbackFromApi();
    } catch {
      ensurePhotoFeedbackEntry(photoFeedbackKeyFromIndex(index));
    }
  } else {
    ensurePhotoFeedbackEntry(photoFeedbackKeyFromIndex(index));
  }
  syncFeedbackPrivacyNote();
  renderPhotoFeedbackPanel();
  feedbackOverlay.classList.add('feedback-overlay--open');
  feedbackOverlay.setAttribute('aria-hidden', 'false');
  appRoot?.classList.add('feedback-open');
  document.body.classList.add('feedback-open');
  document.body.classList.remove('body--chrome-hidden');
  clearTimeout(controlsHideTimerId);
  activateFocusTrap(feedbackOverlay, feedbackCommentInput ?? feedbackCloseBtn ?? null);
  showControls();
}

function closePhotoFeedback() {
  if (!feedbackOverlay) return;
  feedbackOverlay.classList.remove('feedback-overlay--open');
  feedbackOverlay.setAttribute('aria-hidden', 'true');
  appRoot?.classList.remove('feedback-open');
  document.body.classList.remove('feedback-open');
  releaseFocusTrap();
  armHideChrome();
}

function applyFeedbackApiResponse(key, data, fallback) {
  feedbackStoreCache[key] = {
    myReactions: Array.isArray(data?.myReactions)
      ? data.myReactions.filter((x) => PHOTO_REACTION_IDS.has(x))
      : [],
    reactionCounts:
      data?.reactionCounts && typeof data.reactionCounts === 'object' ? data.reactionCounts : {},
    comments: Array.isArray(data?.comments) ? data.comments : fallback?.comments ?? [],
  };
}

async function postFeedbackAction(body, errorMessage) {
  if (!feedbackApiConfigured()) {
    showStatusBanner('Comments are currently unavailable.');
    return null;
  }
  try {
    const res = await fetch(getFeedbackApiBase(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    showStatusBanner(errorMessage);
    return null;
  }
}

async function togglePhotoReaction(reactionId) {
  if (!PHOTO_REACTION_IDS.has(reactionId)) return;
  const key = photoFeedbackKeyFromIndex(index);
  const entry = ensurePhotoFeedbackEntry(key);
  if (!entry) return;
  const data = await postFeedbackAction(
    {
      action: 'toggleReaction',
      photo: key,
      visitorId: getOrCreateVisitorId(),
      reactionId,
    },
    'Could not save your reaction. Please try again.',
  );
  if (!data) return;
  applyFeedbackApiResponse(key, data, entry);
  renderPhotoFeedbackPanel();
}

async function addPhotoComment(text) {
  const key = photoFeedbackKeyFromIndex(index);
  const entry = ensurePhotoFeedbackEntry(key);
  if (!entry) return;
  const data = await postFeedbackAction(
    {
      action: 'addComment',
      photo: key,
      visitorId: getOrCreateVisitorId(),
      text,
    },
    'Could not post your comment. Please try again.',
  );
  if (!data) return;
  applyFeedbackApiResponse(key, data, entry);
  renderPhotoFeedbackPanel();
}

function wirePhotoFeedbackUi() {
  ctrlPhotoFeedback?.addEventListener('click', () => {
    void openPhotoFeedback();
  });
  feedbackCloseBtn?.addEventListener('click', () => closePhotoFeedback());
  feedbackBackdrop?.addEventListener('click', () => closePhotoFeedback());
  feedbackOverlay?.querySelector('.feedback-reactions')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.feedback-reaction-btn[data-reaction]');
    if (!btn) return;
    const id = btn.getAttribute('data-reaction');
    if (id) void togglePhotoReaction(id);
  });
  feedbackCommentForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = feedbackCommentInput?.value ?? '';
    const text = raw.trim();
    if (!text) return;
    void (async () => {
      await addPhotoComment(text);
      if (feedbackCommentInput) feedbackCommentInput.value = '';
      showControls();
    })();
  });
}

function updatePlayPauseButton() {
  if (!ctrlPlayPause) return;
  ctrlPlayPause.classList.toggle('is-paused', slideshowPaused);
  const noun = ytPlayerAvailable ? 'slideshow and music' : 'slideshow';
  ctrlPlayPause.setAttribute(
    'aria-label',
    slideshowPaused ? `Play ${noun}` : `Pause ${noun}`,
  );
}

function syncMediaSessionPlaybackState() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = slideshowPaused ? 'paused' : 'playing';
  } catch {
    /* ignore */
  }
}

function syncPausedStateClass() {
  appRoot?.classList.toggle('slideshow-paused', slideshowPaused);
}

function pauseSlideshowAndMusic() {
  slideshowPaused = true;
  syncPausedStateClass();
  clearSlideshowTimer();
  if (ytPlayerAvailable) ytPlayer?.pauseVideo?.();
  updatePlayPauseButton();
  syncMediaSessionPlaybackState();
}

function resumeSlideshowAndMusic() {
  slideshowPaused = false;
  syncPausedStateClass();
  scheduleSlideshowTick();
  if (ytPlayerAvailable) ytPlayer?.playVideo?.();
  updatePlayPauseButton();
  syncMediaSessionPlaybackState();
}

function togglePlayPause() {
  if (slideshowPaused) resumeSlideshowAndMusic();
  else pauseSlideshowAndMusic();
  showControls();
}

function isStartOverlayVisible() {
  return Boolean(startOverlay && !startOverlay.classList.contains('is-hidden'));
}

function armHideChrome() {
  clearTimeout(controlsHideTimerId);
  if (isArchiveOpen() || isFeedbackOpen()) return;
  controlsHideTimerId = window.setTimeout(() => {
    if (isCompactPortraitControls()) {
      if (mobileControlsExpanded) {
        setMobileControlsExpanded(false);
      }
      chromeDock?.classList.remove('chrome-dock--hidden');
      document.body.classList.remove('body--chrome-hidden');
      return;
    }
    chromeDock?.classList.add('chrome-dock--hidden');
    if (!isStartOverlayVisible()) {
      document.body.classList.add('body--chrome-hidden');
    }
  }, CONTROLS_HIDE_MS);
}

function showControls() {
  chromeDock?.classList.remove('chrome-dock--hidden');
  document.body.classList.remove('body--chrome-hidden');
  clearTimeout(controlsHideTimerId);
  armHideChrome();
}

function isCompactPortraitControls() {
  return Boolean(window.matchMedia?.('(max-width: 900px) and (orientation: portrait)').matches);
}

function setMobileControlsExpanded(open) {
  mobileControlsExpanded = Boolean(open);
  const compact = isCompactPortraitControls();
  const expanded = compact ? mobileControlsExpanded : true;
  appRoot?.classList.toggle('mobile-controls-expanded', expanded);
  if (ctrlMore) {
    ctrlMore.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    ctrlMore.setAttribute('aria-label', expanded ? 'Hide extra controls' : 'Show more controls');
    ctrlMore.title = expanded ? 'Hide extra controls' : 'More controls';
  }
  // On desktop the tray is inline (always visible); in compact portrait it's a slide-up panel whose
  // visibility mirrors `expanded`. Keeping aria-hidden in sync helps assistive tech + the backdrop.
  if (controlsTray) {
    controlsTray.setAttribute('aria-hidden', compact && !expanded ? 'true' : 'false');
  }
  if (controlsTrayBackdrop) {
    controlsTrayBackdrop.setAttribute('aria-hidden', compact && expanded ? 'false' : 'true');
  }
}

function syncMobileControlsMode() {
  if (!isCompactPortraitControls()) {
    setMobileControlsExpanded(true);
    return;
  }
  setMobileControlsExpanded(mobileControlsExpanded);
}

function nudgeVolume(delta) {
  const next = clamp(audioVolume + delta, 0, 100);
  if (next === audioVolume && !audioMuted) return;
  audioVolume = next;
  if (audioVolume > 0 && audioMuted) audioMuted = false;
  applyVolumeToPlayer();
  syncVolumeUi();
  scheduleSaveAudioPrefs();
  showControls();
}

function toggleMuteFromKeyboard() {
  audioMuted = !audioMuted;
  applyVolumeToPlayer();
  syncVolumeUi();
  scheduleSaveAudioPrefs();
  showControls();
}

function isMusicPlaying() {
  if (!ytPlayerAvailable || !ytPlayer) return false;
  try {
    const YT = window.YT;
    const state = ytPlayer.getPlayerState?.();
    return Boolean(YT && state === YT.PlayerState.PLAYING);
  } catch {
    return false;
  }
}

function updateMusicPlayPauseButton() {
  if (!ctrlMusicPlayPause) return;
  const available = ytPlayerAvailable;
  ctrlMusicPlayPause.disabled = !available;
  const playing = isMusicPlaying();
  ctrlMusicPlayPause.classList.toggle('is-paused', !playing);
  ctrlMusicPlayPause.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
  ctrlMusicPlayPause.title = playing ? 'Pause music' : 'Play music';
}

function toggleMusicPlayPause() {
  if (!ytPlayerAvailable || !ytPlayer) {
    showStatusBanner('Music controls are unavailable right now.');
    return;
  }
  if (isMusicPlaying()) {
    ytPlayer.pauseVideo?.();
  } else {
    ytPlayer.playVideo?.();
  }
  // The YT state change callback will flip the icon when the player confirms the new state;
  // flipping it here gives immediate visual feedback in case the event is briefly delayed.
  requestAnimationFrame(updateMusicPlayPauseButton);
  showControls();
}

function ytPreviousTrack() {
  if (!ytPlayerAvailable) {
    showStatusBanner('Music controls are unavailable right now.');
    return;
  }
  ytPlayer?.previousVideo?.();
  showControls();
}

function ytNextTrack() {
  if (!ytPlayerAvailable) {
    showStatusBanner('Music controls are unavailable right now.');
    return;
  }
  ytPlayer?.nextVideo?.();
  showControls();
}

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    null
  );
}

function updateFullscreenButton() {
  const fs = Boolean(appRoot && getFullscreenElement() === appRoot);
  ctrlFullscreen?.classList.toggle('is-fullscreen', fs);
  ctrlFullscreen?.setAttribute('aria-label', fs ? 'Exit fullscreen' : 'Enter fullscreen');
}

async function toggleFullscreen() {
  if (!appRoot) return;
  try {
    if (getFullscreenElement()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
    } else {
      if (appRoot.requestFullscreen) await appRoot.requestFullscreen();
      else if (appRoot.webkitRequestFullscreen) appRoot.webkitRequestFullscreen();
      else if (appRoot.mozRequestFullScreen) appRoot.mozRequestFullScreen();
    }
  } catch (e) {
    console.warn('Fullscreen request failed', e);
  }
  updateFullscreenButton();
  showControls();
}

function wireBrowsingUi() {
  ctrlArchive?.addEventListener('click', () => {
    toggleArchive();
    showControls();
  });

  archiveCloseBtn?.addEventListener('click', () => closeArchive());
  archiveBackdrop?.addEventListener('click', () => closeArchive());

  filmstripEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.filmstrip__btn[data-slide-index]');
    if (!btn) return;
    const i = Number(btn.dataset.slideIndex);
    if (Number.isFinite(i)) goToIndexFromFilmstrip(i);
  });

  archiveGridEl?.addEventListener('click', (e) => {
    const cell = e.target.closest('.archive-grid__cell[data-slide-index]');
    if (!cell) return;
    const i = Number(cell.dataset.slideIndex);
    if (Number.isFinite(i)) goToIndexFromArchive(i);
  });
}

function isSettingsPopoverOpen() {
  return Boolean(ctrlSettingsWrap?.classList.contains('is-open'));
}

function setSettingsPopoverOpen(open) {
  if (!ctrlSettingsWrap || !ctrlSettings) return;
  const isOpen = Boolean(open);
  ctrlSettingsWrap.classList.toggle('is-open', isOpen);
  ctrlSettings.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function wireSettingsPopover() {
  if (!ctrlSettings || !ctrlSettingsWrap) return;
  ctrlSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    setSettingsPopoverOpen(!isSettingsPopoverOpen());
    showControls();
  });
  ctrlSettingsPopover?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  document.addEventListener('click', (e) => {
    if (!isSettingsPopoverOpen()) return;
    if (ctrlSettingsWrap.contains(e.target)) return;
    setSettingsPopoverOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isSettingsPopoverOpen()) return;
    setSettingsPopoverOpen(false);
    ctrlSettings.focus();
  });
}

function wireControlsUi() {
  syncMobileControlsMode();
  ctrlSlidePrev?.addEventListener('click', () => manualStep(-1));
  ctrlSlideNext?.addEventListener('click', () => manualStep(1));
  ctrlDownloadSlide?.addEventListener('click', () => {
    void (async () => {
      await downloadCurrentSlide();
      showControls();
    })();
  });
  ctrlShareSlide?.addEventListener('click', () => {
    void (async () => {
      await shareCurrentSlide();
      showControls();
    })();
  });
  syncShareButtonAvailability();
  ctrlPlayPause?.addEventListener('click', () => togglePlayPause());
  ctrlMusicPlayPause?.addEventListener('click', () => toggleMusicPlayPause());
  ctrlTrackPrev?.addEventListener('click', () => ytPreviousTrack());
  ctrlTrackNext?.addEventListener('click', () => ytNextTrack());
  ctrlMute?.addEventListener('click', () => {
    audioMuted = !audioMuted;
    applyVolumeToPlayer();
    syncVolumeUi();
    scheduleSaveAudioPrefs();
    showControls();
  });
  ctrlFullscreen?.addEventListener('click', () => {
    void toggleFullscreen();
  });
  ctrlMore?.addEventListener('click', () => {
    setMobileControlsExpanded(!mobileControlsExpanded);
    showControls();
  });
  controlsTrayBackdrop?.addEventListener('click', () => {
    if (mobileControlsExpanded && isCompactPortraitControls()) {
      setMobileControlsExpanded(false);
      showControls();
    }
  });

  ctrlVolume?.addEventListener('input', () => {
    audioVolume = clamp(Number(ctrlVolume.value) || 0, 0, 100);
    if (audioVolume > 0 && audioMuted) {
      audioMuted = false;
    }
    applyVolumeToPlayer();
    syncVolumeUi();
    scheduleSaveAudioPrefs();
    showControls();
  });

  ctrlVolume?.addEventListener('change', () => {
    scheduleSaveAudioPrefs();
  });

  ctrlSlideSec?.addEventListener('input', () => {
    manualSlideSeconds = clamp(parseFloat(ctrlSlideSec.value) || 5, 1, 60);
    syncSlideTimingUi();
    saveSlideTimingPrefs();
    const ms = getSlideDurationMs();
    syncKenBurnsDurationCss(ms);
    if (!slideshowPaused) scheduleSlideshowTick();
    showControls();
  });

  ctrlFitFull?.addEventListener('change', () => {
    setFitContainMode(ctrlFitFull.checked);
    showControls();
  });

  wireSettingsPopover();

  const onActivity = () => showControls();
  document.addEventListener('mousemove', onActivity, { passive: true });
  document.addEventListener('pointerdown', onActivity, { passive: true });
  document.addEventListener('touchstart', onActivity, { passive: true });
  document.addEventListener('touchmove', onActivity, { passive: true });
}

function wireFullscreenEvents() {
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  document.addEventListener('mozfullscreenchange', updateFullscreenButton);
}

function wireViewportResize() {
  window.addEventListener(
    'resize',
    () => {
      syncMobileControlsMode();
      if (images.length === 0) return;
      refreshAllSlidePresentStyles();
    },
    { passive: true },
  );
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    if (fatalOverlay && !fatalOverlay.hidden) {
      if (e.code === 'Escape') {
        e.preventDefault();
      }
      return;
    }
    if (isStartOverlayVisible()) {
      return;
    }
    if (isFeedbackOpen()) {
      if (e.code === 'Escape') {
        e.preventDefault();
        closePhotoFeedback();
      }
      return;
    }
    if (isArchiveOpen()) {
      if (e.code === 'Escape' || e.code === 'KeyG') {
        e.preventDefault();
        closeArchive();
      }
      return;
    }
    if (e.code === 'Escape' && mobileControlsExpanded && isCompactPortraitControls()) {
      e.preventDefault();
      setMobileControlsExpanded(false);
      showControls();
      return;
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        manualStep(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        manualStep(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        nudgeVolume(e.shiftKey ? 10 : 5);
        break;
      case 'ArrowDown':
        e.preventDefault();
        nudgeVolume(e.shiftKey ? -10 : -5);
        break;
      case 'KeyM':
        e.preventDefault();
        toggleMuteFromKeyboard();
        break;
      case 'KeyP':
        e.preventDefault();
        toggleMusicPlayPause();
        break;
      case 'KeyF':
        e.preventDefault();
        void toggleFullscreen();
        break;
      case 'KeyG':
        e.preventDefault();
        openArchive();
        break;
      case 'Escape':
        if (userScale !== 1 || userTx !== 0 || userTy !== 0) {
          e.preventDefault();
          resetUserZoom(true);
          showControls();
        } else if (appRoot && getFullscreenElement() === appRoot) {
          e.preventDefault();
          void toggleFullscreen();
        }
        break;
      default:
        break;
    }
  });
}

function wireMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Memorial slideshow',
      artist: 'Kenneth Leroy McKenzie',
    });
  } catch {
    /* ignore */
  }

  const safe = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* unsupported action */
    }
  };

  safe('play', () => {
    resumeSlideshowAndMusic();
    showControls();
  });
  safe('pause', () => {
    pauseSlideshowAndMusic();
    showControls();
  });
  safe('previoustrack', () => {
    ytPreviousTrack();
  });
  safe('nexttrack', () => {
    ytNextTrack();
  });
}

function hideStartOverlay() {
  startOverlay?.classList.add('is-hidden');
  if (!isArchiveOpen() && !isFeedbackOpen()) {
    releaseFocusTrap();
  }
}

function wireStartControl() {
  startBtn?.addEventListener('click', () => {
    if (ytPlayerAvailable) ytPlayer?.playVideo?.();
    hideStartOverlay();
    showControls();
  });
  if (startOverlay && startBtn) {
    activateFocusTrap(startOverlay, startBtn);
  }
}

function wireFatalOverlayControls() {
  fatalRetryBtn?.addEventListener('click', () => {
    window.location.reload();
  });
}

function setStartHintText(text) {
  if (!startHint || typeof text !== 'string' || text.trim() === '') return;
  startHint.textContent = text.trim();
}

function onYtStateChange(event) {
  try {
    const YT = window.YT;
    updateMusicPlayPauseButton();
    if (!YT || event.data !== YT.PlayerState.PLAYING) return;
    const id = event.target?.getVideoData?.()?.video_id ?? '';
    if (id && id !== lastYtVideoId) {
      lastYtVideoId = id;
      const ms = getSlideDurationMs();
      syncKenBurnsDurationCss(ms);
      if (!slideshowPaused && !grabInteractionActive) scheduleSlideshowTick();
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  tryUnlockFocalEditorFromHash();
  hideFatalOverlay();
  loadAudioPrefs();
  loadSlideTimingPrefs();
  loadFitContainPrefs();
  syncPausedStateClass();
  syncRootFitContainClass();
  syncFitContainUi();
  syncVolumeUi();
  syncSlideTimingUi();

  initFeedbackStore();
  wireStartControl();
  wireFatalOverlayControls();
  wireStageGrab();
  wireWheelZoom();
  wireBrowsingUi();
  wirePhotoFeedbackUi();
  wireControlsUi();
  wireFullscreenEvents();
  wireViewportResize();
  wireKeyboard();
  wireMediaSession();
  updateFullscreenButton();
  wireFocalEditor();

  try {
    await loadManifest();
  } catch (err) {
    console.error('Manifest failed to load', err);
    const detail =
      err instanceof Error && err.message
        ? err.message
        : 'The manifest could not be loaded.';
    showFatalOverlay(
      `The slideshow could not start because the photo manifest is unavailable (${detail}). Run the manifest generator and refresh.`,
    );
    return;
  }
  showInitial();
  scheduleSlideshowTick();
  updatePlayPauseButton();
  syncMediaSessionPlaybackState();
  syncSlideChromeButtons();

  if (startBtn) startBtn.disabled = true;

  try {
    ytPlayer = await createPlaylistPlayer({
      elementId: 'yt-anchor',
      playlistId: PLAYLIST_ID,
      onStateChange: onYtStateChange,
    });
    ytPlayerAvailable = true;
    try {
      lastYtVideoId = ytPlayer.getVideoData?.()?.video_id ?? '';
    } catch {
      lastYtVideoId = '';
    }
    applyVolumeToPlayer();
    syncVolumeUi();
    if (!slideshowPaused) scheduleSlideshowTick();
    if (startBtn) startBtn.disabled = false;
    setStartHintText('Tap to begin and hear the music.');
    syncSlideChromeButtons();
    updatePlayPauseButton();
  } catch (e) {
    ytPlayerAvailable = false;
    console.error('YouTube player failed', e);
    if (startBtn) startBtn.disabled = false;
    setStartHintText('Tap to begin the slideshow. Music is currently unavailable.');
    showStatusBanner('Music could not be loaded. The slideshow will continue without audio.');
    syncSlideChromeButtons();
    updatePlayPauseButton();
  }
}

main().catch((err) => {
  console.error(err);
  const detail =
    err instanceof Error && err.message
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown error';
  showFatalOverlay(
    `Something went wrong while starting the memorial (${detail}). Check the browser console (F12) for the full error, then refresh.`,
  );
});
