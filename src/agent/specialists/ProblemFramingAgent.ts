import { makeId } from "../../shared/ids.js";
import type { ScientificTask, StageResult } from "../../shared/types.js";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  schemaInstruction,
  type StructuredSchema,
} from "../../structured/StructuredOutput.js";
import { BaseSpecialistAgent, type SpecialistRunInput } from "../SpecialistAgent.js";

export class ProblemFramingAgent extends BaseSpecialistAgent {
  id = "problem_framing_agent";
  stage = "problem_framing" as const;
  description = "Frames the research problem before downstream literature review and hypothesis work.";

  async run(input: SpecialistRunInput): Promise<StageResult> {
    const task = input.plan.inputs.task as ScientificTask;
    const disciplineHint = String(input.plan.inputs.discipline ?? task.discipline ?? "to_be_determined");
    const groundingPlan = planQueryGrounding(task.question);
    input.onProgress?.({
      label: "Interpret user query",
      detail: "Identified technical terms and ambiguity that may need grounding before problem framing.",
      data: {
        rawQuestion: task.question,
        disciplineHint,
        candidateTerms: groundingPlan.terms,
        needsGrounding: groundingPlan.needsGrounding,
        requireHostedWebSearch: groundingPlan.requireHostedWebSearch,
        reason: groundingPlan.reason,
      },
    });
    const groundingResults = await groundQueryConcepts(input, groundingPlan);
    const languagePolicy = detectLanguagePolicy(task.question);
    const framingPrompt = [
      "Frame this scientific research problem.",
      `Question: ${task.question}`,
      `Initial discipline hint: ${disciplineHint}. If the hint is "to_be_determined", infer the discipline from the grounded problem.`,
      "The returned discipline is the official downstream discipline label for literature review, hypothesis generation, and experiment planning.",
      "Use one discipline label from: artificial_intelligence, mathematics, chemistry, chemical_engineering, physics, general_science, unknown.",
      groundingResults.length > 0
        ? `Concept grounding context:\n${groundingResults.map(formatGroundingResultForPrompt).join("\n")}`
        : "Concept grounding context: no external grounding results were available; explicitly mark uncertain terminology as assumptions.",
      schemaInstruction(PROBLEM_FRAME_SCHEMA),
      "All Immediate Literature Queries MUST be written in English, even if the user's query is Chinese or mixed-language.",
      "Each Immediate Literature Query MUST be a concrete database-ready search string, not a goal, instruction, or vague description.",
      "Use exact technical terms, aliases, mechanism words, method names, benchmark names, and quoted phrases when useful.",
      "Return 5-8 queries when possible.",
      "Good examples:",
      '- term grounding: "attention residuals" transformer residual stream',
      '- mechanism: "attention residuals" depth-wise attention transformer layers',
      '- baseline comparison: "residual connections" transformer attention sublayer prenorm',
      "Bad examples:",
      "- find papers about this topic",
      "- understand attention residual",
      "- literature review for the research query",
      `Search language policy: ${languagePolicy.reason}`,
    ].join("\n");
    const rawSummary = await this.modelSummary(input, framingPrompt);
    const parsedFrame = await parseOrRepairProblemFrame(input, rawSummary);
    const framedDiscipline = parsedFrame.discipline || "unknown";
    const extractedQueries = normalizeStructuredLiteratureQueries(parsedFrame.immediate_literature_queries, languagePolicy);
    const rejectedQueries = extractedQueries.rejected;
    const searchQueries = extractedQueries.accepted;
    const hasRequiredSearchQueries = searchQueries.length > 0;
    const successCriteria = task.successCriteria?.length
      ? task.successCriteria
      : [
          "question is narrowed into a testable research objective",
          "literature review has explicit search targets",
          "later hypotheses can be evaluated against stated evidence criteria",
        ];
    const summary = renderProblemFrameMarkdown(parsedFrame, searchQueries, rejectedQueries);

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
            framedDiscipline,
            taskType: task.taskType ?? "chat_research",
            candidateTerms: groundingPlan.terms,
            requireHostedWebSearch: groundingPlan.requireHostedWebSearch,
            groundingResults,
          },
        },
        {
          label: "Define framing outputs",
          status: "completed",
          detail: "Identified the minimal information downstream stages need.",
          data: {
            expectedFields: ["objective", "scope", "variables", "constraints", "success criteria", "literature queries"],
          },
        },
        {
          label: "Prepare literature search seeds",
          status: hasRequiredSearchQueries ? "completed" : "blocked",
          detail: hasRequiredSearchQueries
            ? "Extracted Immediate Literature Queries from the problem framing output."
            : "Problem framing output is missing the required Immediate Literature Queries section.",
          data: {
            inputLanguage: languagePolicy.inputLanguage,
            primarySearchLanguage: languagePolicy.primarySearchLanguage,
            reason: languagePolicy.reason,
            searchQueries,
            rejectedQueries,
            querySource: "model_immediate_literature_queries",
            constraint: "Immediate Literature Queries must be English for scientific database retrieval.",
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
            disciplineHint,
            languagePolicy,
            groundingTerms: groundingPlan.terms,
            groundingResults,
            searchQueries,
            rejectedQueries,
            structuredFrame: parsedFrame,
            querySource: "model_immediate_literature_queries",
            successCriteria,
            schemaSatisfied: hasRequiredSearchQueries,
          },
        },
      ],
      memoryProposals: [
        {
          scope: "project",
          kind: "decision",
          title: "Problem framing",
          summary: summary.slice(0, 220),
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
        status: hasRequiredSearchQueries ? "advance" : "needs_human_review",
        nextStage: hasRequiredSearchQueries ? "literature_review" : "problem_framing",
        reason: hasRequiredSearchQueries
          ? "The research problem is framed enough to drive targeted literature review."
          : "Problem framing output must include Immediate Literature Queries before literature review can start.",
        confidence: hasRequiredSearchQueries ? "medium" : "low",
      },
    };
  }
}

