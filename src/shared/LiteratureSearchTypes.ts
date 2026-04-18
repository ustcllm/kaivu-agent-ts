export interface LiteratureSearchPaper {
  id: string;
  title: string;
  link?: string;
  summary?: string;
  authors?: string[];
  publishedAt?: string;
  categories?: string[];
  score?: number;
  citationCount?: number;
}

export interface LiteratureSearchOutput {
  query: string;
  results: LiteratureSearchPaper[];
}
