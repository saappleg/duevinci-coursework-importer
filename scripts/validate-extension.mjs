import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const extension = resolve(root, 'extension');
const files = [
  'manifest.json',
  'background.js',
  'scanner.js',
  'docx-parser.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'options.html',
  'options.css',
  'options.js',
];

for (const file of files) await stat(resolve(extension, file));

const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
const expected = {
  manifest_version: 3,
  actionPopup: 'popup.html',
  worker: 'background.js',
};

if (manifest.manifest_version !== expected.manifest_version) throw new Error('manifest_version must be 3.');
if (manifest.action?.default_popup !== expected.actionPopup) throw new Error('manifest popup is missing.');
if (manifest.background?.service_worker !== expected.worker) throw new Error('manifest service worker is missing.');
if (!manifest.permissions?.includes('activeTab')) throw new Error('activeTab permission is required for user-initiated scans.');
if (!manifest.permissions?.includes('storage')) throw new Error('storage permission is required for saved schedules and source preferences.');

for (const file of files.filter((file) => file.endsWith('.js'))) {
  const check = spawnSync(process.execPath, ['--check', resolve(extension, file)], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`${file} syntax error:\n${check.stderr}`);
}

console.log(`Validated DueVinci extension source (${files.length} files).`);
