import type { Permission } from '@alola/contracts';

/**
 * The navigation model, in one place.
 *
 * Each entry names the permissions that make it worth showing. **That is presentation, not
 * security**: the server enforces every one of them again inside the query (ADR-0006), and the E2E
 * suite navigates directly to a hidden route and asserts the API still refuses. Hiding a link a
 * person cannot use is a courtesy; treating the hidden link as the control would be the classic
 * client-side authorization mistake.
 *
 * Labels are translation keys, never text, so a navigation item cannot ship in one language.
 */
export interface NavItem {
  path: string;
  labelKey: string;
  /** Shown when the actor holds **any** of these. An empty list means always shown. */
  permissions: Permission[];
}

export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    labelKey: 'nav.dashboard',
    items: [
      { path: '/', labelKey: 'nav.dashboard', permissions: [] },
      // Everyone has their own tasks; no permission is needed to see them (CORE-TASK-001).
      { path: '/tasks', labelKey: 'nav.tasks', permissions: [] },
    ],
  },
  {
    labelKey: 'nav.groupSales',
    items: [
      { path: '/leads', labelKey: 'nav.crm', permissions: ['crm.lead.view'] },
      { path: '/customers', labelKey: 'nav.customers', permissions: ['crm.customer.view'] },
      { path: '/projects', labelKey: 'nav.projects', permissions: ['inventory.project.view'] },
      { path: '/units', labelKey: 'nav.units', permissions: ['inventory.unit.view'] },
      {
        path: '/reservations',
        labelKey: 'nav.reservations',
        permissions: ['sales.reservation.view'],
      },
      { path: '/contracts', labelKey: 'nav.contracts', permissions: ['sales.contract.view'] },
    ],
  },
  {
    labelKey: 'nav.groupFinance',
    items: [
      {
        path: '/installments',
        labelKey: 'nav.installments',
        permissions: ['collection.installment.view'],
      },
      { path: '/receipts', labelKey: 'nav.receipts', permissions: ['collection.receipt.view'] },
      {
        path: '/instruments',
        labelKey: 'nav.instruments',
        permissions: ['collection.instrument.view'],
      },
      { path: '/reminders', labelKey: 'nav.reminders', permissions: ['collection.reminder.view'] },
    ],
  },
  {
    labelKey: 'nav.groupMarketing',
    items: [
      { path: '/campaigns', labelKey: 'nav.campaigns', permissions: ['marketing.campaign.view'] },
    ],
  },
  {
    labelKey: 'nav.groupAdmin',
    items: [
      { path: '/organization', labelKey: 'nav.organization', permissions: ['org.view'] },
      { path: '/imports', labelKey: 'nav.imports', permissions: ['referenceData.manage'] },
    ],
  },
];

export function visibleGroups(canAny: (permissions: readonly Permission[]) => boolean): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.permissions.length === 0 || canAny(item.permissions)),
  })).filter((group) => group.items.length > 0);
}

/**
 * The breadcrumb trail for a path.
 *
 * Derived from the navigation model rather than from the URL, so a crumb always matches a place a
 * person can actually go back to. Detail segments append their own crumb from the page itself,
 * because only the page knows a record's number.
 */
export function breadcrumbFor(pathname: string): NavItem[] {
  const trail: NavItem[] = [];
  const home = NAVIGATION[0]?.items[0];
  if (home) trail.push(home);
  if (pathname === '/') return trail;

  const segment = `/${pathname.split('/').filter(Boolean)[0] ?? ''}`;
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      if (item.path !== '/' && item.path === segment) trail.push(item);
    }
  }
  return trail;
}