interface SearchQueryPlan {
  query: string;
  language: string;
  purpose: string;
}

interface ProblemFrameQuery {
  purpose: string;
  query: string;
}

interface ProblemFrame {
  discipline: string;
  objective: string;
  scope: string;
  key_variables: string[];
  constraints: string[];
  success_criteria: string[];
  immediate_literature_queries: ProblemFrameQuery[];
  ambiguities: string[];
}

interface ExtractedSearchQueries {
  accepted: SearchQueryPlan[];
  rejected: Array<{ query: string; reason: string }>;
}

interface LanguagePolicy {
  inputLanguage: "zh" | "en" | "mixed_or_unknown";
  primarySearchLanguage: "en" | "input";
  reason: string;
}

interface GroundingPlan {
  terms: string[];
  needsGrounding: boolean;
  reason: string;
  requireHostedWebSearch: boolean;
}

const PROBLEM_FRAME_SCHEMA: StructuredSchema = {
  name: "problem_frame",
  description: "A structured scientific problem frame for downstream literature review and hypothesis generation.",
  schema: {
    type: "object",
    required: [
      "discipline",
      "objective",
      "scope",
      "key_variables",
      "constraints",
      "success_criteria",
      "immediate_literature_queries",
      "ambiguities",
    ],
    properties: {
      discipline: {
        type: "string",
        description: "Official downstream discipline label: artificial_intelligence, mathematics, chemistry, chemical_engineering, physics, general_science, or unknown.",
      },
      objective: { type: "string" },
      scope: { type: "string" },
      key_variables: { type: "array", items: { type: "string" } },
      constraints: { type: "array", items: { type: "string" } },
      success_criteria: { type: "array", items: { type: "string" } },
      immediate_literature_queries: {
        type: "array",
        items: {
          type: "object",
          required: ["purpose", "query"],
          properties: {
            purpose: { type: "string" },
            query: { type: "string" },
          },
        },
      },
      ambiguities: { type: "array", items: { type: "string" } },
    },
  },
};

async function parseOrRepairProblemFrame(input: SpecialistRunInput, rawText: string): Promise<ProblemFrame> {
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
      const repaired = await input.model.complete(
        [
          {
            role: "system",
            content: "You repair invalid structured scientific agent outputs into valid JSON.",
          },
          { role: "user", content: repairPrompt },
        ],
        {
          onStatus: input.onModelStatus,
          onTextDelta: input.onModelDelta,
        },
      );
      try {
        return coerceProblemFrame(parseStructuredOutput(repaired.text, PROBLEM_FRAME_SCHEMA));
      } catch {
        const task = input.plan.inputs.task as ScientificTask | undefined;
        return fallbackProblemFrame(rawText, task?.question ?? input.plan.objective);
      }
    }
  }
}

