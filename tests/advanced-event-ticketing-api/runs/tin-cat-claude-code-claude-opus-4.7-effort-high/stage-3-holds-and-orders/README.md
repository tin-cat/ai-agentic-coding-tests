# Frontstage

API-only backend for an event ticketing platform. JSON over HTTP, no UI.
Built with PHP 8.2+ and Symfony 6.4, persisted in PostgreSQL via Doctrine.

This stage introduces three bounded contexts:

- **Catalog** - an organizer can create draft events with full seating maps
  and price tiers, publish them, and have customers list and inspect the
  result.
- **Reservations** - a customer places a time-limited hold on specific seats
  (or a quantity of general-admission tickets) for an event. Holds live in a
  Redis-backed store with a TTL so they expire automatically; a per-seat
  Redis lock makes placement atomic across concurrent attempts. A customer
  may release a hold early.
- **Ordering** - a customer converts an active hold into an order. Placing
  the order consumes the hold and marks those seats as sold in the catalog.
  Each order has a `Money` total computed from the seats' price tiers.

A CQRS read model on the Reservations side answers "what is available for
this event right now" by joining the catalog's source-of-truth seat status
with the live Redis hold markers, kept separate from the write models.

---

## Architecture

Frontstage is laid out around three reinforcing ideas that the codebase is
expected to grow into, not grow out of.

### Hexagonal architecture (ports and adapters)

Every bounded context has three layers:

```
   src/<Context>/
     Domain/          <-- plain PHP. No Doctrine, no Symfony, no HTTP.
     Application/     <-- command/query handlers, view DTOs, port interfaces.
     Infrastructure/  <-- Doctrine entities + mappings, HTTP controllers,
                          Messenger adapters, anything framework-specific.
```

Dependency direction is strict and outward only:

```
   Infrastructure  -->  Application  -->  Domain
                                          (no outgoing dependencies)
```

The domain depends on nothing but itself. Ports (interfaces declared by the
domain or application) are implemented by adapters in the infrastructure
layer. The Symfony service container is the wiring mechanism: it binds each
port to its adapter (see `config/services.yaml`).

Concretely:

**Catalog**

| Port (depended on by inner layers)                | Adapter (infrastructure)                      |
| ------------------------------------------------- | --------------------------------------------- |
| `Domain\Repository\EventRepository`               | `Infrastructure\Persistence\Doctrine\DoctrineEventRepository` |
| `Application\Query\EventReadModel`                | `Infrastructure\Persistence\Doctrine\DoctrineEventReadModel`  |
| `Application\Bus\CommandBus`                      | `Infrastructure\Messenger\MessengerCommandBus`               |
| `Application\Bus\QueryBus`                        | `Infrastructure\Messenger\MessengerQueryBus`                 |

**Reservations**

| Port                                              | Adapter                                                        |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `Domain\Repository\HoldRepository`                | `Infrastructure\Persistence\Cache\CacheHoldRepository` (Redis pool with TTL) |
| `Domain\Service\SeatLocker`                       | `Infrastructure\Lock\SymfonyLockSeatLocker` (Redis-backed `LockFactory`) |
| `Domain\Service\Clock`                            | `Infrastructure\Clock\SystemClock`                              |
| `Domain\Service\EventSeats`                       | `Infrastructure\Adapter\CatalogEventSeats` (reads Catalog tables) |
| `Application\Query\AvailabilityReadModel`         | `Infrastructure\Query\CompositeAvailabilityReadModel` (catalog + holds) |

**Ordering**

| Port                                              | Adapter                                                        |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `Domain\Repository\OrderRepository`               | `Infrastructure\Persistence\Doctrine\DoctrineOrderRepository`  |
| `Application\Query\OrderReadModel`                | `Infrastructure\Persistence\Doctrine\DoctrineOrderReadModel`   |
| `Domain\Service\HoldGateway`                      | `Infrastructure\Adapter\ReservationsHoldGateway`               |
| `Domain\Service\EventPricing`                     | `Infrastructure\Adapter\CatalogEventPricing`                   |
| `Domain\Service\SeatSales`                        | `Infrastructure\Adapter\CatalogSeatSales`                      |

Cross-context calls always travel through a port defined in the calling
context and an adapter in its infrastructure layer; neither Reservations nor
Ordering imports the other's domain types.

### Domain-Driven Design (tactical patterns)

- **Aggregate root**: `Event` (in `Catalog/Domain/Model/Event`). Owns its
  `Venue`, the venue's seating definition (sectioned or general admission),
  every `Seat`, and the collection of `PriceTier`s. All mutations go through
  the aggregate; inner entities are never modified directly.
- **Entities**: `Event`, `Seat`. Each has identity.
- **Value objects**: `Money`, `Currency`, `EventId`, `EventTitle`,
  `EventDescription`, `StartsAt` (always UTC), `VenueName`, `SeatId`,
  `PriceTierId`, `PriceTierName`. Money is never represented as `int|float`;
  dates are never raw `DateTime`; identifiers are never plain strings outside
  the boundaries.
