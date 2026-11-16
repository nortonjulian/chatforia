import { accessSync, constants } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkApnsKey(env = process.env) {
  const key = env.APNS_KEY;

  if (!key || !String(key).trim()) {
    throw new Error('APNs preflight: key configuration missing');
  }

  const value = String(key).trim();

  if (value.includes('BEGIN PRIVATE KEY')) {
    return 'inline';
  }

  if (!value.startsWith('/')) {
    throw new Error('APNs preflight: unsupported key configuration');
  }

  try {
    accessSync(value, constants.R_OK);
  } catch {
    throw new Error('APNs preflight: configured key is unreadable');
  }

  return 'file';
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    checkApnsKey();
    console.log('PASS: APNs key accessible');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
