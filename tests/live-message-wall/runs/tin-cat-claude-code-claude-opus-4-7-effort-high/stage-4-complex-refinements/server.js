const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'messages.json');
const MAX_MESSAGE_BYTES = 4 * 1024;              // 4 KiB

// Lifecycle / pagination tuning
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;     // messages disappear after 1 month
const RATE_LIMIT_MS = 10 * 60 * 1000;            // one post per 10 minutes
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;        // prune hourly
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

const CLIENT_COOKIE = 'wallClient';
const CLIENT_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365; // 1 year

// Match control characters other than TAB / LF / CR. Built dynamically so the
// source file itself contains no literal control bytes.
const CONTROL_RE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]',
  'g'
);

const app = express();
app.use(express.json({ limit: '32kb' }));

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Stamp every visitor with an opaque client cookie. Doubles as the CSRF token
// via the double-submit cookie pattern: POSTs must echo it in `x-csrf-token`.
app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  let clientId = cookies[CLIENT_COOKIE];
  if (!clientId || !/^[a-f0-9]{32}$/.test(clientId)) {
    clientId = crypto.randomBytes(16).toString('hex');
    res.setHeader(
      'Set-Cookie',
      `${CLIENT_COOKIE}=${clientId}; Path=/; Max-Age=${CLIENT_COOKIE_MAX_AGE_SEC}; SameSite=Lax`
    );
  }
  req.clientId = clientId;
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

let messages = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    messages = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(messages)) messages = [];
  }
} catch (err) {
  console.error('Failed to load messages.json, starting empty:', err.message);
  messages = [];
}

// Keep oldest-first internally. Sort once at load in case the file is unsorted.
messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

// Indexes derived from `messages`. Wall-level reads hit `topLevel` only;
// `byId` answers parent-lookup for replies; `repliesByParent` answers the
// thread view. All three are oldest-first.
const byId = new Map();
const repliesByParent = new Map();
let topLevel = [];

function rebuildIndexes() {
  byId.clear();
  repliesByParent.clear();
  topLevel = [];
  for (const m of messages) {
    byId.set(m.id, m);
    if (m.parentId) {
      let arr = repliesByParent.get(m.parentId);
      if (!arr) { arr = []; repliesByParent.set(m.parentId, arr); }
      arr.push(m);
    } else {
      topLevel.push(m);
    }
  }
}
rebuildIndexes();

let writeQueued = false;
function persist() {
  if (writeQueued) return;
  writeQueued = true;
  setImmediate(() => {
    writeQueued = false;
    fs.writeFile(DATA_FILE, JSON.stringify(messages), (err) => {
      if (err) console.error('Failed to persist messages:', err.message);
    });
  });
}

function pruneExpired() {
  const cutoff = Date.now() - MAX_AGE_MS;
  const before = messages.length;

  // Find top-level messages that have aged out. A reply's createdAt is always
  // greater than its parent's, so any reply whose parent expired (or whose own
  // age is past the cutoff) goes with it -- threads are pruned as a unit.
  const expiredParentIds = new Set();
  for (const m of messages) {
    if (new Date(m.createdAt).getTime() >= cutoff) break;
    if (!m.parentId) expiredParentIds.add(m.id);
  }

  const kept = [];
  for (const m of messages) {
    const t = new Date(m.createdAt).getTime();
    if (t < cutoff) continue;
    if (m.parentId && expiredParentIds.has(m.parentId)) continue;
    kept.push(m);
  }

  if (kept.length === messages.length) return;
  messages.length = 0;
  for (const m of kept) messages.push(m);
  rebuildIndexes();
  persist();
  console.log(`[wall] pruned ${before - messages.length} expired messages (kept ${messages.length})`);
}
pruneExpired();
setInterval(pruneExpired, PRUNE_INTERVAL_MS).unref();

// Rate-limit state. Tracked along two axes (IP and cookie) so circumventing
// one (rotating IP, clearing cookies) still hits the other; either being
// recent blocks a post.
const lastPostByIp = new Map();
const lastPostByClient = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function sweepRateMaps() {
  const cutoff = Date.now() - RATE_LIMIT_MS;
  for (const [k, t] of lastPostByIp) if (t < cutoff) lastPostByIp.delete(k);
  for (const [k, t] of lastPostByClient) if (t < cutoff) lastPostByClient.delete(k);
}

function sanitizeText(s) {
  return s.replace(CONTROL_RE, '');
}