- **Repository interfaces**: defined in `Catalog/Domain/Repository` so the
  domain dictates its persistence contract rather than borrowing one from
  Doctrine.

The domain layer contains no `use Doctrine\...`, no `use Symfony\...`, and no
HTTP types. Verify with `grep -RE "(Doctrine|Symfony)" src/Catalog/Domain` -
the only match is JSDoc-style references in comments.

### CQRS (Command Query Responsibility Segregation)

Writes and reads travel on separate buses:

- **Command bus** (`command.bus` in `config/packages/messenger.yaml`) routes
  commands like `CreateEventCommand` and `PublishEventCommand`. Handlers
  mutate the aggregate via the repository port and return nothing meaningful.
- **Query bus** (`query.bus`) routes queries like `GetEventQuery` and
  `ListPublishedEventsQuery`. Handlers go through `EventReadModel` (a
  Doctrine DBAL adapter that builds denormalized projections directly from
  the database) and return view DTOs ready to be JSON-encoded.

Both buses are synchronous (`sync://` transport) today; the same handler code
will work behind an async transport when message routing is reconfigured.

### Bounded contexts

Each context is its own top-level module with its own three layers. To add
the next context (e.g. **Sales**, **Inventory**), create
`src/Sales/Domain`, `src/Sales/Application`, `src/Sales/Infrastructure`, add
its resource block to `config/services.yaml`, and register its Doctrine
mapping in `config/packages/doctrine.yaml`. Contexts communicate only across
their published interfaces (today: none), never by reaching into each
other's domain models.

---

## Endpoints

### Catalog

| Method | Path                       | Description                                                    |
| ------ | -------------------------- | -------------------------------------------------------------- |
| POST   | `/events`                  | Create a draft event with seating definition and price tiers.  |
| POST   | `/events/{id}/publish`     | Publish a draft event.                                         |
| GET    | `/events/{id}`             | Fetch a single event with seating map and per-seat availability. |
| GET    | `/events`                  | List published events (summary form).                          |

### Reservations

| Method | Path                            | Description                                                   |
| ------ | ------------------------------- | ------------------------------------------------------------- |
| POST   | `/events/{id}/holds`            | Place a time-limited hold on named seats or a GA quantity.    |
| DELETE | `/holds/{id}`                   | Release a hold early (404 if it does not exist).              |
| GET    | `/events/{id}/availability`     | CQRS read model: per-seat status (available/held/sold).       |

### Ordering

| Method | Path                | Description                                                        |
| ------ | ------------------- | ------------------------------------------------------------------ |
| POST   | `/orders`           | Convert an active hold into a confirmed order; consumes the hold. |
| GET    | `/orders/{id}`      | Fetch an order with its lines, total, and status.                 |

#### Place hold payload

```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
  "seats": [
    { "section": "Orchestra", "row": "A", "number": "1" },
    { "section": "Orchestra", "row": "A", "number": "2" }
  ],
  "ttlSeconds": 600
}
```

Either pass `seats` (named seats, sectioned events) or `quantity` (a number
of GA seats; the server picks them deterministically). `id` is optional; if
omitted a UUIDv7 is generated. `ttlSeconds` defaults to 600 (10 minutes).

Holds return `409 Conflict` when any requested seat is already held or sold.

#### Place order payload

```json
{
  "id": "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
  "holdId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"
}
```

Orders return `409 Conflict` when the named hold has expired, been
released, or already been used to place an order.

Errors come back as JSON: `{ "error": "<message>" }` with `400` for
domain-rule violations, `404` for unknown events, `409` for invalid state
transitions (e.g. publishing twice).

