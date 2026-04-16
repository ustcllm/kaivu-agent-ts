export interface ScientificContextMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer" | string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ScientificContextCompressorOptions {
  maxMessages?: number;
  protectFirstN?: number;
  protectLastN?: number;
  maxToolChars?: number;
  summaryRole?: ScientificContextMessage["role"];
}

export interface ScientificContextCompressionInput {
  providerNotes?: string[];
  researchState?: Record<string, unknown>;
}

export interface ScientificContextCompressionResult {
  compressed: boolean;
  messages: ScientificContextMessage[];
  summary: string;
  prunedToolResults: number;
  protectedTailCount: number;
  metadata: Record<string, unknown>;
}

export class ScientificContextCompressor {
  private readonly maxMessages: number;
  private readonly protectFirstN: number;
  private readonly protectLastN: number;
  private readonly maxToolChars: number;
  private readonly summaryRole: ScientificContextMessage["role"];

  constructor(options: ScientificContextCompressorOptions = {}) {
    this.maxMessages = options.maxMessages ?? 80;
    this.protectFirstN = options.protectFirstN ?? 3;
    this.protectLastN = options.protectLastN ?? 20;
    this.maxToolChars = options.maxToolChars ?? 1_200;
    this.summaryRole = options.summaryRole ?? "system";
  }

  shouldCompress(messages: ScientificContextMessage[]): boolean {
    return messages.length > this.maxMessages || messages.some((message) => this.isOversizedToolResult(message));
  }

  compress(
    messages: ScientificContextMessage[],
    input: ScientificContextCompressionInput = {},
  ): ScientificContextCompressionResult {
    const prunedMessages = messages.map((message) => this.pruneToolMessage(message));
    const prunedToolResults = prunedMessages.filter((message, index) => message !== messages[index]).length;

    if (!this.shouldCompress(prunedMessages)) {
      return {
        compressed: false,
        messages: prunedMessages,
        summary: "",
        prunedToolResults,
        protectedTailCount: Math.min(this.protectLastN, prunedMessages.length),
        metadata: { originalMessageCount: messages.length, finalMessageCount: prunedMessages.length },
      };
    }

    const head = prunedMessages.slice(0, this.protectFirstN);
    const tail = prunedMessages.slice(-this.protectLastN);
    const middleStart = this.protectFirstN;
    const middleEnd = Math.max(middleStart, prunedMessages.length - this.protectLastN);
    const middle = prunedMessages.slice(middleStart, middleEnd);
    const summary = this.summarizeMiddle(middle, input);
    const summaryMessage: ScientificContextMessage = {
      role: this.summaryRole,
      content: summary,
      metadata: {
        kind: "scientific_context_summary",
        summarizedMessages: middle.length,
        providerNotes: input.providerNotes ?? [],
      },
    };

    return {
      compressed: true,
      messages: [...head, summaryMessage, ...tail],
      summary,
      prunedToolResults,
      protectedTailCount: tail.length,
      metadata: {
        originalMessageCount: messages.length,
        finalMessageCount: head.length + 1 + tail.length,
        summarizedMessageCount: middle.length,
      },
    };
  }

  private pruneToolMessage(message: ScientificContextMessage): ScientificContextMessage {
    if (!this.isOversizedToolResult(message)) {
      return message;
    }
    return {
      ...message,
      content: `${message.content.slice(0, this.maxToolChars)}\n\n[tool output truncated by context compressor]`,
      metadata: { ...message.metadata, truncated: true, originalChars: message.content.length },
    };
  }

  private isOversizedToolResult(message: ScientificContextMessage): boolean {
    return message.role === "tool" && message.content.length > this.maxToolChars;
  }

  private summarizeMiddle(
    messages: ScientificContextMessage[],
    input: ScientificContextCompressionInput,
  ): string {
    const lines = [
      "<compressed-scientific-context>",
      "This is a loss-aware summary of older research-loop context. Preserve claims as provisional unless evidence is explicit.",
    ];
    if (input.providerNotes && input.providerNotes.length > 0) {
      lines.push("", "## Provider Notes", ...input.providerNotes.map((note) => `- ${note}`));
    }
    if (input.researchState) {
      lines.push("", "## Research State Snapshot", JSON.stringify(input.researchState).slice(0, 2_000));
    }
    lines.push("", "## Compressed Messages");
    for (const message of messages) {
      const preview = message.content.replace(/\s+/g, " ").slice(0, 300);
      lines.push(`- ${message.role}: ${preview}`);
    }
    lines.push("</compressed-scientific-context>");
    return lines.join("\n");
  }
}
