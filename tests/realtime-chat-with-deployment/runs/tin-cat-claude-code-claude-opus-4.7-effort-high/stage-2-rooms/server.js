'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { saveMessage, recentMessages } = require('./db');

const PORT = process.env.PORT || 3000;
const DEFAULT_ROOM = 'lobby';

let nextSystemId = -1; // System notices use negative ids so they never collide
                       // with the positive, DB-assigned ids of chat messages.

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function sanitize(value, maxLength) {
	if (typeof value !== 'string') {
		return '';
	}
	return value.trim().slice(0, maxLength);
}

// Canonical room name: lowercase, only [a-z0-9-], collapsed dashes, capped.
// This is the same shape a URL hash (#my-room) takes, so the client's hash and
// the server's room key always agree. Empty/garbage falls back to the lobby.
function normalizeRoom(value) {
	const slug = sanitize(value, 60)
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/g, '');
	return slug || DEFAULT_ROOM;
}

// Send a payload to one socket if it's still open.
function sendTo(socket, payload) {
	if (socket.readyState === socket.OPEN) {
		socket.send(JSON.stringify(payload));
	}
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

// All rooms that currently have at least one joined client, with head counts,
// sorted by name. This is what populates the room list on every client.
function roomSummary() {
	const counts = new Map();
	for (const client of wss.clients) {
		if (client.displayName && client.room) {
			counts.set(client.room, (counts.get(client.room) || 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([name, users]) => ({ name, users }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function broadcastRoomList() {
	const payload = JSON.stringify({ type: 'rooms', rooms: roomSummary() });
	for (const client of wss.clients) {
		if (client.readyState === client.OPEN) {
			client.send(payload);
		}
	}
}

function systemNotice(room, text) {
	return { id: nextSystemId--, type: 'system', room, text, ts: Date.now() };
}

// Place a freshly-joined (or switching) socket into a room: replay that room's
// stored history to it, then announce the arrival to the room.
function enterRoom(socket, room) {
	socket.room = room;
	sendTo(socket, { type: 'history', room, messages: recentMessages(room) });
	broadcastToRoom(room, systemNotice(room, `${socket.displayName} joined ${room}`));
}

wss.on('connection', (socket) => {
	// A connection is "unnamed" (and roomless) until it sends a valid join.
	socket.displayName = null;
	socket.room = null;

	socket.on('message', (raw) => {
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return;
		}

		// First message must be a join: it sets the name and the initial room.
		if (parsed.type === 'join') {
			const name = sanitize(parsed.name, 40);
			if (!name || socket.displayName) {
				return;
			}
			socket.displayName = name;
			enterRoom(socket, normalizeRoom(parsed.room));
			broadcastRoomList();
			return;
		}

		// Everything past here requires a joined connection.
		if (!socket.displayName) {
			return;
		}

		// Move to another room without reconnecting: leave the old, enter the new.
		if (parsed.type === 'switch') {
			const target = normalizeRoom(parsed.room);
			if (target === socket.room) {
				return;
			}
			const previous = socket.room;
			broadcastToRoom(previous, systemNotice(previous, `${socket.displayName} left ${previous}`));
			enterRoom(socket, target);
			broadcastRoomList();
			return;
		}

		if (parsed.type === 'message') {
			const text = sanitize(parsed.text, 2000);
			if (!text) {
				return;
			}
			const stored = saveMessage(socket.room, socket.displayName, text, Date.now());
			broadcastToRoom(socket.room, stored);
		}
	});

	socket.on('close', () => {
		if (!socket.displayName || !socket.room) {
			return;
		}
		broadcastToRoom(socket.room, systemNotice(socket.room, `${socket.displayName} left ${socket.room}`));
		broadcastRoomList();
	});
});

server.listen(PORT, () => {
	console.log(`Chat server listening on http://localhost:${PORT}`);
});
