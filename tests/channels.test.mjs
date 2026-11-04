// TC-03 / TC-04: stage → channel projection, cross-channel links, translations and anchors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../scripts/compile.mjs';
import { fixtureRepo, intro, cleanup, COMMIT } from './helpers.mjs';

const pagesOf = c => c.manifest.pages.map(p => `${p.locale}/${p.slug}`);
const link = (slug, text = 'link') => `## Section\n\nSee [${text}](/docs/${slug}).\n`;

test('TC-03 stages project into channels; published pages may not link outside the channel', async t => {
  const units = [
    intro(), { slug: 'u/one', stage: 'draft' }, { slug: 'u/two', stage: 'reviewed' }, { slug: 'u/three', stage: 'published' }, { slug: 'u/four', stage: 'held' },
    { slug: 'u/five', stage: 'published', en: { body: link('u/two') } }, { slug: 'u/six', stage: 'published', en: { body: link('u/three') } },
  ];
  const root = await fixtureRepo({ units }); t.after(() => cleanup(root));
  const preview = await compile({ root, docsCommit: COMMIT, channels: ['preview'] });
  assert.deepEqual(pagesOf(preview.channels.preview), ['en/get-started/introduction', 'en/u/five', 'en/u/six', 'en/u/three', 'en/u/two']);
  await assert.rejects(compile({ root, docsCommit: COMMIT, channels: ['production'] }), /Link to a unit outside production: en\/u\/five → u\/two \(stage reviewed\)/);
  await assert.rejects(compile({ root, docsCommit: COMMIT }), /outside production/);
});
test('TC-03 without the offending link production holds published pages only; drafts still count for docId uniqueness', async t => {
  const root = await fixtureRepo({ units: [intro(), { slug: 'u/one', stage: 'draft' }, { slug: 'u/two', stage: 'reviewed' }, { slug: 'u/three', stage: 'published' }, { slug: 'u/four', stage: 'held' }, { slug: 'u/six', stage: 'published', en: { body: link('u/three') } }] });
  t.after(() => cleanup(root));
  const result = await compile({ root, docsCommit: COMMIT });
  assert.deepEqual(pagesOf(result.channels.production), ['en/get-started/introduction', 'en/u/six', 'en/u/three']);
  assert.deepEqual(pagesOf(result.channels.preview), ['en/get-started/introduction', 'en/u/six', 'en/u/three', 'en/u/two']);
  for (const c of Object.values(result.channels)) for (const slug of ['u/one', 'u/four']) assert.ok(!pagesOf(c).includes(`en/${slug}`));
  const dup = await fixtureRepo({ units: [intro(), { slug: 'u/one', stage: 'draft', docId: 'shared.id' }, { slug: 'u/three', stage: 'published', docId: 'shared.id' }] });
  t.after(() => cleanup(dup));
  await assert.rejects(compile({ root: dup, docsCommit: COMMIT }), /Duplicate docId: shared.id/);
});
test('TC-03 introduction must be in every channel; an empty channel fails; retired pages get no automatic redirect', async t => {
  const noIntro = await fixtureRepo({ units: [intro({ stage: 'reviewed' }), { slug: 'u/three' }] }); t.after(() => cleanup(noIntro));
  await assert.rejects(compile({ root: noIntro, docsCommit: COMMIT, channels: ['production'] }), /lacks the introduction/);
  assert.ok(await compile({ root: noIntro, docsCommit: COMMIT, channels: ['preview'] }));
  const empty = await fixtureRepo({ units: [intro({ stage: 'draft' }), { slug: 'u/three', stage: 'draft' }] }); t.after(() => cleanup(empty));
  await assert.rejects(compile({ root: empty, docsCommit: COMMIT }), /has no pages/);
  const retired = await fixtureRepo({ units: [intro(), { slug: 'u/old', stage: 'retired' }] }); t.after(() => cleanup(retired));
  const result = await compile({ root: retired, docsCommit: COMMIT });
  for (const c of Object.values(result.channels)) assert.ok(!c.manifest.redirects.some(r => r.from === 'u/old'), 'retired page has no redirect');
});
test('TC-03 explicit redirects: dropped with a warning when the target is outside the channel, error when the target does not exist', async t => {
  const root = await fixtureRepo({ units: [intro(), { slug: 'u/two', stage: 'reviewed' }], redirects: [{ locale: 'en', from: 'u/moved', to: 'u/two', toLocale: 'en', status: 308 }] });
  t.after(() => cleanup(root));
  const result = await compile({ root, docsCommit: COMMIT });
  assert.ok(result.channels.preview.manifest.redirects.some(r => r.from === 'u/moved'));
  assert.ok(!result.channels.production.manifest.redirects.some(r => r.from === 'u/moved'));
  assert.match(result.channels.production.warnings.join('\n'), /Dropped redirect to a page outside production: en\/u\/moved/);
  const dangling = await fixtureRepo({ units: [intro()], redirects: [{ locale: 'en', from: 'u/moved', to: 'u/missing', toLocale: 'en', status: 308 }] });
  t.after(() => cleanup(dangling));
  await assert.rejects(compile({ root: dangling, docsCommit: COMMIT }), /Dangling redirect target/);
});
test('TC-04 stale target translation falls back to the English URL inside the same channel and changes the source object', async t => {
  const fresh = await fixtureRepo({ units: [intro(), { slug: 'u/target', 'zh-CN': {} }, { slug: 'u/source', en: { body: link('u/target') }, 'zh-CN': { body: link('u/target') } }] });
  const stale = await fixtureRepo({ units: [intro(), { slug: 'u/target', 'zh-CN': {}, staleDigest: ['zh-CN'] }, { slug: 'u/source', en: { body: link('u/target') }, 'zh-CN': { body: link('u/target') } }] });
  t.after(() => Promise.all([cleanup(fresh), cleanup(stale)]));
  const [a, b] = await Promise.all([compile({ root: fresh, docsCommit: COMMIT }), compile({ root: stale, docsCommit: COMMIT })]);
  const href = (result, locale) => { const page = result.channels.production.manifest.pages.find(p => p.locale === locale && p.slug === 'u/source'); const object = JSON.parse(result.channels.production.objects.get(page.object.sha256)); let found; (function walk(n) { if (n.tagName === 'a') found = n.properties.href; for (const c of n.children ?? []) walk(c); })(object.body); return { href: found, sha: page.object.sha256 }; };
  assert.equal(href(a, 'zh-CN').href, '/zh-CN/docs/u/target');
  assert.equal(href(b, 'zh-CN').href, '/en/docs/u/target');
  assert.notEqual(href(a, 'zh-CN').sha, href(b, 'zh-CN').sha);
  assert.ok(!b.channels.production.manifest.pages.some(p => p.locale === 'zh-CN' && p.slug === 'u/target'));
  assert.ok(b.channels.production.manifest.redirects.some(r => r.locale === 'zh-CN' && r.from === 'u/target' && r.toLocale === 'en' && r.status === 307));
  assert.match(b.warnings.join('\n'), /Excluded stale translation: zh-CN\/u\/target/);
});
test('TC-04 anchors are validated against the target toc; channel projections share no mutable state', async t => {
  const ok = await fixtureRepo({ units: [intro(), { slug: 'u/target', en: { body: '## Alpha\n\nA.\n' } }, { slug: 'u/source', en: { body: '## S\n\n[a](/docs/u/target#alpha)\n' } }] });
  const broken = await fixtureRepo({ units: [intro(), { slug: 'u/target', en: { body: '## Beta\n\nB.\n' } }, { slug: 'u/source', en: { body: '## S\n\n[a](/docs/u/target#alpha)\n' } }] });
  t.after(() => Promise.all([cleanup(ok), cleanup(broken)]));
  const result = await compile({ root: ok, docsCommit: COMMIT });
  await assert.rejects(compile({ root: broken, docsCommit: COMMIT }), /Broken anchor/);
  // The compiled body shared by both projections is never mutated: its links stay in source form,
  // while each channel's page object carries resolved hrefs. The two channels' objects are separate bytes.
  const hrefsOf = body => { const out = []; (function walk(n) { if (n.tagName === 'a') out.push(n.properties.href); for (const c of n.children ?? []) walk(c); })(body); return out; };
  const source = result.units.find(u => u.slug === 'u/source');
  assert.deepEqual(hrefsOf(source.files.en.body), ['/docs/u/target#alpha'], 'shared compiled AST keeps the unresolved source link');
  for (const channel of ['preview', 'production']) {
    const entry = result.channels[channel].manifest.pages.find(p => p.slug === 'u/source');
    assert.deepEqual(hrefsOf(JSON.parse(result.channels[channel].objects.get(entry.object.sha256)).body), ['/en/docs/u/target#alpha'], `${channel} object has the resolved link`);
  }
  const prodEntry = result.channels.production.manifest.pages.find(p => p.slug === 'u/source');
  const prodBytes = Buffer.from(result.channels.production.objects.get(prodEntry.object.sha256));
  const previewParsed = JSON.parse(result.channels.preview.objects.get(prodEntry.object.sha256)); previewParsed.body.children.length = 0;
  assert.ok(result.channels.production.objects.get(prodEntry.object.sha256).equals(prodBytes), 'parsing and mutating one channel never changes the other channel bytes');
  const before = Buffer.from(result.channels.production.manifestBytes);
  result.channels.preview.manifest.pages[0].title = 'mutated'; result.channels.preview.manifest.trees.en.length = 0;
  assert.ok(result.channels.production.manifestBytes.equals(before));
  assert.notEqual(result.channels.production.manifest.pages[0].title, 'mutated');
});
