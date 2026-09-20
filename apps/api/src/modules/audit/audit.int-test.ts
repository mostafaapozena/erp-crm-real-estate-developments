import {
  AUDIT_ACTIONS,
  ActorContextSchema,
  AuditQuerySchema,
  type ActorContext,
  type AuditQuery,
} from '@alola/contracts';
import { createLogger, UnsafeFilterError } from '@alola/security';
import { serviceGate } from '@alola/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { configureMongoose } from '../../platform/mongo';
import { ensureIndexes } from '../../platform/indexes';
import { AUDIT_COLLECTION, AuditImmutableError, auditModel } from './model';
import { AuditService, AuditWriteError } from './service';

/**
 * Audit subsystem against a real MongoDB replica set (AUDIT-001 … AUDIT-006).
 * Skipped — and reported as skipped — when the development services are not configured.
 */
const gate = serviceGate(['mongodb']);
const logger = createLogger({ name: 'audit-int', level: 'silent' });

/** Everything this run creates is prefixed, so cleanup removes only its own records. */
const RUN = `it-audit-${Date.now()}`;
const OWNER = `${RUN}-owner`;
const OTHER = `${RUN}-other`;

function actor(overrides: Partial<z.input<typeof ActorContextSchema>> = {}): ActorContext {
  return ActorContextSchema.parse({
    accountId: OWNER,
    permissions: ['audit.view', 'audit.viewChanges', 'audit.viewContext'],
    scope: { level: 'self' },
    ...overrides,
  });
}

const query = (overrides: Partial<z.input<typeof AuditQuerySchema>> = {}): AuditQuery =>
  AuditQuerySchema.parse({ ...overrides });

