#!/usr/bin/env node
import { copyFile, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MARKER = "AIME_TELEGRAM_BUSINESS_DIALOG_SETTINGS_V1";
const OWNER_ID = 341730072;
const root = process.env.OPENCLAW_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "openclaw");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.version !== "2026.7.1-2") throw new Error(`Unsupported OpenClaw ${pkg.version}`);
const dist = join(root, "dist");
const hits = [];
for (const name of (await readdir(dist)).filter((v) => v.startsWith("telegram-ingress-spool-") && v.endsWith(".js"))) {
  const path = join(dist, name);
  const source = await readFile(path, "utf8");
  if (source.includes("AIME_TELEGRAM_BUSINESS_OBSERVER_V1") || source.includes(MARKER)) hits.push({ path, source });
}
if (hits.length !== 1) throw new Error(`Expected one Telegram ingress bundle, found ${hits.length}`);
const { path, source } = hits[0];
if (source.includes(MARKER)) { console.log("already patched"); process.exit(0); }
const anchor = "\tbot.use(async (ctx, next) => {\n\t\tconst callback = ctx.callbackQuery;";
const lines = [
  `\t// ${MARKER}`,
  "\t// Handle Telegram's native /start bizChat<id> setup route without invoking an agent.",
  "\tbot.use(async (ctx, next) => {",
  "\t\tconst message = ctx.message;",
  "\t\tconst ownerId = message?.from?.id;",
  "\t\tconst match = typeof message?.text === \"string\" ? message.text.trim().match(/^\\/start(?:@[A-Za-z0-9_]+)?\\s+bizChat([0-9]+)$/) : null;",
  `\t\tif (match && ownerId === ${OWNER_ID}) {`,
  "\t\t\tconst chatId = match[1];",
  "\t\t\tawait bot.api.sendMessage(message.chat.id, \"Настройка Business-диалога `\" + chatId + \"`\\n\\nВыбери режим:\", {",
  "\t\t\t\treply_markup: { inline_keyboard: [",
  "\t\t\t\t\t[{ text: \"🤖 Автоответ\", callback_data: \"aimeBiz:auto:\" + chatId }],",
  "\t\t\t\t\t[{ text: \"✍️ Черновики\", callback_data: \"aimeBiz:draft:\" + chatId }],",
  "\t\t\t\t\t[{ text: \"🔕 Выключить\", callback_data: \"aimeBiz:off:\" + chatId }]",
  "\t\t\t\t] }",
  "\t\t\t});",
  "\t\t\treturn;",
  "\t\t}",
  "\t\tconst callback = ctx.callbackQuery;",
  "\t\tconst callbackMatch = typeof callback?.data === \"string\" ? callback.data.match(/^aimeBiz:(auto|draft|off):([0-9]+)$/) : null;",
  "\t\tif (!callbackMatch) return await next();",
  `\t\tif (callback.from?.id !== ${OWNER_ID}) {`,
  "\t\t\tawait bot.api.answerCallbackQuery(callback.id, { text: \"Недоступно\", show_alert: true });",
  "\t\t\treturn;",
  "\t\t}",
  "\t\tconst [, mode, businessChatId] = callbackMatch;",
  "\t\tconst settingsPath = process.env.AIME_TELEGRAM_BUSINESS_SETTINGS ?? path.join(process.env.HOME ?? process.cwd(), \".openclaw\", \"workspace\", \"memory\", \"telegram-business-settings.jsonl\");",
  "\t\tawait mkdir(path.dirname(settingsPath), { recursive: true });",
  "\t\tawait appendFile(settingsPath, JSON.stringify({ changedAt: new Date().toISOString(), chatId: businessChatId, mode, ownerId: callback.from.id }) + \"\\n\", { mode: 384 });",
  "\t\tawait bot.api.answerCallbackQuery(callback.id, { text: mode === \"auto\" ? \"Автоответ выбран\" : mode === \"draft\" ? \"Черновики выбраны\" : \"Автоответ выключен\" });",
  "\t\tconst label = mode === \"auto\" ? \"🤖 Автоответ\" : mode === \"draft\" ? \"✍️ Черновики\" : \"🔕 Выключено\";",
  "\t\tif (callback.message) await bot.api.editMessageText(callback.message.chat.id, callback.message.message_id, \"Business-диалог \" + businessChatId + \"\\n\\nРежим: \" + label);",
  "\t\treturn;",
  "\t});",
  anchor,
];
if (!source.includes(anchor)) throw new Error("Callback middleware anchor not found");
const patched = source.replace(anchor, lines.join("\n"));
await copyFile(path, `${path}.aime-dialog-settings-backup`);
const tmp = `${path}.aime-dialog-settings-tmp`;
await writeFile(tmp, patched);
await rename(tmp, path);
console.log(`patched: ${path}`);
