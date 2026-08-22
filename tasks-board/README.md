# Доска задач

Мини-аппа Телеграма в духе «Напоминаний» Apple: тёмный экран, плитки-сводки,
проекты с командой и роудмапом. Задумана как **состояние** для агента —
он читает и закрывает задачи через API, а человек смотрит ту же доску глазами.

## Что внутри

- `server.py` — aiohttp на порту 8095, хранилище в `data.json` (создаётся сам).
- `static/index.html` — весь интерфейс одним файлом: разметка, стили, логика.
- `avatars.py` — тянет аватарки телеграм-ботов с их публичных страниц `t.me`
  (токены не нужны) и складывает в `static/avatars/`.

## Запуск

```bash
pip3 install aiohttp
python3 server.py            # http://localhost:8095
python3 avatars.py           # подтянуть аватарки участников-ботов
```

## Модель данных

```
проект   { id, name, color, note, members[], roadmap[] }
участник { id, name, handle, role, kind: bot|agent|service|human, avatar }
этап     { id, title, date, status: planned|active|done, progress {done,total} }
задача   { id, title, note, report, url, project, stage, member,
           status: todo|doing|done, due, time, flagged, done }
```

Задача привязана к этапу — у одного этапа их бывает десяток. Отсюда прогресс
этапа «3 из 7» и группировка задач под этапами на экране проекта.

Участник — не обязательно телеграм-бот: это может быть ИИ-агент, сервис или
человек. Роль пишется словами и видна в строке.

## API

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/state` | сводка, проекты, задачи одним ответом |
| POST | `/api/task` | `{title, note, url, project, stage, member, due, time, flagged}` |
| PATCH | `/api/task/<id>` | `{title, note, status, stage, member, report, due, time, flagged}` |
| POST | `/api/task/<id>/toggle` | отметить выполненной и обратно |
| DELETE | `/api/task/<id>` | удалить |
| POST | `/api/project` | `{name, color, note, members[]}` |
| PATCH | `/api/project/<id>` | `{name, color, note}` |
| DELETE | `/api/project/<id>` | вместе с задачами |
| POST | `/api/project/<id>/member` | `{name, handle, role, kind}` |
| DELETE | `/api/project/<id>/member/<mid>` | убрать участника |
| POST | `/api/project/<id>/stage` | этап роудмапа |
| PATCH | `/api/project/<id>/stage/<sid>` | сменить статус или текст |
| DELETE | `/api/project/<id>/stage/<sid>` | убрать этап |

## Чего пока нет

Доска — это только состояние, зато уже полное: цель (этап), её разбор на
задачи, статус «в работе» и отчёт о сделанном. Для замкнутого цикла не хватает
коннектора (агент ещё не ходит в это API), расписания (никто его не будит),
подагентов под роли и навыков.
