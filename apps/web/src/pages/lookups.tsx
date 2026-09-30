import type { Customer, Project } from '@alola/contracts';
import Link from '@mui/material/Link';
import { useMemo, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { query } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { useLocale } from '../locale';

/**
 * Names for the references a list carries, so a screen shows a customer's name and a project's name —
 * never a record identifier (ADR-0031's rule for people, applied to records).
 *
 * Both lookups go through the ordinary scoped endpoints: a name the actor may not see is simply not
 * returned, and the screen shows the fallback rather than guessing. One request per list, not one per
 * row.
 */

/** The names of the customers a list refers to, in one scoped request. */
export function useCustomerNames(ids: readonly (string | undefined)[]) {
  const { can } = useSession();
  const key = useMemo(
    () =>
      [...new Set(ids.filter((id): id is string => Boolean(id)))]
        .sort()
        .slice(0, 100)
        .join(','),
    [ids],
  );
  const customers = useApi<{ items: Customer[] }>(
    key && can('crm.customer.view')
      ? `/api/v1/crm/customers${query({ limit: 100, ids: key })}`
      : undefined,
  );
  return useMemo(() => {
    const names = new Map<string, string>();
    if (customers.state.kind === 'ready') {
      for (const customer of customers.state.data.items) names.set(customer.customerId, customer.name);
    }
    return (id: string | undefined) => (id ? names.get(id) : undefined);
  }, [customers.state]);
}

/** Project names in the current language, when the actor may read projects. */
export function useProjectNames() {
  const { can } = useSession();
  const { locale } = useLocale();
  const projects = useApi<{ items: Project[] }>(
    can('inventory.project.view') ? '/api/v1/inventory/projects' : undefined,
  );
  return useMemo(() => {
    const names = new Map<string, string>();
    if (projects.state.kind === 'ready') {
      for (const project of projects.state.data.items) {
        names.set(project.projectId, project.name[locale]);
      }
    }
    return (id: string | undefined) => (id ? names.get(id) : undefined);
  }, [locale, projects.state]);
}

/** A link to another record, underlined on hover, keeping the surrounding text style. */
export function RecordLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link component={RouterLink} to={to} underline="hover" sx={{ fontWeight: 600 }}>
      {children}
    </Link>
  );
}
