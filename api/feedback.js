/**
 * Vercel Serverless: shared reactions + comments per manifest image src (e.g. images/photo.jpg).
 *
 * Storage: Supabase (Postgres). Requires the `feedback` + `rate_limits` tables and the
 * `fb_rate_limit` function created by `db/schema.sql`.
 *
 * Env:
 *   SUPABASE_URL                         — e.g. https://xyzcompany.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY            — server-side key; never expose to the browser
 *   FEEDBACK_ALLOWED_ORIGINS             — optional comma list of allowed browser origins
 *   FEEDBACK_MAX_POSTS_PER_MINUTE        — optional (default 24)
 *   FEEDBACK_MAX_COMMENTS_PER_15MIN      — optional (default 10)
 *   FEEDBACK_COMMENT_BLOCKLIST           — optional comma list of banned substrings
 */

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ALLOWED = new Set(['heart', 'pray', 'smile', 'tear', 'flower']);
const PHOTO_RE = /^images\/[A-Za-z0-9._\/-]+$/;
const MAX_COMMENT_LEN = 2000;
const MAX_COMMENTS = 400;
const MAX_VOTERS_PER_REACTION = 600;
const VISITOR_ID_RE = /^[A-Za-z0-9._:-]{8,120}$/;
const ORIGIN_ALLOWLIST = String(process.env.FEEDBACK_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_POSTS_PER_MINUTE = Number.parseInt(process.env.FEEDBACK_MAX_POSTS_PER_MINUTE || '24', 10);
const MAX_COMMENTS_PER_15MIN = Number.parseInt(
  process.env.FEEDBACK_MAX_COMMENTS_PER_15MIN || '10',
  10,
);
const COMMENT_BLOCKLIST = String(
  process.env.FEEDBACK_COMMENT_BLOCKLIST || 'http://,https://,discord.gg,t.me,bit.ly',
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

let _supabase;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'memorial-feedback' } },
  });
  return _supabase;
}

function emptyDoc() {
  return { reactions: {}, voters: {}, comments: [] };
}

