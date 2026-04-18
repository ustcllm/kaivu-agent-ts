import { makeId } from "../../shared/ids.js";
import type { ScientificTask } from "../../shared/ScientificLifecycle.js";
import type { StageResult } from "../../shared/StageContracts.js";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  schemaInstruction,
  type StructuredSchema,
} from "../../structured/StructuredOutput.js";
import { BaseSpecialistAgent, type ModelStepOptions, type ModelStepRunner, type SpecialistRunInput } from "../SpecialistAgent.js";

export class ProblemFramingAgent extends BaseSpecialistAgent {
  id = "problem_framing_agent";
  stage = "problem_framing" as const;
  description = "Frames the research problem before downstream literature review and hypothesis work.";

  async run(input: SpecialistRunInput): Promise<StageResult> {
    const task = input.plan.inputs.task as ScientificTask;
    const disciplineHint = String(input.plan.inputs.discipline ?? task.discipline ?? "to_be_determined");
    const groundingDiscipline = knownDisciplineForGrounding(disciplineHint);
    const groundingPlan = planQueryGrounding(task.question);
    input.onProgress?.({
      label: "Interpret user query",
      detail: "Prepared the query for a separate grounding-target selection step before problem framing.",
      data: {
        rawQuestion: task.question,
        disciplineHint,
        groundingDiscipline,
        candidateTerms: [],
        needsGrounding: groundingPlan.needsGrounding,
        requireHostedWebSearch: groundingPlan.requireHostedWebSearch,
        reason: groundingPlan.reason,
      },
    });
    const modelStep = (options: ModelStepOptions) => this.modelStep(input, options);
    const groundingTargets = await selectGroundingTargets(input, groundingPlan, groundingDiscipline, modelStep);
    const groundingDisciplineContext = groundingDisciplineContextFor(groundingDiscipline, groundingTargets.discipline);
    const groundingResults = await groundQueryConcepts(
      input,
      groundingTargets,
      task.question,
      groundingDisciplineContext,
      modelStep,
    );
    const groundingContext = buildGroundingContext(groundingResults, groundingTargets);
    const languagePolicy = detectLanguagePolicy(task.question);
    const framingPrompt = [
      "Frame the user request as a scientific research problem.",
      "",
      "Your job is to produce a minimal, decision-useful problem frame for downstream literature review, hypothesis generation, and experiment planning.",
      "",
      "Do not answer the research question.",
      "Do not generate literature search queries.",
      "Do not generate hypotheses.",
      "Do not propose experiments.",
      "Do not write a review.",
      "",
      "Input:",
      "Original user question:",
      task.question,
      "",
      "Initial discipline hint:",
      disciplineHint,
      "",
      "If the hint is \"to_be_determined\", infer the discipline from the user question and grounding context.",
      "",
      "Allowed discipline labels:",
      "- artificial_intelligence",
      "- mathematics",
      "- chemistry",
      "- chemical_engineering",
      "- physics",
      "- general_science",
      "- unknown",
      "",
      groundingContext
        ? `Concept grounding context:\n${groundingContext}`
        : "Concept grounding context: no grounded context is available; explicitly mark uncertain terminology as assumptions.",
      "",
      "Framing requirements:",
      "- Identify the most likely scientific interpretation of the user request.",
      "- If key terms are ambiguous, state the ambiguity explicitly.",
      "- Convert the user request into a specific research objective.",
      "- Define the scope narrowly enough for literature review and hypothesis generation.",
      "- Extract key variables, mechanisms, objects, systems, methods, datasets, observables, or constraints mentioned or implied by the request.",
      "- State assumptions only when necessary, and mark them as assumptions.",
      "- Define success criteria that can later be evaluated by evidence, experiments, simulations, proofs, or benchmarks.",
      "- Preserve important user intent from the original wording.",
      "- If the question is too broad, narrow it conservatively instead of expanding it.",
      "- If the evidence basis is uncertain, reflect that in ambiguities or constraints.",
      "- Keep the output concise and structured.",
      "",
      "Return valid JSON following the schema.",
      "",
      schemaInstruction(PROBLEM_FRAME_SCHEMA),
    ].join("\n");
    const rawSummary = await this.modelStep(input, {
      stepId: this.id,
      prompt: framingPrompt,
      includeRenderedContext: false,
    });
    const parsedFrame = await parseOrRepairProblemFrame(input, rawSummary, modelStep);
    const framedDiscipline = parsedFrame.discipline || "unknown";
    const hasRequiredFrame = Boolean(parsedFrame.objective && parsedFrame.scope && parsedFrame.success_criteria.length > 0);
    const successCriteria = parsedFrame.success_criteria.length
      ? parsedFrame.success_criteria
      : task.successCriteria?.length
        ? task.successCriteria
      : [
          "question is narrowed into a testable research objective",
          "literature review can generate a grounded search strategy from the framed problem",
          "later hypotheses can be evaluated against stated evidence criteria",
        ];
    const summary = this.renderResultMarkdown(parsedFrame);
    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      processTrace: [
        {
          label: "Interpret and ground user query",
          status: groundingPlan.needsGrounding ? "completed" : "skipped",
          detail: groundingPlan.needsGrounding
            ? "Identified technical terms and ran concept grounding before asking the model to frame the problem."
            : "No obvious unfamiliar technical term was detected, so no grounding search was required.",
          data: {
            title: task.title,
            rawQuestion: task.question,
            disciplineHint,
            groundingDiscipline,
            framedDiscipline,
            taskType: task.taskType ?? "chat_research",
            candidateTerms: groundingTargets.targets.map((target) => target.term),
            groundingTargetPlan: groundingTargets,
            groundingResults,
            requireHostedWebSearch: groundingPlan.requireHostedWebSearch,
            groundingContext,
          },
        },
        {
          label: "Define framing outputs",
          status: "completed",
          detail: "Identified the minimal information downstream stages need.",
          data: {
            expectedFields: ["discipline", "objective", "scope", "variables", "constraints", "success criteria", "ambiguities"],
          },
        },
        {
          label: "Pass framed problem to literature review",
          status: hasRequiredFrame ? "completed" : "blocked",
          detail: hasRequiredFrame
            ? "Problem framing produced enough structured context for the literature review agent to generate its own search plan."
            : "Problem framing output is missing required objective, scope, or success criteria fields.",
          data: {
            inputLanguage: languagePolicy.inputLanguage,
            primarySearchLanguage: languagePolicy.primarySearchLanguage,
            reason: languagePolicy.reason,
            queryGenerationOwner: "literature_review_agent",
          },
        },
      ],
      evidence: [
        {
          id: makeId("evidence-problem-framing"),
          claim: `Research question framed for ${framedDiscipline}: ${task.question}`,
          source: this.id,
          strength: "unknown",
          uncertainty: "framing is an initial interpretation and should be revised if literature contradicts it",
        },
      ],
      hypotheses: [],
      artifacts: [
        {
          id: "problem_frame",
          kind: "problem_frame",
          uri: "memory://problem_frame",
          metadata: {
            discipline: framedDiscipline,
            languagePolicy,
            structuredFrame: parsedFrame,
            renderedProblemFrame: summary,
            successCriteria,
          },
        },
      ],
      memoryProposals: [
        {
          scope: "project",
          kind: "decision",
          title: "Problem framing",
          summary: parsedFrame.memory_summary || summarizeProblemFrameForMemory(parsedFrame),
          content: summary,
          tags: ["problem-framing", framedDiscipline],
        },
      ],
      graphProposals: [
        {
          subject: task.id,
          predicate: "framed_as",
          object: framedDiscipline,
          evidenceIds: [],
        },
      ],
      decision: {
        status: hasRequiredFrame ? "advance" : "needs_human_review",
        nextStage: hasRequiredFrame ? "literature_review" : "problem_framing",
        reason: hasRequiredFrame
          ? "The research problem is framed enough to drive targeted literature review."
          : "Problem framing output must include objective, scope, and success criteria before literature review can start.",
        confidence: hasRequiredFrame ? "medium" : "low",
      },
    };
  }

  protected override renderResultMarkdown(result: unknown): string {
    const frame = isProblemFrame(result) ? result : fallbackProblemFrame("", "", undefined);
    const lines = [
      "## Discipline",
      frame.discipline || "unknown",
      "",
      "## Objective",
      frame.objective || "No objective returned.",
      "",
      "## Scope",
      frame.scope || "No scope returned.",
      "",
      "## Key Variables",
      ...renderList(frame.key_variables),
      "",
      "## Constraints",
      ...renderList(frame.constraints),
      "",
      "## Success Criteria",
      ...renderList(frame.success_criteria),
    ];
    if (frame.ambiguities.length > 0) {
      lines.push("", "## Ambiguities", ...renderList(frame.ambiguities));
    }
    return lines.join("\n");
  }
}

