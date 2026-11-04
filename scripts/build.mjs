import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { compile, encode } from './compile.mjs';
import { CHANNELS } from '../contracts/schema.ts';

const release = process.argv.includes('--release');
function git(...args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
try {
  let docsCommit = '0'.repeat(40);
  if (release) {
    if (git('status', '--porcelain')) throw new Error('Release builds require a clean, committed checkout');
    docsCommit = git('rev-parse', 'HEAD');
    if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== docsCommit) throw new Error('Checkout does not match workflow event SHA');
  }
  // dist/ is removed before compiling so a failed build never leaves stale channel artefacts behind.
  await rm('dist', { recursive: true, force: true });
  const result = await compile({ docsCommit });
  await mkdir('dist/objects', { recursive: true });
  const summary = { local: !release, docsCommit, channels: {}, objects: 0, assets: result.assetBytes.size, warnings: result.warnings };
  const written = new Set();
  for (const channel of CHANNELS) {
    const c = result.channels[channel];
    await mkdir(`dist/${channel}`, { recursive: true });
    await writeFile(`dist/${channel}/manifest.json`, c.manifestBytes);
    for (const [sha256, bytes] of c.objects) { if (!written.has(sha256)) { await writeFile(`dist/objects/${sha256}.json`, bytes); written.add(sha256); } }
    summary.channels[channel] = { releaseId: c.releaseId, pages: c.manifest.pages.length, bytes: c.manifestBytes.length, warnings: c.warnings };
  }
  summary.objects = written.size;
  for (const [key, bytes] of result.assetBytes) { await mkdir(`dist/${key.slice(0, key.lastIndexOf('/'))}`, { recursive: true }); await writeFile(`dist/${key}`, bytes); }
  await writeFile('dist/build.json', encode(summary));
  for (const warning of [...result.warnings, ...CHANNELS.flatMap(c => result.channels[c].warnings)]) console.warn(warning);
  console.log(JSON.stringify({ mode: release ? 'release' : 'local', ...Object.fromEntries(CHANNELS.map(c => [c, { pages: summary.channels[c].pages, releaseId: summary.channels[c].releaseId }])), objects: summary.objects, assets: summary.assets }));
} catch (error) { console.error(error instanceof Error ? error.message.slice(0, 3000) : 'Build failed'); process.exitCode = 1; }
