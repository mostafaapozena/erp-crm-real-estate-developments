import {
  DECISIONS_COLLECTION,
  POLICIES_COLLECTION,
  REQUESTS_COLLECTION,
} from '../../apps/api/src/modules/approval';
import {
  INSTRUMENTS_COLLECTION,
  RECEIPTS_COLLECTION,
  REMINDERS_COLLECTION,
} from '../../apps/api/src/modules/collections';
import {
  ACTIVITIES_COLLECTION,
  CUSTOMERS_COLLECTION,
  LEADS_COLLECTION,
} from '../../apps/api/src/modules/crm';
import {
  ACCOUNTS_COLLECTION,
  ACCOUNT_TOKENS_COLLECTION,
  REFRESH_TOKENS_COLLECTION,
  SESSIONS_COLLECTION,
} from '../../apps/api/src/modules/identity';
import {
  BUILDINGS_COLLECTION,
  PROJECTS_COLLECTION,
  UNITS_COLLECTION,
  UNIT_EVENTS_COLLECTION,
} from '../../apps/api/src/modules/inventory';
import { CAMPAIGNS_COLLECTION } from '../../apps/api/src/modules/marketing';
import {
  BRANCHES_COLLECTION,
  DEPARTMENTS_COLLECTION,
  JOB_TITLES_COLLECTION,
  LEGAL_ENTITIES_COLLECTION,
  PLACEMENTS_COLLECTION,
  TEAMS_COLLECTION,
} from '../../apps/api/src/modules/organization';
import {
  CONTRACTS_COLLECTION,
  COUNTERS_COLLECTION,
  INSTALLMENTS_COLLECTION,
  RESERVATIONS_COLLECTION,
} from '../../apps/api/src/modules/sales';
import { ACCOUNT_GRANTS_COLLECTION, ROLES_COLLECTION } from '../../apps/api/src/modules/security';

/**
 * Collection names, taken from the modules that own them rather than written out again here.
 *
 * This matters more than it looks. The seed records a collection name against every identifier it
 * writes, and the reset deletes from the collection that name points at. A name typed by hand and
 * slightly wrong — `units` instead of `inventoryUnits` — makes the reset silently delete nothing
 * while reporting success, which is the worst possible failure for a teardown command. Importing the
 * constants makes that class of mistake a compile error.
 */
export const C = {
  legalEntities: LEGAL_ENTITIES_COLLECTION,
  branches: BRANCHES_COLLECTION,
  departments: DEPARTMENTS_COLLECTION,
  teams: TEAMS_COLLECTION,
  jobTitles: JOB_TITLES_COLLECTION,
  placements: PLACEMENTS_COLLECTION,
  roles: ROLES_COLLECTION,
  grants: ACCOUNT_GRANTS_COLLECTION,
  accounts: ACCOUNTS_COLLECTION,
  sessions: SESSIONS_COLLECTION,
  refreshTokens: REFRESH_TOKENS_COLLECTION,
  accountTokens: ACCOUNT_TOKENS_COLLECTION,
  projects: PROJECTS_COLLECTION,
  buildings: BUILDINGS_COLLECTION,
  units: UNITS_COLLECTION,
  unitEvents: UNIT_EVENTS_COLLECTION,
  customers: CUSTOMERS_COLLECTION,
  leads: LEADS_COLLECTION,
  activities: ACTIVITIES_COLLECTION,
  reservations: RESERVATIONS_COLLECTION,
  contracts: CONTRACTS_COLLECTION,
  installments: INSTALLMENTS_COLLECTION,
  counters: COUNTERS_COLLECTION,
  receipts: RECEIPTS_COLLECTION,
  instruments: INSTRUMENTS_COLLECTION,
  reminders: REMINDERS_COLLECTION,
  campaigns: CAMPAIGNS_COLLECTION,
  approvalPolicies: POLICIES_COLLECTION,
  approvalRequests: REQUESTS_COLLECTION,
  approvalDecisions: DECISIONS_COLLECTION,
} as const;

/**
 * Records the seed creates **indirectly**, which therefore carry no ledger entry of their own.
 *
 * A contract writes its instalment schedule; a reservation with a discount raises an approval request
 * and, once decided, a decision; a unit accumulates a status-change history; a lead accumulates
 * activities. None of those is created by an explicit call the seed could key, so the reset removes
 * them by their parent's identifier — every one of which *is* in the ledger. Nothing is deleted on a
 * guess: if the parent was not seeded here, its children are not touched.
 */
export const DEPENDENTS: { collection: string; field: string; parent: keyof typeof C }[] = [
  { collection: C.installments, field: 'contractId', parent: 'contracts' },
  { collection: C.reminders, field: 'contractId', parent: 'contracts' },
  { collection: C.activities, field: 'leadId', parent: 'leads' },
  { collection: C.unitEvents, field: 'unitId', parent: 'units' },
];
