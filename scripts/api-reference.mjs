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
];
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
      ? v.split(/\n#### (?:Usage|用量|Использование)\n/)[0]
      : clean(v);
  }
  return out;
}
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
      (paths[path] ??= {})[method] = clean(op);
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
    const body = `## ${operation}\n\n\`${method.toUpperCase()} ${path}\`\n\n## ${behavior}\n\n${op.description}\n\n## ${usage}\n\n${code(billing[`${method.toUpperCase()} ${path}`])}\n\n## ${request}\n\n${code(requestSchema)}\n\n## ${responses}\n\n${code(op.responses)}\n\n## ${models}\n\n${code(closure(op, schema.components.schemas))}\n\n[${download}](/assets/openapi-${locale}.json)\n`;
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
