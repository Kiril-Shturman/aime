import { useMemo, useState } from 'react'
import CheckmarkCircleFill from 'framework7-icons/react/esm/CheckmarkCircleFill.js'
import Circle from 'framework7-icons/react/esm/Circle.js'
import InfoCircle from 'framework7-icons/react/esm/InfoCircle.js'
import ChevronDown from 'framework7-icons/react/esm/ChevronDown.js'
import Popup from './Popup'
import { STAGE_STATUS_LABEL, TASK_STATUS_LABEL } from '../lib/constants'
import type { Stage, Task } from '../api/types'
import '../f7-timeline.css'

interface RoadmapModule {
  name: string
  stages: Stage[]
}

interface Props {
  open: boolean
  onClose: () => void
  modules: RoadmapModule[]
  tasks: Task[]
  currentModuleName?: string
  onStageClick: (stage: Stage) => void
  onTaskClick: (task: Task) => void
}

function stageProgress(stage: Stage, tasks: Task[]) {
  const stageTasks = tasks.filter((task) => task.stage === stage.id)
  const done = stageTasks.filter((task) => task.done).length
  const total = stageTasks.length || stage.progress.total
  const progress =
    stage.status === 'done'
      ? 1
      : total
        ? (stageTasks.length ? done : stage.progress.done) / total
        : 0
  return { stageTasks, done, total, progress }
}

const DOT_COLOR: Record<Stage['status'], string> = {
  planned: 'rgba(255,255,255,0.3)',
  active: '#2a8bff',
  done: '#30d158',
}

export default function ModuleRoadmapTreeview({
  open,
  onClose,
  modules,
  tasks,
  currentModuleName,
  onStageClick,
  onTaskClick,
}: Props) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())

  const totalProgress = useMemo(() => {
    const allStages = modules.flatMap((module) => module.stages)
    if (!allStages.length) return 0
    return (
      allStages.reduce(
        (sum, stage) => sum + stageProgress(stage, tasks).progress,
        0,
      ) / allStages.length
    )
  }, [modules, tasks])

  const flatStages = useMemo(
    () =>
      modules.flatMap((module) =>
        module.stages.map((stage) => ({ moduleName: module.name, stage })),
      ),
    [modules],
  )

  const toggleStage = (id: string) =>
    setExpandedStages((previous) => {
      const next = new Set(previous)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <Popup open={open} onClose={onClose} title="Роудмап">
      <div className="ios dark min-h-full bg-ios-light-surface-2 pb-8 dark:bg-ios-dark-surface-2">
        <div className="px-4 pt-4 pb-2 text-[12px] text-black/50 dark:text-white/50">
          Прогресс: {Math.round(totalProgress * 100)}% · {modules.length}{' '}
          {modules.length === 1 ? 'модуль' : 'модулей'} · {flatStages.length}{' '}
          этапов
        </div>

        <div className="timeline timeline-sides">
          {flatStages.map(({ moduleName, stage }) => {
            const { stageTasks, done, total, progress } = stageProgress(
              stage,
              tasks,
            )
            const isCurrentModule = moduleName === currentModuleName
            const expanded = expandedStages.has(stage.id)

            return (
              <div key={stage.id} className="timeline-item">
                <div className="timeline-item-date text-[11px] leading-tight">
                  <div className="font-semibold text-black/80 dark:text-white/80">
                    {Math.round(progress * 100)}%
                  </div>
                  <small className="block text-black/45 dark:text-white/45">
                    {STAGE_STATUS_LABEL[stage.status]}
                  </small>
                </div>

                <div
                  className="timeline-item-divider"
                  style={{ background: DOT_COLOR[stage.status] }}
                />

                <div className="timeline-item-content">
                  <div className="timeline-item-inner relative rounded-2xl bg-ios-light-surface-1 p-3 shadow-md dark:bg-ios-dark-surface-1">
                    <div
                      className={`timeline-item-time text-[11px] ${isCurrentModule ? 'font-semibold text-primary' : 'text-black/50 dark:text-white/50'}`}
                    >
                      {moduleName}
                    </div>
                    <div className="timeline-item-title text-[15px] font-semibold text-black dark:text-white">
                      {stage.title}
                    </div>
                    <div className="timeline-item-subtitle mt-0.5 text-[12px] text-black/50 dark:text-white/50">
                      {total ? `${done} из ${total} задач` : 'без задач'}
                    </div>

                    <button
                      type="button"
                      onClick={() => onStageClick(stage)}
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-[16px] text-black/40 active:opacity-60 dark:text-white/40"
                      aria-label={`Информация об этапе ${stage.title}`}
                    >
                      <InfoCircle />
                    </button>

                    {stageTasks.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleStage(stage.id)}
                          className="mt-2 flex items-center gap-1 text-[11px] text-primary active:opacity-60"
                          aria-expanded={expanded}
                        >
                          <span
                            className={`inline-flex text-[12px] transition-transform ${expanded ? 'rotate-180' : ''}`}
                          >
                            <ChevronDown />
                          </span>
                          {expanded ? 'Скрыть задачи' : `Показать задачи (${stageTasks.length})`}
                        </button>

                        {expanded && (
                          <div className="timeline-item-text mt-2 flex flex-col gap-1">
                            {stageTasks.map((task) => (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => onTaskClick(task)}
                                className="flex items-center gap-2 rounded-lg bg-black/[.04] px-2 py-1.5 text-left active:opacity-60 dark:bg-white/[.06]"
                              >
                                <span
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center text-[16px] ${task.done ? 'text-green-500' : 'text-primary/70'}`}
                                >
                                  {task.done ? <CheckmarkCircleFill /> : <Circle />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[12px] font-medium text-black dark:text-white">
                                    {task.title}
                                  </span>
                                  <span className="block text-[10px] text-black/45 dark:text-white/45">
                                    {TASK_STATUS_LABEL[task.status]}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Popup>
  )
}