function normalizeDoc(raw) {
  const out = emptyDoc();
  if (!raw || typeof raw !== 'object') return out;
  if (raw.reactions && typeof raw.reactions === 'object') {
    for (const [k, v] of Object.entries(raw.reactions)) {
      if (ALLOWED.has(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out.reactions[k] = Math.floor(v);
      }
    }
  }
  if (raw.voters && typeof raw.voters === 'object') {
    for (const k of ALLOWED) {
      const arr = raw.voters[k];
      if (!Array.isArray(arr)) continue;
      out.voters[k] = arr
        .filter((x) => typeof x === 'string' && x.length > 0 && x.length < 120)
        .slice(-MAX_VOTERS_PER_REACTION);
    }
  }
  if (Array.isArray(raw.comments)) {
    out.comments = raw.comments
      .filter((c) => c && typeof c.text === 'string' && c.text.trim().length > 0)
      .slice(-MAX_COMMENTS)
      .map((c) => ({
        id: typeof c.id === 'string' ? c.id.slice(0, 80) : `c-${Date.now()}`,
        text: c.text.slice(0, MAX_COMMENT_LEN),
        at: typeof c.at === 'string' ? c.at : new Date().toISOString(),
      }));
  }
  return out;
}

function isValidPhoto(photo) {
  return typeof photo === 'string' && photo.length <= 240 && PHOTO_RE.test(photo) && !photo.includes('..');
}

function normalizeOrigin(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (ORIGIN_ALLOWLIST.length === 0) return true;
  return ORIGIN_ALLOWLIST.includes(origin);
}

function cors(res, req) {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(normalizeOrigin(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function myReactionsFromDoc(doc, visitorId) {
  if (!visitorId || typeof visitorId !== 'string') return [];
  const mine = [];
  for (const id of ALLOWED) {
    if (doc.voters[id]?.includes(visitorId)) mine.push(id);
  }
  return mine;
}

function buildResponse(doc, visitorId) {
  const reactionCounts = {};
  for (const id of ALLOWED) {
    const n = doc.reactions[id];
    if (typeof n === 'number' && n > 0) reactionCounts[id] = n;
  }
  return {
    reactionCounts,
    myReactions: myReactionsFromDoc(doc, visitorId),
    comments: doc.comments,
  };
}

function normalizeVisitorId(raw) {
  if (typeof raw !== 'string') return '';
  const v = raw.trim().slice(0, 120);
  if (!VISITOR_ID_RE.test(v)) return '';
  return v;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    const first = xf.split(',')[0]?.trim();
    if (first) return first.slice(0, 120);
  }
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim().slice(0, 120);
  return 'unknown';
}

function isCommentAllowed(text) {
  const lower = text.toLowerCase();
  return !COMMENT_BLOCKLIST.some((needle) => needle && lower.includes(needle));
}

async function readDoc(supabase, photo) {
  const { data, error } = await supabase
    .from('feedback')
    .select('doc')
    .eq('photo', photo)
    .maybeSingle();
  if (error) throw error;
  return normalizeDoc(data?.doc ?? null);
}

async function writeDoc(supabase, photo, doc) {
  const { error } = await supabase
    .from('feedback')
    .upsert({ photo, doc, updated_at: new Date().toISOString() }, { onConflict: 'photo' });
  if (error) throw error;
}

async function enforceRateLimit(supabase, key, max, windowSec) {
  if (!Number.isFinite(max) || max <= 0) return true;
  const { data, error } = await supabase.rpc('fb_rate_limit', {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSec,
  });
  if (error) {
    // Fail open on transient RPC errors so the site stays usable; surface in logs for ops.
    console.error('[feedback] rate-limit RPC failed', error);
    return true;
  }
  return data !== false;
}

export default async function handler(req, res) {
  cors(res, req);
  const reqOrigin = normalizeOrigin(req.headers.origin);
  if (!isOriginAllowed(reqOrigin)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res
      .status(503)
      .json({ error: 'Feedback API is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).' });
  }

  try {
    if (req.method === 'GET') {
      const photo = req.query.photo;
      const visitorId = normalizeVisitorId(req.query.visitor);
      if (!isValidPhoto(photo)) {
        return res.status(400).json({ error: 'Invalid photo key.' });
      }
      const doc = await readDoc(supabase, photo);
      return res.status(200).json(buildResponse(doc, visitorId));
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch {
        return res.status(400).json({ error: 'Invalid JSON.' });
      }
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid body.' });
      }

      const photo = body.photo;
      const visitorId = normalizeVisitorId(body.visitorId);
      if (!isValidPhoto(photo)) {
        return res.status(400).json({ error: 'Invalid photo key.' });
      }
      if (!visitorId) {
        return res.status(400).json({ error: 'visitorId required.' });
      }
      const ip = clientIp(req);
      const rlOk = await enforceRateLimit(supabase, `ip:${ip}`, MAX_POSTS_PER_MINUTE, 60);
      if (!rlOk) {
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
      }
      const rlVisitorOk = await enforceRateLimit(
        supabase,
        `visitor:${visitorId}`,
        MAX_POSTS_PER_MINUTE,
        60,
      );
      if (!rlVisitorOk) {
        return res.status(429).json({ error: 'Too many actions from this device. Try again soon.' });
      }

      let doc = await readDoc(supabase, photo);

      if (body.action === 'toggleReaction') {
        const reactionId = body.reactionId;
        if (!ALLOWED.has(reactionId)) {
          return res.status(400).json({ error: 'Invalid reaction.' });
        }
        const voters = [...(doc.voters[reactionId] || [])];
        const pos = voters.indexOf(visitorId);
        if (pos >= 0) {
          voters.splice(pos, 1);
          doc.reactions[reactionId] = Math.max(0, (doc.reactions[reactionId] || 0) - 1);
          if (doc.reactions[reactionId] === 0) delete doc.reactions[reactionId];
        } else {
          voters.push(visitorId);
          while (voters.length > MAX_VOTERS_PER_REACTION) voters.shift();
          doc.reactions[reactionId] = (doc.reactions[reactionId] || 0) + 1;
        }
        doc.voters[reactionId] = voters;
      } else if (body.action === 'addComment') {
        const text =
          typeof body.text === 'string' ? body.text.trim().slice(0, MAX_COMMENT_LEN) : '';
        if (!text) {
          return res.status(400).json({ error: 'Empty comment.' });
        }
        if (!isCommentAllowed(text)) {
          return res.status(422).json({ error: 'Comment contains blocked content.' });
        }
        const commentLimitOk = await enforceRateLimit(
          supabase,
          `comment:${photo}:${visitorId}`,
          MAX_COMMENTS_PER_15MIN,
          15 * 60,
        );
        if (!commentLimitOk) {
          return res.status(429).json({ error: 'Comment rate limit reached. Please try later.' });
        }
        const id = randomUUID();
        doc.comments.push({ id, text, at: new Date().toISOString() });
        if (doc.comments.length > MAX_COMMENTS) {
          doc.comments = doc.comments.slice(-MAX_COMMENTS);
        }
      } else {
        return res.status(400).json({ error: 'Unknown action.' });
      }

      await writeDoc(supabase, photo, doc);
      return res.status(200).json(buildResponse(doc, visitorId));
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[feedback] handler error', err);
    return res.status(500).json({ error: 'Internal error.' });
  }
}
