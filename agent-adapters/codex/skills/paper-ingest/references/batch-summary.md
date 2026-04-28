# Paper Ingest Batch Summary

This reference covers `ingestBatchSummary`.

## Purpose

Batch summary is the integrated literature-review style answer returned to the caller after batch ingest. It is not automatically written as a synthesis page.

It should synthesize touched wiki pages and reused lookup pages into a compact literature review.

## Output Shape

`PaperIngestBatchSummaryResult` includes:

- `summary`
- `summaryTitle`
- `summaryMarkdown`
- `citations`
- `synthesis`
- `totalPapers`
- `ingestedPapers`
- `reusedExistingPapers`
- `failedPapers`
- `papers`
- `failures`
- `write`

The model-facing output must include:

- `summaryTitle`
- `summary`
- `summaryMarkdown`
- `citations`
- `synthesis`

## Citations

Each citation includes:

- `pageKey`
- `title`
- `pageKind`: `paper | research_question | method | benchmark | finding | formal_result | claim | topic | synthesis`
- `rationale`

`summaryMarkdown` should cite wiki pages with Obsidian wikilinks like `[[page_key]]`.

Every substantive paragraph should cite at least one touched or lookup page. If the model omits citations, fallback code should ensure important cited pages appear in the markdown.

## Synthesis Object

The returned `synthesis` object includes:

- `integratedTakeaway`
- `stateOfPlay`
- `tensions`
- `openQuestions`

This synthesis is retrieval-visible to the caller but is not automatically persisted as a synthesis page.

## Page Context

The summary context includes:

- pages produced by completed ingests
- cross-reference pages
- pages loaded from lookup index for reused or affected papers

Use existing lookup pages when they are relevant. This makes the summary read like literature review rather than an operation log.

## Style

Write `summaryMarkdown` like a compact literature review:

- group evidence by research question, method, benchmark, finding, formal result, claim, and topic when available
- compare papers and pages
- name common conclusions
- preserve disagreements, boundary conditions, and gaps
- mention failures only when they affect evidence coverage
