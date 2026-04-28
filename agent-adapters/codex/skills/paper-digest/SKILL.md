---
name: paper-digest
description: Create or revise structured PaperDigest records from scientific papers, PDFs, PDF URLs, extracted paper text, abstracts, or paper metadata. Use when Codex needs to turn one paper into a reusable digest asset for literature review, paper ingest, wiki filing, citation-backed synthesis, or batch paper processing.
---

# Paper Digest

Produce a reusable structured understanding of one paper. A digest is an intermediate compiled asset, not a wiki page.

This skill is schema-bound. Before changing digest behavior, read `references/digest-schema.md` and preserve the named contract there. When changing caching, persistence, PDF capability handling, or failure recovery, also read `references/runtime-behavior.md`.

## Examples

- User: "digest this PDF for literature review" -> use `paper-digest`.
- User: "create a structured digest for this arXiv paper" -> use `paper-digest`.
- User: "extract claims, methods, benchmarks, and limitations from this paper" -> use `paper-digest`.
- User: "add this paper to the wiki" -> use `paper-digest` first if no digest exists, then `paper-ingest`.

## Workflow

1. Identify the source as a PDF URL, local PDF file, extracted full text, abstract, or metadata-only record.
2. Reuse an existing digest when the same canonical paper key is already present.
3. If creating a digest, extract only source-grounded information.
4. Preserve identifiers and technical names exactly: title, DOI, arXiv id, method names, benchmark names, datasets, metrics, theorems, and cited systems.
5. Distinguish full-document evidence from abstract-only or metadata-only evidence.
6. Record uncertainty explicitly instead of filling gaps from general knowledge.
7. Return a structured digest suitable for later `paper-ingest`.

## Schema Contract

Use the current `PaperDigest` contract as the canonical digest schema. The model-facing output must match the `PaperDigestModelOutput` shape; runtime records add ids, source identity, canonical key, source kind, content level, and timestamps.

Do not introduce an alternate digest shape unless the code schema has been migrated.

## Digest Boundary

Do:

- Summarize the paper's research problem, motivation, approach, contributions, claims, findings, limitations, important terms, and literature-review use.
- Classify the paper as computational empirical, experimental empirical, methodological/instrumentation, theoretical/mathematical, or review/survey when that taxonomy applies.
- Capture specialized fields that matter for later wiki pages, especially methods, benchmarks, findings, formal results, comparators, assumptions, proof ideas, datasets, metrics, and failure modes.
- Preserve extraction caveats so later synthesis can reason about evidence quality.

Do not:

- Create or update wiki pages.
- Decide cross-paper synthesis.
- Merge claims across multiple papers.
- Invent missing bibliographic details.
- Treat abstract-only metadata as full-paper evidence.

## Output Quality

The digest should let a later ingest step answer:

- What stable paper page should exist?
- Which existing wiki pages might this paper update?
- What claims, topics, methods, benchmarks, findings, research questions, or formal results are actually justified?
- What should stay uncertain until more source text is available?

When code changes are needed, preserve the schema contract instead of adding a parallel schema.
