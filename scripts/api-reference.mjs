import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const locales = ['en', 'zh-CN', 'ru'];
const operations = [
  ['get', '/prices', 'prices/get-price'], ['post', '/prices/batch', 'prices/batch-prices'],
  ['get', '/prices/export', 'prices/export-prices'], ['get', '/websites', 'markets/list-markets'],
  ['get', '/websites/{code}', 'markets/get-market'], ['get', '/websites/{code}/fee-schedule', 'markets/get-fees'],
  ['get', '/currencies', 'currencies/list-currencies'], ['get', '/currencies/{currency_id}', 'currencies/get-currency'],
  ['get', '/me', 'account/get-account'], ['get', '/config', 'platform/get-config'],
  ['get', '/endpoints', 'platform/list-endpoints'], ['get', '/health', 'platform/get-health'],
  ['get', '/status', 'platform/get-status'],
  ['get', '/fee-workspace', 'fees/get-fee-workspace'],
  ['get', '/calculation-chains', 'calculation-chains/list-chains'],
  ['post', '/calculation-chains', 'calculation-chains/create-chain'],
  ['get', '/calculation-chains/search', 'calculation-chains/search-chains'],
  ['post', '/calculation-chains/validate', 'calculation-chains/validate-chain'],
  ['post', '/calculation-chains/preview', 'calculation-chains/preview-chain'],
  ['get', '/calculation-chains/{calculation_chain_id}', 'calculation-chains/get-chain'],
  ['put', '/calculation-chains/{calculation_chain_id}', 'calculation-chains/update-chain'],
  ['post', '/calculation-chains/{calculation_chain_id}/deprecate', 'calculation-chains/deprecate-chain'],
  ['get', '/calculation-chains/{calculation_chain_id}/events', 'calculation-chains/list-chain-events'],
  ['post', '/calculation-chains/{calculation_chain_id}/fork', 'calculation-chains/fork-chain'],
  ['get', '/calculation-chains/{calculation_chain_id}/revisions', 'calculation-chains/list-chain-revisions'],
  ['get', '/calculation-chains/{calculation_chain_id}/revisions/{revision}', 'calculation-chains/get-chain-revision'],
  ['get', '/fee-operators', 'fee-operators/list-fee-operators'],
  ['post', '/fee-operators', 'fee-operators/create-fee-operator'],
  ['get', '/fee-operators/{op_id}', 'fee-operators/get-fee-operator'],
  ['put', '/fee-operators/{op_id}', 'fee-operators/update-fee-operator'],
  ['delete', '/fee-operators/{op_id}', 'fee-operators/delete-fee-operator'],
  ['post', '/fee-operators/{op_id}/fork', 'fee-operators/fork-fee-operator'],
  ['get', '/fee-operators/{op_id}/revisions', 'fee-operators/list-fee-operator-revisions'],
  ['get', '/convert-operators', 'convert-operators/list-convert-operators'],
  ['post', '/convert-operators', 'convert-operators/create-convert-operator'],
  ['get', '/convert-operators/{op_id}', 'convert-operators/get-convert-operator'],
  ['put', '/convert-operators/{op_id}', 'convert-operators/update-convert-operator'],
  ['delete', '/convert-operators/{op_id}', 'convert-operators/delete-convert-operator'],
  ['post', '/convert-operators/{op_id}/fork', 'convert-operators/fork-convert-operator'],
  ['get', '/convert-operators/{op_id}/revisions', 'convert-operators/list-convert-operator-revisions'],
  ['get', '/convert-operator-groups', 'convert-groups/list-convert-groups'],
  ['post', '/convert-operator-groups', 'convert-groups/create-convert-group'],
  ['get', '/convert-operator-groups/{op_id}', 'convert-groups/get-convert-group'],
  ['put', '/convert-operator-groups/{op_id}', 'convert-groups/update-convert-group'],
  ['delete', '/convert-operator-groups/{op_id}', 'convert-groups/delete-convert-group'],
  ['post', '/convert-operator-groups/{op_id}/fork', 'convert-groups/fork-convert-group'],
  ['get', '/convert-operator-groups/{op_id}/revisions', 'convert-groups/list-convert-group-revisions'],
  ['get', '/website-calculation-chain-bindings', 'bindings/list-bindings'],
  ['put', '/website-calculation-chain-bindings/{website_code}/{purpose}', 'bindings/set-binding'],
  ['delete', '/website-calculation-chain-bindings/{website_code}/{purpose}', 'bindings/reset-binding'],
  ['get', '/me/currencies', 'my-currencies/list-my-currencies'],
  ['post', '/me/currencies', 'my-currencies/create-my-currency'],
  ['get', '/me/currencies/{code}', 'my-currencies/get-my-currency'],
  ['put', '/me/currencies/{code}', 'my-currencies/update-my-currency'],
  ['delete', '/me/currencies/{code}', 'my-currencies/delete-my-currency'],
];
// Public user docs leave out admin-only content (2026-10-24 ruling): the API keeps it in a trailing
// Administrators section of each operation description, and the `scope` query parameter (whose
// non-default value is administrator-only) is dropped from every scoped operation.
// Same patterns as cscheap-api apps/api/tests/test_api_docs_i18n.py _ADMIN_WORDING.
const adminWording = {
  en: /\bscopes?\b|administrator|platform admin|official_required|no_official_currency|for an official chain/i,
  'zh-CN': /官方范围|个人范围|所在范围|请求的范围|管理员|official_required|no_official_currency|官方计算链只能/,
  ru: /официальн[а-яё]*\s+област|личн[а-яё]*\s+област|вашей\s+области|запрошенной\s+области|администратор|official_required|no_official_currency|для\s+официальной\s+цепочки/i,
};
const sha = value => createHash('sha256').update(value).digest('hex');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const check = process.argv.includes('--check');
async function output(path, value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  if (check) {
    if (await readFile(path, 'utf8') !== bytes) throw new Error(`Generated file differs: ${path}`);
  } else {
    await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, bytes);
  }
}
// Keep only public/user operations and their reachable schema graph. Never copy a full service schema.
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (key.startsWith('x-') || ['example', 'examples', 'externalDocs'].includes(key)) continue;
    out[key] = key === 'description' && typeof v === 'string'
      ? v.split(/\n#### (?:Usage|用量|Использование|Administrators|管理员|Администраторам)\n/)[0]
      : clean(v);
  }
  return out;
}
// Page prose drops bold markers: the Fumadocs structured-data stringifier recurses without end on
// `**…**` (found 2026-10-25). The JSON blocks and the published OpenAPI keep the original text.
const prose = text => text.replace(/\*\*([^*\n]+?)\*\*/g, '$1');
function references(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach(v => references(v, found));
  else if (value && typeof value === 'object') {
    if (value.$ref) {
      if (!value.$ref.startsWith('#/components/schemas/')) throw new Error('Unexpected external schema reference');
      found.add(value.$ref.split('/').at(-1));
    }
    Object.values(value).forEach(v => references(v, found));
  }
  return found;
}
function closure(value, schemas) {
  const needed = references(value);
  for (const key of needed) {
    if (!schemas[key]) throw new Error(`Missing API schema ${key}`);
    references(schemas[key], needed);
  }
  return Object.fromEntries([...needed].sort().map(k => [k, schemas[k]]));
}
const baseline = await read('baselines/api.json');
if (!check) {
  const provenance = await read('.cache/openapi/provenance.json');
  if (provenance.commit !== baseline.commit) throw new Error('API export baseline mismatch');
  for (const locale of locales) {
    const raw = await read(`.cache/openapi/${locale}.json`);
    const eligible = Object.entries(raw.paths).flatMap(([path, methods]) => Object.entries(methods)
      .filter(([, op]) => op['x-cscheap'] && !op['x-cscheap'].hidden &&
        (!op['x-cscheap'].roles.length || op['x-cscheap'].roles.includes('user')))
      .map(([method]) => `${method} ${path}`)).sort();
    if (JSON.stringify(eligible) !== JSON.stringify(operations.map(([m,p]) => `${m} ${p}`).sort()))
      throw new Error('Public API operation set changed; review the documentation scope');
    const paths = {}, billing = {};
    for (const [method, path] of operations) {
      const op = raw.paths[path][method];
      const publicOp = clean(op);
      if (op['x-cscheap'].scoped) {
        publicOp.parameters = (publicOp.parameters ?? []).filter(p => !(p.in === 'query' && p.name === 'scope'));
        if (!publicOp.parameters.length) delete publicOp.parameters;
      }
      (paths[path] ??= {})[method] = publicOp;
      const { credit_cost, premium, recommended_interval_seconds, rate_limit, unit_pricing, roles } = op['x-cscheap'];
      billing[`${method.toUpperCase()} ${path}`] = {
        authentication: roles.length ? 'user-api-key' : 'public', credit_cost, premium,
        recommended_interval_seconds, rate_limit, unit_pricing,
      };
    }
    const schemas = clean(raw.components.schemas);
    const schema = {
      openapi: raw.openapi, info: { title: 'cs.cheap public user API', version: baseline.commit },
      servers: [{ url: 'https://api.cs.cheap' }], paths,
      components: { schemas: closure(paths, schemas), securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'cs.cheap API key' },
      } },
    };
    const leaked = [];
    (function scan(value, at) {
      if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${at}[${i}]`));
      else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => scan(v, `${at}.${k}`));
      else if (typeof value === 'string' && adminWording[locale].test(value)) leaked.push(at);
    })({ paths: schema.paths, components: schema.components.schemas }, locale);
    if (leaked.length) throw new Error(`Admin-only wording in public ${locale} API reference: ${leaked.slice(0, 5).join(', ')}`);
    await output(`openapi/${locale}.json`, schema);
    await output(`openapi/${locale}.billing.json`, billing);
  }
  await output('openapi/provenance.json', { ...await read('.cache/openapi/provenance.json'),
    files: Object.fromEntries(await Promise.all(locales.map(async l => [l, sha(await readFile(`openapi/${l}.json`))]))) });
}
const provenance = await read('openapi/provenance.json');
if (provenance.commit !== baseline.commit) throw new Error('Regenerate API reference after updating its baseline');
const labels = [
  ['Operation', 'Behavior', 'Usage', 'Request', 'Responses', 'Models', 'Download the public OpenAPI schema'],
  ['操作', '行为', '用量', '请求', '响应', '模型', '下载公开 OpenAPI schema'],
  ['Операция', 'Поведение', 'Использование', 'Запрос', 'Ответы', 'Модели', 'Скачать публичную схему OpenAPI'],
];
const english = new Map();
for (const [index, locale] of locales.entries()) {
  const schema = await read(`openapi/${locale}.json`), billing = await read(`openapi/${locale}.billing.json`);
  if (sha(await readFile(`openapi/${locale}.json`)) !== provenance.files[locale]) throw new Error('OpenAPI source digest mismatch');
  const actual = Object.entries(schema.paths).flatMap(([p, ms]) => Object.keys(ms).map(m => `${m} ${p}`)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(operations.map(([m,p]) => `${m} ${p}`).sort())) throw new Error('Unexpected public operation');
  await output(`assets/openapi-${locale}.json`, await readFile(`openapi/${locale}.json`, 'utf8'));
  for (const [method, path, suffix] of operations) {
    const op = schema.paths[path][method], slug = `api/reference/${suffix}`, docId = slug.replaceAll('/', '.');
    const [operation, behavior, usage, request, responses, models, download] = labels[index];
    const requestSchema = { ...(op.parameters ? { parameters: op.parameters } : {}), ...(op.requestBody ? { requestBody: op.requestBody } : {}) };
    const code = value => '```json\n' + JSON.stringify(value, null, 2) + '\n```';
    const body = `## ${operation}\n\n\`${method.toUpperCase()} ${path}\`\n\n## ${behavior}\n\n${prose(op.description)}\n\n## ${usage}\n\n${code(billing[`${method.toUpperCase()} ${path}`])}\n\n## ${request}\n\n${code(requestSchema)}\n\n## ${responses}\n\n${code(op.responses)}\n\n## ${models}\n\n${code(closure(op, schema.components.schemas))}\n\n[${download}](/assets/openapi-${locale}.json)\n`;
    const metadata = {docId, title: op.summary, description: `${method.toUpperCase()} ${path} — ${op.summary}`, kind:'reference',status:'ready',sources:['api']};
    if(index) Object.assign(metadata,{translationOf:docId,sourceDigest:`sha256:${sha(english.get(slug))}`});
    const file = '---\n' + Object.entries(metadata).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n\n' + body;
    if(!index) english.set(slug,file);
    await output(`content/${locale}/${slug}.mdx`,file);
  }
}
function structural(value) {
  if(Array.isArray(value))return value.map(structural);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().filter(k=>!(['description','summary','title'].includes(k)&&typeof value[k]==='string')).map(k=>[k,structural(value[k])]));
}
const englishShape=JSON.stringify(structural(await read('openapi/en.json')));
for(const locale of locales.slice(1))if(JSON.stringify(structural(await read(`openapi/${locale}.json`)))!==englishShape)throw new Error(`Localized API structure differs: ${locale}`);
console.log(`API reference ${check?'verified':'generated'}: ${operations.length} operations × ${locales.length} locales`);
