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
the page. You can also start a one-to-one **direct message** with another user
by name; DM conversations are private to the two participants and never appear
in the public room list.

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
├── public/             # The web client (served as static files)
│   ├── index.html      # Page shell: name prompt, rooms sidebar, message list, composer
│   ├── styles.css      # Sidebar + chat layout and theme
│   └── client.js       # WebSocket connection, room/hash routing, rendering
├── Dockerfile          # Multi-stage image used by the AWS deploy
├── deploy.sh           # One-command AWS deploy (see "Deploying to AWS")
└── deploy/             # AWS CDK infrastructure-as-code (TypeScript)
    ├── bin/app.ts      # CDK app entry point
    └── lib/chat-stack.ts # VPC, EFS, Fargate, ALB, CloudFront, Secrets Manager
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

### Moderation & security

The server is the authority on every inbound message and applies, in order:

- **Sanitization.** All user-supplied strings (names, room ids, message text)
  are normalized (Unicode NFC) and stripped of control characters, NUL bytes,
  zero-width / BOM characters, and bidirectional-override characters. This
  removes invisible payloads used to slip past filters or spoof how text renders.
- **Length cap.** Message text is truncated to `MAX_MESSAGE_LENGTH` (default
  2000). The client's `maxlength` is a convenience only; the server re-enforces
  it and never trusts the client.
- **Banned-word filter.** Words listed in `BANNED_WORDS` are masked with
  same-length asterisks (case-insensitive). The match is built from
  regex-escaped words, so the config can't inject a pattern or cause
  catastrophic backtracking (ReDoS).
- **Rate limit.** A sliding window allows at most `RATE_LIMIT_MAX` messages per
  `RATE_LIMIT_WINDOW_MS` per user **per room** (default 5 / 10s). Over the limit,
  the sender gets a private "slow down" notice and the message is dropped.

How the classic attack vectors are addressed:

- **XSS / HTML injection.** The client renders every message with `textContent`,
  so text is never parsed as HTML. A message like `<b>` is shown literally, not
  applied. As defense-in-depth the server sends a strict `Content-Security-Policy`
  (`default-src 'self'`, no inline scripts) plus `X-Content-Type-Options`,
  `X-Frame-Options: DENY` (clickjacking), and `Referrer-Policy`. Note we do *not*
  HTML-escape stored text, since that would double-encode against `textContent`
  and display `&lt;` literally — encoding is done at the output context, which is
  the correct place.
- **SQL injection.** Every query uses parameterized prepared statements
  (`better-sqlite3` bound parameters); message content is never concatenated into
  SQL.
- **CSRF / Cross-Site WebSocket Hijacking.** The WebSocket upgrade is rejected at
  the handshake unless its `Origin` matches the page's own origin (or an entry in
  `ALLOWED_ORIGINS`), so a malicious page can't open a socket and post as a
  visitor. Requests with no `Origin` (native / non-browser clients) are allowed.

### Direct messages

Type a name into the sidebar's **Direct messages** box to start a private
one-to-one conversation. A DM is just a room with a special id that encodes its
two participants — `dm:<encodedNameA>:<encodedNameB>`, with the names sorted so
both people independently arrive at the same id. The server uses that to:

- **Hide it:** private rooms are excluded from the public `rooms` list, so a DM
  never shows up in anyone else's sidebar.
- **Guard it:** entering any `dm:` room is only allowed if your display name is
  one of the two encoded participants; anyone else is bounced.
- **Surface it:** when a DM arrives while the recipient is viewing another room,
  the server sends them a `dm-notice` so the conversation appears (with an
  unread dot) in their sidebar. They can open it to read the replayed history.

Like rooms, DM history is persisted (up to 200 messages) and replays when either
participant reopens the conversation. DMs are kept out of the URL hash, so they
are a session-only view: reloading the page returns you to a public room, but a
DM is always one click away by messaging that user again.

