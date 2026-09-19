import type { MongoHealth } from '@alola/contracts';
import type { Logger } from '@alola/security';
import mongoose, { type Connection } from 'mongoose';

/**
 * MongoDB connection with fail-safe behavior and transaction capability detection (PLAT-014).
 *
 * - Not configured → reports `not_configured`; the API still starts (ADR-0012).
 * - Unreachable → reports `down` with a stable code; logs guidance, never the connection string.
 * - Reachable without a replica set → reports `transactions: false`, because a standalone server
 *   accepts connections but silently cannot run transactions.
 */
export function configureMongoose(): void {
  // Queries on unknown fields fail instead of being ignored; writes of unknown fields throw.
  mongoose.set('strictQuery', 'throw');
  mongoose.set('strict', 'throw');
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
}

export interface MongoSettings {
  uri: string | undefined;
  dbName: string | undefined;
}

export class MongoConnector {
  private connection: Connection | undefined;
  private transactions: boolean | undefined;

  constructor(
    private readonly settings: MongoSettings,
    private readonly logger: Logger,
  ) {}

  get configured(): boolean {
    return Boolean(this.settings.uri && this.settings.dbName);
  }

  get db(): Connection | undefined {
    return this.connection;
  }

  async connect(): Promise<void> {
    if (!this.configured) {
      this.logger.warn(
        { service: 'mongodb', code: 'MONGODB_URI_NOT_SET' },
        'MongoDB is not configured (MONGODB_URI, MONGODB_DB_NAME). The API runs without a database; ' +
          'readiness reports not_configured. See docs/architecture/environments.md.',
      );
      return;
    }
    try {
      const connection = mongoose.createConnection(this.settings.uri as string, {
        dbName: this.settings.dbName,
        serverSelectionTimeoutMS: 5000,
        appName: 'alola-api',
      });
      await connection.asPromise();
      this.connection = connection;
      const hello = (await connection.db?.admin().command({ hello: 1 })) as
        { setName?: string; msg?: string } | undefined;
      this.transactions = Boolean(hello?.setName) || hello?.msg === 'isdbgrid';
      if (this.transactions) {
        this.logger.info({ service: 'mongodb' }, 'MongoDB connected; transactions available');
      } else {
        this.logger.warn(
          { service: 'mongodb', code: 'MONGODB_NO_REPLICA_SET' },
          'MongoDB connected but is not a replica set: transactions are unavailable, so holds, ' +
            'reservations, and postings cannot be verified. Use the Atlas development cluster (ADR-0018).',
        );
      }
    } catch (error) {
      // Log the error class only: driver messages can echo host details from the connection string.
      this.logger.error(
        {
          service: 'mongodb',
          code: 'MONGODB_UNREACHABLE',
          errorName: error instanceof Error ? error.name : 'unknown',
        },
        'MongoDB is unreachable. Check MONGODB_URI, network access, and the Atlas IP allow-list. ' +
          'See docs/architecture/environments.md.',
      );
    }
  }

  async health(): Promise<MongoHealth> {
    if (!this.configured) return { status: 'not_configured', code: 'MONGODB_URI_NOT_SET' };
    if (!this.connection?.db) return { status: 'down', code: 'MONGODB_UNREACHABLE' };
    try {
      await this.connection.db.admin().command({ ping: 1 });
      return { status: 'up', transactions: this.transactions ?? false };
    } catch {
      return { status: 'down', code: 'MONGODB_UNREACHABLE' };
    }
  }

  async close(): Promise<void> {
    await this.connection?.close();
  }
}
