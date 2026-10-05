// SessionStart hook: tells the orchestrator session how development work is routed.
// Does not read stdin, so an empty or closed stdin is fine.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..').replaceAll('\\', '/');

const TEXT = [
  "Скилл `j-flow` применяется только к разработке конкретного программного проекта, когда нужен полный цикл от уточнения до приёмки; исследования входят в него только по коду, архитектуре или проверке решения для разработки этого проекта. Слова «сделаем», «почини» и «разберись» сами по себе его не запускают.",
  "Обычные исследования, подбор покупок, сравнение оборудования и бытовая диагностика выполняются напрямую или через профильный скилл, без шагов j-flow. Нахождение в папке с проектами само по себе не основание для запуска. Обсуждение и редактирование правил j-flow не запускают процедуру.",
  "Роли `j-scout`, `j-designer`, `j-implementer`, `j-reviewer`, `j-critic`, `j-tester`, `j-keeper` зовёт контроллер сам по маршруту j-flow; человек их не выбирает.",
  "В каждом проекте j-flow создаёт и обслуживает описание и архитектуру `.j-flow/project.md`, state.md, features/README.md и checks.md. На старте прочитай карту и состояние, создай недостающее даже при существующей .j-flow/. В новом проекте отсутствие кода фиксируется явно. Перед завершением любого прогона хранитель обновляет затронутые документы и открытые вопросы по references/project-documentation.md.",
  `Приёмы TDD, отладки и проверки перед «готово» лежат в \`${skillRoot}/references/\`: build-with-tests.md, debug-problem.md, verify-result.md.`,
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: TEXT,
    },
  }),
);
