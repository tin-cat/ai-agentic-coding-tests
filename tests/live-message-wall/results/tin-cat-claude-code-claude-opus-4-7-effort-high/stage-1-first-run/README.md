# wall

A public, anonymous message wall. Anyone can drop a message into the input at the
top of the page and it appears instantly on the wall for everyone else viewing
the site. Messages are never removed. The UI is intentionally bare — a dark,
monospaced, TUI-style interface that resembles a modern text-mode console (in
the spirit of Claude Code / opencode).

```
> type a message and press ENTER ...                              [ add to wall ]   live.
+-----------------+ +-----------------+ +-----------------+ +-----------------+ ...
| #a1b2c3   12:04 | | #d4e5f6   12:03 | | #g7h8i9   12:01 | | #j0k1l2   12:00 |
|                 | |                 | |                 | |                 |
| hello world,    | | another short   | | message that    | | the wall flows  |
| from the wall.  | | message here    | | gets cropped if | | top-to-bottom,  |
|                 | |                 | | it does not fit | | then left-to..  |
+-----------------+ +-----------------+ +-----------------+ +-----------------+
```

## Features

- **No login, no identity.** Visitors post a message; nothing else is collected.
- **Live updates.** New messages appear in every connected browser without a
  refresh, via a single WebSocket channel.
- **Newest-first newspaper flow.** Cards are laid out top-to-bottom and then
  left-to-right, filling the viewport vertically and scrolling horizontally
  when there are more messages than fit.
- **Fixed-size cards with click-to-expand.** Each card has a fixed footprint;
  if the text overflows it is cropped (with a fade) and clicking the card opens
  a modal showing the entire message.
- **Permanent.** Messages cannot be edited or deleted (there is no API for it).
- **Persistent.** Messages are stored to `messages.json` on disk and reloaded
  on server start.

## Running it

Requires Node.js 18+.

```bash
npm install
npm start
```

Then open <http://localhost:3000>. Use `PORT=4000 npm start` to pick a
different port.

## Project layout

```
.
├── package.json          # express + ws
├── server.js             # HTTP + WebSocket server, JSON persistence
├── messages.json         # created at runtime; the message store
├── public/
│   ├── index.html        # TUI markup: sticky input bar + wall + modal
│   ├── style.css         # dark theme, monospace, ASCII-style chrome
│   └── app.js            # fetch + WebSocket client, rendering, modal
└── README.md
```

## Architecture

### Backend (`server.js`)

A minimal Express server plus a `ws` WebSocket server sharing the same HTTP
listener.

- **GET `/api/messages`** — returns the full message list (oldest-first; the
  client re-sorts to newest-first for display).
- **POST `/api/messages`** — accepts `{ "text": "..." }`. Trims, validates
  non-empty and max-length (2000 chars), assigns an `id` (`<ms>-<rand>`) and
  `createdAt` (ISO timestamp), appends it to the in-memory list, queues an
  async write to `messages.json`, and broadcasts a `{type:"new", message}`
  envelope to every connected WebSocket client.
- **WebSocket `/ws`** — push-only channel. On connect the server sends a small
  `{type:"hello", count}` greeting. Thereafter each new message is pushed as
  `{type:"new", message}`. The client never sends frames back.

Persistence is a single JSON file. Writes are debounced via `setImmediate` so a
burst of posts produces one write per tick.

### Frontend (`public/`)

Vanilla HTML/CSS/JS — no framework, no build step.

- **Layout.** The page is a flex column: a sticky `header.topbar` at the top
  containing the prompt (`>`), the text input, the `[ add to wall ]` button,
  and a status indicator; below it a `main.wall` that owns the horizontal
  scroll. The wall's inner element is a CSS grid with
  `grid-auto-flow: column` and `grid-template-rows: repeat(auto-fill, var(--card-h))`,
  which produces the requested newspaper flow: cards stack top-to-bottom
  filling the visible height, then overflow into new columns to the right.
- **Cards.** Fixed `--card-w` × `--card-h`. Text is wrapped and clipped with
  `overflow: hidden`; a gradient fade on the bottom of the card hints at
  cropped content. The whole card is a button — clicking (or pressing Enter
  while focused) opens the modal.
- **Modal.** A single dialog that shows the full message in a `<pre>` block
  with preserved whitespace, plus the id, timestamp, and character count.
  Dismissed by clicking the backdrop, the `[ x ]` button, or pressing Esc.
- **Live updates.** On boot the client `fetch`es `/api/messages`, renders them
  newest-first, then opens a WebSocket. Incoming `new` envelopes are prepended
  to the wall with a brief flash animation. A `Set` of seen ids deduplicates
  the optimistic insert (after a local POST) against the WebSocket echo.
- **Resilience.** If the WebSocket drops, the client reconnects with
  exponential backoff (500 ms → 8 s cap) and updates the status indicator.

## Design choices and trade-offs

- **CSS grid for the newspaper flow.** `grid-auto-flow: column` with a fixed
  row template is the simplest way to get fill-down-then-right ordering
  without manually measuring the viewport.
- **JSON file storage.** Trivial to inspect and back up; fine up to tens of
  thousands of messages. For higher scale, swap `persist()` and the load
  block for SQLite (`better-sqlite3`) without touching the wire format.
- **WebSocket vs SSE.** Either would work. WebSockets are used because the
  protocol overhead is negligible and the `ws` package is tiny.
- **No authentication, no rate limiting.** The spec asked for none. A
  production deployment would want at minimum an IP-based rate limit on
  `POST /api/messages` and probably a profanity/length filter.

## Configuration

| Env var | Default | Meaning                             |
|---------|---------|-------------------------------------|
| `PORT`  | `3000`  | HTTP port the server listens on.    |

Server-side constants live at the top of `server.js`:

- `MAX_MESSAGE_LENGTH` — hard cap on a single message (default `2000`).
- `DATA_FILE` — path to the JSON store (default `./messages.json`).

## API summary

| Method | Path             | Body                  | Response                      |
|--------|------------------|-----------------------|-------------------------------|
| GET    | `/api/messages`  | —                     | `[{id, text, createdAt}, ...]` |
| POST   | `/api/messages`  | `{"text": "..."}`     | `201 {id, text, createdAt}`   |
| WS     | `/ws`            | (server pushes only)  | `{type:"hello",count}` then `{type:"new",message}` |
