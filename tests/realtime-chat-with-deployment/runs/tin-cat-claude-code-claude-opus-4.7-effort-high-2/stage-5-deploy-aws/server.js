'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'chat.db');

// Optional admin HTTP API token. When unset, the /admin/* endpoints are
// disabled entirely. In a deployment this is injected from a secret store
// (e.g. AWS Secrets Manager) and is never committed to the repo.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// SQLite locking mode. On a network filesystem (e.g. an EFS volume in AWS) the
// WAL shared-memory index file (mmap) is unavailable; setting EXCLUSIVE keeps
// the wal-index in heap memory so WAL still works for our single-writer server.
// Leave unset for local runs, where normal locking on a local disk is fine.
const SQLITE_LOCKING_MODE = (process.env.SQLITE_LOCKING_MODE || '').toUpperCase();

// How many chat messages we keep (and replay) per room.
const HISTORY_LIMIT = 200;
const DEFAULT_ROOM = 'general';

// --- Moderation / security configuration ----------------------------------
// All knobs are env-configurable so deployments can tune limits and the word
// filter without code changes (consistent with PORT / DB_PATH above).

function toPositiveInt(value, fallback) {
	const n = Number.parseInt(value, 10);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Split a comma-separated env list into trimmed, non-empty entries.
function parseList(value) {
	if (typeof value !== 'string') {
		return [];
	}
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

const MAX_NAME_LENGTH = 40;
// Hard cap on stored message length. The client also enforces this via the
// input's maxlength, but the server is the authority and never trusts it.
const MAX_MESSAGE_LENGTH = toPositiveInt(process.env.MAX_MESSAGE_LENGTH, 2000);

// Per-room, per-user rate limit: at most RATE_LIMIT_MAX messages within any
// RATE_LIMIT_WINDOW_MS sliding window. Defaults to 5 messages / 10s.
const RATE_LIMIT_MAX = toPositiveInt(process.env.RATE_LIMIT_MAX, 5);
const RATE_LIMIT_WINDOW_MS = toPositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 10000);

// Banned words are masked (not blocked) in message text. Configure with a
// comma-separated BANNED_WORDS env var, e.g. BANNED_WORDS="spam,foo".
const BANNED_WORDS = parseList(process.env.BANNED_WORDS);

// Cross-Site WebSocket Hijacking guard: browsers may only open the socket from
// these origins. Empty (default) means "same origin as the page is served on";
// set ALLOWED_ORIGINS to a comma-separated list to allow specific origins.
const ALLOWED_ORIGINS = parseList(process.env.ALLOWED_ORIGINS);

// Characters we strip from any user-supplied string before storing it:
//   - C0/C1 control chars (incl. NUL, which can truncate strings in C layers),
//   - zero-width / BOM characters (used to slip past word filters invisibly),
//   - bidirectional-override chars (used to spoof how text renders).
// This is input hygiene; it is NOT the XSS defense (see note below).
const STRIP_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

// Build one case-insensitive matcher for all banned words. Each word is
// regex-escaped so punctuation in the config can't inject a pattern or cause
// catastrophic backtracking (ReDoS).
function buildBannedPattern(words) {
	if (!words.length) {
		return null;
	}
	const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(escaped.join('|'), 'gi');
}

const bannedPattern = buildBannedPattern(BANNED_WORDS);

// Replace every banned-word match with same-length asterisks, so "badword"
// becomes "*******" and message layout is preserved.
function maskBannedWords(text) {
	if (!bannedPattern) {
		return text;
	}
	return text.replace(bannedPattern, (match) => '*'.repeat(match.length));
}

// --- Persistence -----------------------------------------------------------

const db = new Database(DB_PATH);
// locking_mode must be set before journal_mode=WAL so that, on a filesystem
// without shared-memory support (EFS/NFS), the wal-index can live in heap
// memory rather than a memory-mapped -shm file.
if (SQLITE_LOCKING_MODE === 'EXCLUSIVE' || SQLITE_LOCKING_MODE === 'NORMAL') {
	db.pragma(`locking_mode = ${SQLITE_LOCKING_MODE}`);
}
db.pragma('journal_mode = WAL');
db.exec(`
	CREATE TABLE IF NOT EXISTS messages (
		id   INTEGER PRIMARY KEY AUTOINCREMENT,
		room TEXT    NOT NULL,
		name TEXT    NOT NULL,
		text TEXT    NOT NULL,
		ts   INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages (room, id);
`);

const insertStmt = db.prepare('INSERT INTO messages (room, name, text, ts) VALUES (?, ?, ?, ?)');
const historyStmt = db.prepare('SELECT id, name, text, ts FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?');
// Keep only the newest HISTORY_LIMIT rows for a room; drop anything older.
const pruneStmt = db.prepare(`
	DELETE FROM messages
	WHERE room = ? AND id NOT IN (
		SELECT id FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?
	)
`);

// Admin-API queries: a per-room summary of what's stored, and a room wipe.
const roomStatsStmt = db.prepare(
	'SELECT room, COUNT(*) AS count, MAX(ts) AS lastTs FROM messages GROUP BY room ORDER BY count DESC, room ASC'
);
const clearRoomStmt = db.prepare('DELETE FROM messages WHERE room = ?');

// Persist a chat message and return the stored row as a broadcastable payload.
function persistMessage(room, name, text, ts) {
	const info = insertStmt.run(room, name, text, ts);
	pruneStmt.run(room, room, HISTORY_LIMIT);
	return { id: Number(info.lastInsertRowid), type: 'message', room, name, text, ts };
}

// Load a room's recent backlog, oldest first, ready to replay to a client.
function loadHistory(room) {
	const rows = historyStmt.all(room, HISTORY_LIMIT);
	rows.reverse();
	return rows.map((row) => ({
		id: row.id,
		type: 'message',
		room,
		name: row.name,
		text: row.text,
		ts: row.ts,
	}));
}

// --- HTTP + WebSocket server ----------------------------------------------

const app = express();

// Security headers for every static response. The strict Content-Security-Policy
// is defense-in-depth against XSS: even if a tag somehow reached the DOM, the
// browser would refuse to run inline or third-party scripts. (The page loads
// only its own same-origin client.js / styles.css, so 'self' is sufficient.)
app.use((req, res, next) => {
	res.setHeader(
		'Content-Security-Policy',
		[
			"default-src 'self'",
			"script-src 'self'",
			"style-src 'self'",
			"img-src 'self' data:",
			// The page opens its WebSocket back to its own origin.
			"connect-src 'self' ws: wss:",
			"base-uri 'none'",
			"form-action 'self'",
			"frame-ancestors 'none'",
		].join('; ')
	);
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'no-referrer');
	next();
});

