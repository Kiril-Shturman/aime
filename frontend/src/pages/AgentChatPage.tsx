import { useNavigate, useParams } from 'react-router-dom'
import { Page } from 'konsta/react'
import ChatPage from './ChatPage'
import { useApp } from '../store/AppStore'

// Чат с агентом — это ровно тот же экран, что и чат с ИИ (ChatPage),
// только собеседник берётся из «Моих агентов», а реплики ходят через
// доску: /api/agents/{id}/chat и /say.
export default function AgentChatPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { state } = useApp()
  const agent = state?.agents?.find((a) => a.id === id) ?? null

  if (!agent) {
    return (
      <Page>
        <div className="px-4 pt-safe-24 text-[15px] text-black/55 dark:text-white/50">
          {state ? 'Такого агента на доске нет.' : 'Загружаем…'}
        </div>
      </Page>
    )
  }

  return (
    <ChatPage
      agentContext={{
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar,
        model: agent.model,
        onBack: () => navigate('/'),
      }}
    />
  )
}
