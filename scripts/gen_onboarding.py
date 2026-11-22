#!/usr/bin/env python3
"""Onboarding slaydlarini chizadi va ularni TypeScript moduliga (base64) o'giradi.

Ishga tushirish:  python3 scripts/gen_onboarding.py
Talab: Pillow, Inter va Noto Color Emoji shriftlari (Linux: fonts-inter, fonts-noto-color-emoji).
Natija: supabase/functions/_shared/assets/onboarding.ts
"""
import base64
import io
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1000, 562
OUT = os.path.join(os.path.dirname(__file__), "..", "supabase", "functions", "_shared", "assets", "onboarding.ts")

INTER = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
EMOJI = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(INTER.format(weight), size)


def gradient() -> Image.Image:
    img = Image.new("RGB", (W, H), "#0B1020")
    top, bottom = (11, 16, 32), (30, 48, 110)
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        row = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = row
    return img


def glow(img: Image.Image, cx: int, cy: int, r: int, color: tuple) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(r, 0, -6):
        alpha = int(55 * (1 - i / r) ** 2)
        d.ellipse((cx - i, cy - i, cx + i, cy + i), fill=color + (alpha,))
    img.paste(layer, (0, 0), layer)


def emoji(img: Image.Image, char: str, x: int, y: int, size: int) -> None:
    base = Image.new("RGBA", (136, 128), (0, 0, 0, 0))
    ImageDraw.Draw(base).text((0, 0), char, font=ImageFont.truetype(EMOJI, 109), embedded_color=True)
    base = base.crop(base.getbbox())
    ratio = size / max(base.size)
    base = base.resize((max(1, int(base.width * ratio)), max(1, int(base.height * ratio))), Image.LANCZOS)
    img.paste(base, (x, y), base)