interface ProblemFrame {
  discipline: string;
  memory_summary?: string;
  objective: string;
  scope: string;
  key_variables: string[];
  constraints: string[];
  success_criteria: string[];
  ambiguities: string[];
}

interface LanguagePolicy {
  inputLanguage: "zh" | "en" | "mixed_or_unknown";
  primarySearchLanguage: "en" | "input";
  reason: string;
}

interface GroundingPlan {
  query: string;
  needsGrounding: boolean;
  reason: string;
  requireHostedWebSearch: boolean;
}

interface GroundingTarget {
  term: string;
  reason: string;
}

interface ProvisionalDiscipline {
  label: string;
  confidence: number;
  rationale: string;
}

interface GroundingDisciplineContext extends ProvisionalDiscipline {
  source: "explicit" | "inferred";
}

interface GroundingTargetPlan {
  discipline: ProvisionalDiscipline;
  targets: GroundingTarget[];
  rationale: string;
  compatibility: string;
  no_grounding_reason: string;
}

const PROBLEM_FRAME_SCHEMA: StructuredSchema = {
  name: "problem_frame",
  description: "A structured scientific problem frame for downstream literature review and hypothesis generation.",
  schema: {
    type: "object",
    required: [
      "discipline",
      "memory_summary",
      "objective",
      "scope",
      "key_variables",
      "constraints",
      "success_criteria",
      "ambiguities",
    ],
    properties: {
      discipline: {
        type: "string",
        description: "Official downstream discipline label: artificial_intelligence, mathematics, chemistry, chemical_engineering, physics, general_science, or unknown.",
      },
      memory_summary: {
        type: "string",
        description: "A concise semantic memory summary of the framed research task for future recall. Do not include markdown headings.",
      },
      objective: { type: "string" },
      scope: { type: "string" },
      key_variables: { type: "array", items: { type: "string" } },
      constraints: { type: "array", items: { type: "string" } },
      success_criteria: { type: "array", items: { type: "string" } },
      ambiguities: { type: "array", items: { type: "string" } },
    },
  },
};

