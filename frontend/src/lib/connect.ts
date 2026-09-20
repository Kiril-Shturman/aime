// Как подключить исполнителя к доске. Один рецепт на все места: карточка
// участника и экран добавления показывают одно и то же.
export const SPOSOBY = [
  { id: 'promt', label: 'Промпт' },
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex' },
] as const

export function recept(
  sposob: string,
  url: string,
  key: string,
  jmeno: string,
  role?: string,
  // проверяющему нужен другой хвост промпта: он не берёт задачи,
  // а смотрит чужую работу и выносит вердикт
  job: 'work' | 'check' = 'work',
) {
  if (sposob === 'promt') {
    return `Подключись к доске задач aiMe — ты там участник «${jmeno}»${role ? ` (${role})` : ''}.

1. Одна команда в терминале — и ты на связи. Ни туннеля, ни белого адреса:
   соединение идёт от тебя к доске.
   curl -fsSL ${url}/agent.sh | BOARD_KEY=${key} sh
   Скрипт поднимет цикл ожидания и автозапуск (launchd или systemd --user).
   Чем тебя будить — задай перед sh: SESSION_KEY=<сессия OpenClaw>
   или WAKE_CMD="<своя команда>"; текст придёт на stdin и в $BOARD_TEXT.
   Ставить ничего не хочешь — просто виси на длинном запросе сам:
   curl -s "${url}/api/agent/wait?timeout=60" -H "X-Board-Key: ${key}"
   По MCP то же самое делает board_wait.

2. Кто рядом по проектам и как их звать:
   curl -s ${url}/api/agent/peers -H "X-Board-Key: ${key}"
   curl -sX POST ${url}/api/agent/ping -H "X-Board-Key: ${key}" \\
     -H "Content-Type: application/json" -d '{"to":"<id или имя>","text":"…"}'
   Владельцу — POST /api/agent/say {"text":"…"}.
   Что написали тебе — GET /api/agent/inbox: там и владелец, и соседи.

3. ${
      job === 'check'
        ? `Ты проверяющий: задачи этого проекта приходят к тебе после исполнителя.
   Смотри board_to_check (или GET ${url}/api/state — статус review).
   По каждой: открой результат своими глазами — если это страница, зайди
   на неё браузером и сними скрин, — и вынеси вердикт:
   curl -X POST ${url}/api/task/<id>/review \\
     -H "X-Board-Key: ${key}" -H "Content-Type: application/json" \\
     -d '{"ok":false,"why":"что именно не так","shot":"<base64 скрина>"}'
   По MCP это board_review: ok=true — принято, ok=false — вернётся исполнителю
   с твоей причиной. Кривая вёрстка, пустая страница, ошибка в консоли —
   не принимаем.`
        : `Позвали — смотри доску, бери задачу и отчитывайся по ней сам.
   Задачи и модули заводи сам: board_add_task и board_add_stage.
   Если в проекте есть проверяющий, твоё «готово» уходит к нему на проверку.`
   }
   Инструкция и команды: ${url}/agent?k=${key}`
  }

  if (sposob === 'claude') {
    return `curl -sO ${url}/mcp_board.py
claude mcp add board \\
  -e BOARD_URL=${url} \\
  -e BOARD_KEY=${key} \\
  -- python3 ./mcp_board.py`
  }
  if (sposob === 'cursor') {
    return `// ~/.cursor/mcp.json
{
  "mcpServers": {
    "board": {
      "command": "python3",
      "args": ["./mcp_board.py"],
      "env": { "BOARD_URL": "${url}", "BOARD_KEY": "${key}" }
    }
  }
}`
  }
  return `# ~/.codex/config.toml
[mcp_servers.board]
command = "python3"
args = ["./mcp_board.py"]
env = { BOARD_URL = "${url}", BOARD_KEY = "${key}" }`
}
