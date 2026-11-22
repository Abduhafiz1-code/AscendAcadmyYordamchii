import { aiConfig, type AiConfig } from "./env.ts";
import { clampScore } from "./logic/points.ts";
import type { TaskRow } from "./types.ts";

export class AiError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export interface AiPart {
  text?: string;
  inline?: { mimeType: string; base64: string };
}

export interface GradeResult {
  score: number;
  feedback: string;
  confidence: number;
  done: boolean;
  model: string;
}

const REQUEST_TIMEOUT_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url: string, init: RequestInit, label: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return await response.json();
    const body = await response.text().catch(() => "");
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await sleep(1500);
      continue;
    }
    throw new AiError(`${label}: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  throw new AiError(`${label}: urinishlar tugadi`);
}

async function geminiGenerate(
  config: AiConfig,
  system: string,
  parts: AiPart[],
  json: boolean,
  maxTokens: number,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${
      encodeURIComponent(config.model)
    }:generateContent`;

  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{
      role: "user",
      parts: parts.map((part) =>
        part.inline
          ? { inline_data: { mime_type: part.inline.mimeType, data: part.inline.base64 } }
          : { text: part.text ?? "" }
      ),
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  };

  const data = await requestJson(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify(payload),
    },
    "Gemini",
  ) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };

  if (data.promptFeedback?.blockReason) {
    throw new AiError(`AI so'rovi bloklandi: ${data.promptFeedback.blockReason}`);
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiError("AI bo'sh javob qaytardi");
  return text;
}

