# Paper Digest Runtime Behavior

This reference covers behavior around the `PaperDigest` schema. Keep it aligned with the digest store and retry logic. For cross-layer persistence and recovery rules, also read `paper-wiki/references/persistence.md`.

## Inputs And Capabilities

Supported digest inputs:

- `pdf_url`: sourceId, pdfUrl, optional disciplineHint.
- `pdf_file`: sourceId, path, optional disciplineHint.

Provider capabilities control whether a source can be read:

- `pdfUrlReadSupport`: `hosted_web_search | native | unsupported`.
- `pdfFileReadSupport`: `native | unsupported`.

If the configured provider cannot read the input type, return a structured failure instead of pretending the paper was read.

## Cache And Manifest

Before generating a new digest, lookup existing digests by input cache key and canonical paper key.

Persisted state uses:

- `paper-digests/`: one JSON file per canonical paper key.
- `paper-digests.manifest.json`: manifest records keyed by canonical paper key.
- `paper-digest-failures.json`: unresolved and historical failure records.

`recordPaperDigest` must update:

- the input-key cache
- the canonical-key cache
- the manifest
- the persisted digest file

## Failure Records

Digest failures are structured records. Preserve:

- `sourceId`
- `canonicalPaperKey` when known
- `sourceKind`
- `reason`
- `detail`
- `retryable`
- `retryCount`
- `autoRepairPlan`
- `failureStatus`: `pending_retry | needs_user_help | resolved | abandoned`

When a later digest succeeds, resolve matching failures by canonical paper key and by source id.

## Retry Policy

`PaperDigests.digest` retries only while:

- the failure is retryable
- the retry count has not exceeded `maxAutoRetries`

Default max auto retries is 2. Non-retryable failures should stop immediately.

## Failure Reasons

Use the existing reason enum:

- `paper_digest_requires_pdf_url`
- `paper_digest_pdf_file_not_supported_yet`
- `paper_digest_pdf_unreachable`
- `paper_digest_pdf_access_blocked`
- `paper_digest_provider_unsupported`
- `paper_digest_model_failed`
- `paper_digest_output_invalid`

Classify unsupported provider capability separately from model failure. Classify invalid JSON or invalid schema as output invalid and repair or retry according to the retry policy.

## Structured Output Repair

Digest generation expects valid structured output. If parsing fails:

1. Try normal structured parse.
2. Try salvage.
3. Ask the model to repair into the same schema.

Do not silently accept malformed or partial digest objects.