function decorate(m) {
  // Cards on the wall need a replyCount so they can render the "N replies"
  // button without a follow-up request per card.
  const replies = repliesByParent.get(m.id);
  return { ...m, replyCount: replies ? replies.length : 0 };
}

app.get('/api/messages', (req, res) => {
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
  const cutoff = Date.now() - MAX_AGE_MS;

  let beforeTime = Infinity;
  if (req.query.before) {
    const t = new Date(String(req.query.before)).getTime();
    if (!Number.isNaN(t)) beforeTime = t;
  }

  const out = [];
  for (let i = topLevel.length - 1; i >= 0 && out.length < limit; i--) {
    const m = topLevel[i];
    const t = new Date(m.createdAt).getTime();
    if (t < cutoff) break;
    if (t >= beforeTime) continue;
    out.push(decorate(m));
  }

  let hasMore = false;
  if (out.length === limit) {
    const oldestReturned = new Date(out[out.length - 1].createdAt).getTime();
    for (let i = 0; i < topLevel.length; i++) {
      const t = new Date(topLevel[i].createdAt).getTime();
      if (t >= cutoff && t < oldestReturned) { hasMore = true; break; }
    }
  }

  res.json({ messages: out, hasMore });
});

app.get('/api/messages/:id/replies', (req, res) => {
  const parent = byId.get(req.params.id);
  if (!parent || parent.parentId) {
    return res.status(404).json({ error: 'Message not found.' });
  }
  // Newest-first matches how the modal displays them.
  const replies = (repliesByParent.get(parent.id) || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ replies });
});

app.post('/api/messages', (req, res) => {
  // Double-submit cookie: the header must match the cookie value. Cross-origin
  // JavaScript cannot read the cookie, so it cannot forge the header.
  const headerToken = req.headers['x-csrf-token'];
  if (typeof headerToken !== 'string' || headerToken !== req.clientId) {
    return res.status(403).json({ error: 'CSRF token missing or invalid.' });
  }

  const ip = getClientIp(req);
  sweepRateMaps();
  const now = Date.now();
  const lastIp = lastPostByIp.get(ip) || 0;
  const lastClient = lastPostByClient.get(req.clientId) || 0;
  const last = Math.max(lastIp, lastClient);
  if (last && now - last < RATE_LIMIT_MS) {
    const remainingMs = RATE_LIMIT_MS - (now - last);
    const remainingSec = Math.ceil(remainingMs / 1000);
    res.set('Retry-After', String(remainingSec));
    return res.status(429).json({
      error: 'rate limited - try again in ~' + Math.ceil(remainingSec / 60) + ' min.',
      retryAfterSec: remainingSec,
      retryAfterMs: remainingMs,
    });
  }

  const raw = req.body && typeof req.body.text === 'string' ? req.body.text : '';
  const text = sanitizeText(raw).trim();
  if (!text) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_MESSAGE_BYTES) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_BYTES} bytes).` });
  }

  let parent = null;
  const rawParentId = req.body && typeof req.body.parentId === 'string' ? req.body.parentId : null;
  if (rawParentId) {
    parent = byId.get(rawParentId);
    if (!parent) {
      return res.status(404).json({ error: 'Parent message not found.' });
    }
    // Single-level threading: a reply itself can't be replied to.
    if (parent.parentId) {
      return res.status(400).json({ error: 'Cannot reply to a reply.' });
    }
  }

  const message = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: new Date(now).toISOString(),
  };
  if (parent) message.parentId = parent.id;

  messages.push(message);
  byId.set(message.id, message);
  if (parent) {
    let arr = repliesByParent.get(parent.id);
    if (!arr) { arr = []; repliesByParent.set(parent.id, arr); }
    arr.push(message);
  } else {
    topLevel.push(message);
  }

  lastPostByIp.set(ip, now);
  lastPostByClient.set(req.clientId, now);
  persist();

  if (parent) {
    broadcast({ type: 'reply', parentId: parent.id, message });
  } else {
    broadcast({ type: 'new', message: decorate(message) });
  }
  res.status(201).json(message);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch (_) { /* ignore */ }
    }
  }
}

wss.on('connection', (ws) => {
  try {
    ws.send(JSON.stringify({ type: 'hello', count: messages.length }));
  } catch (_) { /* ignore */ }
});

server.listen(PORT, () => {
  console.log(`[wall] listening on http://localhost:${PORT}`);
});
