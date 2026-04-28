# Paper Search

Use this reference to find candidate papers from external literature sources. This is read-only discovery; it does not digest papers and does not update the wiki.

## Workflow

1. Start from a validated query, problem frame, or explicit user query.
2. Choose suitable sources for the domain and constraints.
3. Search multiple query families when the topic is exploratory.
4. Collect stable metadata: title, authors, year, venue, DOI, arXiv id, URL, abstract or snippet, and source.
5. Rank candidates by relevance, evidence fit, recency or foundational status, and source quality.
6. Mark duplicates and near-duplicates.
7. Return candidates with enough metadata for `paper-digest` or `paper-ingest-batch`.

## Source Selection

- arXiv for preprints, ML, physics, math, and quantitative fields
- Semantic Scholar or Crossref for broad scholarly discovery
- PubMed for biomedical literature
- ACM, IEEE, ACL Anthology, NeurIPS, ICLR, ICML, or domain venues when named or clearly relevant
- Google Scholar only as a fallback when direct sources are insufficient

When current papers, recent work, URLs, DOI status, or precise metadata matter, verify against live sources.

## Output

Return:

- `searchObjective`
- `queriesRun`
- `sourcesConsulted`
- `candidatePapers`: title, authors, year, venue, identifiers, URL, relevance rationale, evidence level, and caveats
- `rankedShortlist`
- `coverageGaps`
- `nextSteps`

Distinguish discovered candidates from papers actually read.
