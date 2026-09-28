import {
  PERMISSIONS,
  type ActorContext,
  type ClientInitFile,
  type ClientInitStep,
} from '@alola/contracts';
import type { Connection } from 'mongoose';
import type { CompanyService } from '../modules/company';
import type { OrganizationService } from '../modules/organization';
import type { RequestContext } from './audit-port';

/**
 * Initialize a client deployment from its file (OPS-005).
 *
 * **Repeatable and never destructive.** Each item is looked up first and created only when absent; an
 * item that exists and matches is reported `exists`; one that exists but differs is reported
 * `differs` with the fields, and is **not** overwritten — changing a live company profile or legal
 * entity is an audited act through the product, not a side effect of re-running a script. There is no
 * reset, no delete, and no flag that adds one.
 *
 * It refuses outright on a database holding the demonstration data (fictional records must never
 * become a client's) and while migrations are pending. Records are written through the same services
 * the API uses, as the documented system actor, so every one is validated and audited.
 */
export class ClientInitRefused extends Error {
  constructor(
    readonly code: 'DEMONSTRATION_DATABASE' | 'MIGRATIONS_PENDING',
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ClientInitRefused';
  }
}

/** The demonstration seed's ledger (`scripts/seed-demo/ledger.ts`). Its presence marks a demo database. */
export const DEMO_LEDGER_COLLECTION = 'demoSeedLedger';

/** The actor client initialization writes as: a system identity with deployment-wide scope. */
export const CLIENT_INIT_ACTOR: ActorContext = {
  accountId: 'system:client-init',
  kind: 'system',
  roleKeys: [],
  permissions: [...PERMISSIONS],
  deniedPermissions: [],
  scope: {
    level: 'all',
    teamIds: [],
    departmentIds: [],
    branchIds: [],
    projectIds: [],
    legalEntityIds: [],
  },
  grantVersion: 0,
};

export interface ClientInitDependencies {
  connection: Connection;
  company: CompanyService;
  organization: OrganizationService;
  pendingMigrations: () => Promise<string[]>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function initializeClient(
  deps: ClientInitDependencies,
  file: ClientInitFile,
  context: RequestContext,
): Promise<ClientInitStep[]> {
  const demo = await deps.connection.db
    ?.collection(DEMO_LEDGER_COLLECTION)
    .countDocuments({}, { limit: 1 });
  if (demo) {
    throw new ClientInitRefused(
      'DEMONSTRATION_DATABASE',
      'this database holds the demonstration data; initialize a client on its own database',
    );
  }
  const pending = await deps.pendingMigrations();
  if (pending.length > 0) {
    throw new ClientInitRefused(
      'MIGRATIONS_PENDING',
      `run npm run db:migrate first (${pending.join(', ')})`,
    );
  }

  const steps: ClientInitStep[] = [];
  const actor = CLIENT_INIT_ACTOR;

  // The company profile.
  const profile = await deps.company.getProfile();
  if (!profile) {
    await deps.company.createProfile(actor, file.company, context);
    steps.push({ item: 'company profile', outcome: 'created' });
  } else {
    const fields = (
      [
        'legalName',
        'tradeName',
        'shortName',
        'country',
        'baseCurrency',
        'timeZone',
        'defaultLocale',
      ] as const
    ).filter((field) => !same(profile[field], file.company[field]));
    steps.push(
      fields.length === 0
        ? { item: 'company profile', outcome: 'exists' }
        : { item: 'company profile', outcome: 'differs', fields },
    );
  }

  // Legal entities and their branches.
  const entities = await deps.organization.listLegalEntities(actor);
  const branches = await deps.organization.listBranches(actor);
  for (const { branches: wantedBranches, ...wanted } of file.legalEntities) {
    let entity = entities.find((candidate) => candidate.code === wanted.code);
    if (!entity) {
      entity = await deps.organization.createLegalEntity(actor, wanted, context);
      steps.push({ item: `legal entity ${wanted.code}`, outcome: 'created' });
    } else {
      const fields = (['name', 'currency', 'timeZone'] as const).filter(
        (field) => !same(entity?.[field], wanted[field]),
      );
      steps.push(
        fields.length === 0
          ? { item: `legal entity ${wanted.code}`, outcome: 'exists' }
          : { item: `legal entity ${wanted.code}`, outcome: 'differs', fields },
      );
    }
    for (const branch of wantedBranches) {
      const existing = branches.find(
        (candidate) =>
          candidate.legalEntityId === entity.legalEntityId && candidate.code === branch.code,
      );
      const item = `branch ${wanted.code}/${branch.code}`;
      if (!existing) {
        await deps.organization.createBranch(
          actor,
          { legalEntityId: entity.legalEntityId, ...branch },
          context,
        );
        steps.push({ item, outcome: 'created' });
      } else {
        const fields = (['name', 'city'] as const).filter(
          (field) => !same(existing[field], branch[field]),
        );
        steps.push(
          fields.length === 0 ? { item, outcome: 'exists' } : { item, outcome: 'differs', fields },
        );
      }
    }
  }
  return steps;
}
