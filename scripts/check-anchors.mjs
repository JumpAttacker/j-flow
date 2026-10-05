/*
 * Проверка якорей `путь:строка` в заметках о фичах (.j-flow/features/*.md).
 * Якорь жив, если файл есть и в нём не меньше строк, чем указано.
 *   node check-anchors.mjs <корень проекта>
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Расширение начинается с буквы: `192.168.31.130:3087` не якорь.
const ANCHOR = /`([\w./-]+\.[A-Za-z]\w*):(\d+)(?:-(\d+))?`/g;

export function checkAnchors(root) {
  const dir = path.join(root, '.j-flow', 'features');
  const ok = [];
  const bad = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(ANCHOR)) {
      const [, rel, a, b] = m;
      const anchor = `${rel}:${a}${b ? `-${b}` : ''}`;
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) {
        bad.push({ anchor, reason: 'нет файла' });
        continue;
      }
      const parts = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      if (parts.at(-1) === '') parts.pop(); // завершающий перевод строки не считается строкой
      const from = Number(a);
      const to = Number(b ?? a);
      if (from < 1 || to < from) bad.push({ anchor, reason: 'пустой или перевёрнутый диапазон' });
      else if (to > parts.length) bad.push({ anchor, reason: `в файле ${parts.length} строк` });
      else ok.push(anchor);
    }
  }
  return { ok, bad };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(process.argv[2] ?? '.');
  const { ok, bad } = checkAnchors(root);
  for (const a of ok) console.log(`ok ${a}`);
  for (const b of bad) console.log(`BAD ${b.anchor} (${b.reason})`);
  console.log(`anchors: ${ok.length} ok, ${bad.length} bad`);
  process.exit(bad.length || !ok.length ? 1 : 0);
}
