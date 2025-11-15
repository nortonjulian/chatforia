/** @jest-environment node */
import request from 'supertest';
import prisma from '../../utils/prismaClient.js';
import { createApp } from '../../app.js';

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
 * resetDb()
 *
 * Blow away all data between tests.
 * Order matters because of foreign keys.
 *
 * We try/catch each block because some projects' Prisma
 * schemas don't have all of these tables or have slightly
 * different relation requirements. This keeps tests from
 * crashing if, for example, `messageReaction` doesn't exist.
 */
export async function resetDb() {
  // Child / leaf tables first (things that depend on messages/users/rooms)
  try {
    await prisma.messageReaction?.deleteMany?.({});
  } catch {}
  try {
    await prisma.attachment?.deleteMany?.({});
  } catch {}

  try {
    await prisma.message.deleteMany({});
  } catch {}

  try {
    await prisma.participant.deleteMany({});
  } catch {}

  try {
    await prisma.contact?.deleteMany?.({});
  } catch {}

  try {
    await prisma.event?.deleteMany?.({});
  } catch {}

  // Then parent tables
  try {
    await prisma.chatRoom.deleteMany({});
  } catch {}

  // Finally users last (everything tends to reference User)
  try {
    await prisma.user.deleteMany({});
  } catch {}
}
