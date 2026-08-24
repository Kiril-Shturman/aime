import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Phone, UserCheck } from 'lucide-react'
import { Block, BlockTitle, Button, List, ListInput, ListItem } from 'konsta/react'
import { api } from '../api/client'
import { haptic } from '../lib/telegram'
import type { DmAccount as Account } from '../api/types'

// Вход в личный аккаунт прямо из доски. Так задумано нарочно: код входа
// Телеграм присылает в Телеграм и аннулирует его, если заметит в переписке.
// Здесь он никуда не пересылается — уходит на сервер и остаётся там.
export default function DmAccount() {
  const [creds, setCreds] = useState(false)
  const [account, setAccount] = useState<Account | null>(null)
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [asked, setAsked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(() => {
    api
      .dmStatus()
      .then((s) => {
        setCreds(s.creds)
        setAccount(s.account)
      })
      .catch(() => setCreds(false))
  }, [])
  useEffect(load, [load])

  const clean = (e: unknown) => String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, '')

  const step = async (fn: () => Promise<string>) => {
    setBusy(true)
    setNote('')
    try {
      setNote(await fn())
      haptic('success')
    } catch (e) {
      haptic('error')
      setNote(clean(e))
    } finally {
      setBusy(false)
    }
  }

  const saveCreds = () =>
    step(async () => {
      await api.dmCreds(apiId.trim(), apiHash.trim())
      setCreds(true)
      setApiHash('')
      return 'Ключи сохранены. Теперь телефон.'
    })

  const askCode = () =>
    step(async () => {
      await api.dmCode(phone.trim())
      setAsked(true)
      return 'Код ушёл в Телеграм. Введи его сюда — тут он не сгорит.'
    })

  const enter = () =>
    step(async () => {
      const me = await api.dmLogin(code.trim(), password.trim() || undefined)
      setAccount(me)
      setCode('')
      setPassword('')
      setAsked(false)
      return ''
    })

  const logout = async () => {
    if (!confirm('Забыть аккаунт? Доска перестанет писать от твоего имени.')) return
    await api.dmLogout()
    setAccount(null)
    load()
  }

  return (
    <>
      <BlockTitle>Аккаунт для промтов</BlockTitle>

      {account ? (
        <>
          <List strong inset>
            <ListItem
              title={account.name}
              subtitle={account.username ? '@' + account.username : String(account.id)}
              media={<UserCheck size={20} className="text-[#30d158]" />}
            />
            <ListItem link title="Забыть аккаунт" onClick={logout} />
          </List>
          <Block>
            <p className="text-white/45 text-[14px] leading-snug">
              Доска пишет другим ботам от твоего имени: бот боту написать не
              может, а живой аккаунт — может. Скажи агенту «спроси у такого-то
              бота вот это» — он сходит и принесёт ответ.
            </p>
          </Block>
        </>
      ) : (
        <>
          {!creds && (
            <>
              <List strong inset>
                <ListInput
                  label="api_id"
                  type="text"
                  placeholder="1234567"
                  value={apiId}
                  onChange={(e) => setApiId((e.target as HTMLInputElement).value)}
                  media={<KeyRound size={20} className="text-[#2a8bff]" />}
                />
                <ListInput
                  label="api_hash"
                  type="text"
                  placeholder="строка с my.telegram.org"
                  value={apiHash}
                  onChange={(e) => setApiHash((e.target as HTMLInputElement).value)}
                />
              </List>
              <Block>
                <Button
                  large
                  rounded
                  onClick={saveCreds}
                  disabled={busy || !apiId.trim() || !apiHash.trim()}
                >
                  Сохранить ключи
                </Button>
                <p className="text-white/45 text-[14px] leading-snug mt-3">
                  my.telegram.org → войти по телефону → API development tools →
                  создать приложение. Название любое.
                </p>
              </Block>
            </>
          )}

          {creds && (
            <>
              <List strong inset>
                <ListInput
                  label="Телефон"
                  type="text"
                  placeholder="+79990000000"
                  value={phone}
                  onChange={(e) => setPhone((e.target as HTMLInputElement).value)}
                  media={<Phone size={20} className="text-[#2a8bff]" />}
                />
                {asked && (
                  <>
                    <ListInput
                      label="Код из Телеграма"
                      type="text"
                      placeholder="12345"
                      value={code}
                      onChange={(e) => setCode((e.target as HTMLInputElement).value)}
                    />
                    <ListInput
                      label="Пароль двухфакторки"
                      type="password"
                      placeholder="если включена"
                      value={password}
                      onChange={(e) =>
                        setPassword((e.target as HTMLInputElement).value)
                      }
                    />
                  </>
                )}
              </List>
              <Block>
                {asked ? (
                  <Button large rounded onClick={enter} disabled={busy || !code.trim()}>
                    {busy ? 'Вхожу…' : 'Войти'}
                  </Button>
                ) : (
                  <Button
                    large
                    rounded
                    onClick={askCode}
                    disabled={busy || !phone.trim()}
                  >
                    {busy ? 'Прошу код…' : 'Получить код'}
                  </Button>
                )}
              </Block>
            </>
          )}
        </>
      )}

      {note && (
        <Block>
          <p className="text-[14px] leading-snug text-[#2a8bff]">{note}</p>
        </Block>
      )}
    </>
  )
}
