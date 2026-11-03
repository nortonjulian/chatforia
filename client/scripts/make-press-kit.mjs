import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const brandDir = fileURLToPath(new URL('../public/brand/', import.meta.url));
const archive = archiver('zip', { zlib: { level: 9 } });
const output = fs.createWriteStream(path.join(brandDir, 'chatforia-logo-kit.zip'));
const completed = new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
  archive.on('warning', reject);
});
archive.pipe(output);
archive.file(path.join(brandDir, 'Logo.png'), { name: 'chatforia-logo.png' });
archive.append('Chatforia logo kit\n\nIncludes the current website logo. Preserve its aspect ratio, colors, and orientation. Do not stretch or redraw it.\nFor additional imagery, formats, or media inquiries: press@chatforia.com\n\nChatforia LLC\n', { name: 'README.txt' });
await archive.finalize();
await completed;
console.log('Generated current Chatforia logo kit.');
