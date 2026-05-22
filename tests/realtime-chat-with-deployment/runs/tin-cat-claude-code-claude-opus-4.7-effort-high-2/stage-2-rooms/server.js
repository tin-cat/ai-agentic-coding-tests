'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const Database = require('better-sqlite3');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'chat.db');

// How many chat messages we keep (and replay) per room.
const HISTORY_LIMIT = 200;
const DEFAULT_ROOM = 'general';

// --- Persistence -----------------------------------------------------------

const db = new Database(DB_PATH);
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
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// System notices (joins / leaves) are live-only and never persisted, so they
// get ids from this counter rather than the database.
let nextSystemId = 1;

function sanitize(value, maxLength) {
	if (typeof value !== 'string') {
		return '';
	}
	return value.trim().slice(0, maxLength);
}

// Normalize a room name: strip a leading "#", trim, cap length, default room.
function sanitizeRoom(value) {
	const room = sanitize(value, 40).replace(/^#+/, '').trim();
	return room || DEFAULT_ROOM;
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
		if (client.readyState === client.OPEN && client.displayName && client.room) {
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
	broadcastToRoom(room, systemMessage(room, `${socket.displayName} joined #${room}`));
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
			const name = sanitize(parsed.name, 40);
			if (!name) {
				return;
			}
			socket.displayName = name;
			enterRoom(socket, sanitizeRoom(parsed.room));
			broadcastRoomList();
			return;
		}

		if (parsed.type === 'switch') {
			// Only joined clients can move between rooms.
			if (!socket.displayName) {
				return;
			}
			const target = sanitizeRoom(parsed.room);
			if (target === socket.room) {
				return;
			}
			const previous = socket.room;
			broadcastToRoom(previous, systemMessage(previous, `${socket.displayName} left #${previous}`));
			enterRoom(socket, target);
			broadcastRoomList();
			return;
		}

		if (parsed.type === 'message') {
			// Ignore chatter from clients that never joined a room.
			if (!socket.displayName || !socket.room) {
				return;
			}
			const text = sanitize(parsed.text, 2000);
			if (!text) {
				return;
			}
			const message = persistMessage(socket.room, socket.displayName, text, Date.now());
			broadcastToRoom(socket.room, message);
		}
	});

	socket.on('close', () => {
		if (!socket.displayName || !socket.room) {
			return;
		}
		broadcastToRoom(socket.room, systemMessage(socket.room, `${socket.displayName} left #${socket.room}`));
		broadcastRoomList();
	});
});

server.listen(PORT, () => {
	console.log(`Chat server listening on http://localhost:${PORT}`);
});
