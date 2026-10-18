import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createManifest } from './create-update-manifest.mjs';
import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
test('signed update manifest includes correct platform artifacts and rejects incomplete releases', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'silens-manifest-'));
  const options = { directory, repository: 'weihus/Silens', tag: `v${version}`, notes: 'Release notes', now: new Date('2026-10-18T00:00:00Z') };
  try {
    await assert.rejects(createManifest(options), /darwin-aarch64/);
    const files = ['Silens.app.tar.gz', `Silens_${version}_amd64.AppImage`, `Silens_${version}_x64-setup.exe`];
    for (const file of files) {
      await writeFile(path.join(directory, file), 'artifact');
      await writeFile(path.join(directory, `${file}.sig`), `signature-${file}\n`);
    }
    const manifest = await createManifest(options);
    assert.equal(manifest.version, version);
    assert.equal(manifest.notes, 'Release notes');
    assert.equal(manifest.pub_date, '2026-10-18T00:00:00.000Z');
    assert.deepEqual(Object.keys(manifest.platforms), ['darwin-aarch64', 'linux-x86_64-appimage', 'windows-x86_64']);
    assert.equal(manifest.platforms['darwin-aarch64'].signature, 'signature-Silens.app.tar.gz');
    assert.equal(manifest.platforms['darwin-aarch64'].url, `https://github.com/weihus/Silens/releases/download/v${version}/Silens.app.tar.gz`);
    await assert.rejects(createManifest({ ...options, tag: 'v0.0.1' }), /must match/);
    await rm(path.join(directory, `${files[2]}.sig`));
    await assert.rejects(createManifest(options), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
