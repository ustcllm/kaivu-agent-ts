import { makeId } from "../../shared/ids.js";
import type { StageResult } from "../../shared/types.js";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  schemaInstruction,
  type StructuredSchema,
} from "../../structured/StructuredOutput.js";
import { BaseSpecialistAgent, type SpecialistRunInput } from "../SpecialistAgent.js";

interface HypothesisTheoryObject {
  name: string;
  statement: string;
  theory_family: string;
  mechanism_chain: string[];
  assumptions: string[];
  boundary_conditions: string[];
  predictions: string[];
  counterfactual_predictions: string[];
  falsification_tests: string[];
  measurable_variables: string[];
  discriminating_experiments: string[];
  rival_explanations: string[];
  evidence_refs: string[];
  missing_theory_fields: string[];
}

interface HypothesisGenerationFrame {
  synthesis_basis: string;
  hypotheses: HypothesisTheoryObject[];
  hypothesis_relations: Array<{
    source_name: string;
    relation: string;
    target_name: string;
    rationale: string;
  }>;
  decision_notes: string[];
}

const HYPOTHESIS_GENERATION_SCHEMA: StructuredSchema = {
  name: "hypothesis_generation_frame",
  description: "Structured scientific hypotheses grounded in literature evidence, conflicts, and explicit falsification logic.",
  schema: {
    type: "object",
    required: ["synthesis_basis", "hypotheses", "hypothesis_relations", "decision_notes"],
    properties: {
      synthesis_basis: { type: "string" },
      hypotheses: {
        type: "array",
        items: {
          type: "object",
          required: [
            "name",
            "statement",
            "theory_family",
            "mechanism_chain",
            "assumptions",
            "boundary_conditions",
            "predictions",
            "counterfactual_predictions",
            "falsification_tests",
            "measurable_variables",
            "discriminating_experiments",
            "rival_explanations",
            "evidence_refs",
            "missing_theory_fields",
          ],
          properties: {
            name: { type: "string" },
            statement: { type: "string" },
            theory_family: { type: "string" },
            mechanism_chain: { type: "array", items: { type: "string" } },
            assumptions: { type: "array", items: { type: "string" } },
            boundary_conditions: { type: "array", items: { type: "string" } },
            predictions: { type: "array", items: { type: "string" } },
            counterfactual_predictions: { type: "array", items: { type: "string" } },
            falsification_tests: { type: "array", items: { type: "string" } },
            measurable_variables: { type: "array", items: { type: "string" } },
            discriminating_experiments: { type: "array", items: { type: "string" } },
            rival_explanations: { type: "array", items: { type: "string" } },
            evidence_refs: { type: "array", items: { type: "string" } },
            missing_theory_fields: { type: "array", items: { type: "string" } },
          },
        },
      },
      hypothesis_relations: {
        type: "array",
        items: {
          type: "object",
          required: ["source_name", "relation", "target_name", "rationale"],
          properties: {
            source_name: { type: "string" },
            relation: { type: "string" },
            target_name: { type: "string" },
            rationale: { type: "string" },
          },
        },
      },
      decision_notes: { type: "array", items: { type: "string" } },
    },
  },
};

export class HypothesisGenerationAgent extends BaseSpecialistAgent {
  id = "hypothesis_generation_agent";
  stage = "hypothesis_generation" as const;
  description = "Generates testable hypotheses, assumptions, predictions, and rival explanations.";

