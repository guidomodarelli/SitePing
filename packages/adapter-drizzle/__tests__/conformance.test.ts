import { testBeezpingStore } from "@beezping/core/testing";
import { afterAll, beforeAll, describe } from "vitest";
import { type AnyLibSQLDatabase, createLibSQLBeezpingStore } from "../src/libsql/index.js";
import { type AnyPgDatabase, createPgBeezpingStore } from "../src/pg/index.js";
import {
  createLibSQLTestDatabase,
  createPgTestDatabase,
  type TestDatabase,
  withoutInteractiveTransactions,
} from "./databases.js";

// The shared BeezpingStore contract, run against both real engines.
// Warnings (inline screenshots) are expected here and silenced.
const silentLogger = { warn: () => {} };

describe("PostgreSQL (PGlite)", () => {
  let database: TestDatabase<AnyPgDatabase>;
  beforeAll(async () => {
    database = await createPgTestDatabase();
  });
  afterAll(() => database.close());

  testBeezpingStore(async () => {
    await database.reset();
    return createPgBeezpingStore(database.db, { logger: silentLogger });
  });
});

// Neon HTTP (and any driver without interactive transactions) must satisfy
// the whole contract too — every write is a single statement.
describe("PostgreSQL without interactive transactions (Neon HTTP semantics)", () => {
  let database: TestDatabase<AnyPgDatabase>;
  beforeAll(async () => {
    database = await createPgTestDatabase();
  });
  afterAll(() => database.close());

  testBeezpingStore(async () => {
    await database.reset();
    return createPgBeezpingStore(withoutInteractiveTransactions(database.db), { logger: silentLogger });
  });
});

describe("libSQL (Turso)", () => {
  let database: TestDatabase<AnyLibSQLDatabase>;
  beforeAll(async () => {
    database = await createLibSQLTestDatabase();
  });
  afterAll(() => database.close());

  testBeezpingStore(async () => {
    await database.reset();
    return createLibSQLBeezpingStore(database.db, { logger: silentLogger });
  });
});
