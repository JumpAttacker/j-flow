import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
