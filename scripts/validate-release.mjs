import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/releases');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const releaseVersion = process.env.RELEASE_VERSION || packageJson.version;
const chromeVersion = releaseVersion.match(/^\d+\.\d+\.\d+/)?.[0];
const betaNumber = releaseVersion.match(/-beta\.(\d+)$/)?.[1];
const expectedChromiumVersion = betaNumber ? `${chromeVersion}.${betaNumber}` : chromeVersion;

if (!chromeVersion) throw new Error(`Could not derive a browser manifest version from ${releaseVersion}.`);

async function readPackagedManifest(archiveName) {
  const archive = resolve(output, archiveName);
  await stat(archive);
  const integrity = spawnSync('unzip', ['-tqq', archive], { encoding: 'utf8' });
  if (integrity.status !== 0) throw new Error(`${archiveName} is not a valid ZIP:\n${integrity.stderr}`);
  const result = spawnSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${archiveName} does not contain manifest.json.`);
  return JSON.parse(result.stdout);
}

const chromium = await readPackagedManifest(`duevinci-coursework-importer-chromium-${releaseVersion}.zip`);
const safari = await readPackagedManifest(`duevinci-coursework-importer-safari-${releaseVersion}.zip`);
const firefox = await readPackagedManifest(`duevinci-coursework-importer-firefox-${releaseVersion}.zip`);

if (chromium.manifest_version !== 3 || chromium.background?.service_worker !== 'background.js') {
  throw new Error('The Chromium package must contain the Manifest V3 service worker configuration.');
}
if (safari.manifest_version !== 3 || safari.background?.service_worker !== 'background.js') {
  throw new Error('The Safari source package must contain the Manifest V3 background worker configuration.');
}
if (chromium.version !== expectedChromiumVersion || safari.version !== expectedChromiumVersion) {
  throw new Error(`Chromium and Safari manifest versions must advance for each beta package (${expectedChromiumVersion}).`);
}
if (safari.minimum_chrome_version) throw new Error('The Safari source package must not carry Chrome-only minimum-version metadata.');
if (firefox.manifest_version !== 3 || !firefox.background?.scripts?.includes('background.js') || firefox.background?.service_worker) {
  throw new Error('The Firefox package must use the Manifest V3 background scripts configuration.');
}
const firefoxMinimum = firefox.browser_specific_settings?.gecko?.strict_min_version;
if (firefox.minimum_chrome_version || !firefoxMinimum || Number.parseFloat(firefoxMinimum) < 128) {
  throw new Error('The Firefox package has incompatible Chromium minimum-version metadata or Firefox MAIN-world support settings.');
}
if (firefox.version !== releaseVersion) throw new Error('The Firefox package version must advance for every beta release.');

const safariDocs = spawnSync('unzip', ['-l', resolve(output, `duevinci-coursework-importer-safari-${releaseVersion}.zip`)], { encoding: 'utf8' });
if (safariDocs.status !== 0 || !safariDocs.stdout.includes('SAFARI_BETA.md')) {
  throw new Error('The Safari package must include its Xcode packaging instructions.');
}

console.log(`Validated Chromium, Safari, and Firefox release packages (${releaseVersion}).`);
