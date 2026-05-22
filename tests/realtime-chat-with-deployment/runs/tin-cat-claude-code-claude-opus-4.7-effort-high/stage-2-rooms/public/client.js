'use strict';

const joinOverlay = document.getElementById('join-overlay');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const joinRoomLabel = document.getElementById('join-room');

const app = document.getElementById('app');
const roomList = document.getElementById('room-list');
const roomForm = document.getElementById('room-form');
const roomInput = document.getElementById('room-input');
const roomNameLabel = document.getElementById('room-name');

const messages = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const status = document.getElementById('connection-status');

const DEFAULT_ROOM = 'lobby';

let socket = null;
let displayName = '';
// The room the server currently has us in. Distinct from the URL hash so a
// hashchange we triggered ourselves doesn't bounce us into a redundant switch.
let activeRoom = '';

// Mirror the server's room-name rules so the hash, the room list, and what we
// send all agree on one canonical spelling.
function normalizeRoom(value) {
	const slug = String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/g, '');
	return slug || DEFAULT_ROOM;
}

// The room named by the current URL hash (#room-name), normalized.
function roomFromHash() {
	return normalizeRoom(decodeURIComponent(location.hash.replace(/^#/, '')));
}

// Write a room into the hash in canonical form. Returns true if the hash
// actually changed (which will fire a `hashchange`).
function setHashRoom(room) {
	const canonical = '#' + room;
	if (location.hash === canonical) {
		return false;
	}
	location.hash = canonical;
	return true;
}

function setStatus(text, state) {
	status.textContent = text;
	status.className = 'status' + (state ? ' ' + state : '');
}

function setComposerEnabled(enabled) {
	messageInput.disabled = !enabled;
	sendButton.disabled = !enabled;
}

function setRoomName(room) {
	roomNameLabel.textContent = room;
	document.title = `#${room} · Chat Rooms`;
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

function renderRoomList(rooms) {
	roomList.innerHTML = '';

	// The server only lists rooms with active users; make sure our own current
	// room is always present even in the brief gap before its count arrives.
	if (!rooms.some((room) => room.name === activeRoom) && activeRoom) {
		rooms = [...rooms, { name: activeRoom, users: 1 }].sort((a, b) =>
			a.name.localeCompare(b.name)
		);
	}

	for (const room of rooms) {
		const li = document.createElement('li');
		li.className = 'room' + (room.name === activeRoom ? ' active' : '');

		const name = document.createElement('span');
		name.className = 'room-name';
		name.textContent = '# ' + room.name;

		const count = document.createElement('span');
		count.className = 'room-count';
		count.textContent = room.users;
		count.title = room.users === 1 ? '1 person here' : `${room.users} people here`;

		li.append(name, count);
		li.addEventListener('click', () => switchRoom(room.name));
		roomList.append(li);
	}
}

// Switch rooms without reloading. We drive everything off the hash: update it,
// and the hashchange handler performs the actual move.
function switchRoom(room) {
	const target = normalizeRoom(room);
	if (target === activeRoom) {
		return;
	}
	if (!setHashRoom(target)) {
		// Hash already matched but we weren't in that room yet (e.g. initial
		// load); apply directly.
		applyRoom(target);
	}
}

// Tell the server to move us, and reset the view for the incoming history.
function applyRoom(room) {
	activeRoom = room;
	setRoomName(room);
	messages.innerHTML = '';
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify({ type: 'switch', room }));
	}
}

function connect() {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	socket = new WebSocket(`${protocol}//${location.host}`);

	socket.addEventListener('open', () => {
		setStatus('online', 'online');
		setComposerEnabled(true);
		// (Re)join straight into whatever room we're currently viewing.
		socket.send(JSON.stringify({ type: 'join', name: displayName, room: activeRoom }));
	});

	socket.addEventListener('message', (event) => {
		let payload;
		try {
			payload = JSON.parse(event.data);
		} catch {
			return;
		}

		if (payload.type === 'rooms') {
			renderRoomList(payload.rooms);
			return;
		}

		if (payload.type === 'history') {
			// Ignore stale history for a room we've already navigated away from.
			if (payload.room !== activeRoom) {
				return;
			}
			messages.innerHTML = '';
			for (const message of payload.messages) {
				messages.append(renderMessage(message));
			}
			scrollToBottom();
			return;
		}

		// Drop any chatter that isn't for the room we're looking at.
		if (payload.room && payload.room !== activeRoom) {
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

// Manual hash edits and room clicks both land here.
window.addEventListener('hashchange', () => {
	const room = roomFromHash();
	if (room !== activeRoom) {
		applyRoom(room);
	}
});

joinForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const name = nameInput.value.trim();
	if (!name) {
		return;
	}
	displayName = name;
	activeRoom = roomFromHash();
	setHashRoom(activeRoom); // canonicalize the URL (e.g. #Lobby -> #lobby)
	setRoomName(activeRoom);

	joinOverlay.classList.add('hidden');
	app.classList.remove('hidden');
	messageInput.focus();
	connect();
});

roomForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const target = roomInput.value.trim();
	if (!target) {
		return;
	}
	roomInput.value = '';
	switchRoom(target);
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

// Reflect the starting room in the join prompt before a name is chosen.
joinRoomLabel.textContent = '#' + roomFromHash();
