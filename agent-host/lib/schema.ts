import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ACTIVE_RUN_STATUSES,
  ORCHESTRATION_SCHEMA_VERSION,
  SQLITE_READONLY_TIMEOUT_MS,
  SQLITE_TIMEOUT_MS,
  OrchestrationError,
  type OrchestrationMetaRecord,
} from './orchestrationTypes.ts';

const TABLE_NAMES = ['meta', 'runs', 'tasks', 'task_dependencies', 'attempts', 'events'] as const;
const TRIGGER_NAMES = ['events_immutable_before_update', 'events_immutable_before_delete'] as const;

export interface OrchestrationDatabaseInspection {
  database: 'absent' | 'ready' | 'schema-newer' | 'corrupt';
  schemaVersion: number | null;
  runCount: number;
  activeRunCount: number;
}

export interface WriterDatabaseContext {
  db: DatabaseSync;
  bootstrapped: boolean;
}

interface SchemaValidationResult {
  userVersion: number;
  meta: OrchestrationMetaRecord;
}

function getSingleNumber(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : undefined;
  if (typeof value !== 'number') {
    throw new OrchestrationError('SCHEMA_CORRUPT', `Expected numeric result for: ${sql}`);
  }
  return value;
}

function getSingleString(db: DatabaseSync, sql: string): string {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : undefined;
  if (typeof value !== 'string') {
    throw new OrchestrationError('SCHEMA_CORRUPT', `Expected string result for: ${sql}`);
  }
  return value;
}

function getObjectMap(db: DatabaseSync): Map<string, { type: string; sql: string | null }> {
  const rows = db
    .prepare(
      `
        SELECT name, type, sql
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
      `,
    )
    .all() as Array<{ name: string; type: string; sql: string | null }>;

  return new Map(rows.map((row) => [row.name, { type: row.type, sql: row.sql }]));
}

function hasAnySchemaObjects(db: DatabaseSync): boolean {
  return getSingleNumber(
    db,
    `
      SELECT COUNT(*)
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
    `,
  ) > 0;
}

function getStrictTableMap(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare(`PRAGMA table_list`).all() as Array<{ name: string; strict: number }>;
  const strictTableMap = new Map<string, number>();

  for (const row of rows) {
    strictTableMap.set(row.name, row.strict);
  }

  return strictTableMap;
}

function validateMetaRow(value: unknown): OrchestrationMetaRecord {
  if (!value || typeof value !== 'object') {
    throw new OrchestrationError('SCHEMA_CORRUPT', 'meta row is missing.');
  }

  const meta = value as Record<string, unknown>;
  if (
    typeof meta.schemaVersion !== 'number' ||
    typeof meta.repoKey !== 'string' ||
    typeof meta.createdAt !== 'string' ||
    typeof meta.createdByHostId !== 'string' ||
    typeof meta.createdByHostVersion !== 'string'
  ) {
    throw new OrchestrationError('SCHEMA_CORRUPT', 'meta row is malformed.');
  }

  return {
    schemaVersion: meta.schemaVersion,
    repoKey: meta.repoKey,
    createdAt: meta.createdAt,
    createdByHostId: meta.createdByHostId,
    createdByHostVersion: meta.createdByHostVersion,
  };
}

