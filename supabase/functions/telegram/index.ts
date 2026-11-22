// Telegram webhook: Supabase Edge Function. Server yo'q — hamma ish shu yerda.
import { buildContext } from "../_shared/context.ts";
import { db } from "../_shared/db.ts";
import { env } from "../_shared/env.ts";
import { background, jsonResponse } from "../_shared/runtime.ts";
import { botApi } from "../_shared/telegram.ts";
import { handleCallback } from "../_shared/handlers/callbacks.ts";
import { handleGroup } from "../_shared/handlers/group.ts";
import { handlePrivate } from "../_shared/handlers/private.ts";
import type { TgUpdate } from "../_shared/types.ts";

async function handleUpdate(update: TgUpdate): Promise<void> {
  const database = db();
  const tg = botApi();
  if (update.message?.new_chat_members) {
    for (const member of update.message.new_chat_members) {
      if (member.is_bot) continue;
      const nickname = member.username ? `@${member.username}` : [member.first_name, member.last_name].filter(Boolean).join(" ").trim();
      const existing = await database.userByTg(member.id);
      if (existing) {
        await database.updateUser(existing.id, {
          full_name: nickname || "O'quvchi",
          username: member.username ?? existing.username,
          role: existing.role === "admin" || existing.role === "teacher" ? existing.role : "student",
          status: "active",
          group_name: update.message.chat.title ?? existing.group_name,
        });
      } else {
        await database.createUser({
          tg_id: member.id,
          full_name: nickname || "O'quvchi",
          username: member.username ?? null,
          group_name: update.message.chat.title ?? null,
          role: "student",
          status: "active",
          approved_at: new Date().toISOString(),
        });
      }
    }
  }
  const ctx = await buildContext(update, database, tg);
  if (!ctx) return;

  if (ctx.callback) {
    await handleCallback(ctx);
    return;
  }
  if (ctx.isChannel) return;
  if (ctx.isGroup) {
    await handleGroup(ctx);
    return;
  }
  await handlePrivate(ctx);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "GET") {
    return jsonResponse({ ok: true, service: "ascend-academy-bot", mode: "webhook" });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const secret = env("TELEGRAM_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  let update: TgUpdate;
  try {
    update = await req.json() as TgUpdate;
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }
  if (!update || typeof update.update_id !== "number") {
    return jsonResponse({ ok: false, error: "invalid_update" }, 400);
  }

  const database = db();
  try {
    const fresh = await database.claimUpdate(update.update_id);
    if (!fresh) return jsonResponse({ ok: true, duplicate: true });
  } catch (error) {
    // Dedup jadvali ishlamasa ham update'ni yo'qotmaymiz.
    console.error("update dedup xatosi", error);
  }

  background(handleUpdate(update), `update ${update.update_id}`);
  return jsonResponse({ ok: true });
});
