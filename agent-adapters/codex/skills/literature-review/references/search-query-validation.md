# Search Query Validation

Use this reference to validate literature search queries before or after external literature search.

## Workflow

1. Compare each query against the problem frame, objective, scope, and success criteria.
2. Check required concepts, synonyms, acronyms, spelling variants, adjacent terminology, and excluded meanings.
3. Check recall, precision, false positives, false negatives, and over-constrained syntax.
4. Check whether the query suits the intended source.
5. Flag missing query families: survey, benchmark, method, mechanism, recent work, or seed-paper expansion.
6. Return revised queries only when revision is needed.

## Output

Return:

- `verdict`: `ready | revise | insufficient_context`
- `mainIssues`
- `coverageAssessment`
- `riskAssessment`
- `revisedQueries`
- `searchReadiness`

## Ready Bar

A ready query plan should cover the objective, include synonyms for recall, include constraints for precision, expose ambiguities, and be executable in the intended source.

Do not search the web unless the user explicitly asks to run the search.
