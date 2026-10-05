import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkAnchors } from './check-anchors.mjs';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anchors-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

test('живые якоря проходят, мёртвые ловятся', () => {
  const root = fixture({
    'src/a.js': 'l1\nl2\nl3\n',
    'server.js': 'x\n',
    '.j-flow/features/f.md': [
      '- `src/a.js:2` ok',
      '- `src/a.js:1-3` ok range',
      '- `server.js:1` ok root file',
      '- `src/a.js:9` too far',
      '- `src/missing.js:1` no file',
      '- `src/a.js:2-40` range too far',
    ].join('\n'),
  });
  const r = checkAnchors(root);
  assert.deepEqual(r.ok.sort(), ['server.js:1', 'src/a.js:1-3', 'src/a.js:2']);
  assert.deepEqual(r.bad.map((b) => b.anchor).sort(), ['src/a.js:2-40', 'src/a.js:9', 'src/missing.js:1']);
});

test('граница: строка за последней, ноль, перевёрнутый диапазон, CRLF, IP с портом', () => {
  const root = fixture({
    'x.js': 'one\n',
    'crlf.js': 'a\r\nb\r\n',
    '.j-flow/features/f.md': '`x.js:1` `x.js:2` `x.js:0` `crlf.js:2` `crlf.js:3` `crlf.js:2-1` `192.168.31.130:3087`',
  });
  const r = checkAnchors(root);
  assert.deepEqual(r.ok.sort(), ['crlf.js:2', 'x.js:1']);
  assert.deepEqual(r.bad.map((b) => b.anchor).sort(), ['crlf.js:2-1', 'crlf.js:3', 'x.js:0', 'x.js:2']);
});

test('ни одного якоря — это провал, а не успех', () => {
  const root = fixture({ '.j-flow/features/f.md': 'без якорей' });
  const r = checkAnchors(root);
  assert.equal(r.ok.length + r.bad.length, 0);
});

test('README указателя не сканируется как заметка, но якоря в нём тоже проверяются', () => {
  const root = fixture({ 'a.js': '1\n', '.j-flow/features/README.md': '`a.js:1`' });
  assert.deepEqual(checkAnchors(root).ok, ['a.js:1']);
});

test('карта проекта проверяется даже без папки заметок фич', () => {
  const root = fixture({
    'entry.js': 'run\n',
    '.j-flow/project.md': '`entry.js:1` `gone.js:1` `entry.js:2`',
  });
  const result = checkAnchors(root);
  assert.deepEqual(result.ok, ['entry.js:1']);
  assert.deepEqual(result.bad.map(item => item.anchor).sort(), ['entry.js:2', 'gone.js:1']);
});

test('пустая проверка нового проекта разрешается явно, а битые якоря не скрываются', () => {
  const script = fileURLToPath(new URL('./check-anchors.mjs', import.meta.url));
  const root = fixture({ '.j-flow/project.md': 'Реализация ещё отсутствует.' });
  assert.equal(spawnSync(process.execPath, [script, root]).status, 1);
  const empty = spawnSync(process.execPath, [script, root, '--allow-empty'], { encoding: 'utf8' });
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /N\/A/);
  fs.writeFileSync(path.join(root, '.j-flow/project.md'), '`missing.js:1`');
  assert.equal(spawnSync(process.execPath, [script, root, '--allow-empty']).status, 1);
});

test('проверяется заданное проектом место описания, а отсутствующее и внешнее отклоняются', () => {
  const root = fixture({
    'entry.js': 'run\n',
    '.j-flow/features/f.md': '`entry.js:1`',
    'docs/architecture.md': '`entry.js:2`',
  });
  assert.deepEqual(checkAnchors(root, { projectDocument: 'docs/architecture.md' }).bad.map(item => item.anchor), ['entry.js:2']);
  const script = fileURLToPath(new URL('./check-anchors.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, root, '--project-doc', 'docs/architecture.md']);
  assert.equal(result.status, 1);
  assert.throws(() => checkAnchors(root, { projectDocument: 'missing.md' }), /нет описания/);
  assert.throws(() => checkAnchors(root, { projectDocument: '../outside.md' }), /вне проекта/);
});
