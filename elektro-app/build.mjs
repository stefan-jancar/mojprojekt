// Poskladá samostatnú aplikáciu Elektro do priečinka www/ (pre Capacitor APK).
// Moduly a štýly berie z hlavnej aplikácie (public/), dáta testov z backend/elektro_data.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WWW = join(HERE, 'www');

rmSync(WWW, { recursive: true, force: true });
mkdirSync(join(WWW, 'js'), { recursive: true });
mkdirSync(join(WWW, 'css'), { recursive: true });
mkdirSync(join(WWW, 'data/elektro/img'), { recursive: true });
mkdirSync(join(WWW, 'vendor'), { recursive: true });

cpSync(join(HERE, 'src/index.html'), join(WWW, 'index.html'));
cpSync(join(HERE, 'src/main.js'), join(WWW, 'js/main.js'));
const VERSION = process.env.ELEKTRO_VERSION || 'dev';
writeFileSync(join(WWW, 'js/version.js'), `export const VERSION = ${JSON.stringify(VERSION)};\n`);
for (const f of ['elektro.js', 'tools.js', 'beckhoff.js', 'cabinet.js', 'press.js', 'icons.js']) cpSync(join(ROOT, 'public/js', f), join(WWW, 'js', f));
for (const f of ['theme.css', 'app.css']) cpSync(join(ROOT, 'public/css', f), join(WWW, 'css', f));
cpSync(join(ROOT, 'public/data/beckhoff.json'), join(WWW, 'data/beckhoff.json'));

// testy a kartičky + katalóg (rovnaký tvar ako /api/elektro na serveri)
const SRC = join(ROOT, 'backend/elektro_data');
const index = [];
for (const f of readdirSync(SRC).sort()) {
  if (!f.endsWith('.json')) continue;
  const d = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
  cpSync(join(SRC, f), join(WWW, 'data/elektro', f));
  if (f.startsWith('test-')) index.push({ kind: 'quiz', id: d.id, title: d.title, count: d.questions.length, topics: [...new Set(d.questions.map((q) => q.topic))], file: f });
  if (f.startsWith('cards-')) index.push({ kind: 'cards', id: d.id, title: d.title, count: d.cards.length, file: f });
}
index.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'quiz' ? -1 : 1));
writeFileSync(join(WWW, 'data/elektro/index.json'), JSON.stringify(index));
cpSync(join(SRC, 'img'), join(WWW, 'data/elektro/img'), { recursive: true });

// pdf.js pre prehliadač PDF (offline)
const pdf = join(HERE, 'node_modules/pdfjs-dist/build');
if (existsSync(pdf)) for (const f of ['pdf.min.js', 'pdf.worker.min.js']) cpSync(join(pdf, f), join(WWW, 'vendor', f));
else console.warn('⚠ pdfjs-dist nie je nainštalovaný – spusti npm install');

console.log(`www/ hotové (verzia ${VERSION}):`, index.map((x) => `${x.kind}:${x.id}`).join(', '));