const GROUNDING_TARGET_SCHEMA: StructuredSchema = {
  name: "grounding_targets",
  description: "Exact scientific terms or short phrases selected for web grounding before problem framing.",
  schema: {
    type: "object",
    required: ["discipline", "targets", "rationale", "compatibility", "no_grounding_reason"],
    properties: {
      discipline: {
        type: "object",
        required: ["label", "confidence", "rationale"],
        properties: {
          label: {
            type: "string",
            description: "Provisional discipline label: artificial_intelligence, mathematics, chemistry, chemical_engineering, physics, general_science, or unknown.",
          },
          confidence: {
            type: "number",
            description: "Confidence from 0 to 1. This is provisional and not the final problem-framing discipline.",
          },
          rationale: {
            type: "string",
            description: "Why this provisional discipline fits the query.",
          },
        },
      },
      targets: {
        type: "array",
        items: {
          type: "object",
          required: ["term", "reason"],
          properties: {
            term: {
              type: "string",
              description: "Exact span from the user query that should be grounded.",
            },
            reason: {
              type: "string",
              description: "Why this term could change the scientific framing if misunderstood.",
            },
          },
        },
      },
      rationale: { type: "string" },
      compatibility: {
        type: "string",
        description: "Explain whether selected targets share a consistent or compatible discipline context.",
      },
      no_grounding_reason: {
        type: "string",
        description: "If targets is empty, explain why no grounding is needed; otherwise use an empty string.",
      },
    },
  },
};

