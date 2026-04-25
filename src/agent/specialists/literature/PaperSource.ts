export type PaperSourceType = "paper" | "preprint" | "article" | "web" | "dataset" | "report" | "unknown";

export interface PaperSource {
  id: string;
  title: string;
  sourceType: PaperSourceType;
  content: string;
  url?: string;
  doi?: string;
  authors?: string[];
  publishedAt?: string;
  metadata?: Record<string, unknown>;
}
