import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-brand-100 bg-white p-6 shadow-sm', className)}>
      {children}
    </div>
  );
}
