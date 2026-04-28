import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { makeId } from "../shared/ids.js";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  type StructuredSchema,
} from "../structured/StructuredOutput.js";

export type PaperDigestContentLevel = "document" | "extracted_text";
export type PaperDigestSourceKind = "pdf_url" | "pdf_file";
export type PaperDigestSchemaFamily =
  | "computational_empirical"
  | "experimental_empirical"
  | "methodological_or_instrumentation"
  | "theoretical_or_mathematical"
  | "review_or_survey";

export type LiteratureDiscipline =
  | "artificial_intelligence"
  | "mathematics"
  | "chemistry"
  | "chemical_engineering"
  | "physics"
  | "general_science"
  | "unknown";

export type PaperLiteratureUse =
  | "terminology_anchor"
  | "method_anchor"
  | "benchmark_anchor"
  | "baseline"
  | "empirical_evidence"
  | "survey_or_map"
  | "limitation_or_failure"
  | "contrastive_evidence";

export interface PaperRelatedWorkSignals {
  namedPriorWork: string[];
  competingApproaches: string[];
  followUpDirections: string[];
  applicationAreas: string[];
}

export interface PaperDigestLiteratureReviewUse {
  usefulAs: PaperLiteratureUse[];
  searchTerms: string[];
  expansionDirections: string[];
}

export interface PaperDigestSpecializedFields {
  computationalEmpirical: {
    methods: string[];
    methodFamily: string[];
    datasets: string[];
    benchmarks: string[];
    metrics: string[];
    comparators: string[];
    failureModesOrRisks: string[];
  };
  experimentalEmpirical: {
    studySystemOrSamples: string[];
    experimentalDesign: string[];
    protocolsOrAssays: string[];
    measurementEndpoints: string[];
    controlsOrComparators: string[];
    sourcesOfBias: string[];
  };
  methodologicalOrInstrumentation: {
    resourceType: string[];
    resourceScope: string[];
    primaryUseCases: string[];
    evaluationSetup: string[];
    comparators: string[];
    adoptionConstraints: string[];
  };
  theoreticalOrMathematical: {
    formalSetting: string[];
    assumptions: string[];
    mainResults: string[];
    proofStrategy: string[];
    scopeOfApplicability: string[];
    openProblems: string[];
  };
  reviewOrSurvey: {
    reviewScope: string[];
    selectionCriteria: string[];
    taxonomy: string[];
    synthesisMethod: string[];
    evidenceGaps: string[];
    controversies: string[];
  };
}

export interface PaperDigest {
  id: string;
  sourceId: string;
  canonicalPaperKey: string;
  sourceKind: PaperDigestSourceKind;
  discipline: LiteratureDiscipline;
  schemaFamily: PaperDigestSchemaFamily;
  selectionReason: string;
  doi?: string | null;
  arxivId?: string | null;
  title: string;
  citationLine?: string | null;
  contentLevel: PaperDigestContentLevel;
  oneSentenceSummary: string;
  abstractSummary?: string | null;
  researchProblem: string;
  motivation: string;
  approach: string;
  keyContributions: string[];
  keyClaims: string[];
  findings: string[];
  limitations: string[];
  importantTerms: string[];
  relatedWorkSignals: PaperRelatedWorkSignals;
  specialized: PaperDigestSpecializedFields;
  literatureReviewUse: PaperDigestLiteratureReviewUse;
  uncertainty: string[];
  createdAt: string;
}

export interface PaperDigestModelOutput {
  discipline: LiteratureDiscipline;
  schemaFamily: PaperDigestSchemaFamily;
  selectionReason: string;
  title: string;
  citationLine: string | null;
  oneSentenceSummary: string;
  abstractSummary: string | null;
  researchProblem: string;
  motivation: string;
  approach: string;
  keyContributions: string[];
  keyClaims: string[];
  findings: string[];
  limitations: string[];
  importantTerms: string[];
  relatedWorkSignals: PaperRelatedWorkSignals;
  specialized: PaperDigestSpecializedFields;
  literatureReviewUse: PaperDigestLiteratureReviewUse;
  uncertainty: string[];
}

export interface PaperDigestMetadata {
  pdfUrl?: string;
}

export interface PaperDigestPromptInput {
  sourceKind: PaperDigestSourceKind;
  metadata: PaperDigestMetadata;
  contentLevel: PaperDigestContentLevel;
  disciplineHint?: LiteratureDiscipline;
  paperContent: string;
}

export interface PaperDigestPdfUrlInput {
  kind: "pdf_url";
  sourceId: string;
  pdfUrl: string;
  disciplineHint?: LiteratureDiscipline;
}

export interface PaperDigestPdfFileInput {
  kind: "pdf_file";
  sourceId: string;
  path: string;
  disciplineHint?: LiteratureDiscipline;
}

export type PaperDigestInput = PaperDigestPdfUrlInput | PaperDigestPdfFileInput;

export type PaperDigestFailureReason =
  | "paper_digest_requires_pdf_url"
  | "paper_digest_pdf_file_not_supported_yet"
  | "paper_digest_pdf_unreachable"
  | "paper_digest_pdf_access_blocked"
  | "paper_digest_provider_unsupported"
  | "paper_digest_model_failed"
  | "paper_digest_output_invalid";

export type PaperDigestResult =
  | { status: "completed"; digest: PaperDigest }
  | {
      status: "failed";
      sourceId: string;
      canonicalPaperKey?: string;
      sourceKind: PaperDigestSourceKind;
      reason: PaperDigestFailureReason;
      detail: string;
      retryable: boolean;
      retryCount: number;
      autoRepairPlan: string[];
    };

export interface PaperDigestFailureRecord extends Omit<Extract<PaperDigestResult, { status: "failed" }>, "status"> {
  id: string;
  status: "failed";
  createdAt: string;
  updatedAt: string;
  failureStatus: "pending_retry" | "needs_user_help" | "resolved" | "abandoned";
}

export interface PaperDigestRecoveryPolicy {
  maxAutoRetries: number;
}

export const DEFAULT_PAPER_DIGEST_RECOVERY_POLICY: PaperDigestRecoveryPolicy = {
  maxAutoRetries: 2,
};

export const PAPER_LITERATURE_USE_VALUES: readonly PaperLiteratureUse[] = [
  "terminology_anchor",
  "method_anchor",
  "benchmark_anchor",
  "baseline",
  "empirical_evidence",
  "survey_or_map",
  "limitation_or_failure",
  "contrastive_evidence",
];