function fallbackProblemFrame(rawText: string, question: string): ProblemFrame {
  const seed = extractCandidateTechnicalTerms(question)[0] || question.split(/\s+/).filter((token) => token.length > 3).slice(0, 4).join(" ");
  return {
    discipline: "unknown",
    objective: question || "Frame the scientific research problem.",
    scope: "Fallback frame derived from unstructured model output; requires review before downstream use.",
    key_variables: seed ? [seed] : [],
    constraints: ["Structured problem framing failed and should be reviewed."],
    success_criteria: [
      "question is narrowed into a testable research objective",
      "literature review has explicit search targets",
      "later hypotheses can be evaluated against stated evidence criteria",
    ],
    immediate_literature_queries: seed
      ? [
          {
            purpose: "fallback search",
            query: `${seed} scientific literature`,
          },
        ]
      : [],
    ambiguities: [rawText.slice(0, 240)],
  };
}

function coerceProblemFrame(value: Record<string, unknown>): ProblemFrame {
  return {
    discipline: normalizeDisciplineLabel(asString(value.discipline)),
    objective: asString(value.objective),
    scope: asString(value.scope),
    key_variables: asStringArray(value.key_variables),
    constraints: asStringArray(value.constraints),
    success_criteria: asStringArray(value.success_criteria),
    immediate_literature_queries: Array.isArray(value.immediate_literature_queries)
      ? value.immediate_literature_queries.map((item) => {
          const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
          return {
            purpose: asString(record.purpose),
            query: asString(record.query),
          };
        })
      : [],
    ambiguities: asStringArray(value.ambiguities),
  };
}

function renderProblemFrameMarkdown(
  frame: ProblemFrame,
  acceptedQueries: SearchQueryPlan[],
  rejectedQueries: Array<{ query: string; reason: string }>,
): string {
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
    "",
    "## Immediate Literature Queries",
    ...(acceptedQueries.length
      ? acceptedQueries.map((item) => `- ${item.purpose}: ${item.query}`)
      : ["- No valid English database-ready queries returned."]),
  ];
  if (rejectedQueries.length > 0) {
    lines.push("", "## Rejected Literature Queries", ...rejectedQueries.map((item) => `- ${item.query}: ${item.reason}`));
  }
  if (frame.ambiguities.length > 0) {
    lines.push("", "## Ambiguities", ...renderList(frame.ambiguities));
  }
  return lines.join("\n");
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
  const terms = extractCandidateTechnicalTerms(question);
  const fallbackQuery = normalizeGroundingFallbackQuery(question);
  const groundingTargets = terms.length > 0 ? terms : fallbackQuery ? [fallbackQuery] : [];
  return {
    terms: groundingTargets,
    needsGrounding: groundingTargets.length > 0,
    requireHostedWebSearch: true,
    reason: terms.length > 0
      ? "The query contains domain-specific phrases that may change the research framing if misunderstood."
      : "No clear domain-specific phrase was detected, so the full research query is grounded before framing.",
  };
}

async function groundQueryConcepts(input: SpecialistRunInput, plan: GroundingPlan): Promise<GroundingResult[]> {
  if (!plan.needsGrounding) return [];
  const task = input.plan.inputs.task as ScientificTask;
  const tools = ["query_literature_wiki", "openai_hosted_web_search"];
  const results: GroundingResult[] = [];
  for (const term of plan.terms) {
    input.onProgress?.({
      label: "Ground technical term",
      detail: `Checking whether "${term}" needs external context before framing.`,
      data: {
        term,
        tools,
      },
    });
    for (const tool of tools) {
      const result = tool === "openai_hosted_web_search"
        ? await callHostedWebSearch(input, term, task.question)
        : await input.tools.call({
            name: tool,
            arguments: {
              query: term,
              purpose: "problem_framing_concept_grounding",
              limit: 3,
            },
          });
      input.onProgress?.({
        label: groundingProgressLabel(tool),
        detail: groundingProgressDetail(tool, term, result.status),
        data: {
          term,
          tool,
          status: result.status,
          resultCount: groundingResultCount(result.output),
          topResults: groundingTopResults(result.output),
          note: groundingProgressNote(result.output, result.error),
          summary: summarizeGroundingOutput(result.output, result.error),
        },
      });
      results.push({
        term,
        tool,
        status: result.status,
        summary: summarizeGroundingOutput(result.output, result.error),
      });
      if (
        tool !== "query_literature_wiki" &&
        result.status === "completed" &&
        groundingOutputIsUseful(result.output)
      ) {
        break;
      }
    }
  }
  return results;
}

