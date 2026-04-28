# Paper Ingest Batch And Commit Behavior

This reference covers batch orchestration and wiki write behavior around `PaperIngest`. For cross-layer persistence, idempotency, and recovery rules, also read `paper-wiki/references/persistence.md`.

## Request Boundary

`PaperIngestRequest` includes:

- `paper`: `pdf_url | pdf_file` paper ingest input.
- `wikiRoot`: target wiki root.
- `discipline`: optional discipline override.
- `existingPageHints`: optional explicit hints. If absent, retrieval should build hints.

Batch ingest requires all inputs to share the same `wikiRoot`.

## Single Paper Flow

Single-paper ingest follows:

1. Convert ingest input to digest input.
2. Reuse cached digest when available.
3. Generate and record a digest when missing.
4. Resolve prior digest failures on success; record structured failures on failure.
5. Check the paper ingest manifest by canonical paper key.
6. If existing lookup pages are available, return `reused_existing` without rewriting wiki pages.
7. Otherwise plan, materialize, cross-reference, and commit.

## Prepare Flow

`prepare` returns `PreparedPaperIngest`:

- `digest`
- `plan`
- `pages`
- `skippedUpdates`
- `usedExplicitPageHints`

Planning should retrieve existing page hints when explicit hints are absent. Retrieval should expand links and prefer relevant existing pages over new duplicates.

## Cross-Reference Batch

`crossReferenceBatch` runs after per-paper preparation. It may merge or enrich these page kinds:

- `research_question`
- `method`
- `benchmark`
- `finding`
- `formal_result`
- `topic`
- `claim`

It retrieves historical pages when retrieval is available and merges them with batch pages by page identity. It writes cross-reference notes with wikilinks to paper keys.

Do not automatically create or rewrite synthesis pages in cross-reference. Batch-level synthesis is returned by `ingestBatchSummary`.

## Commit Batch

`commitBatch` writes only affected page files plus global navigation files.

Commit behavior:

- Load existing wiki pages to preserve pages outside the batch.
- Merge incoming pages into existing pages by page identity.
- Write only changed page files.
- Write global `index.md`.
- Write affected sub-indexes.
- Append `log.md`.
- Write `hot.md`.
- Write discipline hot caches.
- Persist the paper ingest manifest.

`PaperIngestWriteStatus` must report:

- `status`: `written | reused_existing`
- `writtenFiles`
- `skippedUpdates`
- optional `indexPath`, `logPath`, `hotPath`, `disciplineHotPaths`

## Batch Result

`PaperIngestBatchResult` includes:

- `digests`
- `completed`
- `failures`
- `lookupIndex`
- `crossReference`
- `write`

If every paper was already ingested and no pages were prepared, return `reused_existing` with existing lookup index and no write.

## Manifest

The ingest manifest maps canonical paper keys to wiki page files. Reuse it to skip re-ingesting papers that already have loadable wiki pages.
