import type { HypothesisItem } from "../shared/types.js";

export interface TheoryVariable {
  name: string;
  role: "intervention" | "outcome" | "control" | "latent";
  measurementState: "specified" | "needs_unit_or_scale";
}

export interface ObservablePrediction {
  id: string;
  hypothesisId: string;
  observable: string;
  variables: TheoryVariable[];
  expectedDirection: "increase" | "decrease" | "no_change" | "pattern_match";
  boundaryConditions: string[];
  decisionThreshold: string;
  falsifiesIf: string;
}

export interface DiscriminatingTest {
  id: string;
  hypothesisId: string;
  targetPredictionId?: string;
  testLogic: string;
  requiredControls: string[];
  interpretationRule: string;
}

export interface CompiledTheoryObject {
  compiledTheoryId: string;
  hypothesisId: string;
  theoryFamily: string;
  formalState: "predictive" | "structured" | "needs_formalization";
  mechanismChain: string[];
  assumptions: string[];
  boundaryConditions: string[];
  variables: TheoryVariable[];
  observablePredictions: ObservablePrediction[];
  counterfactualPredictions: string[];
  falsificationTests: string[];
  discriminatingTests: DiscriminatingTest[];
  missingFormalFields: string[];
  sourceEvidenceRefs: string[];
}

export interface HypothesisTheoryCompilerInput {
  topic: string;
  hypotheses: HypothesisItem[];
  theoryArtifacts?: Array<{ id: string; metadata?: Record<string, unknown> }>;
}

export interface HypothesisTheoryCompilerResult {
  topic: string;
  compiledTheoryCount: number;
  predictionCount: number;
  discriminatingTestCount: number;
  formalizationReadiness: "high" | "medium" | "low";
  missingFieldCounts: Record<string, number>;
  compiledTheories: CompiledTheoryObject[];
}

export class HypothesisTheoryCompiler {
  compile(input: HypothesisTheoryCompilerInput): HypothesisTheoryCompilerResult {
    const artifactObjects = (input.theoryArtifacts ?? []).flatMap((artifact) => extractTheoryObjects(artifact.metadata));
    const compiled = input.hypotheses.map((hypothesis, index) =>
      this.compileHypothesis(input.topic, hypothesis, artifactObjects[index] ?? {}),
    );
    const missingFieldCounts = countMissingFields(compiled);
    const predictionCount = compiled.reduce((sum, item) => sum + item.observablePredictions.length, 0);
    const discriminatingTestCount = compiled.reduce((sum, item) => sum + item.discriminatingTests.length, 0);
    return {
      topic: input.topic,
      compiledTheoryCount: compiled.length,
      predictionCount,
      discriminatingTestCount,
      formalizationReadiness: compiled.length === 0 ? "low" : Object.keys(missingFieldCounts).length === 0 ? "high" : "medium",
      missingFieldCounts,
      compiledTheories: compiled,
    };
  }

  private compileHypothesis(topic: string, hypothesis: HypothesisItem, artifact: Record<string, unknown>): CompiledTheoryObject {
    const hypothesisId = hypothesis.id;
    const mechanismChain = strings(artifact.mechanism_chain);
    const assumptions = dedupe([...hypothesis.assumptions, ...strings(artifact.assumptions)]);
    const boundaryConditions = dedupe([...strings(artifact.boundary_conditions), ...inferBoundaryConditions(assumptions)]);
    const counterfactualPredictions = strings(artifact.counterfactual_predictions);
    const falsificationTests = dedupe([...hypothesis.falsificationTests, ...strings(artifact.falsification_tests)]);
    const variables = dedupe([...strings(artifact.measurable_variables), ...extractVariables(hypothesis.predictions.join(" "))])
      .map(toTheoryVariable)
      .slice(0, 12);
    const observablePredictions = (hypothesis.predictions.length ? hypothesis.predictions : [`${hypothesis.statement} should produce a measurable pattern`])
      .map((prediction, index) => this.compilePrediction(topic, hypothesisId, prediction, variables, boundaryConditions, falsificationTests, index + 1));
    const discriminatingTests = this.buildDiscriminatingTests(hypothesisId, mechanismChain, observablePredictions, counterfactualPredictions);
    const missingFormalFields = missingFields({
      mechanismChain,
      boundaryConditions,
      variables,
      observablePredictions,
      falsificationTests,
      discriminatingTests,
    });
    return {
      compiledTheoryId: `compiled-theory:${slug(hypothesisId)}`,
      hypothesisId,
      theoryFamily: String(artifact.theory_family ?? familyName(hypothesis.statement)),
      formalState: missingFormalFields.length === 0 ? "predictive" : mechanismChain.length > 0 && observablePredictions.length > 0 ? "structured" : "needs_formalization",
      mechanismChain,
      assumptions,
      boundaryConditions,
      variables,
      observablePredictions,
      counterfactualPredictions,
      falsificationTests,
      discriminatingTests,
      missingFormalFields,
      sourceEvidenceRefs: strings(artifact.evidence_refs),
    };
  }

