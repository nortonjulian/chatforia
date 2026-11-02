/** @jest-environment node */
import { test, expect } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';

test('read-only Users API uses valid Prisma User query fields', () => {
  const model = Prisma.dmmf.datamodel.models.find(
    (entry) => entry.name === 'User'
  );

  expect(model).toBeDefined();

  const validFields = new Set(
    model.fields.map((field) => field.name)
  );

  const source = readFileSync(
    new URL('../routes/adminUsersReadOnly.js', import.meta.url),
    'utf8'
  );

  const orderMatch = source.match(
    /orderBy:\s*\{\s*(\w+):\s*['"]desc['"]\s*\}/
  );

  expect(orderMatch).not.toBeNull();
  expect(validFields.has(orderMatch[1])).toBe(true);

  const selectMatch = source.match(
    /select:\s*\{([^}]+)\}/
  );

  expect(selectMatch).not.toBeNull();

  const selectedFields = [
    ...selectMatch[1].matchAll(/(\w+)\s*:\s*true/g),
  ].map((match) => match[1]);

  expect(selectedFields.length).toBeGreaterThan(0);

  for (const field of selectedFields) {
    expect(validFields.has(field)).toBe(true);
  }

  expect(selectedFields).not.toContain('createdAt');
});
