// Register runtime aliases for Node BEFORE loading the main server entry.

import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

// module-alias is CommonJS, so we bridge it into ESM
const require = createRequire(import.meta.url);
const moduleAlias = require('module-alias');

// Resolve absolute path of the /server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register the aliases we rely on in code
moduleAlias.addAliases({
  '@utils': path.join(__dirname, 'utils'),
  '@sms': path.join(__dirname, 'utils', 'sms.js'),
  '@prismaClient': path.join(__dirname, 'utils', 'prismaClient.js'),
  '@middleware': path.join(__dirname, 'middleware'),
  '@routes': path.join(__dirname, 'routes'),
  '@api': path.join(__dirname, 'api'),
});

// Now load the real server entry
import './index.js';
