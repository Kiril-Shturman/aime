#!/usr/bin/env node
import { copyFile, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MARKER = "AIME_TELEGRAM_BUSINESS_AUTO_ROUTE_V1";
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
const observerReturn = "\t\truntime.log?.(`telegram business update archived kind=${kind} updateId=${update.update_id}`);\n\t\treturn;";
const observerReplacement = `\t\truntime.log?.(\`telegram business update archived kind=\${kind} updateId=\${update.update_id}\`);\n\t\t// ${MARKER}\n\t\tif (kind === "business_message") {\n\t\t\tconst msg = update.business_message;\n\t\t\tconst settingsPath = process.env.AIME_TELEGRAM_BUSINESS_SETTINGS ?? path.join(process.env.HOME ?? process.cwd(), ".openclaw", "workspace", "memory", "telegram-business-settings.jsonl");\n\t\t\tconst settingsRaw = await readFile(settingsPath, "utf8").catch(() => "");\n\t\t\tlet selectedMode;\n\t\t\tfor (const line of settingsRaw.split("\\n")) {\n\t\t\t\tif (!line) continue;\n\t\t\t\ttry { const item = JSON.parse(line); if (String(item.chatId) === String(msg.chat?.id)) selectedMode = item.mode; } catch {}\n\t\t\t}\n\t\t\tconst isIncomingHuman = msg.from?.id !== ${OWNER_ID} && msg.from?.is_bot !== true && msg.sender_business_bot !== true;\n\t\t\tif (selectedMode === "auto" && isIncomingHuman) {\n\t\t\t\tupdate.message = msg;\n\t\t\t\tdelete update.business_message;\n\t\t\t\truntime.log?.(\`telegram business auto-route chatId=\${msg.chat?.id} messageId=\${msg.message_id}\`);\n\t\t\t\treturn await next();\n\t\t\t}\n\t\t}\n\t\treturn;`;
if (!source.includes(observerReturn)) throw new Error("Observer return anchor not found");
let patched = source.replace(observerReturn, observerReplacement);
const authAnchor = "\t\t\tif (!(params.dmAccess === \"challenge\" ? await enforceTelegramDmAccess({";
const authReplacement = "\t\t\tif (!params.msg.business_connection_id && !(params.dmAccess === \"challenge\" ? await enforceTelegramDmAccess({";
if (!patched.includes(authAnchor)) throw new Error("DM authorization anchor not found");
patched = patched.replace(authAnchor, authReplacement);
await copyFile(path, `${path}.aime-auto-route-backup`);
const tmp = `${path}.aime-auto-route-tmp`;
await writeFile(tmp, patched);
await rename(tmp, path);
console.log(`patched: ${path}`);
