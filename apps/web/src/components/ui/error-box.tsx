export function ErrorBox({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{message}</p>
      {onRetry && retryLabel ? (
        <button
          onClick={onRetry}
          className="mt-2 font-semibold text-red-900 underline underline-offset-2"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
