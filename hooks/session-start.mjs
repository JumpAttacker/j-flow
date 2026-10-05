// SessionStart hook: tells the orchestrator session how development work is routed.
// Does not read stdin, so an empty or closed stdin is fine.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..').replaceAll('\\', '/');

const TEXT = [
  "Скилл `j-flow` применяется только к разработке конкретного программного проекта, когда нужен полный цикл от уточнения до приёмки; исследования входят в него только по коду, архитектуре или проверке решения для разработки этого проекта. Слова «сделаем», «почини» и «разберись» сами по себе его не запускают.",
  "Обычные исследования, подбор покупок, сравнение оборудования и бытовая диагностика выполняются напрямую или через профильный скилл, без шагов j-flow. Нахождение в папке с проектами само по себе не основание для запуска. Обсуждение и редактирование правил j-flow не запускают процедуру.",
  "Роли `j-scout`, `j-designer`, `j-implementer`, `j-reviewer`, `j-critic`, `j-tester`, `j-keeper` зовёт контроллер сам по маршруту j-flow; человек их не выбирает.",
  "Для выбранной задачи разработки прочитай `.j-flow/state.md`, если он есть в проекте. Если j-flow применим, но `.j-flow/` нет, первая задача включает онбординг (`onboard.md` в скилле).",
  `Приёмы TDD, отладки и проверки перед «готово» лежат в \`${skillRoot}/references/\`: test-driven-development.md, systematic-debugging.md, verification-before-completion.md.`,
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: TEXT,
    },
  }),
);
