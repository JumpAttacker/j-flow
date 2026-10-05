import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROLE_NAMES = [
  'j-critic', 'j-designer', 'j-implementer', 'j-keeper',
  'j-reviewer', 'j-scout', 'j-tester',
];
const AGENT_DIRS = { zcode: '.zcode', 'claude-code': '.claude', codex: '.codex' };
const MARKER = 'Managed by j-flow role installer.';
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(args) {
  const options = { home: os.homedir(), force: false, dryRun: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--agent' || arg === '--home') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  validateOptions(options);
  return options;
}

function validateOptions({ agent, home }) {
  if (!Object.hasOwn(AGENT_DIRS, agent)) {
    throw new Error('Use --agent zcode, claude-code, or codex.');
  }
  if (typeof home !== 'string' || !path.isAbsolute(home)) {
    throw new Error('--home must be an absolute path.');
  }
}

export function loadRoles(packageRoot) {
  return ROLE_NAMES.map(name => {
    const filename = path.join(packageRoot, 'roles', `${name}.md`);
    const source = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`Missing role frontmatter: ${filename}`);
    const metadata = {};
    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^(name|description):\s*(".*")\s*$/);
      if (!field || Object.hasOwn(metadata, field[1])) {
        throw new Error(`Invalid role frontmatter: ${filename}`);
      }
      metadata[field[1]] = JSON.parse(field[2]);
    }
    if (metadata.name !== name || typeof metadata.description !== 'string' || !metadata.description.trim()) {
      throw new Error(`Invalid name or description: ${filename}`);
    }
    const body = match[2].trim();
    if (!body) throw new Error(`Empty role instructions: ${filename}`);
    return { ...metadata, body };
  });
}

function tomlString(value) {
  // TOML basic strings accept JSON's escapes, but require Unicode scalar values.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Unpaired Unicode surrogate in role.');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Unpaired Unicode surrogate in role.');
  }
  return JSON.stringify(value).replace(/\u007f/g, '\\u007f');
}

export function renderRole(role, agent, packageRoot) {
  const body = role.body.replaceAll('@J_FLOW_ROOT@', path.resolve(packageRoot).replaceAll('\\', '/'));
  if (agent === 'codex') {
    return `# ${MARKER}\nname = ${tomlString(role.name)}\ndescription = ${tomlString(role.description)}\ndeveloper_instructions = ${tomlString(body)}\n`;
  }
  if (agent !== 'zcode' && agent !== 'claude-code') throw new Error(`Unknown agent: ${agent}`);
  return `---\nname: ${JSON.stringify(role.name)}\ndescription: ${JSON.stringify(role.description)}\n---\n<!-- ${MARKER} -->\n\n${body}\n`;
}

function lstat(filename) {
  try { return fs.lstatSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function checkDirectory(filename) {
  const stat = lstat(filename);
  if (stat?.isSymbolicLink()) throw new Error(`Refusing symlink directory: ${filename}`);
  if (stat && !stat.isDirectory()) throw new Error(`Not a directory: ${filename}`);
}

function isManaged(content, agent) {
  if (agent === 'codex') return content.startsWith(`# ${MARKER}\n`);
  return /^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(content)
    && content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').startsWith(`<!-- ${MARKER} -->\n`);
}

function atomicWrite(filename, content) {
  const temporary = `${filename}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function installRoles({ agent, home = os.homedir(), force = false, dryRun = false, packageRoot = DEFAULT_ROOT }) {
  validateOptions({ agent, home });
  const roles = loadRoles(packageRoot);
  const agentDirectory = path.join(home, AGENT_DIRS[agent]);
  const directory = path.join(agentDirectory, 'agents');
  checkDirectory(home);
  checkDirectory(agentDirectory);
  checkDirectory(directory);
  const plans = roles.map(role => {
    const filename = path.join(directory, `${role.name}.${agent === 'codex' ? 'toml' : 'md'}`);
    const content = renderRole(role, agent, packageRoot);
    const stat = lstat(filename);
    if (stat?.isSymbolicLink()) throw new Error(`Refusing symlink role: ${filename}`);
    if (stat && !stat.isFile()) throw new Error(`Not a regular role file: ${filename}`);
    const previous = stat ? fs.readFileSync(filename) : null;
    const same = previous !== null && previous.equals(Buffer.from(content));
    if (previous !== null && !same && !force && !isManaged(previous.toString('utf8'), agent)) {
      throw new Error(`Unmanaged role conflict: ${filename}. Use --force to back up and replace it.`);
    }
    return { filename, content, previous, same };
  });
  const changed = plans.filter(plan => !plan.same);
  const backups = force ? changed.filter(plan => plan.previous !== null) : [];
  let backupDirectory = null;
  if (backups.length) {
    const backupRoot = path.join(home, '.j-flow-backups');
    checkDirectory(backupRoot);
    backupDirectory = path.join(backupRoot, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`, agent);
  }
  if (!dryRun && changed.length) {
    if (backupDirectory) {
      fs.mkdirSync(backupDirectory, { recursive: true });
      for (const plan of backups) fs.writeFileSync(path.join(backupDirectory, path.basename(plan.filename)), plan.previous, { flag: 'wx' });
    }
    fs.mkdirSync(directory, { recursive: true });
    for (const plan of changed) atomicWrite(plan.filename, plan.content);
  }
  return { agent, directory, changed: changed.length, unchanged: plans.length - changed.length, backupDirectory, dryRun };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = installRoles(parseArgs(process.argv.slice(2)));
    console.log(`${result.dryRun ? 'Would install' : 'Installed'} ${result.changed} roles for ${result.agent}; ${result.unchanged} unchanged.`);
    if (result.backupDirectory) console.log(`Backups${result.dryRun ? ' planned' : ''}: ${result.backupDirectory}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
