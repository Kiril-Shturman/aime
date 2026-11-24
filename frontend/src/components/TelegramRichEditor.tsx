import {
  Bold,
  Braces,
  CheckSquare,
  ChevronDown,
  Code2,
  Heading1,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Sigma,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  length: number;
  limit: number;
};

type ToolProps = {
  label: string;
  children: ReactNode;
  onClick: () => void;
};

function Tool({ label, children, onClick }: ToolProps) {
  return (
    <button
      type="button"
      className="tg-rich-tool"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function TelegramRichEditor({ value, onChange, length, limit }: Props) {
  const editor = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value)
      editor.current.innerHTML = value;
  }, [value]);

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.current) return;
    const range = selection.getRangeAt(0);
    if (editor.current.contains(range.commonAncestorContainer))
      savedRange.current = range.cloneRange();
  }

  function restoreSelection() {
    editor.current?.focus();
    const selection = window.getSelection();
    if (!selection || !savedRange.current) return;
    selection.removeAllRanges();
    selection.addRange(savedRange.current);
  }

  function sync() {
    if (!editor.current) return;
    onChange(editor.current.innerHTML);
    rememberSelection();
  }

  function command(name: string, argument?: string) {
    restoreSelection();
    document.execCommand(name, false, argument);
    sync();
  }

  function insert(html: string) {
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    sync();
  }

  function wrap(tag: string, placeholder: string, attrs = "") {
    restoreSelection();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const selected = range.toString();
    insert(`<${tag}${attrs}>${escapeHtml(selected || placeholder)}</${tag}>`);
  }

  function ask(label: string, initial = "") {
    return window.prompt(label, initial)?.trim() || "";
  }

  function addLink() {
    const url = ask("Ссылка: https://…, mailto:…, tel:… или #якорь", "https://");
    if (url) command("createLink", url);
  }

  function addTime() {
    const source = ask("Дата и время (например 2026-11-18 12:00)");
    if (!source) return;
    const unix = Math.floor(new Date(source.replace(" ", "T")).getTime() / 1000);
    if (!Number.isFinite(unix)) return window.alert("Не удалось распознать дату");
    insert(`<tg-time unix="${unix}" format="wDT">${escapeHtml(source)}</tg-time>`);
  }

  function addEmoji() {
    const id = ask("ID кастомного emoji");
    if (/^\d+$/.test(id)) insert(`<tg-emoji emoji-id="${id}">🙂</tg-emoji>`);
  }

  function addMath(block = false) {
    const formula = ask("Формула LaTeX", "E = mc^2");
    if (formula) wrap(block ? "tg-math-block" : "tg-math", formula);
  }

  function addReference() {
    const name = ask("Имя сноски", "note-1").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!name) return;
    const body = ask("Текст сноски");
    if (body)
      insert(`<a href="#${name}">[${name}]</a><tg-reference name="${name}">${escapeHtml(body)}</tg-reference>`);
  }

  function addButton() {
    const title = ask("Текст кнопки", "Открыть");
    if (!title) return;
    const url = ask("URL кнопки", "https://");
    if (!/^(https?:|tg:)/i.test(url)) return window.alert("Нужна ссылка http(s):// или tg://");
    insert(`<tg-button-row align="center"><tg-button type="url" style="primary" url="${escapeAttr(url)}">${escapeHtml(title)}</tg-button></tg-button-row>`);
  }

  function mediaTag(url: string) {
    const path = url.split("?")[0].toLowerCase();
    if (/\.(mp4|mov|webm|gif)$/.test(path)) return "video";
    if (/\.(mp3|m4a|ogg|wav)$/.test(path)) return "audio";
    if (/\.(jpg|jpeg|png|webp)$/.test(path)) return "img";
    return "tg-document";
  }

  function addMedia() {
    const url = ask("Прямая HTTPS-ссылка на фото, видео, аудио или файл", "https://");
    if (!/^https:\/\//i.test(url)) return;
    const caption = ask("Подпись (необязательно)");
    const tag = mediaTag(url);
    const media = tag === "img" ? `<img src="${escapeAttr(url)}">` : `<${tag} src="${escapeAttr(url)}"></${tag}>`;
    insert(caption ? `<figure>${media}<figcaption>${escapeHtml(caption)}</figcaption></figure>` : media);
  }

  function addGallery(kind: "tg-collage" | "tg-slideshow") {
    const first = ask("HTTPS-ссылка на первое фото или видео", "https://");
    const second = ask("HTTPS-ссылка на второе фото или видео", "https://");
    if (![first, second].every((url) => /^https:\/\//i.test(url))) return;
    const items = [first, second].map((url) => {
      const tag = mediaTag(url) === "video" ? "video" : "img";
      return tag === "img" ? `<img src="${escapeAttr(url)}">` : `<video src="${escapeAttr(url)}"></video>`;
    }).join("");
    insert(`<${kind}>${items}</${kind}>`);
  }

  function addMap() {
    const coordinates = ask("Широта, долгота", "55.751244, 37.618423");
    const [lat, long] = coordinates.split(",").map((value) => Number(value.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(long)) return;
    insert(`<tg-map lat="${lat}" long="${long}" zoom="14"></tg-map>`);
  }

  function addCopyButton() {
    const title = ask("Название кнопки", "Скопировать");
    const copied = ask("Текст для копирования");
    if (title && copied)
      insert(`<tg-button-row align="center"><tg-button type="copy_text" text="${escapeAttr(copied)}">${escapeHtml(title)}</tg-button></tg-button-row>`);
  }

  return (
    <div className="tg-rich-editor">
      <div className="tg-rich-head">
        <div>
          <b>Rich Message</b>
          <span>Telegram Bot API</span>
        </div>
        <div className="tg-rich-history">
          <Tool label="Отменить" onClick={() => command("undo")}><Undo2 size={17} /></Tool>
          <Tool label="Повторить" onClick={() => command("redo")}><Redo2 size={17} /></Tool>
          <em className={length > limit ? "is-over" : ""}>{length}/{limit}</em>
        </div>
      </div>
      <div
        ref={editor}
        className="tg-rich-canvas"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder="Напишите сообщение…"
        suppressContentEditableWarning
        onInput={sync}
        onBlur={rememberSelection}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onPaste={(event) => {
          event.preventDefault();
          insert(escapeHtml(event.clipboardData.getData("text/plain")).replace(/\n/g, "<br>"));
        }}
      />
      <div className="tg-rich-formatbar">
        <Tool label="Жирный" onClick={() => command("bold")}><Bold size={18} /></Tool>
        <Tool label="Курсив" onClick={() => command("italic")}><Italic size={18} /></Tool>
        <Tool label="Подчёркивание" onClick={() => command("underline")}><Underline size={18} /></Tool>
        <Tool label="Зачёркивание" onClick={() => command("strikeThrough")}><Strikethrough size={18} /></Tool>
        <Tool label="Подсветка" onClick={() => wrap("mark", "важно")}><Highlighter size={18} /></Tool>
        <Tool label="Спойлер" onClick={() => wrap("tg-spoiler", "скрытый текст")}><span className="tg-rich-spoiler-icon">S</span></Tool>
        <Tool label="Ссылка" onClick={addLink}><Link2 size={18} /></Tool>
        <Tool label="Код" onClick={() => wrap("code", "код")}><Code2 size={18} /></Tool>
        <Tool label="Очистить формат" onClick={() => command("removeFormat")}><RemoveFormatting size={18} /></Tool>
      </div>
      {more ? (
        <div className="tg-rich-more">
          <div className="tg-rich-group">
            <span>Блоки</span>
            <button type="button" onClick={() => command("formatBlock", "p")}>Текст</button>
            <button type="button" onClick={() => command("formatBlock", "h1")}>H1</button>
            <button type="button" onClick={() => command("formatBlock", "h2")}>H2</button>
            <button type="button" onClick={() => command("formatBlock", "h3")}>H3</button>
            <button type="button" onClick={() => command("formatBlock", "blockquote")}>Цитата</button>
            <button type="button" onClick={() => insert("<blockquote expandable>Сворачиваемая цитата</blockquote>")}>Сворачиваемая</button>
            <button type="button" onClick={() => insert("<aside>Выносная цитата<cite>Автор</cite></aside>")}>Выносная</button>
            <button type="button" onClick={() => command("formatBlock", "pre")}>Блок кода</button>
            <button type="button" onClick={() => insert("<details><summary>Заголовок</summary><p>Содержимое</p></details>")}>Раскрывающийся блок</button>
          </div>
          <div className="tg-rich-group">
            <span>Вставка</span>
            <button type="button" onClick={() => command("insertUnorderedList")}><List size={15} /> Список</button>
            <button type="button" onClick={() => command("insertOrderedList")}><ListOrdered size={15} /> Нумерация</button>
            <button type="button" onClick={() => insert('<ul><li><input type="checkbox"> Задача</li></ul>')}><CheckSquare size={15} /> Чек-лист</button>
            <button type="button" onClick={() => insert("<hr>")}><Minus size={15} /> Разделитель</button>
            <button type="button" onClick={() => insert("<table bordered striped compact><tr><th>Колонка 1</th><th>Колонка 2</th></tr><tr><td>Значение</td><td>Значение</td></tr></table>")}><Table2 size={15} /> Таблица</button>
            <button type="button" onClick={addTime}>Дата / время</button>
            <button type="button" onClick={addEmoji}>Custom emoji</button>
            <button type="button" onClick={addReference}>Сноска</button>
            <button type="button" onClick={addButton}>Кнопка</button>
            <button type="button" onClick={addCopyButton}>Копировать</button>
            <button type="button" onClick={addMedia}>Медиа URL</button>
            <button type="button" onClick={() => addGallery("tg-collage")}>Коллаж</button>
            <button type="button" onClick={() => addGallery("tg-slideshow")}>Слайд-шоу</button>
            <button type="button" onClick={addMap}>Карта</button>
          </div>
          <div className="tg-rich-group">
            <span>Формат</span>
            <button type="button" onClick={() => wrap("sub", "нижний индекс")}><Subscript size={15} /> Нижний индекс</button>
            <button type="button" onClick={() => wrap("sup", "верхний индекс")}><Superscript size={15} /> Верхний индекс</button>
            <button type="button" onClick={() => addMath(false)}><Sigma size={15} /> Формула</button>
            <button type="button" onClick={() => addMath(true)}><Braces size={15} /> Блок формулы</button>
            <button type="button" onClick={() => insert("<footer>Примечание</footer>")}>Примечание</button>
          </div>
        </div>
      ) : null}
      <div className="tg-rich-composebar">
        <button type="button" className={more ? "is-active" : ""} onClick={() => setMore((shown) => !shown)}>
          <span>Aa</span><ChevronDown size={15} className={more ? "is-up" : ""} />
        </button>
        <span>Форматирование Telegram Rich Messages</span>
        <div><Heading1 size={18} /><Quote size={18} /><Table2 size={18} /></div>
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
