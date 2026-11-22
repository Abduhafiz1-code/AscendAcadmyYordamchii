// Chiroyli reyting rasmi: satori (JSX → SVG) + resvg-wasm (SVG → PNG).
// Shrift va wasm birinchi chaqiruvda yuklanadi va keshlanadi. Xato bo'lsa chaqiruvchi
// matnli reytingga qaytadi (qarang: worker/index.ts), shuning uchun bu qism ixtiyoriy.
import satori from "npm:satori@0.63.2";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { env } from "../env.ts";

export interface ImageRow {
  place: number;
  name: string;
  points: string;
  detail: string;
}

export interface LeaderboardImageInput {
  title: string;
  subtitle: string;
  rows: ImageRow[];
  footer: string;
}

const WASM_URL = "https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const FONT_BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins";

let wasmReady: Promise<void> | null = null;
const fontCache = new Map<string, ArrayBuffer>();

async function loadBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`yuklab bo'lmadi: ${url} (${res.status})`);
  return await res.arrayBuffer();
}

function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(loadBytes(env("RESVG_WASM_URL") ?? WASM_URL)).catch((error) => {
      wasmReady = null; // keyingi chaqiruvda qayta urinadi
      throw error;
    });
  }
  return wasmReady;
}

async function font(weight: "Regular" | "Bold"): Promise<ArrayBuffer> {
  const cached = fontCache.get(weight);
  if (cached) return cached;
  const base = env("LEADERBOARD_FONT_BASE_URL") ?? FONT_BASE;
  const data = await loadBytes(`${base}/Poppins-${weight}.ttf`);
  fontCache.set(weight, data);
  return data;
}

/** Shriftda yo'q belgilar (emoji, kirill, ʻ) kvadrat bo'lib chiqmasligi uchun tozalaydi. */
export function safeName(raw: string): string {
  const cleaned = raw
    .replace(/[ʻʼ’‘`´]/g, "'")
    .replace(/[^\p{Script=Latin}\p{N} .,'_@-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "O'quvchi").slice(0, 22);
}

type Node = { type: string; props: Record<string, unknown> };

function h(type: string, style: Record<string, unknown>, children?: unknown): Node {
  return { type, props: { style: { display: "flex", boxSizing: "border-box", ...style }, children } };
}

const PODIUM = ["#FFC857", "#C9D3F0", "#E0A06A"];

function row(item: ImageRow): Node {
  const top = item.place <= 3;
  const badgeColor = top ? PODIUM[item.place - 1] : "#2A3B7A";
  return h("div", {
    alignItems: "center",
    height: 78,
    marginBottom: 12,
    padding: "0 22px",
    borderRadius: 22,
    background: top ? "#2B3C80" : "#1E2B5E",
  }, [
    h("div", {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: "center",
      justifyContent: "center",
      background: badgeColor,
      color: top ? "#1A1F3A" : "#B8C4E8",
      fontSize: 24,
      fontWeight: 700,
    }, String(item.place)),
    h("div", { flexDirection: "column", marginLeft: 18, flexGrow: 1 }, [
      h("div", { color: "#FFFFFF", fontSize: 28, fontWeight: 700 }, item.name),
      h("div", { color: "#8FA2D8", fontSize: 17, marginTop: 2 }, item.detail),
    ]),
    h("div", { color: top ? badgeColor : "#FFFFFF", fontSize: 34, fontWeight: 700 }, item.points),
  ]);
}

/** Reyting kartasini PNG sifatida chizadi (1000 px kenglikda). */
export async function renderLeaderboardPng(input: LeaderboardImageInput): Promise<Uint8Array> {
  await ensureWasm();
  const [regular, bold] = await Promise.all([font("Regular"), font("Bold")]);
  const rows = input.rows.slice(0, 10);
  const height = 230 + Math.max(1, rows.length) * 90 + 70;

  const tree = h("div", {
    width: 1000,
    height,
    flexDirection: "column",
    padding: "44px 48px",
    background: "linear-gradient(160deg, #0B1020 0%, #1B2A5C 100%)",
    fontFamily: "Poppins",
  }, [
    h("div", { alignItems: "center", justifyContent: "space-between" }, [
      h("div", {
        padding: "8px 22px",
        borderRadius: 24,
        background: "#22305F",
        color: "#9FB4FF",
        fontSize: 20,
        fontWeight: 700,
      }, "ASCEND ACADEMY"),
      h("div", { color: "#FFC857", fontSize: 20, fontWeight: 700 }, input.subtitle),
    ]),
    h("div", { color: "#FFFFFF", fontSize: 58, fontWeight: 700, marginTop: 26, marginBottom: 26 }, input.title),
    h("div", { flexDirection: "column" },
      rows.length > 0
        ? rows.map(row)
        : [h("div", { color: "#B8C4E8", fontSize: 26 }, "Hali natijalar yo'q")]),
    h("div", { marginTop: "auto", color: "#6F82BD", fontSize: 20 }, input.footer),
  ]);

  const svg = await satori(tree as never, {
    width: 1000,
    height,
    fonts: [
      { name: "Poppins", data: regular, weight: 400, style: "normal" },
      { name: "Poppins", data: bold, weight: 700, style: "normal" },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1000 } }).render().asPng();
  return png;
}