async function parseOrRepairProblemFrame(input: SpecialistRunInput, rawText: string, modelStep: ModelStepRunner): Promise<ProblemFrame> {
  try {
    return coerceProblemFrame(parseStructuredOutput(rawText, PROBLEM_FRAME_SCHEMA));
  } catch (error) {
    try {
      return coerceProblemFrame(salvageStructuredOutput(rawText, PROBLEM_FRAME_SCHEMA));
    } catch {
      const repairPrompt = repairInstruction(
        PROBLEM_FRAME_SCHEMA,
        rawText,
        error instanceof Error ? error.message : String(error),
      );
      const repaired = await modelStep({
        stepId: "problem_frame_repair_model",
        system: "You repair invalid structured scientific agent outputs into valid JSON.",
        prompt: repairPrompt,
        includeRenderedContext: false,
        stream: false,
      });
      try {
        return coerceProblemFrame(parseStructuredOutput(repaired, PROBLEM_FRAME_SCHEMA));
      } catch {
        const task = input.plan.inputs.task as ScientificTask | undefined;
        return fallbackProblemFrame(rawText, task?.question ?? input.plan.objective, task?.discipline);
      }
    }
  }
}

function fallbackProblemFrame(rawText: string, question: string, disciplineHint?: string): ProblemFrame {
  const seed = normalizeGroundingFallbackQuery(question) ?? question.split(/\s+/).filter((token) => token.length > 3).slice(0, 4).join(" ");
  return {
    discipline: normalizeDisciplineLabel(disciplineHint ?? "") || "unknown",
    memory_summary: question || "Fallback problem framing requires review.",
    objective: question || "Frame the scientific research problem.",
    scope: "Fallback frame derived from unstructured model output; requires review before downstream use.",
    key_variables: seed ? [seed] : [],
    constraints: ["Structured problem framing failed and should be reviewed."],
    success_criteria: [
      "question is narrowed into a testable research objective",
      "literature review can generate a grounded search strategy from the framed problem",
      "later hypotheses can be evaluated against stated evidence criteria",
    ],
    ambiguities: [rawText.slice(0, 240)],
  };
}

function coerceProblemFrame(value: Record<string, unknown>): ProblemFrame {
  return {
    discipline: normalizeDisciplineLabel(asString(value.discipline)),
    memory_summary: asString(value.memory_summary),
    objective: asString(value.objective),
    scope: asString(value.scope),
    key_variables: asStringArray(value.key_variables),
    constraints: asStringArray(value.constraints),
    success_criteria: asStringArray(value.success_criteria),
    ambiguities: asStringArray(value.ambiguities),
  };
}

