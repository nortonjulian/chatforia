import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { getTestDatabaseTarget } from './helpers/testDatabase.js';

// A shell variable takes precedence over .env.test; never load .env here.
dotenv.config({ path: fileURLToPath(new URL('../.env.test', import.meta.url)) });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = getTestDatabaseTarget().raw;
// Route tests must explicitly create their fixtures, not create on a read.
process.env.TEST_AUTO_PROVISION_USERS = 'false';

// Tests must be deterministic and must not inherit production/dev values
// from the developer's local .env file.
process.env.STATUS_ENABLED = 'true';

process.env.STRIPE_SKIP_SIG_CHECK = 'true';

process.env.APP_URL = 'https://app.test';
process.env.WEB_URL = 'https://app.test';

process.env.JWT_SECRET = 'test_secret';

process.env.CORS_ORIGINS =
  'http://localhost:5173,http://localhost:5002';

process.env.LOG_LEVEL = 'warn';

// Prevent accidental external calls.
process.env.OPENAI_API_KEY = 'test-openai';
process.env.STRIPE_SECRET_KEY = 'sk_test_123';

// Test isolation: do not inherit production frontend/translation overrides.
process.env.FRONTEND_ORIGIN = '';
process.env.WEB_ORIGIN = '';
process.env.TRANSLATION_ENABLED = 'true';
