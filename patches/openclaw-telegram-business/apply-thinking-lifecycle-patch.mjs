#!/usr/bin/env node
import { copyFile, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MARKER = "AIME_TELEGRAM_THINKING_LIFECYCLE_V1";
const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const root = process.env.OPENCLAW_PACKAGE_ROOT ?? join(globalRoot, "openclaw");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.version !== "2026.7.1-2") throw new Error(`Unsupported OpenClaw ${pkg.version}`);
const dist = join(root, "dist");
const names = await readdir(dist);
async function find(prefix, needle) {
  const hits = [];
  for (const name of names.filter((v) => v.startsWith(prefix) && v.endsWith(".js"))) {
    const path = join(dist, name);
    const source = await readFile(path, "utf8");
    if (source.includes(needle) || source.includes(MARKER)) hits.push({ path, source });
  }
  if (hits.length !== 1) throw new Error(`Expected one ${prefix} bundle, found ${hits.length}`);
  return hits[0];
}
function once(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) throw new Error(`Invalid anchor: ${label}`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}
async function save(path, source) {
  await copyFile(path, `${path}.aime-thinking-lifecycle-backup`);
  const tmp = `${path}.aime-thinking-lifecycle-tmp`;
  await writeFile(tmp, source);
  await rename(tmp, path);
  console.log(`patched: ${path}`);
}

const draft = await find("bot-deps-", "function createAimeTelegramNativeRichDraftStream(params)");
const send = await find("send-", "const appendAimeRichFooter = (html) => html;");
if (draft.source.includes(MARKER) && send.source.includes(MARKER)) {
  console.log("already patched");
  process.exit(0);
}
if (draft.source.includes(MARKER) || send.source.includes(MARKER)) throw new Error("Partial lifecycle patch detected");

let patchedDraft = once(
  draft.source,
  'function createAimeTelegramNativeRichDraftStream(params) {\n\tconst raw = getTelegramRichRawApi(params.api);',
  `// ${MARKER}\nfunction createAimeTelegramNativeRichDraftStream(params) {\n\tconst raw = getTelegramRichRawApi(params.api);`,
  "draft marker",
);
patchedDraft = once(
  patchedDraft,
  '\tlet pendingText = "";\n\tlet lastDeliveredText = "";',
  '\tlet pendingText = "Думаю…";\n\tlet lastDeliveredText = "";',
  "initial thinking label",
);
patchedDraft = once(
  patchedDraft,
  '\t};\n\tconst flush = async () => {',
  '\t};\n\t// Send the ephemeral placeholder immediately, even before commentary or a tool call.\n\tqueue = queue.then(sendPending, sendPending);\n\tconst flush = async () => {',
  "immediate draft send",
);

const identityFooter = '\t// AIME_TELEGRAM_RICH_DRAFT_10_2_V2\n\t// AIME_TELEGRAM_CLEAN_RICH_OUTPUT_V1: keep final replies clean; no automatic metadata footer.\n\tconst appendAimeRichFooter = (html) => html;\n';
const restoredFooter = `\t// AIME_TELEGRAM_RICH_DRAFT_10_2_V2\n\t// ${MARKER}: preserve the final native footer; only the activity summary is suppressed.\n\tconst appendAimeRichFooter = (html, isFinalChunk) => {\n\t\tif (!isFinalChunk) return html;\n\t\tconst starts = globalThis[Symbol.for("aime.telegram.richTurnStarts")];\n\t\tconst key = String(chatId);\n\t\tconst startedAt = starts?.get(key);\n\t\tif (startedAt !== void 0) starts.delete(key);\n\t\tconst seconds = startedAt !== void 0 ? Math.max(1, Math.round((Date.now() - startedAt) / 1e3)) : 1;\n\t\treturn \`\${html}<footer>aiMe · GPT‑5.6 · Rich/Thinking · ответ: \${seconds} сек</footer>\`;\n\t};\n`;
const patchedSend = once(send.source, identityFooter, restoredFooter, "restore native footer");
await save(draft.path, patchedDraft);
await save(send.path, patchedSend);
