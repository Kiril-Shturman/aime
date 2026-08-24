import { useEffect, useState } from 'react'
import { Check, GitBranch, Palette } from 'lucide-react'
import { Block, BlockTitle, Button, List, ListInput, ListItem } from 'konsta/react'
import Popup from '../components/Popup'
import Sheet from '../components/Sheet'
import { api } from '../api/client'
import { COLORS } from '../lib/constants'
import { haptic } from '../lib/telegram'
import { useApp } from '../store/AppStore'
import type { Project } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  project?: Project | null
}

function repoShort(url: string) {
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(\.git)?$/)
  return m ? m[1] : url
}

export default function ProjectSheet({ open, onClose, project }: Props) {
  const { state, refresh } = useApp()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [repo, setRepo] = useState('')
  const [color, setColor] = useState(COLORS[0])

  const [sub, setSub] = useState<null | 'repo' | 'color'>(null)
  const [repoDraft, setRepoDraft] = useState('')

  useEffect(() => {
    if (!open) return
    if (project) {
      setName(project.name)
      setNote(project.note ?? '')
      setRepo(project.repo ?? '')
      setColor(project.color ?? COLORS[0])
    } else {
      setName('')
      setNote('')
      setRepo('')
      setColor(COLORS[(state?.projects.length ?? 0) % COLORS.length])
    }
  }, [open, project, state?.projects.length])

  const save = async () => {
    if (!name.trim()) return
    const body = {
      name: name.trim(),
      color,
      note: note.trim(),
      repo: repo.trim(),
    }
    if (project) await api.patchProject(project.id, body)
    else await api.addProject(body)
    haptic('success')
    onClose()
    await refresh()
  }

  const title = project ? 'Изменить проект' : 'Новый проект'
  const okLabel = project ? 'Сохранить' : 'Создать'

  return (
    <>
      <Popup open={open} onClose={onClose} title={title} onSave={save} saveLabel={okLabel}>
        <List strong inset>
          <ListInput
            label="Название"
            type="text"
            placeholder="Например, Коридор"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <ListInput
            label="Описание"
            type="textarea"
            placeholder="Пара слов, о чём проект"
            value={note}
            onChange={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
        </List>

        <BlockTitle>Оформление</BlockTitle>
        <List strong inset>
          <ListItem
            onClick={() => setSub('color')}
            media={<Palette size={20} />}
            title="Цвет"
            after={
              <span
                className="w-6 h-6 rounded-full border border-white/10"
                style={{ background: color }}
              />
            }
            chevron
          />
        </List>

        <BlockTitle>Репозиторий</BlockTitle>
        <List strong inset>
          <ListItem
            onClick={() => {
              setRepoDraft(repo)
              setSub('repo')
            }}
            media={<GitBranch size={20} />}
            title={repo ? repoShort(repo) : 'Не указан'}
            subtitle={repo ? repo : 'нажми, чтобы подключить'}
            chevron
          />
        </List>
        <Block className="!mt-2 opacity-60 text-[13px]">
          Позже проверим доступ, склонируем на сервер — руками ничего указывать не нужно.
        </Block>
      </Popup>

      {/* Sub-sheet: Repo URL */}
      <Sheet
        open={sub === 'repo'}
        onClose={() => setSub(null)}
        title="Репозиторий"
      >
        <List strong inset>
          <ListInput
            label="Адрес"
            type="text"
            placeholder="git@github.com:user/repo.git"
            value={repoDraft}
            onChange={(e) => setRepoDraft((e.target as HTMLInputElement).value)}
          />
        </List>
        <Block className="flex gap-2">
          <Button
            large
            rounded
            outline
            onClick={() => {
              setRepo('')
              setSub(null)
            }}
          >
            Убрать
          </Button>
          <Button
            large
            rounded
            onClick={() => {
              setRepo(repoDraft.trim())
              setSub(null)
            }}
          >
            Готово
          </Button>
        </Block>
      </Sheet>

      {/* Sub-sheet: Color picker */}
      <Sheet
        open={sub === 'color'}
        onClose={() => setSub(null)}
        title="Цвет"
      >
        <Block>
          <div className="grid grid-cols-4 gap-3 justify-items-center">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setColor(c)
                  setSub(null)
                }}
                className="w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: c }}
              >
                {c === color && <Check size={24} color="#fff" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Block>
      </Sheet>
    </>
  )
}
