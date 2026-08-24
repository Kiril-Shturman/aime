import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import Popup from './Popup'
import StageProgressIcon from './StageProgressIcon'
import { ModuleIcon } from './WorkItemIcons'
import { STAGE_STATUS_LABEL } from '../lib/constants'
import type { Stage, Task } from '../api/types'

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

  return { done: stageTasks.length ? done : stage.progress.done, total, progress }
}

export default function ModuleRoadmapPopup({
  open,
  onClose,
  modules,
  tasks,
  currentModuleName,
  onStageClick,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(currentModuleName ? [currentModuleName] : []),
  )

  const toggleModule = (name: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <Popup open={open} onClose={onClose} title="Роудмап">
      <div className="relative mx-auto w-full max-w-md px-4 pt-7 pb-safe-10">
        {modules.length > 1 && (
          <span className="absolute left-1/2 top-7 bottom-10 w-px -translate-x-1/2 bg-black/[.10] dark:bg-white/[.12]" />
        )}

        <div className="relative flex flex-col gap-9">
          {modules.map((module) => {
            const isExpanded = expanded.has(module.name)
            const isCurrent = module.name === currentModuleName
            const moduleStages = module.stages.map((stage) => ({
              stage,
              ...stageProgress(stage, tasks),
            }))
            const progress = moduleStages.length
              ? moduleStages.reduce((sum, item) => sum + item.progress, 0) /
                moduleStages.length
              : 0

            return (
              <section key={module.name} className="relative">
                <button
                  type="button"
                  onClick={() => toggleModule(module.name)}
                  className="relative z-10 mx-auto flex w-[78%] max-w-[300px] items-center gap-3 rounded-2xl bg-ios-light-surface-1 px-3 py-3 text-left shadow-sm active:scale-[.98] dark:bg-ios-dark-surface-1"
                  aria-expanded={isExpanded}
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                      isCurrent
                        ? 'bg-primary text-white'
                        : 'bg-primary/[.12] text-primary'
                    }`}
                  >
                    <ModuleIcon size={23} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold text-black dark:text-white">
                      {module.name}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-black/45 dark:text-white/45">
                      {module.stages.length} этапов · {Math.round(progress * 100)}%
                    </span>
                  </span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-black/35 transition-transform duration-200 dark:text-white/35 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isExpanded && (
                  <div className="relative mt-5 grid grid-cols-2 gap-x-11 gap-y-4">
                    <span className="absolute left-1/2 -top-5 bottom-5 w-px -translate-x-1/2 bg-primary/35" />

                    {moduleStages.map(({ stage, done, total, progress: stageDone }, index) => {
                      const onLeft = index % 2 === 0
                      return (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() => onStageClick(stage)}
                          className={`relative z-10 flex min-h-28 flex-col items-center justify-center rounded-2xl bg-ios-light-surface-1 px-2 py-3 text-center shadow-sm active:scale-[.97] dark:bg-ios-dark-surface-1 ${
                            onLeft ? 'col-start-1' : 'col-start-2'
                          }`}
                        >
                          <span
                            className={`absolute top-1/2 h-px w-6 -translate-y-1/2 bg-primary/35 ${
                              onLeft ? '-right-6' : '-left-6'
                            }`}
                          />
                          <StageProgressIcon progress={stageDone} size={50} />
                          <span className="mt-2 line-clamp-2 text-[13px] font-semibold leading-tight text-black dark:text-white">
                            {stage.title}
                          </span>
                          <span className="mt-1 text-[10px] leading-tight text-black/45 dark:text-white/45">
                            {STAGE_STATUS_LABEL[stage.status]}
                            {total ? ` · ${done} из ${total}` : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </Popup>
  )
}
