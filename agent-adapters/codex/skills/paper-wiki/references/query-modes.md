# Paper Wiki Query Modes

Use this reference when answering questions from the literature wiki.

## Quick

Use for simple facts and recent-context checks.

Read:

- `hot.md`
- `index.md`

Do not open individual pages unless quick mode fails.

If quick mode cannot answer from cache/index, return a gap and suggest standard mode.

## Standard

Use for most questions.

Read:

- `hot.md`
- `index.md`
- retrieved primary pages
- a small number of linked pages when they clarify claims, methods, benchmarks, or findings

Synthesize an answer with `[[page_key]]` citations. Say when the wiki lacks enough evidence.

Follow wikilinks only to depth 1 unless the linked page is necessary to interpret a claim, method, benchmark, finding, or formal result.

## Deep

Use for comparisons, broad syntheses, gap analysis, or user requests for thoroughness.

Read:

- hot and indexes
- all high-relevance retrieved pages
- linked claim/topic/method/benchmark/finding/formal_result pages needed to preserve context

Deep answers are candidates for saving as a `synthesis` page, but should only be written through an explicit save/query-save path.

Deep mode should still avoid whole-wiki reading when retrieval has already found the relevant page cluster.

## Citation Rules

- Cite wiki pages with Obsidian wikilinks.
- Every non-obvious claim should cite at least one page.
- Prefer citations to claim, finding, method, benchmark, formal result, topic, and paper pages over uncited prose.

## Gap Handling

If the wiki cannot answer well:

1. Say the wiki lacks enough evidence.
2. Name the missing page kind or evidence type.
3. Suggest targeted source ingestion or retrieval.
4. Do not fill paper-specific gaps from general model knowledge.
