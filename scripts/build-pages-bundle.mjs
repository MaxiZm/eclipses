import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';

const repoBase = '/eclipses/';

await build({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  outfile: 'main.js',
  loader: {
    '.css': 'css',
  },
  define: {
    'import.meta.env.BASE_URL': JSON.stringify(repoBase),
  },
});

await mkdir('data', { recursive: true });
await cp('public/data/ne_50m_land.json', 'data/ne_50m_land.json');
await cp('public/favicon.svg', 'favicon.svg');

console.log('Generated main.js/main.css + data/ne_50m_land.json + favicon.svg');
