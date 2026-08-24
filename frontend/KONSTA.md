# Konsta UI — памятка по нашей версии

Konsta 5.3.0, тема `ios`, тёмная. Это порт Framework7 на React поверх
Tailwind: компоненты не тащат свой css, а раздают тейлвиндовые классы,
поэтому любой из них можно дожать через `className`.

**Главное правило: не вспоминать пропы, а смотреть.** Типы лежат прямо в
проекте, `node_modules/konsta/react/types/*.d.ts` — 62 файла, по одному на
компонент. Там же в описаниях указаны значения по умолчанию. Всё, что мы
сегодня чинили, было выдумано по памяти и не существует.

## Как подключено

`src/App.tsx` оборачивает всё в `<App theme="ios" dark>`. Без этой обёртки
компоненты не знают тему и часть стилей не применяется.

`src/index.css` подключает Tailwind, тему Konsta и указывает, где искать
классы:

```css
@import 'tailwindcss';
@import 'konsta/react/theme.css';
@source '../node_modules/konsta';
```

`@source` обязателен: без него Tailwind не увидит классы внутри библиотеки
и выкинет их из сборки как неиспользуемые.

## Цвета

Фирменный цвет задаётся одной переменной, всё остальное считается от неё:

```css
@theme {
  --color-brand-primary: #2a8bff;
}
```

По умолчанию там айосный `#007aff`. Точечно цвет компонента меняется пропом
`colors`, и ключи в нём **разделены по темам**:

```jsx
colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }}
```

Ключа `text` не существует. У каждого компонента свой набор — смотри его
`.d.ts`. У `Button`, например: `textIos`, `fillTextIos`, `fillBgIos`,
`clearIos`, `clearBgIos` и те же с `Material`.

## Скелет экрана

```jsx
<Page>
  <Navbar title="Задачи" large transparent
          left={<NavbarBackLink text="Назад" onClick={() => navigate('/')} />}
          right={<Link iconOnly onClick={…}><Search size={22} /></Link>} />
  <List strong inset>
    <ListItem title="Строка" after="12" link linkComponent={RouterLink}
              linkProps={{ to: '/project/1' }} />
  </List>
  <Fab icon={<Plus />} onClick={…} />
</Page>
```

Всплывающие: `Sheet`, `Popup`, `Popover`, `Dialog`, `Actions` — у всех
одинаковая пара пропов `opened` и `onBackdropClick`.

## Грабли, на которые мы уже наступали

| Написали | Правда |
|---|---|
| `<Link navbar>` | пропа нет, навбарный стиль приходит из контекста `Navbar` |
| `<NavbarBackLink linkProps={{to}}>` | не принимает роутерных пропов, переход вешай на `onClick` с `useNavigate` |
| `colors={{ text, activeBg }}` | ключи по темам: `textIos`/`textMaterial`, фон у `clear`-кнопки — `clearBgIos` |
| `<Searchbar disableButtonText="Готово">` | в 5.3 кнопка отмены рисуется иконкой, подписи у неё нет |
| `<Fab>+</Fab>` | это была наша обёртка `components/Fab.tsx`: она рисует иконку сама и детей не берёт. У самого Konsta `Fab` дети разрешены, но иконку правильнее давать пропом `icon`, а подпись — `text` |

Все пять валили `tsc -b`, то есть до прода не доехали бы в любом случае:
сервер собирает фронт сам и при ошибке типов остаётся на прошлой версии.

## Что есть в библиотеке

Экран и навигация: `App` `Page` `Navbar` `NavbarBackLink` `Toolbar` `Tabbar`
`TabbarLink` `Panel` `Breadcrumbs`.
Списки: `List` `ListItem` `ListInput` `ListButton` `ListGroup` `MenuList`
`MenuListItem`.
Блоки и текст: `Block` `BlockTitle` `BlockHeader` `BlockFooter` `Card`
`Chip` `Badge` `Table` со свитой.
Ввод: `Button` `Link` `Checkbox` `Radio` `Toggle` `Range` `Stepper`
`Segmented` `SegmentedButton` `Searchbar` `Messagebar`.
Всплывающее: `Sheet` `Popup` `Popover` `Dialog` `DialogButton` `Actions`
`ActionsGroup` `ActionsButton` `ActionsLabel` `Notification` `Toast`.
Состояние: `Preloader` `Progressbar`.
Прочее: `Fab` `Icon` `Glass` `Messages` `Message` `MessagesTitle`.

## Наши обёртки

`components/Sheet.tsx`, `Menu.tsx`, `Popup.tsx` — тонкие надстройки над
`Sheet`, `Popover` и `Popup`: добавляют вибрацию, перетаскивание за
полоску и единую шапку. Новые экраны собираем из них, а не из голого
Konsta, иначе поведение разъедется.

## Проверка перед пушем

```bash
cd tasks-board/frontend
npx tsc -b        # ровно то, что гоняет сервер при выкатке
npm run dev       # локально, с прокси на api доски
```
