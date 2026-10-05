/*
 * Проверка якорей `путь:строка` в карте проекта и заметках о фичах.
 * Якорь жив, если файл есть и в нём не меньше строк, чем указано.
 *   node check-anchors.mjs ROOT [--project-doc PATH] [--allow-empty]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Расширение начинается с буквы: `192.168.31.130:3087` не якорь.
const ANCHOR = /`([\w./-]+\.[A-Za-z]\w*):(\d+)(?:-(\d+))?`/g;

export function checkAnchors(root, { projectDocument } = {}) {
  const dir = path.join(root, '.j-flow', 'features');
  const ok = [];
  const bad = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  const documents = files.map(file => path.join(dir, file));
  const project = path.resolve(root, projectDocument ?? '.j-flow/project.md');
  const inside = candidate => {
    const relative = path.relative(path.resolve(root), candidate);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!inside(project)) throw new Error('Описание находится вне проекта');
  if (projectDocument && !fs.existsSync(project)) throw new Error('нет описания по заданному пути');
  if (fs.existsSync(project)) {
    const realRoot = fs.realpathSync(root);
    const realProject = fs.realpathSync(project);
    const relative = path.relative(realRoot, realProject);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Описание находится вне проекта');
    documents.unshift(project);
  }
  for (const document of documents) {
    const text = fs.readFileSync(document, 'utf8');
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
  try {
    const root = path.resolve(process.argv[2] ?? '.');
    const args = process.argv.slice(3);
    const options = {};
    let allowEmpty = false;
    while (args.length) {
      const flag = args.shift();
      if (flag === '--allow-empty') allowEmpty = true;
      else if (flag === '--project-doc' && args[0] && !args[0].startsWith('--')) options.projectDocument = args.shift();
      else throw new Error('usage: check-anchors.mjs ROOT [--project-doc PATH] [--allow-empty]');
    }
    const { ok, bad } = checkAnchors(root, options);
    for (const a of ok) console.log(`ok ${a}`);
    for (const b of bad) console.log(`BAD ${b.anchor} (${b.reason})`);
    console.log(`anchors: ${ok.length} ok, ${bad.length} bad`);
    if (!ok.length && !bad.length && allowEmpty) console.log('N/A: проверяемых якорей нет; устройство проекта этой проверкой не подтверждено.');
    process.exitCode = bad.length || (!ok.length && !allowEmpty) ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
