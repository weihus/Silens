import { useEffect, useRef } from 'react';

export function useAudio(sound: string, volume: number) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (sound !== 'none') {
      const ext = (sound === 'night') ? 'wav' : 'mp3';
      const audio = new Audio(`/sounds/${sound}.${ext}`);
      audio.loop = true;
      audio.volume = volume;
      audio.play().catch(() => {});
      audioRef.current = audio;
    }
  }, [sound]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);
}
