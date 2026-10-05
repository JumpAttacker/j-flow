import fs from 'node:fs';
import path from 'node:path';
import { cli, git, planContext, safePath, save, workspace } from './workflow-common.mjs';

const splitPaths = output => output.split('\0').filter(Boolean);
const literal = filename => `:(literal)${filename}`;
const relativePath = (root, filename) => path.relative(root, filename).split(path.sep).join('/') || '.';
const revision = (root, ref) => git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();

function workingPackage(context, base, inputs) {
  const { root, gitRoot, cwd } = context;
  const scopes = [...new Set(inputs.map(input => {
    if (input.startsWith(':(')) throw new Error('Scopes must be literal repository paths.');
    const filename = safePath(root, input, { cwd, missing: true });
    const relative = relativePath(root, filename);
    if (!fs.existsSync(filename) && !git(gitRoot, ['ls-tree', '-r', '--name-only', '-z', base, '--', literal(relativePath(gitRoot, filename))])) {
      throw new Error(`Scope is absent from both the working tree and base revision: ${input}`);
    }
    return relative;
  }))];
  const paths = scopes.map(filename => literal(relativePath(gitRoot, path.resolve(root, filename))));
  const changed = splitPaths(git(gitRoot, ['diff', '--name-only', '-z', '--no-renames', base, '--', ...paths]));
  const untracked = splitPaths(git(gitRoot, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths]));
  for (const filename of [...changed, ...untracked]) safePath(root, filename, { cwd: gitRoot, missing: true });
  const status = git(gitRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--', ...paths]);
  let patch = git(gitRoot, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', base, '--', ...paths]);
  for (const filename of untracked) {
    // Git treats /dev/null as the empty side of a new-file diff on supported platforms.
    patch += git(gitRoot, ['diff', '--no-index', '--binary', '--no-ext-diff', '--no-textconv', '--', '/dev/null', filename], [0, 1]);
  }
  return `# Review package\nPlan: ${context.relative}\nMode: working-tree\nBase: ${base}\nScope: ${JSON.stringify(scopes)}\n\n## Status\n${status}\n## Changes\n${patch}`;
}

cli(args => {
  const [plan, baseRef, headRef, ...rest] = args;
  const working = headRef === '--working-tree';
  if (!plan || !baseRef || !headRef || (working ? rest[0] !== '--' || rest.length < 2 : rest.length > 1)) {
    throw new Error('Usage: node review-package.mjs PLAN BASE HEAD [OUT] or PLAN BASE --working-tree -- PATH...');
  }
  const context = planContext(plan);
  const base = revision(context.gitRoot, baseRef);
  let content;
  let name;
  if (working) {
    content = workingPackage(context, base, rest.slice(1));
    name = `review-working-tree-${base.slice(0, 12)}.diff`;
  } else {
    const head = revision(context.gitRoot, headRef);
    const project = literal(relativePath(context.gitRoot, context.root));
    const commits = git(context.gitRoot, ['log', '--format=fuller', `${base}..${head}`, '--', project]);
    const patch = git(context.gitRoot, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', base, head, '--', project]);
    content = `# Review package\nPlan: ${context.relative}\nMode: committed\nBase: ${base}\nHead: ${head}\n\n## Commits\n${commits}\n## Changes\n${patch}`;
    name = `review-${base.slice(0, 12)}-${head.slice(0, 12)}.diff`;
  }
  const output = (working ? undefined : rest[0]) ?? path.join(workspace(context), name);
  console.log(save(context, output, content));
});
