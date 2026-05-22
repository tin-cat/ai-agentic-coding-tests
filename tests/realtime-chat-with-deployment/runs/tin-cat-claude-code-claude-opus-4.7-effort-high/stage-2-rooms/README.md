# Real-Time Chat Rooms

A minimal real-time chat app with **named rooms**. Open the page, pick a display
name, and you land in whatever room the URL hash names (`#general`, `#random`, …)
or the `lobby` by default. Messages are scoped to a room and broadcast instantly
over WebSockets to everyone in that room. A live sidebar lists every room that
currently has people in it, and you can hop between rooms without reloading.
Each room's last 200 messages are persisted to SQLite, so history survives a
server restart.

## What this is about

This is a deliberately small, dependency-light chat app meant to be easy to read
and run. There are no accounts and no build step. The only persistence is a
single SQLite file written through Node's built-in `node:sqlite` module, so the
server has **no third-party runtime dependency for the database** — just Express
and `ws`.

## Tech stack

- **Node.js** (>= 22.5) as the runtime. The built-in `node:sqlite` module (added
  in 22.5) provides the database, so there's no native build step or extra
  dependency to install.
- **Express** serves the static client files.
- **ws** provides the WebSocket server, attached to the same HTTP server Express
  runs on (so one port serves both the page and the socket).
- **SQLite** (`node:sqlite`) persists messages per room.
- **Vanilla HTML/CSS/JavaScript** on the client — no build step, no framework.

## Rooms

- The **room is taken from the URL hash**: `…/#general` puts you in `general`.
  No hash means the `lobby`. Room names are normalized to lowercase
  `a-z 0-9 -` (spaces and other characters become dashes), so the hash, the
  sidebar, and the stored history all agree on one spelling.
- The **sidebar lists every room that currently has at least one person in it**,
  with a live head count. Click a room to switch to it.
- Type a name into the **"Go to room…"** box to jump to (or create) any room,
  even an empty one.
- **Switching rooms never reloads the page.** Selecting a room updates the hash;
  the client tells the server to move you, clears the view, and replays the new
  room's history. Editing the hash by hand (or using the browser's back/forward
  buttons) switches rooms too.

## Persistence

- Chat messages are written to a SQLite file (`chat.db` by default; override with
  the `DB_PATH` environment variable).
- Only the **last 200 messages per room** are kept — older rows are pruned on
  every insert, so the file stays bounded.
- Join/leave notices are **not** stored. They're live session events; replaying
  "Ada left general" after a restart would be misleading. They broadcast to the
  room in real time but never persist.
- When you join or switch into a room, the server replays that room's stored
  history to you alone, then announces your arrival to the room.

## Code structure

```
.
├── server.js           # Express static server + WebSocket server + room routing
├── db.js               # SQLite (node:sqlite): save / fetch-recent / prune per room
├── package.json        # Dependencies and the `start` script
└── public/             # The web client (served as static files)
    ├── index.html      # Page shell: name prompt, room sidebar, message list, composer
    ├── styles.css      # Sidebar + chat layout and theme
    └── client.js       # WebSocket connection, room switching, rendering, send/receive
```

## Message protocol

Messages are JSON sent over the WebSocket.

Client → server:

```jsonc
{ "type": "join",    "name": "Ada", "room": "general" } // first message; sets name + room
{ "type": "message", "text": "Hello, everyone!" }       // posts to the current room
{ "type": "switch",  "room": "random" }                 // move to another room, no reload
```

Server → client:

```jsonc
// Replayed to the joiner only, for the room they just entered:
{ "type": "history", "room": "general", "messages": [ /* up to 200, oldest first */ ] }

// Broadcast to everyone in the room:
{ "type": "message", "id": 7, "room": "general", "name": "Ada", "text": "Hi", "ts": 1700000000000 }
{ "type": "system",  "id": -3, "room": "general", "text": "Ada joined general", "ts": 1700000000000 }

// Broadcast to every connected client whenever room membership changes:
{ "type": "rooms", "rooms": [ { "name": "general", "users": 3 }, { "name": "random", "users": 1 } ] }
```

Chat messages carry positive, database-assigned ids; transient system notices use
negative ids so the two never collide.

All message text is rendered with `textContent` on the client, so user input is
never interpreted as HTML.

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:3000> in a couple of browser tabs. Try giving them
different hashes (`#general`, `#random`) to start in different rooms, post a few
messages, then restart the server and rejoin — the history is still there.

The port and database path are configurable:

```bash
PORT=8080 DB_PATH=/var/data/chat.db npm start
```

For deployment, point `DB_PATH` at a persistent volume so the database outlives
container restarts and redeploys.

## Contributing

1. Fork and clone the repository.
2. `npm install` to pull dependencies.
3. `npm start` and develop against <http://localhost:3000>.

Some ideas worth adding: typing indicators, per-room online-user lists, message
rate limiting, or message editing/deletion. Keep the client dependency-free
where reasonable, and keep `server.js` readable — the project's value is in being
a small, complete example.
