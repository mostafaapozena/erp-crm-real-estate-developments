import type { Connection } from 'mongoose';

/**
 * A record of exactly what the demonstration seed created.
 *
 * Without it, "reset the demo data" has to mean "delete everything that looks like demo data", and a
 * guess like that eventually deletes something a person entered by hand while preparing for the
 * meeting. The ledger makes the reset exact: it removes the documents whose ids it wrote down, and
 * nothing else.
 *
 * It is also how the seed stays idempotent. A second run looks up each seed key, finds the id it
 * created last time, and reuses it — so reruns do not duplicate a project, a lead, or a contract.
 *
 * The collection belongs to the seed script, not to any domain module, which is why it is declared
 * here rather than under `apps/api/src/modules` (ADR-0001).
 */
export const LEDGER_COLLECTION = 'demoSeedLedger';

export interface LedgerEntry {
  /** Stable, human-meaningful key chosen by the seed, e.g. `unit:OASIS-A-0301`. */
  seedKey: string;
  /** The collection the record lives in, so the reset needs no knowledge of the domain modules. */
  collection: string;
  /** The business identifier field and value, e.g. `{ field: 'unitId', value: 'unt_…' }`. */
  field: string;
  value: string;
  createdAt: Date;
}

export class SeedLedger {
  private cache: Map<string, LedgerEntry> | undefined;

  constructor(private readonly connection: Connection) {}

  private get collection() {
    return this.connection.collection<LedgerEntry>(LEDGER_COLLECTION);
  }

  /** Loads the whole ledger once. It is small — hundreds of rows — and every lookup then costs nothing. */
  async load(): Promise<void> {
    const rows = await this.collection.find({}).toArray();
    this.cache = new Map(rows.map((row) => [row.seedKey, row]));
  }

  private entries(): Map<string, LedgerEntry> {
    if (!this.cache) throw new Error('SeedLedger.load() must be called before use');
    return this.cache;
  }

  existing(seedKey: string): string | undefined {
    return this.entries().get(seedKey)?.value;
  }

  async remember(
    seedKey: string,
    collection: string,
    field: string,
    value: string,
  ): Promise<string> {
    const entry: LedgerEntry = { seedKey, collection, field, value, createdAt: new Date() };
    await this.collection.updateOne({ seedKey }, { $set: entry }, { upsert: true });
    this.entries().set(seedKey, entry);
    return value;
  }

  /**
   * Create once, reuse forever.
   *
   * `create` runs only when the key is unknown. Everything the seed writes goes through here, which is
   * what makes a second run a no-op rather than a second copy of the demonstration.
   */
  async ensure(
    seedKey: string,
    collection: string,
    field: string,
    create: () => Promise<string>,
  ): Promise<{ value: string; created: boolean }> {
    const found = this.existing(seedKey);
    if (found) return { value: found, created: false };
    const value = await create();
    await this.remember(seedKey, collection, field, value);
    return { value, created: true };
  }

  all(): LedgerEntry[] {
    return [...this.entries().values()];
  }

  async clear(): Promise<void> {
    await this.collection.deleteMany({});
    this.cache = new Map();
  }
}

/** What the seed reports at the end: how much it created, and how much was already there. */
export type Counter = Record<string, { created: number; existing: number }>;

export function tally(counts: Counter, kind: string, created: boolean): void {
  const row = (counts[kind] ??= { created: 0, existing: 0 });
  if (created) row.created += 1;
  else row.existing += 1;
}
