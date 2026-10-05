import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('./', import.meta.url));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const slash = value => value.replaceAll('\\', '/');
function diskPath(value) {
  if (process.platform !== 'win32') return value;
  const converted = spawnSync(bash, ['-c', 'cygpath -w -- "$1"', 'path', value], { encoding: 'utf8' });
  assert.equal(converted.status, 0, converted.stderr);
  return converted.stdout.trim();
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'j-flow helpers '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, 'repo with spaces');
  const helpers = path.join(directory, 'package with spaces');
  fs.mkdirSync(repo);
  fs.mkdirSync(helpers);
  for (const name of ['sdd-workspace', 'task-brief', 'review-package']) {
    const copied = path.join(helpers, name);
    fs.copyFileSync(path.join(source, name), copied);
    fs.chmodSync(copied, 0o644);
  }
  function git(...args) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  }
  function write(filename, text) {
    const full = path.join(repo, filename);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  function run(name, ...args) {
    return spawnSync(bash, [slash(path.join(helpers, name)), ...args.map(slash)], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
    });
  }
  function workspace(plan) {
    const result = run('sdd-workspace', plan);
    assert.equal(result.status, 0, result.stderr);
    return diskPath(result.stdout.trim());
  }
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.autocrlf', 'false');
  write('a/plan.md', '# Plan\n\n## Task 1: first\nTask body\n\n## Task 2: second\nOther body\n');
  write('b/plan.md', '# Second plan\n');
  write('task folder/changed.txt', 'before\n');
  write('unrelated.txt', 'unrelated before\n');
  git('add', '.');
  git('commit', '-qm', 'fixture baseline');
  return { directory, repo, helpers, git, write, run, workspace, base: git('rev-parse', 'HEAD') };
}

function packageContents(f, args) {
  const result = f.run('review-package', ...args);
  assert.equal(result.status, 0, result.stderr);
  const dir = f.workspace(args[0]);
  const files = fs.readdirSync(dir).filter(name => name.startsWith('review-working-tree-'));
  assert.equal(files.length, 1);
  return fs.readFileSync(path.join(dir, files[0]), 'utf8');
}

test('same basename plans have independent stable workspaces', t => {
  const f = fixture(t);
  const first = f.workspace('a/plan.md');
  const second = f.workspace('b/plan.md');
  assert.notEqual(first, second);
  assert.equal(f.workspace('a/../a/plan.md'), first);
  assert.equal(f.workspace(slash(path.join(f.repo, 'a/plan.md'))), first);
});

test('legacy workspace is reused only for matching first-line identity', t => {
  const f = fixture(t);
  const legacy = path.join(f.repo, '.j-flow/sdd/plan');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'progress.md'), '# SDD ledger: plan: b/plan.md\n');
  assert.notEqual(f.workspace('a/plan.md'), legacy);
  assert.equal(path.resolve(f.workspace('b/plan.md')), legacy);
});

test('unidentified .superpowers workspace is never borrowed; old identity migrates', t => {
  const f = fixture(t);
  const legacy = path.join(f.repo, '.superpowers/sdd/plan');
  fs.mkdirSync(legacy, { recursive: true });
  assert.notEqual(f.workspace('a/plan.md'), legacy);
  fs.writeFileSync(path.join(legacy, 'progress.md'), '# SDD ledger — plan: a/plan.md\n');
  assert.equal(path.resolve(f.workspace('a/plan.md')), legacy);
});

test('copied 100644 helpers extract exactly one task', t => {
  const f = fixture(t);
  const result = f.run('task-brief', 'a/plan.md', '1');
  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(path.join(f.workspace('a/plan.md'), 'task-1-brief.md'), 'utf8');
  assert.equal(content, '## Task 1: first\nTask body\n\n');
  assert.notEqual(f.run('task-brief', 'a/plan.md', '0').status, 0);
  assert.notEqual(f.run('task-brief', 'a/plan.md', 'oops').status, 0);
  assert.notEqual(f.run('task-brief', 'a/plan.md', '8').status, 0);
});

