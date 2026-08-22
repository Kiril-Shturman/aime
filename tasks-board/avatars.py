"""Скачивает аватарки ботов с их публичных страниц t.me.

Токены ботов для этого не нужны: t.me отдаёт картинку в og:image.
Файлы кладём в static/avatars/<handle>.jpg и прописываем путь в data.json,
чтобы мини-аппа не ходила в сеть на каждом открытии.
"""
import json
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data.json")
AVA = os.path.join(ROOT, "static", "avatars")
UA = {"User-Agent": "Mozilla/5.0"}


def fetch_avatar(handle):
    name = handle.lstrip("@")
    page = urllib.request.urlopen(
        urllib.request.Request(f"https://t.me/{name}", headers=UA), timeout=20
    ).read().decode("utf-8", "ignore")
    m = re.search(r'<meta property="og:image" content="([^"]+)"', page)
    if not m:
        return None
    url = m.group(1)
    if "/img/" in url:  # заглушка телеграма вместо реального фото
        return None
    os.makedirs(AVA, exist_ok=True)
    path = os.path.join(AVA, f"{name}.jpg")
    data = urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=20
    ).read()
    with open(path, "wb") as f:
        f.write(data)
    return f"/avatars/{name}.jpg"


def main():
    state = json.load(open(DATA, encoding="utf-8"))
    for project in state["projects"]:
        for bot in project["members"]:
            if not bot.get("handle"):
                continue
            try:
                avatar = fetch_avatar(bot["handle"])
            except Exception as exc:  # сеть или удалённый бот — просто пропускаем
                print(bot["handle"], "ошибка:", exc)
                continue
            bot["avatar"] = avatar
            print(bot["handle"], avatar or "фото нет")
    json.dump(state, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
