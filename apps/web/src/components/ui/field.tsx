import type { ReactNode } from 'react';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-brand-900">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-brand-600">{hint}</span> : null}
    </label>
  );
}
