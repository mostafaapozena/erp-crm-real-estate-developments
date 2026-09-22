import {
  ActorContextSchema,
  ScopeAssignmentSchema,
  addDays,
  businessDateInZone,
  nowInstant,
  type ActorContext,
  type BusinessDate,
  type Permission,
} from '@alola/contracts';
import { currentTotpCode, type Logger } from '@alola/security';
import type { Connection } from 'mongoose';
import { bootstrapGrant, bootstrapRole } from '../../apps/api/src/modules/security';
import type { DomainServices } from '../../apps/api/src/platform/domain-services';
import { generatePassword, type CredentialEntry } from './credentials';
import {
  BRANCHES,
  DEMO_ACCOUNTS,
  DEMO_CURRENCY,
  DEPARTMENTS,
  JOB_TITLES,
  LEGAL_ENTITY,
  TEAMS,
  type DemoAccount,
} from './dataset';
import { C } from './collections';
import { SeedLedger, type Counter, tally } from './ledger';
import { DEMO_ROLES } from './roles';

/**
 * The demonstration seed.
 *
 * It writes **through the product's own services**, as the demonstration accounts themselves: the
 * representative creates the lead, the manager confirms the reservation, the collection officer
 * records the receipt. Nothing is inserted straight into a collection. That costs more code than a
 * pile of `insertMany` calls and buys the only thing that matters here — every record in the
 * demonstration is a record the product could have produced, with the same validation, the same
 * permission checks, the same transactions and the same audit trail.
 *
 * It is idempotent through `SeedLedger`: every create is keyed, and a second run finds the key and
 * reuses the identifier instead of writing a second copy.
 *
 * Two places deliberately bypass a guarded service, both of them the documented bootstrap path:
 * `bootstrapRole` and `bootstrapGrant`. Authorization state has to exist before any actor can hold
 * the permission to write authorization state; that is the same exception `scripts/bootstrap-admin.ts`
 * uses, and it is unreachable over HTTP.
 */

export interface SeedOptions {
  connection: Connection;
  services: DomainServices;
  logger: Logger;
  timeZone: string;
  /** Matches the API's `AUTH_TOTP_ISSUER`, so a seeded authenticator entry is labelled the same way. */
  totpIssuer: string;
  correlationId: string;
}

/**
 * What the foundation phase hands to the business phase. Passing it explicitly, rather than letting
 * the second half re-query for codes, keeps the two phases readable and makes the dependency obvious:
 * nothing in the business data can be written until these identifiers exist.
 */
export interface SeedFoundation {
  credentials: CredentialEntry[];
  counts: Counter;
  today: BusinessDate;
  ledger: SeedLedger;
  systemActor: ActorContext;
  branchIds: Map<string, string>;
  departmentIds: Map<string, string>;
  teamIds: Map<string, string>;
  accountIds: Map<string, string>;
}

export const SYSTEM_ACCOUNT = 'system:seed-demo';