**Security note:** this app has no authentication — anyone can claim any display
name. "Private" therefore means *hidden from the public list and access-checked
by name*, not cryptographically secure. Whoever holds a given name can read that
name's DMs, exactly as they could enter any room. Don't use it for secrets.

### Message protocol

Messages are JSON sent over the WebSocket.

Client → server:

```jsonc
{ "type": "join", "name": "Ada", "room": "general" }
{ "type": "message", "text": "Hello, everyone!" }
{ "type": "switch", "room": "design" }
{ "type": "switch", "room": "dm:Ada:Grace" }
```

The `switch` (and initial `join`) `room` may be a public room name or a private
`dm:<a>:<b>` id; the server validates DM membership and ignores rooms you may
not enter.

Server → client:

```jsonc
{ "type": "rooms", "rooms": [ { "name": "general", "count": 3 } ] }
{ "type": "history", "room": "general", "messages": [ /* recent message objects */ ] }
{ "type": "message", "id": 7, "room": "general", "name": "Ada", "text": "Hi", "ts": 1700000000000 }
{ "type": "system", "id": 8, "room": "general", "text": "Ada joined #general", "ts": 1700000000000 }
{ "type": "dm-notice", "room": "dm:Ada:Grace", "from": "Ada" }
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

Moderation and the origin guard are configurable too (all optional):

```bash
MAX_MESSAGE_LENGTH=2000 \
RATE_LIMIT_MAX=5 \
RATE_LIMIT_WINDOW_MS=10000 \
BANNED_WORDS="spam,foo bar,badword" \
ALLOWED_ORIGINS="https://chat.example.com" \
npm start
```

- `BANNED_WORDS` is a comma-separated list; entries are trimmed and matched
  case-insensitively (an empty value disables the filter).
- `ALLOWED_ORIGINS` is a comma-separated list of exact origins allowed to open
  the WebSocket. Leave it unset for the default (same origin as the served page),
  which is correct for single-origin deployments.

Two more environment variables exist mainly for deployment:

- `ADMIN_TOKEN` — bearer token for the admin HTTP API (see below). When unset
  (the default), the admin endpoints are disabled entirely.
- `SQLITE_LOCKING_MODE` — `EXCLUSIVE` or `NORMAL`. Leave unset on a local disk.
  On a network filesystem (e.g. the AWS EFS volume used by the deploy below),
  set it to `EXCLUSIVE` so SQLite's WAL mode can keep its index in heap memory
  rather than a shared-memory file that NFS does not support.

### Admin API

When `ADMIN_TOKEN` is set, the server exposes a small operator API. Requests
must send `Authorization: Bearer <ADMIN_TOKEN>`; the token is compared in
constant time. There is also an unauthenticated `GET /healthz` liveness probe.

```bash
# List rooms that have stored history (includes private DM room ids).
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/admin/rooms

