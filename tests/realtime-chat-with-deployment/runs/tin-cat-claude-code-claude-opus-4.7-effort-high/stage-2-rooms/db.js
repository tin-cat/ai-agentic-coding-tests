'use strict';

const path = require('path');

// node:sqlite is built in, but on Node 22.x it's gated behind the
// --experimental-sqlite flag (which `npm start` passes). Fail loudly with a
// fix-it hint rather than a cryptic "unknown built-in module" if it's missing.
let DatabaseSync;
try {
	({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
	console.error(
		"Couldn't load node:sqlite. Use Node >= 22.5 and start with " +
		'`npm start` (it passes --experimental-sqlite).'
	);
	throw err;
}

// How many chat messages we keep per room. Older ones are pruned on insert,
// so each room's table footprint stays bounded no matter how busy it gets.
const PER_ROOM_LIMIT = 200;

// One file on disk; override with DB_PATH for tests or alternate deploys.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'chat.db');

const db = new DatabaseSync(DB_PATH);

// WAL keeps reads and the single writer from blocking each other, which is
// plenty for a chat server's modest write rate.
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
	CREATE TABLE IF NOT EXISTS messages (
		id   INTEGER PRIMARY KEY AUTOINCREMENT,
		room TEXT    NOT NULL,
		name TEXT    NOT NULL,
		text TEXT    NOT NULL,
		ts   INTEGER NOT NULL
	)
`);
// Fetching one room's recent history is the hot path, so index by (room, id).
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages (room, id)');

const insertStmt = db.prepare(
	'INSERT INTO messages (room, name, text, ts) VALUES (?, ?, ?, ?)'
);

// Delete everything in a room except its most recent PER_ROOM_LIMIT rows.
const pruneStmt = db.prepare(`
	DELETE FROM messages
	WHERE room = ?
	  AND id NOT IN (
		SELECT id FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?
	  )
`);

const recentStmt = db.prepare(`
	SELECT id, name, text, ts FROM messages
	WHERE room = ?
	ORDER BY id DESC
	LIMIT ?
`);

// Persist a chat message and return the stored row (with its assigned id).
// Only real chat messages are stored; transient join/leave notices are not,
// since "X left the room" is meaningless once replayed after a restart.
function saveMessage(room, name, text, ts) {
	const info = insertStmt.run(room, name, text, ts);
	pruneStmt.run(room, room, PER_ROOM_LIMIT);
	return {
		id: Number(info.lastInsertRowid),
		type: 'message',
		room,
		name,
		text,
		ts,
	};
}

// The last PER_ROOM_LIMIT messages for a room, oldest first (ready to replay).
function recentMessages(room) {
	const rows = recentStmt.all(room, PER_ROOM_LIMIT);
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

module.exports = { saveMessage, recentMessages, PER_ROOM_LIMIT, DB_PATH };