export async function seedFoundation(options: SeedOptions): Promise<SeedFoundation> {
  const { connection, services, logger, timeZone, correlationId } = options;
  const context = { correlationId, method: 'CLI', route: 'scripts/seed-demo' };
  const today = businessDateInZone(nowInstant(), timeZone);
  const ledger = new SeedLedger(connection);
  await ledger.load();
  const counts: Counter = {};

  /**
   * The actor that writes the organization, the roles and the accounts.
   *
   * It exists only inside this script and only for the part of the seed that runs **before any
   * account exists**. It is `kind: 'system'`, so every audit record it leaves says plainly that the
   * seeding script did this and not a person. Everything after the accounts exist is written as one
   * of them.
   */
  const systemActor: ActorContext = ActorContextSchema.parse({
    accountId: SYSTEM_ACCOUNT,
    kind: 'system',
    roleKeys: ['seed'],
    permissions: SEED_PERMISSIONS,
    scope: ScopeAssignmentSchema.parse({ level: 'all' }),
  });

  /* ------------------------------------------------------------- organization */

  const org = services.organization();

  const legalEntity = await ledger.ensure(
    'legalEntity:' + LEGAL_ENTITY.code,
    C.legalEntities,
    'legalEntityId',
    async () => {
      const created = await org.createLegalEntity(
        systemActor,
        {
          code: LEGAL_ENTITY.code,
          name: LEGAL_ENTITY.name,
          currency: DEMO_CURRENCY,
          timeZone,
          taxNumber: LEGAL_ENTITY.taxNumber,
        },
        context,
      );
      return created.legalEntityId;
    },
  );
  tally(counts, 'legalEntity', legalEntity.created);

  const branchIds = new Map<string, string>();
  for (const branch of BRANCHES) {
    const result = await ledger.ensure(
      `branch:${branch.code}`,
      C.branches,
      'branchId',
      async () => {
        const created = await org.createBranch(
          systemActor,
          {
            legalEntityId: legalEntity.value,
            code: branch.code,
            name: branch.name,
            city: branch.city,
          },
          context,
        );
        return created.branchId;
      },
    );
    branchIds.set(branch.code, result.value);
    tally(counts, 'branch', result.created);
  }

  const departmentIds = new Map<string, string>();
  for (const department of DEPARTMENTS) {
    const branchId = branchIds.get(department.branchCode);
    if (!branchId) throw new Error(`unknown branch ${department.branchCode}`);
    const result = await ledger.ensure(
      `department:${department.code}`,
      C.departments,
      'departmentId',
      async () => {
        const created = await org.createDepartment(
          systemActor,
          {
            branchId,
            code: department.code,
            name: department.name,
            costCenterCode: department.costCenterCode,
          },
          context,
        );
        return created.departmentId;
      },
    );
    departmentIds.set(department.code, result.value);
    tally(counts, 'department', result.created);
  }

  const teamIds = new Map<string, string>();
  for (const team of TEAMS) {
    const departmentId = departmentIds.get(team.departmentCode);
    if (!departmentId) throw new Error(`unknown department ${team.departmentCode}`);
    const result = await ledger.ensure(`team:${team.code}`, C.teams, 'teamId', async () => {
      const created = await org.createTeam(
        systemActor,
        { departmentId, code: team.code, name: team.name },
        context,
      );
      return created.teamId;
    });
    teamIds.set(team.code, result.value);
    tally(counts, 'team', result.created);
  }

  const jobTitleIds = new Map<string, string>();
  for (const jobTitle of JOB_TITLES) {
    const result = await ledger.ensure(
      `jobTitle:${jobTitle.code}`,
      C.jobTitles,
      'jobTitleId',
      async () => {
        const created = await org.createJobTitle(
          systemActor,
          { code: jobTitle.code, name: jobTitle.name },
          context,
        );
        return created.jobTitleId;
      },
    );
    jobTitleIds.set(jobTitle.code, result.value);
    tally(counts, 'jobTitle', result.created);
  }

  /* -------------------------------------------------------------------- roles */

  for (const role of DEMO_ROLES) {
    const isAdministrative = role.permissions.some((permission) => ADMINISTRATIVE.has(permission));
    // Written on every run, not only the first: the permission list in `roles.ts` is the source of
    // truth, so editing it and reseeding should update the role rather than silently keep the old one.
    // The ledger entry exists so the reset knows these roles were seeded and can remove them.
    const known = ledger.existing(`role:${role.key}`) !== undefined;
    await bootstrapRole(connection, {
      key: role.key,
      name: role.name,
      permissions: role.permissions,
      isAdministrative,
    });
    await ledger.remember(`role:${role.key}`, C.roles, 'key', role.key);
    tally(counts, 'role', !known);
  }

  /* ----------------------------------------------------------------- accounts */

  const identity = services.identity();
  const accountIds = new Map<string, string>();
  const credentials: CredentialEntry[] = [];

  for (const account of DEMO_ACCOUNTS) {
    const password = generatePassword();
    const existing = ledger.existing(`account:${account.key}`);

    if (existing) {
      // The account survives; only the password is re-established, through the ordinary
      // administrative reset. That keeps the credentials file truthful on every run without ever
      // writing a password hash directly or weakening the policy that checks it.
      const reset = await identity.issueAdministrativePasswordReset(systemActor, existing, context);
      await identity.completePasswordReset(reset.token, password, context);
      accountIds.set(account.key, existing);
      tally(counts, 'account', false);
    } else {
      const created = await identity.createAccount(
        systemActor,
        {
          loginIdentifier: account.loginIdentifier,
          displayName: account.displayName,
          personalAccountAttested: true,
        },
        context,
      );
      await identity.activateAccount(created.activationToken, password, context);
      await ledger.remember(
        `account:${account.key}`,
        C.accounts,
        'accountId',
        created.account.accountId,
      );
      accountIds.set(account.key, created.account.accountId);
      tally(counts, 'account', true);
    }

    const accountId = accountIds.get(account.key);
    if (!accountId) throw new Error(`account ${account.key} was not created`);

    await bootstrapGrant(connection, {
      accountId,
      roleKeys: [account.roleKey],
      scope: scopeFor(account, branchIds),
      updatedBy: SYSTEM_ACCOUNT,
    });

    const entry: CredentialEntry = {
      roleLabel: account.roleLabel,
      loginIdentifier: account.loginIdentifier,
      password,
      scopeNote: account.scopeNote,
    };

    // `SEC-017`: an account holding administrative permissions cannot sign in without a second
    // factor. Rather than side-stepping that for the demonstration, the seed enrols one properly and
    // records the secret in the ignored credentials file so the operator can add it to an
    // authenticator app. The control stays exactly as strict as it is in production.
    const role = DEMO_ROLES.find((candidate) => candidate.key === account.roleKey);
    if (role?.permissions.some((permission) => ADMINISTRATIVE.has(permission))) {
      const enrolment = await enrolSecondFactor(identity, accountId, options.totpIssuer, context);
      entry.totp = enrolment;
    }

    credentials.push(entry);
  }

  /* -------------------------------------------------------------- placements */

  const placementIds = new Map<string, string>();
  // Ordered so a manager's placement always exists before the people who report to it.
  const ordered = [...DEMO_ACCOUNTS].sort(
    (a, b) => depthOf(a, DEMO_ACCOUNTS) - depthOf(b, DEMO_ACCOUNTS),
  );
  for (const account of ordered) {
    const departmentId = departmentIds.get(account.departmentCode);
    const jobTitleId = jobTitleIds.get(account.jobTitleCode);
    const accountId = accountIds.get(account.key);
    if (!departmentId || !jobTitleId || !accountId) {
      throw new Error(`placement references missing for ${account.key}`);
    }
    const managerPlacementId = account.managerKey
      ? placementIds.get(account.managerKey)
      : undefined;
    const teamId = account.teamCode ? teamIds.get(account.teamCode) : undefined;

    const result = await ledger.ensure(
      `placement:${account.key}`,
      C.placements,
      'placementId',
      async () => {
        const created = await org.createPlacement(
          systemActor,
          {
            accountId,
            displayName: account.displayName,
            departmentId,
            jobTitleId,
            startedOn: addDays(today, -365),
            ...(teamId ? { teamId } : {}),
            ...(managerPlacementId ? { managerPlacementId } : {}),
          },
          context,
        );
        return created.placementId;
      },
    );
    placementIds.set(account.key, result.value);
    tally(counts, 'placement', result.created);
  }

  logger.info({ accounts: accountIds.size }, 'demonstration organization and accounts ready');

  return {
    credentials,
    counts,
    today,
    ledger,
    systemActor,
    branchIds,
    departmentIds,
    teamIds,
    accountIds,
  };
}

