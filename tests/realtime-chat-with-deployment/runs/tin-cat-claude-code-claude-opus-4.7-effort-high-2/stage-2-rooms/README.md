# Real-Time Chat

A minimal real-time chat app with named rooms. Open the page, pick a display
name, and you join the room named in the URL hash (`#general` by default).
Messages are scoped to a room and broadcast over WebSockets to everyone in that
room. The most recent 200 messages per room are persisted to SQLite, so history
survives a server restart and is replayed to anyone who joins.

## What this is about

This is a deliberately small, dependency-light chat app meant to be easy to read
and run. There are no accounts. Rooms are created on demand simply by visiting a
hash (`#design`, `#random`, …); the sidebar lists every room that currently has
people in it, with a live user count, and you can switch rooms without reloading
the page.

## Tech stack

- **Node.js** (>= 18) as the runtime.
- **Express** serves the static client files.
- **ws** provides the WebSocket server, attached to the same HTTP server Express
  runs on (so one port serves both the page and the socket).
- **better-sqlite3** persists per-room message history to a local SQLite file.
- **Vanilla HTML/CSS/JavaScript** on the client — no build step, no framework.

## Code structure

```
.
├── server.js           # Express static server + WebSocket server + SQLite persistence
├── chat.db             # SQLite message store (created at runtime, git-ignored)
├── package.json        # Dependencies and the `start` script
└── public/             # The web client (served as static files)
    ├── index.html      # Page shell: name prompt, rooms sidebar, message list, composer
    ├── styles.css      # Sidebar + chat layout and theme
    └── client.js       # WebSocket connection, room/hash routing, rendering
```

### How it works

- On startup, `server.js` serves everything under `public/`, opens a WebSocket
  server on the same port, and opens (or creates) the `chat.db` SQLite database.
- The client reads the room name from `location.hash` (defaulting to `general`),
  connects, then sends a `join` message with the display name and that room.
- The server replays that room's recent backlog (up to 200 messages, loaded from
  SQLite) to the joining client only, then broadcasts a `"… joined #room"` system
  notice to everyone **in that room**.
- When a client sends a `message`, the server stamps it with the sender's name
  and a timestamp, inserts it into SQLite (pruning the room back to its newest
  200 rows), and broadcasts it to everyone in the same room.
- Changing the hash — by clicking a room in the sidebar, typing one into the
  "New room" box, or editing the URL — sends a `switch` message. The server moves
  the socket to the new room, replays that room's history, and announces the
  move. No page reload happens.
- The server tracks which rooms currently have joined users and broadcasts a
  `rooms` list (name + user count) whenever membership changes; the sidebar
  renders it and highlights the current room.
- On disconnect, a `"… left #room"` system notice is broadcast to that room.

System notices (joins / leaves) are live-only and are **not** persisted — only
chat messages are stored, so a restart replays conversation rather than session
churn. All message text is rendered with `textContent` on the client, so user
input is never interpreted as HTML.

### Message protocol

Messages are JSON sent over the WebSocket.

Client → server:

```jsonc
{ "type": "join", "name": "Ada", "room": "general" }
{ "type": "message", "text": "Hello, everyone!" }
{ "type": "switch", "room": "design" }
```

Server → client:

```jsonc
{ "type": "rooms", "rooms": [ { "name": "general", "count": 3 } ] }
{ "type": "history", "room": "general", "messages": [ /* recent message objects */ ] }
{ "type": "message", "id": 7, "room": "general", "name": "Ada", "text": "Hi", "ts": 1700000000000 }
{ "type": "system", "id": 8, "room": "general", "text": "Ada joined #general", "ts": 1700000000000 }
```

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:3000> in a couple of browser tabs (or on different
devices on your network) and watch messages broadcast between them. Open
<http://localhost:3000/#design> in one tab and `#random` in another to see room
scoping in action.

The port and database location are configurable with environment variables:

```bash
PORT=8080 DB_PATH=/var/data/chat.db npm start
```

`DB_PATH` defaults to `chat.db` in the project directory. The file (and its
`-wal`/`-shm` companions) is created on first run and is git-ignored.

## Contributing

1. Fork and clone the repository.
2. `npm install` to pull dependencies.
3. `npm start` and develop against <http://localhost:3000>.

Some ideas worth adding: typing indicators, a per-room online-user list, message
rate limiting, or private/direct messages. Keep the client dependency-free where
reasonable, and keep `server.js` readable — the project's value is in being a
small, complete example.
