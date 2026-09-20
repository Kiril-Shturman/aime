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
Инструкция и команды: ${url}/agent?k=${key}
Дальше бери задачи и отчитывайся по ним сам.`
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
