import "dotenv/config";
import {
  ExperimentDesignAgent,
  HypothesisGenerationAgent,
  LiteratureKnowledgeBase,
  LiteratureReviewAgent,
  OpenAIResponsesModelProvider,
  ResearchGraphRegistry,
  SciAgent,
  SciLoop,
  SciMemory,
  SciRuntime,
  ScientificCapabilityRegistry,
  ToolRegistry,
  VerificationAgent,
} from "../src/index.js";

declare const process: { env: Record<string, string | undefined> };

const memory = new SciMemory();
const literature = new LiteratureKnowledgeBase();
const graph = new ResearchGraphRegistry();
const model = new OpenAIResponsesModelProvider({
  model: process.env.KAIVU_MODEL ?? "gpt-5-mini",
  reasoningEffort: "medium",
});
const runtime = new SciRuntime(model, new ToolRegistry(), literature, new ScientificCapabilityRegistry());
const agent = new SciAgent({
  id: "chief_scientific_agent",
  discipline: "artificial_intelligence",
  specialists: [
    new LiteratureReviewAgent(),
    new HypothesisGenerationAgent(),
    new VerificationAgent(),
    new ExperimentDesignAgent(),
  ],
  stageOrder: ["literature_review", "hypothesis_generation", "hypothesis_validation", "experiment_design"],
});

const loop = new SciLoop(runtime, memory, graph);
const result = await loop.run({
  mode: "autonomous",
  maxIterations: 2,
  agent,
  task: {
    id: "task_real_model_smoke",
    title: "Real model scientific agent smoke test",
    question: "How should an AI research agent avoid benchmark leakage while generating hypotheses?",
    discipline: "artificial_intelligence",
    taskType: "api_smoke_test",
  },
});

console.log(JSON.stringify(result, null, 2));
