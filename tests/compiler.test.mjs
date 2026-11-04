// TC-06: the contract-v2 compiler invariants carried into v3 (syntax allowlist, headings, assets,
// links, drafts, stale translations, injection), all on generated fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compile, encode, stable, syntaxCheck } from '../scripts/compile.mjs';
import { compileBody, themes } from '../scripts/mdx.mjs';
import { codeToTokens } from 'shiki';
import { readFile as readFileAsync } from 'node:fs/promises';
import { fixtureRepo, intro, cleanup, COMMIT, PNG_1X1 } from './helpers.mjs';
import { AstNode, Root, PageObject, safeUrl } from '../contracts/schema.ts';

const page = (result, locale, slug, channel = 'production') => {
  const entry = result.channels[channel].manifest.pages.find(p => p.locale === locale && p.slug === slug);
  return entry && JSON.parse(result.channels[channel].objects.get(entry.object.sha256));
};
test('TC-06 heading ids: repeated, CJK/Cyrillic and Callout headings get stable slugs; duplicates of custom ids fail', async t => {
  const root = await fixtureRepo({ units: [intro({ en: { body: '## Same\n\nA.\n\n## Same\n\nB.\n\n## 中文 标题\n\nC.\n\n## Заголовок\n\nD.\n\n<Callout type="info" title="Note">\n\n## Inside\n\nE.\n\n</Callout>\n' } })] });
  t.after(() => cleanup(root));
  const result = await compile({ root, docsCommit: COMMIT });
  assert.deepEqual(page(result, 'en', 'get-started/introduction').toc.map(h => h.url), ['#same', '#same-1', '#中文-标题', '#заголовок', '#inside']);
  const dup = await fixtureRepo({ units: [intro({ en: { body: '## A [#x]\n\nA.\n\n## B [#x]\n\nB.\n' } })] }); t.after(() => cleanup(dup));
  await assert.rejects(compile({ root: dup, docsCommit: COMMIT }), /Duplicate heading IDs/);
});
test('TC-06 syntax allowlist rejects H1, task lists, math, ESM, expressions, unknown JSX and footnotes', () => {
  for (const source of ['# Title\n', '- [ ] task\n', '$$\nx\n$$\n', 'import x from "y"\n', '{1 + 1}\n', '<Other />\n', 'Text[^1]\n\n[^1]: note\n', '<Callout type="danger">x</Callout>\n', '<Callout type={1}>x</Callout>\n', '1. a\n0. b\n'.replace('1. a\n0. b', '0. zero')]) {
    assert.throws(() => syntaxCheck(source), undefined, `accepted: ${JSON.stringify(source)}`);
  }
  assert.ok(syntaxCheck('## ok\n\n- [link](https://example.com)\n\n<Callout type="warning">\n\nx\n\n</Callout>\n'));
  assert.throws(() => syntaxCheck('inline <Callout type="info">x</Callout> text\n'), /mdxJsxTextElement/);
});
test('TC-06 assets: magic bytes, type, alt text, symlinks and unknown files are enforced; a valid PNG is registered once', async t => {
  const good = await fixtureRepo({ units: [intro({ en: { body: '## H\n\n![One](/assets/a.png)\n\n![Two](/assets/a.png)\n' } })], assets: { 'a.png': PNG_1X1 } }); t.after(() => cleanup(good));
  const result = await compile({ root: good, docsCommit: COMMIT });
  assert.deepEqual(Object.keys(result.channels.production.manifest.assets), ['/assets/a.png']);
  assert.equal(result.assetBytes.size, 1);
  const cases = [
    [{ 'a.png': Buffer.from('not a png') }, '![x](/assets/a.png)', /Invalid PNG/],
    [{ 'a.svg': Buffer.from('<svg/>') }, '![x](/assets/a.svg)', /SVG is not enabled/],
    [{ 'a.png': PNG_1X1 }, '![](/assets/a.png)', /non-empty alt/],
    [{ 'a.png': PNG_1X1 }, '![x](https://example.com/a.png)', /repository assets/],
    [{}, '![x](/assets/missing.png)', /ENOENT|Invalid\/oversized asset/],
  ];
  for (const [assets, markdown, pattern] of cases) {
    const root = await fixtureRepo({ units: [intro({ en: { body: `## H\n\n${markdown}\n` } })], assets }); t.after(() => cleanup(root));
    await assert.rejects(compile({ root, docsCommit: COMMIT }), pattern, markdown);
  }
  const linked = await fixtureRepo({ units: [intro()] }); t.after(() => cleanup(linked));
  await symlink(join(linked, 'content/get-started'), join(linked, 'content/alias'));
  await assert.rejects(compile({ root: linked, docsCommit: COMMIT }), /Symlinks are not allowed/);
  const junk = await fixtureRepo({ units: [intro()] }); t.after(() => cleanup(junk));
  await writeFile(join(junk, 'content/get-started/introduction/notes.txt'), 'x');
  await assert.rejects(compile({ root: junk, docsCommit: COMMIT }), /Unexpected file in unit/);
});
test('TC-06 links: broken targets fail, locale-free links resolve per locale with English fallback, external and anchor links pass through', async t => {
  const root = await fixtureRepo({ units: [intro({ 'zh-CN': {} }), { slug: 'g/a', en: { body: '## A\n\n[intro](/docs) [self](#a) [ext](https://example.com) [mail](mailto:x@y.z)\n' }, 'zh-CN': { body: '## A\n\n[intro](/docs) [other](/docs/g/b)\n' } }, { slug: 'g/b' }] });
  t.after(() => cleanup(root));
  const result = await compile({ root, docsCommit: COMMIT });
  const hrefs = (locale, slug) => { const out = []; (function walk(n) { if (n.tagName === 'a') out.push(n.properties.href); for (const c of n.children ?? []) walk(c); })(page(result, locale, slug).body); return out; };
  assert.deepEqual(hrefs('en', 'g/a'), ['/en/docs', '#a', 'https://example.com', 'mailto:x@y.z']);
  assert.deepEqual(hrefs('zh-CN', 'g/a'), ['/zh-CN/docs', '/en/docs/g/b']);
  const broken = await fixtureRepo({ units: [intro({ en: { body: '## H\n\n[x](/docs/nowhere)\n' } })] }); t.after(() => cleanup(broken));
  await assert.rejects(compile({ root: broken, docsCommit: COMMIT }), /Broken link/);
  const unsafe = await fixtureRepo({ units: [intro({ en: { body: '## H\n\n[x](javascript:alert(1))\n' } })] }); t.after(() => cleanup(unsafe));
  await assert.rejects(compile({ root: unsafe, docsCommit: COMMIT }));
});
test('TC-06 contract injection: unknown Callout props and foreign node shapes are rejected by the schema', () => {
  assert.throws(() => syntaxCheck('<Callout type="info" onClick="x">y</Callout>\n'));
  assert.ok(!AstNode.safeParse({ type: 'element', tagName: 'script', children: [] }).success);
  assert.ok(!AstNode.safeParse({ type: 'element', tagName: 'a', properties: { href: 'https://x', onclick: 'y' }, children: [] }).success);
  assert.ok(!Root.safeParse({ type: 'root', children: [{ type: 'component', name: 'Danger', props: {}, children: [] }] }).success);
});
test('TC-06 encode is key-order stable and compiling twice yields identical manifests and objects', async t => {
  assert.ok(encode({ b: 1, a: [{ d: 1, c: 2 }] }).equals(encode({ a: [{ c: 2, d: 1 }], b: 1 })));
  assert.deepEqual(stable({ z: { y: 1, x: 2 } }), { z: { x: 2, y: 1 } });
  const root = await fixtureRepo({ units: [intro(), { slug: 'g/a', en: { body: '## A\n\n```json\n{"a":1}\n```\n' } }] }); t.after(() => cleanup(root));
  const [a, b] = [await compile({ root, docsCommit: COMMIT }), await compile({ root, docsCommit: COMMIT })];
  for (const channel of ['preview', 'production']) {
    assert.ok(a.channels[channel].manifestBytes.equals(b.channels[channel].manifestBytes));
    assert.deepEqual([...a.channels[channel].objects.keys()].sort(), [...b.channels[channel].objects.keys()].sort());
  }
  const code = page(a, 'en', 'g/a').body.children.find(n => n.type === 'codeBlock');
  assert.equal(code.lang, 'json'); assert.ok(code.colors.length >= 1); assert.equal(code.lines.map(l => l.map(([t]) => t).join('')).join('\n'), '{"a":1}');
});

