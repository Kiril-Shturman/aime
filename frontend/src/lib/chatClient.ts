// Отправка сообщения в модель. Ключ живёт на сервере: фронт зовёт свой же
// /api/chat, а тот уже ходит в OpenRouter. Сигнатура (slug, model, messages)
// осталась прежней, чтобы ChatPage не переписывать.
import { boardKey, initData } from './telegram'

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
  modelId: string,
  messages: OutgoingMessage[],
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(initData() ? { 'X-Telegram-Init-Data': initData() } : {}),
      ...(boardKey() ? { 'X-Board-Key': boardKey() } : {}),
    },
    body: JSON.stringify({ model: modelId, messages }),
  })

  if (!res.ok) {
    const duvod = await res.text().catch(() => '')
    // показываем причину прямо в чате: так видно, что именно чинить
    throw new Error(duvod.trim() || `модель не ответила (${res.status})`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text?.trim() || 'Модель вернула пустой ответ.'
}