  private compilePrediction(
    topic: string,
    hypothesisId: string,
    prediction: string,
    variables: TheoryVariable[],
    boundaryConditions: string[],
    falsificationTests: string[],
    index: number,
  ): ObservablePrediction {
    return {
      id: `prediction:${slug(hypothesisId)}:${index}`,
      hypothesisId,
      observable: prediction,
      variables,
      expectedDirection: expectedDirection(prediction),
      boundaryConditions,
      decisionThreshold: decisionThreshold(topic, prediction),
      falsifiesIf: falsificationTests[0] ?? defaultFalsifier(prediction),
    };
  }

  private buildDiscriminatingTests(
    hypothesisId: string,
    mechanismChain: string[],
    predictions: ObservablePrediction[],
    counterfactuals: string[],
  ): DiscriminatingTest[] {
    const tests: DiscriminatingTest[] = predictions.slice(0, 4).map((prediction, index) => ({
      id: `discriminator:${slug(hypothesisId)}:${index + 1}`,
      hypothesisId,
      targetPredictionId: prediction.id,
      testLogic: mechanismChain.length > 0
        ? `Perturb ${mechanismChain[0]} and measure whether ${prediction.observable}`
        : `Measure whether ${prediction.observable} under a controlled baseline.`,
      requiredControls: ["negative control", "baseline control", "boundary-condition control"],
      interpretationRule: prediction.falsifiesIf,
    }));
    tests.push(...counterfactuals.slice(0, 3).map((item, index) => ({
      id: `discriminator:${slug(hypothesisId)}:counterfactual-${index + 1}`,
      hypothesisId,
      targetPredictionId: undefined,
      testLogic: item,
      requiredControls: ["rival mechanism control", "measurement artifact control"],
      interpretationRule: "different outcomes should separate rival mechanism families",
    })));
    return tests.slice(0, 8);
  }
}

function extractTheoryObjects(metadata?: Record<string, unknown>): Record<string, unknown>[] {
  const value = metadata?.theoryObjects;
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function missingFields(payload: Record<string, unknown[]>): string[] {
  return Object.entries(payload).filter(([, value]) => value.length === 0).map(([key]) => key);
}

function countMissingFields(items: CompiledTheoryObject[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const field of item.missingFormalFields) counts[field] = (counts[field] ?? 0) + 1;
  }
  return counts;
}

function toTheoryVariable(name: string): TheoryVariable {
  const lowered = name.toLowerCase();
  const role = /dose|temperature|pressure|input|concentration|parameter|learning_rate|batch/i.test(lowered)
    ? "intervention"
    : /control|baseline|confound/i.test(lowered)
      ? "control"
      : /latent|hidden|mechanism/i.test(lowered)
        ? "latent"
        : "outcome";
  return { name, role, measurementState: "needs_unit_or_scale" };
}

function inferBoundaryConditions(assumptions: string[]): string[] {
  return assumptions.filter((item) => /\b(when|under|only|if|provided|condition)\b/i.test(item)).slice(0, 6);
}

function extractVariables(text: string): string[] {
  return text.split(/[^a-zA-Z0-9_]+/).filter((token) => token.length >= 4 && !["increase", "decrease", "higher", "lower"].includes(token.toLowerCase())).slice(0, 8);
}

function expectedDirection(text: string): ObservablePrediction["expectedDirection"] {
  if (/increase|higher|improve|enhance|raise/i.test(text)) return "increase";
  if (/decrease|lower|reduce|suppress|drop/i.test(text)) return "decrease";
  if (/equal|unchanged|no change/i.test(text)) return "no_change";
  return "pattern_match";
}

function decisionThreshold(topic: string, prediction: string): string {
  const text = `${topic} ${prediction}`.toLowerCase();
  if (/accuracy|benchmark|auc|f1|loss/.test(text)) return "predefine minimum effect over baseline and confidence interval before execution";
  if (/yield|selectivity|conversion/.test(text)) return "predefine minimum practical change and replicate count before execution";
  return "state numeric or categorical pass/fail rule before scheduling";
}

function defaultFalsifier(prediction: string): string {
  const direction = expectedDirection(prediction);
  return direction === "pattern_match"
    ? "observable pattern fails under stated boundary conditions"
    : "effect is absent, reversed, or explained by a control/confounder";
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function familyName(value: string): string {
  return value.split(":", 1)[0].trim() || "general";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-|-$/g, "") || "hypothesis";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
