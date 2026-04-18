export interface LiteratureSearchPaper {
  id: string;
  title: string;
  link?: string;
  summary?: string;
  authors?: string[];
  publishedAt?: string;
  categories?: string[];
}

export interface LiteratureSearchOutput {
  query: string;
  results: LiteratureSearchPaper[];
}
