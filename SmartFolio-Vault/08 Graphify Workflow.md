# Graphify Workflow

## Goal

Use Graphify to build a queryable knowledge graph from the SmartFolio repo and this Obsidian vault.

## Install

Graphify's PyPI package is `graphifyy` (the CLI it exposes is `graphify`).

Preferred (isolated tool install):

```bash
uv tool install graphifyy      # or: pipx install graphifyy
graphify install --platform claude
```

If neither uv nor pipx is available (as on this machine), a dedicated venv works:

```bash
python3 -m venv ~/.graphify-venv
~/.graphify-venv/bin/pip install graphifyy
~/.graphify-venv/bin/graphify update .
```

## Graph The Repo (verified CLI)

The `/graphify .` form is the AI-assistant slash command. The equivalent CLI
that builds the graph directly (no LLM needed — AST/tree-sitter only):

```bash
cd /Users/adiarora/Documents/Codex/2026-07-06/so-i-have-this-right-uses
graphify update .                 # extract code -> graphify-out/graph.json
graphify cluster-only . --no-label # cluster + generate graph.html (no LLM)
```

Last build: 793 nodes, 1466 edges, 56 communities across 104 files.
Output is git-ignored (`graphify-out/`, ~2 MB) — regenerate anytime with the
two commands above.

## Graph The Vault

From this vault:

```bash
cd /Users/adiarora/Documents/Codex/2026-07-06/so-i-have-this-right-uses/SmartFolio-Vault
graphify update .
```

## Query The Graph

```bash
graphify explain "run_stock_analysis"   # node + its neighbors
graphify path "stocks_analyze" "write_memo"  # shortest path between two nodes
```

## Watch Mode

```bash
graphify watch .
```

## Open Output

Graphify usually creates:

```text
graphify-out/graph.html
```

Open it with:

```bash
open graphify-out/graph.html
```

## What To Query

Ask Graphify questions like:

- How does Analyze Stock connect to Portfolio Intelligence?
- Which agents are responsible for stock forecasting?
- What should become backend services?
- What files explain deployment?
- What resume bullets describe SmartFolio?

