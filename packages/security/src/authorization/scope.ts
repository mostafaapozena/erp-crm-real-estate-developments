import type { ActorContext, ScopeLevel } from '@alola/contracts';

/**
 * Data scope translated into a query filter (SEC-026, SEC-027, ADR-0006).
 *
 * The filter is **merged into every query before the database answers**, so counts, aggregates,
 * pagination totals, exports, and search are all constrained by construction (SEC-028). Filtering after
 * retrieval is prohibited: it leaks through exactly those paths.
 */

/** Which document fields carry the ownership and organization references for a resource. */
export interface ScopeFieldMap {
  owner?: string;
  assignee?: string;
  team?: string;
  department?: string;
  branch?: string;
  project?: string;
  legalEntity?: string;
}

export type ScopeFilter = Record<string, unknown>;

/**
 * A filter that matches nothing. Used whenever a scope cannot be satisfied — a missing field mapping or
 * an empty reference list. **Failing closed is deliberate**: the alternative, an empty filter, would
 * match every record.
 */
export const MATCH_NOTHING: ScopeFilter = Object.freeze({ __scope_match_nothing: true });

export function isMatchNothing(filter: ScopeFilter): boolean {
  return Object.prototype.hasOwnProperty.call(filter, '__scope_match_nothing');
}

function inFilter(field: string | undefined, values: readonly string[]): ScopeFilter {
  if (!field || values.length === 0) return MATCH_NOTHING;
  return { [field]: { $in: [...values] } };
}

/**
 * Build the scope filter for an actor. `all` returns `{}` — unrestricted, which is why it is granted to
 * as few accounts as possible and is visible in audit evidence.
 */
export function buildScopeFilter(actor: ActorContext, fields: ScopeFieldMap): ScopeFilter {
  const level: ScopeLevel = actor.scope.level;
  switch (level) {
    case 'all':
      return {};
    case 'self':
      return fields.owner ? { [fields.owner]: actor.accountId } : MATCH_NOTHING;
    case 'assigned':
      return fields.assignee ? { [fields.assignee]: actor.accountId } : MATCH_NOTHING;
    case 'team':
      return inFilter(fields.team, actor.scope.teamIds);
    case 'department':
      return inFilter(fields.department, actor.scope.departmentIds);
    case 'branch':
      return inFilter(fields.branch, actor.scope.branchIds);
    case 'project':
      return inFilter(fields.project, actor.scope.projectIds);
    case 'legalEntity':
      return inFilter(fields.legalEntity, actor.scope.legalEntityIds);
    default: {
      // Exhaustiveness: a new scope level must be handled explicitly rather than defaulting to open.
      const unreachable: never = level;
      throw new Error(`Unhandled scope level: ${String(unreachable)}`);
    }
  }
}

/** Combine a scope filter with an already-validated query filter. */
export function withScope(scopeFilter: ScopeFilter, queryFilter: ScopeFilter = {}): ScopeFilter {
  if (isMatchNothing(scopeFilter)) {
    // An impossible condition, expressed so the database returns nothing.
    return { _id: { $in: [] } };
  }
  const scopeKeys = Object.keys(scopeFilter);
  if (scopeKeys.length === 0) return { ...queryFilter };
  if (Object.keys(queryFilter).length === 0) return { ...scopeFilter };
  return { $and: [queryFilter, scopeFilter] };
}
