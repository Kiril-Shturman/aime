import {
  BookText,
  Calendar,
  ListChecks,
  Radar,
  Target,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { ProcessKind, ProjectType } from '../api/types'

// один общий список типов «рабочих областей»: собственно проект + 5 видов процесса.
// В базе это раскладывается в связку { type, process_kind }, а в UI выглядит
// одним плоским выбором «что вы заводите».
export interface WorkspaceKind {
  id: string
  label: string
  hint: string
  Icon: LucideIcon
  type: ProjectType
  processKind?: ProcessKind
}

export const WORKSPACE_KINDS: WorkspaceKind[] = [
  {
    id: 'project',
    label: 'Проект',
    hint: 'Конечная цель — запуск, релиз, исследование',
    Icon: Target,
    type: 'project',
  },
  {
    id: 'queue',
    label: 'Очередь',
    hint: 'Задачи копятся, агент разбирает по одной',
    Icon: ListChecks,
    type: 'process',
    processKind: 'queue',
  },
  {
    id: 'schedule',
    label: 'Расписание',
    hint: 'Повторяется по календарю: каждый день, неделю…',
    Icon: Calendar,
    type: 'process',
    processKind: 'schedule',
  },
  {
    id: 'monitoring',
    label: 'Мониторинг',
    hint: 'Проверять и реагировать при изменении',
    Icon: Radar,
    type: 'process',
    processKind: 'monitoring',
  },
  {
    id: 'conveyor',
    label: 'Конвейер',
    hint: 'Поток однотипных задач через этапы',
    Icon: Workflow,
    type: 'process',
    processKind: 'conveyor',
  },
  {
    id: 'regulation',
    label: 'Регламент',
    hint: 'Инструкция «как делаем эту работу»',
    Icon: BookText,
    type: 'process',
    processKind: 'regulation',
  },
]

export function workspaceKindFor(
  type?: ProjectType,
  processKind?: ProcessKind | null,
): WorkspaceKind {
  if (type === 'process' && processKind) {
    return WORKSPACE_KINDS.find((k) => k.processKind === processKind) ?? WORKSPACE_KINDS[1]
  }
  return WORKSPACE_KINDS[0]
}
