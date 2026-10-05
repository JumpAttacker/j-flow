import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installRoles, parseArgs, renderRole, ROLE_NAMES } from './install-roles.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j-flow-roles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'package with spaces');
  fs.mkdirSync(path.join(packageRoot, 'roles'), { recursive: true });
  for (const name of ROLE_NAMES) fs.writeFileSync(path.join(packageRoot, 'roles', `${name}.md`), `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify('Russian: роль; quotes: "test"')}\n---\nRead @J_FLOW_ROOT@/SKILL.md.\nLine with \\path and \t tab.\n`);
  return { root, packageRoot, home: path.join(root, 'home') };
}

for (const agent of ['zcode', 'claude-code', 'codex']) {
  test(`clean install and repeat are idempotent: ${agent}`, t => {
    const options = { ...fixture(t), agent };
    const first = installRoles(options);
    assert.equal(first.changed, 7);
    const files = fs.readdirSync(first.directory);
    assert.equal(files.length, 7);
    const contents = files.map(file => fs.readFileSync(path.join(first.directory, file), 'utf8'));
    assert.ok(contents.every(content => !content.includes('@J_FLOW_ROOT@')));
    assert.ok(contents.every(content => content.includes('Russian: роль')));
    assert.ok(contents.every(content => !/^model\s*[:=]/m.test(content)));
    assert.equal(installRoles(options).changed, 0);
    assert.deepEqual(files.map(file => fs.readFileSync(path.join(first.directory, file), 'utf8')), contents);
  });
}

test('dry run creates no home or backup', t => {
  const options = { ...fixture(t), agent: 'codex', dryRun: true };
  assert.equal(installRoles(options).changed, 7);
  assert.equal(fs.existsSync(options.home), false);
});

test('one unmanaged conflict prevents every write', t => {
  const options = { ...fixture(t), agent: 'zcode' };
  const directory = path.join(options.home, '.zcode', 'agents');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'j-tester.md'), 'Personal role');
  assert.throws(() => installRoles(options), /Unmanaged role conflict/);
  assert.deepEqual(fs.readdirSync(directory), ['j-tester.md']);
  assert.equal(fs.readFileSync(path.join(directory, 'j-tester.md'), 'utf8'), 'Personal role');
});

test('force preserves differing content in unique backup', t => {
  const options = { ...fixture(t), agent: 'codex' };
  const directory = path.join(options.home, '.codex', 'agents');
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'j-tester.toml');
  fs.writeFileSync(filename, 'Personal role\r\n');
  const first = installRoles({ ...options, force: true });
  assert.equal(fs.readFileSync(path.join(first.backupDirectory, 'j-tester.toml'), 'utf8'), 'Personal role\r\n');
  fs.writeFileSync(filename, 'Second personal role');
  const second = installRoles({ ...options, force: true });
  assert.notEqual(first.backupDirectory, second.backupDirectory);
  assert.equal(fs.readFileSync(path.join(second.backupDirectory, 'j-tester.toml'), 'utf8'), 'Second personal role');
  assert.equal(installRoles({ ...options, force: true }).backupDirectory, null);
});

test('managed roles update without force', t => {
  const options = { ...fixture(t), agent: 'claude-code' };
  installRoles(options);
  fs.appendFileSync(path.join(options.packageRoot, 'roles', 'j-scout.md'), '\nNew instruction.');
  const result = installRoles(options);
  assert.equal(result.changed, 1);
  assert.match(fs.readFileSync(path.join(result.directory, 'j-scout.md'), 'utf8'), /New instruction/);
});

test('missing or malformed source prevents mutation', t => {
  const options = { ...fixture(t), agent: 'zcode' };
  const filename = path.join(options.packageRoot, 'roles', 'j-tester.md');
  fs.writeFileSync(filename, 'No metadata');
  assert.throws(() => installRoles(options), /frontmatter/);
  assert.equal(fs.existsSync(options.home), false);
  fs.unlinkSync(filename);
  assert.throws(() => installRoles(options), /ENOENT/);
  assert.equal(fs.existsSync(options.home), false);
});

test('role symlinks are refused even with force', t => {
  const options = { ...fixture(t), agent: 'zcode' };
  const directory = path.join(options.home, '.zcode', 'agents');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(options.root, 'personal.md');
  fs.writeFileSync(target, 'Keep this');
  try { fs.symlinkSync(target, path.join(directory, 'j-tester.md'), 'file'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS does not permit file symlinks'); throw error; }
  assert.throws(() => installRoles({ ...options, force: true }), /Refusing symlink role/);
  assert.deepEqual(fs.readdirSync(directory), ['j-tester.md']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'Keep this');
});

test('symlink agent directory is refused', t => {
  const options = { ...fixture(t), agent: 'codex' };
  fs.mkdirSync(options.home);
  const target = path.join(options.root, 'personal');
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(options.home, '.codex'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => installRoles({ ...options, force: true }), /Refusing symlink directory/);
  assert.deepEqual(fs.readdirSync(target), []);
});

test('invalid CLI options and home paths are rejected', () => {
  for (const args of [[], ['--agent', 'unknown'], ['--agent'], ['--agent', 'zcode', '--wat'], ['--agent', 'zcode', '--home', 'relative'], ['--agent', 'zcode', '--force', '--force']]) {
    assert.throws(() => parseArgs(args));
  }
  assert.deepEqual(parseArgs(['--agent', 'zcode', '--home', os.tmpdir(), '--force', '--dry-run']), { agent: 'zcode', home: os.tmpdir(), force: true, dryRun: true });
});

test('TOML serialization escapes quotes, controls, backslashes and DEL', () => {
  const rendered = renderRole({ name: 'j-test', description: '"\\\t\r\n\b\f\x7f', body: '😀\nRead @J_FLOW_ROOT@.' }, 'codex', os.tmpdir());
  assert.match(rendered, /description = "\\"\\\\\\t\\r\\n\\b\\f\\u007f"/);
  assert.match(rendered, /😀\\nRead/);
  assert.throws(() => renderRole({ name: 'j-test', description: '\ud800', body: 'text' }, 'codex', os.tmpdir()), /Unicode surrogate/);
});
