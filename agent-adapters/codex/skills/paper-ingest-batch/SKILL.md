---
name: paper-ingest-batch
description: Orchestrate batch paper ingestion for the persistent paper literature wiki. Use when Codex receives multiple papers, PDF URLs, PDF files, abstracts, or paper metadata records that need deduplication, parallel per-paper digest/ingest work, cross-reference, commit, and a literature-review style batch summary.
---

# Paper Ingest Batch

Coordinate multi-paper ingestion. This skill is the Codex entry point for batch work; it does not replace `paper-digest` or `paper-ingest`.

## Examples

- User: "ingest these five papers into the wiki" -> use `paper-ingest-batch`.
- User: "batch process these arXiv URLs and summarize the literature" -> use `paper-ingest-batch`.
- User: "add this one paper digest to the wiki" -> use `paper-ingest`, not batch.

## Workflow

1. Normalize and deduplicate all paper inputs.
2. Reuse existing digests and wiki manifest entries when available.
3. Split per-paper work into independent worker tasks when parallel execution is available.
4. Require each worker to use `paper-digest` for raw paper understanding and `paper-ingest` for single-paper wiki planning/materialization.
5. Keep global writes in the orchestrator: cross-reference pass, commit, index, hot cache, log, manifest, and batch summary.
6. Return a batch summary with `[[wikilinks]]` that reads like a compact literature review.

## Parallel Boundary

Workers may handle one paper or a small disjoint shard of papers. Workers must not update global `index.md`, `log.md`, `hot.md`, or final manifest state independently.

The orchestrator owns deduplication, failure accounting, cross-reference, commit, and summary. If parallel workers are unavailable, follow the same ownership model sequentially.

## References

- Read `references/batch-agent.md` for the full orchestration contract.
- Read `paper-ingest/references/batch-and-commit.md` when changing write ownership, commit, cross-reference, or batch failure behavior.
- Read `paper-ingest/references/batch-summary.md` when changing the returned literature-review style summary.