function validateSchema(db: DatabaseSync, repoKey: string): SchemaValidationResult {
  const userVersion = getSingleNumber(db, 'PRAGMA user_version');
  if (userVersion > ORCHESTRATION_SCHEMA_VERSION) {
    throw new OrchestrationError(
      'SCHEMA_NEWER',
      `Orchestration schema ${userVersion} is newer than supported version ${ORCHESTRATION_SCHEMA_VERSION}.`,
    );
  }

  if (userVersion !== ORCHESTRATION_SCHEMA_VERSION) {
    throw new OrchestrationError(
      'SCHEMA_CORRUPT',
      `Unsupported orchestration schema version ${userVersion}.`,
    );
  }

  const objectMap = getObjectMap(db);
  const strictTableMap = getStrictTableMap(db);

  for (const tableName of TABLE_NAMES) {
    const object = objectMap.get(tableName);
    if (!object || object.type !== 'table') {
      throw new OrchestrationError('SCHEMA_CORRUPT', `Missing table ${tableName}.`);
    }
    if (strictTableMap.get(tableName) !== 1) {
      throw new OrchestrationError('SCHEMA_CORRUPT', `Table ${tableName} must be STRICT.`);
    }
  }

  for (const triggerName of TRIGGER_NAMES) {
    const object = objectMap.get(triggerName);
    if (!object || object.type !== 'trigger') {
      throw new OrchestrationError('SCHEMA_CORRUPT', `Missing trigger ${triggerName}.`);
    }
  }

  const metaRowCount = getSingleNumber(db, 'SELECT COUNT(*) FROM meta');
  if (metaRowCount !== 1) {
    throw new OrchestrationError('SCHEMA_CORRUPT', 'meta table must contain exactly one row.');
  }

  const meta = validateMetaRow(
    db.prepare(
      `
        SELECT schemaVersion, repoKey, createdAt, createdByHostId, createdByHostVersion
        FROM meta
        WHERE rowId = 1
      `,
    ).get(),
  );

  if (meta.schemaVersion !== userVersion) {
    throw new OrchestrationError('SCHEMA_CORRUPT', 'meta schemaVersion does not match PRAGMA user_version.');
  }

  if (meta.repoKey !== repoKey) {
    throw new OrchestrationError('SCHEMA_CORRUPT', 'meta repoKey does not match the expected repository key.');
  }

  return { userVersion, meta };
}

function configureWriterPragmas(db: DatabaseSync): void {
  db.exec(`PRAGMA busy_timeout = ${SQLITE_TIMEOUT_MS}`);
  db.exec('PRAGMA foreign_keys = ON');
  const journalMode = getSingleString(db, "PRAGMA journal_mode = WAL");
  if (journalMode.toLowerCase() !== 'wal') {
    throw new OrchestrationError('SCHEMA_CORRUPT', `Unable to set journal_mode to WAL (got ${journalMode}).`);
  }
  db.exec('PRAGMA synchronous = FULL');
}

