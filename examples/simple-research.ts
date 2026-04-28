import {
  EchoModelProvider,
  ExperimentDesignAgent,
  createResearchToolRegistry,
  HypothesisGenerationAgent,
  LiteratureReviewRuntimeStore,
  LiteratureReviewAgent,
  PaperDigests,
  ProblemFramingAgent,
  ResearchGraphRegistry,
  SciAgent,
  ScientificCapabilityRegistry,
  SciLoop,
  SciMemory,
  SciRuntime,
  VerificationAgent,
} from "../src/index.js";

const memory = new SciMemory();
const literature = new LiteratureReviewRuntimeStore();
const paperDigests = await PaperDigests.load(".kaivu/users/example-user/literature");
const graph = new ResearchGraphRegistry();
const capabilities = new ScientificCapabilityRegistry();
const tools = createResearchToolRegistry();
const runtime = new SciRuntime(new EchoModelProvider(), tools, literature, paperDigests, ".kaivu/users/example-user/literature/wiki", capabilities);
const agent = new SciAgent({
  id: "chief_scientific_agent",
  discipline: "artificial_intelligence",
  specialists: [
    new ProblemFramingAgent(),
    new LiteratureReviewAgent(),
    new HypothesisGenerationAgent(),
    new VerificationAgent(),
    new ExperimentDesignAgent(),
  ],
  stageOrder: ["problem_framing", "literature_review", "hypothesis_generation", "hypothesis_validation", "experiment_design"],
});

const loop = new SciLoop(runtime, memory, graph);
const result = await loop.run({
  mode: "autonomous",
  maxIterations: 5,
  agent,
  task: {
    id: "task_ai_benchmark",
    title: "AI benchmark research scaffold",
    question: "How can we design a robust benchmark-driven AI research loop?",
    discipline: "artificial_intelligence",
    taskType: "benchmark_research",
    constraints: {
      literatureSources: [
        {
          id: "source_benchmark_notes",
          title: "Benchmark robustness notes",
          sourceType: "preprint",
          content: "A benchmark-driven AI research loop should track data leakage, seed sensitivity, and reproducibility evidence.",
        },
      ],
    },
  },
});

console.log(JSON.stringify(result, null, 2));
