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
const dmList = document.getElementById('dm-list');
const dmForm = document.getElementById('dm-form');
const dmInput = document.getElementById('dm-input');

let socket = null;
let displayName = '';

// Public rooms are driven by the URL hash (#room-name); private DM rooms are a
// session-only view kept off the URL.
let currentRoom = roomFromHash();
// Latest active-room list from the server, kept so we can re-render on switch.
let knownRooms = [];
// Direct-message conversations opened this session: room id -> { name, unread }.
const openDms = new Map();

const DM_PREFIX = 'dm:';

function isPrivateRoom(room) {
	return typeof room === 'string' && room.startsWith(DM_PREFIX);
}

// Build a DM room id from two names. Must match the server: names sorted by
// code-unit order (locale-independent, so both participants converge) and each
// URI-encoded so ':' stays a safe separator.
function privateRoomId(a, b) {
	const pair = a <= b ? [a, b] : [b, a];
	return DM_PREFIX + pair.map(encodeURIComponent).join(':');
}

// The other participant's name for a DM room id (used as its label).
function dmCounterpart(room) {
	if (!isPrivateRoom(room)) {
		return null;
	}
	const parts = room.slice(DM_PREFIX.length).split(':');
	if (parts.length !== 2) {
		return null;
	}
	let names;
	try {
		names = parts.map(decodeURIComponent);
	} catch {
		return null;
	}
	return names.find((name) => name !== displayName) || names[0];
}

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
	// Keep the room we're viewing visible even if we're its only occupant, but
	// never list a private DM room here (DMs live in their own section).
	if (!isPrivateRoom(currentRoom) && !counts.has(currentRoom)) {
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

// Enter a room (public or private): update the view, ask the server to move us,
// and mirror public rooms in the URL hash for shareable links.
function enterRoomView(room) {
	if (!room || room === currentRoom) {
		return;
	}
	currentRoom = room;
	if (isPrivateRoom(room)) {
		const dm = openDms.get(room);
		if (dm) {
			dm.unread = false;
		}
	}
	applyCurrentRoom();
	renderRooms();
	renderDms();
	// Clear the view; the server will replay the new room's history.
	messages.innerHTML = '';
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify({ type: 'switch', room: currentRoom }));
	}
	if (!isPrivateRoom(room)) {
		const encoded = encodeURIComponent(room);
		if (location.hash.replace(/^#/, '') !== encoded) {
			location.hash = encoded;
		}
	}
}

// Switch to a public room. Normally we just update the hash and let the
// hashchange handler do the work, but if the hash already matches (e.g. we're
// returning from a DM to the room named in the URL) we enter directly.
function switchRoom(room) {
	const target = (room || '').trim().slice(0, 40);
	if (!target || target === currentRoom) {
		return;
	}
	const encoded = encodeURIComponent(target);
	if (location.hash.replace(/^#/, '') === encoded) {
		enterRoomView(target);
	} else {
		location.hash = encoded;
	}
}

// Open (or jump to) a direct-message conversation with another user.
function openDirectMessage(name) {
	const target = (name || '').trim().slice(0, 40);
	if (!target || target === displayName) {
		return;
	}
	const room = privateRoomId(displayName, target);
	rememberDm(room);
	enterRoomView(room);
}

// Track a DM in the sidebar list, marking it unread unless we're viewing it.
function rememberDm(room, unread = false) {
	const existing = openDms.get(room);
	if (existing) {
		if (unread) {
			existing.unread = true;
		}
	} else {
		openDms.set(room, { name: dmCounterpart(room), unread });
	}
	renderDms();
}

function applyCurrentRoom() {
	const label = isPrivateRoom(currentRoom) ? '@' + dmCounterpart(currentRoom) : '#' + currentRoom;
	roomTitle.textContent = label;
	joinRoom.textContent = '#' + (isPrivateRoom(currentRoom) ? DEFAULT_ROOM : currentRoom);
	document.title = `${label} · Chat`;
}

// Render the list of open DM conversations, highlighting the active one.
function renderDms() {
	dmList.innerHTML = '';
	for (const [room, info] of openDms) {
		const li = document.createElement('li');
		li.className = 'room' + (room === currentRoom ? ' active' : '');

		const label = document.createElement('span');
		label.className = 'room-name';
		label.textContent = '@' + info.name;

		li.append(label);
		if (info.unread && room !== currentRoom) {
			const dot = document.createElement('span');
			dot.className = 'unread-dot';
			li.append(dot);
		}
		li.addEventListener('click', () => enterRoomView(room));
		dmList.append(li);
	}
}

window.addEventListener('hashchange', () => {
	enterRoomView(roomFromHash());
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

		// A DM arrived while we were elsewhere: surface it in the sidebar.
		if (payload.type === 'dm-notice') {
			rememberDm(payload.room, payload.room !== currentRoom);
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

dmForm.addEventListener('submit', (event) => {
	event.preventDefault();
	openDirectMessage(dmInput.value);
	dmInput.value = '';
});

// Reflect the starting room before the user has connected.
applyCurrentRoom();
renderRooms();
renderDms();
