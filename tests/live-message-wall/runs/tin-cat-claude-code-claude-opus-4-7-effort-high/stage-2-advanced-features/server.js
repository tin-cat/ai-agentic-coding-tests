const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'messages.json');
const MAX_MESSAGE_LENGTH = 2000;

// Lifecycle / pagination tuning
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;     // messages disappear after 1 month
const RATE_LIMIT_MS = 60 * 60 * 1000;            // one post per hour per IP
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;        // prune hourly
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

const app = express();
app.use(express.json({ limit: '32kb' }));
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
  // messages is oldest-first; find first index whose age is within window
  let firstKeep = 0;
  while (firstKeep < messages.length && new Date(messages[firstKeep].createdAt).getTime() < cutoff) {
    firstKeep++;
  }
  if (firstKeep > 0) {
    messages.splice(0, firstKeep);
    persist();
    console.log(`[wall] pruned ${before - messages.length} expired messages (kept ${messages.length})`);
  }
}
pruneExpired();
setInterval(pruneExpired, PRUNE_INTERVAL_MS).unref();

// In-memory rate-limit table (acceptable for a single-process server).
// Map<ip, lastPostMs>. Cleaned opportunistically on each POST.
const lastPostByIp = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function sweepRateMap() {
  const cutoff = Date.now() - RATE_LIMIT_MS;
  for (const [ip, t] of lastPostByIp) {
    if (t < cutoff) lastPostByIp.delete(ip);
  }
}

// GET /api/messages?before=<ISO>&limit=N
// Returns messages newest-first. If `before` is set, returns messages strictly
// older than that ISO timestamp. Always filters out anything past MAX_AGE_MS.
app.get('/api/messages', (req, res) => {
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
  const cutoff = Date.now() - MAX_AGE_MS;

  let beforeTime = Infinity;
  if (req.query.before) {
    const t = new Date(String(req.query.before)).getTime();
    if (!Number.isNaN(t)) beforeTime = t;
  }

  // Walk oldest-first array from the end (newest) backward, collecting matches.
  const out = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i];
    const t = new Date(m.createdAt).getTime();
    if (t < cutoff) break;            // older than this is expired; rest is older too
    if (t >= beforeTime) continue;    // newer-or-equal-to cursor; skip
    out.push(m);
  }

  // Determine whether there is more older content available
  let hasMore = false;
  if (out.length === limit) {
    const oldestReturned = new Date(out[out.length - 1].createdAt).getTime();
    // hasMore if any non-expired message exists older than what we returned
    for (let i = 0; i < messages.length; i++) {
      const t = new Date(messages[i].createdAt).getTime();
      if (t >= cutoff && t < oldestReturned) { hasMore = true; break; }
    }
  }

  res.json({ messages: out, hasMore });
});

app.post('/api/messages', (req, res) => {
  const ip = getClientIp(req);
  sweepRateMap();
  const last = lastPostByIp.get(ip);
  const now = Date.now();
  if (last && now - last < RATE_LIMIT_MS) {
    const remainingSec = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
    const remainingMin = Math.max(1, Math.ceil(remainingSec / 60));
    res.set('Retry-After', String(remainingSec));
    return res.status(429).json({
      error: `slow down — try again in ~${remainingMin} min.`,
      retryAfterSec: remainingSec,
    });
  }

  const raw = req.body && typeof req.body.text === 'string' ? req.body.text : '';
  const text = raw.trim();
  if (!text) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars).` });
  }

  const message = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: new Date(now).toISOString(),
  };
  messages.push(message);
  lastPostByIp.set(ip, now);
  persist();
  broadcast({ type: 'new', message });
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
