import { execFileSync } from 'node:child_process';

// Fixed targets: one KV namespace and one R2 bucket shared by every channel and (later) every
// content type. Neither workflow inputs nor secrets can override them.
export const KV_NAMESPACE_ID = '9157dfb0aad643ff8451ef992eb9c64a';
export const R2_BUCKET = 'cscheap-content';
export const PUBLICATION_BRANCH = 'master';
export const SECRET_NAMES = Object.freeze(['CSCHEAP_DOCS_CF_ACCOUNT_ID', 'CSCHEAP_DOCS_CF_API_TOKEN']);

/** Only the serialized master workflow of cscheap/docs may run the real publisher. */
export function publicationGuard(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'cscheap/docs' || env.GITHUB_REF !== `refs/heads/${PUBLICATION_BRANCH}`) {
    throw new Error('Publishing is restricted to the serialized master workflow');
  }
  return { branch: PUBLICATION_BRANCH };
}

export function credentials(env = process.env) {
  const required = name => { const value = env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
  const accountId = required('CSCHEAP_DOCS_CF_ACCOUNT_ID');
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('Invalid Cloudflare account ID');
  return { accountId, apiToken: required('CSCHEAP_DOCS_CF_API_TOKEN'), namespaceId: KV_NAMESPACE_ID, bucket: R2_BUCKET };
}

export function refreshPublicationHead(branch = PUBLICATION_BRANCH, cwd = process.cwd()) {
  if (branch !== PUBLICATION_BRANCH) throw new Error('Invalid publication branch');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const remoteRef = `refs/remotes/origin/${branch}`;
  // An explicit refspec updates the right tracking ref even in a narrow Actions checkout.
  git('fetch', '--no-tags', 'origin', `+refs/heads/${branch}:${remoteRef}`);
  return git('rev-parse', remoteRef);
}
