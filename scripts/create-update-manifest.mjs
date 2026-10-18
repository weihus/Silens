import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createManifest({ directory, repository, tag, notes = '', now = new Date() }) {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  if (tag !== `v${config.version}`) throw new Error(`Tag ${tag} must match app version v${config.version}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  const files = await readdir(directory);
  const platforms = {};
  const targets = [
    ['darwin-aarch64', /^Silens\.app\.tar\.gz$/],
    ['linux-x86_64-appimage', /_amd64\.AppImage$/],
    ['windows-x86_64', /_x64-setup\.exe$/],
  ];
  for (const [target, pattern] of targets) {
    const matches = files.filter(file => pattern.test(file));
    if (matches.length !== 1) throw new Error(`Expected exactly one update artifact for ${target}, found ${matches.length}`);
    const file = matches[0];
    const signature = (await readFile(path.join(directory, `${file}.sig`), 'utf8')).trim();
    if (!signature) throw new Error(`Empty signature for ${target}`);
    platforms[target] = { signature, url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}` };
  }
  return { version: config.version, notes, pub_date: now.toISOString(), platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, repository, tag, notesFile] = process.argv.slice(2);
  if (!directory || !repository || !tag) throw new Error('Usage: node scripts/create-update-manifest.mjs <artifacts> <owner/repo> <tag> [notes-file]');
  const notes = notesFile ? await readFile(notesFile, 'utf8') : '';
  const manifest = await createManifest({ directory, repository, tag, notes });
  await writeFile(path.join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated latest.json for ${manifest.version}: ${Object.keys(manifest.platforms).join(', ')}`);
}
