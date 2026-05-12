---
name: paper-wiki
description: Top-level guide for the paper literature wiki system. Use when Codex needs to route between literature review discovery, paper digest, paper ingest, batch ingest, wiki search, wiki query, lint, or save-like knowledge filing; reason about raw paper assets versus generated wiki pages; prepare or validate the installed Codex paper skill set; or modify the overall paper wiki workflow.
---

# Paper Wiki

Maintain a persistent, compounding literature wiki for scientific papers. The wiki is the compiled knowledge artifact; chat is only the interface.

This skill is a routing and system-boundary guide. It does not replace `paper-digest`, `paper-ingest`, search, query, or lint behavior.

When intent is ambiguous, start here and route to the narrowest skill or agent that owns the operation.

## Architecture

There are three layers:

1. Raw paper inputs and digest assets: PDF URLs, PDF files, cached `PaperDigest` records, digest manifest, and digest failures.
2. Literature wiki pages: generated markdown pages using the current literature wiki page schema.
3. Schema and operations: this skill set, `AGENTS.md`, and the TypeScript contracts.

Do not modify raw source files as part of wiki maintenance. The agent owns generated digest and wiki artifacts.

## Operation Router

Use this routing table:

| User intent | Operation | Read next |
|---|---|---|
| Digest one paper | Create or reuse structured digest | `paper-digest` |
| Ingest one digested paper | Plan and materialize wiki pages | `paper-ingest` |
| Ingest many papers | Batch orchestration | `paper-ingest-batch` |
| Literature review discovery | Frame questions, generate/validate search queries, and find external papers | `literature-review` |
| External literature search | Run `rag_arxiv_retrieve` and rank candidate papers | `literature-search` |
| Summarize batch ingest | Literature-review style batch answer | `paper-ingest/references/batch-summary.md` |
| Search the wiki | Build a relevant reading set | `paper-wiki-search` |
| Ask the wiki a question | Retrieve and synthesize from wiki pages | `paper-wiki-query` |
| Save a valuable answer | File answer back only when explicitly requested or supported by query flow | `references/operations.md` |
| Health-check wiki | Lint graph, links, stale claims, and missing references | `paper-wiki-lint` |

Install and keep the Codex paper skills together. Installing only part of the set can make Codex answer with the wrong boundary, such as querying without retrieval or ingesting raw papers without a digest.

## Core Rules

- Keep paper understanding in `paper-digest`.
- Keep single-paper wiki planning in `paper-ingest`.
- Keep multi-paper transaction control in the batch agent.
- Keep external literature discovery in `literature-review`.
- Search and query are read-only unless an explicit file/save path is enabled.
- Lint reports first and does not fix semantic issues automatically.
- Ingest, batch ingest, and explicit query-save are write operations.
- Use existing page hints before creating pages.
- Add `[[wikilinks]]` for cross references.
- Do not add `overview` pages.
- Do not automatically persist synthesis pages from batch cross-reference; return batch synthesis to the caller unless an explicit query-save flow writes it.

## References

- Read `references/operations.md` when changing operation boundaries, hot/index/log responsibilities, lint, or save behavior.
- Read `references/query-modes.md` when changing retrieval/query behavior or deciding how deep to read.
- Read `references/persistence.md` when changing digest storage, wiki writes, manifests, idempotency, or recovery behavior.
