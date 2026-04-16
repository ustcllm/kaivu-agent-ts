import { mkdir } from "node:fs/promises";
import { resolve, relative, join } from "node:path";

export interface WorkspaceBoundaryCheck {
  path: string;
  allowed: boolean;
  reason: string;
}

export class WorkspaceBoundary {
  readonly root: string;

  constructor(root: string, private readonly writableRoots: string[] = [root]) {
    this.root = resolve(root);
    this.writableRoots = writableRoots.map((item) => resolve(item));
  }

  resolveReadPath(path: string): WorkspaceBoundaryCheck {
    const absolute = resolve(this.root, path);
    const allowed = isWithin(absolute, this.root);
    return { path: absolute, allowed, reason: allowed ? "path is within workspace root" : "path escapes workspace root" };
  }

  resolveWritePath(path: string): WorkspaceBoundaryCheck {
    const absolute = resolve(this.root, path);
    const allowed = this.writableRoots.some((root) => isWithin(absolute, root));
    return { path: absolute, allowed, reason: allowed ? "path is within writable roots" : "path is outside writable roots" };
  }

  async ensureStateLayout(projectId = "default"): Promise<ResearchWorkspaceLayout> {
    const layout = new ResearchWorkspaceLayout(this.root, projectId);
    await layout.ensure();
    return layout;
  }

  summarize(): Record<string, unknown> {
    return { root: this.root, writableRoots: this.writableRoots };
  }
}

export class ResearchWorkspaceLayout {
  readonly stateRoot: string;
  readonly memoryRoot: string;
  readonly literatureRoot: string;
  readonly episodeRoot: string;
  readonly artifactRoot: string;
  readonly manifestRoot: string;

  constructor(readonly root: string, readonly projectId: string) {
    this.stateRoot = join(root, ".kaivu", projectId);
    this.memoryRoot = join(this.stateRoot, "memory");
    this.literatureRoot = join(this.stateRoot, "literature");
    this.episodeRoot = join(this.stateRoot, "learning");
    this.artifactRoot = join(this.stateRoot, "artifacts");
    this.manifestRoot = join(this.stateRoot, "runtime");
  }

  async ensure(): Promise<void> {
    await Promise.all([
      mkdir(this.memoryRoot, { recursive: true }),
      mkdir(this.literatureRoot, { recursive: true }),
      mkdir(this.episodeRoot, { recursive: true }),
      mkdir(this.artifactRoot, { recursive: true }),
      mkdir(this.manifestRoot, { recursive: true }),
    ]);
  }

  summarize(): Record<string, unknown> {
    return {
      root: this.root,
      projectId: this.projectId,
      stateRoot: this.stateRoot,
      memoryRoot: this.memoryRoot,
      literatureRoot: this.literatureRoot,
      episodeRoot: this.episodeRoot,
      artifactRoot: this.artifactRoot,
      manifestRoot: this.manifestRoot,
    };
  }
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !resolve(rel).startsWith("\\\\"));
}