  async run(input: SpecialistRunInput): Promise<StageResult> {
    const prompt = [
      `Generate testable scientific hypotheses for: ${input.plan.objective}.`,
      "Use the current research state as evidence context, especially literature review outputs, evidence gaps, rejected ideas, and artifacts.",
      "Do not present guesses as conclusions. Each hypothesis must be falsifiable and distinguishable from at least one rival explanation.",
      "Make mechanism, boundary conditions, measurable variables, and missing theory fields explicit.",
      "Prefer 2-4 hypotheses. Avoid vague one-line hypotheses.",
      "",
      "Current research state:",
      JSON.stringify(compactResearchState(input.researchState), null, 2),
      "",
      schemaInstruction(HYPOTHESIS_GENERATION_SCHEMA),
    ].join("\n");

    input.onProgress?.({
      label: "Build hypothesis prompt",
      detail: "Prepared structured theory-object schema using current evidence and literature state.",
      data: {
        previousEvidenceCount: Array.isArray((input.researchState as { evidence?: unknown[] }).evidence)
          ? (input.researchState as { evidence: unknown[] }).evidence.length
          : 0,
        previousHypothesisCount: Array.isArray((input.researchState as { hypotheses?: unknown[] }).hypotheses)
          ? (input.researchState as { hypotheses: unknown[] }).hypotheses.length
          : 0,
      },
    });

    const raw = await this.modelSummary(input, prompt);
    const frame = await parseOrRepairHypothesisFrame(input, raw);
    const theoryObjects = normalizeTheoryObjects(frame.hypotheses);
    const summary = renderHypothesisMarkdown(frame, theoryObjects);

    input.onProgress?.({
      label: "Compile theory objects",
      detail: "Converted model output into structured hypotheses with mechanism, predictions, falsification tests, and missing fields.",
      data: {
        hypothesisCount: theoryObjects.length,
        theoryFamilies: [...new Set(theoryObjects.map((item) => item.theory_family).filter(Boolean))],
        missingFieldCounts: countMissingFields(theoryObjects),
      },
    });

    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      processTrace: [
        {
          label: "Synthesize hypothesis candidates",
          status: theoryObjects.length > 0 ? "completed" : "blocked",
          detail: theoryObjects.length > 0
            ? "Generated structured theory objects from the current research context."
            : "No valid structured hypotheses were returned.",
          data: {
            synthesisBasis: frame.synthesis_basis,
            hypothesisRelations: frame.hypothesis_relations,
            decisionNotes: frame.decision_notes,
          },
        },
        {
          label: "Check theory completeness",
          status: "completed",
          detail: "Marked missing mechanism, boundary, prediction, variable, and falsification fields for downstream validation.",
          data: {
            missingFieldCounts: countMissingFields(theoryObjects),
          },
        },
      ],
      evidence: [],
      hypotheses: theoryObjects.map((item) => ({
        id: makeId("hypothesis"),
        statement: item.statement,
        assumptions: item.assumptions,
        predictions: item.predictions,
        falsificationTests: item.falsification_tests,
        status: "candidate",
      })),
      artifacts: [
        {
          id: "hypothesis_theory_objects",
          kind: "hypothesis_theory_objects",
          uri: "memory://hypothesis_theory_objects",
          metadata: {
            synthesisBasis: frame.synthesis_basis,
            theoryObjects,
            hypothesisRelations: frame.hypothesis_relations,
            decisionNotes: frame.decision_notes,
            missingFieldCounts: countMissingFields(theoryObjects),
          },
        },
      ],
      memoryProposals: [
        {
          scope: "project",
          kind: "hypothesis",
          title: "Candidate hypothesis theory objects",
          summary: summary.slice(0, 220),
          content: summary,
          tags: ["hypothesis", "theory-object", "candidate"],
        },
      ],
      graphProposals: theoryObjects.map((item) => ({
        subject: item.name,
        predicate: "proposes_mechanism",
        object: item.mechanism_chain.join(" -> ") || item.statement,
        evidenceIds: item.evidence_refs,
      })),
      decision: {
        status: theoryObjects.length > 0 ? "advance" : "needs_human_review",
        nextStage: theoryObjects.length > 0 ? "hypothesis_validation" : "hypothesis_generation",
        reason: theoryObjects.length > 0
          ? "Structured candidate hypotheses are ready for validation."
          : "Hypothesis generation needs revision because no valid theory objects were produced.",
        confidence: theoryObjects.length > 0 ? "medium" : "low",
      },
    };
  }
}

async function parseOrRepairHypothesisFrame(input: SpecialistRunInput, rawText: string): Promise<HypothesisGenerationFrame> {
  try {
    return coerceHypothesisFrame(parseStructuredOutput(rawText, HYPOTHESIS_GENERATION_SCHEMA));
  } catch (error) {
    try {
      return coerceHypothesisFrame(salvageStructuredOutput(rawText, HYPOTHESIS_GENERATION_SCHEMA));
    } catch {
      try {
        const repaired = await input.model.complete(
          [
            {
              role: "system",
              content: "You repair invalid structured scientific agent outputs into valid JSON.",
            },
            {
              role: "user",
              content: repairInstruction(
                HYPOTHESIS_GENERATION_SCHEMA,
                rawText,
                error instanceof Error ? error.message : String(error),
              ),
            },
          ],
          {
            onStatus: input.onModelStatus,
            onTextDelta: input.onModelDelta,
          },
        );
        return coerceHypothesisFrame(parseStructuredOutput(repaired.text, HYPOTHESIS_GENERATION_SCHEMA));
      } catch {
        return fallbackHypothesisFrame(rawText);
      }
    }
  }
}

function coerceHypothesisFrame(value: Record<string, unknown>): HypothesisGenerationFrame {
  return {
    synthesis_basis: asString(value.synthesis_basis),
    hypotheses: Array.isArray(value.hypotheses)
      ? value.hypotheses.map((item) => coerceTheoryObject(isRecord(item) ? item : {}))
      : [],
    hypothesis_relations: Array.isArray(value.hypothesis_relations)
      ? value.hypothesis_relations.map((item) => {
          const record = isRecord(item) ? item : {};
          return {
            source_name: asString(record.source_name),
            relation: asString(record.relation),
            target_name: asString(record.target_name),
            rationale: asString(record.rationale),
          };
        })
      : [],
    decision_notes: asStringArray(value.decision_notes),
  };
}