export const PAPER_DIGEST_MODEL_OUTPUT_SHAPE = {
  discipline: "artificial_intelligence | mathematics | chemistry | chemical_engineering | physics | general_science | unknown",
  schemaFamily: "computational_empirical | experimental_empirical | methodological_or_instrumentation | theoretical_or_mathematical | review_or_survey",
  selectionReason: "string",
  title: "string",
  citationLine: "string | null",
  oneSentenceSummary: "string",
  abstractSummary: "string | null",
  researchProblem: "string",
  motivation: "string",
  approach: "string",
  keyContributions: ["string"],
  keyClaims: ["string"],
  importantTerms: ["string"],
  findings: ["string"],
  limitations: ["string"],
  relatedWorkSignals: {
    namedPriorWork: ["string"],
    competingApproaches: ["string"],
    followUpDirections: ["string"],
    applicationAreas: ["string"],
  },
  specialized: {
    computationalEmpirical: {
      methods: ["string"],
      methodFamily: ["string"],
      datasets: ["string"],
      benchmarks: ["string"],
      metrics: ["string"],
      comparators: ["string"],
      failureModesOrRisks: ["string"],
    },
    experimentalEmpirical: {
      studySystemOrSamples: ["string"],
      experimentalDesign: ["string"],
      protocolsOrAssays: ["string"],
      measurementEndpoints: ["string"],
      controlsOrComparators: ["string"],
      sourcesOfBias: ["string"],
    },
    methodologicalOrInstrumentation: {
      resourceType: ["string"],
      resourceScope: ["string"],
      primaryUseCases: ["string"],
      evaluationSetup: ["string"],
      comparators: ["string"],
      adoptionConstraints: ["string"],
    },
    theoreticalOrMathematical: {
      formalSetting: ["string"],
      assumptions: ["string"],
      mainResults: ["string"],
      proofStrategy: ["string"],
      scopeOfApplicability: ["string"],
      openProblems: ["string"],
    },
    reviewOrSurvey: {
      reviewScope: ["string"],
      selectionCriteria: ["string"],
      taxonomy: ["string"],
      synthesisMethod: ["string"],
      evidenceGaps: ["string"],
      controversies: ["string"],
    },
  },
  literatureReviewUse: {
    usefulAs: ["terminology_anchor | method_anchor | benchmark_anchor | baseline | empirical_evidence | survey_or_map | limitation_or_failure | contrastive_evidence"],
    searchTerms: ["string"],
    expansionDirections: ["string"],
  },
  uncertainty: ["string"],
} as const;

const PAPER_DIGEST_SCHEMA_FAMILY_GUIDANCE = [
  "Schema-family selection rubric:",
  "- computational_empirical: choose this when the paper's main evidence comes from implemented systems, models, simulations, datasets, benchmarks, metrics, ablations, or empirical comparisons between methods.",
  "- experimental_empirical: choose this when the paper's main evidence comes from experiments on physical, biological, medical, chemical, material, or human-participant systems, including samples, assays, interventions, measurements, controls, cohorts, or study design.",
  "- methodological_or_instrumentation: choose this when the paper's main contribution is a reusable resource, tool, benchmark suite, dataset, platform, workflow, measurement instrument, software system, or evaluation framework, even if it also reports some empirical validation.",
  "- theoretical_or_mathematical: choose this when the paper's main contribution is formalization, theorem/proposition-style results, proofs, derivations, formal guarantees, impossibility results, or rigorous analytical constructions rather than empirical evaluation.",
  "- review_or_survey: choose this when the paper's primary purpose is to review, map, organize, synthesize, benchmark across prior work at a survey level, or summarize an existing literature rather than introduce one new primary method or experiment.",
  "",
  "Disambiguation rules:",
  "- Choose based on the paper's primary contribution and evidence style, not just its application domain.",
  "- A machine-learning paper with benchmarks and ablations is usually computational_empirical, even if it studies biology, medicine, economics, or another non-CS domain.",
  "- A biology, chemistry, medical, or materials paper with wet-lab, clinical, observational, or human-subject evidence is usually experimental_empirical.",
  "- A dataset paper, benchmark-suite paper, tooling paper, platform paper, software-system paper, or instrumentation paper is often methodological_or_instrumentation when the resource itself is the main contribution.",
  "- Example: a paper whose main contribution is releasing a dataset, benchmark suite, software toolkit, shared platform, or reusable measurement workflow should usually be methodological_or_instrumentation.",
  "- Example: a paper that introduces a new model and evaluates it against baselines is usually computational_empirical, even if it also releases code.",
  "- Example: a survey that organizes tools, datasets, and benchmarks across a field is usually review_or_survey, not methodological_or_instrumentation.",
  "- A theory paper in computer science, mathematics, economics, or physics is usually theoretical_or_mathematical when proofs or formal analysis are central.",
  "- A survey, systematic review, meta-analysis, or taxonomy paper is usually review_or_survey, even if it discusses methods and benchmarks.",
  "- If a paper mixes modes, pick the family that best reflects the main contribution and the strongest evidence in the paper.",
].join("\n");

const PAPER_DIGEST_DISCIPLINE_GUIDANCE = [
  "Discipline selection rubric:",
  "- Choose exactly one discipline label that best matches the paper's primary scientific field or downstream wiki organization.",
  "- Allowed labels: artificial_intelligence, mathematics, chemistry, chemical_engineering, physics, general_science, unknown.",
  "- Use artificial_intelligence for machine learning, AI systems, NLP, computer vision, mechanistic interpretability, or related AI-method papers.",
  "- Use mathematics for primarily mathematical work, theorem-driven analysis, formal mathematics, or math-centric theory papers.",
  "- Use chemistry for chemistry papers whose primary field is chemistry rather than engineering.",
  "- Use chemical_engineering for process, systems, reactor, separation, or engineering-oriented chemical research.",
  "- Use physics for physics papers whose primary field is physics.",
  "- Use general_science when the paper is clearly scientific but mixed-discipline, broadly cross-disciplinary, or does not fit one allowed discipline cleanly.",
  "- Use unknown only when the available paper content is too limited to infer a discipline reliably.",
  "- Choose based on the paper's field, not just its research style. A paper may be computational_empirical but still belong to chemistry or physics.",
].join("\n");

