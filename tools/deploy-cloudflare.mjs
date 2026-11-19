import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { prepareCloudflare } from './prepare-cloudflare.mjs';

// Uses Wrangler's existing login or CLOUDFLARE_API_TOKEN. Never accepts a token
// as a command-line argument and never prints .env values or the private seed.
async function run(args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...args], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error('Cloudflare operation failed')));
  });
}
let secretsFile;
try {
  const settings = JSON.parse(await readFile('wrangler.local.json', 'utf8'));
  if (!settings.accountId || !settings.databaseId || !settings.origin?.startsWith('https://')) throw new Error('Production Cloudflare settings missing');
  const build = await prepareCloudflare(settings);
  let local = {};
  try { local = parseEnv(await readFile('.env', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const id = local.DISCORD_CLIENT_ID?.trim();
  const secret = local.DISCORD_CLIENT_SECRET?.trim();
  const hasDiscord = /^\d{5,30}$/.test(id || '') && typeof secret === 'string' && secret.length >= 16 && secret.length <= 256 && !/\s/.test(secret);
  if (process.argv.includes('--require-discord') && !hasDiscord) throw new Error('Discord credentials are missing in the local .env file');
  if (hasDiscord) {
    secretsFile = resolve('.cloudflare-build/discord-secrets.json');
    await writeFile(secretsFile, JSON.stringify({ DISCORD_CLIENT_ID: id, DISCORD_CLIENT_SECRET: secret }), { mode: 0o600 });
  }
  await run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', build.config]);
  await run(['d1', 'execute', 'DB', '--remote', '--config', build.config, '--file', build.seed]);
  await run(['deploy', '--config', build.config, '--keep-vars', ...(secretsFile ? ['--secrets-file', secretsFile] : [])]);
  const response = await fetch(new URL('/healthz', settings.origin));
  const status = await response.json();
  if (!response.ok || status.ok !== true || (process.argv.includes('--require-discord') && !status.authEnabled)) throw new Error('Live verification incomplete');
  console.log(JSON.stringify({ online: true, origin: settings.origin, discordConfigured: status.authEnabled }));
} catch (error) {
  console.error(error.message === 'Discord credentials are missing in the local .env file'
    ? 'Client-ID und Client-Secret fehlen noch in der lokalen .env-Datei. Es wurde nichts veröffentlicht.'
    : 'Cloudflare-Aktivierung nicht abgeschlossen. Keine geheimen Werte wurden protokolliert.');
  process.exitCode = 1;
} finally {
  if (secretsFile) await unlink(secretsFile).catch(() => {});
}