# Wipe one room's stored message history.
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<host>/admin/rooms/general/clear
```

## Deploying to AWS

The whole app — the WebSocket/HTTP server, the static client, and a publicly
reachable **HTTPS** URL — deploys to your own AWS account with a single command.
Infrastructure is defined as code with the **AWS CDK** (`deploy/`), and the
SQLite database lives on a durable **EFS** volume so history survives restarts
and redeploys.

```bash
./deploy.sh
```

### Architecture

```
Browser ──HTTPS──▶ CloudFront ──HTTP──▶ ALB ──▶ Fargate task ──▶ EFS (SQLite)
        (wss://)   *.cloudfront.net    (origin)  (1 container)    (durable)
```

- **CloudFront** terminates TLS using its built-in `*.cloudfront.net`
  certificate, so you get a valid HTTPS URL with **no custom domain required**.
  It forwards WebSocket upgrades to the origin, so `wss://` works out of the box.
- The **Application Load Balancer** is the stable origin for the Fargate task.
  Its security group is locked to CloudFront's managed IP range, so the origin
  can't be reached directly.
- A single **Fargate** task runs the container image (built from the included
  `Dockerfile`). SQLite is a single-writer database, so the service runs exactly
  one task and redeploys stop the old task before starting the new one.
- **EFS** provides durable, encrypted storage mounted at `/data`; the database
  is `DB_PATH=/data/chat.db`. The file system is **retained** if you tear the
  stack down, so chat history is never silently deleted.
- The **admin token** is generated in **AWS Secrets Manager** at deploy time and
  injected into the container. It is never written to disk or committed.

### Prerequisites

- An **AWS account** and credentials configured locally (`aws configure`, an
  `AWS_PROFILE`, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars). The
  identity needs permission to create the resources above (VPC, ECS, EFS, ELB,
  CloudFront, ECR, IAM, Secrets Manager, CloudWatch Logs) — typically an admin
  or power-user role.
- **Docker**, running locally (the image is built on your machine and pushed to
  ECR during the deploy).
- **Node.js >= 18** and **npm** (CDK and its dependencies run on Node).
- The **AWS CLI v2**.
- A **region**, taken from `AWS_REGION`, `AWS_DEFAULT_REGION`, or your AWS CLI
  configuration.

You do **not** need to install the CDK globally — `deploy.sh` uses the locally
pinned version in `deploy/`.

### Deploy

```bash
# from this directory, with Docker running and AWS credentials available:
./deploy.sh
```

The script checks prerequisites, installs the CDK toolchain, bootstraps the CDK
environment (first run only), builds and pushes the Docker image, and creates or
updates the CloudFormation stack. When it finishes it prints:

- the **public HTTPS URL** (`https://<id>.cloudfront.net`), and
- the exact AWS CLI command to **read the admin token** from Secrets Manager.

A brand-new CloudFront distribution can take 5–15 minutes to become reachable
worldwide; the URL is stable once it does.

Retrieve the admin token any time with:

```bash
aws secretsmanager get-secret-value \
  --secret-id <AdminTokenSecretArn-from-outputs> \
  --query SecretString --output text
```

### Redeploying (updating in place)

Re-run the same command after changing code:

```bash
./deploy.sh
```

CDK rebuilds the image, pushes it, and rolls the Fargate service to the new
version. The EFS volume is reused, so **all message history and other persisted
data are preserved**. Because there can only be one SQLite writer, the old task
is stopped before the new one starts, so expect a brief (tens of seconds)
interruption during each redeploy.

### Optional configuration

The moderation/origin settings can be supplied as environment variables when you
deploy; they are passed through to the container:

```bash
BANNED_WORDS="spam,foo bar" \
MAX_MESSAGE_LENGTH=2000 \
RATE_LIMIT_MAX=5 \
RATE_LIMIT_WINDOW_MS=10000 \
ALLOWED_ORIGINS="https://your-id.cloudfront.net" \
./deploy.sh
```

`ALLOWED_ORIGINS` is optional: the server already accepts same-origin WebSocket
connections, and CloudFront forwards the original `Host`, so the default works
without knowing the CloudFront domain in advance.

### Tearing down

```bash
./deploy.sh --destroy
```

This deletes the stack but **retains the EFS file system** so your chat history
isn't lost by accident. Delete that file system from the EFS console (or with
the AWS CLI) once you're sure you no longer need the data.

### Secrets

No tokens or keys are committed. The admin token is generated by AWS and stored
in Secrets Manager; runtime database files and the local `.env` are git-ignored,
as are the CDK build artifacts under `deploy/`.

## Contributing

1. Fork and clone the repository.
2. `npm install` to pull dependencies.
3. `npm start` and develop against <http://localhost:3000>.

Some ideas worth adding: typing indicators, a per-room online-user list, or
letting you start a DM by clicking a user in that list rather than typing their
name. Keep the client dependency-free where reasonable, and
keep `server.js` readable — the project's value is in being a small, complete
example.
