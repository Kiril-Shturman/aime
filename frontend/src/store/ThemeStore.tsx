import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type Theme = 'dark' | 'light'
const KEY = 'ui-theme'

interface Ctx {
  theme: Theme
  toggle: () => void
  set: (t: Theme) => void
}
const ThemeContext = createContext<Ctx | null>(null)

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(read)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('tg-dark', theme === 'dark')
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const value = useMemo<Ctx>(
    () => ({
      theme,
      toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      set: setTheme,
    }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme outside ThemeProvider')
  return ctx
}

// Хук для случаев, когда только читаем текущую тему на верхнем уровне
export function useCurrentTheme(): Theme {
  const [t, setT] = useState<Theme>(read)
  const cb = useCallback(() => setT(read()), [])
  useEffect(() => {
    window.addEventListener('storage', cb)
    return () => window.removeEventListener('storage', cb)
  }, [cb])
  return t
}
