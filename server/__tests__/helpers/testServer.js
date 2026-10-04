/** @jest-environment node */
import request from 'supertest';
import prisma from '../../utils/prismaClient.js';
import { createApp } from '../../app.js';
import { assertTestDatabaseSelected } from './testDatabase.js';

// Create a single app instance for all tests that use this helper.
const app = createApp();

/**
 * makeAgent()
 *
 * Returns both the shared app instance (from app.js) and
 * a supertest agent with cookie support. Tests that call
 * makeAgent().agent can now hit ALL real routes:
 *   - /auth/*
 *   - /rooms, /chatrooms
 *   - /messages
 *   - /uploads
 *   - etc.
 */
export function makeAgent() {
  return {
    app,
    agent: request.agent(app),
  };
}

/**
 * Clear the selected disposable test schema atomically, preserving migrations.
 * No swallowed errors or incomplete table lists. Never use with a live DB.
 */
export async function resetDb() {
  const target = assertTestDatabaseSelected();
  await prisma.$transaction(async (tx) => {
    const [connected] = await tx.$queryRaw`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    if (connected?.database !== target.database || connected?.schema !== target.schema) {
      throw new Error('Connected database/schema does not match the selected disposable test target');
    }
    const tables = await tx.$queryRaw`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = ${target.schema}
        AND tablename <> '_prisma_migrations'
      ORDER BY tablename
    `;
    if (!tables.length) throw new Error('Test schema has no tables; apply migrations first');
    const quote = (value) => '"' + value.replace(/"/g, '""') + '"';
    const names = tables.map(({ tablename }) => `${quote(target.schema)}.${quote(tablename)}`);
    // Identifiers come from the PostgreSQL catalog and are quoted above.
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`);
  });
}
