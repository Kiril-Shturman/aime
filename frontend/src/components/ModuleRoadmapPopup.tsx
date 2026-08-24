import { Block, List, ListItem } from 'konsta/react'
import Popup from './Popup'
import StageProgressIcon from './StageProgressIcon'
import { STAGE_STATUS_LABEL } from '../lib/constants'
import type { Stage, Task } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  moduleName: string
  stages: Stage[]
  tasks: Task[]
  onStageClick: (stage: Stage) => void
}

export default function ModuleRoadmapPopup({
  open,
  onClose,
  moduleName,
  stages,
  tasks,
  onStageClick,
}: Props) {
  return (
    <Popup open={open} onClose={onClose} title={moduleName}>
      <Block className="!mt-3 !mb-4 text-[14px] text-black/55 dark:text-white/55">
        Этапы модуля. Кольцо вокруг доски показывает готовность этапа.
      </Block>

      <List strong inset dividers>
        {stages.map((stage) => {
          const stageTasks = tasks.filter((task) => task.stage === stage.id)
          const done = stageTasks.filter((task) => task.done).length
          const total = stageTasks.length || stage.progress.total
          const progress =
            stage.status === 'done'
              ? 1
              : total
                ? (stageTasks.length ? done : stage.progress.done) / total
                : 0

          return (
            <ListItem
              key={stage.id}
              link
              onClick={() => onStageClick(stage)}
              media={<StageProgressIcon progress={progress} />}
              title={<span className="font-semibold">{stage.title}</span>}
              subtitle={[
                STAGE_STATUS_LABEL[stage.status],
                stage.date,
                total ? `${done || stage.progress.done} из ${total} задач` : 'задач пока нет',
              ]
                .filter(Boolean)
                .join(' · ')}
              after={
                <span className="text-[12px] font-medium text-primary">
                  {Math.round(progress * 100)}%
                </span>
              }
            />
          )
        })}
      </List>
    </Popup>
  )
}
