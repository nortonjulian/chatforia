import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const defaultLicenseDir = fileURLToPath(new URL('../licenses/', import.meta.url));

// Inspect only packages represented in emitted browser chunks, including transitives.
export function collectNotices(moduleIds, licenseDir = defaultLicenseDir) {
  const supplemental = JSON.parse(fs.readFileSync(path.join(licenseDir, 'supplemental-notices.json'), 'utf8'));
  const roots = new Set();
  for (const id of moduleIds) {
    if (!id.includes('node_modules') || id.startsWith('\0')) continue;
    const clean = id.split('?')[0];
    const marker = `${path.sep}node_modules${path.sep}`;
    const offset = clean.lastIndexOf(marker);
    if (offset < 0) continue;
    const parts = clean.slice(offset + marker.length).split(path.sep);
    const root = clean.slice(0, offset + marker.length) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join(path.sep);
    if (fs.existsSync(path.join(root, 'package.json'))) roots.add(root);
  }
  return [...roots].map(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const notices = [];
    const readNotices = (dir, depth = 0) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /^(licen[cs]e|copying|notice|copyright)([.\-_]|$)/i.test(entry.name)) {
          notices.push({ file: path.relative(root, path.join(dir, entry.name)), text: fs.readFileSync(path.join(dir, entry.name), 'utf8') });
        } else if (entry.isDirectory() && depth === 0 && /^(licenses?|notices?)$/i.test(entry.name)) {
          readNotices(path.join(dir, entry.name), 1);
        }
      }
    };
    readNotices(root);
    const supplement = supplemental[`${pkg.name}@${pkg.version}`];
    for (const entry of supplement?.files || []) {
      const bytes = fs.readFileSync(path.join(licenseDir, entry.file));
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
        throw new Error(`Supplemental notice checksum mismatch: ${entry.file}`);
      }
      notices.push({ file: entry.file, source: entry.source, text: bytes.toString('utf8') });
    }
    return { name: pkg.name, version: pkg.version, license: pkg.license || 'Not declared', repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url, notices: notices.sort((a,b) => a.file.localeCompare(b.file)) };
  }).sort((a,b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export default function thirdPartyNotices() {
  return {
    name: 'chatforia-third-party-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).filter(item => item.type === 'chunk').flatMap(chunk => Object.keys(chunk.modules));
      const packages = collectNotices(ids);
      const missing = packages.filter(pkg => !pkg.notices.length);
      if (missing.length) this.warn(`Packaged license texts missing for: ${missing.map(pkg => pkg.name).join(', ')}`);
      const header = 'Chatforia browser bundle — third-party notices\n\nGenerated from packages included in this build. This inventory does not cover native apps, server-only software, externally loaded SDKs, or separately supplied static assets. Package metadata does not replace license terms.\n';
      const text = header + packages.map(pkg => `\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense metadata: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}\n${pkg.repository || ''}\n\n` + (pkg.notices.length ? pkg.notices.map(n => `--- ${n.file} ---\n${n.source ? `Source: ${n.source}\n` : ''}${n.text}`).join('\n\n') : 'No license text was included in the installed package. Attribution review remains required.')).join('\n');
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt', source: text });
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.json', source: JSON.stringify({ scope: 'browser bundle', packages }, null, 2) });
    },
  };
}
