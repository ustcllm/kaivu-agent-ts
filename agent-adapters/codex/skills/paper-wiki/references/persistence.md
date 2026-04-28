# Paper Wiki Persistence

Use this reference when changing digest storage, wiki writes, manifests, idempotency, or recovery behavior.

## Layers

Persistence has two separate generated layers:

1. Digest layer: `PaperDigest` JSON assets, digest manifest, and digest failure records.
2. Wiki layer: markdown wiki pages, wiki indexes, hot caches, log, and paper ingest manifest.

Digest success does not imply wiki ingest success. Wiki ingest failure must not delete or rewrite a valid digest.

The wiki can cite and summarize digests, but wiki pages must not be used to overwrite digest records.

## Raw Inputs

Raw paper inputs are source material:

- PDF URLs
- local PDF files
- extracted paper text or metadata when supported by the caller

Do not modify raw source files during digest, ingest, query, or lint operations. Store generated state separately.

## Digest Layer

Digest persistent files:

- `paper-digests/<canonicalPaperKey>.json`
- `paper-digests.manifest.json`
- `paper-digest-failures.json`

Digest idempotency:

- Lookup by input cache key and canonical paper key before generating.
- Reuse an existing digest when present.
- Record failures without deleting previous successful digests.
- Resolve matching failures after a later successful digest.

Digest manifest consistency:

- A manifest record should point to a loadable digest file.
- If a manifest record is stale or the digest file is missing, ignore that record and allow regeneration.
- Persist the digest file and manifest together through the existing persistence queue.

## Wiki Layer

Wiki persistent files include:

- page markdown files
- `index.md`
- affected `_index.md` sub-indexes
- `log.md`
- `hot.md`
- discipline hot caches
- paper ingest manifest

Wiki idempotency:

- Check the paper ingest manifest by canonical paper key before planning a full rewrite.
- If manifest lookup pages are loadable, return `reused_existing`.
- If manifest records are stale or page files are missing, fall back to normal prepare and commit.

## Write Ordering

For wiki commits, prefer this order:

1. Write affected page files.
2. Write global and affected navigation files.
3. Append log.
4. Write hot caches.
5. Persist the paper ingest manifest last.

The manifest should not point to pages that have not been written yet.

## Partial Failure

Batch ingest may include:

- successfully digested and ingested papers
- reused existing papers
- digest failures
- prepare/materialization failures

Keep successful digests and successful wiki commits. Report failed papers with structured reasons. Do not roll back unrelated completed papers unless the implementation has explicit transaction support.

## Schema Versions

Preserve schema version fields:

- digest persisted files use `schemaVersion: 1`
- wiki pages use their current `schemaVersion` field
- manifest files use `schemaVersion: 1`

When schema versions change, add migration or compatibility logic instead of silently accepting old files as current.

## Recovery Rules

- Missing digest file with manifest record: ignore stale record and regenerate digest if possible.
- Missing wiki page with ingest manifest record: ignore stale lookup and re-run prepare/commit.
- Missing hot/index/log: regenerate during the next commit.
- Malformed generated JSON: treat as invalid structured output and repair or retry through the existing parser flow.

## Separation Rules

- Do not derive canonical digest facts from edited wiki markdown.
- Do not let lint auto-delete digest or wiki artifacts.
- Do not write synthesis pages as a side effect of batch cross-reference.
- Do not recreate overview files.
