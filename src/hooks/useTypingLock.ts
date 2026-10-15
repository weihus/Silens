import { useState, useCallback, useRef, useEffect } from 'react';

export function useTypingLock() {
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTyping = useCallback(() => {
    setIsTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 2200);
  }, []);

  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, []);

  const isIdle = !isTyping;

  return { isTyping, isIdle, handleTyping };
}
