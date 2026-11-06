export type Theme = 'paper' | 'white' | 'night';

export type NoteTarget = string | { text: string; occurrence: number };

export type SoundPreset = 'none' | 'rain' | 'fire' | 'night';

export interface AtmosphereState {
  sound: SoundPreset;
  volume: number;
  theme: Theme;
  autoSync?: boolean;
}

export type DocumentKind = 'journal' | 'article';

export interface Document {
  filename: string;
  kind: DocumentKind;
  journal_date: string | null;
  tags?: string[];
  title: string;
  content: string;
  created: number;
  created_date: string;
  modified: number;
}

export interface RecallRange {
  start?: string;
  end?: string;
}

export interface RecallArticle {
  filename: string;
  title: string;
  content: string;
  created: number;
  created_date: string;
  modified: number;
  tags: string[];
  is_untagged?: boolean;
}

export interface RecallDay {
  date: string;
  tags: { filename: string; tag: string; blocks: string[]; is_untagged?: boolean }[];
  articles: RecallArticle[];
}

export type ReflectionPerspective =
  | { kind: 'all' }
  | { kind: 'tag'; tag: string }
  | { kind: 'untagged' }
  | { kind: 'articlesOnly' };

export interface ReflectionQuery {
  startDate?: string | null;
  endDate?: string | null;
  perspective?: ReflectionPerspective;
  pageSeed?: number;
}

export interface ResolvedReflectionQuery {
  startDate: string | null;
  endDate: string | null;
  perspective: ReflectionPerspective;
  pageSeed: number;
}

export interface ReflectionContextAnchor {
  text: string;
  occurrence: number;
}

export interface ReflectionExcerpt {
  blockId: number;
  filename: string;
  date: string;
  content: string;
  contextAnchor: ReflectionContextAnchor | null;
}

export type ReflectionQuoteSlot = 'nightMonologue' | 'untaggedMoment'
  | 'connectedThought' | 'distantEcho' | 'generalHighlight';

export interface ReflectionQuote extends ReflectionExcerpt {
  slot: ReflectionQuoteSlot;
  tags: string[];
}

export interface ReflectionFavoriteTimeBucket {
  name: string;
  peakHour: number;
  sampleCount: number;
  share: number;
}

export interface ReflectionArticleIdentity {
  filename: string;
  title: string;
}

export interface ReflectionRichestDay {
  date: string;
  tags: string[];
  untaggedBlocksCount: number;
  articles: ReflectionArticleIdentity[];
  preview: string;
  previewSource: ReflectionExcerpt | null;
}

export interface ReflectionOverview {
  activeDaysCount: number;
  dailyBlocksCount: number;
  titledArticlesCount: number;
  favoriteTimeBucket: ReflectionFavoriteTimeBucket | null;
  richestDay: ReflectionRichestDay | null;
}

export interface ReflectionTagFrequency {
  tag: string;
  count: number;
}

export interface ReflectionDeepWork {
  workName: string;
  mentionCount: number;
  distinctDaysCount: number;
  effectiveChars: number;
  filenames: string[];
  representativeQuote: ReflectionExcerpt;
}

export interface ReflectionThemes {
  topTags: ReflectionTagFrequency[];
  untaggedBlocksCount: number;
  totalDistinctWorksCount: number;
  deepWorks: ReflectionDeepWork[];
}

export interface ReflectionBrewedArticle extends ReflectionArticleIdentity {
  createdDate: string;
  modifiedDate: string;
  spanDays: number;
}

export interface ReflectionReferenceSource extends ReflectionArticleIdentity {
  referenceCount: number;
  preview: string;
  contextAnchor: ReflectionContextAnchor | null;
}

export interface ReflectionReferencedArticle extends ReflectionArticleIdentity {
  referenceCount: number;
  sourceCount: number;
  sources: ReflectionReferenceSource[];
}

export interface ReflectionArticles {
  longestBrewed: ReflectionBrewedArticle[];
  mostReferenced: ReflectionReferencedArticle[];
}

export interface PeriodReflectionResult {
  query: ResolvedReflectionQuery;
  overview: ReflectionOverview;
  themes: ReflectionThemes;
  articles: ReflectionArticles;
  sampledQuotes: ReflectionQuote[];
}
