import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  MoreHorizontal,
  Flag,
  Pencil,
  User,
  GitBranch,
  RefreshCw,
  Link as LinkIcon,
  Trash2,
  ChevronRight,
  Workflow,
  Plus,
} from 'lucide-react'
import {
  Block,
  BlockTitle,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
  Progressbar,
  Link as KLink,
} from 'konsta/react'
import { api, type GitStatus } from '../api/client'
import { useApp } from '../store/AppStore'
import { Avatar } from '../components/Avatar'
import Menu, { type MenuItem } from '../components/Menu'
import Pill from '../components/Pill'
import TaskRow from '../components/TaskRow'
import {
  PROCESS_KINDS,
  kindLabel,
  processKindLabel,
  repoShort,
  repoUrl,
} from '../lib/constants'
import { haptic } from '../lib/telegram'
import TaskSheet from '../sheets/TaskSheet'
import TaskEditSheet from '../sheets/TaskEditSheet'
import ProjectSheet from '../sheets/ProjectSheet'
import MemberSheet from '../sheets/MemberSheet'
import MemberInfoSheet from '../sheets/MemberInfoSheet'
import StageSheet from '../sheets/StageSheet'
import StageInfoSheet from '../sheets/StageInfoSheet'
import ModuleRoadmapPopup from '../components/ModuleRoadmapPopup'
import GitSheet from '../sheets/GitSheet'
import GoalSheet from '../sheets/GoalSheet'
import type { Member, Stage, Task } from '../api/types'
import { ModuleIcon, ProjectIcon } from '../components/WorkItemIcons'

