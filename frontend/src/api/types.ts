export type MemberKind = 'bot' | 'agent' | 'service' | 'human'
export type StageStatus = 'planned' | 'active' | 'done'
export type TaskStatus = 'todo' | 'doing' | 'done'

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
  started_at?: string
  done_at?: string
  due?: string
  time?: string
  flagged?: boolean
  done?: boolean
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
