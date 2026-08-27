// История чатов и генераций. Пока заглушка — потом сюда прилетят реальные
// данные из ChatService (ai-webapi). Разбито по kind: чтобы на HistoryPage
// можно было переключаться между разделами (Все / Проекты / Текст / Картинки
// / Видео / Звук).

export type HistoryKind = 'text' | 'image' | 'video' | 'audio' | 'project'

export interface HistoryTab {
  key: HistoryKind | 'all'
  label: string
}

export const HISTORY_TABS: HistoryTab[] = [
  { key: 'all', label: 'Все' },
  { key: 'project', label: 'Проекты' },
  { key: 'text', label: 'Текст' },
  { key: 'image', label: 'Изображения' },
  { key: 'video', label: 'Видео' },
  { key: 'audio', label: 'Звук' },
]

export interface ChatHistoryItem {
  id: string
  kind: HistoryKind
  // Для text — provider slug из lib/providers.ts (клик ведёт в /chat/:provider).
  // Для остальных — slug каталога GeneratePage (пока просто ссылка на его тайл).
  target: string
  provider: string
  title: string
  preview: string
  time: string
  avatar: string
}

export const CHAT_HISTORY: ChatHistoryItem[] = [
  {
    id: 'h1',
    kind: 'text',
    target: 'chatgpt',
    provider: 'ChatGPT',
    title: 'ChatGPT',
    preview: 'Помоги написать письмо клиенту про перенос сроков…',
    time: '2 ч',
    avatar: '/providers/gpt.png',
  },
  {
    id: 'h2',
    kind: 'text',
    target: 'claude',
    provider: 'Claude',
    title: 'Claude',
    preview: 'Разбор ТЗ на посадочную страницу',
    time: 'вчера',
    avatar: '/providers/claude.png',
  },
  {
    id: 'h3',
    kind: 'text',
    target: 'gemini',
    provider: 'Gemini',
    title: 'Gemini',
    preview: 'Собери мне таблицу по спринтам за неделю',
    time: '3 д',
    avatar: '/providers/gemini.png',
  },
  {
    id: 'h4',
    kind: 'image',
    target: 'midjourney',
    provider: 'Midjourney',
    title: 'Midjourney',
    preview: 'Постер к концерту — тёмный акварельный стиль',
    time: '5 ч',
    avatar: '/providers/midjourney.png',
  },
  {
    id: 'h5',
    kind: 'image',
    target: 'dalle',
    provider: 'DALL·E',
    title: 'DALL·E',
    preview: 'Иконки статусов в flat-стиле',
    time: '2 д',
    avatar: '/providers/dalle.png',
  },
  {
    id: 'h6',
    kind: 'video',
    target: 'sora2',
    provider: 'Sora',
    title: 'Sora',
    preview: 'Промо ролик 12 сек, кофейня утром',
    time: 'вчера',
    avatar: '/providers/sora-optimized.png',
  },
  {
    id: 'h7',
    kind: 'video',
    target: 'veo3',
    provider: 'Veo 3',
    title: 'Veo 3',
    preview: 'Разбор футбольного матча — короткий монтаж',
    time: '4 д',
    avatar: '/providers/veo3.png',
  },
  {
    id: 'h8',
    kind: 'audio',
    target: 'elevenlabs',
    provider: 'ElevenLabs',
    title: 'ElevenLabs',
    preview: 'Озвучка вступления к подкасту, женский голос',
    time: '3 ч',
    avatar: '/providers/elevenlabs.png',
  },
  {
    id: 'h9',
    kind: 'project',
    target: 'aime',
    provider: 'aiMe · tasks-board',
    title: 'aiMe · tasks-board',
    preview: 'Переезд роудмапа с Konsta на F7 Timeline',
    time: 'сегодня',
    avatar: '/providers/gpt.png',
  },
  {
    id: 'h10',
    kind: 'project',
    target: 'ai-webapi',
    provider: 'ai-webapi',
    title: 'ai-webapi',
    preview: 'Разбор структуры бэка — 15 микросервисов',
    time: 'вчера',
    avatar: '/providers/claude.png',
  },
  {
    id: 'h11',
    kind: 'text',
    target: 'deepseek',
    provider: 'DeepSeek',
    title: 'DeepSeek',
    preview: 'Разобрать алгоритм backpressure в этой очереди',
    time: '5 д',
    avatar: '/providers/deepseek.png',
  },
  {
    id: 'h12',
    kind: 'text',
    target: 'perplexity',
    provider: 'Perplexity',
    title: 'Perplexity',
    preview: 'Найди последние публикации про token pricing',
    time: '1 нед',
    avatar: '/providers/perplexity.png',
  },
]
