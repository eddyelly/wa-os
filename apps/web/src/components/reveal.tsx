'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Fades content up the first time it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    // Fail open: content must never stay hidden if the observer misfires.
    const fallback = setTimeout(() => {
      setVisible(true);
      observer.disconnect();
    }, 2_500);
    return () => {
      clearTimeout(fallback);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{ animationDelay: `${delay}ms` }}
      className={`${visible ? 'animate-fade-up' : 'opacity-0'} ${className}`}
    >
      {children}
    </div>
  );
}