function groundingProgressLabel(tool: string): string {
  if (tool === "query_literature_wiki") return "Search local literature wiki";
  if (tool === "openai_hosted_web_search") return "Search web with model";
  return `Run ${tool}`;
}

function groundingProgressDetail(tool: string, term: string, status: string): string {
  if (tool === "query_literature_wiki") return `Looked for "${term}" in the local literature wiki: ${status}.`;
  if (tool === "openai_hosted_web_search") return `Used OpenAI hosted web_search to ground "${term}": ${status}.`;
  return `Used ${tool} for "${term}": ${status}.`;
}

async function callHostedWebSearch(input: SpecialistRunInput, term: string, originalQuestion: string) {
  if (!input.model.supportsHostedWebSearch) {
    return {
      name: "openai_hosted_web_search",
      status: "failed" as const,
      error: `hosted_web_search_not_supported_by_model: ${input.model.label ?? "model"}`,
    };
  }
  input.onProgress?.({
    label: "Search web with model",
    detail: `Starting hosted web_search for "${term}".`,
    data: {
      term,
      tool: "openai_hosted_web_search",
      status: "started",
    },
  });
  const prompt = [
    "Use web search to ground a scientific term before problem framing.",
    `Original user research query: ${originalQuestion}`,
    `Term or phrase to ground exactly: "${term}"`,
    "",
    "Search and reason with the exact phrase first. Then check close variants only if the exact phrase is not established.",
    "Do not silently conflate the phrase with a broader nearby concept such as residual connections, residual attention, or attention residual learning.",
    "If the exact phrase is not a standardized term, say that explicitly and explain the most plausible interpretations separately.",
    "",
    "Return concise Markdown using this schema:",
    "## Exact Term Status",
    "State whether the exact phrase appears to be standardized, emerging, ambiguous, or not found.",
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
    const completion = await input.model.complete(
      [
        {
          role: "system",
          content: "You are a scientific concept grounding assistant. Use web search when available and cite URLs.",
        },
        { role: "user", content: prompt },
      ],
      {
        hostedWebSearch: true,
        onStatus: input.onModelStatus,
      },
    );
    return {
      name: "openai_hosted_web_search",
      status: "completed" as const,
      output: {
        query: term,
        results: [{ title: `Hosted web grounding for ${term}`, summary: completion.text }],
        summary: completion.text,
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

function extractCandidateTechnicalTerms(question: string): string[] {
  const normalized = question.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  const quoted = [...normalized.matchAll(/["']([^"']{4,80})["']/g)].map((match) => match[1]);
  const knownPatterns = [
    /\battention\s+residuals?\b/gi,
    /\bresidual\s+attention\b/gi,
    /\btransformer\s+circuits?\b/gi,
    /\bmechanistic\s+interpretability\b/gi,
    /\brepresentation\s+engineering\b/gi,
    /\bsparse\s+autoencoders?\b/gi,
    /\bactivation\s+patching\b/gi,
    /\bcausal\s+tracing\b/gi,
  ];
  const known = knownPatterns.flatMap((pattern) => [...normalized.matchAll(pattern)].map((match) => match[0]));
  const slashOrHyphenTerms = [...normalized.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+){1,3}\b/g)].map((match) => match[0]);
  const acronymTerms = [...normalized.matchAll(/\b[A-Z]{2,}(?:-[A-Z0-9]+)?\b/g)].map((match) => match[0]);
  return uniqueTerms([...quoted, ...known, ...slashOrHyphenTerms, ...acronymTerms]).slice(0, 6);
}

function normalizeGroundingFallbackQuery(question: string): string | undefined {
  const cleaned = question.replace(/\s+/g, " ").trim();
  if (cleaned.length < 4) return undefined;
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}...` : cleaned;
}

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const term of terms) {
    const cleaned = term.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || cleaned.length < 4 || seen.has(key)) continue;
    seen.add(key);
    unique.push(cleaned);
  }
  return unique;
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

function groundingOutputIsUseful(output: unknown): boolean {
  if (output === undefined || output === null) return false;
  if (typeof output === "string") return !/no matching|not connected|unavailable/i.test(output);
  if (Array.isArray(output)) return output.length > 0;
  if (typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (Array.isArray(record.results)) return record.results.length > 0;
    if (typeof record.available === "boolean") return record.available;
  }
  return true;
}

function formatGroundingResultForPrompt(result: GroundingResult): string {
  return `- ${result.term} via ${result.tool}: ${result.status}; ${result.summary}`;
}

function extractImmediateLiteratureQueries(summary: string, languagePolicy: LanguagePolicy): ExtractedSearchQueries {
  const sectionLines = extractLiteratureQuerySection(summary);
  return normalizeQueryLines(sectionLines, languagePolicy);
}

function normalizeStructuredLiteratureQueries(queries: ProblemFrameQuery[], languagePolicy: LanguagePolicy): ExtractedSearchQueries {
  return normalizeQueryLines(
    queries.map((item) => `${item.purpose || "framed literature query"}: ${item.query}`),
    languagePolicy,
  );
}

function normalizeQueryLines(lines: string[], languagePolicy: LanguagePolicy): ExtractedSearchQueries {
  const accepted: SearchQueryPlan[] = [];
  const rejected: Array<{ query: string; reason: string }> = [];
  for (const line of lines) {
    const normalized = normalizeQueryLine(line, languagePolicy);
    if (!normalized) continue;
    if (containsCjk(normalized.query)) {
      rejected.push({
        query: normalized.query,
        reason: "Immediate Literature Queries must be English.",
      });
      continue;
    }
    const qualityRejectionReason = queryQualityRejectionReason(normalized.query);
    if (qualityRejectionReason) {
      rejected.push({
        query: normalized.query,
        reason: qualityRejectionReason,
      });
      continue;
    }
    accepted.push(normalized);
  }
  return { accepted, rejected };
}

function extractLiteratureQuerySection(summary: string): string[] {
  const lines = summary.split(/\r?\n/);
  const section: string[] = [];
  let inSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inSection && section.length > 0) break;
      continue;
    }
    if (isLiteratureQueryHeading(line)) {
      inSection = true;
      const inline = line.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/:?$/, "").trim();
      const afterColon = inline.split(":").slice(1).join(":").trim();
      if (afterColon) section.push(afterColon);
      continue;
    }
    if (inSection && (/^#{1,6}\s+/.test(line) || isMarkdownSectionHeading(line))) break;
    if (inSection) section.push(line);
  }
  return section;
}

function isLiteratureQueryHeading(line: string): boolean {
  const normalized = line.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").toLowerCase();
  return /immediate\s+literature\s+queries|literature\s+queries|search\s+queries|[\u6587\u732e].*[\u68c0\u7d22]|[\u68c0\u7d22].*[\u95ee\u9898]/u.test(normalized);
}

function isMarkdownSectionHeading(line: string): boolean {
  return /^\*\*[^*]+:\*\*$/.test(line) || /^\*\*[^*]+\*\*$/.test(line);
}

function normalizeQueryLine(line: string, languagePolicy: LanguagePolicy): SearchQueryPlan | undefined {
  const cleaned = line
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (!cleaned) return undefined;
  const parts = cleaned.split(":");
  const maybePurpose = parts.length > 1 ? parts[0].trim() : "";
  const query = parts.length > 1 ? parts.slice(1).join(":").trim() : cleaned;
  if (!query || query.length < 4) return undefined;
  return {
    query,
    language: languagePolicy.primarySearchLanguage,
    purpose: maybePurpose && maybePurpose.length < 40 ? maybePurpose : "framed literature query",
  };
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(text);
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function queryQualityRejectionReason(query: string): string | undefined {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length > 180) return "Query is too long to be a focused literature search string.";
  if (/^(find|search|look for|look up|identify|understand|review|summarize|investigate)\b/.test(normalized)) {
    return "Query must be concrete search terms, not an instruction.";
  }
  if (/\b(this topic|the topic|user query|research query|the problem|this problem)\b/.test(normalized)) {
    return "Query must name the technical target explicitly.";
  }
  if (/^(what|why|how|when|where|which)\b/.test(normalized) || normalized.endsWith("?")) {
    return "Query must be keyword-style search terms, not a natural-language question.";
  }
  const tokens = normalized.match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const generic = new Set([
    "article",
    "articles",
    "current",
    "evidence",
    "latest",
    "literature",
    "method",
    "methods",
    "paper",
    "papers",
    "problem",
    "query",
    "recent",
    "research",
    "review",
    "scientific",
    "source",
    "sources",
    "studies",
    "study",
    "topic",
  ]);
  const specificTerms = tokens.filter((token) => !generic.has(token) && token.length >= 4);
  const hasQuotedPhrase = /"[^"]{4,}"/.test(query);
  if (specificTerms.length < 2 && !hasQuotedPhrase) {
    return "Query must include at least two concrete technical terms or one quoted exact phrase.";
  }
  return undefined;
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