export default function ProjectPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { state, refresh } = useApp()
  const project = state?.projects.find((p) => p.id === id) ?? null

  const [memberFilter, setMemberFilter] = useState<string | null>(null)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuBtnRef = useRef<HTMLAnchorElement>(null)

  const [taskOpen, setTaskOpen] = useState(false)
  const [taskStage, setTaskStage] = useState<string | null>(null)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [projectSheetOpen, setProjectSheetOpen] = useState(false)
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberInfo, setMemberInfo] = useState<Member | null>(null)
  const [stageOpen, setStageOpen] = useState(false)
  const [stageInfo, setStageInfo] = useState<Stage | null>(null)
  const [moduleOpen, setModuleOpen] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    api
      .getGit(id)
      .then((r) => setGitStatus(r.status))
      .catch(() => setGitStatus(null))
  }, [id])

  const openTasks = useMemo(
    () =>
      state?.tasks.filter(
        (t) =>
          !t.done && t.project === id && (!memberFilter || t.member === memberFilter),
      ) ?? [],
    [state?.tasks, id, memberFilter],
  )

  const doneTasks = useMemo(
    () =>
      state?.tasks.filter(
        (t) =>
          t.done && t.project === id && (!memberFilter || t.member === memberFilter),
      ) ?? [],
    [state?.tasks, id, memberFilter],
  )

  const teamOpenCount = useMemo(() => {
    const map = new Map<string, number>()
    state?.tasks
      .filter((t) => !t.done && t.project === id)
      .forEach((t) => {
        if (!t.member) return
        map.set(t.member, (map.get(t.member) ?? 0) + 1)
      })
    return map
  }, [state?.tasks, id])

  const pullGit = async () => {
    if (!project?.repo) return
    haptic('light')
    try {
      const r = await api.connectGit(id, project.repo)
      setGitStatus(r.status)
      haptic('success')
    } catch {
      haptic('error')
    }
  }

  const deleteProject = async () => {
    if (!confirm('Удалить проект вместе с задачами?')) return
    await api.deleteProject(id)
    await refresh()
    window.history.back()
  }

  const gitLine = () => {
    if (!gitStatus) return 'копии на сервере нет'
    return [
      gitStatus.branch,
      gitStatus.dirty ? `правок: ${gitStatus.dirty}` : null,
      gitStatus.last ?? null,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const menuItems: MenuItem[] = useMemo(() => {
    if (!project) return []
    const items: MenuItem[] = [
      { label: 'Поставить цель', icon: Flag, onSelect: () => setGoalOpen(true) },
      {
        label: 'Добавить задачу',
        icon: Plus,
        onSelect: () => {
          setTaskStage(null)
          setTaskOpen(true)
        },
      },
      {
        label: project.type === 'process' ? 'Изменить процесс' : 'Изменить проект',
        icon: Pencil,
        onSelect: () => setProjectSheetOpen(true),
      },
      {
        label: 'Добавить участника',
        icon: User,
        onSelect: () => setMemberOpen(true),
      },
    ]
    if (project.type !== 'process') {
      items.push({
        label: 'Добавить этап',
        icon: Flag,
        onSelect: () => setStageOpen(true),
      })
    }
    if (project.repo) {
      items.push({
        label: repoShort(project.repo),
        sub: gitLine(),
        icon: GitBranch,
        onSelect: () => setGitOpen(true),
      })
      items.push({
        label: 'Обновить из гита',
        icon: RefreshCw,
        onSelect: pullGit,
      })
      items.push({
        label: 'Открыть на GitHub',
        icon: LinkIcon,
        onSelect: () => window.open(repoUrl(project.repo!), '_blank'),
      })
    } else {
      items.push({
        label: 'Подключить репозиторий',
        icon: GitBranch,
        onSelect: () => setGitOpen(true),
      })
    }
    items.push({
      label: project.type === 'process' ? 'Удалить процесс' : 'Удалить проект',
      icon: Trash2,
      red: true,
      onSelect: deleteProject,
    })
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, gitStatus])

  if (!project) {
    return (
      <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Navbar
          title="Не найдено"
          left={
            <NavbarBackLink
              text="Назад"
              onClick={() => navigate('/')}
            />
          }
        />
        <Block>Проект не найден.</Block>
      </Page>
    )
  }

  const visibleTasks = [...openTasks, ...doneTasks]
  const projectTasks = state?.tasks.filter((t) => t.project === id) ?? []
  const projectDone = projectTasks.filter((t) => t.done).length
  const projectProgress = projectTasks.length
    ? projectDone / projectTasks.length
    : 0
  const moduleMap = new Map<string, Stage[]>()
  project.roadmap.forEach((stage) => {
    const moduleName = stage.module?.trim() || 'Основной модуль'
    moduleMap.set(moduleName, [...(moduleMap.get(moduleName) ?? []), stage])
  })
  const modules = Array.from(moduleMap, ([name, stages]) => ({ name, stages }))
  const currentModule =
    modules.find((module) =>
      module.stages.some((stage) => stage.status === 'active'),
    ) ??
    modules.find((module) =>
      module.stages.some((stage) => stage.status !== 'done'),
    ) ??
    modules.at(-1) ??
    null
  const currentTask =
    openTasks.find((task) => task.status === 'doing') ?? openTasks[0] ?? null

  const openTaskSheet = (stage: string | null = null) => {
    setTaskStage(stage)
    setTaskOpen(true)
  }

  const openStageFromRoadmap = (stage: Stage) => {
    setModuleOpen(false)
    window.setTimeout(() => setStageInfo(stage), 280)
  }

  const openTaskFromRoadmap = (task: Task) => {
    setModuleOpen(false)
    window.setTimeout(() => setEditTask(task), 280)
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title={project.name}
        left={
          <NavbarBackLink
            text="Назад"
            onClick={() => navigate('/')}
          />
        }
        right={
          <KLink
            iconOnly
            ref={menuBtnRef}
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal size={24} />
          </KLink>
        }
      />

      <List strong inset>
        <ListItem
          media={
            <span className="w-12 h-12 rounded-2xl bg-primary/12 text-primary flex items-center justify-center">
              <ProjectIcon size={28} />
            </span>
          }
          title={<span className="font-semibold">{project.name}</span>}
          subtitle={`${modules.length} ${modules.length === 1 ? 'модуль' : 'модуля'} · ${project.roadmap.length} этапов · ${projectTasks.length} задач`}
          text={
            <span className="block mt-2">
              {project.note && (
                <span className="block text-black/65 dark:text-white/60 mb-2">
                  {project.note}
                </span>
              )}
              <span className="flex items-center gap-2">
                <Progressbar progress={projectProgress} className="flex-1" />
                <span className="text-[12px] text-black/50 dark:text-white/50 shrink-0">
                  {projectDone} из {projectTasks.length}
                </span>
              </span>
            </span>
          }
        />
      </List>

      {project.type === 'process' && project.process_kind && (
        <>
          <BlockTitle>Способ организации</BlockTitle>
          <List strong inset>
            <ListItem
              media={<Workflow size={20} />}
              title={processKindLabel(project.process_kind)}
              subtitle={
                PROCESS_KINDS.find((k) => k.id === project.process_kind)?.hint
              }
            />
          </List>
        </>
      )}

      {project.type !== 'process' && (
        <>
          <BlockTitle>Роудмап</BlockTitle>

          {!currentModule ? (
            <List strong inset>
              <ListItem
                link
                onClick={() => setStageOpen(true)}
                media={<ModuleIcon size={28} className="text-primary" />}
                title="Создать первый модуль"
                subtitle="Добавь этап — модуль появится автоматически"
              />
            </List>
          ) : (
            <button
              type="button"
              onClick={() => setModuleOpen(true)}
              className="relative mx-safe-4 mb-10 w-[calc(100%-2rem)] min-h-24 overflow-hidden rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 text-left active:opacity-75"
            >
              <span className="flex min-h-24 items-center py-4 pl-5 pr-20">
                <span className="min-w-0">
                  <span className="block truncate text-[19px] leading-tight font-semibold text-black dark:text-white">
                  {currentModule.name}
                  </span>
                  <span className="mt-1 block text-[13px] text-black/45 dark:text-white/45">
                    {currentModule.stages.length} этапов
                  </span>
                </span>
              </span>

              <span className="absolute right-8 top-0 h-1/2 w-px bg-primary" />
              <span className="absolute right-8 top-1/2 bottom-0 w-px bg-black/[.08] dark:bg-white/[.10]" />
              <span className="absolute right-[17px] top-1/2 -translate-y-1/2 w-[31px] h-[31px] rounded-full bg-primary text-white ring-4 ring-ios-light-surface-1 dark:ring-ios-dark-surface-1 flex items-center justify-center shadow-sm">
                <ModuleIcon size={18} />
              </span>
            </button>
          )}

          <BlockTitle>Задачи</BlockTitle>
          <List strong inset dividers>
            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
              Сейчас
            </div>
            {currentTask ? (
              <TaskRow task={currentTask} onEdit={setEditTask} />
            ) : (
              <ListItem title="Сейчас задач нет" />
            )}

            {doneTasks.length > 0 && (
              <div className="px-4 pt-4 pb-1 border-t border-black/[.08] dark:border-white/[.08] text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                Завершено
              </div>
            )}
            {doneTasks.map((task) => (
              <TaskRow key={task.id} task={task} onEdit={setEditTask} />
            ))}
            <ListItem
              link
              onClick={() => openTaskSheet(currentTask?.stage ?? null)}
              media={<Plus size={20} className="text-primary" />}
              title="Добавить задачу"
            />
          </List>
        </>
      )}

      {project.type === 'process' && (
        <>
          <BlockTitle>{memberFilter ? 'Задачи участника' : 'Задачи'}</BlockTitle>
          <List strong inset>
            {visibleTasks.length === 0 ? (
              <ListItem title="Пусто" />
            ) : (
              visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} onEdit={setEditTask} />
              ))
            )}
          </List>
        </>
      )}

      {project.members.length > 0 && (
        <>
          <BlockTitle>Команда</BlockTitle>
          <List strong inset dividers>
            {project.members.map((member) => (
              <ListItem
                key={member.id}
                link
                onClick={() =>
                  memberFilter === member.id
                    ? setMemberFilter(null)
                    : setMemberInfo(member)
                }
                media={<Avatar member={member} color={project.color} size={44} />}
                title={member.name}
                subtitle={
                  <span className="flex flex-wrap gap-1.5 mt-1">
                    <Pill tone={teamOpenCount.get(member.id) ? 'work' : 'free'}>
                      {teamOpenCount.get(member.id)
                        ? `${teamOpenCount.get(member.id)} в работе`
                        : 'свободен'}
                    </Pill>
                    {member.kind && (
                      <Pill tone={member.kind}>{kindLabel(member.kind)}</Pill>
                    )}
                  </span>
                }
                chevronIcon={
                  <ChevronRight
                    size={18}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-black/25 dark:text-white/25"
                  />
                }
                innerClassName="pr-10"
                className={
                  memberFilter === member.id
                    ? 'bg-black/[.04] dark:bg-white/[.06]'
                    : ''
                }
              />
            ))}
          </List>
        </>
      )}

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        target={menuBtnRef}
      />

      <TaskSheet
        open={taskOpen}
        onClose={() => {
          setTaskOpen(false)
          setTaskStage(null)
        }}
        defaultProject={id}
        defaultStage={taskStage}
      />
      <TaskEditSheet
        open={editTask != null}
        onClose={() => setEditTask(null)}
        task={editTask}
      />
      <ProjectSheet
        open={projectSheetOpen}
        onClose={() => setProjectSheetOpen(false)}
        project={project}
      />
      <MemberSheet
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        projectId={id}
      />
      <MemberInfoSheet
        open={memberInfo != null}
        onClose={() => setMemberInfo(null)}
        projectId={id}
        member={memberInfo}
        projectColor={project.color}
      />
      <StageSheet
        open={stageOpen}
        onClose={() => setStageOpen(false)}
        projectId={id}
      />
      <StageInfoSheet
        open={stageInfo != null}
        onClose={() => setStageInfo(null)}
        projectId={id}
        stage={stageInfo}
      />
      {modules.length > 0 && (
        <ModuleRoadmapPopup
          open={moduleOpen}
          onClose={() => setModuleOpen(false)}
          modules={modules}
          tasks={projectTasks}
          currentModuleName={currentModule?.name}
          onStageClick={openStageFromRoadmap}
          onTaskClick={openTaskFromRoadmap}
        />
      )}
      <GitSheet
        open={gitOpen}
        onClose={() => setGitOpen(false)}
        projectId={id}
        initialRepo={project.repo ?? ''}
        initialBranch={gitStatus?.branch ?? ''}
      />
      <GoalSheet
        open={goalOpen}
        onClose={() => setGoalOpen(false)}
        defaultProject={id}
      />
    </Page>
  )
}
