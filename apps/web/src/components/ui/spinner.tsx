export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-brand-700" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
