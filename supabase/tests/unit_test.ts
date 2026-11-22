import { assertEquals } from "jsr:@std/assert@1";
import { classifyTopicName, normalizeTopicName } from "../functions/_shared/logic/routing.ts";
import { commandArgs, isCommand, reactionForScore, REACTION } from "../functions/_shared/telegram.ts";
import { safeName } from "../functions/_shared/logic/leaderboardImage.ts";

Deno.test("bo'lim nomidan tur taxmini (hozirgi guruh bo'limlari)", () => {
  assertEquals(classifyTopicName("Self study"), { type: "task", track: "self_study", confident: true });
  assertEquals(classifyTopicName("✍️ Writing"), { type: "task", track: "writing", confident: true });
  assertEquals(classifyTopicName("Speaking"), { type: "task", track: "speaking", confident: true });
  assertEquals(classifyTopicName("Savollar"), { type: "questions", track: null, confident: true });
  assertEquals(classifyTopicName("Offline darslar").type, "ignore");
  assertEquals(classifyTopicName("🏆 Reyting").type, "announce");
  assertEquals(classifyTopicName("Uy vazifa").type, "task");
});

Deno.test("o'quvchi ismli eski bo'limlar noaniq (ustozdan so'raladi)", () => {
  for (const name of ["Muhayyo", "Davlatjon", "Zulxumor", "Dilso'z"]) {
    assertEquals(classifyTopicName(name).confident, false, name);
  }
  assertEquals(classifyTopicName(null).confident, false);
  assertEquals(normalizeTopicName("  ✍️ Writing!! "), "writing");
});

Deno.test("buyruqlar aniq mos keladi: /ustoz_taklif /ustoz ga tushmaydi", () => {
  assertEquals(isCommand("/ustoz_taklif", "/ustoz"), false);
  assertEquals(isCommand("/ustoz 123", "/ustoz"), true);
  assertEquals(isCommand("/bolim@Ascend_bot", "/bolim"), true);
  assertEquals(isCommand("/idea", "/id"), false);
  assertEquals(commandArgs("/bahola@Ascend_bot 8", "/bahola"), "8");
});

Deno.test("reaksiyalar Telegram ruxsat etgan emojilardan; ball bo'yicha tanlanadi", () => {
  assertEquals(reactionForScore(10), "💯");
  assertEquals(reactionForScore(9), "🔥");
  assertEquals(reactionForScore(7), "👍");
  const allowed = ["👍", "👀", "🔥", "💯", "🤔", "👌", "🤷"];
  for (const emoji of Object.values(REACTION)) assertEquals(allowed.includes(emoji), true, emoji);
});

Deno.test("reyting rasmi uchun ism tozalanadi", () => {
  assertEquals(safeName("Muhayyo 🫀"), "Muhayyo");
  assertEquals(safeName("Dilso‘z"), "Dilso'z");
  assertEquals(safeName("🫀🫀"), "O'quvchi");
});
