# AgentArena

A community-run benchmark of agentic AI coding setups. Contributors run a test's
staged prompts against their agent · model · provider stack and submit per-stage
ratings; the site aggregates everything into leaderboards and per-axis breakdowns.
Live at https://agentarena.tin.cat.

## Layout

- `agent-arena-cli.py` — contributor CLI (TUI). Commands: `test add`, `run add`
  (interactive wizards), `validate`. Self-bootstraps a venv into `/.venv/` on
  first run.
- `scripts/build_site.py` — static-site generator. Reads all tests, aggregates,
  renders the SPA. Self-bootstraps `scripts/.venv/`.
- `scripts/site_template/` — the SPA source: `index.html` (shell), `app.js`
  (router + views + charts), `styles.css`, and `contribute/` (the contribute
  page fragment + `*.example` files shown on it).
- `tests/<name>/test.yaml` — a test: metadata + ordered stage prompts.
- `tests/<name>/runs/<run-id>/run.yaml` — one contributed run (per-stage metrics
  + rating). Each `stage-*/` subdir holds the source the agent produced.
  (This dir was historically `results/`; it's `runs/` now.)
- Root catalogs: `agents.json`, `providers.json`, `models.json`, `stacks.json` —
  id→metadata (name, description, homepage, logo, …). Contributable via PR.
  `models.json`/`stacks.json` entries may carry `aliases` (merged in aggregation).
- `logos/<agents|providers|stacks>/<id>.svg` — catalog logos (monochrome
  `#d5dde8`, Simple Icons style); copied into the built site.
- `site/` — generated output. **Gitignored**; rebuilt by GitHub Actions on every
  push to `main`. Never edit by hand.

## Commands

- Build the site: `python3 scripts/build_site.py` (writes to `site/`). It first
  runs `agent-arena-cli.py validate`, so a build failure usually means bad YAML.
- Preview: `python3 -m http.server -d site 8000`.
- The build prints `[warn] …` lines for soft issues (e.g. a test that declares a
  `stack` but never names it in a prompt) — these don't fail the build.

## Data model & conventions

- **Schema lives in two places** — the Pydantic models in `agent-arena-cli.py`
  and `scripts/build_site.py` are intentionally duplicated. Keep them in sync.
- `test.yaml`: `contributor_url`, `name`, `title`, `description`, optional
  `domain` (fixed enum) and `stack` (id from `stacks.json`), `stages[]`
  (`id`, `theme`, `prompt`, optional `builds_on`). If a test declares a `stack`,
  its prompts must require that stack (enforced as a soft warning).
- `run.yaml`: `contributor_url`, `date`, `agent{name,plan}`, `provider`, `model`,
  optional `framework`/`quantization`/`hardware`/`settings`, `stages[]` with
  `duration_sec`, `tokens_in/out`, `cost_usd`, `rating`, `notes`.
- **Ratings**: `excellent`=1.0, `good`=0.75, `partial`=0.4, `failed`=0.0. Scores
  are stored/computed on 0–1 but **displayed on a 0–10 scale** (e.g. 0.93 → 9.3;
  detail/profile pages show `9.30/10`). All display scaling is in `app.js`
  (`fmtScore`/`fmtScoreDetail` + chart tick callbacks); the underlying data and
  bar geometry stay 0–1.
- **Catalog pages** (agents/providers/models/stacks) share one generic
  master-detail renderer (`CATALOG_KINDS` + `_build_grouped`). A run's stack is
  inherited from its test; the `/stacks` page ranks models per stack, and each
  model page lists the stacks it's been run on.
- **Mockup tests** (csv-analyzer, snake-game, the fake ones, etc.) are gitignored
  per-directory in `.gitignore` so they never reach the live site. Only real
  contributed tests (e.g. `live-message-wall`) are committed.
- Prefer inline SVG for small one-off UI graphics in templates; catalog *logos*
  are the exception — they're external files referenced by URL.

## Deploy

Push to `main` → GitHub Actions rebuilds and publishes `site/`. A local commit
does **not** deploy; nothing ships until pushed.

## Design decisions (the "why")

- **Scores shown 0–10 but stored 0–1.** The 0–10 display is a deliberate UX
  choice and is lossless (0–1 at 2 decimals and 0–10 at 1 decimal both give 101
  steps). The data layer stays 0–1 so bar widths, sorting, chart geometry, and
  `rating_per_dollar` math are untouched — scaling happens *only* at the display
  layer (`fmtScore`/`fmtScoreDetail` + chart tick callbacks). The "score / $"
  column is also shown ×10 for consistency.
- **`stack` belongs to the test, not the run; one stack per test.** A two-stack
  test is really two tests. Runs inherit their test's stack. The "prompts must
  require the declared stack" rule is a *soft* lint warning, never a hard fail —
  matching a stack against prose can't be done reliably.
- **Stack taxonomy is framework-led**, with a stdlib/vanilla variant per
  language: `vanilla-php` vs `php-symfony`, `node` (stdlib only) vs
  `node-express`, `go-stdlib`, etc. `language` is stored separately from
  `category` so stacks can later roll up by language. A stack tags what a test
  *targets*; e.g. `live-message-wall` is `node-express` because its reference
  run uses Express + `ws`, even though its prompt wording was originally open.
- **`results/` was renamed `runs/`** to mirror the site's `/runs/` URL space.
- **Logos are monochrome `#d5dde8`** to match the terminal theme (the dominant,
  not universal, convention), sourced from Simple Icons (CC0) and recolored.

## Working in this repo (gotchas)

- **`tests/live-message-wall/` is huge in git.** That committed test ships its
  full run source *including `node_modules`*, so renames/edits under it can touch
  thousands of files. That's expected, not a mistake — filter it out when
  reading `git status` (`git status --short | grep -v live-message-wall`).
- **Don't `import build_site` to test it.** The venv self-bootstrap re-execs and
  runs a full build on import. Run it as a script (`python3 scripts/build_site.py`).
- **A tracked `__pycache__/*.pyc` exists at the repo root.** Editing
  `agent-arena-cli.py` can make it show as modified; `git checkout` it to avoid
  committing binary churn.
- **Zero-run catalog entries don't render.** Most stacks and some models have no
  runs yet; they're valid catalog choices but won't appear on their listing
  pages until a test/run uses them.
- **First build needs network** (pip bootstraps `scripts/.venv/` and `/.venv/`).
- **Maintainer works on `main` directly**; deploy = push to `main`. Commit only
  when asked, and confirm before editing published/outward-facing content (e.g.
  a real test's prompts).
