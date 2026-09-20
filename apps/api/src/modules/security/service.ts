import {
  ADMINISTRATIVE_PERMISSIONS,
  AUDIT_ACTIONS,
  AccountGrantSchema,
  ActorContextSchema,
  RoleSchema,
  ScopeAssignmentSchema,
  isAdministrativePermission,
  type AccountGrant,
  type ActorContext,
  type CreateRoleRequest,
  type Permission,
  type Role,
  type ScopeAssignment,
  type SetAccountGrantRequest,
} from '@alola/contracts';
import {
  PrivilegeEscalationError,
  assertGrantAllowed,
  assertSafeFilter,
  buildChangeSummary,
  resolvePermissions,
} from '@alola/security';
import type { Connection } from 'mongoose';
import {
  accountGrantModel,
  roleModel,
  type AccountGrantDocument,
  type RoleDocument,
} from './model';

/**
 * Authorization administration (SEC-023 … SEC-032).
 *
 * Every mutation here is audited (AUDIT-005) and every mutation is checked against the
 * privilege-escalation rules (SEC-031) before anything is written.
 */

export interface AuditRecorder {
  record(input: {
    action: string;
    outcome: 'succeeded' | 'denied' | 'failed';
    actor: { kind: 'account' | 'system' | 'anonymous'; accountId?: string; roleKeys?: string[] };
    target: { type: string; id?: string };
    changes?: { path: string; from?: string; to?: string }[];
    reason?: string;
    context: {
      correlationId: string;
      ip?: string;
      userAgent?: string;
      method?: string;
      route?: string;
    };
  }): Promise<unknown>;
}

export interface RequestContext {
  correlationId: string;
  ip?: string;
  method?: string;
  route?: string;
}

export class RoleKeyConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly key: string) {
    super('CONFLICT');
    this.name = 'RoleKeyConflictError';
  }
}

export class UnknownRoleError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly keys: string[]) {
    super('VALIDATION_FAILED');
    this.name = 'UnknownRoleError';
  }
}

const EMPTY_SCOPE = ScopeAssignmentSchema.parse({ level: 'self' });

function toRole(document: RoleDocument): Role {
  return RoleSchema.parse({
    key: document.key,
    name: document.name,
    permissions: document.permissions,
    isAdministrative: document.isAdministrative,
    version: document.version,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  });
}

function toGrant(document: AccountGrantDocument): AccountGrant {
  return AccountGrantSchema.parse({
    accountId: document.accountId,
    roleKeys: document.roleKeys,
    deniedPermissions: document.deniedPermissions,
    scope: document.scope,
    version: document.version,
    updatedAt: document.updatedAt.toISOString(),
    updatedBy: document.updatedBy,
  });
}

export class SecurityService {
  private readonly roles;
  private readonly grants;
  private readonly audit;

  constructor(options: { connection: Connection; audit: AuditRecorder }) {
    this.roles = roleModel(options.connection);
    this.grants = accountGrantModel(options.connection);
    this.audit = options.audit;
  }

  /**
   * Apply the SEC-031 rules and, when they refuse, record the attempt as a security event (AUDIT-005).
   * A refused escalation is exactly the evidence an investigation needs, and it is not produced by the
   * request guard: the actor passed the guard and was stopped here.
   *
   * The refusal always propagates. If the audit write itself fails, `AuditService.record` has already
   * logged that failure, and turning a refusal into a 500 would not make the evidence any more durable.
   */
  private async assertNoEscalation(
    actor: ActorContext,
    selfCheckId: string,
    target: { type: string; id: string },
    requestedPermissions: readonly Permission[],
    requestedScope: ScopeAssignment,
    context: RequestContext,
  ): Promise<void> {
    try {
      assertGrantAllowed(actor, selfCheckId, requestedPermissions, requestedScope);
    } catch (error) {
      if (!(error instanceof PrivilegeEscalationError)) throw error;
      try {
        await this.audit.record({
          action: AUDIT_ACTIONS.authorizationDenied,
          outcome: 'denied',
          actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
          target,
          reason: `privilege escalation refused: ${error.attempt}`,
          context,
        });
      } catch {
        // Already logged by the audit service; the refusal below is what matters here.
      }
      throw error;
    }
  }

  async listRoles(): Promise<Role[]> {
    const documents = await this.roles.find({}).sort({ key: 1 }).lean<RoleDocument[]>().exec();
    return documents.map(toRole);
  }

