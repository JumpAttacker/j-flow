import { cli, planContext, workspace } from './workflow-common.mjs';

cli(args => {
  if (args.length !== 1) throw new Error('Usage: node sdd-workspace.mjs PLAN');
  console.log(workspace(planContext(args[0])));
});
