// Тонкая абстракция отправки сообщения. ШАГ 1 — локальный echo. На Шаге 2
// эта функция превратится в POST /api/AI/chat/completions/stream к Gateway
// ai-webapi с Bearer-токеном из AuthService и парсером SSE, а сигнатура
// (slug, model, messages) останется прежней, чтобы ChatPage не переписывать.

export interface OutgoingMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatReplyChunk {
  text: string
  done: boolean
}

export async function sendMessage(
  _slug: string,
  _modelId: string,
  messages: OutgoingMessage[],
): Promise<string> {
  // ШАГ 1: возвращаем детерминированную заглушку, чтобы UI-флоу можно было
  // проверить руками — печать, отправка, ответ приходит с задержкой,
  // прокрутка донизу. Никаких сетевых запросов.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const echo = lastUser?.content ?? ''
  await new Promise((resolve) => setTimeout(resolve, 400))
  return `Пока это заглушка (${_slug} · ${_modelId}). Ты написал:\n\n"${echo}"`
}
