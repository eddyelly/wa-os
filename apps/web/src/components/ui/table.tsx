import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Desktop-only data table frame (spec: tables render at lg and up; pages keep
 * their compact cards inside lg:hidden). Presentation only: pages own data,
 * filtering, and actions.
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'hidden overflow-x-auto rounded-2xl border border-brand-100 bg-white shadow-sm lg:block',
        className,
      )}
    >
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-brand-100 bg-brand-50/60">{children}</tr>
    </thead>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-xs font-semibold tracking-wide text-brand-600 uppercase',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-brand-100">{children}</tbody>;
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="transition-colors hover:bg-brand-50/50">{children}</tr>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 align-middle text-brand-900', className)}>{children}</td>;
}

/** 40px product thumbnail tile, or a neutral placeholder when there is no image. */
export function ThumbCell({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    <img src={src} alt={alt} className="h-10 w-10 rounded-lg object-cover" />
  ) : (
    <div aria-hidden className="h-10 w-10 rounded-lg bg-brand-100" />
  );
}