function isProblemFrame(value: unknown): value is ProblemFrame {
  if (!isRecord(value)) return false;
  return (
    typeof value.discipline === "string" &&
    typeof value.objective === "string" &&
    typeof value.scope === "string" &&
    Array.isArray(value.key_variables) &&
    Array.isArray(value.constraints) &&
    Array.isArray(value.success_criteria) &&
    Array.isArray(value.ambiguities)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeProblemFrameForMemory(frame: ProblemFrame): string {
  const parts = [
    frame.objective,
    frame.scope,
    frame.success_criteria.length ? `Success criteria: ${frame.success_criteria.join("; ")}` : "",
  ].filter(Boolean);
  return parts.join(" ").slice(0, 320) || "Problem framing created a research task frame.";
}

function renderList(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

interface GroundingResult {
  term: string;
  tool: string;
  status: "completed" | "failed" | "skipped";
  summary: string;
}

function planQueryGrounding(question: string): GroundingPlan {
  const fallbackQuery = normalizeGroundingFallbackQuery(question);
  return {
    query: fallbackQuery ?? "",
    needsGrounding: Boolean(fallbackQuery),
    requireHostedWebSearch: Boolean(fallbackQuery),
    reason: fallbackQuery
      ? "The user query will first be analyzed to select exact grounding targets, then each selected target will be grounded separately."
      : "The query is empty or too short to ground before framing.",
  };
}

async function selectGroundingTargets(
  input: SpecialistRunInput,
  plan: GroundingPlan,
  knownDiscipline: string | undefined,
  modelStep: ModelStepRunner,
): Promise<GroundingTargetPlan> {
  if (!plan.needsGrounding) {
    return {
      discipline: {
        label: "unknown",
        confidence: 0,
        rationale: "",
      },
      targets: [],
      rationale: "",
      compatibility: "",
      no_grounding_reason: plan.reason,
    };
  }
  input.onProgress?.({
    label: "Select grounding terms",
    detail: "Asking the model to select exact terms or short phrases that need grounding.",
    data: {
      query: plan.query,
      step: "grounding_target_selection",
      status: "started",
    },
  });
  const prompt = [
    "Select grounding targets before problem framing.",
    `User research query: ${plan.query}`,
    ...(knownDiscipline ? [`Known discipline context: ${knownDiscipline}`] : []),
    "",
    "Task:",
    "- Pick only representative scientific/technical concepts from the user query whose meaning could change the scientific framing if misunderstood.",
    "- A good grounding target is usually a domain term, method name, mechanism, dataset/benchmark name, model architecture, theorem/conjecture, material, reaction, observable, or instrument-specific phrase.",
    "- Infer one provisional discipline label with a confidence score from 0 to 1.",
    "- If a known discipline context is explicitly provided, use it as the discipline label with high confidence unless the query clearly conflicts.",
    "- If no known discipline context is provided, infer the discipline from the query only; use low confidence when ambiguous.",
    "- This provisional discipline is not final; the later problem framing stage will decide the final discipline.",
    "- Preserve the user's original spelling, casing, and language for each selected span.",
    "- Select 0-4 targets.",
    "- Do not search the web in this step.",
    "- Do not explain the concept itself; only decide what should be grounded.",
    "- Each selection reason should reference the provisional discipline and its confidence when that affects why the term needs grounding.",
    "- If multiple targets are selected, prefer targets whose disciplines are consistent or compatible; explain compatibility in the compatibility field.",
    "- Prefer a narrow technical phrase over the whole query when possible.",
    "- If the query is already clear and no term needs grounding, return an empty targets array and explain why.",
    "",
    schemaInstruction(GROUNDING_TARGET_SCHEMA),
  ].join("\n");
  const raw = await modelStep({
    stepId: "grounding_target_selection_model",
    system: "You select exact scientific terms that should be grounded before framing a research problem.",
    prompt,
    includeRenderedContext: false,
    stream: false,
  });
  const targetPlan = await parseOrRepairGroundingTargets(input, raw, modelStep);
  input.onProgress?.({
    label: "Select grounding terms",
    detail: targetPlan.targets.length > 0
      ? `Selected ${targetPlan.targets.length} grounding target(s).`
      : "No grounding targets were selected.",
    data: {
      query: plan.query,
      step: "grounding_target_selection",
      status: "completed",
      terms: targetPlan.targets.map((target) => target.term),
      provisionalDiscipline: targetPlan.discipline,
      compatibility: targetPlan.compatibility,
      rationale: targetPlan.rationale,
      noGroundingReason: targetPlan.no_grounding_reason,
    },
  });
  return targetPlan;
}

async function parseOrRepairGroundingTargets(input: SpecialistRunInput, rawText: string, modelStep: ModelStepRunner): Promise<GroundingTargetPlan> {
  try {
    return coerceGroundingTargetPlan(parseStructuredOutput(rawText, GROUNDING_TARGET_SCHEMA));
  } catch (error) {
    try {
      return coerceGroundingTargetPlan(salvageStructuredOutput(rawText, GROUNDING_TARGET_SCHEMA));
    } catch {
      try {
        const repaired = await modelStep({
          stepId: "grounding_target_repair_model",
          system: "You repair invalid grounding target selection outputs into valid JSON.",
          prompt: repairInstruction(
            GROUNDING_TARGET_SCHEMA,
            rawText,
            error instanceof Error ? error.message : String(error),
          ),
          includeRenderedContext: false,
          stream: false,
        });
        return coerceGroundingTargetPlan(parseStructuredOutput(repaired, GROUNDING_TARGET_SCHEMA));
      } catch {
        return {
          discipline: {
            label: "unknown",
            confidence: 0,
            rationale: "Grounding target selection did not return valid structured output.",
          },
          targets: [],
          rationale: "",
          compatibility: "",
          no_grounding_reason: "Grounding target selection did not return valid structured output.",
        };
      }
    }
  }
}

function coerceGroundingTargetPlan(value: Record<string, unknown>): GroundingTargetPlan {
  const discipline = typeof value.discipline === "object" && value.discipline !== null
    ? value.discipline as Record<string, unknown>
    : {};
  return {
    discipline: {
      label: normalizeDisciplineLabel(asString(discipline.label)),
      confidence: clampConfidence(discipline.confidence),
      rationale: asString(discipline.rationale),
    },
    targets: Array.isArray(value.targets)
      ? value.targets.map((item) => {
          const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
          return {
            term: asString(record.term),
            reason: asString(record.reason),
          };
        }).filter((target) => target.term)
      : [],
    rationale: asString(value.rationale),
    compatibility: asString(value.compatibility),
    no_grounding_reason: asString(value.no_grounding_reason),
  };
}

async function groundQueryConcepts(
  input: SpecialistRunInput,
  targetPlan: GroundingTargetPlan,
  originalQuestion: string,
  disciplineContext: GroundingDisciplineContext | undefined,
  modelStep: ModelStepRunner,
): Promise<GroundingResult[]> {
  const targets = targetPlan.targets.filter((target) => target.term.trim());
  if (targets.length === 0) return [];
  const results: GroundingResult[] = [];
  for (const target of targets) {
    input.onProgress?.({
      label: "Ground selected term",
      detail: `Using hosted web search to ground "${target.term}" before framing.`,
      data: {
        term: target.term,
        reason: target.reason,
        tool: "openai_hosted_web_search",
      },
    });
    const result = await callHostedWebSearch(input, target, originalQuestion, disciplineContext, modelStep);
    input.onProgress?.({
      label: "Search web with model",
      detail: `Used hosted web search to ground "${target.term}": ${result.status}.`,
      data: {
        term: target.term,
        tool: "openai_hosted_web_search",
        status: result.status,
        resultCount: groundingResultCount(result.output),
        topResults: groundingTopResults(result.output),
        note: groundingProgressNote(result.output, result.error),
        summary: summarizeGroundingOutput(result.output, result.error),
      },
    });
    results.push({
      term: target.term,
      tool: "openai_hosted_web_search",
      status: result.status,
      summary: summarizeGroundingOutput(result.output, result.error),
    });
  }
  return results;
}

async function callHostedWebSearch(
  input: SpecialistRunInput,
  target: GroundingTarget,
  originalQuestion: string,
  disciplineContext: GroundingDisciplineContext | undefined,
  modelStep: ModelStepRunner,
) {
  if (!input.model.supportsHostedWebSearch) {
    return {
      name: "openai_hosted_web_search",
      status: "failed" as const,
      error: `hosted_web_search_not_supported_by_model: ${input.model.label ?? "model"}`,
    };
  }
  input.onProgress?.({
    label: "Search web with model",
    detail: `Starting hosted web_search for "${target.term}".`,
    data: {
      term: target.term,
      tool: "openai_hosted_web_search",
      status: "started",
    },
  });
  const prompt = [
    "Use web search to ground one selected scientific term before problem framing.",
    `Original user research query: ${originalQuestion}`,
    `Selected grounding term: "${target.term}"`,
    ...renderGroundingDisciplinePromptLines(disciplineContext),
    "",
    "Search the selected term exactly first. Then check close variants only if the exact term is not established.",
    "Do not silently conflate the selected term with broader nearby concepts. Name distinct meanings separately.",
    "If the exact term is not standardized, say that explicitly and explain the most plausible interpretations separately.",
    "",
    "Return concise Markdown using this schema:",
    "## Exact Term Status",
    "State whether the selected term appears standardized, emerging, ambiguous, or not found.",
    "## Most Plausible Meanings",
    "Separate exact usage from nearby-but-different terms.",
    "## Relevance To The User Query",
    "Explain which interpretation best fits the original query and why.",
    "## Source-Backed Notes",
    "Give 2-4 notes with URLs.",
    "## Caveats",
    "Name uncertainty, terminology drift, and what should be asked next.",
  ].join("\n");
  input.onModelPrompt?.({
    specialistId: "openai_hosted_web_search",
    system: "You are a scientific concept grounding assistant. Use web search when available and cite URLs.",
    user: prompt,
  });
  try {
    const text = await modelStep({
      stepId: "openai_hosted_web_search",
      system: "You are a scientific concept grounding assistant. Use web search when available and cite URLs.",
      prompt,
      includeRenderedContext: false,
      stream: false,
      hostedWebSearch: true,
    });
    return {
      name: "openai_hosted_web_search",
      status: "completed" as const,
      output: {
        query: target.term,
        results: [{ title: `Hosted web grounding for ${target.term}`, summary: text }],
        summary: text,
      },
    };
  } catch (error) {
    return {
      name: "openai_hosted_web_search",
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function groundingResultCount(output: unknown): number | undefined {
  if (!output || typeof output !== "object") return undefined;
  const results = (output as Record<string, unknown>).results;
  return Array.isArray(results) ? results.length : undefined;
}

function groundingTopResults(output: unknown): Array<{ title: string; link?: string }> {
  if (!output || typeof output !== "object") return [];
  const results = (output as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, 3).map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return {
      title: String(record.title ?? record.id ?? "Untitled result"),
      link: typeof record.link === "string" ? record.link : undefined,
    };
  });
}

function groundingProgressNote(output: unknown, error?: string): string | undefined {
  if (error) return error;
  if (!output || typeof output !== "object") return undefined;
  const note = (output as Record<string, unknown>).note;
  return typeof note === "string" ? note : undefined;
}

function normalizeGroundingFallbackQuery(question: string): string | undefined {
  const cleaned = question.replace(/\s+/g, " ").trim();
  if (cleaned.length < 4) return undefined;
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}...` : cleaned;
}

function summarizeGroundingOutput(output: unknown, error?: string): string {
  if (error) return error;
  if (output === undefined) return "No output returned.";
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const summary = (output as Record<string, unknown>).summary;
    if (typeof summary === "string") return summary;
  }
  return JSON.stringify(output);
}

function buildGroundingContext(results: GroundingResult[], targetPlan: GroundingTargetPlan): string {
  const usefulResults = results.filter((result) => result.status === "completed" && groundingSummaryIsUseful(result.summary));
  const disciplineContext = renderProvisionalDisciplineContext(targetPlan);
  if (usefulResults.length === 0) return disciplineContext;
  const byTerm = new Map<string, GroundingResult[]>();
  for (const result of usefulResults) {
    byTerm.set(result.term, [...(byTerm.get(result.term) ?? []), result]);
  }
  const groundedTerms = [...byTerm.entries()]
    .map(([term, termResults]) => {
      const summary = termResults
        .map((result) => result.summary)
        .filter(groundingSummaryIsUseful)
        .join("\n\n")
        .trim();
      return `Term: ${term}\nGrounded summary:\n${summary}`;
    })
    .filter((item) => item.trim())
    .join("\n\n");
  return [disciplineContext, groundedTerms].filter(Boolean).join("\n\n");
}

function groundingSummaryIsUseful(summary: string): boolean {
  return Boolean(summary.trim()) && !/no matching|not connected|unavailable|not supported|failed/i.test(summary);
}

function renderProvisionalDisciplineContext(targetPlan: GroundingTargetPlan): string {
  const label = normalizeDisciplineLabel(targetPlan.discipline.label);
  if (!label || label === "unknown") return "";
  const confidence = Number.isFinite(targetPlan.discipline.confidence)
    ? targetPlan.discipline.confidence.toFixed(2)
    : "0.00";
  return [
    "Provisional discipline context from grounding-target selection:",
    `- label: ${label}`,
    `- confidence: ${confidence}`,
    targetPlan.discipline.rationale ? `- rationale: ${targetPlan.discipline.rationale}` : "",
    targetPlan.compatibility ? `- target compatibility: ${targetPlan.compatibility}` : "",
    "- note: this is not final; problem framing must decide the final discipline.",
  ].filter(Boolean).join("\n");
}

function renderGroundingDisciplinePromptLines(context?: GroundingDisciplineContext): string[] {
  if (!context) return [];
  const label = normalizeDisciplineLabel(context.label);
  if (!label || label === "unknown") return [];
  const prefix = context.source === "explicit" ? "Known discipline context" : "Provisional discipline context";
  return [
    `${prefix}: ${label}`,
    `Discipline confidence: ${context.confidence.toFixed(2)}`,
  ].filter(Boolean);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normalizeDisciplineLabel(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const allowed = new Set([
    "artificial_intelligence",
    "mathematics",
    "chemistry",
    "chemical_engineering",
    "physics",
    "general_science",
    "unknown",
  ]);
  return allowed.has(normalized) ? normalized : "unknown";
}

function knownDisciplineForGrounding(value: string): string | undefined {
  const normalized = normalizeDisciplineLabel(value);
  return normalized && normalized !== "unknown" && normalized !== "general_science" ? normalized : undefined;
}

function inferredDisciplineForGrounding(value: ProvisionalDiscipline): ProvisionalDiscipline | undefined {
  const label = normalizeDisciplineLabel(value.label);
  if (!label || label === "unknown" || label === "general_science") return undefined;
  if (value.confidence < 0.5) return undefined;
  return {
    label,
    confidence: value.confidence,
    rationale: value.rationale,
  };
}

function groundingDisciplineContextFor(
  explicitDiscipline: string | undefined,
  inferredDiscipline: ProvisionalDiscipline,
): GroundingDisciplineContext | undefined {
  if (explicitDiscipline) {
    return {
      label: explicitDiscipline,
      confidence: 1,
      rationale: "Discipline was explicitly provided by the task.",
      source: "explicit",
    };
  }
  const inferred = inferredDisciplineForGrounding(inferredDiscipline);
  return inferred ? { ...inferred, source: "inferred" } : undefined;
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function detectLanguagePolicy(text: string): LanguagePolicy {
  if (/[\u4e00-\u9fff]/u.test(text)) {
    return {
      inputLanguage: "zh",
      primarySearchLanguage: "en",
      reason: "Most scientific literature databases have stronger English coverage, while the original Chinese query is retained for intent preservation.",
    };
  }
  if (/^[\x00-\x7F]*$/.test(text)) {
    return {
      inputLanguage: "en",
      primarySearchLanguage: "en",
      reason: "Input appears to be English, so literature search queries use English.",
    };
  }
  return {
    inputLanguage: "mixed_or_unknown",
    primarySearchLanguage: "en",
    reason: "Input language is mixed or unclear; English search is used as the default scientific literature retrieval language.",
  };
}
