import fs from 'node:fs';
import path from 'node:path';
import { cli, planContext, save, workspace } from './workflow-common.mjs';

function extractTask(text, number) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const headings = [];
  let fence;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\r?\n$/, '');
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const heading = line.match(/^ {0,3}#{1,6}[ \t]+Task[ \t]+([1-9]\d*)[ \t]*:/);
    if (heading) headings.push({ number: heading[1], index });
  }
  const selected = headings.filter(heading => heading.number === number);
  if (selected.length !== 1) throw new Error(`Expected one Task ${number}; found ${selected.length}.`);
  const position = headings.indexOf(selected[0]);
  return lines.slice(selected[0].index, headings[position + 1]?.index ?? lines.length).join('');
}

cli(args => {
  if (args.length < 2 || args.length > 3 || !/^[1-9]\d*$/.test(args[1])) {
    throw new Error('Usage: node task-brief.mjs PLAN N [OUT]; N must be a positive integer.');
  }
  const context = planContext(args[0]);
  const content = extractTask(fs.readFileSync(context.filename, 'utf8'), args[1]);
  const output = args[2] ?? path.join(workspace(context), `task-${args[1]}-brief.md`);
  console.log(save(context, output, content));
});
