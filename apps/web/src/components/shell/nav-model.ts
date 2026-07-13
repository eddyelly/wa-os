import type { LucideIcon } from 'lucide-react';
import { CalendarDays, ClipboardList, Home, MessageCircle, Package, Settings, Users } from 'lucide-react';
import type { BusinessModule } from '@waos/shared';

export type NavKey =
  | 'home'
  | 'inbox'
  | 'appointments'
  | 'products'
  | 'orders'
  | 'contacts'
  | 'settings';

export interface NavEntry {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  requiredModule?: BusinessModule;
}

export const NAV_ENTRIES: NavEntry[] = [
  { key: 'home', href: '/home', icon: Home },
  { key: 'inbox', href: '/inbox', icon: MessageCircle },
  { key: 'appointments', href: '/appointments', icon: CalendarDays, requiredModule: 'appointments' },
  { key: 'products', href: '/products', icon: Package, requiredModule: 'shop' },
  { key: 'orders', href: '/orders', icon: ClipboardList, requiredModule: 'shop' },
  { key: 'contacts', href: '/contacts', icon: Users },
  { key: 'settings', href: '/settings', icon: Settings },
];

export function visibleEntries(modules: readonly BusinessModule[]): NavEntry[] {
  return NAV_ENTRIES.filter((e) => !e.requiredModule || modules.includes(e.requiredModule));
}

// The mobile bottom bar shows Home, Inbox, and one key module screen, then a
// More button. Key screen: Orders for a shop, else Appointments, else Contacts.
export function primaryEntries(modules: readonly BusinessModule[]): NavEntry[] {
  const byKey = (k: NavKey): NavEntry | undefined => NAV_ENTRIES.find((e) => e.key === k);
  const keyScreen = modules.includes('shop')
    ? byKey('orders')
    : modules.includes('appointments')
      ? byKey('appointments')
      : byKey('contacts');
  return [byKey('home'), byKey('inbox'), keyScreen].filter((e): e is NavEntry => e !== undefined);
}

export function overflowEntries(modules: readonly BusinessModule[]): NavEntry[] {
  const primary = new Set(primaryEntries(modules).map((e) => e.key));
  return visibleEntries(modules).filter((e) => !primary.has(e.key));
}
