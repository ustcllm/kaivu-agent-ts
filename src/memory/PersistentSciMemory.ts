import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  MemoryCommitResult,
  MemoryLogEntry,
  MemoryPromotionInput,
  MemoryRecord,
  MemoryReviewInput,
} from "./MemoryRecord.js";
import { SciMemory } from "./SciMemory.js";
import type { MemoryWriteProposal } from "../shared/types.js";

export interface PersistentMemorySnapshot {
  schemaVersion: "kaivu-memory-v1";
  records: MemoryRecord[];
  log: MemoryLogEntry[];
  updatedAt: string;
}

export class PersistentSciMemory extends SciMemory {
  private constructor(
    private readonly path: string,
    records: MemoryRecord[],
    log: MemoryLogEntry[],
  ) {
    super(records, log);
  }

  static async load(path: string): Promise<PersistentSciMemory> {
    try {
      const raw = await readFile(path, "utf-8");
      const snapshot = JSON.parse(raw) as Partial<PersistentMemorySnapshot>;
      return new PersistentSciMemory(
        path,
        Array.isArray(snapshot.records) ? snapshot.records : [],
        Array.isArray(snapshot.log) ? snapshot.log : [],
      );
    } catch {
      const memory = new PersistentSciMemory(path, [], []);
      await memory.persist();
      return memory;
    }
  }

  async commit(proposals: MemoryWriteProposal[], source: string): Promise<MemoryCommitResult> {
    const result = await super.commit(proposals, source);
    await this.persist();
    return result;
  }

  async review(input: MemoryReviewInput): Promise<MemoryRecord | undefined> {
    const result = await super.review(input);
    await this.persist();
    return result;
  }

  async promote(input: MemoryPromotionInput): Promise<MemoryRecord | undefined> {
    const result = await super.promote(input);
    await this.persist();
    return result;
  }

  async persist(): Promise<PersistentMemorySnapshot> {
    const snapshot: PersistentMemorySnapshot = {
      schemaVersion: "kaivu-memory-v1",
      records: this.snapshot(),
      log: this.logSnapshot(),
      updatedAt: new Date().toISOString(),
    };
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
    return snapshot;
  }
}