function createVersionOneSchema(db: DatabaseSync, options: {
  repoKey: string;
  hostId: string;
  hostVersion: string;
  createdAt: string;
}): void {
  db.exec('BEGIN IMMEDIATE');

  try {
    db.exec(`
      CREATE TABLE meta (
        rowId INTEGER PRIMARY KEY CHECK (rowId = 1),
        schemaVersion INTEGER NOT NULL,
        repoKey TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        createdByHostId TEXT NOT NULL,
        createdByHostVersion TEXT NOT NULL
      ) STRICT;

      CREATE TABLE runs (
        runId TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT
      ) STRICT;

      CREATE TABLE tasks (
        taskId TEXT PRIMARY KEY,
        runId TEXT NOT NULL REFERENCES runs(runId),
        title TEXT NOT NULL,
        goal TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'blocked', 'cancelled')),
        position INTEGER NOT NULL,
        spec TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT
      ) STRICT;

      CREATE TABLE task_dependencies (
        taskId TEXT NOT NULL REFERENCES tasks(taskId),
        dependsOnTaskId TEXT NOT NULL REFERENCES tasks(taskId),
        createdAt TEXT NOT NULL,
        PRIMARY KEY (taskId, dependsOnTaskId),
        CHECK (taskId <> dependsOnTaskId)
      ) STRICT;

      CREATE TABLE attempts (
        attemptId TEXT PRIMARY KEY,
        taskId TEXT NOT NULL REFERENCES tasks(taskId),
        ordinal INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'interrupted', 'cancelled')),
        hostInstanceId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        endedAt TEXT,
        UNIQUE (taskId, ordinal)
      ) STRICT;

      CREATE TABLE events (
        seq INTEGER PRIMARY KEY,
        eventId TEXT NOT NULL UNIQUE,
        runId TEXT NOT NULL REFERENCES runs(runId),
        taskId TEXT REFERENCES tasks(taskId),
        attemptId TEXT REFERENCES attempts(attemptId),
        type TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        payload TEXT
      ) STRICT;

      CREATE TRIGGER events_immutable_before_update
      BEFORE UPDATE ON events
      BEGIN
        SELECT RAISE(ABORT, 'events are immutable');
      END;

      CREATE TRIGGER events_immutable_before_delete
      BEFORE DELETE ON events
      BEGIN
        SELECT RAISE(ABORT, 'events are immutable');
      END;
    `);

    db.prepare(
      `
        INSERT INTO meta (
          rowId,
          schemaVersion,
          repoKey,
          createdAt,
          createdByHostId,
          createdByHostVersion
        ) VALUES (1, ?, ?, ?, ?, ?)
      `,
    ).run(
      ORCHESTRATION_SCHEMA_VERSION,
      options.repoKey,
      options.createdAt,
      options.hostId,
      options.hostVersion,
    );

    db.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openOrchestrationWriterDatabase(options: {
  dbPath: string;
  repoKey: string;
  hostId: string;
  hostVersion: string;
  now: () => string;
}): WriterDatabaseContext {
  mkdirSync(path.dirname(options.dbPath), { recursive: true });
  const fileExists = existsSync(options.dbPath);
  const db = new DatabaseSync(options.dbPath, {
    timeout: SQLITE_TIMEOUT_MS,
    allowExtension: false,
  });

  let bootstrapped = false;

  try {
    db.exec(`PRAGMA busy_timeout = ${SQLITE_TIMEOUT_MS}`);

    if (!fileExists) {
      configureWriterPragmas(db);
      createVersionOneSchema(db, {
        repoKey: options.repoKey,
        hostId: options.hostId,
        hostVersion: options.hostVersion,
        createdAt: options.now(),
      });
      bootstrapped = true;
    } else {
      const userVersion = getSingleNumber(db, 'PRAGMA user_version');
      if (userVersion === 0) {
        if (!hasAnySchemaObjects(db)) {
          configureWriterPragmas(db);
          createVersionOneSchema(db, {
            repoKey: options.repoKey,
            hostId: options.hostId,
            hostVersion: options.hostVersion,
            createdAt: options.now(),
          });
          bootstrapped = true;
        } else {
          throw new OrchestrationError('SCHEMA_CORRUPT', 'Existing orchestration database has incomplete schema.');
        }
      }
    }

    validateSchema(db, options.repoKey);
    configureWriterPragmas(db);
    validateSchema(db, options.repoKey);

    return { db, bootstrapped };
  } catch (error) {
    db.close();
    if (error instanceof OrchestrationError) {
      throw error;
    }
    throw new OrchestrationError('SCHEMA_CORRUPT', 'Failed to open orchestration database.', { cause: error });
  }
}

export function inspectOrchestrationDatabase(options: {
  dbPath: string;
  repoKey: string;
}): OrchestrationDatabaseInspection {
  if (!existsSync(options.dbPath)) {
    return {
      database: 'absent',
      schemaVersion: null,
      runCount: 0,
      activeRunCount: 0,
    };
  }

  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(options.dbPath, {
      readOnly: true,
      timeout: SQLITE_READONLY_TIMEOUT_MS,
      allowExtension: false,
    });
    db.exec(`PRAGMA busy_timeout = ${SQLITE_READONLY_TIMEOUT_MS}`);

    const userVersion = getSingleNumber(db, 'PRAGMA user_version');
    if (userVersion > ORCHESTRATION_SCHEMA_VERSION) {
      return {
        database: 'schema-newer',
        schemaVersion: userVersion,
        runCount: 0,
        activeRunCount: 0,
      };
    }

    validateSchema(db, options.repoKey);

    const runCount = getSingleNumber(db, 'SELECT COUNT(*) FROM runs');
    const activeRunCount = db
      .prepare(
        `
          SELECT COUNT(*)
          FROM runs
          WHERE status IN (?, ?, ?)
        `,
      )
      .get(...ACTIVE_RUN_STATUSES) as { [key: string]: number };

    return {
      database: 'ready',
      schemaVersion: userVersion,
      runCount,
      activeRunCount: Object.values(activeRunCount)[0] ?? 0,
    };
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'SCHEMA_NEWER') {
      return {
        database: 'schema-newer',
        schemaVersion: ORCHESTRATION_SCHEMA_VERSION + 1,
        runCount: 0,
        activeRunCount: 0,
      };
    }

    return {
      database: 'corrupt',
      schemaVersion: null,
      runCount: 0,
      activeRunCount: 0,
    };
  } finally {
    db?.close();
  }
}
