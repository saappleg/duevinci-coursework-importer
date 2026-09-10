import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'extension');
const output = resolve(root, 'dist/chrome-test');
const zipPath = resolve(root, 'dist/duevinci-coursework-importer-chrome-test.zip');

await mkdir(dirname(output), { recursive: true });
await rm(output, { recursive: true, force: true });
await rm(zipPath, { force: true });
await cp(source, output, { recursive: true });

const manifestPath = resolve(output, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.name = 'DueVinci Coursework Importer (Test)';
manifest.version = '0.1.0.1';
manifest.version_name = '0.1.0 test build';
manifest.description = 'Test build: review coursework from the local fixture or a course page before importing into DueVinci.';
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const zip = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: output, encoding: 'utf8' });
if (zip.status !== 0) throw new Error(zip.stderr || 'The zip command failed.');

console.log(`Chrome test folder: ${output}`);
console.log(`Chrome test zip:    ${zipPath}`);
