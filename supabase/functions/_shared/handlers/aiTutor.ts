import { answerQuestion as askAi, AiError } from "../ai.ts";
import { aiConfig } from "../env.ts";
import { bumpAiCounter, freshCounters, reply, type AppContext } from "../context.ts";
import { esc } from "../logic/format.ts";
import { fill, T } from "../texts.ts";

/** AI ustoz: savol-javob, kunlik limit bilan. */
export async function answerQuestion(ctx: AppContext, rawQuestion: string): Promise<void> {
  const question = rawQuestion.trim();
  if (!question) {
    await reply(ctx, T.askQuestion);
    return;
  }
  if (!ctx.settings.ai_enabled || !aiConfig(ctx.settings.ai_model)) {
    await reply(ctx, T.aiOff);
    return;
  }

  const isStudent = ctx.user?.role === "student" && ctx.user.status === "active";
  if (isStudent && ctx.user) {
    const fresh = await freshCounters(ctx, ctx.user);
    if (fresh.ai_count >= ctx.settings.ai_tutor_per_day) {
      await reply(ctx, fill(T.aiLimit, { limit: ctx.settings.ai_tutor_per_day }));
      return;
    }
    await bumpAiCounter(ctx, fresh);
  }

  let placeholder: number;
  try {
    placeholder = await reply(ctx, T.aiThinking);
  } catch {
    return;
  }

  try {
    const answer = await askAi({
      question,
      studentName: ctx.user?.full_name ?? "O'quvchi",
      settingsModel: ctx.settings.ai_model,
    });
    await ctx.tg.editMessage(ctx.chatId, placeholder, esc(answer));
  } catch (error) {
    const reason = error instanceof AiError ? error.reason : "AI xatosi";
    console.error("AI ustoz xatosi", reason);
    await ctx.tg.editMessage(ctx.chatId, placeholder, T.aiFailed);
  }
}