// --- Operational & admin endpoints -----------------------------------------

// Liveness/readiness probe for load balancers and orchestrators. Unauthenticated
// (it reveals nothing) and independent of the static files, so a health check
// passes as soon as the process is accepting requests.
app.get('/healthz', (req, res) => {
	res.type('text/plain').send('ok');
});

// Bearer-token gate for the admin API. The token comes from ADMIN_TOKEN (a
// secret in deployments); when it is unset the API is disabled. Comparison is
// constant-time so a wrong guess can't be narrowed down by timing.
function requireAdmin(req, res) {
	if (!ADMIN_TOKEN) {
		res.status(503).json({ error: 'admin API disabled (ADMIN_TOKEN not set)' });
		return false;
	}
	const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
	const provided = Buffer.from(match ? match[1] : '');
	const expected = Buffer.from(ADMIN_TOKEN);
	if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
		res.status(401).json({ error: 'unauthorized' });
		return false;
	}
	return true;
}

// List every room that has stored history, with message counts. This is an
// operator view, so (unlike the public room list) it includes private DM rooms.
app.get('/admin/rooms', (req, res) => {
	if (!requireAdmin(req, res)) {
		return;
	}
	res.json({ rooms: roomStatsStmt.all() });
});

// Wipe one room's stored history (moderation). Live presence/system notices
// were never persisted, so only chat messages are affected. Anyone currently in
// the room is told; their already-rendered backlog simply stops being replayed
// to future joiners.
app.post('/admin/rooms/:room/clear', (req, res) => {
	if (!requireAdmin(req, res)) {
		return;
	}
	const room = req.params.room;
	const info = clearRoomStmt.run(room);
	broadcastToRoom(room, systemMessage(room, 'Room history was cleared by an administrator.'));
	res.json({ room, deleted: info.changes });
});

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// Decide whether a browser at `origin` may open the WebSocket. Requests with no
// Origin header (curl, native clients, same-process tests) are allowed; browser
// requests must match the page's own origin, or an entry in ALLOWED_ORIGINS.
function isAllowedOrigin(origin, host) {
	if (!origin) {
		return true;
	}
	if (ALLOWED_ORIGINS.length) {
		return ALLOWED_ORIGINS.includes(origin);
	}
	let originHost;
	try {
		originHost = new URL(origin).host;
	} catch {
		return false;
	}
	return Boolean(host) && originHost === host;
}

// Reject cross-origin upgrade attempts at the handshake (Cross-Site WebSocket
// Hijacking / CSRF defense) before any application message is processed.
const wss = new WebSocketServer({
	server,
	verifyClient(info, done) {
		if (isAllowedOrigin(info.origin, info.req.headers.host)) {
			done(true);
		} else {
			done(false, 403, 'Forbidden origin');
		}
	},
});

