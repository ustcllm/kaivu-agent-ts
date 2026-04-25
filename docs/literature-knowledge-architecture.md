# Literature Knowledge Architecture

This document defines the intended split between the literature runtime state and the persistent literature wiki, following the LLM Wiki pattern.

## Core Principle

The persistent literature wiki is the long-term, human-browsable source of truth for compiled literature knowledge.

The runtime store is the execution-time support layer used for review workflows, retrieval traces, and temporary orchestration state.

The paper digest layer is a reusable compiled asset layer that sits between raw sources and the wiki.

## Storage Layout

At the user level, literature data should be split into two sibling roots:

```text
.kaivu/users/<userId>/literature/
  digests/
    paper-digests/
    paper-digests.manifest.json
    paper-digest-failures.json

  wiki/
    index.md
    log.md
    hot.md
    indexes/
    <discipline>/
```

This keeps reusable paper-digest assets separate from the persistent markdown wiki.

## Wiki Layers

### Raw Sources

Immutable source material such as paper PDFs, paper URLs, metadata, and later non-paper raw sources.

### Paper Digest

`PaperDigest` is a reusable structured understanding of one paper. It is not the wiki itself.

It captures:

- what the paper is
- what it claims
- what evidence it uses
- what limitations it reports
- what research style it belongs to

### Persistent Literature Wiki

The wiki owns long-lived markdown knowledge objects.

Content pages include:

- paper pages
- author pages
- concept pages
- method pages
- task pages
- evidence source pages
- evaluation setup pages
- measure pages
- claim pages
- topic pages
- synthesis pages
- overview page

Wiki page frontmatter should carry lightweight cross-cutting metadata where possible:

- `discipline`: the primary wiki organization key for the page
- `domain_scope`: lightweight domain/topic scope labels that help navigation and linting

Special files include:

- `index.md`: content-oriented catalog of the wiki
- `log.md`: append-only chronological timeline of ingests and maintenance passes
- `hot.md`: compact recent-context cache for the newest ingest and maintenance state
- `discipline/_index.md`: detail index for each discipline directory
- per-folder `_index.md` files: sub-indexes for each page-kind directory
- `indexes/by-page-kind.md`: navigation across page-kind folders
- `indexes/by-discipline.md`: top-level navigation across supported disciplines

`log.md` is the primary chronology layer. There are no separate log content pages.

## Important Concept Boundaries

### `index.md`

`index.md` is a navigation catalog, not a synthesis page. It lists wiki pages by category with one-line summaries and lightweight metadata so the LLM can find relevant pages quickly.

It should also point to the secondary navigation layers:

- page-kind indexes
- discipline indexes
- overview
- chronology and recent-context files

### `log.md`

`log.md` is chronological, append-only, and operational. It records ingests and lint passes so the wiki has a visible timeline.

### `hot.md`

`hot.md` is a short recent-context cache. It is not the source of truth, and it is not a substitute for `index.md`.

Its job is to help the LLM quickly recover:

- what changed recently
- what the latest important claims are
- which topics or syntheses are currently active
- what open questions remain

### `overview`

`overview` is a top-level content entry page and executive summary. It should first explain the current big picture of the wiki, then point the reader to the major themes, syntheses, key claims, and where to start.

It is not a health dashboard.

### `synthesis`

`synthesis` is a content page for cross-source integration: comparisons, evolving judgments, topic-level synthesis, and other higher-order compiled views.

It should read as an integrated view first: the page should surface a compact takeaway and the current state of play before expanding into supporting comparison points.

It is not the same thing as `overview`.

It should not be created automatically just because a topic exists. A synthesis page should exist when there is a real cross-source integrated view worth maintaining.

In batch ingest, a cross-reference pass may create or update synthesis pages, but only when the overlap is substantial enough to justify a durable cross-paper view.

Contradictions and tensions should be rendered explicitly inside synthesis pages when they are real parts of the current integrated picture. They should not live only in external maintenance reports.

### `claim` vs `topic` vs `synthesis`

- `claim` pages track propositions, judgments, or debate positions that can be supported, contradicted, or qualified by evidence.
- `topic` pages organize an area: scope, recurring subthreads, and open questions.
- `synthesis` pages integrate across papers: comparisons, state-of-the-debate summaries, and higher-order compiled takeaways.

These should not collapse into each other:

- a theme label is not a claim
- a topic page is not automatically a synthesis page
- a synthesis page should exist only when there is a real integrated view worth preserving

Topic pages may carry lightweight `open tensions` summaries so disagreements remain visible during navigation, but they should not replace claim pages or synthesis pages as the primary home for debate state.

In batch ingest, claim status should be re-evaluated conservatively: multiple papers may strengthen a claim, but a batch pass should not overstate certainty when the evidence remains thin or qualified.

Claim pages should also make contradiction and tension visible as first-class page content, not just as an inferred status code or a lint finding.

### `lint`

`LiteratureLint` is a maintenance operation, not a content page kind. It checks the health of the wiki and may write a lint report plus a `log.md` entry.

## Responsibilities

### Persistent Literature Wiki

The wiki should own long-lived, user-facing knowledge objects and special navigation/history files:

- page content
- cross-references
- overview
- syntheses
- `index.md`
- `log.md`

### Paper Digest

The paper digest layer should own reusable compiled paper assets:

- paper digest cache
- canonical paper identity reuse
- paper digest failures and retry state

### Literature Review Runtime Store

The runtime store should own structured execution-time support data for review workflows:

- citation lookup records
- runtime pages used during review execution
- review-time claims/conflicts/syntheses that have not yet been promoted into the wiki
- source retrieval traces

The runtime store should not become the long-term source of truth for compiled wiki pages.

## Practical Rule

When adding a new literature feature, decide first:

1. Is this a reusable compiled paper asset?
2. Is this a review-time runtime helper?
3. Or is this a persistent wiki knowledge object the LLM should maintain over time?

If the answer is:

- compiled paper asset -> add it to the paper digest layer
- runtime helper -> add it to the literature review runtime layer
- persistent knowledge object -> add it to the literature wiki layer

## Current Pipeline

The intended pipeline is:

```text
raw paper source
-> paper digest
-> paper ingest
-> persistent wiki pages + index.md + log.md
```

`LiteratureLint` periodically checks the resulting wiki and records maintenance findings without becoming the wiki itself.

When integrating these layers in application code, prefer:

- `userLiteratureDigestRoot(...)` for digest assets
- `userLiteratureWikiRoot(...)` for wiki markdown files

and avoid placing both directly into the same directory root.

## Wiki Retrieval

The wiki should expose a retrieval-facing API as a top-level operation:

- `WikiRetrieve`: the public retrieval entry point

Internally, retrieval may perform search as one step, but the public concept should stay centered on retrieval rather than exposing raw search as the primary workflow.
`WikiRetrieve` should require an explicit `disciplineScope` from upstream problem framing rather than inferring it silently at retrieval time.

The internal search step should be replaceable behind a dedicated backend interface:

- `WikiSearch`: internal search backend contract
- `NaiveWikiSearch`: the default local markdown search implementation

This keeps retrieval behavior stable while allowing future backends such as `qmd` to plug in without changing the retrieval protocol itself.

Retrieval modes should be named after the reading objective, not after a page kind. For example, a broad top-level reading mode should be described as `landscape`, not `overview_first`, because `overview` remains a specific page type with a narrower semantic role.

In practice, retrieval should:

1. load wiki pages
2. search for relevant matches
3. weight by page kind and discipline scope
4. optionally expand through explicit wiki links
5. return a compact reading set and rationale
