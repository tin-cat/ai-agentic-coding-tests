# Frontstage

API-only backend for an event ticketing platform. JSON over HTTP, no UI.
Built with PHP 8.2+ and Symfony 6.4, persisted in PostgreSQL via Doctrine.

This stage introduces the **Catalog** bounded context: an organizer can create
draft events with full seating maps and price tiers, publish them, and have
customers list and inspect the result.

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

Concretely for Catalog today:

| Port (depended on by inner layers)                | Adapter (infrastructure)                      |
| ------------------------------------------------- | --------------------------------------------- |
| `Domain\Repository\EventRepository`               | `Infrastructure\Persistence\Doctrine\DoctrineEventRepository` |
| `Application\Query\EventReadModel`                | `Infrastructure\Persistence\Doctrine\DoctrineEventReadModel`  |
| `Application\Bus\CommandBus`                      | `Infrastructure\Messenger\MessengerCommandBus`               |
| `Application\Bus\QueryBus`                        | `Infrastructure\Messenger\MessengerQueryBus`                 |

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

## Catalog endpoints

| Method | Path                       | Description                                                    |
| ------ | -------------------------- | -------------------------------------------------------------- |
| POST   | `/events`                  | Create a draft event with seating definition and price tiers.  |
| POST   | `/events/{id}/publish`     | Publish a draft event.                                         |
| GET    | `/events/{id}`             | Fetch a single event with seating map and per-seat availability. |
| GET    | `/events`                  | List published events (summary form).                          |

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

### Prerequisites

- PHP 8.2 or later (the project ships with 8.4.7 in CI).
- Composer 2.
- For the dev/prod environments: PostgreSQL 14+ reachable via
  `DATABASE_URL`.

Tests do **not** need PostgreSQL; they use an in-memory SQLite database
provisioned via Doctrine's `SchemaTool`.

### Setup

```sh
composer install
```

For dev/prod, copy `.env` to `.env.local` and point `DATABASE_URL` at your
PostgreSQL instance, then run migrations:

```sh
php bin/console doctrine:migrations:migrate
```

Start the dev server with whichever you prefer (`symfony serve`, `php -S`,
or behind nginx + php-fpm); the application is a standard Symfony 6.4 app.

### Tests

A single command runs the whole suite:

```sh
composer test
```

That executes both:

- **Unit tests** (`tests/Unit/`) - fast, no kernel, no database. Cover value
  objects (rejecting invalid Money, non-UTC `StartsAt`, malformed
  identifiers) and the `Event` aggregate's invariants (price-tier references
  must resolve, publish is non-idempotent, GA materializes capacity as
  seats).
- **Functional tests** (`tests/Functional/`) - boot the Symfony test kernel,
  build the SQLite schema, and drive the HTTP API end-to-end through
  Symfony's `KernelBrowser`. Covers the full lifecycle (create draft,
  publish, fetch detail, list) plus error paths (invalid payload, unknown
  event, double-publish).

You can also target one suite at a time:

```sh
make test-unit
make test-functional
# or:
vendor/bin/phpunit --testsuite=unit
vendor/bin/phpunit --testsuite=functional
```

The functional test base lives at `tests/Functional/ApiTestCase.php` and is
the place to add helpers (auth, fixtures, response assertions) as more
contexts come online.
