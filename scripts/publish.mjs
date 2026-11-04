// Real publisher: only the serialized master workflow may run it. Publish mode activates both
// channels from dist/ (each channel captures its own failure; the job fails if any channel failed).
// Rollback mode re-activates one previously activated release of one channel.
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { publicationGuard, credentials, refreshPublicationHead } from './deployment.mjs';
import { openStores } from './store.mjs';
import { activate, activateChannels, FAILED_STATUSES } from './publish-core.mjs';
import { CHANNELS, Channel, Digest } from '../contracts/schema.ts';

let stores;
try {
  const { branch } = publicationGuard();
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 20000 }).trim();
  if (git('status', '--porcelain')) throw new Error('Publishing requires a clean checkout');
  const headCommit = git('rev-parse', 'HEAD');
  if (process.env.GITHUB_SHA !== headCommit) throw new Error('Checkout does not match workflow event SHA');
  const mode = process.env.DOCS_PUBLISH_MODE || 'publish';
  if (!['publish', 'rollback'].includes(mode)) throw new Error('Invalid activation mode');
  stores = openStores(credentials());
  const common = {
    ...stores, head: async () => refreshPublicationHead(branch),
    isAncestor: async (before, after) => { try { git('merge-base', '--is-ancestor', before, after); return true; } catch { return false; } },
    log: message => console.log(message),
  };
  const results = {};
  if (mode === 'rollback') {
    const channel = Channel.parse(process.env.DOCS_ROLLBACK_CHANNEL);
    const releaseId = Digest.parse(process.env.DOCS_ROLLBACK_RELEASE);
    results[channel] = await activate({ ...common, channel, mode, releaseId }).catch(error => ({ status: 'failed-before-switch', channel, releaseId, error: error.message.slice(0, 500) }));
  } else {
    const outcome = await activateChannels({
      channels: CHANNELS, log: message => console.log(message),
      build: async () => {
        const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
        if (build.local || build.docsCommit !== headCommit) throw new Error('Release build provenance mismatch');
        const objects = new Map();
        for (const name of await readdir('dist/objects')) objects.set(name.replace(/\.json$/, ''), await readFile(`dist/objects/${name}`));
        const perChannel = {};
        for (const channel of CHANNELS) {
          const manifestBytes = await readFile(`dist/${channel}/manifest.json`);
          const manifest = JSON.parse(manifestBytes.toString('utf8'));
          const assetBytes = new Map();
          for (const asset of Object.values(manifest.assets)) assetBytes.set(asset.key, await readFile(`dist/${asset.key}`));
          perChannel[channel] = { manifestBytes, assetBytes };
        }
        return { objects, perChannel };
      },
      activate: (channel, built) => activate({ ...common, channel, mode, manifestBytes: built.perChannel[channel].manifestBytes, objects: built.objects, assetBytes: built.perChannel[channel].assetBytes }),
    });
    Object.assign(results, outcome.results);
    if (outcome.error) throw new Error(outcome.error);
  }
  console.log(JSON.stringify({ branch, mode, results }));
  if (Object.values(results).some(r => FAILED_STATUSES.includes(r.status))) process.exitCode = 1;
} catch (error) { console.error(error instanceof Error ? error.message.slice(0, 1000) : 'Publication failed'); process.exitCode = 1; }
finally { stores?.close(); }
