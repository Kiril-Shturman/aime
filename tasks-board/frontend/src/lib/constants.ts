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