/* ------------------------------------------------------------------- helpers */

/**
 * The permissions the seeding actor holds.
 *
 * Only what the seed actually calls: organization structure, accounts and approval configuration.
 * It deliberately does **not** hold the business permissions — the leads, reservations, contracts and
 * receipts are written by the demonstration accounts, and giving this actor those permissions would
 * make it possible to write a record no real role could have produced.
 */
const SEED_PERMISSIONS: Permission[] = [
  'org.view',
  'org.manage',
  'org.placement.view',
  'org.placement.manage',
  'security.account.view',
  'security.account.create',
  'security.role.view',
  'security.role.create',
  'security.grant.view',
  'security.grant.assign',
  'approval.policy.view',
  'approval.policy.create',
  'approval.policy.publish',
];

const ADMINISTRATIVE = new Set<string>([
  'org.manage',
  'org.placement.manage',
  'security.account.create',
  'security.account.suspend',
  'security.account.reactivate',
  'security.role.create',
  'security.grant.assign',
  'security.session.revokeAny',
]);

function scopeFor(account: DemoAccount, branchIds: Map<string, string>) {
  if (!account.branchCodes || account.branchCodes.length === 0) {
    return ScopeAssignmentSchema.parse({ level: 'all' });
  }
  return ScopeAssignmentSchema.parse({
    level: 'branch',
    branchIds: account.branchCodes.map((code) => {
      const id = branchIds.get(code);
      if (!id) throw new Error(`unknown branch ${code}`);
      return id;
    }),
  });
}

/** How many managers sit above this account, so placements can be written parents-first. */
function depthOf(account: DemoAccount, all: DemoAccount[], guard = 0): number {
  if (!account.managerKey || guard > 10) return 0;
  const manager = all.find((candidate) => candidate.key === account.managerKey);
  return manager ? depthOf(manager, all, guard + 1) + 1 : 0;
}

/**
 * Enrol a second factor the same way a person does: start the enrolment, then confirm it with a live
 * code derived from the secret. Confirming is what proves the authenticator works, and the seed
 * proves it the same way rather than flipping `mfa.enabled` in the database.
 *
 * On a rerun the account already has a factor enrolled, and its secret cannot be read back — so the
 * existing one is cleared through the audited administrative reset and a fresh one enrolled, which
 * keeps the credentials file usable.
 */
async function enrolSecondFactor(
  identity: ReturnType<DomainServices['identity']>,
  accountId: string,
  totpIssuer: string,
  context: { correlationId: string; method: string; route: string },
): Promise<{ secret: string; otpauthUri: string; recoveryCodes: string[] }> {
  const account = await identity.getAccount(accountId);
  if (account.mfaEnabled) {
    await identity.resetMfaAsAdministrator(
      ActorContextSchema.parse({
        accountId: SYSTEM_ACCOUNT,
        kind: 'system',
        permissions: ['security.account.create'],
        scope: ScopeAssignmentSchema.parse({ level: 'all' }),
      }),
      accountId,
      context,
    );
  }
  const enrolment = await identity.startMfaEnrolment(accountId, context);
  const code = currentTotpCode({
    secret: enrolment.secret,
    issuer: totpIssuer,
    label: account.loginIdentifier,
  });
  await identity.confirmMfaEnrolment(accountId, code, context);
  return enrolment;
}
