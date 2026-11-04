// Contract v3 compiler: one body compilation per locale file, then one projection per channel.
// A projection owns its own deep-cloned ASTs, link resolution, navigation, redirects, search index
// and manifest, so the two channels never share mutable state.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, basename, extname, relative, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { compileBody, syntaxCheck, visit, toolchain, themes } from './mdx.mjs';
import { digest, LOCALE_FILES, splitFrontmatter } from './unit.mjs';
import {
  Baseline, CHANNELS, Channel, CHANNEL_STAGES, INTRO_SLUG, Item, LIMITS, LOCALES, LocaleFrontmatter, Manifest, PageObject, SearchIndex, Slug, safeUrl,
} from '../contracts/schema.ts';
export { syntaxCheck, digest };

export const locales = LOCALES;
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export const encode = value => Buffer.from(JSON.stringify(stable(value)) + '\n');
export const walk = visit;
export function pageUrl(locale, slug) { return `/${locale}/docs${slug === INTRO_SLUG ? '' : `/${slug}`}`; }

async function textFile(path, limit = LIMITS.page) {
  if ((await lstat(path)).size > limit) throw new Error(`Oversized input: ${path}`);
  const bytes = await readFile(path); if (bytes.length > limit) throw new Error('Input grew past limit');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\r')) throw new Error(`Use UTF-8 LF: ${path}`);
  return text;
}
/** Every directory holding item.json is a unit; nothing else may live under content/. */
async function units(root) {
  const found = [];
  async function scan(dir) {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1);
    if (entries.some(e => e.name === 'item.json')) {
      for (const e of entries) {
        if (e.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${resolve(dir, e.name)}`);
        if (e.isDirectory() || (e.name !== 'item.json' && !Object.values(LOCALE_FILES).includes(e.name))) throw new Error(`Unexpected file in unit ${relative(root, dir)}: ${e.name}`);
      }
      found.push(dir); return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${resolve(dir, e.name)}`);
      if (!e.isDirectory()) throw new Error(`Unexpected content file: ${resolve(dir, e.name)}`);
      await scan(resolve(dir, e.name));
    }
  }
  await scan(root);
  return found;
}
function parseYaml(text, path) {
  const yaml = parseDocument(text, { uniqueKeys: true });
  if (yaml.errors.length) throw new Error(`Invalid YAML: ${path}`);
  return yaml.toJS({ maxAliasCount: 0 });
}
async function readAsset(root, url, assets, assetBytes) {
  if (!/^\/assets\/[a-zA-Z0-9._-]+$/.test(url)) throw new Error('Invalid asset path');
  if (assets[url]) return;
  const path = resolve(root, url.slice(1)), stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > LIMITS.asset) throw new Error('Invalid/oversized asset');
  const bytes = await readFile(path), mime = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(path)];
  if (!mime) throw new Error('Unsupported asset type (SVG is not enabled)');
  if (mime === 'application/json') JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (mime === 'image/png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG');
  if (mime === 'image/jpeg' && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) throw new Error('Invalid JPEG');
  if (mime === 'image/webp' && !(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')) throw new Error('Invalid WebP');
  const sha256 = digest(bytes), key = `assets/${sha256}/${basename(path)}`;
  assets[url] = { key, sha256, mime, size: bytes.length }; assetBytes.set(key, bytes);
}

/**
 * Returns { units, channels: { preview, production }, assetBytes, warnings }.
 * Each channel: { manifest, manifestBytes, releaseId, objects: Map<sha256, Buffer>, warnings }.
 */
export async function compile({ root = process.cwd(), docsCommit = '0'.repeat(40), channels: wanted = CHANNELS } = {}) {
  const json = async path => JSON.parse(await textFile(resolve(root, path), LIMITS.manifest));
  const baselines = {};
  for (const project of ['spider', 'refinery', 'api', 'frontend']) {
    const base = Baseline.parse(await json(`baselines/${project}.json`));
    if (base.project !== project || base.documentationReview !== 'reviewed') throw new Error(`Unreviewed/mismatched baseline: ${project}`);
    baselines[project] = base;
  }
  const contentRoot = resolve(root, 'content');
  const contentStat = await lstat(contentRoot);
  if (contentStat.isSymbolicLink() || !contentStat.isDirectory()) throw new Error('content/ must be a repository directory');
  const warnings = [], all = [];
  for (const dir of await units(contentRoot)) {
    const slugPath = relative(contentRoot, dir).split(sep).join('/');
    const itemText = await textFile(resolve(dir, 'item.json'), LIMITS.item);
    let item;
    try { item = Item.parse(JSON.parse(itemText)); } catch (error) {
      const detail = error.issues ? error.issues.map(i => `${i.path.join('.') || 'item'}: ${i.message}`).join('; ') : error.message;
      throw new Error(`Invalid item.json in ${slugPath}: ${detail}`);
    }
    if (item.slug !== Slug.parse(slugPath)) throw new Error(`Slug/directory mismatch: ${slugPath}`);
    const files = {};
    for (const locale of LOCALES) {
      const path = resolve(dir, LOCALE_FILES[locale]);
      let raw; try { raw = await textFile(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const { yaml, body } = splitFrontmatter(raw);
      const meta = LocaleFrontmatter.parse(parseYaml(yaml, path));
      if (locale === 'en' && meta.sourceDigest) throw new Error(`English cannot carry sourceDigest: ${slugPath}`);
      if (locale !== 'en' && !meta.sourceDigest) throw new Error(`Translation provenance required: ${locale}/${slugPath}`);
      files[locale] = { raw, meta, ...(await compileBody(body, warnings)) };
    }
    if (!files.en) throw new Error(`Missing en.mdx: ${slugPath}`);
    const englishDigest = `sha256:${digest(files.en.raw)}`;
    for (const locale of LOCALES) {
      if (locale === 'en' || !files[locale]) continue;
      if (files[locale].meta.sourceDigest !== englishDigest) { warnings.push(`Excluded stale translation: ${locale}/${slugPath}`); files[locale].stale = true; }
    }
    all.push({ item, slug: item.slug, files });
  }
  const seenIds = new Set();
  for (const u of all) { if (seenIds.has(u.item.docId)) throw new Error(`Duplicate docId: ${u.item.docId}`); seenIds.add(u.item.docId); }
  const bySlug = new Map(all.map(u => [u.slug, u]));
  const navigation = await json('navigation.json');
  if (navigation.schemaVersion !== 1) throw new Error('Unknown navigation schema');
  const navSlugs = navigation.groups.flatMap(g => g.pages);
  if (new Set(navSlugs).size !== navSlugs.length) throw new Error('Duplicate navigation entry');
  for (const slug of navSlugs) if (!bySlug.has(slug)) throw new Error(`Dangling navigation: ${slug}`);
  for (const u of all) if (!navSlugs.includes(u.slug)) throw new Error(`Unit missing from navigation: ${u.slug}`);
  const explicitRedirects = await json('redirects.json');
  const assetDirectory = await lstat(resolve(root, 'assets'));
  if (assetDirectory.isSymbolicLink() || !assetDirectory.isDirectory()) throw new Error('Assets must be a repository directory');
  const assetBytes = new Map();

  const channels = {};
  for (const channel of wanted) {
    Channel.parse(channel);
    const channelWarnings = [];
    const inChannel = u => CHANNEL_STAGES[channel].includes(u.item.stage);
    const pages = [];
    for (const u of all) {
      if (!inChannel(u)) continue;
      for (const locale of LOCALES) {
        const f = u.files[locale];
        if (!f || f.stale) continue;
        pages.push({ unit: u, locale, slug: u.slug, docId: u.item.docId, title: f.meta.title, description: f.meta.description, kind: u.item.kind, deprecated: u.item.deprecated ?? false, body: structuredClone(f.body), toc: f.toc, structuredData: f.structuredData });
      }
    }
    if (!pages.length) throw new Error(`Channel ${channel} has no pages`);
    pages.sort((a, b) => `${a.locale}/${a.slug}` < `${b.locale}/${b.slug}` ? -1 : 1);
    const byKey = new Map(pages.map(p => [`${p.locale}:${p.slug}`, p]));
    if (!byKey.has(`en:${INTRO_SLUG}`)) throw new Error(`Channel ${channel} lacks the introduction page`);
    const translations = Object.create(null); for (const p of pages) (translations[p.docId] ??= {})[p.locale] = p.slug;
    const trees = {}, redirects = [];
    for (const locale of LOCALES) {
      trees[locale] = navigation.groups.map(g => ({ type: 'folder', name: g.title[locale], children: g.pages.flatMap(slug => {
        const p = byKey.get(`${locale}:${slug}`); return p ? [{ type: 'page', key: `${locale}:${slug}`, name: p.title, url: pageUrl(locale, slug) }] : [];
      }) })).filter(g => g.children.length);
      const hasIntro = byKey.has(`${locale}:${INTRO_SLUG}`);
      redirects.push({ locale, from: INTRO_SLUG, to: '', toLocale: hasIntro ? locale : 'en', status: hasIntro ? 308 : 307 });
      if (locale !== 'en') for (const p of pages.filter(p => p.locale === 'en' && p.slug !== INTRO_SLUG)) if (!byKey.has(`${locale}:${p.slug}`)) redirects.push({ locale, from: p.slug, to: p.slug, toLocale: 'en', status: 307 });
    }
    // Explicit redirects are terminal, never chains. Canonical introduction is represented by an empty target.
    for (const r of explicitRedirects) {
      const targetSlug = r.to || INTRO_SLUG;
      if (!bySlug.has(targetSlug)) throw new Error(`Dangling redirect target: ${r.from} → ${targetSlug}`);
      if (byKey.has(`${r.locale}:${r.from}`) || redirects.some(x => x.locale === r.locale && x.from === r.from)) throw new Error(`Redirect shadows an existing route: ${r.locale}/${r.from}`);
      if (!byKey.has(`${r.toLocale}:${targetSlug}`)) { channelWarnings.push(`Dropped redirect to a page outside ${channel}: ${r.locale}/${r.from} → ${r.toLocale}/${targetSlug}`); continue; }
      redirects.push(r);
    }
    const assets = {};
    for (const p of pages) {
      const links = []; walk(p.body, node => {
        if (node.type !== 'element') return;
        const prop = node.tagName === 'img' ? 'src' : node.tagName === 'a' ? 'href' : null;
        if (!prop) return;
        const url = node.properties[prop];
        if (!safeUrl(url)) throw new Error('Unsafe URL');
        if (node.tagName === 'img' && (!url.startsWith('/assets/') || !node.properties.alt?.trim())) throw new Error('Images require repository assets and non-empty alt text');
        links.push({ node, prop, url });
      });
      for (const { node, prop, url } of links) {
        if (url.startsWith('/assets/')) { await readAsset(root, url, assets, assetBytes); continue; }
        if (!(url.startsWith('#') || /^\/(?:en\/|zh-CN\/|ru\/)?docs(?:\/|#|$)/.test(url))) continue;
        const target = new URL(url, `https://docs.invalid${pageUrl(p.locale, p.slug)}`);
        const m = target.pathname.match(/^\/(?:(en|zh-CN|ru)\/)?docs(?:\/(.*))?$/);
        const locale = m?.[1] || p.locale, slug = m ? (m[2] || INTRO_SLUG) : p.slug;
        const unit = bySlug.get(slug);
        if (!unit) throw new Error(`Broken link ${p.locale}/${p.slug}: ${url}`);
        if (!inChannel(unit)) throw new Error(`Link to a unit outside ${channel}: ${p.locale}/${p.slug} → ${slug} (stage ${unit.item.stage})`);
        const linked = byKey.get(`${locale}:${slug}`) || byKey.get(`en:${slug}`);
        if (!linked) throw new Error(`Broken link ${p.locale}/${p.slug}: ${url}`);
        const anchor = target.hash ? decodeURI(target.hash) : '';
        if (anchor && !linked.toc.some(h => h.url === anchor)) throw new Error(`Broken anchor: ${url}`);
        node.properties[prop] = url.startsWith('#') ? anchor : pageUrl(linked.locale, linked.slug) + anchor;
      }
    }
    const objects = new Map();
    const putObject = (value, limit, label) => {
      const bytes = encode(value);
      if (bytes.length > limit) throw new Error(`${label} exceeds byte limit (${bytes.length} > ${limit})`);
      const sha256 = digest(bytes); objects.set(sha256, bytes);
      return { sha256, size: bytes.length };
    };
    const manifestPages = pages.map(p => {
      const object = PageObject.parse({ schemaVersion: 3, docId: p.docId, locale: p.locale, slug: p.slug, title: p.title, description: p.description, kind: p.kind, deprecated: p.deprecated, body: p.body, toc: p.toc, structuredData: p.structuredData });
      return { docId: p.docId, locale: p.locale, slug: p.slug, title: p.title, description: p.description, kind: p.kind, deprecated: p.deprecated, object: putObject(object, LIMITS.page, `Page ${p.locale}/${p.slug}`) };
    });
    const search = {};
    for (const locale of LOCALES) {
      const index = SearchIndex.parse({ schemaVersion: 3, channel, locale, pages: pages.filter(p => p.locale === locale).map(p => ({ id: p.docId, title: p.title, url: pageUrl(locale, p.slug), structuredData: p.structuredData })) });
      search[locale] = putObject(index, LIMITS.search, `Search index ${locale}`);
    }
    const manifest = Manifest.parse({ schemaVersion: 3, channel, docsCommit, compiler: { version: '3.0.0', toolchain, themes }, baselines, pages: manifestPages, trees, translations, redirects, assets, search });
    const manifestBytes = encode(manifest);
    if (manifestBytes.length > LIMITS.manifest) throw new Error(`Manifest ${channel} exceeds byte limit (${manifestBytes.length})`);
    channels[channel] = { manifest, manifestBytes, releaseId: digest(manifestBytes), objects, warnings: channelWarnings };
  }
  return { units: all, channels, assetBytes, warnings };
}
