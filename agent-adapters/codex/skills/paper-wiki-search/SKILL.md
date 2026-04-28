---
name: paper-wiki-search
description: Retrieve relevant pages from the persistent paper literature wiki. Use when Codex needs to build a reading set, inspect wiki context before ingest planning, find existing pages before creating new ones, expand linked pages, search the paper wiki, find in wiki, locate claims/topics/methods/benchmarks/findings, or revise WikiRetrieve behavior.
---

# Paper Wiki Search

Search selects relevant wiki pages. It does not answer the user's question and does not write wiki pages.

This skill is schema-bound. Before changing search behavior, read `references/search-schema.md`.

## Examples

- User: "find wiki pages about the GSM8K benchmark" -> use `paper-wiki-search`.
- User: "locate claims related to chain-of-thought faithfulness" -> use `paper-wiki-search`.
- User: "what does the wiki say about this?" -> use `paper-wiki-query`, not search alone.

## Workflow

1. Require a non-empty discipline scope.
2. Read special context first: discipline hot cache, global hot cache, global index, and discipline index when present.
3. Build a page-file index from wiki markdown files.
4. Load candidate pages according to retrieve mode.
5. Score pages against the query.
6. Select primary pages with mode-specific quotas.
7. Optionally expand through wikilinks.
8. Return a read order and rationale.

## Modes

- `landscape`: prefer synthesis, topic, claim, research question, finding, formal result, paper, method, benchmark.
- `claim_first`: prefer claim, synthesis, topic, paper.
- `topic_first`: prefer topic, synthesis, claim, paper.
- `paper_first`: prefer paper, claim, topic, synthesis.
- `auto`: decide from query text.

## Boundary

Do:

- Return candidate pages, scores, snippets, reasons, consulted files, and read order.
- Use hot/index context to bias retrieval.
- Expand linked pages only when requested.

Do not:

- Generate final answers.
- File synthesis pages.
- Ingest papers.
- Create missing pages.
- Reintroduce overview pages as seed targets.

## Context Discipline

- Use hot and index context to narrow the search before loading page bodies.
- Prefer a small high-signal reading set over broad scans.
- Expand links only when linked pages clarify the current query or ingest decision.
- Stop reading when the read order is sufficient for the caller's next step.
