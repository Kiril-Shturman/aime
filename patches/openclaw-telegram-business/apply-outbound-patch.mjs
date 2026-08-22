#!/usr/bin/env node
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const root = process.env.OPENCLAW_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], {encoding:"utf8"}).trim(), "openclaw");
const file = join(root, "dist", "telegram-ingress-spool-Dd3cDhXe.js");
const marker = "AIME_TELEGRAM_BUSINESS_OUTBOX_V1";
let s = await readFile(file, "utf8");
if (s.includes(marker)) { console.log(`already patched: ${file}`); process.exit(0); }
const oldImport = 'import { appendFile, mkdir } from "node:fs/promises";';
const newImport = 'import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";';
if (!s.includes(oldImport)) throw new Error("Business observer patch must be applied first");
s = s.replace(oldImport, newImport);
const anchor = `\tconst originalStop = bot.stop.bind(bot);`;
const code = `\t// AIME_TELEGRAM_BUSINESS_OUTBOX_V1\n\t// Local, append-only outbox. Only explicit operator-approved entries are sent.\n\tconst businessDir = path.join(process.env.HOME ?? process.cwd(), ".openclaw", "workspace", "memory");\n\tconst businessOutboxPath = process.env.AIME_TELEGRAM_BUSINESS_OUTBOX ?? path.join(businessDir, "telegram-business-outbox.jsonl");\n\tconst businessResultsPath = process.env.AIME_TELEGRAM_BUSINESS_RESULTS ?? path.join(businessDir, "telegram-business-results.jsonl");\n\tlet businessOutboxBusy = false;\n\tconst processBusinessOutbox = async () => {\n\t\tif (businessOutboxBusy) return;\n\t\tbusinessOutboxBusy = true;\n\t\ttry {\n\t\t\tawait mkdir(businessDir, { recursive: true });\n\t\t\tconst [outboxRaw, resultsRaw] = await Promise.all([\n\t\t\t\treadFile(businessOutboxPath, "utf8").catch(() => ""),\n\t\t\t\treadFile(businessResultsPath, "utf8").catch(() => "")\n\t\t\t]);\n\t\t\tconst completed = new Set(resultsRaw.split("\\n").filter(Boolean).map((line) => { try { return JSON.parse(line).id; } catch { return null; } }).filter(Boolean));\n\t\t\tfor (const line of outboxRaw.split("\\n").filter(Boolean)) {\n\t\t\t\tlet item; try { item = JSON.parse(line); } catch { continue; }\n\t\t\t\tif (!item.id || completed.has(item.id) || item.approved !== true) continue;\n\t\t\t\tlet result;\n\t\t\t\ttry {\n\t\t\t\t\tconst sent = await bot.api.sendMessage(item.chatId, item.text, { business_connection_id: item.businessConnectionId });\n\t\t\t\t\tresult = { id: item.id, ok: true, sentAt: new Date().toISOString(), chatId: item.chatId, messageId: sent.message_id };\n\t\t\t\t} catch (error) {\n\t\t\t\t\tresult = { id: item.id, ok: false, attemptedAt: new Date().toISOString(), error: String(error) };\n\t\t\t\t}\n\t\t\t\tawait appendFile(businessResultsPath, JSON.stringify(result) + "\\n", { mode: 384 });\n\t\t\t\tcompleted.add(item.id);\n\t\t\t}\n\t\t} finally { businessOutboxBusy = false; }\n\t};\n\tconst businessOutboxTimer = setInterval(() => { void processBusinessOutbox(); }, 500);\n\tbusinessOutboxTimer.unref?.();\n${anchor}`;
if (!s.includes(anchor)) throw new Error("Stop anchor not found");
s = s.replace(anchor, code);
const stopAnchor = `\t\tunregisterOutboundGroupHistoryRecorder();\n\t\treturn originalStop(...args);`;
const stopCode = `\t\tunregisterOutboundGroupHistoryRecorder();\n\t\tclearInterval(businessOutboxTimer);\n\t\treturn originalStop(...args);`;
if (!s.includes(stopAnchor)) throw new Error("Stop cleanup anchor not found");
s = s.replace(stopAnchor, stopCode);
await copyFile(file, `${file}.aime-outbound-backup`);
await writeFile(file, s);
console.log(`patched outbound: ${file}`);