export function renderPaperDigestPrompt(input: PaperDigestPromptInput): string {
  const paperContent = input.paperContent.trim() || "No paper content was provided.";

  return [
    "You are reading a research paper and producing a reusable structured digest for future literature review.",
    "",
    "Do not tailor the digest to any current user question, project, or task.",
    "Do not describe the paper as a seed paper.",
    "",
    "Extract stable information about the paper itself:",
    "- which discipline best fits the paper for wiki organization",
    "- which schema family best fits the paper",
    "- why that schema family is the best fit",
    "- what problem it addresses",
    "- why the problem matters",
    "- what approach it proposes or studies",
    "- what claims, findings, limitations, and failure modes it reports",
    "- what terms, methods, related work signals, and expansion directions could help future literature review",
    "- what discipline- or genre-specific details belong in the specialized section",
    "",
    "Use only the paper content or paper PDF link provided below.",
    "Only include details supported by the available paper content or the paper PDF reachable from the provided PDF URL.",
    "If full text is unavailable, mark uncertainty explicitly.",
    "Do not infer experimental results, datasets, baselines, metrics, or claims that are not supported by the provided content.",
    "",
    "# Available Paper Content",
    "",
    `Source kind: ${input.sourceKind}`,
    `Content level: ${input.contentLevel}`,
    `Discipline hint: ${input.disciplineHint ?? "none"}`,
    "",
    paperContent,
    "",
    "# Field Rules",
    "",
    "- The caller, not the model, determines sourceKind and contentLevel.",
    "- disciplineHint, when provided, is a weak upstream hint. Follow the paper itself over the hint whenever they conflict.",
    "- Choose exactly one discipline label: artificial_intelligence, mathematics, chemistry, chemical_engineering, physics, general_science, or unknown.",
    PAPER_DIGEST_DISCIPLINE_GUIDANCE,
    "- Choose exactly one schemaFamily that best matches the paper: computational_empirical, experimental_empirical, methodological_or_instrumentation, theoretical_or_mathematical, or review_or_survey.",
    "- selectionReason must be a single concise sentence explaining why the chosen schemaFamily best matches the paper's primary contribution and evidence style.",
    PAPER_DIGEST_SCHEMA_FAMILY_GUIDANCE,
    "- Fill the specialized subsection matching schemaFamily with concrete content from the paper.",
    "- For the other specialized subsections, return empty arrays for every field.",
    "- If source kind is pdf_url and content level is document, read the paper from the provided PDF URL and base the digest on that paper. If the PDF cannot be read, state the access failure in uncertainty.",
    "- If source kind is pdf_file and content level is document, read the attached PDF file when available.",
    "- If content level is extracted_text, use only the provided extracted text.",
    "- If the provided content does not explicitly support a specialized field, return [] for that field.",
    "- importantTerms may include technical terms visibly present in the title, abstract, or paper text.",
    "- relatedWorkSignals.namedPriorWork should only include prior work explicitly named in the provided content.",
    "- literatureReviewUse.usefulAs describes the paper's general value for future literature review, not its value for a current task.",
    "- literatureReviewUse.searchTerms should contain reusable scholarly search terms, not raw URLs.",
    "- literatureReviewUse.expansionDirections should describe general directions for discovering related literature, not task-specific recommendations.",
    "- uncertainty should record missing full text, ambiguous claims, missing experimental details, unavailable evaluation information, or fields that could not be completed from the provided content.",
    "",
    "# Output",
    "",
    "Return valid JSON only.",
    "Do not include Markdown.",
    "Do not include comments.",
    "Match this JSON shape exactly:",
    "",
    JSON.stringify(PAPER_DIGEST_MODEL_OUTPUT_SHAPE, null, 2),
  ].join("\n");
}

export interface PaperDigestModelStepOptions {
  stepId?: string;
  system?: string;
  prompt: string;
  includeRenderedContext?: boolean;
  stream?: boolean;
  hostedWebSearch?: boolean;
  attachments?: Array<{
    kind: "pdf_url" | "pdf_file";
    url?: string;
    path?: string;
    filename?: string;
    mediaType?: "application/pdf";
  }>;
  stageUserInputPolicy?: string | string[] | false;
}

export type PaperDigestModelStepRunner = (options: PaperDigestModelStepOptions) => Promise<string>;

export interface PaperDigestCapabilities {
  pdfUrlReadSupport: "hosted_web_search" | "native" | "unsupported";
  pdfFileReadSupport: "native" | "unsupported";
}

export interface PaperDigestManifestEntry {
  input: PaperDigestInput;
  digest: PaperDigest;
}

export interface PaperDigestManifestRecord {
  canonicalPaperKey: string;
  sourceId: string;
  sourceKind: PaperDigestSourceKind;
  digestFile: string;
  updatedAt: string;
}

interface PersistedPaperDigestEntryFile {
  schemaVersion: 1;
  updatedAt: string;
  entry: PaperDigestManifestEntry;
}

interface PersistedPaperDigestFailureFile {
  schemaVersion: 1;
  updatedAt: string;
  failures: PaperDigestFailureRecord[];
}

interface PersistedPaperDigestManifestFile {
  schemaVersion: 1;
  updatedAt: string;
  records: PaperDigestManifestRecord[];
}

