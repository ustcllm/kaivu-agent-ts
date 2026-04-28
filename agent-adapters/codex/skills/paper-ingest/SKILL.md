---
name: paper-ingest
description: Plan and materialize one structured PaperDigest into a persistent literature wiki. Use when Codex needs to ingest a single digested paper into wiki pages, choose whether to create or update page kinds, use existing wiki retrieval hints, maintain cross-references, or revise single-paper ingest behavior.
---

# Paper Ingest

Integrate one paper digest into the persistent literature wiki. This skill is for single-paper planning and page materialization; batch orchestration belongs to the paper ingest batch agent.

This skill is schema-bound. Before changing ingest behavior, read `references/ingest-schema.md` and `references/page-kind-boundaries.md`. When changing batch orchestration, write behavior, cross-reference behavior, or batch summaries, also read `references/batch-and-commit.md` and `references/batch-summary.md`.

## Examples

- User: "ingest this paper digest into the wiki" -> use `paper-ingest`.
- User: "update wiki pages from this PaperDigest" -> use `paper-ingest`.
- User: "choose which pages this paper should create or update" -> use `paper-ingest`.
- User: "ingest all these papers" -> use `paper-ingest-batch`, not single-paper ingest alone.

## Workflow

1. Start from a structured `PaperDigest`, not raw paper text. Use `paper-digest` first if no digest exists.
2. Retrieve existing wiki context before planning. Prefer existing pages over near-duplicates.
3. Plan the affected pages and action types: create, update, or append.
4. Materialize only the planned pages.
5. Add Obsidian-style wikilinks for cross references.
6. Preserve contradictions, qualifications, and uncertainty instead of overwriting older claims silently.
7. Leave global batch operations to the orchestrator: final index, hot cache, log, and batch summary.

## Core Page Kinds

Use only these literature wiki page kinds:

- `paper`: source anchor for one paper.
- `research_question`: explicit question the literature is trying to answer.
- `method`: reusable method, architecture, algorithm, protocol, instrument, or analysis procedure.
- `benchmark`: dataset, benchmark suite, task set, metric bundle, or standardized evaluation resource.
- `finding`: empirical, observational, or reported scientific result grounded in evidence.
- `formal_result`: theorem, lemma, corollary, proposition, conjecture, bound, guarantee, or related formal statement.
- `claim`: proposition or debate position that can be supported, contradicted, or qualified.
- `topic`: area of inquiry with scope, recurring threads, and open questions.
- `synthesis`: durable cross-page analysis that does not naturally belong to one topic or claim.

## Schema Contract

Use the current `PaperIngestPlan` and `LiteratureWikiPage` contracts as canonical.

Planning outputs must use `PaperIngestPlan` fields: `paperKey`, `paperTitle`, `schemaFamily`, `ingestObjective`, `summary`, `pageUpdates`, `claimUpdates`, `topicUpdates`, and `logEntry`.

Materialized pages must include the current `schemaVersion` field and one of the supported `LiteratureWikiPage` variants.

## Synthesis Boundary

Prefer topic pages for common conclusions under one topic.

Prefer claim pages for support, contradiction, qualification, and evidence around one proposition.

Create or update synthesis pages only when the object is a durable view across multiple topics, claims, methods, or evaluation frames. Do not create synthesis merely because several papers share a topic.

## Cross References

When a page mentions another durable wiki object, link it with `[[page_key]]`.

During ingest planning, existing page hints are critical. They should include page summaries, source paper keys, related page keys, and key facts when available. Without them, the planner tends to create duplicate methods, topics, claims, and findings.

When code changes are needed, preserve the schema contract instead of adding a parallel flow.