// ---- v2 regression matrix carried into v3 (plan TC-06) ----
test('TC-06 dangerous URLs including encoded controls and scheme-relative links are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', '/docs/%2e%2e/private', '/docs/%0aevil', 'https://user:pass@example.com', '/docs/\\evil']) assert.equal(safeUrl(url), false, url);
  for (const url of ['/docs/api/overview', '#中文', 'https://cs.cheap/en', 'mailto:help@example.com']) assert.equal(safeUrl(url), true, url);
});
test('TC-06 pending baseline prevents compilation', async t => {
  const root = await fixtureRepo({ units: [intro()] }); t.after(() => cleanup(root));
  const path = join(root, 'baselines/api.json'); const value = JSON.parse(await readFileAsync(path, 'utf8')); value.documentationReview = 'pending'; await writeFile(path, JSON.stringify(value));
  await assert.rejects(compile({ root, docsCommit: COMMIT }), /Unreviewed/);
});
test('TC-06 compact json and bash tokens match direct Shiki output; unknown languages warn; fence metadata is restricted', async () => {
  for (const [lang, value] of [['json', '{ "key": [1, true] }\n'], ['bash', 'curl --help\n  echo "$HOME"']]) {
    const { body } = await compileBody('```' + lang + ' title="Example"\n' + value + '\n```', []);
    const block = body.children[0]; assert.equal(block.title, 'Example');
    const raw = await codeToTokens(value, { lang, themes, defaultColor: false });
    assert.ok(block.colors.length > 0);
    assert.deepEqual(block.lines.map(line => line.map(([content, index]) => ({ content, ...(index === -1 ? {} : block.colors[index]) }))), raw.tokens.map(line => line.map(t => ({ content: t.content, ...(t.htmlStyle?.['--shiki-light'] ? { light: t.htmlStyle['--shiki-light'], dark: t.htmlStyle['--shiki-dark'] } : {}) }))));
  }
  const warnings = []; const { body } = await compileBody('```unknown-language\nplain text\n```', warnings);
  assert.equal(body.children[0].lang, 'text'); assert.equal(warnings.length, 1);
  await assert.rejects(compileBody('```json eval="true"\n{}\n```', []), /metadata/);
});
test('TC-06 Callout supports only literal type and optional title', async () => {
  const { body } = await compileBody('<Callout type="warning" title="Attention">\n\nBody.\n\n</Callout>', []);
  assert.deepEqual(body.children[0].props, { type: 'warning', title: 'Attention' }); assert.equal(body.children[0].children.length, 1);
  for (const source of ['<Callout type="info" title={x} />', '<Callout type="info" type="warning" />', '<Callout {...props} />', '<Callout type={"info"}>x</Callout>']) assert.throws(() => syntaxCheck(source), undefined, source);
});
test('TC-06 the page object contract rejects injected tags, props, unsafe URLs, invalid palettes, unknown components and over-deep trees', async t => {
  const root = await fixtureRepo({ units: [intro()] }); t.after(() => cleanup(root));
  const result = await compile({ root, docsCommit: COMMIT });
  const base = page(result, 'en', 'get-started/introduction');
  assert.ok(PageObject.safeParse(base).success);
  const element = (tagName, properties) => ({ type: 'element', tagName, properties, children: [] });
  const nodes = [
    element('script', {}), element('iframe', {}), element('p', { onClick: 'x' }), element('p', { style: 'color:red' }), element('p', { className: ['x'] }),
    element('a', { href: 'javascript:alert(1)' }), element('a', { href: '/docs/api/overview' }), element('img', { src: 'https://evil.test/a.png', alt: 'x' }),
    { type: 'codeBlock', lang: 'json', colors: [{ light: 'red;background:url(x)', dark: '#000000' }], lines: [[['x', 0]]] },
    { type: 'codeBlock', lang: 'text', colors: [], lines: [[['x', 0]]] },
    { type: 'component', name: 'Unknown', props: { type: 'info' }, children: [] },
    { type: 'component', name: 'Callout', props: { type: 'info', onClick: 'x' }, children: [] },
  ];
  for (const node of nodes) { const candidate = structuredClone(base); candidate.body.children.push(node); assert.equal(PageObject.safeParse(candidate).success, false, JSON.stringify(node)); }
  let nested = { type: 'text', value: 'x' }; for (let i = 0; i < 66; i += 1) nested = { type: 'element', tagName: 'blockquote', children: [nested] };
  const deep = structuredClone(base); deep.body.children = [nested]; assert.equal(PageObject.safeParse(deep).success, false);
  const injected = structuredClone(base); injected.body.children[0].onClick = 'alert(1)'; assert.equal(PageObject.safeParse(injected).success, false);
});
test('TC-06 reference-style images cannot bypass repository asset restrictions', async t => {
  const root = await fixtureRepo({ units: [intro({ en: { body: '## H\n\n![external][image]\n\n[image]: https://example.com/image.png\n' } })] }); t.after(() => cleanup(root));
  await assert.rejects(compile({ root, docsCommit: COMMIT }));
});
