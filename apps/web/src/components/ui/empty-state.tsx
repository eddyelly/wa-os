import type { ReactNode } from 'react';

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-brand-100 bg-white px-6 py-12 text-center shadow-sm">
      <p className="text-base font-semibold text-brand-900">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-brand-600">{hint}</p> : null}
      {action}
    </div>
  );
}
