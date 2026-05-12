# Search Query Generation

Use this reference to create external literature search queries. It prepares search; it does not execute search.

## Workflow

1. Extract objective, scope, key variables, constraints, and success criteria.
2. Identify must-have concepts, optional concepts, exclusions, and ambiguous terms.
3. Generate query families rather than one query.
4. Add synonyms, spelling variants, acronyms, and field-specific terminology.
5. Produce database-specific forms only when syntax or retrieval behavior changes.
6. State what each query should find and what it may miss.

## Query Families

Prefer a small complementary set:

- broad landscape query
- focused technical query
- method or mechanism query
- benchmark, dataset, metric, or evaluation query
- survey or review query
- recent work query when recency matters
- seed-paper expansion query when a title, DOI, author, or arXiv id is provided

## Output

Return:

- `searchObjective`
- `conceptGroups`: required, optional, excluded, and ambiguous terms
- `queries`: `label`, `query`, `targetSource`, `intent`, `expectedRecall`, `expectedPrecision`, `notes`
- `coverageRisks`
- `handoff`

Do not invent paper titles or citations.
