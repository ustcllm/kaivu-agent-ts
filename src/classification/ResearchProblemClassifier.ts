export type ResearchDiscipline =
  | "artificial_intelligence"
  | "mathematics"
  | "chemistry"
  | "chemical_engineering"
  | "physics"
  | "general_science";

export type ResearchTaskType =
  | "literature_review"
  | "hypothesis_generation"
  | "benchmark_research"
  | "optimization"
  | "experiment_design"
  | "theory_analysis"
  | "kaggle_competition"
  | "chat_research";

export type ExperimentalMode =
  | "wet_lab"
  | "simulation"
  | "proof_search"
  | "ml_training"
  | "data_competition"
  | "literature_only"
  | "unknown";

export interface ResearchProblemClassification {
  primaryDiscipline: ResearchDiscipline;
  secondaryDisciplines: ResearchDiscipline[];
  taskType: ResearchTaskType;
  methodDomains: string[];
  experimentalMode: ExperimentalMode;
  confidence: number;
  evidence: string[];
  ambiguity: string[];
  needsClarification: boolean;
}

interface DisciplineScore {
  discipline: ResearchDiscipline;
  score: number;
  evidence: string[];
}

const DISCIPLINE_PATTERNS: Record<ResearchDiscipline, Array<[RegExp, string, number]>> = {
  artificial_intelligence: [
    [/\b(kaggle|leaderboard|benchmark|dataset|train(?:ing)?|validation|test set|cross[- ]validation)\b/i, "AI/data competition or benchmark language", 3],
    [/\b(transformer|attention|residual stream|llm|language model|neural|deep learning|machine learning|representation|embedding)\b/i, "model or representation-learning terminology", 3],
    [/\b(ablation|hyperparameter|fine[- ]tuning|contamination|data leakage|seed sensitivity)\b/i, "AI experiment methodology", 2],
  ],
  mathematics: [
    [/\b(proof|theorem|lemma|conjecture|counterexample|corollary|axiom|formal verification)\b/i, "proof-oriented mathematical language", 3],
    [/\b(topology|algebra|geometry|number theory|graph theory|category theory|optimization theorem)\b/i, "mathematical domain terminology", 2],
  ],
  chemistry: [
    [/\b(reaction|catalyst|synthesis|molecule|polymer|solvent|spectra|nmr|mass spec|yield|selectivity)\b/i, "chemistry experiment or molecular terminology", 3],
    [/\b(kinetics|thermodynamics|mechanism|intermediate|ligand|electrochemistry)\b/i, "chemical mechanism terminology", 2],
  ],
  chemical_engineering: [
    [/\b(reactor|distillation|mass transfer|heat transfer|process control|unit operation|residence time|flow rate|scale[- ]up)\b/i, "chemical engineering process terminology", 3],
    [/\b(process optimization|steady state|transport phenomena|separation process|plant|pilot scale)\b/i, "process-system terminology", 2],
  ],
  physics: [
    [/\b(quantum|particle|field theory|observable|hamiltonian|phase transition|condensed matter|plasma|relativity)\b/i, "physics theory or observable terminology", 3],
    [/\b(simulation|calibration|detector|measurement uncertainty|instrument|lattice|material phase)\b/i, "physics measurement or simulation terminology", 2],
  ],
  general_science: [],
};

export class ResearchProblemClassifier {
  classify(input: { query: string; providedDiscipline?: string; providedTaskType?: string }): ResearchProblemClassification {
    const query = input.query.trim();
    const scores = this.scoreDisciplines(query);
    const provided = normalizeDiscipline(input.providedDiscipline);
    if (provided && provided !== "general_science") {
      const existing = scores.find((item) => item.discipline === provided);
      if (existing) {
        existing.score += 2;
        existing.evidence.push("discipline provided by caller");
      } else {
        scores.push({ discipline: provided, score: 2, evidence: ["discipline provided by caller"] });
      }
    }

    const ranked = scores.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    const primary = ranked[0]?.discipline ?? "general_science";
    const secondary = ranked
      .slice(1)
      .filter((item) => item.score >= Math.max(2, (ranked[0]?.score ?? 0) - 2))
      .map((item) => item.discipline);
    const confidence = confidenceOf(ranked, Boolean(provided));
    const taskType = normalizeTaskType(input.providedTaskType) ?? inferTaskType(query, primary);
    const experimentalMode = inferExperimentalMode(query, primary, taskType);
    const methodDomains = inferMethodDomains(query, primary, taskType);
    const ambiguity = ambiguityOf(ranked, provided);

    return {
      primaryDiscipline: primary,
      secondaryDisciplines: secondary,
      taskType,
      methodDomains,
      experimentalMode,
      confidence,
      evidence: ranked.flatMap((item) => item.evidence.map((reason) => `${item.discipline}: ${reason}`)).slice(0, 10),
      ambiguity,
      needsClarification: confidence < 0.55 || ambiguity.length >= 2,
    };
  }

