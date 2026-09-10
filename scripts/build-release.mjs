import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'extension');
const output = resolve(root, 'dist/releases');
const releaseVersion = process.env.RELEASE_VERSION || '0.1.1-beta.2';
const chromeVersion = process.env.CHROME_VERSION || releaseVersion.match(/^\d+\.\d+\.\d+/)?.[0] || '0.1.1';

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseVersion)) {
  throw new Error(`Invalid release version: ${releaseVersion}`);
}
if (!/^\d+(?:\.\d+){0,3}$/.test(chromeVersion)) {
  throw new Error(`Invalid Chrome manifest version: ${chromeVersion}`);
}

await mkdir(dirname(output), { recursive: true });
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

async function stage(label, name) {
  const directory = resolve(output, name);
  await cp(source, directory, { recursive: true });
  const manifestPath = resolve(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.name = `DueVinci Coursework Importer (${label})`;
  manifest.version = chromeVersion;
  manifest.version_name = releaseVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

function zipDirectory(directory, archiveName) {
  const archivePath = resolve(output, archiveName);
  const zip = spawnSync('zip', ['-qr', archivePath, '.'], { cwd: directory, encoding: 'utf8' });
  if (zip.status !== 0) throw new Error(zip.stderr || `Could not create ${archiveName}`);
  return archivePath;
}

const chromiumDirectory = await stage('Beta', 'chromium');
const safariDirectory = await stage('Safari Beta Source', 'safari');
await cp(resolve(root, 'docs/SAFARI_BETA.md'), resolve(safariDirectory, 'SAFARI_BETA.md'));

const chromiumArchive = zipDirectory(chromiumDirectory, `duevinci-coursework-importer-chromium-${releaseVersion}.zip`);
const safariArchive = zipDirectory(safariDirectory, `duevinci-coursework-importer-safari-${releaseVersion}.zip`);

await rm(chromiumDirectory, { recursive: true, force: true });
await rm(safariDirectory, { recursive: true, force: true });
console.log(`Chromium release: ${chromiumArchive}`);
console.log(`Safari source:    ${safariArchive}`);
