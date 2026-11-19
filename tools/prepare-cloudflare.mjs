import { readFile, writeFile, mkdir, readdir, realpath, stat, cp } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateConfig } from '../script.js';
import { localImagePath } from './publish-doors.mjs';
import { privateAudioPath } from '../media.js';

const WEB_FILES = ['index.html', 'styles.css', 'script.js', 'theme.js', 'github-editor.js', 'text-format.js', 'puzzles.js', 'puzzle-client.js', 'media.js'];
const MAX_ASSET = 25 * 1024 * 1024;

export async function prepareCloudflare({ root = resolve('.'), source = resolve(root, '.private-repository'),
  out = resolve(root, '.cloudflare-build'), databaseId = '00000000-0000-0000-0000-000000000000',
  accountId, origin = 'http://127.0.0.1:8787', name = 'creeunity-adventskalender-2026' } = {}) {
  root = await realpath(root);
  source = await realpath(source);
  out = resolve(out);
  if (!out.startsWith(root + sep) || out === source || source.startsWith(out + sep)) throw new Error('Build directory must be isolated inside the workspace');
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname))) throw new Error('Invalid calendar origin');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) throw new Error('Invalid Worker name');
  const config = validateConfig(JSON.parse(await readFile(resolve(source, 'doors-data.json'), 'utf8')));
  if (config.doors.some(door => door.puzzle && typeof door.puzzle.answer !== 'string')) throw new Error('Private calendar with full solutions required');
  const assets = resolve(out, 'builds', `${Date.now()}-${crypto.randomUUID()}`, 'assets');
  await mkdir(assets, { recursive: true });
  const copy = async (file, destination) => {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_ASSET) throw new Error('Invalid or oversized calendar asset');
    await mkdir(resolve(destination, '..'), { recursive: true });
    await cp(file, destination);
  };
  for (const file of WEB_FILES) await copy(resolve(root, file), resolve(assets, file));
  // Historical public releases are deliberately omitted: content routes below
  // are served only after the Worker checks the database's current schedule.
  const copyBranding = async (from, to) => {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (entry.name === 'released' || entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) throw new Error('Symlink in public assets');
      if (entry.isDirectory()) await copyBranding(resolve(from, entry.name), resolve(to, entry.name));
      else await copy(resolve(from, entry.name), resolve(to, entry.name));
    }
  };
  await copyBranding(resolve(root, 'assets'), resolve(assets, 'assets'));
  const copied = new Set();
  const sizes = [];
  for (const door of config.doors) {
    for (const [value, pathFunction, folder] of [[door.image, localImagePath, 'images'], [door.audio, privateAudioPath, 'audio']]) {
      if (!value || /^https:\/\//i.test(value)) continue;
      const path = pathFunction(value);
      const file = await realpath(resolve(source, path));
      if (!file.startsWith(resolve(source, folder) + sep)) throw new Error('Private asset outside its content directory');
      if (!copied.has(path)) { await copy(file, resolve(assets, path)); copied.add(path); sizes.push([`/${path}`, (await stat(file)).size]); }
    }
  }
  // This seed file is local-only and excluded from both Git and static assets.
  // SQL escaping preserves quotes in user-edited text without executing it.
  const json = JSON.stringify(config).replace(/'/g, "''");
  const metadata = sizes.map(([path, size]) => `INSERT INTO asset_sizes (path, size) VALUES ('${path.replace(/'/g, "''")}', ${size}) ON CONFLICT(path) DO UPDATE SET size = excluded.size;`).join('\n');
  await writeFile(resolve(out, 'calendar.sql'), `INSERT INTO calendar_config (id, json) VALUES (1, '${json}') ON CONFLICT(id) DO UPDATE SET json = excluded.json;\n${metadata}\n`, { mode: 0o600 });
  const slash = value => value.split(sep).join('/');
  const settings = {
    name, main: slash(relative(out, resolve(root, 'server/cloudflare/worker.mjs'))),
    compatibility_date: '2026-11-19', compatibility_flags: ['nodejs_compat'],
    workers_dev: true, preview_urls: false,
    ...(accountId ? { account_id: accountId } : {}),
    assets: { directory: slash(relative(out, assets)), binding: 'ASSETS', run_worker_first: true, not_found_handling: 'none' },
    d1_databases: [{ binding: 'DB', database_name: 'creeunity-calendar-2026', database_id: databaseId, jurisdiction: 'eu',
      migrations_dir: slash(relative(out, resolve(root, 'server/cloudflare/migrations'))) }],
    vars: { PUBLIC_ORIGIN: origin },
    triggers: { crons: ['* * * * *'] },
    observability: { enabled: false },
    send_metrics: false,
  };
  await writeFile(resolve(out, 'wrangler.json'), JSON.stringify(settings, null, 2) + '\n');
  return { assets, config: resolve(out, 'wrangler.json'), seed: resolve(out, 'calendar.sql'), mediaFiles: copied.size, doors: config.doors.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    let settings = {};
    try { settings = JSON.parse(await readFile('wrangler.local.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = await prepareCloudflare(settings);
    console.log(`Cloudflare build prepared: ${result.doors} doors, ${result.mediaFiles} media files. No solutions in static assets.`);
  } catch {
    console.error('Cloudflare build failed. Check the private calendar, local settings and asset sizes. No private values were logged.');
    process.exitCode = 1;
  }
}
