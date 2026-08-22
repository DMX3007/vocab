import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { PlanId } from '../entitlements/plans.config';

// Loaded via require() rather than a static `import ... from 'node:sqlite'`:
// Vite/vite-node's builtin-module list doesn't yet recognize this still-
// experimental core module, so a static import gets treated as a bare
// package specifier and fails to resolve under the test runner. A runtime
// require sidesteps that — this is real Node either way, just not
// statically analyzed. (The type-only import above IS static and fine —
// .d.ts resolution isn't affected by this, only the value import was.)
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export interface LicenseRecord {
  id: string;
  key: string;
  email: string;
  plan: PlanId;
  source: string; // 'kofi', 'coinbase', 'manual', ...
  sourceTransactionId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const newId = (): string => crypto.randomUUID();

/**
 * Durable license storage. Deliberately a single hand-rolled SQLite table
 * rather than an ORM+hosted-Postgres setup — at indie/donation volume a
 * file-backed DB on a single instance is plenty, and it means this whole
 * feature needs zero external database account to build or test. Swapping
 * this for Prisma+Postgres later (if volume or multi-instance scaling ever
 * demands it) only touches this one file — callers only see LicenseRecord.
 */
export class LicenseStore {
  private db: DatabaseSyncType;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS licenses (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        plan TEXT NOT NULL,
        source TEXT NOT NULL,
        source_transaction_id TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      )
    `);
  }

  insert(input: Omit<LicenseRecord, 'id' | 'createdAt' | 'revokedAt'>, now: Date): LicenseRecord {
    const record: LicenseRecord = {
      id: newId(),
      ...input,
      createdAt: now.toISOString(),
      revokedAt: null,
    };
    this.db
      .prepare(
        'INSERT INTO licenses (id, key, email, plan, source, source_transaction_id, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        record.id,
        record.key,
        record.email,
        record.plan,
        record.source,
        record.sourceTransactionId,
        record.createdAt,
        record.revokedAt,
      );
    return record;
  }

  findByKey(key: string): LicenseRecord | null {
    const row = this.db.prepare('SELECT * FROM licenses WHERE key = ?').get(key) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  /** Was this Ko-fi/Coinbase transaction already turned into a license? Makes
   *  webhook delivery retries (both providers retry on a non-2xx response)
   *  safe to replay without minting a second key for the same purchase. */
  findBySourceTransaction(source: string, sourceTransactionId: string): LicenseRecord | null {
    const row = this.db
      .prepare('SELECT * FROM licenses WHERE source = ? AND source_transaction_id = ?')
      .get(source, sourceTransactionId) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  revoke(key: string, now: Date): void {
    this.db.prepare('UPDATE licenses SET revoked_at = ? WHERE key = ?').run(now.toISOString(), key);
  }

  close(): void {
    this.db.close();
  }

  private rowToRecord(row: Record<string, unknown>): LicenseRecord {
    return {
      id: row.id as string,
      key: row.key as string,
      email: row.email as string,
      plan: row.plan as PlanId,
      source: row.source as string,
      sourceTransactionId: (row.source_transaction_id as string | null) ?? null,
      createdAt: row.created_at as string,
      revokedAt: (row.revoked_at as string | null) ?? null,
    };
  }
}