  /**
   * Create a role. An actor cannot mint a role carrying permissions they do not themselves hold unless
   * they hold `security.grant.assignAny` — otherwise creating a role would be a way around SEC-031.
   */
  async createRole(
    actor: ActorContext,
    input: CreateRoleRequest,
    context: RequestContext,
  ): Promise<Role> {
    await this.assertNoEscalation(
      actor,
      // Creating a role is not a self-grant: the check that matters is the permission set.
      `role:${input.key}`,
      { type: 'role', id: input.key },
      input.permissions,
      EMPTY_SCOPE,
      context,
    );
    assertSafeFilter({ key: input.key });

    const existing = await this.roles.findOne({ key: input.key }).lean<RoleDocument>().exec();
    if (existing) throw new RoleKeyConflictError(input.key);

    const now = new Date();
    const document: RoleDocument = {
      key: input.key,
      name: input.name,
      permissions: [...new Set(input.permissions)].sort(),
      isAdministrative: input.permissions.some(isAdministrativePermission),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const created = await this.roles.create(document);
    const role = toRole(created.toObject());

    await this.audit.record({
      action: AUDIT_ACTIONS.roleCreated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'role', id: role.key },
      changes: buildChangeSummary(undefined, {
        key: role.key,
        permissions: role.permissions,
        isAdministrative: role.isAdministrative,
      }),
      context,
    });
    return role;
  }

  async getGrant(accountId: string): Promise<AccountGrant | undefined> {
    assertSafeFilter({ accountId });
    const document = await this.grants.findOne({ accountId }).lean<AccountGrantDocument>().exec();
    return document ? toGrant(document) : undefined;
  }

  /**
   * Replace an account's grant (SEC-024, SEC-026, SEC-031, SEC-032, AUDIT-005).
   *
   * The write is the only path that changes authorization, so all three escalation rules are applied to
   * the **effective permissions** of the requested roles, not to the role names.
   */
  async setGrant(
    actor: ActorContext,
    accountId: string,
    input: SetAccountGrantRequest,
    context: RequestContext,
  ): Promise<AccountGrant> {
    assertSafeFilter({ accountId });

    const roles = await this.roles
      .find({ key: { $in: [...new Set(input.roleKeys)] } })
      .lean<RoleDocument[]>()
      .exec();
    const found = new Set(roles.map((role) => role.key));
    const unknown = input.roleKeys.filter((key) => !found.has(key));
    if (unknown.length > 0) throw new UnknownRoleError(unknown);

    const effective = resolvePermissions(
      roles.map((role) => ({ key: role.key, permissions: role.permissions as Permission[] })),
      input.roleKeys,
      input.deniedPermissions,
    );
    // SEC-031: no self-grant, no granting beyond own permissions, no widening scope beyond own.
    await this.assertNoEscalation(
      actor,
      accountId,
      { type: 'accountGrant', id: accountId },
      effective,
      ScopeAssignmentSchema.parse(input.scope),
      context,
    );

    const before = await this.getGrant(accountId);
    const now = new Date();
    const scope = ScopeAssignmentSchema.parse(input.scope);
    const updated = await this.grants
      .findOneAndUpdate(
        { accountId },
        {
          $set: {
            roleKeys: input.roleKeys,
            deniedPermissions: input.deniedPermissions,
            scope,
            updatedAt: now,
            updatedBy: actor.accountId,
          },
          $inc: { version: 1 },
          $setOnInsert: { accountId },
        },
        { upsert: true, new: true, runValidators: true },
      )
      .lean<AccountGrantDocument>()
      .exec();

    const grant = toGrant(updated);
    await this.audit.record({
      action: AUDIT_ACTIONS.grantUpdated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'accountGrant', id: accountId },
      changes: buildChangeSummary(
        before
          ? {
              roleKeys: before.roleKeys,
              deniedPermissions: before.deniedPermissions,
              scope: before.scope,
            }
          : undefined,
        {
          roleKeys: grant.roleKeys,
          deniedPermissions: grant.deniedPermissions,
          scope: grant.scope,
        },
      ),
      context,
    });
    return grant;
  }

  /**
   * Build the actor context for an account from stored grants (SEC-025, SEC-032).
   *
   * Read on every request, so a grant change is effective immediately — no cache, therefore nothing to
   * invalidate. An account with no grant record gets **no permissions**: default deny.
   */
  async resolveActor(accountId: string): Promise<ActorContext | undefined> {
    assertSafeFilter({ accountId });
    const grant = await this.grants.findOne({ accountId }).lean<AccountGrantDocument>().exec();
    if (!grant) return undefined;
    const roles = await this.roles
      .find({ key: { $in: grant.roleKeys } })
      .lean<RoleDocument[]>()
      .exec();
    const permissions = resolvePermissions(
      roles.map((role) => ({ key: role.key, permissions: role.permissions as Permission[] })),
      grant.roleKeys,
      grant.deniedPermissions as Permission[],
    );
    return ActorContextSchema.parse({
      accountId: grant.accountId,
      kind: 'account',
      roleKeys: grant.roleKeys,
      permissions,
      deniedPermissions: grant.deniedPermissions,
      scope: grant.scope,
      grantVersion: grant.version,
    });
  }

  /** Exposed for documentation and tests: which permissions are administrative (SEC-023). */
  static administrativePermissions(): readonly Permission[] {
    return ADMINISTRATIVE_PERMISSIONS;
  }
}
