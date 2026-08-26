import { Navbar, Page } from 'konsta/react'

export default function HistoryPage() {
  return (
    <Page className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar title="История" />
      <div className="px-8 py-20 text-center text-black/55 dark:text-white/45 text-[15px]">
        История чатов появится, когда подключим AI-бэк.
      </div>
    </Page>
  )
}
