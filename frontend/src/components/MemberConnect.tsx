import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { BlockTitle, Segmented, SegmentedButton } from 'konsta/react'
import { haptic } from '../lib/telegram'
import type { Member } from '../api/types'

// Чем участник работает. Всё, что понимает MCP, подключается одинаково —
// меняется только место, куда положить настройку.
const TOOLS = [
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex' },
  { id: 'http', label: 'Своё' },
] as const

const CONNECTOR = '~/projects/aime/tasks-board/mcp_board.py'

function snippet(tool: string, url: string, key: string) {
  if (tool === 'claude') {
    return `claude mcp add board \\
  -e BOARD_URL=${url} \\
  -e BOARD_KEY=${key} \\
  -- python3 ${CONNECTOR}`
  }
  if (tool === 'cursor') {
    return `// ~/.cursor/mcp.json
{
  "mcpServers": {
    "board": {
      "command": "python3",
      "args": ["${CONNECTOR}"],
      "env": {
        "BOARD_URL": "${url}",
        "BOARD_KEY": "${key}"
      }
    }
  }
}`
  }
  if (tool === 'codex') {
    return `# ~/.codex/config.toml
[mcp_servers.board]
command = "python3"
args = ["${CONNECTOR}"]
env = { BOARD_URL = "${url}", BOARD_KEY = "${key}" }`
  }
  return `curl -s ${url}/api/state -H "X-Board-Key: ${key}"`
}

export default function MemberConnect({ member }: { member: Member }) {
  const [tool, setTool] = useState<string>('claude')
  const [copied, setCopied] = useState(false)

  if (!member.key) return null
  const text = snippet(tool, location.origin, member.key)

  const copy = async () => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* без буфера — пусть выделяет руками */
    }
  }

  return (
    <>
      <BlockTitle>Чем работает</BlockTitle>
      <div className="px-4 mt-2">
        <Segmented strong rounded>
          {TOOLS.map((t) => (
            <SegmentedButton
              key={t.id}
              active={tool === t.id}
              onClick={() => setTool(t.id)}
              className="!text-[14px] whitespace-nowrap"
            >
              {t.label}
            </SegmentedButton>
          ))}
        </Segmented>

        <div className="relative mt-3">
          <pre className="bg-black/[.05] dark:bg-white/[.06] rounded-2xl p-3 pr-11 text-[12px] leading-snug text-black/80 dark:text-white/80 overflow-x-auto whitespace-pre">
            {text}
          </pre>
          <button
            onClick={copy}
            className="absolute top-2 right-2 p-2 rounded-full bg-black/10 dark:bg-white/10 text-black/70 dark:text-white/70"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>

        <p className="text-black/55 dark:text-white/40 text-[13px] mt-2 leading-snug">
          Ключ личный: по нему доска понимает, кто взял задачу, и не пускает
          посторонних. Отдавать никому не надо.
        </p>
      </div>
    </>
  )
}
