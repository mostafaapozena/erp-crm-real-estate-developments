import type { ClientSession, Connection } from 'mongoose';

/**
 * Multi-document transactions (PLAT-014, ADR-0002).
 *
 * Used where a state change and its evidence must land together: an approval decision, the stage counter
 * it satisfies, and the audit record of it are one fact, and a crash between them would leave either an
 * unexplained state or a decision nobody can see.
 *
 * The local development deployment is a single-node replica set precisely so this works
 * ([ADR-0020](../../../../docs/decisions/adr-0020-local-docker-development-services.md)); readiness
 * reports `transactions` so a standalone server is visible rather than silently lossy.
 */
export class TransactionsUnavailableError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE';

  constructor(cause?: unknown) {
    super(
      'This operation needs a multi-document transaction, which requires a replica set. ' +
        'See docs/architecture/environments.md.',
    );
    this.name = 'TransactionsUnavailableError';
    if (cause instanceof Error) this.cause = cause;
  }
}

/** MongoDB reports a transaction attempted against a standalone server with this code. */
const ILLEGAL_OPERATION = 20;

function isTransactionsUnsupported(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  const message = error instanceof Error ? error.message : '';
  return code === ILLEGAL_OPERATION || /replica set member or mongos/i.test(message);
}

/**
 * Run `work` inside one transaction, committing on success and aborting on any throw.
 *
 * The callback receives the session and **must** pass it to every read and write it makes; a query without
 * it silently runs outside the transaction, which is the one failure mode worth stating out loud.
 *
 * `withTransaction` may run the callback more than once when MongoDB reports a transient error, so the
 * callback must be safe to retry: it may not mutate state outside the session or depend on having run once.
 */
export async function withTransaction<T>(
  connection: Connection,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result: T | undefined;
    let ran = false;
    await session.withTransaction(async () => {
      result = await work(session);
      ran = true;
    });
    if (!ran) throw new Error('Transaction callback did not run.');
    return result as T;
  } catch (error) {
    if (isTransactionsUnsupported(error)) throw new TransactionsUnavailableError(error);
    throw error;
  } finally {
    await session.endSession();
  }
}
