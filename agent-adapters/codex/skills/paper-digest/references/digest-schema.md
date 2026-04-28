# Paper Digest Schema Contract

This skill is bound to the current code contract. The durable digest type is named `PaperDigest`; do not invent a parallel schema unless the implementation is migrated.

## Runtime Record

`PaperDigest` is the persisted digest record. It includes:

- `id`: digest record id.
- `sourceId`: source identity from the ingest input.
- `canonicalPaperKey`: stable paper key used by wiki ingest.
- `sourceKind`: `pdf_url | pdf_file`.
- `discipline`: broad scientific discipline.
- `schemaFamily`: `computational_empirical | experimental_empirical | methodological_or_instrumentation | theoretical_or_mathematical | review_or_survey`.
- `selectionReason`: why this schema family was chosen.
- `doi`, `arxivId`, `title`, `citationLine`.
- `contentLevel`: `document | extracted_text`.
- `oneSentenceSummary`, `researchProblem`, `motivation`, `approach`.
- `keyContributions`, `keyClaims`, `findings`, `limitations`, `importantTerms`.
- `relatedWorkSignals`: prior work, competing approaches, follow-up directions, application areas.
- `specialized`: type-specific evidence such as methods, datasets, benchmarks, metrics, comparators, assumptions, proof strategy, taxonomy, controversies.
- `literatureReviewUse`: whether the paper is a terminology anchor, method anchor, benchmark anchor, baseline, evidence source, survey/map, limitation/failure, or contrastive evidence.
- `uncertainty`: source limitations and extraction caveats.
- `createdAt`: record creation timestamp.

## Model Output

`PaperDigestModelOutput` is the model-facing shape. It omits runtime identity fields and must include:

- `discipline`
- `schemaFamily`
- `selectionReason`
- `title`
- `citationLine`
- `oneSentenceSummary`
- `abstractSummary`
- `researchProblem`
- `motivation`
- `approach`
- `keyContributions`
- `keyClaims`
- `findings`
- `limitations`
- `importantTerms`
- `relatedWorkSignals`
- `specialized`
- `literatureReviewUse`
- `uncertainty`

## Specialized Fields

Always keep all five specialized groups present, even if most arrays are empty:

- `computationalEmpirical`: methods, methodFamily, datasets, benchmarks, metrics, comparators, failureModesOrRisks.
- `experimentalEmpirical`: studySystemOrSamples, experimentalDesign, protocolsOrAssays, measurementEndpoints, controlsOrComparators, sourcesOfBias.
- `methodologicalOrInstrumentation`: resourceType, resourceScope, primaryUseCases, evaluationSetup, comparators, adoptionConstraints.
- `theoreticalOrMathematical`: formalSetting, assumptions, mainResults, proofStrategy, scopeOfApplicability, openProblems.
- `reviewOrSurvey`: reviewScope, selectionCriteria, taxonomy, synthesisMethod, evidenceGaps, controversies.

## Ingest Use Values

`literatureReviewUse.usefulAs` must use only:

- `terminology_anchor`
- `method_anchor`
- `benchmark_anchor`
- `baseline`
- `empirical_evidence`
- `survey_or_map`
- `limitation_or_failure`
- `contrastive_evidence`

Keep the digest source-grounded. If a field is not visible in the source, leave it empty or add an uncertainty note.
