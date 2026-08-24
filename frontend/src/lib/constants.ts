export const COLORS = [
  '#2a8bff',
  '#30d158',
  '#bf5af2',
  '#ff9f0a',
  '#ff375f',
  '#64d2ff',
  '#a2845e',
  '#ffd60a',
]

export const KINDS = [
  { id: 'bot', label: 'Бот' },
  { id: 'agent', label: 'ИИ-агент' },
  { id: 'service', label: 'Сервис' },
  { id: 'human', label: 'Человек' },
] as const

export const STAGE_STATUS_LABEL: Record<string, string> = {
  planned: 'Запланирован',
  active: 'В работе',
  done: 'Готово',
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  todo: 'Не начата',
  doing: 'В работе',
  done: 'Готово',
}

export const PROJECT_TYPES = [
  { id: 'project', label: 'Проект' },
  { id: 'process', label: 'Процесс' },
] as const

export const PROCESS_KINDS = [
  {
    id: 'queue',
    label: 'Очередь',
    hint: 'Задачи копятся, агент разбирает по одной',
  },
  {
    id: 'schedule',
    label: 'Расписание',
    hint: 'Повторяется по календарю: каждый день, неделю…',
  },
  {
    id: 'monitoring',
    label: 'Мониторинг',
    hint: 'Проверять и реагировать при изменении',
  },
  {
    id: 'conveyor',
    label: 'Конвейер',
    hint: 'Поток однотипных задач через этапы',
  },
  {
    id: 'regulation',
    label: 'Регламент',
    hint: 'Инструкция «как делаем эту работу»',
  },
] as const

export function processKindLabel(id?: string) {
  return PROCESS_KINDS.find((k) => k.id === id)?.label ?? ''
}

export function repoShort(repo: string): string {
  const m = repo.match(/[:/]([^/:]+\/[^/]+?)(\.git)?$/)
  return m ? m[1] : repo
}

export function repoUrl(repo: string): string {
  const m = repo.match(/^git@([^:]+):(.+?)(\.git)?$/)
  return m ? `https://${m[1]}/${m[2]}` : repo
}

export function kindLabel(id?: string) {
  return KINDS.find((k) => k.id === id)?.label ?? ''
}

// цвета чипов: состояние участника и его вид
export const PILL_TONES: Record<string, string> = {
  work:
    'bg-[#2a8bff]/15 text-[#1477e6] dark:bg-[#2a8bff]/20 dark:text-[#6cb6ff]',
  free: 'bg-black/[.06] text-black/55 dark:bg-white/10 dark:text-white/45',
  bot:
    'bg-[#30d158]/15 text-[#168c3a] dark:bg-[#30d158]/18 dark:text-[#4ee27a]',
  agent:
    'bg-[#bf5af2]/15 text-[#8e44ad] dark:bg-[#bf5af2]/18 dark:text-[#d18cf7]',
  service:
    'bg-[#ff9f0a]/15 text-[#a85f00] dark:bg-[#ff9f0a]/18 dark:text-[#ffb84d]',
  human:
    'bg-[#32ade6]/15 text-[#187ca8] dark:bg-[#64d2ff]/18 dark:text-[#8fdfff]',
}
