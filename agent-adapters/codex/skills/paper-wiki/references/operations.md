# Paper Wiki Operations

Use this reference for operation boundaries across the paper literature wiki.

For persistence, idempotency, manifest consistency, and recovery rules, read `persistence.md`.

## Ingest

Single-paper ingest should:

1. Create or reuse a `PaperDigest`.
2. Retrieve existing wiki hints.
3. Produce a `PaperIngestPlan`.
4. Materialize planned pages.
5. Cross-reference the prepared paper.
6. Commit affected pages and global navigation files.

Batch ingest should:

1. Deduplicate inputs.
2. Reuse existing digests and manifest lookups.
3. Prepare missing papers.
4. Run one batch cross-reference pass.
5. Commit once.
6. Return a batch summary.

Per-paper workers must not independently update global `index.md`, `log.md`, or `hot.md`. The batch orchestrator owns global writes.

## Query

Query should read the wiki before answering. Prefer hot cache and indexes first, then relevant pages. Cite wiki pages with `[[page_key]]`.

Only good query answers can become wiki pages, and only through an explicit save/query-save path. Do not silently write every answer.

## Save

Save-like behavior is for durable insights, comparisons, decisions, or query answers that should compound in the wiki.

When saving:

- choose a stable page kind, usually `synthesis` for cross-page answers
- write the knowledge itself, not a transcript of the conversation
- include citations with wikilinks
- update index/log/hot if a page is written
- avoid duplicates by checking existing pages first

Skip saving mechanical lookups, temporary debugging notes, and answers already covered by existing wiki pages.

## Lint

Lint should check:

- orphan pages
- dangling wikilinks
- stale claims
- missing cross-references
- important mentioned concepts without pages in the current paper taxonomy
- pages with weak or missing citations
- stale index entries

Lint reports should not resolve contradictions automatically. Human review is needed for semantic merges and contradiction resolution.

## Hot Cache

`hot.md` is a recent-context cache, not a journal. Keep it short and overwrite it on meaningful ingest/query/save operations.

It should include:

- last update
- key recent facts
- recent page changes
- active threads
- open gaps

## Removed Overview

Do not create `overview` pages or navigation entries. The literature wiki now starts from index, hot, research questions, topics, claims, and syntheses.
