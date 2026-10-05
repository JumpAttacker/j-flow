import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('./', import.meta.url));
const slash = value => value.replaceAll('\\', '/');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'j-flow helpers '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, 'repo with spaces');
  const helpers = path.join(directory, 'package with spaces');
  fs.mkdirSync(repo);
  fs.mkdirSync(helpers);
  for (const name of ['sdd-workspace.mjs', 'task-brief.mjs', 'review-package.mjs', 'workflow-common.mjs']) {
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
  function runAt(cwd, name, ...args) {
    return spawnSync(process.execPath, [path.join(helpers, `${name}.mjs`), ...args], {
      cwd, encoding: 'utf8',
    });
  }
  function run(name, ...args) {
    return runAt(repo, name, ...args);
  }
  function workspace(plan) {
    const result = run('sdd-workspace', plan);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
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
  return { directory, repo, helpers, git, write, run, runAt, workspace, base: git('rev-parse', 'HEAD') };
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

test('own legacy ledger needs identity and preserves its matching alternate header', t => {
  const f = fixture(t);
  const legacy = path.join(f.repo, '.j-flow/sdd/plan');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'progress.md'), '# Unidentified ledger\nManual note\n');
  assert.notEqual(f.workspace('b/plan.md'), legacy);
  const recorded = '# SDD ledger — plan: a/plan.md\nManual note\n';
  fs.writeFileSync(path.join(legacy, 'progress.md'), recorded);
  assert.equal(path.resolve(f.workspace('a/plan.md')), legacy);
  assert.equal(fs.readFileSync(path.join(legacy, 'progress.md'), 'utf8'), recorded);
});

for (const identityFormat of ['relative', 'absolute']) {
  test(`matching existing hashed workspace resumes its ${identityFormat} plan identity`, t => {
    const f = fixture(t);
    const selected = path.join(f.repo, '.j-flow/sdd/plan-12345678');
    const other = path.join(f.repo, '.j-flow/sdd/plan-abcdef01');
    fs.mkdirSync(selected, { recursive: true });
    fs.mkdirSync(other, { recursive: true });
    const identity = identityFormat === 'relative' ? 'a/../a/plan.md' : `${slash(f.repo)}/a/../a/plan.md`;
    const recorded = `# SDD ledger: plan: ${identity}\nManual checkpoint\n`;
    fs.writeFileSync(path.join(selected, 'progress.md'), recorded);
    fs.writeFileSync(path.join(other, 'progress.md'), '# SDD ledger: plan: b/plan.md\nOther checkpoint\n');
    assert.equal(path.resolve(f.workspace('a/plan.md')), selected);
    assert.equal(fs.readFileSync(path.join(selected, 'progress.md'), 'utf8'), recorded);
    assert.equal(fs.readFileSync(path.join(other, 'progress.md'), 'utf8'), '# SDD ledger: plan: b/plan.md\nOther checkpoint\n');
    assert.equal(fs.readdirSync(path.join(f.repo, '.j-flow/sdd')).length, 2);
  });
}

test('multiple matching workspace ledgers are rejected without choosing or overwriting', t => {
  const f = fixture(t);
  const snapshots = [];
  for (const [name, identity] of [
    ['plan-11111111', 'a/../a/plan.md'],
    ['plan-22222222', slash(path.join(f.repo, 'a/plan.md'))],
  ]) {
    const directory = path.join(f.repo, '.j-flow/sdd', name);
    fs.mkdirSync(directory, { recursive: true });
    const ledger = path.join(directory, 'progress.md');
    const content = `# SDD ledger — plan: ${identity}\nManual state for ${name}\n`;
    fs.writeFileSync(ledger, content);
    snapshots.push([ledger, content]);
  }
  const result = f.run('sdd-workspace', 'a/plan.md');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ambiguous|multiple/i);
  for (const [ledger, content] of snapshots) assert.equal(fs.readFileSync(ledger, 'utf8'), content);
  assert.equal(fs.readdirSync(path.join(f.repo, '.j-flow/sdd')).length, 2);
});

test('copied 100644 Node helpers extract exactly one task', t => {
  const f = fixture(t);
  const result = f.run('task-brief', 'a/plan.md', '1');
  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(path.join(f.workspace('a/plan.md'), 'task-1-brief.md'), 'utf8');
  assert.equal(content, '## Task 1: first\nTask body\n\n');
  assert.notEqual(f.run('task-brief', 'a/plan.md', '0').status, 0);
  assert.notEqual(f.run('task-brief', 'a/plan.md', 'oops').status, 0);
  assert.notEqual(f.run('task-brief', 'a/plan.md', '8').status, 0);
});

