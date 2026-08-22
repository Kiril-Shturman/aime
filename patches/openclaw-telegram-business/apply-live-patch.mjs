#!/usr/bin/env node
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const packageRoot = process.env.OPENCLAW_PACKAGE_ROOT ?? join(globalRoot, "openclaw");
const dist = join(packageRoot, "dist");
const file = join(dist, "telegram-ingress-spool-Dd3cDhXe.js");
const marker = "AIME_TELEGRAM_BUSINESS_OBSERVER_V1";
let source = await readFile(file, "utf8");
if (source.includes(marker)) {
  console.log(`already patched: ${file}`);
  process.exit(0);
}
const importAnchor = 'import path from "node:path";';
const importReplacement = `${importAnchor}\nimport { appendFile, mkdir } from "node:fs/promises";`;
if (!source.includes(importAnchor)) throw new Error("OpenClaw bundle import anchor not found");
source = source.replace(importAnchor, importReplacement);
const middlewareAnchor = `\tbot.use(async (ctx, next) => {\n\t\tconst callback = ctx.callbackQuery;`;
const middleware = `\t// AIME_TELEGRAM_BUSINESS_OBSERVER_V1\n\t// Archive Telegram Business updates before ordinary message routing. This is\n\t// intentionally terminal: customer messages must never trigger automatic replies.\n\tbot.use(async (ctx, next) => {\n\t\tconst update = ctx.update;\n\t\tconst kind = update.business_connection ? "business_connection"\n\t\t\t: update.business_message ? "business_message"\n\t\t\t: update.edited_business_message ? "edited_business_message"\n\t\t\t: update.deleted_business_messages ? "deleted_business_messages" : null;\n\t\tif (!kind) return await next();\n\t\tconst archivePath = process.env.AIME_TELEGRAM_BUSINESS_ARCHIVE\n\t\t\t?? path.join(process.env.HOME ?? process.cwd(), ".openclaw", "workspace", "memory", "telegram-business.jsonl");\n\t\tawait mkdir(path.dirname(archivePath), { recursive: true });\n\t\tawait appendFile(archivePath, JSON.stringify({\n\t\t\treceivedAt: new Date().toISOString(),\n\t\t\taccountId: account.accountId,\n\t\t\tkind,\n\t\t\tupdateId: update.update_id,\n\t\t\tpayload: update[kind]\n\t\t}) + "\\n", { mode: 384 });\n\t\truntime.log?.(\`telegram business update archived kind=\${kind} updateId=\${update.update_id}\`);\n\t\treturn;\n\t});\n${middlewareAnchor}`;
if (!source.includes(middlewareAnchor)) throw new Error("OpenClaw middleware anchor not found");
source = source.replace(middlewareAnchor, middleware);
await copyFile(file, `${file}.aime-backup`);
await writeFile(file, source);
console.log(`patched: ${file}`);
