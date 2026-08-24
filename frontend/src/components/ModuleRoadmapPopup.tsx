import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { ChevronDown, Info, Minus, Plus, RotateCcw } from 'lucide-react'
import Popup from './Popup'
import StageProgressIcon from './StageProgressIcon'
import { ModuleIcon, TaskIcon } from './WorkItemIcons'
import { STAGE_STATUS_LABEL, TASK_STATUS_LABEL } from '../lib/constants'
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
  onTaskClick: (task: Task) => void
}

const MIN_SCALE = 0.55
const MAX_SCALE = 2
const CANVAS_WIDTH = 620

function clampScale(value: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value))
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

export default function ModuleRoadmapPopup({
  open,
  onClose,
  modules,
  tasks,
  currentModuleName,
  onStageClick,
  onTaskClick,
}: Props) {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    () => new Set(currentModuleName ? [currentModuleName] : []),
  )
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())
  const [scale, setScale] = useState(0.84)
  const [offset, setOffset] = useState({ x: 0, y: 28 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const lastPinchDistance = useRef<number | null>(null)
  const lastPinchCenter = useRef<{ x: number; y: number } | null>(null)

  const roadmapProgress = useMemo(() => {
    const allStages = modules.flatMap((module) => module.stages)
    if (!allStages.length) return 0
    return (
      allStages.reduce(
        (sum, stage) => sum + stageProgress(stage, tasks).progress,
        0,
      ) / allStages.length
    )
  }, [modules, tasks])

  const toggleModule = (name: string) => {
    const opening = !expandedModules.has(name)
    setExpandedModules((previous) => {
      const next = new Set(previous)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
    if (opening) {
      setScale(0.88)
      setOffset({ x: 0, y: 28 })
    }
  }

  const toggleStage = (
    id: string,
    index: number,
    onLeft: boolean,
    centered: boolean,
  ) => {
    const opening = !expandedStages.has(id)
    setExpandedStages((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (opening) {
      setScale(1.05)
      setOffset({
        x: centered ? 0 : onLeft ? 145 : -145,
        y: 40 - Math.floor(index / 2) * 190,
      })
    }
  }

  const resetView = () => {
    setScale(0.84)
    setOffset({ x: 0, y: 28 })
  }

  const zoom = (amount: number) => {
    setScale((previous) => clampScale(previous + amount))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const activePointers = [...pointers.current.values()]

    if (activePointers.length === 1) {
      setOffset((current) => ({
        x: current.x + event.clientX - previous.x,
        y: current.y + event.clientY - previous.y,
      }))
      return
    }

    const [first, second] = activePointers
    const distance = Math.hypot(second.x - first.x, second.y - first.y)
    const center = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    }

    if (lastPinchDistance.current && lastPinchCenter.current) {
      const ratio = distance / lastPinchDistance.current
      setScale((current) => clampScale(current * ratio))
      setOffset((current) => ({
        x: current.x + center.x - lastPinchCenter.current!.x,
        y: current.y + center.y - lastPinchCenter.current!.y,
      }))
    }
    lastPinchDistance.current = distance
    lastPinchCenter.current = center
  }

  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) {
      lastPinchDistance.current = null
      lastPinchCenter.current = null
    }
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    zoom(event.deltaY > 0 ? -0.08 : 0.08)
  }

  return (
    <Popup
      open={open}
      onClose={onClose}
      title="Роудмап"
      pageClassName="!overflow-hidden"
    >
      <div
        className="relative h-[calc(100dvh-56px)] touch-none overflow-hidden bg-ios-light-surface-2 dark:bg-ios-dark-surface-2"
        style={{
          backgroundImage:
            'radial-gradient(circle, color-mix(in srgb, currentColor 16%, transparent) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onWheel={onWheel}
      >
        <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
          <span className="rounded-full bg-ios-light-glass px-3 py-1.5 text-[11px] text-black/50 shadow-ios-light-glass backdrop-blur-lg dark:bg-ios-dark-glass dark:text-white/50 dark:shadow-ios-dark-glass">
            Двигай поле · увеличивай двумя пальцами
          </span>
        </div>

        <div className="absolute bottom-5 right-4 z-30 flex flex-col overflow-hidden rounded-2xl bg-ios-light-glass shadow-ios-light-glass backdrop-blur-lg dark:bg-ios-dark-glass dark:shadow-ios-dark-glass">
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => zoom(0.16)} className="flex h-11 w-11 items-center justify-center active:bg-black/[.06] dark:active:bg-white/[.08]" aria-label="Приблизить">
            <Plus size={20} />
          </button>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => zoom(-0.16)} className="flex h-11 w-11 items-center justify-center border-y border-black/[.08] active:bg-black/[.06] dark:border-white/[.08] dark:active:bg-white/[.08]" aria-label="Отдалить">
            <Minus size={20} />
          </button>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={resetView} className="flex h-11 w-11 items-center justify-center active:bg-black/[.06] dark:active:bg-white/[.08]" aria-label="Сбросить масштаб">
            <RotateCcw size={18} />
          </button>
        </div>

        <div
          className="absolute left-1/2 top-0 select-none pb-32"
          style={{
            width: CANVAS_WIDTH,
            transform: `translate3d(${offset.x - CANVAS_WIDTH / 2}px, ${offset.y}px, 0) scale(${scale})`,
            transformOrigin: '50% 0',
          }}
        >
          <div className="relative mx-auto flex w-[520px] flex-col gap-14 pt-16 pb-24">
            <span className="absolute left-1/2 top-6 bottom-10 w-1 -translate-x-1/2 overflow-hidden rounded-full bg-black/[.12] dark:bg-white/[.14]">
              <span className="absolute inset-x-0 top-0 rounded-full bg-primary" style={{ height: `${Math.max(8, roadmapProgress * 100)}%` }} />
            </span>

            {modules.map((module) => {
              const isExpanded = expandedModules.has(module.name)
              const isCurrent = module.name === currentModuleName
              const moduleStages = module.stages.map((stage) => ({ stage, ...stageProgress(stage, tasks) }))
              const progress = moduleStages.length
                ? moduleStages.reduce((sum, item) => sum + item.progress, 0) / moduleStages.length
                : 0

              return (
                <section key={module.name} className="relative z-10">
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => toggleModule(module.name)} className="mx-auto flex w-[300px] items-center gap-3 rounded-2xl bg-ios-light-surface-1 px-3 py-3 text-left shadow-lg active:scale-[.98] dark:bg-ios-dark-surface-1" aria-expanded={isExpanded}>
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${isCurrent ? 'bg-primary text-white' : 'bg-primary/[.12] text-primary'}`}>
                      <ModuleIcon size={25} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] font-semibold text-black dark:text-white">{module.name}</span>
                      <span className="mt-0.5 block text-[12px] text-black/45 dark:text-white/45">{module.stages.length} этапов · {Math.round(progress * 100)}%</span>
                    </span>
                    <ChevronDown size={18} className={`shrink-0 text-black/35 transition-transform duration-200 dark:text-white/35 ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="relative mt-7 grid grid-cols-2 gap-x-20 gap-y-8">
                      <span className="absolute left-1/2 -top-7 bottom-8 w-1 -translate-x-1/2 bg-primary/35" />
                      {moduleStages.map(({ stage, stageTasks, done, total, progress: stageDone }, index) => {
                        const centered = moduleStages.length === 1
                        const onLeft = !centered && index % 2 === 0
                        const stageExpanded = expandedStages.has(stage.id)
                        return (
                          <div key={stage.id} className={`relative z-10 ${centered ? 'col-span-2 w-[220px] justify-self-center' : onLeft ? 'col-start-1' : 'col-start-2'}`}>
                            {!centered && (
                              <span className={`absolute top-16 h-1 w-10 -translate-y-1/2 bg-primary/35 ${onLeft ? '-right-10' : '-left-10'}`} />
                            )}
                            <div className="relative rounded-2xl bg-ios-light-surface-1 p-3 text-center shadow-lg dark:bg-ios-dark-surface-1">
                              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => toggleStage(stage.id, index, onLeft, centered)} className="flex w-full flex-col items-center active:opacity-70" aria-expanded={stageExpanded}>
                                <StageProgressIcon progress={stageDone} size={54} />
                                <span className="mt-2 line-clamp-2 text-[14px] font-semibold leading-tight text-black dark:text-white">{stage.title}</span>
                                <span className="mt-1 text-[11px] text-black/45 dark:text-white/45">{STAGE_STATUS_LABEL[stage.status]}{total ? ` · ${done} из ${total}` : ''}</span>
                                <span className="mt-2 text-[11px] font-medium text-primary">{stageExpanded ? 'Свернуть задачи' : 'Приблизить к задачам'}</span>
                              </button>
                              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onStageClick(stage)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/[.05] text-black/45 active:opacity-60 dark:bg-white/[.08] dark:text-white/45" aria-label={`Информация об этапе ${stage.title}`}>
                                <Info size={15} />
                              </button>
                            </div>

                            {stageExpanded && (
                              <div className="relative mx-auto mt-4 flex w-[88%] flex-col gap-2 pt-4">
                                <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-primary/35" />
                                {stageTasks.length === 0 ? (
                                  <span className="rounded-xl bg-ios-light-surface-1 px-3 py-2 text-center text-[11px] text-black/40 shadow-sm dark:bg-ios-dark-surface-1 dark:text-white/40">Задач пока нет</span>
                                ) : (
                                  stageTasks.map((task) => (
                                    <button key={task.id} type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onTaskClick(task)} className="flex items-center gap-2 rounded-xl bg-ios-light-surface-1 px-3 py-2 text-left shadow-md active:scale-[.98] dark:bg-ios-dark-surface-1">
                                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${task.done ? 'bg-green-500/15 text-green-500' : 'bg-primary/[.12] text-primary'}`}>
                                        <TaskIcon size={15} />
                                      </span>
                                      <span className="min-w-0">
                                        <span className="block truncate text-[11px] font-semibold text-black dark:text-white">{task.title}</span>
                                        <span className="block text-[9px] text-black/40 dark:text-white/40">{TASK_STATUS_LABEL[task.status]}</span>
                                      </span>
                                    </button>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </Popup>
  )
}
