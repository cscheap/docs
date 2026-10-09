import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// Tina's browser editor only receives public-prefixed variables. Map the two
// non-secret settings here; the read token must remain build-time only.
const env = { ...process.env };
env.TINA_PUBLIC_CLIENT_ID = env.CSCHEAP_DOCS_TINA_CLIENT_ID || '';
env.TINA_PUBLIC_BRANCH = env.CSCHEAP_DOCS_TINA_BRANCH || 'master';

const args = process.argv.slice(2);
if (args[0] === 'build' && !args.includes('--local')) {
  const missing = ['CSCHEAP_DOCS_TINA_CLIENT_ID', 'CSCHEAP_DOCS_TINA_READ_TOKEN']
    .filter((key) => !env[key]);
  if (missing.length) {
    console.error(`Missing build configuration: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const cli = fileURLToPath(new URL('../node_modules/@tinacms/cli/bin/tinacms', import.meta.url));
const child = spawn(process.execPath, [cli, ...args], { env, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(`Unable to start Tina CLI: ${error.code || 'unknown error'}`);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