def pill(d: ImageDraw.ImageDraw, xy, fill, radius=None):
    x0, y0, x1, y1 = xy
    d.rounded_rectangle(xy, radius=radius or (y1 - y0) // 2, fill=fill)


def header(img: Image.Image, step: int) -> ImageDraw.ImageDraw:
    d = ImageDraw.Draw(img)
    pill(d, (48, 40, 292, 82), "#22305F")
    d.text((70, 48), "ASCEND ACADEMY", font=font("Bold", 20), fill="#9FB4FF")
    for i in range(4):
        x = 820 + i * 36
        d.rounded_rectangle((x, 56, x + 24, 62), radius=3, fill="#FFC857" if i <= step else "#33447F")
    return d


def title(d, lines, y=150, size=58):
    for i, line in enumerate(lines):
        d.text((56, y + i * (size + 8)), line, font=font("ExtraBold", size), fill="#FFFFFF")


def sub(d, lines, y, size=27):
    for i, line in enumerate(lines):
        d.text((58, y + i * (size + 12)), line, font=font("Regular", size), fill="#B8C4E8")


def slide1() -> Image.Image:
    img = gradient()
    glow(img, 760, 300, 300, (255, 200, 87))
    d = header(img, 0)
    title(d, ["Xush kelibsiz!"], y=170, size=72)
    sub(d, ["Kunlik vazifa, ball va reyting —", "hammasi bir joyda."], 270)
    for i, (txt, col) in enumerate([("Vazifa", "#2F6BFF"), ("Ball", "#FFB020"), ("Reyting", "#27C281")]):
        x = 58 + i * 190
        pill(d, (x, 420, x + 172, 478), col)
        d.text((x + 86, 449), txt, font=font("Bold", 26), fill="#FFFFFF", anchor="mm")
    emoji(img, "🏆", 640, 150, 250)
    return img


def bubble(d, xy, fill):
    d.rounded_rectangle(xy, radius=26, fill=fill)


def slide2() -> Image.Image:
    img = gradient()
    glow(img, 770, 330, 260, (47, 107, 255))
    d = header(img, 1)
    title(d, ["Vazifani", "guruhga tashlang"], y=140, size=52)
    sub(d, ["Ustoz vazifani yo'nalish bo'limiga", "tashlaydi. Javobingizni shu", "bo'limga yuboring."], 300, 25)
    # mock topic card
    pill(d, (560, 150, 940, 205), "#2A3B7A")
    d.text((585, 163), "Speaking", font=font("Bold", 26), fill="#FFFFFF")
    bubble(d, (560, 230, 940, 330), "#33447F")
    d.text((585, 255), "Bugungi vazifa:", font=font("SemiBold", 22), fill="#FFC857")
    d.text((585, 288), "Tell about your weekend", font=font("Regular", 22), fill="#FFFFFF")
    bubble(d, (600, 360, 940, 450), "#2F6BFF")
    emoji(img, "🎙", 622, 376, 56)
    d.text((700, 380), "Ovozli xabar 0:42", font=font("SemiBold", 24), fill="#FFFFFF")
    d.text((700, 412), "Siz", font=font("Regular", 18), fill="#CFE0FF")
    pill(d, (560, 470, 800, 512), "#1F8F5F")
    d.text((680, 491), "ro'yxat shart emas", font=font("SemiBold", 19), fill="#FFFFFF", anchor="mm")
    return img


def slide3() -> Image.Image:
    img = gradient()
    glow(img, 740, 300, 280, (255, 120, 80))
    d = header(img, 2)
    title(d, ["Bot reaksiya", "qo'yadi"], y=140, size=56)
    sub(d, ["Qabul qilinsa xabaringizga reaksiya", "paydo bo'ladi. Ball va to'g'ri", "javob shaxsiy chatga keladi."], 300, 25)
    bubble(d, (540, 150, 950, 250), "#2F6BFF")
    emoji(img, "🎙", 565, 166, 56)
    d.text((640, 172), "Ovozli xabar 0:42", font=font("SemiBold", 24), fill="#FFFFFF")
    items = [("👍", "qabul"), ("🔥", "a'lo"), ("💯", "10/10"), ("👀", "ustoz")]
    for i, (e, label) in enumerate(items):
        x = 540 + i * 103
        pill(d, (x, 290, x + 92, 350), "#2A3B7A")
        emoji(img, e, x + 20, 298, 44)
        d.text((x + 46, 376), label, font=font("SemiBold", 19), fill="#B8C4E8", anchor="mm")
    bubble(d, (540, 420, 950, 510), "#1E2B5E")
    d.text((565, 436), "Natija shaxsiy chatda", font=font("Bold", 23), fill="#FFC857")
    d.text((565, 472), "Botga bir marta /start bosing", font=font("Regular", 20), fill="#B8C4E8")
    return img


def slide4() -> Image.Image:
    img = gradient()
    glow(img, 770, 300, 280, (39, 194, 129))
    d = header(img, 3)
    title(d, ["Reyting va", "yangiliklar"], y=140, size=56)
    sub(d, ["Har hafta leaderboard e'lon", "qilinadi. Erta tugatsangiz —", "qo'shimcha vazifa oling."], 300, 25)
    rows = [("🥇", "Muhayyo", "46.5", "#FFC857"), ("🥈", "Mubina", "41", "#C9D3F0"), ("🥉", "Davlatjon", "38.5", "#E0A06A")]
    for i, (m, name, pts, col) in enumerate(rows):
        y = 150 + i * 92
        bubble(d, (540, y, 950, y + 78), "#22305F")
        emoji(img, m, 562, y + 12, 52)
        d.text((640, y + 22), name, font=font("Bold", 28), fill="#FFFFFF")
        d.text((925, y + 39), pts, font=font("ExtraBold", 30), fill=col, anchor="rm")
    pill(d, (540, 440, 950, 500), "#2F6BFF")
    d.text((745, 470), "Fikr va takliflar: /fikr", font=font("Bold", 24), fill="#FFFFFF", anchor="mm")
    return img


def encode(img: Image.Image) -> bytes:
    q = img.convert("RGB").quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    buf = io.BytesIO()
    q.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def main() -> None:
    slides = [slide1(), slide2(), slide3(), slide4()]
    os.makedirs(os.path.join(os.path.dirname(OUT), "..", "..", "..", "..", "assets", "onboarding"), exist_ok=True)
    out = ["// AVTOMATIK YARATILGAN: scripts/gen_onboarding.py. Qo'lda tahrirlamang.",
           "// Onboarding slaydlari (PNG, base64).", "", "export const ONBOARDING_SLIDES: string[] = ["]
    total = 0
    for i, img in enumerate(slides, 1):
        data = encode(img)
        total += len(data)
        preview = os.path.join(os.path.dirname(OUT), "..", "..", "..", "..", "assets", "onboarding", f"slide{i}.png")
        with open(preview, "wb") as f:
            f.write(data)
        out.append(f'  "{base64.b64encode(data).decode()}",')
        print(f"slide{i}: {len(data)/1024:.1f} KB")
    out.append("];\n")
    out.append("export function onboardingSlide(index: number): Uint8Array | null {")
    out.append("  const b64 = ONBOARDING_SLIDES[index];")
    out.append("  if (!b64) return null;")
    out.append("  const binary = atob(b64);")
    out.append("  const bytes = new Uint8Array(binary.length);")
    out.append("  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);")
    out.append("  return bytes;")
    out.append("}")
    with open(OUT, "w", encoding="utf8") as f:
        f.write("\n".join(out) + "\n")
    print(f"jami {total/1024:.1f} KB ->", os.path.normpath(OUT))


if __name__ == "__main__":
    sys.exit(main())
