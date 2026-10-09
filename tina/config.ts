import { defineConfig, type TinaField } from 'tinacms';

function pageFields(translated: boolean): TinaField[] {
  return [
    { type: 'string', name: 'docId', label: 'Stable document ID', required: true },
    { type: 'string', name: 'title', isTitle: true, required: true },
    { type: 'string', name: 'description', required: true },
    {
      type: 'string', name: 'kind', required: true,
      options: ['tutorial', 'how-to', 'reference', 'explanation'],
    },
    {
      type: 'string', name: 'status', required: true,
      options: ['draft', 'ready', 'deprecated'],
      description: 'Publication also requires navigation and source review checks.',
    },
    {
      type: 'string', name: 'sources', list: true, required: true,
      options: ['spider', 'refinery', 'api', 'frontend'],
    },
    ...(translated ? [
      {
        type: 'string' as const, name: 'translationOf', required: true,
        description: 'The canonical English docId.',
      },
      {
        type: 'string' as const, name: 'sourceDigest', required: true,
        description: 'sha256: followed by the digest of the reviewed English file bytes.',
      },
    ] : []),
    {
      type: 'rich-text', name: 'body', isBody: true,
      templates: [{
        name: 'Callout', label: 'Callout',
        fields: [
          { type: 'string', name: 'type', options: ['info', 'warning'], required: true },
          { type: 'rich-text', name: 'children', isBody: true },
        ],
      }],
    },
  ];
}

export default defineConfig({
  branch: process.env.TINA_PUBLIC_BRANCH || 'master',
  clientId: process.env.TINA_PUBLIC_CLIENT_ID || process.env.CSCHEAP_DOCS_TINA_CLIENT_ID || '',
  token: process.env.CSCHEAP_DOCS_TINA_READ_TOKEN || '',
  telemetry: 'disabled',
  // This repo builds an editor, not a site that consumes a generated SDK.
  client: { skip: true },
  build: { publicFolder: 'public', outputFolder: 'admin' },
  schema: {
    collections: [
      { name: 'docEn', label: 'English (canonical)', path: 'content/en', format: 'mdx', fields: pageFields(false) },
      { name: 'docZhCN', label: '简体中文', path: 'content/zh-CN', format: 'mdx', fields: pageFields(true) },
      { name: 'docRu', label: 'Русский', path: 'content/ru', format: 'mdx', fields: pageFields(true) },
    ],
  },
});
