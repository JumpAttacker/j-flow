import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function git(root, args, accepted = [0]) {
  const result = spawnSync('git', ['-c', 'color.ui=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed (${result.status})`);
  }
  return result.stdout;
}

function contained(root, filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function safePath(root, filename, { cwd = root, missing = false, forbidden = [] } = {}) {
  if (typeof filename !== 'string' || !filename.trim() || filename.includes('\0')) {
    throw new Error('A nonempty repository path is required.');
  }
  const absolute = path.resolve(cwd, filename);
  if (!contained(root, absolute)) throw new Error(`Path is outside the repository: ${filename}`);
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    // A dangling symbolic link must not be treated as an absent ordinary path.
    try {
      if (fs.lstatSync(existing).isSymbolicLink()) throw new Error(`Dangling symbolic link: ${filename}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!missing) throw new Error(`Path does not exist: ${filename}`);
    existing = path.dirname(existing);
  }
  const physical = fs.realpathSync(existing);
  if (!contained(root, physical)) {
    throw new Error(`Path escapes the repository through a symbolic link: ${filename}`);
  }
  if (forbidden.some(directory => contained(directory, absolute) || contained(directory, physical))) {
    throw new Error('Outputs and workspaces cannot write Git metadata.');
  }
  return absolute;
}

export function planContext(plan) {
  if (!plan) throw new Error('A plan path is required.');
  const cwd = fs.realpathSync(process.cwd());
  const root = cwd;
  const gitRoot = fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim());
  const filename = fs.realpathSync(safePath(root, plan, { cwd }));
  if (!fs.statSync(filename).isFile()) throw new Error('The plan must be a file.');
  const relative = path.relative(root, filename).split(path.sep).join('/');
  const metadata = [
    path.join(root, '.git'),
    path.join(gitRoot, '.git'),
    fs.realpathSync(git(gitRoot, ['rev-parse', '--absolute-git-dir']).trim()),
    fs.realpathSync(path.resolve(gitRoot, git(gitRoot, ['rev-parse', '--git-common-dir']).trim())),
  ];
  return { root, gitRoot, filename, relative, cwd, metadata };
}

function writablePath(context, filename) {
  return safePath(context.root, filename, { cwd: context.cwd, missing: true, forbidden: context.metadata });
}

export function workspace(context) {
  const { root, relative } = context;
  const basename = path.basename(relative, path.extname(relative));
  const slug = basename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '') || 'plan';
  const parent = writablePath(context, path.join(root, '.j-flow/sdd'));
  function matches(directory) {
    const ledger = writablePath(context, path.join(directory, 'progress.md'));
    if (!fs.existsSync(ledger)) return false;
    const firstLine = fs.readFileSync(ledger, 'utf8').split(/\r?\n/, 1)[0];
    const identity = firstLine.match(/^# SDD ledger\s*(?::|—)\s*plan:\s*(.+?)\s*$/);
    if (!identity) return false;
    for (const identityRoot of new Set([root, context.gitRoot])) {
      try {
        const recorded = safePath(root, identity[1].replaceAll('\\', '/'), { cwd: identityRoot });
        if (path.relative(context.filename, fs.realpathSync(recorded)) === '') return true;
      } catch {
        // A ledger naming another project cannot establish this plan's identity.
      }
    }
    return false;
  }
  const existing = [];
  if (fs.existsSync(parent)) {
    for (const name of fs.readdirSync(parent).sort()) {
      const directory = writablePath(context, path.join(parent, name));
      if (fs.statSync(directory).isDirectory() && matches(directory)) existing.push(directory);
    }
  }
  if (existing.length > 1) throw new Error('Ambiguous workspace: multiple ledgers match this plan.');
  if (existing.length === 1) return existing[0];
  const hash = createHash('sha256').update(relative).digest('hex').slice(0, 16);
  const directory = writablePath(context, path.join(parent, `${slug}-${hash}`));
  const ledger = writablePath(context, path.join(directory, 'progress.md'));
  if (fs.existsSync(ledger) && !matches(directory)) {
    throw new Error('Workspace ledger belongs to a different or unidentified plan.');
  }
  fs.mkdirSync(directory, { recursive: true });
  writablePath(context, directory);
  if (!fs.existsSync(ledger)) save(context, ledger, `# SDD ledger: plan: ${relative}\n`);
  return directory;
}

export function save(context, output, content) {
  const filename = writablePath(context, output);
  if (fs.existsSync(filename) && !fs.statSync(filename).isFile()) throw new Error('Output must be a file.');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  writablePath(context, path.dirname(filename));
  const temporary = path.join(path.dirname(filename), `.j-flow-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return filename;
}

export function cli(action) {
  try {
    action(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
