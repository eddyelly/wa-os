import type { ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand-700 text-white hover:bg-brand-800',
        accent: 'bg-accent-500 text-white hover:bg-accent-600',
        secondary: 'bg-brand-100 text-brand-900 hover:bg-brand-200',
        ghost: 'bg-transparent text-brand-800 hover:bg-brand-100',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export function Button({
  variant,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
