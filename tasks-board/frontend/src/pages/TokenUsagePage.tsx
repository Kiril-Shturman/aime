import { Block, BlockTitle, Navbar, NavbarBackLink, Page } from 'konsta/react'
import { useNavigate } from 'react-router-dom'

// Заглушка: настоящая страница расхода токенов осталась незакоммиченной,
// в репозиторий приехал только маршрут на неё. Как только файл появится,
// эту заглушку можно удалить — маршрут менять не придётся.
export default function TokenUsagePage() {
  const navigate = useNavigate()
  return (
    <Page>
      <Navbar title="Расход токенов" left={<NavbarBackLink onClick={() => navigate(-1)} />} />
      <BlockTitle>Страница ещё не приехала</BlockTitle>
      <Block>
        <p className="text-white/50 text-[14px] leading-snug">
          Файл TokenUsagePage не попал в коммит — в репозитории есть только
          маршрут на него. Пришлите файл, и здесь появится обычная страница.
        </p>
      </Block>
    </Page>
  )
}
