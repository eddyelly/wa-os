import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'bg-brand-100 text-brand-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
  ai: 'bg-violet-100 text-violet-800',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
