#!/usr/bin/env node
import { copyFile, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MARKER = "AIME_TELEGRAM_THINKING_EMOJI_SET_V1";
const SET_NAME = "tgiosicons";
const root = process.env.OPENCLAW_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "openclaw");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.version !== "2026.7.1-2") throw new Error(`Unsupported OpenClaw ${pkg.version}`);
const dist = join(root, "dist");
const names = await readdir(dist);
const hits = [];
for (const name of names.filter((v) => v.startsWith("bot-deps-") && v.endsWith(".js"))) {
  const path = join(dist, name);
  const source = await readFile(path, "utf8");
  if (source.includes("function createAimeTelegramNativeRichDraftStream(params)") || source.includes(MARKER)) hits.push({ path, source });
}
if (hits.length !== 1) throw new Error(`Expected one bot-deps bundle, found ${hits.length}`);
const { path, source } = hits[0];
if (source.includes(MARKER)) {
  console.log("already patched");
  process.exit(0);
}
function once(value, before, after, label) {
  const at = value.indexOf(before);
  if (at < 0 || value.indexOf(before, at + before.length) >= 0) throw new Error(`Invalid anchor: ${label}`);
  return value.slice(0, at) + after + value.slice(at + before.length);
}
const helper = `// ${MARKER}\nconst AIME_TG_THINKING_EMOJI_CACHE_KEY = Symbol.for("aime.telegram.thinkingEmojiSet");\nasync function getAimeTelegramThinkingEmoji(raw) {\n\tlet state = globalThis[AIME_TG_THINKING_EMOJI_CACHE_KEY];\n\tif (!state) {\n\t\tstate = { index: 0, idsPromise: raw.getStickerSet({ name: "${SET_NAME}" }).then((set) => (set.stickers ?? []).map((sticker) => sticker.custom_emoji_id).filter((id) => typeof id === "string" && id.length > 0)).catch(() => []) };\n\t\tglobalThis[AIME_TG_THINKING_EMOJI_CACHE_KEY] = state;\n\t}\n\tconst ids = await state.idsPromise;\n\tif (!ids.length) return;\n\tconst id = ids[state.index % ids.length];\n\tstate.index += 1;\n\treturn id;\n}\n`;
let patched = once(
  source,
  "// AIME_TELEGRAM_THINKING_LIFECYCLE_V1\nfunction createAimeTelegramNativeRichDraftStream(params) {",
  `${helper}// AIME_TELEGRAM_THINKING_LIFECYCLE_V1\nfunction createAimeTelegramNativeRichDraftStream(params) {`,
  "emoji helper insertion",
);
patched = once(
  patched,
  "\t\ttry {\n\t\t\tawait raw.sendRichMessageDraft({",
  "\t\ttry {\n\t\t\tconst customEmojiId = await getAimeTelegramThinkingEmoji(raw);\n\t\t\tawait raw.sendRichMessageDraft({",
  "emoji lookup",
);
patched = once(
  patched,
  'rich_message: { blocks: [{ type: "thinking", text: aimeTelegramProgressRichText(text) }] },',
  'rich_message: { blocks: [{ type: "thinking", text: [...customEmojiId ? [{ type: "custom_emoji", custom_emoji_id: customEmojiId }, " "] : [], ...aimeTelegramProgressRichText(text)] }] },',
  "custom emoji RichText payload",
);
await copyFile(path, `${path}.aime-thinking-emoji-backup`);
const tmp = `${path}.aime-thinking-emoji-tmp`;
await writeFile(tmp, patched);
await rename(tmp, path);
console.log(`patched: ${path}`);
