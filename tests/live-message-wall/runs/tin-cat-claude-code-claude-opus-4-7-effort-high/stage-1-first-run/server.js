const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'messages.json');
const MAX_MESSAGE_LENGTH = 2000;

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

app.get('/api/messages', (_req, res) => {
  res.json(messages);
});

app.post('/api/messages', (req, res) => {
  const raw = req.body && typeof req.body.text === 'string' ? req.body.text : '';
  const text = raw.trim();
  if (!text) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars).` });
  }
  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: new Date().toISOString(),
  };
  messages.push(message);
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
