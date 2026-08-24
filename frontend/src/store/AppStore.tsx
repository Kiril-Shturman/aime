import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import { boardKey, forgetBoardKey } from '../lib/telegram'
import type { State } from '../api/types'

interface Ctx {
  state: State | null
  error: string | null
  denied: boolean          // доска закрыта: ни ключа, ни подписи мини-аппы
  refresh: () => Promise<void>
}

const AppContext = createContext<Ctx | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await api.state()
      setState(s)
      setError(null)
      setDenied(false)
    } catch (e) {
      // ключ протух — выкидываем его и пробуем ещё раз как обычный гость
      if (String(e).includes('401') && boardKey()) {
        forgetBoardKey()
        try {
          setState(await api.state())
          setError(null)
          setDenied(false)
          return
        } catch {
          /* всё равно не пускают — покажем экран «закрыто» */
        }
      }
      setDenied(String(e).includes('401'))
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value = useMemo(
    () => ({ state, error, denied, refresh }),
    [state, error, denied, refresh],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppStoreProvider')
  return ctx
}
