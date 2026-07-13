'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const styles = {
    primary:
      'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-300 disabled:cursor-not-allowed',
    secondary: 'bg-brand-100 text-brand-900 hover:bg-brand-200 disabled:opacity-50',
    ghost: 'bg-transparent text-brand-800 hover:bg-brand-100 disabled:opacity-50',
  }[variant];
  return (
    <button
      className={`min-h-11 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-12 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base text-brand-950 placeholder:text-brand-400 focus:border-brand-600 focus:outline-2 focus:outline-offset-0 focus:outline-brand-600 ${className}`}
      {...props}
    />
  );
}

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

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white p-6 shadow-sm ${className}`}>{children}</div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-brand-700" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-brand-100 ${className}`} />;
}

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
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
      <p className="text-base font-semibold text-brand-900">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-brand-600">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorBox({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
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

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'ai';
}) {
  const styles = {
    neutral: 'bg-brand-100 text-brand-800',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-900',
    danger: 'bg-red-100 text-red-800',
    ai: 'bg-violet-100 text-violet-800',
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles}`}>
      {children}
    </span>
  );
}
