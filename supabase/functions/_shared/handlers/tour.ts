import { onboardingSlide } from "../assets/onboarding.ts";
import { reply, type AppContext } from "../context.ts";
import { T } from "../texts.ts";
import { inline } from "../telegram.ts";
import { mainMenu } from "../ui.ts";
import type { TgReplyMarkup } from "../types.ts";

const SLIDE_COUNT = 4;

function caption(step: number): string {
  switch (step) {
    case 0:
      return T.obSlide1;
    case 1:
      return T.obSlide2;
    case 2:
      return T.obSlide3;
    default:
      return T.obSlide4;
  }
}

function keyboard(step: number): TgReplyMarkup {
  const last = step >= SLIDE_COUNT - 1;
  return inline([[
    last
      ? { text: T.obDone, callback_data: "ob:done" }
      : { text: T.obNext, callback_data: `ob:${step + 1}` },
  ]]);
}

/** Rasmli qoidalar: birinchi /start da yoki /qoidalar da ko'rsatiladi. */
export async function startTour(ctx: AppContext): Promise<void> {
  const image = onboardingSlide(0);
  try {
    if (!image) throw new Error("slayd yo'q");
    await ctx.tg.sendPhoto(ctx.chatId, image, { caption: caption(0), markup: keyboard(0) });
  } catch (error) {
    console.error("onboarding rasmi yuborilmadi", error);
    await reply(ctx, caption(0), { markup: keyboard(0) });
  }
  if (ctx.user && !ctx.user.onboarded) {
    ctx.user = await ctx.db.updateUser(ctx.user.id, { onboarded: true });
  }
}

/** "ob:N" tugmasi: keyingi slaydga o'tish yoki yakunlash. */
export async function tourStep(ctx: AppContext, raw: string): Promise<string> {
  const message = ctx.callback?.message;
  if (!message) return " ";
  if (raw === "done") {
    try {
      await ctx.tg.call("editMessageReplyMarkup", {
        chat_id: ctx.chatId,
        message_id: message.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    } catch {
      // xabar allaqachon o'zgargan bo'lishi mumkin
    }
    await reply(ctx, T.menu, { markup: mainMenu(ctx.isTeacher) });
    return "Tayyor!";
  }
  const step = Math.min(SLIDE_COUNT - 1, Math.max(0, Number(raw) || 0));
  const image = onboardingSlide(step);
  try {
    if (image) {
      await ctx.tg.editPhoto(ctx.chatId, message.message_id, image, caption(step), keyboard(step));
    } else {
      await ctx.tg.editMessage(ctx.chatId, message.message_id, caption(step), keyboard(step));
    }
  } catch (error) {
    console.error("onboarding slaydi almashmadi", error);
  }
  return " ";
}