// System notices (joins / leaves) are live-only and never persisted, so they
// get ids from this counter rather than the database.
let nextSystemId = 1;

// --- Rate limiting ---------------------------------------------------------
// Sliding-window counter keyed by (room, user): we keep the timestamps of a
// user's recent messages in a room and reject once RATE_LIMIT_MAX of them fall
// inside the RATE_LIMIT_WINDOW_MS window. Scoping by room means a noisy DM
// can't starve someone's posting in #general.
const messageTimes = new Map();

function rateLimitKey(room, name) {
	// NUL can't appear in sanitized input, so it's a safe key separator.
	return room + ' ' + name;
}

// Record an attempt and report whether it's within the limit.
function allowMessage(room, name) {
	const now = Date.now();
	const key = rateLimitKey(room, name);
	const recent = (messageTimes.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
	if (recent.length >= RATE_LIMIT_MAX) {
		messageTimes.set(key, recent);
		return false;
	}
	recent.push(now);
	messageTimes.set(key, recent);
	return true;
}

// Periodically drop windows that have fully expired so the map can't grow
// without bound as users come and go. Unref'd so it never holds the process up.
setInterval(() => {
	const now = Date.now();
	for (const [key, times] of messageTimes) {
		const live = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
		if (live.length) {
			messageTimes.set(key, live);
		} else {
			messageTimes.delete(key);
		}
	}
}, RATE_LIMIT_WINDOW_MS).unref();

// Clean any user-supplied string: drop control / invisible / bidi characters,
// normalize Unicode (so look-alike encodings collapse), trim, and cap length.
function sanitize(value, maxLength) {
	if (typeof value !== 'string') {
		return '';
	}
	return value
		.replace(STRIP_CHARS, '')
		.normalize('NFC')
		.trim()
		.slice(0, maxLength);
}

// Normalize a room name: strip a leading "#", trim, cap length, default room.
function sanitizeRoom(value) {
	const room = sanitize(value, MAX_NAME_LENGTH).replace(/^#+/, '').trim();
	return room || DEFAULT_ROOM;
}

// Private (direct-message) rooms are ordinary rooms whose id encodes their two
// participants, so the server can check membership with no extra state and
// history still replays correctly after a restart:
//   dm:<encodedNameA>:<encodedNameB>   (names sorted, each URI-encoded)
const DM_PREFIX = 'dm:';

function isPrivateRoom(room) {
	return typeof room === 'string' && room.startsWith(DM_PREFIX);
}

// The two participant names of a private room, or null if the id is malformed.
function privateRoomMembers(room) {
	if (!isPrivateRoom(room)) {
		return null;
	}
	const parts = room.slice(DM_PREFIX.length).split(':');
	if (parts.length !== 2) {
		return null;
	}
	try {
		return parts.map(decodeURIComponent);
	} catch {
		return null;
	}
}

// Resolve the room a socket may enter. Public rooms are normalized; private
// rooms are validated so only their two named participants get in. Returns the
// room id to use, or null when access is denied.
function resolveRoom(socket, requested) {
	if (isPrivateRoom(requested)) {
		const members = privateRoomMembers(requested);
		if (!members || members.some((name) => name.length === 0 || name.length > MAX_NAME_LENGTH)) {
			return null;
		}
		if (!members.includes(socket.displayName)) {
			return null;
		}
		return requested;
	}
	return sanitizeRoom(requested);
}

// Wording for a join/leave notice; DM rooms read as a private conversation
// rather than exposing their (ugly, encoded) room id.
function presenceText(name, room, verb) {
	return isPrivateRoom(room)
		? `${name} ${verb} the conversation`
		: `${name} ${verb} #${room}`;
}

// Send a payload to every joined client currently in `room`.
function broadcastToRoom(room, payload) {
	const data = JSON.stringify(payload);
	for (const client of wss.clients) {
		if (client.readyState === client.OPEN && client.room === room) {
			client.send(data);
		}
	}
}

// Send a payload to every connected client, regardless of room.
function broadcastAll(payload) {
	const data = JSON.stringify(payload);
	for (const client of wss.clients) {
		if (client.readyState === client.OPEN) {
			client.send(data);
		}
	}
}

function systemMessage(room, text) {
	return { id: nextSystemId++, type: 'system', room, text, ts: Date.now() };
}

// The set of rooms that currently have at least one joined user, with counts.
function activeRooms() {
	const counts = new Map();
	for (const client of wss.clients) {
		// Private DM rooms are never advertised in the public room list.
		if (
			client.readyState === client.OPEN &&
			client.displayName &&
			client.room &&
			!isPrivateRoom(client.room)
		) {
			counts.set(client.room, (counts.get(client.room) || 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function broadcastRoomList() {
	broadcastAll({ type: 'rooms', rooms: activeRooms() });
}

// Replay a room's history to one client and announce the arrival to that room.
function enterRoom(socket, room) {
	socket.room = room;
	socket.send(JSON.stringify({ type: 'history', room, messages: loadHistory(room) }));
	broadcastToRoom(room, systemMessage(room, presenceText(socket.displayName, room, 'joined')));
}

// Let the other participant know a DM arrived even when they are not currently
// viewing that conversation, so their client can surface it (those already in
// the room receive the message itself and need no separate notice).
function notifyDmRecipient(sender, message) {
	const members = privateRoomMembers(message.room);
	if (!members) {
		return;
	}
	const recipientName = members.find((name) => name !== sender.displayName);
	if (!recipientName) {
		return;
	}
	const data = JSON.stringify({ type: 'dm-notice', room: message.room, from: sender.displayName });
	for (const client of wss.clients) {
		if (
			client.readyState === client.OPEN &&
			client.displayName === recipientName &&
			client.room !== message.room
		) {
			client.send(data);
		}
	}
}

wss.on('connection', (socket) => {
	// A connection is "unnamed" until it sends a valid join.
	socket.displayName = null;
	socket.room = null;

	// New connections immediately learn which rooms are active.
	socket.send(JSON.stringify({ type: 'rooms', rooms: activeRooms() }));

	socket.on('message', (raw) => {
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return;
		}

		if (parsed.type === 'join') {
			const name = sanitize(parsed.name, MAX_NAME_LENGTH);
			if (!name) {
				return;
			}
			socket.displayName = name;
			// A bad/unauthorized room (e.g. someone else's DM) falls back to the
			// default room rather than being honored.
			enterRoom(socket, resolveRoom(socket, parsed.room) || DEFAULT_ROOM);
			broadcastRoomList();
			return;
		}

		if (parsed.type === 'switch') {
			// Only joined clients can move between rooms.
			if (!socket.displayName) {
				return;
			}
			const target = resolveRoom(socket, parsed.room);
			if (target === null || target === socket.room) {
				return;
			}
			const previous = socket.room;
			broadcastToRoom(previous, systemMessage(previous, presenceText(socket.displayName, previous, 'left')));
			enterRoom(socket, target);
			broadcastRoomList();
			return;
		}

		if (parsed.type === 'message') {
			// Ignore chatter from clients that never joined a room.
			if (!socket.displayName || !socket.room) {
				return;
			}
			// Sanitize and apply the word filter before anything else, so empty
			// (e.g. whitespace-only) messages are dropped without using up quota.
			const text = maskBannedWords(sanitize(parsed.text, MAX_MESSAGE_LENGTH));
			if (!text) {
				return;
			}
			// Throttle: tell the sender (privately) when they're over the limit
			// instead of broadcasting their message.
			if (!allowMessage(socket.room, socket.displayName)) {
				socket.send(JSON.stringify(
					systemMessage(socket.room, 'You are sending messages too quickly. Please slow down.')
				));
				return;
			}
			const message = persistMessage(socket.room, socket.displayName, text, Date.now());
			broadcastToRoom(socket.room, message);
			if (isPrivateRoom(socket.room)) {
				notifyDmRecipient(socket, message);
			}
		}
	});

	socket.on('close', () => {
		if (!socket.displayName || !socket.room) {
			return;
		}
		broadcastToRoom(socket.room, systemMessage(socket.room, presenceText(socket.displayName, socket.room, 'left')));
		broadcastRoomList();
	});
});

// Keep WebSocket connections alive through idle timeouts in any proxy in front
// of us (load balancers, CDNs commonly cut idle sockets after ~60s). A periodic
// ping keeps the link active; browsers answer pongs automatically. Unref'd so
// it never holds the process open.
const heartbeat = setInterval(() => {
	for (const client of wss.clients) {
		if (client.readyState === client.OPEN) {
			client.ping();
		}
	}
}, 30000);
heartbeat.unref();

server.listen(PORT, () => {
	console.log(`Chat server listening on http://localhost:${PORT}`);
});

// Shut down cleanly on the signals orchestrators send (ECS sends SIGTERM before
// stopping a task). Closing the database checkpoints the WAL back into the main
// file, so a redeploy never loses recently written history.
let shuttingDown = false;
function shutdown(signal) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	console.log(`Received ${signal}, shutting down.`);
	clearInterval(heartbeat);
	for (const client of wss.clients) {
		try {
			client.close(1001, 'Server shutting down');
		} catch {
			// ignore sockets that are already gone
		}
	}
	server.close(() => {
		try {
			db.close();
		} catch {
			// ignore double-close
		}
		process.exit(0);
	});
	// Don't hang forever if a connection refuses to drain.
	setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