describe.skipIf(!gate.available)(`audit subsystem — ${gate.reason}`, () => {
  let connection: Connection;
  let service: AuditService;
  let recordedWrites = 0;

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'],
      serverSelectionTimeoutMS: 10_000,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    service = new AuditService({
      connection,
      logger,
      onRecorded: () => {
        recordedWrites += 1;
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    // Cleanup uses the raw driver deliberately: the application has no delete path (AUDIT-001), so a
    // test can only remove its own records the way a privileged operator would — which is exactly the
    // documented limitation of application-level immutability.
    await connection.db?.collection(AUDIT_COLLECTION).deleteMany({
      $or: [
        { 'actor.accountId': { $regex: `^${RUN}` } },
        { 'context.correlationId': { $regex: `^${RUN}` } },
      ],
    });
    await connection.close();
  });

  async function append(overrides: Partial<Parameters<AuditService['record']>[0]> = {}) {
    return service.record({
      action: AUDIT_ACTIONS.grantUpdated,
      outcome: 'succeeded',
      actor: { kind: 'account', accountId: OWNER, roleKeys: [`${RUN}-role`] },
      target: { type: 'accountGrant', id: `${RUN}-target` },
      context: {
        correlationId: `${RUN}-corr`,
        ip: '203.0.113.5',
        userAgent: 'vitest',
        method: 'PUT',
      },
      ...overrides,
    });
  }

  describe('AUDIT-002: complete records in UTC', () => {
    it('stores actor, action, target, context, correlation ID, and a UTC timestamp', async () => {
      const before = Date.now();
      const event = await append({
        changes: [{ path: 'roleKeys', from: 'a', to: 'b' }],
        reason: 'integration check',
        provider: { name: 'meta', requestId: 'req-1' },
      });

      expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(event.action).toBe(AUDIT_ACTIONS.grantUpdated);
      expect(event.outcome).toBe('succeeded');
      expect(event.actor).toMatchObject({ kind: 'account', accountId: OWNER });
      expect(event.target).toEqual({ type: 'accountGrant', id: `${RUN}-target` });
      expect(event.context.correlationId).toBe(`${RUN}-corr`);
      expect(event.reason).toBe('integration check');
      expect(event.provider).toEqual({ name: 'meta', requestId: 'req-1' });
      expect(event.schemaVersion).toBe(1);

      // UTC: the stored value is a Date, and the contract renders it as an ISO-8601 Z instant.
      expect(event.occurredAt).toMatch(/Z$/);
      const stored = await connection.db
        ?.collection(AUDIT_COLLECTION)
        .findOne({ eventId: event.eventId });
      expect(stored?.['occurredAt']).toBeInstanceOf(Date);
      expect((stored?.['occurredAt'] as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('rejects a malformed action instead of storing it', async () => {
      await expect(append({ action: 'NotAnAction' })).rejects.toThrow();
    });

    it('signals every successful append so mutations can be verified as audited (AUDIT-003)', async () => {
      const before = recordedWrites;
      await append();
      expect(recordedWrites).toBe(before + 1);
    });
  });

  describe('AUDIT-001: append-only', () => {
    it('refuses every mutating model operation and leaves the record intact', async () => {
      const event = await append({ reason: 'immutability check' });
      const model = auditModel(connection);
      const filter = { eventId: event.eventId };

      await expect(model.updateOne(filter, { $set: { reason: 'tampered' } })).rejects.toThrow(
        AuditImmutableError,
      );
      await expect(model.updateMany(filter, { $set: { reason: 'tampered' } })).rejects.toThrow(
        AuditImmutableError,
      );
      await expect(
        model.findOneAndUpdate(filter, { $set: { reason: 'tampered' } }),
      ).rejects.toThrow(AuditImmutableError);
      await expect(model.replaceOne(filter, { ...event, reason: 'tampered' })).rejects.toThrow(
        AuditImmutableError,
      );
      await expect(model.deleteOne(filter)).rejects.toThrow(AuditImmutableError);
      await expect(model.deleteMany(filter)).rejects.toThrow(AuditImmutableError);
      await expect(model.findOneAndDelete(filter)).rejects.toThrow(AuditImmutableError);
      await expect(model.bulkWrite([{ deleteOne: { filter } }])).rejects.toThrow(
        AuditImmutableError,
      );

      const document = await model.findOne(filter).lean().exec();
      expect(document?.reason).toBe('immutability check');
    });

    it('refuses to edit and re-save an existing document', async () => {
      const event = await append({ reason: 'resave check' });
      const model = auditModel(connection);

      // Editing a field fails on the immutable path itself, before the save hook is reached.
      const edited = await model.findOne({ eventId: event.eventId }).exec();
      expect(edited).not.toBeNull();
      edited!.set('reason', 'tampered');
      await expect(edited!.save()).rejects.toThrow(/immutable/i);

      // Re-saving an untouched document is refused by the append-only hook.
      const untouched = await model.findOne({ eventId: event.eventId }).exec();
      await expect(untouched!.save()).rejects.toThrow(AuditImmutableError);

      const stored = await model.findOne({ eventId: event.eventId }).lean().exec();
      expect(stored?.reason).toBe('resave check');
    });

    it('documents the honest limit: a privileged operator with direct database access can still modify', async () => {
      // This is why the guarantee is described as application-level and no cryptographic immutability is
      // claimed. Operational controls (restricted database roles, append-only backups) cover this, and
      // they belong to SD-18 / Phase 9 hardening.
      const event = await append({ reason: 'dba-path' });
      const raw = connection.db?.collection(AUDIT_COLLECTION);
      const result = await raw?.updateOne(
        { eventId: event.eventId },
        { $set: { reason: 'edited' } },
      );
      expect(result?.modifiedCount).toBe(1);
      await raw?.deleteOne({ eventId: event.eventId });
      expect(await raw?.findOne({ eventId: event.eventId })).toBeNull();
    });
  });

  describe('indexes', () => {
    it('creates the declared indexes', async () => {
      const indexes = await connection.db?.collection(AUDIT_COLLECTION).indexes();
      const names = (indexes ?? []).map((index) => index.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'audit_eventId_unique',
          'audit_occurredAt_eventId',
          'audit_actor_occurredAt',
          'audit_target_occurredAt',
          'audit_action_occurredAt',
          'audit_outcome_occurredAt',
          'audit_correlationId',
        ]),
      );
      const unique = (indexes ?? []).find((index) => index.name === 'audit_eventId_unique');
      expect(unique?.unique).toBe(true);
    });
  });

  describe('querying: deterministic pagination, scope, and filters', () => {
    const pageRun = `${RUN}-page`;
    beforeAll(async () => {
      for (let i = 0; i < 5; i += 1) {
        await service.record({
          action: AUDIT_ACTIONS.auditRead,
          outcome: 'succeeded',
          actor: { kind: 'account', accountId: OWNER },
          target: { type: 'auditEvent', id: `${pageRun}-${i}` },
          context: { correlationId: `${pageRun}-corr` },
        });
      }
      // An event belonging to a different account, for cross-scope isolation.
      await service.record({
        action: AUDIT_ACTIONS.auditRead,
        outcome: 'succeeded',
        actor: { kind: 'account', accountId: OTHER },
        target: { type: 'auditEvent', id: `${pageRun}-other` },
        context: { correlationId: `${pageRun}-corr` },
      });
    });

    it('walks keyset pages without repeating or skipping rows', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await service.query(
          actor(),
          query({ limit: 2, correlationId: `${pageRun}-corr`, ...(cursor ? { cursor } : {}) }),
        );
        expect(page.limit).toBe(2);
        seen.push(...page.items.map((item) => item.eventId));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(5);
      expect(seen).toHaveLength(5);
    });

    it('orders by occurredAt then eventId, newest first', async () => {
      const page = await service.query(
        actor(),
        query({ limit: 10, correlationId: `${pageRun}-corr` }),
      );
      const keys = page.items.map((item) => `${item.occurredAt}|${item.eventId}`);
      expect([...keys].sort().reverse()).toEqual(keys);
    });

    it('excludes other accounts from items AND from the total (SEC-028)', async () => {
      const own = await service.query(
        actor(),
        query({ limit: 50, correlationId: `${pageRun}-corr` }),
      );
      expect(own.total).toBe(5);
      expect(own.items.every((item) => item.actor.accountId === OWNER)).toBe(true);

      const wide = await service.query(
        actor({ scope: { level: 'all' } }),
        query({ limit: 50, correlationId: `${pageRun}-corr` }),
      );
      expect(wide.total).toBe(6);
    });

    it('applies action, outcome, and time filters', async () => {
      const byAction = await service.query(
        actor({ scope: { level: 'all' } }),
        query({ action: AUDIT_ACTIONS.auditRead, correlationId: `${pageRun}-corr`, limit: 50 }),
      );
      expect(byAction.total).toBe(6);

      const byOutcome = await service.query(
        actor({ scope: { level: 'all' } }),
        query({ outcome: 'denied', correlationId: `${pageRun}-corr`, limit: 50 }),
      );
      expect(byOutcome.total).toBe(0);

      const future = new Date(Date.now() + 60_000).toISOString();
      const byTime = await service.query(
        actor({ scope: { level: 'all' } }),
        query({ occurredFrom: future, correlationId: `${pageRun}-corr`, limit: 50 }),
      );
      expect(byTime.total).toBe(0);
    });

    it('refuses operator objects smuggled into a filter', async () => {
      await expect(
        service.query(actor(), {
          ...query({ limit: 10 }),
          actorAccountId: { $ne: null } as unknown as string,
        }),
      ).rejects.toThrow(UnsafeFilterError);
    });

    it('returns nothing for a scope level it cannot resolve (fails closed)', async () => {
      const page = await service.query(
        actor({ scope: { level: 'branch', branchIds: ['branch-1'] } }),
        query({ limit: 50, correlationId: `${pageRun}-corr` }),
      );
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });
  });

  describe('AUDIT-006 and SEC-029: summaries and field restriction', () => {
    it('removes restricted fields from list, single read, and export alike', async () => {
      const event = await append({ changes: [{ path: 'scope.level', from: 'self', to: 'all' }] });
      const limited = actor({ permissions: ['audit.view', 'audit.export'] });

      const page = await service.query(limited, query({ limit: 50, correlationId: `${RUN}-corr` }));
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        expect('changes' in item).toBe(false);
        expect('ip' in item.context).toBe(false);
        expect('userAgent' in item.context).toBe(false);
      }

      const single = await service.findByEventId(limited, event.eventId);
      expect(single && 'changes' in single).toBe(false);

      const exported = await service.exportEvents(
        limited,
        query({ limit: 50, correlationId: `${RUN}-corr` }),
      );
      expect(exported.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(exported.rows)).not.toContain('203.0.113.5');

      // The entitled actor sees them.
      const full = await service.findByEventId(actor(), event.eventId);
      expect(full?.changes).toEqual([{ path: 'scope.level', from: 'self', to: 'all' }]);
      expect(full?.context.ip).toBe('203.0.113.5');
    });

    it('hides an out-of-scope record entirely, rather than reporting it exists (SEC-030)', async () => {
      const foreign = await service.record({
        action: AUDIT_ACTIONS.auditRead,
        outcome: 'succeeded',
        actor: { kind: 'account', accountId: OTHER },
        target: { type: 'auditEvent' },
        context: { correlationId: `${RUN}-corr` },
      });
      // Exists globally…
      expect(
        await service.findByEventId(actor({ scope: { level: 'all' } }), foreign.eventId),
      ).toBeDefined();
      // …but is simply absent for a self-scoped actor, which is what makes the API answer 404.
      expect(await service.findByEventId(actor(), foreign.eventId)).toBeUndefined();
    });
  });

  describe('AUDIT-005: authentication events', () => {
    it('records success, failure, and logout without storing a credential', async () => {
      const succeeded = await service.recordAuthenticationEvent({
        outcome: 'succeeded',
        accountId: OWNER,
        sessionId: `${RUN}-session`,
        correlationId: `${RUN}-corr`,
        ip: '203.0.113.5',
      });
      expect(succeeded.action).toBe(AUDIT_ACTIONS.authenticationSucceeded);
      expect(succeeded.actor.sessionId).toBe(`${RUN}-session`);

      const failed = await service.recordAuthenticationEvent({
        outcome: 'failed',
        event: 'failed',
        correlationId: `${RUN}-corr`,
        reason: 'invalid credentials',
      });
      expect(failed.action).toBe(AUDIT_ACTIONS.authenticationFailed);
      expect(failed.actor.kind).toBe('anonymous');
      expect(JSON.stringify(failed)).not.toMatch(/password|secret/i);

      const loggedOut = await service.recordAuthenticationEvent({
        outcome: 'succeeded',
        event: 'loggedOut',
        accountId: OWNER,
        correlationId: `${RUN}-corr`,
      });
      expect(loggedOut.action).toBe(AUDIT_ACTIONS.authenticationLoggedOut);
    });
  });

  describe('failure behaviour', () => {
    it('rethrows a write failure instead of losing the evidence quietly', async () => {
      const closed = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
        dbName: process.env['MONGODB_DB_NAME'],
        serverSelectionTimeoutMS: 5000,
      });
      await closed.asPromise();
      const failing = new AuditService({ connection: closed, logger });
      await closed.close();

      await expect(
        failing.record({
          action: AUDIT_ACTIONS.auditRead,
          outcome: 'succeeded',
          actor: { kind: 'system' },
          target: { type: 'auditEvent' },
          context: { correlationId: `${RUN}-corr` },
        }),
      ).rejects.toThrow(AuditWriteError);
    });
  });
});
