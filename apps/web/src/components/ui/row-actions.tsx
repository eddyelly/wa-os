'use client';

import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/dropdown-menu';
import { cn } from '@/lib/utils';

export interface RowAction {
  key: string;
  label: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

/** The per-row kebab (...) menu used by the data tables. */
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-brand-500 outline-none transition-colors hover:bg-brand-100 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            disabled={action.disabled}
            className={cn(action.tone === 'danger' && 'text-red-700 focus:text-red-700')}
            onSelect={() => {
              action.onSelect();
            }}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