async function openAiGenerate(
  config: AiConfig,
  system: string,
  parts: AiPart[],
  json: boolean,
  maxTokens: number,
): Promise<string> {
  const content: Record<string, unknown>[] = [];
  for (const part of parts) {
    if (part.text) {
      content.push({ type: "text", text: part.text });
      continue;
    }
    if (!part.inline) continue;
    if (part.inline.mimeType.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${part.inline.mimeType};base64,${part.inline.base64}` },
      });
      continue;
    }
    throw new AiError(
      "OpenAI-mos rejimda ovoz/video/PDF bilan baholash qo'llab-quvvatlanmaydi. " +
        "Ovoz va fayllar uchun AI_PROVIDER=gemini ishlating.",
    );
  }

  const data = await requestJson(
    `${config.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    "OpenAI-mos API",
  ) as { choices?: { message?: { content?: string } }[] };

  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new AiError("AI bo'sh javob qaytardi");
  return text;
}

async function generate(
  system: string,
  parts: AiPart[],
  options: { json?: boolean; maxTokens?: number; settingsModel?: string | null } = {},
): Promise<{ text: string; model: string }> {
  const config = aiConfig(options.settingsModel);
  if (!config) throw new AiError("AI_API_KEY sozlanmagan");
  const json = options.json ?? false;
  const maxTokens = options.maxTokens ?? 1000;
  const text = config.provider === "gemini"
    ? await geminiGenerate(config, system, parts, json, maxTokens)
    : await openAiGenerate(config, system, parts, json, maxTokens);
  return { text, model: config.model };
}

export function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

const GRADING_SYSTEM = `Sen "Ascend Academy" o'quv markazining qat'iy, adolatli va rag'batlantiruvchi ustozisan.
O'quvchining topshirig'ini tahlil qilib, 0.5 dan 10 gacha baho berasan.

Baho mezonlari:
- 0.5–2.5: javob bo'sh, mavzuga aloqasiz yoki deyarli hech narsa yo'q.
- 3–5.5: qisman bajarilgan, jiddiy xatolar bor.
- 6–8: yaxshi, asosiy fikr to'g'ri, kichik xatolar bor.
- 8.5–9.5: juda yaxshi, to'liq va aniq.
- 10: to'liq, xatosiz va namunali javob.

Qoidalar:
- Faqat o'zbek tilida yozasan.
- feedback 1–3 gap: aniq xato va kuchli tomonni ayt, umumiy gap yozma.
- Agar topshiriq "self study" yoki "kunlik mashq" bo'lsa, done = topshiriq haqiqatan bajarilganmi.
- Javob vazifaga aloqador bo'lmasa yoki bo'sh bo'lsa: score 0.5, done false.
- Hech qachon 0.5 dan past yoki 10 dan yuqori baho berma.
- Faqat quyidagi JSON ni qaytar: {"score": number, "feedback": string, "confidence": number, "done": boolean}
- confidence — 0 dan 1 gacha ishonch darajasi.`;

export interface GradeInput {
  task: Pick<TaskRow, "kind" | "prompt" | "title" | "answer_key" | "criteria">;
  studentName: string;
  answerText: string;
  media: { mimeType: string; base64: string }[];
  taskMedia?: { mimeType: string; base64: string } | null;
  settingsModel?: string | null;
}

export async function gradeSubmission(input: GradeInput): Promise<GradeResult> {
  const task = input.task;
  const lines = [
    `Vazifa turi: ${task.kind}`,
    `Vazifa nomi: ${task.title ?? "(nomsiz)"}`,
    "Vazifa matni:",
    task.prompt,
  ];
  if (task.answer_key) lines.push("", "Kutilgan javob / kalit:", task.answer_key);
  if (task.criteria) lines.push("", "Baholash mezonlari:", task.criteria);
  lines.push("", `O'quvchi: ${input.studentName}`);
  lines.push(
    "",
    "O'quvchi javobi:",
    input.answerText.trim() || "(javob media faylda — ilova qilingan faylni ko'rib baholang)",
  );

  const parts: AiPart[] = [{ text: lines.join("\n") }];
  if (input.taskMedia) {
    parts.push({ text: "Vazifa ilovasi (topshiriq sharti):" });
    parts.push({ inline: input.taskMedia });
  }
  if (input.media.length > 0) {
    parts.push({ text: "O'quvchi yuborgan fayl(lar):" });
    for (const media of input.media) parts.push({ inline: media });
  }

  const { text, model } = await generate(GRADING_SYSTEM, parts, {
    json: true,
    maxTokens: 900,
    settingsModel: input.settingsModel,
  });

  const parsed = parseJsonLoose(text);
  if (!parsed) throw new AiError("AI javobini o'qib bo'lmadi");

  const score = clampScore(parsed.score);
  const feedback = String(parsed.feedback ?? "").trim().slice(0, 900) ||
    "Baholandi. Keyingi safar javobni to'liqroq yozing.";
  const rawConfidence = Number(parsed.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : 0.7;
  const done = typeof parsed.done === "boolean" ? parsed.done : score >= 6;

  return { score, feedback, confidence, done, model };
}

const TASK_SYSTEM = `Sen "Ascend Academy" o'quv markazining ustozisan.
O'quvchiga berilgan mavzular asosida bitta qisqa amaliy mashq tuzasan.

Qoidalar:
- O'zbek tilida yozasan (ingliz tili mashqi bo'lsa, topshiriq ingliz tilida bo'lishi mumkin).
- Mashq 2–4 gapdan oshmasin, aniq va bajariladigan bo'lsin.
- Javob kaliti va qisqa baholash mezoni bo'lsin.
- Faqat JSON qaytar: {"prompt": string, "answer_key": string, "criteria": string}`;

export interface GeneratedTask {
  prompt: string;
  answerKey: string;
  criteria: string;
  model: string;
}

export async function generateDailyTask(options: {
  recentPrompts: string[];
  studentName: string;
  settingsModel?: string | null;
}): Promise<GeneratedTask> {
  const context = options.recentPrompts.length > 0
    ? options.recentPrompts.slice(0, 5).map((prompt, index) => `${index + 1}. ${prompt}`).join("\n")
    : "Hozircha mavzular yo'q — umumiy foydali mashq tuz (masalan, ingliz tili yoki mantiq).";

  const { text, model } = await generate(
    TASK_SYSTEM,
    [{
      text:
        `O'quvchi: ${options.studentName}\n\nOxirgi mavzular:\n${context}\n\n` +
        "Shu mavzularga mos bitta yangi mashq tuz.",
    }],
    { json: true, maxTokens: 600, settingsModel: options.settingsModel },
  );

  const parsed = parseJsonLoose(text);
  if (!parsed) throw new AiError("Kunlik vazifa JSON ini o'qib bo'lmadi");
  const prompt = String(parsed.prompt ?? "").trim();
  if (!prompt) throw new AiError("Kunlik vazifa matni bo'sh");

  return {
    prompt: prompt.slice(0, 1500),
    answerKey: String(parsed.answer_key ?? "").slice(0, 800),
    criteria: String(parsed.criteria ?? "").slice(0, 600),
    model,
  };
}

const TUTOR_SYSTEM = `Sen "Ascend Academy" o'quv markazining yordamchi ustozisan.
O'quvchining savoliga o'zbek tilida qisqa va tushunarli javob berasan.

Qoidalar:
- Maksimal 6 gap. Kerak bo'lsa 2–4 banddan iborat ro'yxat ishlat.
- Oddiy matn yoz; HTML, Markdown va jadval ishlatma.
- Savol darsga oid bo'lmasa, muloyimlik bilan darsga qaytar.
- Ishonching komil bo'lmagan faktni o'ylab topma; "aniq emas" deb ayt.`;

export async function answerQuestion(options: {
  question: string;
  studentName: string;
  settingsModel?: string | null;
}): Promise<string> {
  const { text } = await generate(
    TUTOR_SYSTEM,
    [{
      text:
        `O'quvchi: ${options.studentName}\nSavol: ${options.question.slice(0, 2000)}`,
    }],
    { maxTokens: 900, settingsModel: options.settingsModel },
  );
  return text.slice(0, 3500);
}
