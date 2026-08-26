import { useNavigate } from 'react-router-dom'
import { Block, Navbar, NavbarBackLink, Page } from 'konsta/react'

interface Section {
  title: string
  text: string
}

interface Props {
  title: string
  updated: string
  sections: Section[]
}

// Общий каркас правовых страниц (Условия / Политика). Тексты приходят
// пропсами — сама страница только вёрстка.
export default function LegalPage({ title, updated, sections }: Props) {
  const nav = useNavigate()
  return (
    <Page className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title={title}
        left={
          <NavbarBackLink text="Назад" onClick={() => nav(-1)} />
        }
      />
      <div className="mx-auto w-full max-w-[720px] pb-10">
        <Block className="!mt-4 !mb-2">
          <h1 className="text-[26px] font-extrabold leading-tight text-black dark:text-white">
            {title}
          </h1>
          <div className="text-[13px] text-black/50 dark:text-white/40 mt-1">
            {updated}
          </div>
        </Block>

        {sections.map((s, i) => (
          <Block key={i} className="!mt-2">
            <h2 className="text-[17px] font-bold text-black dark:text-white leading-snug">
              {i + 1}. {s.title}
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-black/75 dark:text-white/70">
              {s.text}
            </p>
          </Block>
        ))}
      </div>
    </Page>
  )
}
