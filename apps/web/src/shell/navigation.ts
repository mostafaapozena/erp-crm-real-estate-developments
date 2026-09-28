import type { Permission } from '@alola/contracts';
import {
  BadgeCheck,
  Building2,
  CalendarCheck,
  CalendarClock,
  FileSignature,
  FileUp,
  House,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Network,
  Receipt,
  BellRing,
  ScrollText,
  UserPlus,
  Users,
  type LucideIcon,
} from '@alola/ui/icons';

/**
 * The navigation model, in one place.
 *
 * Each entry names the permissions that make it worth showing. **That is presentation, not
 * security**: the server enforces every one of them again inside the query (ADR-0006), and the E2E
 * suite navigates directly to a hidden route and asserts the API still refuses. Hiding a link a
 * person cannot use is a courtesy; treating the hidden link as the control would be the classic
 * client-side authorization mistake.
 *
 * Labels are translation keys, never text, so a navigation item cannot ship in one language. Every
 * entry is a route that exists — no group is padded with a placeholder screen.
 */
export interface NavItem {
  path: string;
  labelKey: string;
  icon: LucideIcon;
  /** Shown when the actor holds **any** of these. An empty list means always shown. */
  permissions: Permission[];
}

export interface NavGroup {
  id: string;
  labelKey: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    id: 'overview',
    labelKey: 'nav.groupOverview',
    items: [
      { path: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, permissions: [] },
      // Everyone has their own tasks; no permission is needed to see them (CORE-TASK-001).
      { path: '/tasks', labelKey: 'nav.tasks', icon: ListChecks, permissions: [] },
    ],
  },
  {
    id: 'crm',
    labelKey: 'nav.groupCrm',
    items: [
      { path: '/leads', labelKey: 'nav.crm', icon: UserPlus, permissions: ['crm.lead.view'] },
      {
        path: '/customers',
        labelKey: 'nav.customers',
        icon: Users,
        permissions: ['crm.customer.view'],
      },
    ],
  },
  {
    id: 'inventory',
    labelKey: 'nav.groupInventory',
    items: [
      {
        path: '/projects',
        labelKey: 'nav.projects',
        icon: Building2,
        permissions: ['inventory.project.view'],
      },
      { path: '/units', labelKey: 'nav.units', icon: House, permissions: ['inventory.unit.view'] },
    ],
  },
  {
    id: 'deals',
    labelKey: 'nav.groupDeals',
    items: [
      {
        path: '/reservations',
        labelKey: 'nav.reservations',
        icon: CalendarCheck,
        permissions: ['sales.reservation.view'],
      },
      {
        path: '/contracts',
        labelKey: 'nav.contracts',
        icon: FileSignature,
        permissions: ['sales.contract.view'],
      },
    ],
  },
  {
    id: 'finance',
    labelKey: 'nav.groupFinance',
    items: [
      {
        path: '/installments',
        labelKey: 'nav.installments',
        icon: CalendarClock,
        permissions: ['collection.installment.view'],
      },
      {
        path: '/receipts',
        labelKey: 'nav.receipts',
        icon: Receipt,
        permissions: ['collection.receipt.view'],
      },
      {
        path: '/instruments',
        labelKey: 'nav.instruments',
        icon: ScrollText,
        permissions: ['collection.instrument.view'],
      },
      {
        path: '/reminders',
        labelKey: 'nav.reminders',
        icon: BellRing,
        permissions: ['collection.reminder.view'],
      },
    ],
  },
  {
    id: 'marketing',
    labelKey: 'nav.groupMarketing',
    items: [
      {
        path: '/campaigns',
        labelKey: 'nav.campaigns',
        icon: Megaphone,
        permissions: ['marketing.campaign.view'],
      },
    ],
  },
  {
    id: 'admin',
    labelKey: 'nav.groupAdmin',
    items: [
      {
        path: '/organization',
        labelKey: 'nav.organization',
        icon: Network,
        permissions: ['org.view'],
      },
      {
        path: '/imports',
        labelKey: 'nav.imports',
        icon: FileUp,
        permissions: ['referenceData.manage'],
      },
    ],
  },
  {
    id: 'settings',
    labelKey: 'nav.groupSettings',
    items: [
      {
        path: '/settings/company',
        labelKey: 'nav.companyIdentity',
        icon: BadgeCheck,
        permissions: ['company.profile.view'],
      },
    ],
  },
];

export function visibleGroups(canAny: (permissions: readonly Permission[]) => boolean): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.permissions.length === 0 || canAny(item.permissions)),
  })).filter((group) => group.items.length > 0);
}

/** The entry a path belongs to: the longest navigation path that is a prefix of it. */
export function activeItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      const matches =
        item.path === '/'
          ? pathname === '/'
          : pathname === item.path || pathname.startsWith(`${item.path}/`);
      if (matches && (!best || item.path.length > best.path.length)) best = item;
    }
  }
  return best;
}

export function isActive(item: NavItem, pathname: string): boolean {
  return activeItem(pathname)?.path === item.path;
}

/**
 * The breadcrumb trail for a path.
 *
 * Derived from the navigation model rather than from the URL, so a crumb always matches a place a
 * person can actually go back to. A detail screen appends its own final crumb (a record number)
 * through `useBreadcrumbTail`, because only the page knows it.
 */
export function breadcrumbFor(pathname: string): NavItem[] {
  const trail: NavItem[] = [];
  const home = NAVIGATION[0]?.items[0];
  if (home) trail.push(home);
  if (pathname === '/') return trail;
  const item = activeItem(pathname);
  if (item && item.path !== '/') trail.push(item);
  return trail;
}
