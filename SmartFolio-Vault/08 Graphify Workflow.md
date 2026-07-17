# Graphify Workflow

## Goal

Use Graphify to build a queryable knowledge graph from the SmartFolio repo and this Obsidian vault.

## Install

Graphify's PyPI package is:

```bash
graphifyy
```

Install with:

```bash
uv tool install graphifyy
graphify install
```

or:

```bash
pipx install graphifyy
graphify install
```

## Graph The Repo

From the SmartFolio repo:

```bash
cd /Users/adiarora/Documents/Codex/2026-07-06/so-i-have-this-right-uses
/graphify .
```

## Graph The Vault

From this vault:

```bash
cd /Users/adiarora/Documents/Codex/2026-07-06/so-i-have-this-right-uses/SmartFolio-Vault
/graphify .
```

## Watch Mode

```bash
graphify . --watch
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