test('task extraction ignores fenced headings and preserves exact task bytes', t => {
  const f = fixture(t);
  const first = '## Task 1: real\r\nBody\r\n```md\r\n## Task 2: fenced\r\n```\r\n~~~\r\n## Task 3: also fenced\r\n~~~\r\n\r\n';
  f.write('a/plan.md', '# Plan\r\n\r\n```\r\n## Task 1: false\r\n```\r\n' + first + '## Task 2: next\r\nNext body\r\n');
  const output = 'exact brief.md';
  const result = f.run('task-brief', 'a/plan.md', '1', output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(f.repo, output), 'utf8'), first);
});

test('adjacent third-level task headings produce separate exact briefs', t => {
  const f = fixture(t);
  const first = '### Task 1: first\nFirst body\n\n';
  const second = '### Task 2: second\nSecond body\n';
  f.write('a/plan.md', '# Plan\n\n' + first + second);
  for (const [number, expected] of [['1', first], ['2', second]]) {
    const result = f.run('task-brief', 'a/plan.md', number, `brief-${number}.md`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(f.repo, `brief-${number}.md`), 'utf8'), expected);
  }
});

test('task extraction failure never overwrites an existing output', t => {
  const f = fixture(t);
  f.write('kept brief.md', 'manual work\n');
  for (const number of ['0', 'oops', '8']) {
    assert.notEqual(f.run('task-brief', 'a/plan.md', number, 'kept brief.md').status, 0);
    assert.equal(fs.readFileSync(path.join(f.repo, 'kept brief.md'), 'utf8'), 'manual work\n');
  }
  f.write('a/plan.md', '## Task 1: first\nBody\n## Task 1: duplicate\nOther\n');
  assert.notEqual(f.run('task-brief', 'a/plan.md', '1', 'kept brief.md').status, 0);
  assert.equal(fs.readFileSync(path.join(f.repo, 'kept brief.md'), 'utf8'), 'manual work\n');
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

test('working-tree mode rejects scopes escaping through directory symlinks', t => {
  const f = fixture(t);
  const outside = path.join(f.directory, 'external directory');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'private.txt'), 'outside content\n');
  fs.symlinkSync(outside, path.join(f.repo, 'task folder/escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const scope of ['task folder/escape', 'task folder/escape/private.txt', 'task folder']) {
    const result = f.run('review-package', 'a/plan.md', f.base, '--working-tree', '--', scope);
    assert.notEqual(result.status, 0, scope);
    assert.ok(!result.stdout.includes('outside content'));
  }
});

test('workspace and explicit outputs cannot escape through directory symlinks', t => {
  const f = fixture(t);
  const outside = path.join(f.directory, 'external directory');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'brief.md'), 'keep outside\n');
  fs.symlinkSync(outside, path.join(f.repo, 'output escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(f.run('task-brief', 'a/plan.md', '1', 'output escape/brief.md').status, 0);
  assert.equal(fs.readFileSync(path.join(outside, 'brief.md'), 'utf8'), 'keep outside\n');
  fs.symlinkSync(outside, path.join(f.repo, '.j-flow'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(f.run('sdd-workspace', 'a/plan.md').status, 0);
  assert.deepEqual(fs.readdirSync(outside), ['brief.md']);
});

test('internal plan aliases share identity and external plan aliases are rejected', t => {
  const f = fixture(t);
  fs.symlinkSync(path.join(f.repo, 'a'), path.join(f.repo, 'plan alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(f.workspace('plan alias/plan.md'), f.workspace('a/plan.md'));
  const outside = path.join(f.directory, 'external plans');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'plan.md'), '## Task 1: external\n');
  fs.symlinkSync(outside, path.join(f.repo, 'external plan alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(f.run('sdd-workspace', 'external plan alias/plan.md').status, 0);
});

test('explicit outputs and workspace aliases cannot write Git metadata', t => {
  const f = fixture(t);
  const index = fs.readFileSync(path.join(f.repo, '.git/index'));
  const head = fs.readFileSync(path.join(f.repo, '.git/HEAD'));
  for (const output of ['.git/index', '.git/HEAD']) {
    assert.notEqual(f.run('task-brief', 'a/plan.md', '1', output).status, 0, output);
    assert.notEqual(f.run('review-package', 'a/plan.md', f.base, 'HEAD', output).status, 0, output);
  }
  fs.symlinkSync(path.join(f.repo, '.git'), path.join(f.repo, '.j-flow'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(f.run('sdd-workspace', 'a/plan.md').status, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git/index')), index);
  assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git/HEAD')), head);
  assert.ok(!fs.existsSync(path.join(f.repo, '.git/sdd')));
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

test('nested selected project keeps its workspace and rejects sibling plans, scopes and outputs', t => {
  const f = fixture(t);
  f.write('selected/plan.md', '### Task 1: local\nLocal task\n');
  f.write('selected/data.txt', 'selected before\n');
  f.write('sibling/plan.md', '### Task 1: sibling\n');
  f.write('sibling/data.txt', 'sibling before\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'nested projects');
  const base = f.git('rev-parse', 'HEAD');
  const selected = path.join(f.repo, 'selected');
  const ledgerDirectory = path.join(selected, '.j-flow/sdd/plan-legacy123');
  fs.mkdirSync(ledgerDirectory, { recursive: true });
  const checkpoint = '# SDD ledger: plan: selected/plan.md\nExisting checkpoint\n';
  fs.writeFileSync(path.join(ledgerDirectory, 'progress.md'), checkpoint);
  f.write('selected/data.txt', 'selected staged\n');
  f.git('add', 'selected/data.txt');
  f.write('selected/data.txt', 'selected final\n');
  f.write('selected/new file.txt', 'selected untracked\n');
  f.write('sibling/data.txt', 'sibling private change\n');
  f.write('sibling/kept brief.md', 'manual sibling work\n');
  const beforeIndex = fs.readFileSync(path.join(f.repo, '.git/index'));
  const beforeHead = fs.readFileSync(path.join(f.repo, '.git/HEAD'));
  const workspace = f.runAt(selected, 'sdd-workspace', 'plan.md');
  assert.equal(workspace.status, 0, workspace.stderr);
  assert.equal(path.resolve(workspace.stdout.trim()), ledgerDirectory);
  assert.equal(fs.readFileSync(path.join(ledgerDirectory, 'progress.md'), 'utf8'), checkpoint);
  assert.ok(!fs.existsSync(path.join(f.repo, '.j-flow')));
  const review = f.runAt(selected, 'review-package', 'plan.md', base, '--working-tree', '--', 'data.txt', 'new file.txt');
  assert.equal(review.status, 0, review.stderr);
  assert.equal(path.dirname(review.stdout.trim()), ledgerDirectory);
  const contents = fs.readFileSync(review.stdout.trim(), 'utf8');
  assert.match(contents, /selected final/);
  assert.match(contents, /selected untracked/);
  assert.ok(!contents.includes('sibling private change'));
  for (const plan of ['../sibling/plan.md', path.join(f.repo, 'sibling/plan.md')]) {
    assert.notEqual(f.runAt(selected, 'sdd-workspace', plan).status, 0, plan);
  }
  for (const scope of ['../sibling/data.txt', path.join(f.repo, 'sibling/data.txt')]) {
    assert.notEqual(f.runAt(selected, 'review-package', 'plan.md', base, '--working-tree', '--', scope).status, 0, scope);
  }
  for (const output of ['../sibling/kept brief.md', path.join(f.repo, 'sibling/kept brief.md')]) {
    assert.notEqual(f.runAt(selected, 'task-brief', 'plan.md', '1', output).status, 0, output);
    assert.notEqual(f.runAt(selected, 'review-package', 'plan.md', base, 'HEAD', output).status, 0, output);
  }
  assert.equal(fs.readFileSync(path.join(f.repo, 'sibling/kept brief.md'), 'utf8'), 'manual sibling work\n');
  assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git/index')), beforeIndex);
  assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git/HEAD')), beforeHead);
  assert.equal(f.git('rev-parse', 'HEAD'), base);
});

test('nested committed review includes only the selected project diff and commit history', t => {
  const f = fixture(t);
  f.write('selected/plan.md', '### Task 1: local\n');
  f.write('selected/data.txt', 'selected before\n');
  f.write('sibling/data.txt', 'sibling before\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'nested baseline');
  const base = f.git('rev-parse', 'HEAD');
  f.write('selected/data.txt', 'selected committed\n');
  f.git('add', 'selected/data.txt');
  f.git('commit', '-qm', 'selected task commit');
  f.write('sibling/data.txt', 'sibling committed secret\n');
  f.git('add', 'sibling/data.txt');
  f.git('commit', '-qm', 'sibling task commit');
  const beforeIndex = fs.readFileSync(path.join(f.repo, '.git/index'));
  const beforeHead = f.git('rev-parse', 'HEAD');
  const selected = path.join(f.repo, 'selected');
  const result = f.runAt(selected, 'review-package', 'plan.md', base, 'HEAD', 'local review.diff');
  assert.equal(result.status, 0, result.stderr);
  const contents = fs.readFileSync(path.join(selected, 'local review.diff'), 'utf8');
  assert.match(contents, /selected committed/);
  assert.match(contents, /selected task commit/);
  assert.ok(!contents.includes('sibling committed secret'));
  assert.ok(!contents.includes('sibling task commit'));
  assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git/index')), beforeIndex);
  assert.equal(f.git('rev-parse', 'HEAD'), beforeHead);
});
