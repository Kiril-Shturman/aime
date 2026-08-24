export type MemberKind = 'bot' | 'agent' | 'service' | 'human'
export type StageStatus = 'planned' | 'active' | 'done'
export type TaskStatus = 'todo' | 'doing' | 'done'

export interface Member {
  id: string
  name: string
  handle?: string
  role?: string
  kind: MemberKind
  avatar?: string
}

export interface Stage {
  id: string
  title: string
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
