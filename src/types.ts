export type Theme = 'paper' | 'white' | 'night';

export type SoundPreset = 'none' | 'rain' | 'fire' | 'night';

export interface AtmosphereState {
  sound: SoundPreset;
  volume: number;
  theme: Theme;
  autoSync?: boolean;
}

export interface Document {
  filename: string;
  title: string;
  content: string;
  modified: number;
}
