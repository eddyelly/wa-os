'use client';

import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A search box styled like Input, with a leading search icon. */
export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-400"
      />
      <input
        type="search"
        className="min-h-11 w-full rounded-xl border border-brand-200 bg-white py-2.5 pr-4 pl-9 text-base text-brand-950 placeholder:text-brand-400 outline-none transition-colors focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
        {...props}
      />
    </div>
  );
}
