import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { formatInjection, normalizeBusinessUpdate, safeEqual } from "./core.js";

async function readJson(req, maxBytes) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default definePluginEntry({
  id: "telegram-business",
  name: "Telegram Business Ingress",
  description: "Secure Telegram Business webhook ingress for aiMe",
  register(api) {
    api.registerHttpRoute({
      path: "/plugins/telegram-business/webhook", auth: "plugin", match: "exact",
      handler: async (req, res) => {
        const cfg = api.pluginConfig ?? {};
        if (req.method !== "POST") { res.statusCode = 405; res.end("method_not_allowed"); return true; }
        if (!safeEqual(req.headers["x-telegram-bot-api-secret-token"], cfg.secretToken)) { res.statusCode = 401; res.end("unauthorized"); return true; }
        try {
          const update = await readJson(req, cfg.maxBodyBytes ?? 262144);
          const event = normalizeBusinessUpdate(update);
          if (!event) { res.statusCode = 204; res.end(); return true; }
          const archive = cfg.archivePath ?? "memory/telegram-business.jsonl";
          const archivePath = isAbsolute(archive) ? archive : resolve(api.workspaceDir ?? process.cwd(), archive);
          await mkdir(dirname(archivePath), { recursive: true });
          await appendFile(archivePath, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
          await api.session.workflow.enqueueNextTurnInjection({
            sessionKey: cfg.sessionKey ?? "agent:main:main", text: formatInjection(event),
            idempotencyKey: `telegram-business:${event.updateId}`, ttlMs: 7 * 86400000,
            metadata: { source: "telegram-business", updateId: event.updateId }
          });
          res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end('{"ok":true}');
        } catch (error) {
          res.statusCode = error?.message === "body_too_large" ? 413 : 400;
          res.end(error?.message === "body_too_large" ? "body_too_large" : "invalid_update");
        }
        return true;
      }
    });
  }
});
