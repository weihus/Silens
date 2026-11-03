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
}

export interface RecallDay {
  date: string;
  tags: { filename: string; tag: string; blocks: string[] }[];
  articles: RecallArticle[];
}