test('scoped working-tree package includes staged, unstaged, untracked and binary data without mutation', t => {
  const f = fixture(t);
  f.write('task folder/changed.txt', 'staged\n');
  f.git('add', 'task folder/changed.txt');
  f.write('task folder/changed.txt', 'unstaged final\n');
  f.write('task folder/new file.txt', 'untracked content\n');
  f.write('task folder/binary.bin', Buffer.from([0, 1, 2, 3]));
  f.write('unrelated.txt', 'unrelated final\n');
  f.write('outside-new.txt', 'unrelated untracked\n');
  const beforeIndex = fs.readFileSync(path.join(f.repo, '.git/index'));
  const beforeHead = f.git('rev-parse', 'HEAD');
  const text = packageContents(f, ['a/plan.md', f.base, '--working-tree', '--', 'task folder']);
  assert.match(text, /Mode: working-tree/);
  assert.ok(text.includes(f.base));
  assert.match(text, /unstaged final/);
  assert.match(text, /new file.txt/);
  assert.match(text, /untracked content/);
  assert.match(text, /GIT binary patch/);
  assert.match(text, /MM /);
  assert.ok(!text.includes('unrelated final'));
  assert.ok(!text.includes('unrelated untracked'));
  assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git/index')), beforeIndex);
  assert.equal(f.git('rev-parse', 'HEAD'), beforeHead);
});

test('working-tree package captures a staged new file with unstaged edits and deleted files', t => {
  const f = fixture(t);
  f.write('task folder/added.txt', 'added staged\n');
  f.git('add', 'task folder/added.txt');
  f.write('task folder/added.txt', 'added final\n');
  fs.unlinkSync(path.join(f.repo, 'task folder/changed.txt'));
  const text = packageContents(f, ['a/plan.md', f.base, '--working-tree', '--', 'task folder']);
  assert.match(text, /added final/);
  assert.match(text, /deleted file mode/);
});

test('explicit staged-deleted task path is valid even after leaving the index', t => {
  const f = fixture(t);
  f.git('rm', 'task folder/changed.txt');
  const text = packageContents(f, ['a/plan.md', f.base, '--working-tree', '--', 'task folder/changed.txt']);
  assert.match(text, /deleted file mode/);
  assert.match(text, /before/);
});

test('literal wildcard filename does not select unrelated files', t => {
  const f = fixture(t);
  // Windows cannot create filenames containing *, so use a bracketed pathspec on every OS.
  f.write('task folder/[new].txt', 'literal selected\n');
  f.write('task folder/n.txt', 'must not match brackets\n');
  const text = packageContents(f, ['a/plan.md', f.base, '--working-tree', '--', 'task folder/[new].txt']);
  assert.match(text, /literal selected/);
  assert.ok(!text.includes('must not match brackets'));
});

test('working-tree mode rejects empty, outside and invalid scopes', t => {
  const f = fixture(t);
  const external = path.join(f.directory, 'external.txt');
  fs.writeFileSync(external, 'outside');
  for (const scope of [[], [''], ['../external.txt'], [slash(external)], [':(glob)**'], ['task folder', 'no-such-path']]) {
    const result = f.run('review-package', 'a/plan.md', f.base, '--working-tree', '--', ...scope);
    assert.notEqual(result.status, 0, JSON.stringify(scope));
  }
  assert.notEqual(f.run('review-package', 'a/plan.md', f.base, '--working-tree', 'task folder').status, 0);
  assert.notEqual(f.run('review-package', 'a/plan.md', 'invalid-revision', '--working-tree', '--', 'task folder').status, 0);
});

test('committed mode remains usable with copied helpers and explicit output', t => {
  const f = fixture(t);
  f.write('task folder/changed.txt', 'committed result\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'task commit');
  const result = f.run('review-package', 'a/plan.md', f.base, 'HEAD');
  assert.equal(result.status, 0, result.stderr);
  const generated = fs.readdirSync(f.workspace('a/plan.md')).find(name => name.startsWith('review-'));
  assert.match(fs.readFileSync(path.join(f.workspace('a/plan.md'), generated), 'utf8'), /committed result/);
  const explicit = f.run('review-package', 'a/plan.md', f.base, 'HEAD', 'explicit output.diff');
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(fs.readFileSync(path.join(f.repo, 'explicit output.diff'), 'utf8'), /task commit/);
});
