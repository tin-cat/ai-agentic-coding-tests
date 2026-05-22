'use strict';

const DEFAULT_ROOM = 'general';

const joinOverlay = document.getElementById('join-overlay');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const joinRoom = document.getElementById('join-room');

const app = document.getElementById('app');
const messages = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const status = document.getElementById('connection-status');
const roomTitle = document.getElementById('room-title');
const roomList = document.getElementById('room-list');
const roomForm = document.getElementById('room-form');
const roomInput = document.getElementById('room-input');

let socket = null;
let displayName = '';

// The room is driven entirely by the URL hash (#room-name).
let currentRoom = roomFromHash();
// Latest active-room list from the server, kept so we can re-render on switch.
let knownRooms = [];

// Read and normalize the room name from location.hash, with a default.
function roomFromHash() {
	let raw = '';
	try {
		raw = decodeURIComponent(location.hash.replace(/^#/, ''));
	} catch {
		raw = location.hash.replace(/^#/, '');
	}
	return raw.trim().slice(0, 40) || DEFAULT_ROOM;
}

function setStatus(text, state) {
	status.textContent = text;
	status.className = 'status' + (state ? ' ' + state : '');
}

function setComposerEnabled(enabled) {
	messageInput.disabled = !enabled;
	sendButton.disabled = !enabled;
}

// True when the list is scrolled (near) the bottom, so we only auto-scroll
// when the user is already following the live conversation.
function isAtBottom() {
	const threshold = 60;
	return messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
}

function scrollToBottom() {
	messages.scrollTop = messages.scrollHeight;
}

function formatTime(ts) {
	return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(message) {
	const li = document.createElement('li');

	if (message.type === 'system') {
		li.className = 'system';
		li.textContent = message.text;
		return li;
	}

	li.className = 'message' + (message.name === displayName ? ' own' : '');

	const meta = document.createElement('div');
	meta.className = 'meta';

	const author = document.createElement('span');
	author.className = 'author';
	author.textContent = message.name;

	const time = document.createElement('span');
	time.className = 'time';
	time.textContent = formatTime(message.ts);

	meta.append(author, time);

	// textContent keeps user input inert — no HTML injection.
	const text = document.createElement('div');
	text.className = 'text';
	text.textContent = message.text;

	li.append(meta, text);
	return li;
}

function appendMessage(message) {
	const stick = isAtBottom();
	messages.append(renderMessage(message));
	if (stick) {
		scrollToBottom();
	}
}

// Render the room list, always including the current room and highlighting it.
function renderRooms() {
	const counts = new Map();
	for (const room of knownRooms) {
		counts.set(room.name, room.count);
	}
	if (!counts.has(currentRoom)) {
		counts.set(currentRoom, 0);
	}

	const list = [...counts.entries()].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
	);

	roomList.innerHTML = '';
	for (const [name, count] of list) {
		const li = document.createElement('li');
		li.className = 'room' + (name === currentRoom ? ' active' : '');

		const label = document.createElement('span');
		label.className = 'room-name';
		label.textContent = '#' + name;

		const badge = document.createElement('span');
		badge.className = 'room-count';
		badge.textContent = String(count);

		li.append(label, badge);
		li.addEventListener('click', () => switchRoom(name));
		roomList.append(li);
	}
}

// Switch rooms by updating the hash; the hashchange handler does the rest.
function switchRoom(room) {
	const target = (room || '').trim().slice(0, 40);
	if (!target || target === currentRoom) {
		return;
	}
	location.hash = encodeURIComponent(target);
}

function applyCurrentRoom() {
	roomTitle.textContent = '#' + currentRoom;
	joinRoom.textContent = '#' + currentRoom;
	document.title = `#${currentRoom} · Chat`;
}

window.addEventListener('hashchange', () => {
	const room = roomFromHash();
	if (room === currentRoom) {
		return;
	}
	currentRoom = room;
	applyCurrentRoom();
	renderRooms();
	// Clear the view; the server will replay the new room's history.
	messages.innerHTML = '';
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify({ type: 'switch', room: currentRoom }));
	}
});

function connect() {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	socket = new WebSocket(`${protocol}//${location.host}`);

	socket.addEventListener('open', () => {
		setStatus('online', 'online');
		setComposerEnabled(true);
		// Join (or, after a reconnect, rejoin) whichever room the hash names now.
		socket.send(JSON.stringify({ type: 'join', name: displayName, room: currentRoom }));
	});

	socket.addEventListener('message', (event) => {
		let payload;
		try {
			payload = JSON.parse(event.data);
		} catch {
			return;
		}

		if (payload.type === 'rooms') {
			knownRooms = payload.rooms;
			renderRooms();
			return;
		}

		if (payload.type === 'history') {
			// Ignore history for a room we've already switched away from.
			if (payload.room !== currentRoom) {
				return;
			}
			messages.innerHTML = '';
			for (const message of payload.messages) {
				messages.append(renderMessage(message));
			}
			scrollToBottom();
			return;
		}

		// message / system: only render if it belongs to the room we're viewing.
		if (payload.room && payload.room !== currentRoom) {
			return;
		}
		appendMessage(payload);
	});

	socket.addEventListener('close', () => {
		setStatus('disconnected — reconnecting…', 'offline');
		setComposerEnabled(false);
		setTimeout(connect, 2000);
	});

	socket.addEventListener('error', () => {
		socket.close();
	});
}

joinForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const name = nameInput.value.trim();
	if (!name) {
		return;
	}
	displayName = name;
	joinOverlay.classList.add('hidden');
	app.classList.remove('hidden');
	messageInput.focus();
	connect();
});

messageForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const text = messageInput.value.trim();
	if (!text || !socket || socket.readyState !== WebSocket.OPEN) {
		return;
	}
	socket.send(JSON.stringify({ type: 'message', text }));
	messageInput.value = '';
	messageInput.focus();
});

roomForm.addEventListener('submit', (event) => {
	event.preventDefault();
	switchRoom(roomInput.value);
	roomInput.value = '';
});

// Reflect the starting room before the user has connected.
applyCurrentRoom();
renderRooms();
