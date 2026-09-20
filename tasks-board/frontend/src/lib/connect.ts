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
) {
  if (sposob === 'promt') {
    return `Подключись к доске задач aiMe — ты там участник «${jmeno}»${role ? ` (${role})` : ''}.

1. Подними у себя адрес, по которому тебя можно разбудить (на него прилетит POST с событием ping).
2. Пришли его доске — это и есть подключение:
   curl -X POST ${url}/api/agent/connect \
     -H "X-Board-Key: ${key}" -H "Content-Type: application/json" \
     -d '{"hook":"<свой адрес>","model":"<своя модель>"}'
3. Инструкция и команды: ${url}/agent?k=${key}

Дальше бери задачи и отчитывайся по ним сам, а по ping — просыпайся и смотри доску.`
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
