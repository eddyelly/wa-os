import { cn } from '@/lib/utils';

const tones = {
  neutral: 'border-brand-100 bg-white',
  brand: 'border-brand-200 bg-brand-50',
  accent: 'border-accent-200 bg-amber-50',
} as const;

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof tones;
}) {
  return (
    <div className={cn('rounded-2xl border p-4 shadow-sm', tones[tone])}>
      <p className="text-xs font-medium text-brand-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-brand-500">{hint}</p> : null}
    </div>
  );
}