function coerceTheoryObject(value: Record<string, unknown>): HypothesisTheoryObject {
  return {
    name: asString(value.name),
    statement: asString(value.statement),
    theory_family: asString(value.theory_family),
    mechanism_chain: asStringArray(value.mechanism_chain),
    assumptions: asStringArray(value.assumptions),
    boundary_conditions: asStringArray(value.boundary_conditions),
    predictions: asStringArray(value.predictions),
    counterfactual_predictions: asStringArray(value.counterfactual_predictions),
    falsification_tests: asStringArray(value.falsification_tests),
    measurable_variables: asStringArray(value.measurable_variables),
    discriminating_experiments: asStringArray(value.discriminating_experiments),
    rival_explanations: asStringArray(value.rival_explanations),
    evidence_refs: asStringArray(value.evidence_refs),
    missing_theory_fields: asStringArray(value.missing_theory_fields),
  };
}

function normalizeTheoryObjects(items: HypothesisTheoryObject[]): HypothesisTheoryObject[] {
  return items
    .filter((item) => item.statement || item.name)
    .map((item, index) => {
      const missing = new Set(item.missing_theory_fields);
      if (item.mechanism_chain.length === 0) missing.add("mechanism_chain");
      if (item.boundary_conditions.length === 0) missing.add("boundary_conditions");
      if (item.predictions.length === 0) missing.add("predictions");
      if (item.falsification_tests.length === 0) missing.add("falsification_tests");
      if (item.measurable_variables.length === 0) missing.add("measurable_variables");
      return {
        ...item,
        name: item.name || `Hypothesis ${index + 1}`,
        theory_family: item.theory_family || familyName(item.name || item.statement),
        missing_theory_fields: [...missing],
      };
    })
    .slice(0, 6);
}

function renderHypothesisMarkdown(frame: HypothesisGenerationFrame, theoryObjects: HypothesisTheoryObject[]): string {
  const lines = [
    "## Synthesis Basis",
    frame.synthesis_basis || "No synthesis basis returned.",
    "",
    "## Candidate Hypotheses",
  ];
  for (const item of theoryObjects) {
    lines.push(
      `### ${item.name}`,
      item.statement,
      "",
      `- Theory family: ${item.theory_family || "unknown"}`,
      `- Mechanism chain: ${item.mechanism_chain.join(" -> ") || "missing"}`,
      `- Boundary conditions: ${item.boundary_conditions.join("; ") || "missing"}`,
      `- Measurable variables: ${item.measurable_variables.join("; ") || "missing"}`,
      "",
      "Predictions:",
      ...renderList(item.predictions),
      "",
      "Counterfactual predictions:",
      ...renderList(item.counterfactual_predictions),
      "",
      "Falsification tests:",
      ...renderList(item.falsification_tests),
      "",
      "Rival explanations:",
      ...renderList(item.rival_explanations),
      "",
      "Missing theory fields:",
      ...renderList(item.missing_theory_fields),
      "",
    );
  }
  if (frame.hypothesis_relations.length > 0) {
    lines.push("## Hypothesis Relations");
    for (const relation of frame.hypothesis_relations) {
      lines.push(`- ${relation.source_name} ${relation.relation} ${relation.target_name}: ${relation.rationale}`);
    }
  }
  if (frame.decision_notes.length > 0) {
    lines.push("", "## Decision Notes", ...renderList(frame.decision_notes));
  }
  return lines.join("\n");
}

function fallbackHypothesisFrame(rawText: string): HypothesisGenerationFrame {
  return {
    synthesis_basis: "Fallback hypothesis frame derived from unstructured model output.",
    hypotheses: [
      {
        name: "Fallback candidate hypothesis",
        statement: rawText.slice(0, 400) || "The model did not return a structured hypothesis.",
        theory_family: "fallback",
        mechanism_chain: [],
        assumptions: ["The unstructured model output may be incomplete."],
        boundary_conditions: [],
        predictions: [],
        counterfactual_predictions: [],
        falsification_tests: [],
        measurable_variables: [],
        discriminating_experiments: [],
        rival_explanations: [],
        evidence_refs: [],
        missing_theory_fields: ["mechanism_chain", "predictions", "falsification_tests", "measurable_variables"],
      },
    ],
    hypothesis_relations: [],
    decision_notes: ["Structured parsing failed; this candidate requires human review."],
  };
}

function compactResearchState(value: Record<string, unknown>): Record<string, unknown> {
  return {
    currentStage: value.currentStage,
    completedStages: value.completedStages,
    evidence: Array.isArray(value.evidence) ? value.evidence.slice(-10) : [],
    hypotheses: Array.isArray(value.hypotheses) ? value.hypotheses.slice(-8) : [],
    artifactRefs: Array.isArray(value.artifactRefs) ? value.artifactRefs.slice(-8) : [],
    blockers: Array.isArray(value.blockers) ? value.blockers : [],
  };
}

function countMissingFields(items: HypothesisTheoryObject[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const field of item.missing_theory_fields) {
      counts[field] = (counts[field] ?? 0) + 1;
    }
  }
  return counts;
}

function familyName(value: string): string {
  return value.split(":", 1)[0].trim() || "general";
}

function renderList(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
