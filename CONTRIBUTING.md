# Contributing

The full contributor guide — the honor code, the CLI quickstart, the `run.yaml` and `test.yaml` schemas, the rating scale, and the worked examples — now lives on the site:

### → **[agentarena.tin.cat/contribute](https://agentarena.tin.cat/contribute/)**

That page is the source of truth. This file exists so GitHub's PR / issue templates still surface a "Contributing" link from the repo root.

## TL;DR

1. **Fork** this repo and clone it.
2. **Use the CLI** (Python 3.11+; bootstraps its own venv):
   ```sh
   ./agent-arena-cli.py run add     # add a run of an existing test
   ./agent-arena-cli.py test add    # add a new test
   ./agent-arena-cli.py validate    # check your YAML
   ```
3. **Open a PR** against `main`. Your handle joins the leaderboard once it's merged.

> ⚔ Run the stages exactly as written. Report the time, the costs, and the rating you actually got. *Be honest — especially when your favorite stack stumbles.* The leaderboard rests entirely on your honor.

See the full guide linked above for the detailed flow, the schemas, and worked examples.