### Create event payload

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "title": "Symphony Night",
  "description": "An evening of music.",
  "startsAt": "2026-09-12T19:30:00+00:00",
  "venueName": "Grand Hall",
  "priceTiers": [
    { "id": "general", "name": "General", "priceAmount": 5000, "priceCurrency": "USD" },
    { "id": "vip",     "name": "VIP",     "priceAmount": 15000, "priceCurrency": "USD" }
  ],
  "seating": {
    "type": "sectioned",
    "sections": [
      {
        "name": "Orchestra",
        "rows": [
          { "label": "A", "seats": [
              { "number": "1", "priceTierId": "vip" },
              { "number": "2", "priceTierId": "vip" }
          ]},
          { "label": "B", "seats": [
              { "number": "1", "priceTierId": "general" }
          ]}
        ]
      }
    ]
  }
}
```

For general admission, replace the `seating` block with:

```json
"seating": { "type": "general_admission", "capacity": 30, "priceTierId": "general" }
```

`id` is optional on create; if omitted, the server generates a UUIDv7.
`priceAmount` is always in the smallest currency unit (e.g. cents for USD).

---

## Running

The whole development environment is packaged as a Docker Compose stack:

| Service    | Role                                                            |
| ---------- | --------------------------------------------------------------- |
| `app`      | PHP 8.3 FPM with the Symfony application (built from `docker/php/Dockerfile`). |
| `web`      | nginx in front of PHP-FPM. Serves the API on `localhost:8080`.  |
| `database` | PostgreSQL 16. Provisions a second `app_test` database for the test suite. |
| `rabbitmq` | RabbitMQ 3.13 with the management plugin enabled.               |
| `redis`    | Redis 7. Backs the Symfony cache adapter and the Lock component. |

The only host requirement is Docker (Engine 24+ / Desktop 4.27+) with the
`docker compose` plugin available. No local PHP or Composer install is
needed.

### Bringing the stack up

A single command builds the images, starts every service, waits for each
health check to pass, and applies database migrations:

```sh
make up
```

When it finishes:

- API:         <http://localhost:8080>
- RabbitMQ UI: <http://localhost:15672>  (user: `guest`, password: `guest`)
- Postgres:    `localhost:5432` (user: `app`, password: `app`, db: `app`)
- Redis:       `localhost:6379`

### Stopping and inspecting

| Command          | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `make down`      | Stop and remove the containers (named volumes survive). |
| `make ps`        | Show the status of every service.                       |
| `make logs`      | Tail logs from every service.                           |
| `make shell`     | Drop into a shell inside the `app` container.           |
| `make migrate`   | Re-run database migrations against the dev database.    |
| `make restart`   | Restart every service without rebuilding the image.     |
| `make rebuild`   | Rebuild the application image with no cache.            |

Run `make help` for the full list. All of these are thin wrappers around
`docker compose` if you would rather drive it directly.

### Configuration

Every connection string is sourced from environment variables - none of
them are baked into the image. The defaults in `.env` point at the
container hostnames (`database`, `rabbitmq`, `redis`); override anything
locally by writing to `.env.local`, which is gitignored. Notable variables:

| Variable                  | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `DATABASE_URL`            | Postgres DSN used by Doctrine.                   |
| `MESSENGER_TRANSPORT_DSN` | AMQP DSN for the `async` Messenger transport.    |
| `REDIS_URL`               | Redis DSN used by the cache adapter.             |
| `LOCK_DSN`                | DSN used by the Lock component (Redis in dev).   |
| `POSTGRES_*`              | Override the database name, user, and password.  |
| `RABBITMQ_USER` / `_PASSWORD` | Override RabbitMQ credentials.               |
| `HTTP_PORT`               | Host port the API is exposed on (default 8080).  |

### Messenger, cache, and lock wiring

- **Messenger** declares two transports in
  `config/packages/messenger.yaml`: `sync` (in-process, used by every
  command and query today) and `async` (AMQP, pointed at RabbitMQ). The
  AMQP transport is provisioned and ready to carry asynchronous messages -
  a later stage can switch any message from `sync` to `async` without any
  infrastructure changes.
- **Cache** (`config/packages/cache.yaml`) uses the Redis adapter via
  `REDIS_URL` and also backs the Reservations hold store
  (`CacheHoldRepository`). The test environment swaps in the filesystem
  adapter so cached items survive the multiple in-process requests issued
  inside one test; `ApiTestCase` clears the pool between tests.
- **Lock** (`config/packages/lock.yaml`) uses Redis via `LOCK_DSN` so locks
  are coordinated across application instances. The test environment falls
  back to `flock`.

## Tests

A single command runs the full PHPUnit suite inside the `app` container,
against a dedicated, isolated `app_test` Postgres database (provisioned on
first startup by `docker/postgres/init-test-db.sh` and kept on its own
schema lifecycle in `tests/Functional/ApiTestCase.php`):

```sh
make test
```

This runs both:

- **Unit tests** (`tests/Unit/`) - fast, no kernel, no database. Cover value
  objects (rejecting invalid Money, non-UTC `StartsAt`, malformed
  identifiers), the `Event` aggregate's invariants (price-tier references
  must resolve, publish is non-idempotent, GA materializes capacity as
  seats), the `Hold` aggregate (TTL maths, duplicate-seat rejection,
  expiry semantics), the `Order` aggregate (total summed from lines,
  duplicate-seat rejection, currency-mixing rejection), and the place-hold
  handler driven against in-memory fakes (lock rejection, sold-seat
  rejection, second-hold-after-release).
- **Functional tests** (`tests/Functional/`) - boot the Symfony test kernel,
  rebuild the schema via Doctrine's `SchemaTool`, and drive the HTTP API
  end-to-end through Symfony's `KernelBrowser`. Covers the catalog
  lifecycle (create draft, publish, fetch detail, list) plus the full
  reservations/ordering flow: a hold makes seats unavailable, an expired
  hold frees them again, two attempts to hold the same seat cannot both
  succeed, placing an order from a hold marks the seats sold and consumes
  the hold, and a consumed or released hold can no longer be ordered.

Target one suite at a time with:

```sh
make test-unit
make test-functional
```

The functional test base lives at `tests/Functional/ApiTestCase.php` and is
the place to add helpers (auth, fixtures, response assertions) as more
contexts come online.
