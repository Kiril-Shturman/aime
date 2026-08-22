#!/usr/bin/env node
import { copyFile, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const PATCH_MARKER = "AIME_TELEGRAM_RICH_DRAFT_10_2_V2";
const LEGACY_MARKER = "AIME_TELEGRAM_RICH_DRAFT_10_2_V1";
const EXPECTED_VERSION = "2026.7.1-2";
const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const packageRoot = process.env.OPENCLAW_PACKAGE_ROOT ?? join(globalRoot, "openclaw");
const dist = join(packageRoot, "dist");
const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (pkg.version !== EXPECTED_VERSION) {
  throw new Error(`Refusing to patch OpenClaw ${pkg.version}; expected ${EXPECTED_VERSION}`);
}

const names = (await readdir(dist)).filter((name) => name.endsWith(".js"));
async function discover(uniqueNeedle, namePrefix) {
  const matches = [];
  for (const name of names.filter((candidate) => candidate.startsWith(namePrefix))) {
    const path = join(dist, name);
    const source = await readFile(path, "utf8");
    if (source.includes(uniqueNeedle)) matches.push({ path, source });
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one bundle containing ${JSON.stringify(uniqueNeedle)}, found ${matches.length}`);
  }
  return matches[0];
}
function replaceOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`Patch anchor not found: ${label}`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}
async function atomicPatch(path, source) {
  const backup = `${path}.aime-rich-10-2-backup`;
  await copyFile(path, backup);
  const temp = `${path}.aime-rich-10-2-tmp`;
  await writeFile(temp, source);
  await rename(temp, path);
  console.log(`patched: ${path}`);
}

const draftBundle = await discover("function createTelegramDraftStream(params)", "bot-deps-");
const sendBundle = await discover("const sendTelegramRichTextChunks = async (chunks, context, options = {}) => {", "send-");

const progressFormatterImplementation = `function aimeTelegramProgressRichText(value) {\n\tconst lines = String(value).split("\\n");\n\tconst result = [];\n\tconst appendInline = (line) => {\n\t\tconst pattern = /(\\*\\*([^*]+)\\*\\*|\\\`([^\\\`]+)\\\`)/g;\n\t\tlet cursor = 0;\n\t\tfor (const match of line.matchAll(pattern)) {\n\t\t\tif (match.index > cursor) result.push(line.slice(cursor, match.index));\n\t\t\tif (match[2] !== void 0) result.push({ type: "bold", text: match[2] });\n\t\t\telse result.push({ type: "code", text: match[3] });\n\t\t\tcursor = match.index + match[0].length;\n\t\t}\n\t\tif (cursor < line.length) result.push(line.slice(cursor));\n\t};\n\tfor (let index = 0; index < lines.length; index += 1) {\n\t\tif (index > 0) result.push("\\n");\n\t\tconst line = lines[index] ?? "";\n\t\tconst trimmed = line.trim();\n\t\tif (trimmed.length >= 2 && trimmed.startsWith("\\\`") && trimmed.endsWith("\\\`")) {\n\t\t\tresult.push({ type: "code", text: trimmed.slice(1, -1) });\n\t\t} else if (index === 0 && trimmed) {\n\t\t\tresult.push({ type: "bold", text: line });\n\t\t} else appendInline(line);\n\t}\n\treturn result;\n}\n`;

if (draftBundle.source.includes(LEGACY_MARKER) && sendBundle.source.includes(LEGACY_MARKER)) {
  let migratedDraft = replaceOnce(draftBundle.source, LEGACY_MARKER, PATCH_MARKER, "legacy draft marker");
  migratedDraft = replaceOnce(migratedDraft, "function createAimeTelegramNativeRichDraftStream(params) {", `${progressFormatterImplementation}function createAimeTelegramNativeRichDraftStream(params) {`, "progress RichText formatter");
  migratedDraft = replaceOnce(migratedDraft, 'rich_message: { blocks: [{ type: "thinking", text }] },', 'rich_message: { blocks: [{ type: "thinking", text: aimeTelegramProgressRichText(text) }] },', "formatted thinking payload");
  const migratedSend = replaceOnce(sendBundle.source, LEGACY_MARKER, PATCH_MARKER, "legacy send marker");
  await atomicPatch(draftBundle.path, migratedDraft);
  await atomicPatch(sendBundle.path, migratedSend);
  process.exit(0);
}

if (draftBundle.source.includes(PATCH_MARKER) && sendBundle.source.includes(PATCH_MARKER)) {
  console.log("already patched");
  process.exit(0);
}
if (draftBundle.source.includes(PATCH_MARKER) || sendBundle.source.includes(PATCH_MARKER)) {
  throw new Error("Partial rich-draft patch detected; restore backups before retrying");
}

const nativeDraftImplementation = `// ${PATCH_MARKER}\nconst AIME_TG_TURN_STARTS_KEY = Symbol.for("aime.telegram.richTurnStarts");\nfunction getAimeTelegramTurnStarts() {\n\treturn globalThis[AIME_TG_TURN_STARTS_KEY] ??= /* @__PURE__ */ new Map();\n}\n${progressFormatterImplementation}function createAimeTelegramNativeRichDraftStream(params) {\n\tconst raw = getTelegramRichRawApi(params.api);\n\tconst chatId = params.chatId;\n\tconst threadParams = buildTelegramThreadParams(params.thread);\n\tconst draftContext = threadParams?.message_thread_id !== void 0 ? { message_thread_id: threadParams.message_thread_id } : {};\n\tlet draftId = Math.floor(Math.random() * 2147483646) + 1;\n\tlet pendingText = "";\n\tlet lastDeliveredText = "";\n\tlet stopped = false;\n\tlet timer;\n\tlet revision = 0;\n\tlet sent = false;\n\tlet queue = Promise.resolve();\n\tgetAimeTelegramTurnStarts().set(String(chatId), Date.now());\n\tconst sendPending = async () => {\n\t\tif (stopped) return;\n\t\tconst text = pendingText.trim();\n\t\tif (!text || text === lastDeliveredText) return;\n\t\tpendingText = "";\n\t\ttry {\n\t\t\tawait raw.sendRichMessageDraft({\n\t\t\t\tchat_id: chatId,\n\t\t\t\tdraft_id: draftId,\n\t\t\t\trich_message: { blocks: [{ type: "thinking", text: aimeTelegramProgressRichText(text) }] },\n\t\t\t\t...draftContext\n\t\t\t});\n\t\t\tlastDeliveredText = text;\n\t\t\trevision += 1;\n\t\t\tsent = true;\n\t\t} catch (err) {\n\t\t\tparams.warn?.(\`telegram native rich draft failed: \${formatErrorMessage(err)}\`);\n\t\t}\n\t};\n\tconst flush = async () => {\n\t\tif (timer) {\n\t\t\tclearTimeout(timer);\n\t\t\ttimer = void 0;\n\t\t}\n\t\tqueue = queue.then(sendPending, sendPending);\n\t\tawait queue;\n\t};\n\tconst schedule = () => {\n\t\tif (timer || stopped) return;\n\t\ttimer = setTimeout(() => {\n\t\t\ttimer = void 0;\n\t\t\tqueue = queue.then(sendPending, sendPending);\n\t\t}, 250);\n\t};\n\tconst update = (text) => {\n\t\tif (stopped) return;\n\t\tpendingText = text;\n\t\tschedule();\n\t};\n\tconst updatePreview = (preview) => update(preview.text);\n\tconst stop = async () => {\n\t\tawait flush();\n\t\tstopped = true;\n\t};\n\tconst clear = async () => {\n\t\tstopped = true;\n\t\tpendingText = "";\n\t\tif (timer) clearTimeout(timer);\n\t\ttimer = void 0;\n\t\tawait queue;\n\t};\n\tconst reset = () => {\n\t\tstopped = false;\n\t\tpendingText = "";\n\t\tlastDeliveredText = "";\n\t\tdraftId = Math.floor(Math.random() * 2147483646) + 1;\n\t\tgetAimeTelegramTurnStarts().set(String(chatId), Date.now());\n\t};\n\tparams.log?.(\`telegram native rich draft ready (draftId=\${draftId})\`);\n\treturn {\n\t\tupdate,\n\t\tupdatePreview,\n\t\tflush,\n\t\tmessageId: () => void 0,\n\t\tvisibleSinceMs: () => void 0,\n\t\tpreviewRevision: () => revision,\n\t\tlastDeliveredText: () => lastDeliveredText,\n\t\tclear,\n\t\tstop,\n\t\tdiscard: clear,\n\t\tmaterialize: async () => { await stop(); return void 0; },\n\t\tfinalizeToPreview: async () => void 0,\n\t\tforceNewMessage: reset,\n\t\trotateToNewMessageDeferringDelete: () => { reset(); return void 0; },\n\t\tsendMayHaveLanded: () => false\n\t};\n}\n`;
let patchedDraft = replaceOnce(
  draftBundle.source,
  "function createTelegramDraftStream(params) {\n\tconst richMessages = params.richMessages === true;",
  `${nativeDraftImplementation}function createTelegramDraftStream(params) {\n\tif (params.richMessages === true && params.minInitialChars === 0) return createAimeTelegramNativeRichDraftStream(params);\n\tconst richMessages = params.richMessages === true;`,
  "native draft stream entry",
);

const footerHelper = `\t// ${PATCH_MARKER}\n\tconst appendAimeRichFooter = (html, isFinalChunk) => {\n\t\tif (!isFinalChunk) return html;\n\t\tconst starts = globalThis[Symbol.for("aime.telegram.richTurnStarts")];\n\t\tconst key = String(chatId);\n\t\tconst startedAt = starts?.get(key);\n\t\tif (startedAt !== void 0) starts.delete(key);\n\t\tconst seconds = startedAt !== void 0 ? Math.max(1, Math.round((Date.now() - startedAt) / 1e3)) : 1;\n\t\treturn \`\${html}<footer>aiMe · GPT‑5.6 · Rich/Thinking · ответ: \${seconds} сек</footer>\`;\n\t};\n`;
let patchedSend = replaceOnce(
  sendBundle.source,
  "\tconst sendTelegramRichTextChunks = async (chunks, context, options = {}) => {\n\t\tconst richRawApi = getTelegramRichRawApi(api);",
  `\tconst sendTelegramRichTextChunks = async (chunks, context, options = {}) => {\n${footerHelper}\t\tconst richRawApi = getTelegramRichRawApi(api);`,
  "footer helper",
);
patchedSend = replaceOnce(
  patchedSend,
  "\t\t\tconst acceptedParams = buildRichTextParams(index, chunks.length, index === chunks.length - 1, options.replyToAlreadyUsed === true);\n\t\t\tlet result;",
  "\t\t\tconst acceptedParams = buildRichTextParams(index, chunks.length, index === chunks.length - 1, options.replyToAlreadyUsed === true);\n\t\t\tconst finalHtml = appendAimeRichFooter(chunk.text, index === chunks.length - 1);\n\t\t\tlet result;",
  "final footer calculation",
);
patchedSend = replaceOnce(
  patchedSend,
  "\t\t\t\t\t\trich_message: chunk.skipEntityDetection ? {\n\t\t\t\t\t\t\thtml: chunk.text,\n\t\t\t\t\t\t\tskip_entity_detection: true\n\t\t\t\t\t\t} : { html: chunk.text },",
  "\t\t\t\t\t\trich_message: chunk.skipEntityDetection ? {\n\t\t\t\t\t\t\thtml: finalHtml,\n\t\t\t\t\t\t\tskip_entity_detection: true\n\t\t\t\t\t\t} : { html: finalHtml },",
  "rich final payload",
);
patchedSend = replaceOnce(
  patchedSend,
  "\t\t\t\t\thtml: chunk.text,\n\t\t\t\t\terr,\n\t\t\t\t\tcontext: \"richMessage\",",
  "\t\t\t\t\thtml: finalHtml,\n\t\t\t\t\terr,\n\t\t\t\t\tcontext: \"richMessage\",",
  "rich fallback footer",
);

await atomicPatch(draftBundle.path, patchedDraft);
await atomicPatch(sendBundle.path, patchedSend);
