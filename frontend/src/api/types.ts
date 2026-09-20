export type MemberKind = 'bot' | 'agent' | 'service' | 'human'
export type StageStatus = 'planned' | 'active' | 'done'
export type TaskStatus = 'todo' | 'doing' | 'review' | 'blocked' | 'done'
// что участник делает в проекте: работает или проверяет чужую работу
export type MemberJob = 'work' | 'check'

// бот, которым доска реально управляет: токен лежит на сервере, сюда не едет
export interface BotLink {
  connected: boolean
  username: string
  name: string
  bot_id?: number
  since?: number
}

export interface Member {
  id: string
  name: string
  handle?: string
  role?: string
  kind: MemberKind
  avatar?: string
  key?: string   // личный ключ исполнителя, виден только владельцу
  bot?: BotLink | null
  seen?: number   // когда исполнитель последний раз выходил на связь, unix-секунды
  client?: string // чем подключён: Claude Code, Cursor, OpenClaw…
  model?: string  // какой моделью работает
  ping?: number   // когда владелец звал его в последний раз
  projects?: string[] // у общих агентов — в каких проектах участвует
  hook?: string       // адрес, по которому доска может разбудить агента
  hook_ok?: boolean   // достучались ли в прошлый раз
  hook_note?: string  // что ответил адрес
  connected?: string  // когда агент подключился
  account?: string    // на каком аккаунте работает
  plan?: string       // тариф или подписка
  plan_until?: string // до какого дня оплачено
  usage?: string      // что агент сам сообщил о расходе
  limits?: string     // остатки по окнам, JSON: { "5ч": {used, limit, reset}, "неделя": {…} }
  live?: boolean      // держит ли агент открытый канал прямо сейчас
  job?: MemberJob     // роль в проекте: исполнитель или проверяющий
  auto?: boolean      // берёт ли новые задачи сам
}

export interface Stage {
  id: string
  title: string
  module?: string
  date?: string
  status: StageStatus
  progress: { done: number; total: number }
}

export type ProjectType = 'project' | 'process'
export type ProcessKind =
  | 'queue'
  | 'schedule'
  | 'monitoring'
  | 'conveyor'
  | 'regulation'

export interface Project {
  id: string
  name: string
  color?: string
  note?: string
  repo?: string
  path?: string
  design?: string    // правила интерфейса: из чего агенты его собирают
  type?: ProjectType
  process_kind?: ProcessKind
  members: Member[]
  roadmap: Stage[]
}

export interface Task {
  id: string
  title: string
  note?: string
  report?: string
  url?: string
  project?: string
  stage?: string
  parent?: string
  member?: string
  status: TaskStatus
  commit?: string
  tokens?: number
  seconds?: number
  started_at?: string | number
  submitted_at?: string | number
  attempts?: number
  max_attempts?: number
  verification_report?: string
  done_at?: string | number
  due?: string
  time?: string
  flagged?: boolean
  done?: boolean
  checker?: string | null      // кто проверяет эту задачу
  check?: TaskCheck | null     // последний вердикт
  checks?: TaskCheck[]         // все вердикты по порядку
}

// Вердикт проверяющего: принял, вернул или ещё смотрит.
export interface TaskCheck {
  status: 'wait' | 'ok' | 'fail'
  by?: string
  why?: string
  shot?: string | null
  at: number
}

export interface Agent extends Member {
  projects: string[]
  jobs?: Record<string, MemberJob>  // роль отдельно в каждом проекте
}

export interface ChatZprava {
  from: 'owner' | 'agent'
  text: string
  at: number
}

export interface Counts {
  today: number
  planned: number
  all: number
  flagged: number
  done: number
}

export interface State {
  projects: Project[]
  tasks: Task[]
  counts: Counts
  agents?: Agent[]
}

// настройки бота, который висит у владельца в личке
export interface QuickReply {
  id: string
  title: string
  text: string
}

export interface Assistant {
  mode: 'personal' | 'support'
  business: { connected: boolean; account: string; since: number | null }
  autoreply: { on: boolean; text: string; away_after: number }
  watch: { deleted: boolean; edited: boolean }
  digest: { on: boolean; at: string }
  replies: QuickReply[]
  support: { hours: string; sla: number; escalate: string }
}

// аккаунт владельца, от имени которого доска пишет другим ботам
export interface DmAccount {
  id: number
  name: string
  username?: string
}

// один тумблер: доска для своих или для всех
export interface Access {
  open: boolean
  bot: string
}

export interface Who {
  kind: 'owner' | 'member' | 'guest'
  id: string
  name: string
}
