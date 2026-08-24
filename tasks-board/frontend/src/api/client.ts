import type {
  Access,
  Assistant,
  Invite,
  Member,
  Project,
  QuickReply,
  Stage,
  State,
  Task,
  Who,
} from './types'
import { boardKey, initData } from '../lib/telegram'

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers, ...rest } = init ?? {}
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(initData() ? { 'X-Telegram-Init-Data': initData() } : {}),
      ...(boardKey() ? { 'X-Board-Key': boardKey() } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface Command {
  id: string
  label: string
}
export interface CommandResult {
  id: string
  label: string
  text: string
}

export interface GitStatus {
  branch?: string
  last?: string
  dirty?: number
}

export const api = {
  state: () => request<State>('/api/state'),

  addTask: (task: Partial<Task>) =>
    request<Task>('/api/task', { method: 'POST', json: task }),
  patchTask: (id: string, patch: Partial<Task>) =>
    request<Task>(`/api/task/${id}`, { method: 'PATCH', json: patch }),
  toggleTask: (id: string) =>
    request<Task>(`/api/task/${id}/toggle`, { method: 'POST' }),
  deleteTask: (id: string) =>
    request<void>(`/api/task/${id}`, { method: 'DELETE' }),

  addProject: (project: Partial<Project>) =>
    request<Project>('/api/project', { method: 'POST', json: project }),
  patchProject: (id: string, patch: Partial<Project>) =>
    request<Project>(`/api/project/${id}`, { method: 'PATCH', json: patch }),
  deleteProject: (id: string) =>
    request<void>(`/api/project/${id}`, { method: 'DELETE' }),

  addMember: (pid: string, m: Partial<Member>) =>
    request<Member>(`/api/project/${pid}/member`, { method: 'POST', json: m }),
  patchMember: (pid: string, mid: string, m: Partial<Member>) =>
    request<Member>(`/api/project/${pid}/member/${mid}`, {
      method: 'PATCH',
      json: m,
    }),
  deleteMember: (pid: string, mid: string) =>
    request<void>(`/api/project/${pid}/member/${mid}`, { method: 'DELETE' }),

  addStage: (pid: string, s: Partial<Stage>) =>
    request<Stage>(`/api/project/${pid}/stage`, { method: 'POST', json: s }),
  patchStage: (pid: string, sid: string, s: Partial<Stage>) =>
    request<Stage>(`/api/project/${pid}/stage/${sid}`, {
      method: 'PATCH',
      json: s,
    }),
  deleteStage: (pid: string, sid: string) =>
    request<void>(`/api/project/${pid}/stage/${sid}`, { method: 'DELETE' }),

  addGoal: (text: string, project?: string) =>
    request<{ project: string; stage: string }>('/api/goal', {
      method: 'POST',
      json: { text, project },
    }),

  getGit: (pid: string) =>
    request<{ status: GitStatus | null }>(`/api/project/${pid}/git`),
  connectGit: (pid: string, repo: string, branch?: string) =>
    request<{ status: GitStatus }>(`/api/project/${pid}/git`, {
      method: 'POST',
      json: { repo, branch },
    }),

  whoami: () => request<{ who: Who | null; can_write: boolean }>('/api/whoami'),

  getAccess: () => request<Access>('/api/access'),
  setAccessOpen: (open: boolean) =>
    request<Access>('/api/access', { method: 'PATCH', json: { open } }),
  addInvite: () =>
    request<Invite & { bot: string }>('/api/access/invite', { method: 'POST' }),
  deleteInvite: (code: string) =>
    request<void>(`/api/access/invite/${code}`, { method: 'DELETE' }),
  deleteGuest: (gid: string) =>
    request<void>(`/api/access/guest/${gid}`, { method: 'DELETE' }),

  getAssistant: () => request<Assistant>('/api/assistant'),
  patchAssistant: (patch: Partial<Assistant>) =>
    request<Assistant>('/api/assistant', { method: 'PATCH', json: patch }),
  addReply: (title: string, text: string) =>
    request<QuickReply>('/api/assistant/reply', {
      method: 'POST',
      json: { title, text },
    }),
  deleteReply: (rid: string) =>
    request<void>(`/api/assistant/reply/${rid}`, { method: 'DELETE' }),

  listCommands: () =>
    request<{ commands: Command[] }>('/api/commands'),
  runCommand: (cid: string) =>
    request<CommandResult>(`/api/command/${cid}`, { method: 'POST' }),
}
