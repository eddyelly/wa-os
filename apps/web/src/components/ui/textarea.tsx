import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base text-brand-950 placeholder:text-brand-400 outline-none transition-colors focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