export class PaperDigests {
  private readonly paperDigests = new Map<string, PaperDigestManifestEntry>();
  private readonly paperDigestsByCanonicalKey = new Map<string, PaperDigestManifestEntry>();
  private readonly paperDigestManifest = new Map<string, PaperDigestManifestRecord>();
  private readonly paperDigestFailures: PaperDigestFailureRecord[] = [];
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly modelStep?: PaperDigestModelStepRunner,
    private readonly recoveryPolicy: PaperDigestRecoveryPolicy = DEFAULT_PAPER_DIGEST_RECOVERY_POLICY,
  private readonly capabilities: PaperDigestCapabilities = {
      pdfUrlReadSupport: "unsupported",
      pdfFileReadSupport: "unsupported",
    },
    private readonly root?: string,
  ) {}

  static async load(root: string): Promise<PaperDigests> {
    const service = new PaperDigests(undefined, DEFAULT_PAPER_DIGEST_RECOVERY_POLICY, {
      pdfUrlReadSupport: "unsupported",
      pdfFileReadSupport: "unsupported",
    }, root);
    await service.ensureLayout();
    await service.restoreFromDisk();
    return service;
  }

  lookupPaperDigest(input: PaperDigestInput): PaperDigest | undefined {
    const key = paperDigestCacheKey(input);
    const digest = this.paperDigests.get(key) ?? this.paperDigestsByCanonicalKey.get(paperCanonicalLookupKey(input));
    return digest ? clonePaperDigest(digest.digest) : undefined;
  }

  recordPaperDigest(input: PaperDigestInput, digest: PaperDigest): void {
    const key = paperDigestCacheKey(input);
    const entry = {
      input: clonePaperDigestInput(input),
      digest: clonePaperDigest(digest),
    };
    this.paperDigests.set(key, entry);
    this.paperDigestsByCanonicalKey.set(digest.canonicalPaperKey, entry);
    this.paperDigestManifest.set(digest.canonicalPaperKey, buildPaperDigestManifestRecord(entry));
    this.enqueuePersist(async () => {
      await this.persistDigest(digest.canonicalPaperKey, entry);
      await this.persistManifest();
    });
  }

  recordPaperDigestFailure(failure: Extract<PaperDigestResult, { status: "failed" }>): PaperDigestFailureRecord {
    const now = new Date().toISOString();
    const existing = this.paperDigestFailures.find((item) =>
      (item.canonicalPaperKey && failure.canonicalPaperKey
        ? item.canonicalPaperKey === failure.canonicalPaperKey
        : item.sourceId === failure.sourceId) &&
      item.sourceKind === failure.sourceKind &&
      item.reason === failure.reason &&
      item.failureStatus !== "resolved",
    );
    let record: PaperDigestFailureRecord;
    if (existing) {
      existing.detail = failure.detail;
      existing.retryable = failure.retryable;
      existing.retryCount = failure.retryCount;
      existing.autoRepairPlan = [...failure.autoRepairPlan];
      existing.updatedAt = now;
      existing.failureStatus = failure.retryable ? "pending_retry" : "needs_user_help";
      record = { ...existing, autoRepairPlan: [...existing.autoRepairPlan] };
    } else {
      record = {
        id: makeId("paper-digest-failure"),
        ...failure,
        status: "failed",
        createdAt: now,
        updatedAt: now,
        failureStatus: failure.retryable ? "pending_retry" : "needs_user_help",
      };
      this.paperDigestFailures.push(record);
    }
    this.enqueuePersist(() => this.persistFailures());
    return record;
  }

  resolvePaperDigestFailure(sourceId: string, sourceKind?: PaperDigestFailureRecord["sourceKind"]): void {
    const now = new Date().toISOString();
    for (const record of this.paperDigestFailures) {
      if (record.sourceId !== sourceId) continue;
      if (sourceKind && record.sourceKind !== sourceKind) continue;
      if (record.failureStatus === "resolved") continue;
      record.failureStatus = "resolved";
      record.updatedAt = now;
    }
    this.enqueuePersist(() => this.persistFailures());
  }

  resolvePaperDigestFailureByCanonicalKey(
    canonicalPaperKey: string,
    sourceKind?: PaperDigestFailureRecord["sourceKind"],
  ): void {
    const now = new Date().toISOString();
    for (const record of this.paperDigestFailures) {
      if (record.canonicalPaperKey !== canonicalPaperKey) continue;
      if (sourceKind && record.sourceKind !== sourceKind) continue;
      if (record.failureStatus === "resolved") continue;
      record.failureStatus = "resolved";
      record.updatedAt = now;
    }
    this.enqueuePersist(() => this.persistFailures());
  }

  async digest(input: PaperDigestInput): Promise<PaperDigestResult> {
    if (!this.modelStep) {
      throw new Error("PaperDigests.digest requires a configured model step.");
    }
    let lastFailure: Extract<PaperDigestResult, { status: "failed" }> | undefined;
    for (let attempt = 0; attempt <= this.recoveryPolicy.maxAutoRetries; attempt += 1) {
      const result = await this.digestOnce(input, attempt);
      if (result.status === "completed") return result;
      lastFailure = result;
      if (!result.retryable || attempt >= this.recoveryPolicy.maxAutoRetries) {
        return result;
      }
    }
    return lastFailure ?? createPaperDigestFailure("paper_digest_model_failed", `Digest failed for ${input.sourceId}.`, input.sourceId, input.kind, true, 0, []);
  }

  private async digestOnce(input: PaperDigestInput, attempt: number): Promise<PaperDigestResult> {
    if (!this.modelStep) {
      throw new Error("PaperDigests.digestOnce requires a configured model step.");
    }
    const promptInput = paperDigestPromptInput(input, this.capabilities);
    if ("error" in promptInput) {
      return {
        ...promptInput.error,
        retryCount: attempt,
      };
    }
    try {
      const raw = await this.modelStep({
        stepId: `paper_digest_${safeStepId(input.sourceId)}`,
        system: "You produce reusable structured research-paper digests as valid JSON.",
        prompt: renderPaperDigestPrompt(promptInput),
        includeRenderedContext: false,
        stageUserInputPolicy: false,
        attachments: promptInput.attachments,
        stream: false,
      });
      const modelOutput = await parseOrRepairPaperDigest(raw, (options) => this.modelStep!({
        ...options,
        stageUserInputPolicy: false,
      }));
      return {
        status: "completed",
        digest: {
          id: makeId("paper-digest"),
          sourceId: input.sourceId,
          ...resolveCanonicalPaperIdentity(input, modelOutput),
          sourceKind: promptInput.sourceKind,
          ...modelOutput,
          contentLevel: promptInput.contentLevel,
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const knownFailure = isRecord(error) ? error as Partial<Extract<PaperDigestResult, { status: "failed" }>> : undefined;
      const classified = classifyPaperDigestFailure(
        input,
        error,
        isPaperDigestFailureReason(error) ? error.reason : "paper_digest_model_failed",
        typeof knownFailure?.detail === "string" ? knownFailure.detail : error instanceof Error ? error.message : String(error),
      );
      return {
        status: "failed",
        sourceId: input.sourceId,
        canonicalPaperKey: deriveCanonicalPaperKeyFromInput(input),
        sourceKind: input.kind,
        reason: classified.reason,
        detail: classified.detail,
        retryable: typeof knownFailure?.retryable === "boolean" ? knownFailure.retryable : classified.retryable,
        retryCount: attempt,
        autoRepairPlan: classified.autoRepairPlan,
      };
    }
  }

  paperDigestFailureSnapshot(): PaperDigestFailureRecord[] {
    return this.paperDigestFailures.map((failure) => ({
      ...failure,
      autoRepairPlan: [...failure.autoRepairPlan],
    }));
  }

  paperDigestSnapshot(): PaperDigest[] {
    return [...this.paperDigests.values()].map((entry) => clonePaperDigest(entry.digest));
  }

  paperDigestManifestSnapshot(): PaperDigestManifestRecord[] {
    return [...this.paperDigestManifest.values()].map((record) => ({ ...record }));
  }

  paperDigestRecordSnapshot(): PaperDigestManifestEntry[] {
    return [...this.paperDigests.values()].map((entry) => ({
      input: clonePaperDigestInput(entry.input),
      digest: clonePaperDigest(entry.digest),
    }));
  }

  restorePaperDigestRecords(entries: PaperDigestManifestEntry[]): void {
    this.paperDigests.clear();
    this.paperDigestsByCanonicalKey.clear();
    this.paperDigestManifest.clear();
    for (const entry of entries) {
      const key = paperDigestCacheKey(entry.input);
      const clonedEntry = {
        input: clonePaperDigestInput(entry.input),
        digest: clonePaperDigest(entry.digest),
      };
      this.paperDigests.set(key, clonedEntry);
      this.paperDigestsByCanonicalKey.set(clonedEntry.digest.canonicalPaperKey, clonedEntry);
      this.paperDigestManifest.set(clonedEntry.digest.canonicalPaperKey, buildPaperDigestManifestRecord(clonedEntry));
    }
  }

  restorePaperDigestFailures(records: PaperDigestFailureRecord[]): void {
    this.paperDigestFailures.length = 0;
    for (const record of records) {
      this.paperDigestFailures.push({
        ...record,
        autoRepairPlan: [...record.autoRepairPlan],
      });
    }
  }

  private enqueuePersist(task: () => Promise<void>): void {
    if (!this.root) return;
    this.persistChain = this.persistChain.then(task).catch(() => undefined);
  }

  private async ensureLayout(): Promise<void> {
    if (!this.root) return;
    await mkdir(this.digestDirectory(), { recursive: true });
  }

  private async restoreFromDisk(): Promise<void> {
    const digestEntries = await this.readDigestEntries();
    const failures = await this.readFailures();
    this.restorePaperDigestRecords(digestEntries);
    this.restorePaperDigestFailures(failures);
  }

  private async readDigestEntries(): Promise<PaperDigestManifestEntry[]> {
    const manifestRecords = await this.readManifestRecords();
    const fileNames = manifestRecords.length > 0
      ? manifestRecords.map((record) => record.digestFile)
      : await this.readDigestFileNames();

    const entries: PaperDigestManifestEntry[] = [];
    for (const fileName of fileNames) {
      try {
        const raw = await readFile(join(this.digestDirectory(), fileName), "utf8");
        const parsed = JSON.parse(raw) as Partial<PersistedPaperDigestEntryFile>;
        if (parsed.schemaVersion !== 1 || !parsed.entry) continue;
        entries.push(parsed.entry);
      } catch {
        continue;
      }
    }
    return entries;
  }

  private async readDigestFileNames(): Promise<string[]> {
    const dir = this.digestDirectory();
    try {
      return (await readdir(dir)).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
  }

  private async readManifestRecords(): Promise<PaperDigestManifestRecord[]> {
    try {
      const raw = await readFile(this.manifestFile(), "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedPaperDigestManifestFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) return [];
      return parsed.records
        .filter(isRecord)
        .map((record) => ({
          canonicalPaperKey: asString(record.canonicalPaperKey),
          sourceId: asString(record.sourceId),
          sourceKind: normalizePaperDigestSourceKind(record.sourceKind),
          digestFile: asString(record.digestFile),
          updatedAt: asString(record.updatedAt),
        }));
    } catch {
      return [];
    }
  }

  private async readFailures(): Promise<PaperDigestFailureRecord[]> {
    try {
      const raw = await readFile(this.failureFile(), "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedPaperDigestFailureFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.failures)) return [];
      return parsed.failures;
    } catch {
      return [];
    }
  }

  private async persistDigest(canonicalPaperKey: string, entry: PaperDigestManifestEntry): Promise<void> {
    await this.ensureLayout();
    const payload: PersistedPaperDigestEntryFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      entry,
    };
    await writeFile(
      join(this.digestDirectory(), `${safeFileStem(canonicalPaperKey)}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }

  private async persistManifest(): Promise<void> {
    await this.ensureLayout();
    const payload: PersistedPaperDigestManifestFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records: this.paperDigestManifestSnapshot(),
    };
    await writeFile(this.manifestFile(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private async persistFailures(): Promise<void> {
    await this.ensureLayout();
    const payload: PersistedPaperDigestFailureFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      failures: this.paperDigestFailureSnapshot(),
    };
    await writeFile(this.failureFile(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private digestDirectory(): string {
    return join(this.root ?? ".", "paper-digests");
  }

  private failureFile(): string {
    return join(this.root ?? ".", "paper-digest-failures.json");
  }

  private manifestFile(): string {
    return join(this.root ?? ".", "paper-digests.manifest.json");
  }
}

const PAPER_DIGEST_SCHEMA: StructuredSchema = {
  name: "paper_digest",
  description: "A reusable structured digest of one research paper, independent of any current research task.",
  schema: {
    type: "object",
    required: [
      "title",
      "citationLine",
      "discipline",
      "schemaFamily",
      "selectionReason",
      "oneSentenceSummary",
      "abstractSummary",
      "researchProblem",
      "motivation",
      "approach",
      "keyContributions",
      "keyClaims",
      "importantTerms",
      "findings",
      "limitations",
      "relatedWorkSignals",
      "specialized",
      "literatureReviewUse",
      "uncertainty",
    ],
    properties: {
      title: { type: "string" },
      citationLine: { description: "String or null." },
      discipline: { type: "string" },
      schemaFamily: { type: "string" },
      selectionReason: { type: "string" },
      oneSentenceSummary: { type: "string" },
      abstractSummary: { description: "String or null." },
      researchProblem: { type: "string" },
      motivation: { type: "string" },
      approach: { type: "string" },
      keyContributions: { type: "array", items: { type: "string" } },
      keyClaims: { type: "array", items: { type: "string" } },
      importantTerms: { type: "array", items: { type: "string" } },
      findings: { type: "array", items: { type: "string" } },
      limitations: { type: "array", items: { type: "string" } },
      relatedWorkSignals: {
        type: "object",
        required: ["namedPriorWork", "competingApproaches", "followUpDirections", "applicationAreas"],
        properties: {
          namedPriorWork: { type: "array", items: { type: "string" } },
          competingApproaches: { type: "array", items: { type: "string" } },
          followUpDirections: { type: "array", items: { type: "string" } },
          applicationAreas: { type: "array", items: { type: "string" } },
        },
      },
      specialized: {
        type: "object",
        required: ["computationalEmpirical", "experimentalEmpirical", "methodologicalOrInstrumentation", "theoreticalOrMathematical", "reviewOrSurvey"],
        properties: {
          computationalEmpirical: {
            type: "object",
            required: ["methods", "methodFamily", "datasets", "benchmarks", "metrics", "comparators", "failureModesOrRisks"],
            properties: {
              methods: { type: "array", items: { type: "string" } },
              methodFamily: { type: "array", items: { type: "string" } },
              datasets: { type: "array", items: { type: "string" } },
              benchmarks: { type: "array", items: { type: "string" } },
              metrics: { type: "array", items: { type: "string" } },
              comparators: { type: "array", items: { type: "string" } },
              failureModesOrRisks: { type: "array", items: { type: "string" } },
            },
          },
          experimentalEmpirical: {
            type: "object",
            required: ["studySystemOrSamples", "experimentalDesign", "protocolsOrAssays", "measurementEndpoints", "controlsOrComparators", "sourcesOfBias"],
            properties: {
              studySystemOrSamples: { type: "array", items: { type: "string" } },
              experimentalDesign: { type: "array", items: { type: "string" } },
              protocolsOrAssays: { type: "array", items: { type: "string" } },
              measurementEndpoints: { type: "array", items: { type: "string" } },
              controlsOrComparators: { type: "array", items: { type: "string" } },
              sourcesOfBias: { type: "array", items: { type: "string" } },
            },
          },
          methodologicalOrInstrumentation: {
            type: "object",
            required: ["resourceType", "resourceScope", "primaryUseCases", "evaluationSetup", "comparators", "adoptionConstraints"],
            properties: {
              resourceType: { type: "array", items: { type: "string" } },
              resourceScope: { type: "array", items: { type: "string" } },
              primaryUseCases: { type: "array", items: { type: "string" } },
              evaluationSetup: { type: "array", items: { type: "string" } },
              comparators: { type: "array", items: { type: "string" } },
              adoptionConstraints: { type: "array", items: { type: "string" } },
            },
          },
          theoreticalOrMathematical: {
            type: "object",
            required: ["formalSetting", "assumptions", "mainResults", "proofStrategy", "scopeOfApplicability", "openProblems"],
            properties: {
              formalSetting: { type: "array", items: { type: "string" } },
              assumptions: { type: "array", items: { type: "string" } },
              mainResults: { type: "array", items: { type: "string" } },
              proofStrategy: { type: "array", items: { type: "string" } },
              scopeOfApplicability: { type: "array", items: { type: "string" } },
              openProblems: { type: "array", items: { type: "string" } },
            },
          },
          reviewOrSurvey: {
            type: "object",
            required: ["reviewScope", "selectionCriteria", "taxonomy", "synthesisMethod", "evidenceGaps", "controversies"],
            properties: {
              reviewScope: { type: "array", items: { type: "string" } },
              selectionCriteria: { type: "array", items: { type: "string" } },
              taxonomy: { type: "array", items: { type: "string" } },
              synthesisMethod: { type: "array", items: { type: "string" } },
              evidenceGaps: { type: "array", items: { type: "string" } },
              controversies: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      literatureReviewUse: {
        type: "object",
        required: ["usefulAs", "searchTerms", "expansionDirections"],
        properties: {
          usefulAs: { type: "array", items: { type: "string" } },
          searchTerms: { type: "array", items: { type: "string" } },
          expansionDirections: { type: "array", items: { type: "string" } },
        },
      },
      uncertainty: { type: "array", items: { type: "string" } },
    },
  },
};

async function parseOrRepairPaperDigest(rawText: string, modelStep: PaperDigestModelStepRunner): Promise<PaperDigestModelOutput> {
  try {
    return coercePaperDigest(parseStructuredOutput(rawText, PAPER_DIGEST_SCHEMA));
  } catch (error) {
    try {
      return coercePaperDigest(salvageStructuredOutput(rawText, PAPER_DIGEST_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "paper_digest_repair_model",
        system: "You repair invalid research-paper digest outputs into valid JSON.",
        prompt: repairInstruction(
          PAPER_DIGEST_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      try {
        return coercePaperDigest(parseStructuredOutput(repaired, PAPER_DIGEST_SCHEMA));
      } catch (repairError) {
        throw createPaperDigestFailure(
          "paper_digest_output_invalid",
          repairError instanceof Error ? repairError.message : String(repairError),
        );
      }
    }
  }
}

function coercePaperDigest(value: Record<string, unknown>): PaperDigestModelOutput {
  const relatedWorkSignals = isRecord(value.relatedWorkSignals) ? value.relatedWorkSignals : {};
  const literatureReviewUse = isRecord(value.literatureReviewUse) ? value.literatureReviewUse : {};
  const specialized = isRecord(value.specialized) ? value.specialized : {};
  const computational = isRecord(specialized.computationalEmpirical) ? specialized.computationalEmpirical : {};
  const experimental = isRecord(specialized.experimentalEmpirical) ? specialized.experimentalEmpirical : {};
  const methodological = isRecord(specialized.methodologicalOrInstrumentation) ? specialized.methodologicalOrInstrumentation : {};
  const theoretical = isRecord(specialized.theoreticalOrMathematical) ? specialized.theoreticalOrMathematical : {};
  const review = isRecord(specialized.reviewOrSurvey) ? specialized.reviewOrSurvey : {};
  return {
    discipline: normalizeLiteratureDiscipline(value.discipline),
    schemaFamily: normalizePaperDigestSchemaFamily(value.schemaFamily),
    selectionReason: asString(value.selectionReason),
    title: asString(value.title),
    citationLine: nullableString(value.citationLine),
    oneSentenceSummary: asString(value.oneSentenceSummary),
    abstractSummary: nullableString(value.abstractSummary),
    researchProblem: asString(value.researchProblem),
    motivation: asString(value.motivation),
    approach: asString(value.approach),
    keyContributions: asStringArray(value.keyContributions),
    keyClaims: asStringArray(value.keyClaims),
    importantTerms: asStringArray(value.importantTerms),
    findings: asStringArray(value.findings),
    limitations: asStringArray(value.limitations),
    relatedWorkSignals: {
      namedPriorWork: asStringArray(relatedWorkSignals.namedPriorWork),
      competingApproaches: asStringArray(relatedWorkSignals.competingApproaches),
      followUpDirections: asStringArray(relatedWorkSignals.followUpDirections),
      applicationAreas: asStringArray(relatedWorkSignals.applicationAreas),
    },
    specialized: {
      computationalEmpirical: {
        methods: asStringArray(computational.methods),
        methodFamily: asStringArray(computational.methodFamily),
        datasets: asStringArray(computational.datasets),
        benchmarks: asStringArray(computational.benchmarks),
        metrics: asStringArray(computational.metrics),
        comparators: asStringArray(computational.comparators),
        failureModesOrRisks: asStringArray(computational.failureModesOrRisks),
      },
      experimentalEmpirical: {
        studySystemOrSamples: asStringArray(experimental.studySystemOrSamples),
        experimentalDesign: asStringArray(experimental.experimentalDesign),
        protocolsOrAssays: asStringArray(experimental.protocolsOrAssays),
        measurementEndpoints: asStringArray(experimental.measurementEndpoints),
        controlsOrComparators: asStringArray(experimental.controlsOrComparators),
        sourcesOfBias: asStringArray(experimental.sourcesOfBias),
      },
      methodologicalOrInstrumentation: {
        resourceType: asStringArray(methodological.resourceType),
        resourceScope: asStringArray(methodological.resourceScope),
        primaryUseCases: asStringArray(methodological.primaryUseCases),
        evaluationSetup: asStringArray(methodological.evaluationSetup),
        comparators: asStringArray(methodological.comparators),
        adoptionConstraints: asStringArray(methodological.adoptionConstraints),
      },
      theoreticalOrMathematical: {
        formalSetting: asStringArray(theoretical.formalSetting),
        assumptions: asStringArray(theoretical.assumptions),
        mainResults: asStringArray(theoretical.mainResults),
        proofStrategy: asStringArray(theoretical.proofStrategy),
        scopeOfApplicability: asStringArray(theoretical.scopeOfApplicability),
        openProblems: asStringArray(theoretical.openProblems),
      },
      reviewOrSurvey: {
        reviewScope: asStringArray(review.reviewScope),
        selectionCriteria: asStringArray(review.selectionCriteria),
        taxonomy: asStringArray(review.taxonomy),
        synthesisMethod: asStringArray(review.synthesisMethod),
        evidenceGaps: asStringArray(review.evidenceGaps),
        controversies: asStringArray(review.controversies),
      },
    },
    literatureReviewUse: {
      usefulAs: asStringArray(literatureReviewUse.usefulAs)
        .filter((value): value is typeof PAPER_LITERATURE_USE_VALUES[number] => PAPER_LITERATURE_USE_VALUES.includes(value as typeof PAPER_LITERATURE_USE_VALUES[number])),
      searchTerms: asStringArray(literatureReviewUse.searchTerms),
      expansionDirections: asStringArray(literatureReviewUse.expansionDirections),
    },
    uncertainty: asStringArray(value.uncertainty),
  };
}

function normalizePaperDigestSchemaFamily(value: unknown): PaperDigestSchemaFamily {
  const text = asString(value);
  return [
    "computational_empirical",
    "experimental_empirical",
    "methodological_or_instrumentation",
    "theoretical_or_mathematical",
    "review_or_survey",
  ].includes(text) ? text as PaperDigestSchemaFamily : "computational_empirical";
}

function normalizeLiteratureDiscipline(value: unknown): LiteratureDiscipline {
  const text = asString(value);
  return [
    "artificial_intelligence",
    "mathematics",
    "chemistry",
    "chemical_engineering",
    "physics",
    "general_science",
    "unknown",
  ].includes(text) ? text as LiteratureDiscipline : "unknown";
}

function paperDigestPromptInput(
  input: PaperDigestInput,
  capabilities: PaperDigestCapabilities,
):
  | {
      sourceKind: "pdf_url" | "pdf_file";
      metadata: { pdfUrl?: string };
      contentLevel: PaperDigestContentLevel;
      disciplineHint?: LiteratureDiscipline;
      paperContent: string;
      attachments: Array<{ kind: "pdf_url" | "pdf_file"; url?: string; path?: string; filename?: string; mediaType?: "application/pdf" }>;
    }
  | { error: Extract<PaperDigestResult, { status: "failed" }> } {
  if (input.kind === "pdf_url") {
    if (!input.pdfUrl.trim()) {
      return {
        error: createPaperDigestFailure("paper_digest_requires_pdf_url", `No PDF URL was available for source ${input.sourceId}.`, input.sourceId, "pdf_url", false),
      };
    }
    if (capabilities.pdfUrlReadSupport === "unsupported") {
      return {
        error: createPaperDigestFailure(
          "paper_digest_provider_unsupported",
          `Current model provider does not support reading PDF URLs for source ${input.sourceId}.`,
          input.sourceId,
          "pdf_url",
          false,
          0,
          ["switch to a provider that supports pdf_url reading"],
        ),
      };
    }
    return {
      sourceKind: "pdf_url",
      metadata: {
        pdfUrl: input.pdfUrl,
      },
      disciplineHint: input.disciplineHint,
      contentLevel: "document",
      attachments: [
        {
          kind: "pdf_url",
          url: input.pdfUrl,
          filename: "paper.pdf",
          mediaType: "application/pdf",
        },
      ],
      paperContent: [
        "# Paper PDF",
        "",
        "A paper PDF URL is attached as an input file. Read that PDF and produce the digest.",
      ].join("\n"),
    };
  }
  if (capabilities.pdfFileReadSupport !== "native") {
    return {
      error: createPaperDigestFailure(
        "paper_digest_provider_unsupported",
        `Current model provider does not support PDF file attachments for source ${input.sourceId}.`,
        input.sourceId,
        "pdf_file",
        false,
        0,
        ["switch to a provider that supports pdf_file attachments"],
      ),
    };
  }
  return {
    sourceKind: "pdf_file",
    metadata: {},
    disciplineHint: input.disciplineHint,
    contentLevel: "document",
    attachments: [
      {
        kind: "pdf_file",
        path: input.path,
        filename: safeStepId(input.sourceId) + ".pdf",
        mediaType: "application/pdf",
      },
    ],
    paperContent: [
      "# Paper PDF",
      "",
      "A paper PDF file is attached as an input file. Read that PDF and produce the digest.",
    ].join("\n"),
  };
}

function createPaperDigestFailure(
  reason: PaperDigestFailureReason,
  detail: string,
  sourceId = "unknown",
  sourceKind: PaperDigestSourceKind = "pdf_url",
  retryable = true,
  retryCount = 0,
  autoRepairPlan: string[] = [],
): Extract<PaperDigestResult, { status: "failed" }> {
  return {
    status: "failed",
    sourceId,
    sourceKind,
    reason,
    detail,
    retryable,
    retryCount,
    autoRepairPlan,
  };
}

function isPaperDigestFailureReason(error: unknown): error is { reason: PaperDigestFailureReason } {
  if (!isRecord(error)) return false;
  const reason = asString(error.reason);
  return [
    "paper_digest_requires_pdf_url",
    "paper_digest_pdf_file_not_supported_yet",
    "paper_digest_pdf_unreachable",
    "paper_digest_pdf_access_blocked",
    "paper_digest_provider_unsupported",
    "paper_digest_model_failed",
    "paper_digest_output_invalid",
  ].includes(reason);
}

function classifyPaperDigestFailure(
  input: PaperDigestInput,
  error: unknown,
  fallbackReason: PaperDigestFailureReason,
  fallbackDetail: string,
): {
  reason: PaperDigestFailureReason;
  detail: string;
  retryable: boolean;
  autoRepairPlan: string[];
} {
  const detail = fallbackDetail;
  const lower = detail.toLowerCase();
  if (input.kind === "pdf_file") {
    return {
      reason: "paper_digest_pdf_file_not_supported_yet",
      detail,
      retryable: false,
      autoRepairPlan: [],
    };
  }
  if (/(403|401|forbidden|unauthorized|login|captcha|access denied|blocked)/i.test(detail)) {
    return {
      reason: "paper_digest_pdf_access_blocked",
      detail,
      retryable: false,
      autoRepairPlan: [],
    };
  }
  if (/(404|not found|unreachable|dns|timed out|timeout|connection reset|network)/i.test(detail)) {
    return {
      reason: "paper_digest_pdf_unreachable",
      detail,
      retryable: true,
      autoRepairPlan: ["retry pdf url fetch", "retry digest with the same pdf url"],
    };
  }
  if (/unsupported|provider|tool_not_registered/i.test(lower)) {
    return {
      reason: "paper_digest_provider_unsupported",
      detail,
      retryable: false,
      autoRepairPlan: [],
    };
  }
  if (fallbackReason === "paper_digest_output_invalid") {
    return {
      reason: fallbackReason,
      detail,
      retryable: true,
      autoRepairPlan: ["repair invalid structured output", "retry digest generation"],
    };
  }
  return {
    reason: fallbackReason,
    detail,
    retryable: true,
    autoRepairPlan: ["retry digest generation"],
  };
}

function resolveCanonicalPaperIdentity(
  input: PaperDigestInput,
  output: PaperDigestModelOutput,
): { canonicalPaperKey: string; doi?: string | null; arxivId?: string | null } {
  const doi = extractDoiFromText([input.kind === "pdf_url" ? input.pdfUrl : "", output.citationLine, output.title, ...output.keyClaims, ...output.importantTerms].filter(Boolean).join("\n"));
  const arxivId = extractArxivIdFromText([input.kind === "pdf_url" ? input.pdfUrl : "", output.citationLine, output.title, ...output.keyClaims, ...output.importantTerms].filter(Boolean).join("\n"));
  return {
    canonicalPaperKey: buildCanonicalPaperKey({ input, doi, arxivId, title: output.title }),
    doi,
    arxivId,
  };
}

function deriveCanonicalPaperKeyFromInput(input: PaperDigestInput): string {
  return buildCanonicalPaperKey({
    input,
    doi: input.kind === "pdf_url" ? extractDoiFromText(input.pdfUrl) : null,
    arxivId: input.kind === "pdf_url" ? extractArxivIdFromText(input.pdfUrl) : null,
    title: "",
  });
}

function buildCanonicalPaperKey(params: { input: PaperDigestInput; doi?: string | null; arxivId?: string | null; title?: string }): string {
  if (params.doi) return `doi:${normalizeDoi(params.doi)}`;
  if (params.arxivId) return `arxiv:${normalizeArxivId(params.arxivId)}`;
  const sourceLocator = params.input.kind === "pdf_url" ? params.input.pdfUrl : params.input.path;
  const normalizedTitle = normalizeTitleKey(params.title ?? "");
  return normalizedTitle
    ? `provisional:${normalizedTitle}`
    : params.input.kind === "pdf_url"
      ? `source:pdf_url:${sourceLocator.trim().toLowerCase()}`
      : `source:pdf_file:${sourceLocator.trim().toLowerCase()}`;
}

function extractDoiFromText(text: string): string | null {
  const match = text.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  return match ? normalizeDoi(match[0]) : null;
}

function extractArxivIdFromText(text: string): string | null {
  const direct = text.match(/\b\d{4}\.\d{4,5}(?:v\d+)?\b/i);
  if (direct) return normalizeArxivId(direct[0]);
  const legacy = text.match(/\b[a-z-]+\/\d{7}(?:v\d+)?\b/i);
  return legacy ? normalizeArxivId(legacy[0]) : null;
}

function normalizeDoi(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

function normalizeArxivId(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, "").replace(/\.pdf$/i, "");
}

function normalizeTitleKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function safeFileStem(value: string): string {
  const stem = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return stem || basename(value).replace(/[^a-z0-9._-]+/gi, "_") || "paper_digest";
}

function clonePaperDigest(digest: PaperDigest): PaperDigest {
  return {
    ...digest,
    keyContributions: [...digest.keyContributions],
    keyClaims: [...digest.keyClaims],
    findings: [...digest.findings],
    limitations: [...digest.limitations],
    importantTerms: [...digest.importantTerms],
    relatedWorkSignals: { ...digest.relatedWorkSignals },
    specialized: {
      computationalEmpirical: {
        methods: [...digest.specialized.computationalEmpirical.methods],
        methodFamily: [...digest.specialized.computationalEmpirical.methodFamily],
        datasets: [...digest.specialized.computationalEmpirical.datasets],
        benchmarks: [...digest.specialized.computationalEmpirical.benchmarks],
        metrics: [...digest.specialized.computationalEmpirical.metrics],
        comparators: [...digest.specialized.computationalEmpirical.comparators],
        failureModesOrRisks: [...digest.specialized.computationalEmpirical.failureModesOrRisks],
      },
      experimentalEmpirical: {
        studySystemOrSamples: [...digest.specialized.experimentalEmpirical.studySystemOrSamples],
        experimentalDesign: [...digest.specialized.experimentalEmpirical.experimentalDesign],
        protocolsOrAssays: [...digest.specialized.experimentalEmpirical.protocolsOrAssays],
        measurementEndpoints: [...digest.specialized.experimentalEmpirical.measurementEndpoints],
        controlsOrComparators: [...digest.specialized.experimentalEmpirical.controlsOrComparators],
        sourcesOfBias: [...digest.specialized.experimentalEmpirical.sourcesOfBias],
      },
      methodologicalOrInstrumentation: {
        resourceType: [...digest.specialized.methodologicalOrInstrumentation.resourceType],
        resourceScope: [...digest.specialized.methodologicalOrInstrumentation.resourceScope],
        primaryUseCases: [...digest.specialized.methodologicalOrInstrumentation.primaryUseCases],
        evaluationSetup: [...digest.specialized.methodologicalOrInstrumentation.evaluationSetup],
        comparators: [...digest.specialized.methodologicalOrInstrumentation.comparators],
        adoptionConstraints: [...digest.specialized.methodologicalOrInstrumentation.adoptionConstraints],
      },
      theoreticalOrMathematical: {
        formalSetting: [...digest.specialized.theoreticalOrMathematical.formalSetting],
        assumptions: [...digest.specialized.theoreticalOrMathematical.assumptions],
        mainResults: [...digest.specialized.theoreticalOrMathematical.mainResults],
        proofStrategy: [...digest.specialized.theoreticalOrMathematical.proofStrategy],
        scopeOfApplicability: [...digest.specialized.theoreticalOrMathematical.scopeOfApplicability],
        openProblems: [...digest.specialized.theoreticalOrMathematical.openProblems],
      },
      reviewOrSurvey: {
        reviewScope: [...digest.specialized.reviewOrSurvey.reviewScope],
        selectionCriteria: [...digest.specialized.reviewOrSurvey.selectionCriteria],
        taxonomy: [...digest.specialized.reviewOrSurvey.taxonomy],
        synthesisMethod: [...digest.specialized.reviewOrSurvey.synthesisMethod],
        evidenceGaps: [...digest.specialized.reviewOrSurvey.evidenceGaps],
        controversies: [...digest.specialized.reviewOrSurvey.controversies],
      },
    },
    literatureReviewUse: {
      ...digest.literatureReviewUse,
      usefulAs: [...digest.literatureReviewUse.usefulAs],
      searchTerms: [...digest.literatureReviewUse.searchTerms],
      expansionDirections: [...digest.literatureReviewUse.expansionDirections],
    },
    uncertainty: [...digest.uncertainty],
  };
}

function clonePaperDigestInput(input: PaperDigestInput): PaperDigestInput {
  return input.kind === "pdf_url"
    ? { kind: "pdf_url", sourceId: input.sourceId, pdfUrl: input.pdfUrl }
    : { kind: "pdf_file", sourceId: input.sourceId, path: input.path };
}

function buildPaperDigestManifestRecord(entry: PaperDigestManifestEntry): PaperDigestManifestRecord {
  return {
    canonicalPaperKey: entry.digest.canonicalPaperKey,
    sourceId: entry.digest.sourceId,
    sourceKind: entry.digest.sourceKind,
    digestFile: `${safeFileStem(entry.digest.canonicalPaperKey)}.json`,
    updatedAt: entry.digest.createdAt,
  };
}

function paperDigestCacheKey(input: PaperDigestInput): string {
  if (input.kind === "pdf_url") {
    return `pdf_url:${normalizeLocator(input.pdfUrl)}`;
  }
  return `pdf_file:${normalizeLocator(input.path)}`;
}

function paperCanonicalLookupKey(input: PaperDigestInput): string {
  if (input.kind === "pdf_url") {
    const doi = extractDoiFromText(input.pdfUrl);
    if (doi) return `doi:${doi}`;
    const arxivId = extractArxivIdFromText(input.pdfUrl);
    if (arxivId) return `arxiv:${arxivId}`;
  }
  return paperDigestCacheKey(input);
}

function normalizeLocator(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePaperDigestSourceKind(value: unknown): PaperDigestSourceKind {
  const text = asString(value);
  return text === "pdf_file" ? "pdf_file" : "pdf_url";
}

function normalizePaperDigestContentLevel(value: unknown): PaperDigestContentLevel {
  const text = asString(value);
  return text === "extracted_text" ? "extracted_text" : "document";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function nullableString(value: unknown): string | null {
  const text = asString(value);
  if (!text || text.toLowerCase() === "null") return null;
  return text;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStepId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "paper";
}
