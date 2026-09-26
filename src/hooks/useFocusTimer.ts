import { useState, useCallback, useEffect } from 'react';

const FOCUS_DURATION_KEY = 'silens-focus-duration-v1';

export function useFocusTimer() {
  const [focusDuration, setFocusDuration] = useState<number>(() => {
    const saved = localStorage.getItem(FOCUS_DURATION_KEY);
    return saved ? parseInt(saved, 10) : 25;
  });
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusTimeLeft, setFocusTimeLeft] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(FOCUS_DURATION_KEY, focusDuration.toString());
  }, [focusDuration]);

  // Countdown
  useEffect(() => {
    if (!isFocusMode) return;
    const timerId = window.setInterval(() => {
      setFocusTimeLeft(prev => {
        if (prev === null || prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [isFocusMode]);

  // End handler
  useEffect(() => {
    if (isFocusMode && focusTimeLeft === 0) {
      setIsFocusMode(false);
      setFocusTimeLeft(null);
      setToast('专注结束，休息一下吧！');
      playChime();
    }
  }, [isFocusMode, focusTimeLeft]);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((v: boolean) => {
      const next = !v;
      if (next) {
        setFocusTimeLeft(focusDuration * 60);
        setToast(`一期一会 (${focusDuration}分钟) 已开启`);
      } else {
        setFocusTimeLeft(null);
        setToast('一期一会已关闭');
      }
      return next;
    });
  }, [focusDuration]);

  return { isFocusMode, focusTimeLeft, focusDuration, setFocusDuration, toggleFocusMode, toast, setToast };
}

function playChime() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5);
    osc.start();
    osc.stop(ctx.currentTime + 2.5);
  } catch { /* silent */ }
}
