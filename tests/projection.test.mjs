// TC-08: every per-channel projection (pages, trees, translations, redirects, search, assets) describes the same page set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, pageUrl } from '../scripts/compile.mjs';
import { fixtureRepo, intro, cleanup, COMMIT, PNG_1X1 } from './helpers.mjs';

test('TC-08 projections agree per channel; reviewed content, its search entries and its assets stay out of production', async t => {
  const units = [
    intro({ 'zh-CN': {} }),
    { slug: 'p/one', 'zh-CN': {} },
    { slug: 'p/two', 'zh-CN': {}, staleDigest: ['zh-CN'] },
    { slug: 'p/review', stage: 'reviewed', 'zh-CN': {}, en: { body: '## R\n\n![only here](/assets/review.png)\n' } },
  ];
  const root = await fixtureRepo({ units, assets: { 'review.png': PNG_1X1 } }); t.after(() => cleanup(root));
  const result = await compile({ root, docsCommit: COMMIT });
  for (const channel of ['preview', 'production']) {
    const m = result.channels[channel].manifest;
    const pageKeys = new Set(m.pages.map(p => `${p.locale}:${p.slug}`));
    const treeKeys = new Set(Object.values(m.trees).flatMap(t => t.flatMap(g => g.children.map(c => c.key))));
    assert.deepEqual(treeKeys, pageKeys, `${channel} trees`);
    const translationKeys = new Set(Object.entries(m.translations).flatMap(([, locales]) => Object.entries(locales).map(([l, s]) => `${l}:${s}`)));
    assert.deepEqual(translationKeys, pageKeys, `${channel} translations`);
    for (const r of m.redirects) assert.ok(pageKeys.has(`${r.toLocale}:${r.to || 'get-started/introduction'}`), `${channel} redirect target ${JSON.stringify(r)}`);
    for (const [locale, ref] of Object.entries(m.search)) {
      const index = JSON.parse(result.channels[channel].objects.get(ref.sha256));
      assert.deepEqual(new Set(index.pages.map(p => p.url)), new Set(m.pages.filter(p => p.locale === locale).map(p => pageUrl(locale, p.slug))), `${channel} search ${locale}`);
      assert.equal(index.channel, channel);
    }
    const bodyAssets = new Set();
    for (const p of m.pages) { const o = JSON.parse(result.channels[channel].objects.get(p.object.sha256)); (function walk(n) { if (n.tagName === 'img') bodyAssets.add(n.properties.src); for (const c of n.children ?? []) walk(c); })(o.body); }
    assert.deepEqual(new Set(Object.keys(m.assets)), bodyAssets, `${channel} assets`);
  }
  const prod = result.channels.production.manifest, prev = result.channels.preview.manifest;
  assert.ok(!prod.pages.some(p => p.slug === 'p/review')); assert.ok(prev.pages.some(p => p.slug === 'p/review'));
  assert.ok(!Object.keys(prod.assets).includes('/assets/review.png')); assert.ok(Object.keys(prev.assets).includes('/assets/review.png'));
  const prodSearch = JSON.parse(result.channels.production.objects.get(prod.search.en.sha256));
  assert.ok(!prodSearch.pages.some(p => p.id === 'p.review'));
  assert.ok(!prod.pages.some(p => p.locale === 'zh-CN' && p.slug === 'p/two'), 'stale translation excluded');
});
