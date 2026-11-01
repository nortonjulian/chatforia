import { createHash } from 'node:crypto';
import { validateBootstrapEnvironment } from '../initialAdminBootstrapGuard.js';

const endpointFingerprint = (endpoint) =>
  createHash('sha256').update(endpoint).digest('hex');

const EXPECTED_FINGERPRINT = endpointFingerprint(
  'localhost:5432:chatforia_prod_example'
);

const valid = () => ({
  nodeEnv: 'production',
  databaseUrl: 'postgresql://test:test@localhost:5432/chatforia_prod_example',
  expectedDatabase: 'chatforia_prod_example',
  actualDatabase: 'chatforia_prod_example',
  actualSchema: 'public',
  confirmation: 'PROMOTE julian@chatforia.com ON chatforia_prod_example',
  expectedEndpointFingerprint: EXPECTED_FINGERPRINT,
});

describe('initial administrator bootstrap environment guard', () => {
  test('accepts exact expected environment', () => {
    expect(validateBootstrapEnvironment(valid())).toEqual({
      authorized: true,
      database: 'chatforia_prod_example',
      schema: 'public',
    });
  });

  test.each(['development', 'test', undefined])(
    'rejects incorrect NODE_ENV: %s',
    (nodeEnv) => {
      expect(() => validateBootstrapEnvironment({
        ...valid(),
        nodeEnv,
      })).toThrow('Administrator bootstrap requires production mode');
    }
  );

  test('rejects missing endpoint fingerprint', () => {
    expect(() => validateBootstrapEnvironment({
      ...valid(),
      expectedEndpointFingerprint: undefined,
    })).toThrow('Administrator bootstrap endpoint mismatch');
  });

  test('rejects incorrect endpoint fingerprint', () => {
    expect(() => validateBootstrapEnvironment({
      ...valid(),
      expectedEndpointFingerprint: '0'.repeat(64),
    })).toThrow('Administrator bootstrap endpoint mismatch');
  });

  test('rejects unexpected database endpoint', () => {
    expect(() => validateBootstrapEnvironment({
      ...valid(),
      databaseUrl:
        'postgresql://test:test@another-host:5432/chatforia_prod_example',
    })).toThrow('Administrator bootstrap endpoint mismatch');
  });

  test('rejects missing database URL', () => {
    expect(() => validateBootstrapEnvironment({
      ...valid(),
      databaseUrl: '',
    })).toThrow('Database connection configuration missing');
  });

  test('rejects malformed database URL', () => {
    expect(() => validateBootstrapEnvironment({
      ...valid(),
      databaseUrl: 'not-a-url',
    })).toThrow('Invalid database connection configuration');
  });

  test('rejects non-PostgreSQL connection', () => {
    expect(() => validateBootstrapEnvironment({
      ...valid(),
      databaseUrl: 'mysql://test:test@localhost/chatforia_prod_example',
    })).toThrow('Administrator bootstrap requires PostgreSQL');
  });

  test.each([
    { expectedDatabase: 'another_database' },
    { actualDatabase: 'another_database' },
    { actualSchema: 'other' },
    { expectedDatabase: '' },
  ])('rejects database identity mismatch: %p', (change) => {
    expect(() => validateBootstrapEnvironment({
      ...valid(),
      ...change,
    })).toThrow('Administrator bootstrap database identity mismatch');
  });

  test.each([
    '',
    'yes',
    'PROMOTE another@example.com ON chatforia_prod_example',
    'PROMOTE julian@chatforia.com ON another_database',
  ])('rejects invalid confirmation: %s', (confirmation) => {
    expect(() => validateBootstrapEnvironment({
      ...valid(),
      confirmation,
    })).toThrow('Administrator bootstrap confirmation mismatch');
  });
});
