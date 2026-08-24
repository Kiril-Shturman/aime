import { useEffect, useState } from 'react'
import { Block, Button, List, ListInput } from 'konsta/react'
import Sheet from '../components/Sheet'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  initialRepo?: string
  initialBranch?: string
}

export default function GitSheet({
  open,
  onClose,
  projectId,
  initialRepo = '',
  initialBranch = '',
}: Props) {
  const { refresh } = useApp()
  const [repo, setRepo] = useState(initialRepo)
  const [branch, setBranch] = useState(initialBranch)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRepo(initialRepo)
    setBranch(initialBranch)
    setBusy(false)
    setError(null)
  }, [open, initialRepo, initialBranch])

  const connect = async () => {
    if (!repo.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.connectGit(projectId, repo.trim(), branch.trim() || undefined)
      haptic('success')
      onClose()
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Подключить репозиторий">
      <Block className="!mt-0 !mb-3 opacity-60 text-[13px]">
        Проверю доступ, склонирую на сервер и запомню путь — руками ничего указывать
        не нужно.
      </Block>
      <List strong inset>
        <ListInput
          label="Адрес"
          type="text"
          placeholder="git@github.com:user/repo.git"
          value={repo}
          onChange={(e) => setRepo((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Ветка (необязательно)"
          type="text"
          placeholder="main"
          value={branch}
          onChange={(e) => setBranch((e.target as HTMLInputElement).value)}
        />
      </List>
      {error && (
        <Block className="text-red-500 text-[13px]">{error}</Block>
      )}
      <Block>
        <Button large rounded disabled={busy} onClick={connect}>
          {busy ? 'Проверяю…' : 'Подключить'}
        </Button>
      </Block>
    </Sheet>
  )
}
