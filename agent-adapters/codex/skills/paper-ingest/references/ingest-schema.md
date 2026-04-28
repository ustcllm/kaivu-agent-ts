# Paper Ingest Schema Contract

This skill is bound to the current code contract. The single-paper ingest planner is named `PaperIngestPlan`; do not invent a parallel ingest schema unless the implementation is migrated.

## Plan Shape

`PaperIngestPlan` must include:

- `paperKey`: canonical paper page key.
- `paperTitle`: paper title.
- `schemaFamily`: same enum used by the digest.
- `ingestObjective`: what this ingest should change in the wiki.
- `summary`: 2 to 4 sentence impact summary.
- `pageUpdates`: planned non-claim/non-topic page operations.
- `claimUpdates`: claim-specific support, contradiction, qualification, or organization operations.
- `topicUpdates`: topic-specific operations.
- `logEntry`: title, summary, affectedPageKeys, notes.

## Page Update Shape

Each `pageUpdates` item must include:

- `pageKind`: `paper | research_question | method | benchmark | finding | formal_result | claim | topic | synthesis`.
- `pageKey`: stable slug-like key.
- `title`: human-readable page title.
- `action`: `create | update | append`.
- `rationale`: why this paper should affect the page.
- `priority`: `primary | secondary`.
- `patchOutline`: concrete changes to make.

## Claim Update Shape

Each `claimUpdates` item must include:

- `claimKey`
- `claimText`
- `action`: `create | update`
- `effect`: `supports | contradicts | qualifies | organizes`
- `rationale`
- `evidenceNotes`

## Topic Update Shape

Each `topicUpdates` item must include:

- `topicKey`
- `title`
- `action`: `create | update`
- `rationale`
- `topicThreads`

## Existing Page Hints

`PaperIngestExistingPageHint` is a first-class planning input. Use it to prevent duplicate pages.

Each hint may include:

- `pageKind`
- `pageKey`
- `title`
- `summary`
- `sourcePaperKeys`
- `relatedPageKeys`
- `keyFacts`

## Wiki Page Base Schema

Every materialized wiki page must include:

- `schemaVersion`
- `discipline`
- `kind`
- `pageKey`
- `title`
- `summary`
- `tags`
- `aliases`
- `sourcePaperKeys`
- `updatedAt`
- `domainScope`

Treat `schemaVersion` as an implementation-owned page schema version. Do not hard-code product-specific version strings into skills.

## Wiki Page Variants

Supported `kind` values and variant-specific fields:

- `paper`: canonicalPaperKey, schemaFamily, selectionReason, citationLine, researchProblem, approach, keyContributions, keyClaims, findings, limitations, importantTerms, relatedPageKeys.
- `research_question`: question, motivation, currentAnswer, relatedTopicKeys, claimPageKeys, findingPageKeys, methodPageKeys, benchmarkKeys, openSubquestions, relatedPageKeys.
- `method`: methodStatement, mechanism, assumptions, inputs, outputs, variants, baselines, failureModes, relatedBenchmarkKeys, relatedFindingKeys, relatedFormalResultKeys, relatedPageKeys.
- `benchmark`: benchmarkStatement, evaluates, datasetOrSuite, metrics, knownCaveats, usedByPaperKeys, relatedMethodKeys, relatedFindingKeys, relatedPageKeys.
- `finding`: findingStatement, evidenceType, supportingPaperKeys, relatedMethodKeys, relatedBenchmarkKeys, supportsClaimKeys, qualifiesClaimKeys, contradictsClaimKeys, caveats, relatedPageKeys.
- `formal_result`: formalResultType, statement, assumptions, proofIdea, dependsOnResultKeys, supportsClaimKeys, relatedMethodKeys, limitations, relatedPageKeys.
- `claim`: claimText, claimStatus, supportPaperKeys, contradictPaperKeys, qualifyPaperKeys, topicPageKeys, contradictions, tensions, notes.
- `topic`: topicStatement, scopeNotes, currentThreads, keyPageKeys, claimPageKeys, openTensions, openQuestions.
- `synthesis`: synthesisStatement, integratedTakeaway, scopeNotes, stateOfPlay, synthesis, keyPageKeys, claimPageKeys, contradictions, tensions, openQuestions.

Do not add `overview` pages. The overview kind has been removed.
