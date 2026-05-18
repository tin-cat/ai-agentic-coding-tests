# Logos

Optional logo assets referenced by `/agents.json` and `/providers.json` via their `logo` fields (e.g. `/logos/agents/claude-code.svg`).

## How to contribute a logo

1. Add an SVG file named after the entry's `id`:
   - For an agent with `id: claude-code`, drop the file at `/logos/agents/claude-code.svg`.
   - For a provider with `id: anthropic`, drop the file at `/logos/providers/anthropic.svg`.
2. Make sure you have the right to redistribute it, most vendors publish brand assets under specific terms. Prefer the official SVG from a brand kit page.
3. Keep the file small (ideally under 10 KB) and use a square or roughly-square viewBox so the site can render it at any size.

PRs adding logos are welcome.

## What's already here

A first batch was sourced from [Simple Icons](https://simpleicons.org/) — an MIT-licensed collection of SVG brand marks. The icons remain trademarks of their respective owners; we use them here under standard nominative-use practice (identification on a comparison site, no endorsement implied). For some entries the SVG had a too-dark fill that wouldn't render on the dark theme; those were re-fetched from the Simple Icons CDN with the theme text color baked in. The colorful brand-color SVGs are unchanged.

Still missing (Simple Icons doesn't carry them, or carries them under a name that means something else):

- **Agents:** `aider`, `amazon-q`, `amp`, `cody`, `codex`, `continue`, `crush`, `devin`, `goose`, `kiro`, `lovable`, `opencode`, `openhands`, `pearai`, `roo-code`, `supermaven`, `tabnine`, `trae`
- **Providers:** `openai`, `azure`, `bedrock`, `groq`, `together`, `fireworks`, `cerebras`, `deepinfra`, `sambanova`, `cohere`

Each would need a logo sourced from the vendor's brand page (and checked against their guidelines).
