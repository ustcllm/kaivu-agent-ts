export interface SkillDefinition {
  name: string;
  description: string;
  whenToUse: string;
  prompt: string;
  allowedTools: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  path?: string;
}

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  selectForGoal(goal: string): SkillDefinition[] {
    const terms = goal.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/u).filter(Boolean);
    return [...this.skills.values()]
      .map((skill) => {
        const haystack = `${skill.name} ${skill.description} ${skill.whenToUse}`.toLowerCase();
        const score = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
        return { skill, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.skill);
  }

  all(): SkillDefinition[] {
    return [...this.skills.values()];
  }
}

export function defaultScientificSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registry.register({
    name: "literature-review",
    description: "Build source-backed digests, claim tables, conflict maps, and evidence gaps.",
    whenToUse: "Use when a stage needs scholarly evidence synthesis or systematic review updates.",
    prompt: "Synthesize literature with explicit source quality, conflicts, and uncertainty.",
    allowedTools: ["arxiv_search", "crossref_search", "pubmed_search", "resolve_citation"],
  });
  registry.register({
    name: "hypothesis-validation",
    description: "Validate novelty, feasibility, falsifiability, and evidence readiness.",
    whenToUse: "Use before experiment design or when a hypothesis changed materially.",
    prompt: "Review each hypothesis against novelty, feasibility, falsifiability, mechanism, and rival explanations.",
    allowedTools: ["search_memory", "query_typed_graph"],
  });
  return registry;
}