  private scoreDisciplines(query: string): DisciplineScore[] {
    return (Object.keys(DISCIPLINE_PATTERNS) as ResearchDiscipline[]).map((discipline) => {
      let score = 0;
      const evidence: string[] = [];
      for (const [pattern, reason, weight] of DISCIPLINE_PATTERNS[discipline]) {
        if (pattern.test(query)) {
          score += weight;
          evidence.push(reason);
        }
      }
      return { discipline, score, evidence };
    });
  }
}

export function classifyResearchProblem(input: { query: string; providedDiscipline?: string; providedTaskType?: string }): ResearchProblemClassification {
  return new ResearchProblemClassifier().classify(input);
}

function inferTaskType(query: string, discipline: ResearchDiscipline): ResearchTaskType {
  if (/\bkaggle\b|leaderboard|competition/i.test(query)) return "kaggle_competition";
  if (/literature|review|survey|papers?|文献|综述/i.test(query)) return "literature_review";
  if (/hypothesis|假说|机制假设|generate.*hypoth/i.test(query)) return "hypothesis_generation";
  if (/benchmark|baseline|evaluation protocol|评测/i.test(query)) return "benchmark_research";
  if (/optimi[sz]e|hyperparameter|sweep|tuning|调参|优化/i.test(query)) return "optimization";
  if (/experiment|protocol|实验设计|design.*test/i.test(query)) return "experiment_design";
  if (/theory|formal|prediction|证明|conjecture|mechanism/i.test(query) || discipline === "mathematics") return "theory_analysis";
  return "chat_research";
}

function inferExperimentalMode(query: string, discipline: ResearchDiscipline, taskType: ResearchTaskType): ExperimentalMode {
  if (taskType === "kaggle_competition") return "data_competition";
  if (discipline === "artificial_intelligence" || /training|fine[- ]tuning|model|benchmark/i.test(query)) return "ml_training";
  if (discipline === "mathematics" || /proof|counterexample|theorem/i.test(query)) return "proof_search";
  if (discipline === "chemistry" || /wet lab|reaction|synthesis|spectra/i.test(query)) return "wet_lab";
  if (discipline === "physics" || /simulation|仿真|monte carlo|finite element/i.test(query)) return "simulation";
  if (/literature|review|survey|文献/i.test(query)) return "literature_only";
  return "unknown";
}

function inferMethodDomains(query: string, discipline: ResearchDiscipline, taskType: ResearchTaskType): string[] {
  const domains = new Set<string>();
  if (discipline !== "general_science") domains.add(discipline);
  if (taskType !== "chat_research") domains.add(taskType);
  if (/causal|mechanism|机理/i.test(query)) domains.add("mechanistic_reasoning");
  if (/optimization|hyperparameter|sweep|bayesian/i.test(query)) domains.add("optimization");
  if (/benchmark|metric|leaderboard|evaluation/i.test(query)) domains.add("evaluation");
  if (/literature|review|paper|文献/i.test(query)) domains.add("literature_synthesis");
  if (/proof|theorem|counterexample/i.test(query)) domains.add("formal_reasoning");
  return [...domains];
}

function ambiguityOf(ranked: DisciplineScore[], provided?: ResearchDiscipline): string[] {
  const ambiguity: string[] = [];
  if (ranked.length === 0) ambiguity.push("No strong discipline-specific signal was detected.");
  if (ranked.length >= 2 && ranked[0].score - ranked[1].score <= 1) {
    ambiguity.push(`Top disciplines are close: ${ranked[0].discipline} vs ${ranked[1].discipline}.`);
  }
  if (provided && ranked[0] && provided !== ranked[0].discipline) {
    ambiguity.push(`Provided discipline ${provided} conflicts with strongest textual signal ${ranked[0].discipline}.`);
  }
  return ambiguity;
}

function confidenceOf(ranked: DisciplineScore[], hasProvidedDiscipline: boolean): number {
  if (ranked.length === 0) return hasProvidedDiscipline ? 0.55 : 0.35;
  const top = ranked[0].score;
  const second = ranked[1]?.score ?? 0;
  const margin = top - second;
  const raw = 0.4 + Math.min(0.35, top * 0.08) + Math.min(0.2, margin * 0.08) + (hasProvidedDiscipline ? 0.05 : 0);
  return Math.round(Math.min(0.95, raw) * 100) / 100;
}

function normalizeDiscipline(value?: string): ResearchDiscipline | undefined {
  const normalized = value?.trim().toLowerCase().replace(/[ -]/g, "_");
  if (!normalized) return undefined;
  if (normalized === "ai" || normalized === "ml" || normalized === "machine_learning") return "artificial_intelligence";
  if (normalized === "chemical_engineering" || normalized === "chemeng") return "chemical_engineering";
  if (["artificial_intelligence", "mathematics", "chemistry", "physics", "general_science"].includes(normalized)) {
    return normalized as ResearchDiscipline;
  }
  return undefined;
}

function normalizeTaskType(value?: string): ResearchTaskType | undefined {
  const normalized = value?.trim().toLowerCase().replace(/[ -]/g, "_");
  if (!normalized) return undefined;
  if (["literature_review", "hypothesis_generation", "benchmark_research", "optimization", "experiment_design", "theory_analysis", "kaggle_competition", "chat_research"].includes(normalized)) {
    return normalized as ResearchTaskType;
  }
  return undefined;
}
