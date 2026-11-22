# 🎓 Ascend Academy — yordamchi ustoz bot

Telegram bot: o'quvchilar ro'yxatdan o'tadi, ustoz ularni tasdiqlaydi, vazifalarni bajaradi.
Bot javoblarni tekshiradi, **0.5 dan 10 gacha** ball qo'yadi, bajarilmagan yoki to'liq
bo'lmagan ishlarni **haqiqiy ustozga** yuboradi. Reyting, leaderboard, guruhlar reytingi va
ketma-ket ochiladigan **qo'shimcha (bonus) vazifalar** mavjud.

## ✨ Imkoniyatlar

**O'quvchi uchun**
- Ro'yxatdan o'tish: ism, guruh, telefon → ustoz tasdig'i yoki o'quv kodi bilan darhol tasdiqlash.
- Modullar bo'yicha vazifalar: ✅ bajarilgan, 🔓 ochiq, ⏳ ustozda, 🔒 yopiq, 🎁 bonus.
- Test (variantli), yozma javob va fayl/rasm topshirish.
- Har bir vazifa uchun **eng yaxshi natija** hisoblanadi (ball yig'ib bo'lmaydi).
- Reyting: top-10, guruhlar reytingi, haftalik/umumiy, o'z o'rni.
- Natijalar: umumiy ball, bajarilgan vazifalar, o'rtacha ball, oxirgi topshiriqlar.

**Ustoz uchun** (`🛠 Ustoz paneli`)
- Yangi o'quvchilarni tasdiqlash / rad etish.
- Tekshirish navbati: javob, rasm/fayl va o'quvchi ma'lumotlari bilan.
- Baholash: 10, 9, …, 1, 0.5, 0 yoki "qayta topshirishga ruxsat".
- Vazifa qo'shish ustasi: modul, nom, tavsif, tur, javob kaliti/variantlar, o'tish balli, muddat, bonus.
- Vazifalarni faolsizlantirish / o'chirish.
- O'quvchilar ro'yxati va eng faol o'quvchilar.
- Ommaviy xabar yuborish.
- Sozlamalar: o'quv kodi.

**Administrator uchun** (`/admin`)
- Statistika, ustoz qo'shish (`/id` orqali ID olinadi), ustozlar ro'yxati.

**Avtomatik jarayonlar**
- Muddat 24 soat qolganda o'quvchiga eslatma.
- Muddat o'tib ketsa — vazifa "bajarilmagan" sifatida ustozga yuboriladi.
- Vazifa bajarilganda keyingi vazifa va bonus vazifa avtomatik ochiladi va xabar beriladi.

## 🏅 Ball qanday hisoblanadi

| Holat | Natija |
|---|---|
| Test: to'g'ri javob | 10 ball |
| Test: xato javob | 0.5 ball (urinish qolsa qayta urinish mumkin) |
| Test: 3 marta xato | Ustozga yuboriladi |
| Yozma javob: kalitlarga to'liq mos | 10 ball |
| Yozma javob: qisman mos | 0.5–10 ball, 0.5 qadam bilan |
| Yozma javob: o'tish ballidan past | Ustozga yuboriladi |
| Rasm / fayl / "qo'lda" vazifa | Ustoz qo'lda baholaydi |
| "Topshira olmadim" yoki muddat o'tdi | Ustozga yuboriladi |

Reytingda har bir vazifa uchun **eng yaxshi** natija bir marta qo'shiladi — qayta
topshirish ballni oshirishi mumkin, lekin ikki marta hisoblanmaydi.

### Yozma javob kaliti formati

```
4|to'rt|4 ta              → shu muqobil javoblardan biri bo'lsa, to'liq to'g'ri
fotosintez+xlorofill      → ikkala kalit so'z ham javobda bo'lishi shart
```

- Muqobil javoblar: yangi qator yoki `|`.
- Bitta javobdagi bir nechta kalit so'z: `+`.
- Raqamli kalitlar so'z sifatida solishtiriladi (`4` ≠ `14`).
- Katta/kichik harf, apostrof (`o'`, `o‘`, `oʻ`) va tinish belgilari farq qilmaydi.

## 🚀 Tez ishga tushirish

Talab: **Python 3.10+** (loyiha Python 3.14 da sinovdan o'tgan).

```bash
# 1) Virtual muhit (tavsiya etiladi)
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# 2) Kutubxonalar
pip install -r requirements.txt

# 3) Konfiguratsiya
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
# .env ni oching va BOT_TOKEN hamda ADMIN_IDS ni to'ldiring

# 4) Ishga tushirish
python run.py
```

Token: Telegramda [@BotFather](https://t.me/BotFather) → `/newbot` → token.
O'z Telegram ID ingizni bilish uchun botga `/start` yuborib, `/id` buyrug'ini bering
(yoki [@userinfobot](https://t.me/userinfobot)).

### Birinchi sozlash (5 daqiqa)

1. Botga `/start` yuboring — `ADMIN_IDS` dagi ID avtomatik **admin** bo'ladi.
2. `🛠 Ustoz paneli` → `⚙️ Sozlamalar` → o'quv kodini belgilang (ixtiyoriy).
3. `➕ Yangi vazifa` orqali birinchi modul va vazifani qo'shing.
4. Ustozlarni qo'shish: ular botga `/start` yuboradi, siz `/admin` → `➕ Ustoz qo'shish`
   bo'limida ularning ID sini kiritasiz.
5. Demo ma'lumot bilan sinab ko'rish: `python scripts/seed_demo.py`.

## 🧩 Vazifa turlari

**Test (`quiz`)** — variantlar yangi qatorda, to'g'risi `*` bilan:

```
* 4
5
6
3
```

**Yozma javob (`text`)** — yuqoridagi kalit formati. Bot avtomatik tekshiradi.

**Qo'lda (`manual`)** — o'quvchi matn/rasm/fayl yuboradi, ustoz baholaydi.

**Bonus (`🎁`)** — modulning oxirgi oddiy vazifasi bajarilgach ochiladi.

## 📁 Loyiha tuzilishi

```
run.py                  # ishga tushirish
bot/
  main.py               # dispatcher, polling, xatoliklar
  config.py             # .env sozlamalari
  db.py                 # SQLite sxema va so'rovlar
  scoring.py            # javobni tekshirish, 0.5–10 ball
  keyboards.py          # klaviaturalar va menyu matnlari
  states.py             # FSM holatlari
  middlewares.py        # foydalanuvchini bazadan yuklash
  handlers/
    common.py           # /start, ro'yxatdan o'tish, yordam
    student.py          # vazifalar, topshirish, natijalar, reyting
    teacher.py          # ustoz paneli, baholash, vazifa CRUD, sozlamalar
    admin.py            # /admin, ustoz qo'shish
  services/
    tasks.py            # ochilish ketma-ketligi, modul progressi
    submissions.py      # qabul qilish, avtomatik tekshirish, baholash
    rating.py           # reyting va leaderboard
    notify.py           # ustoz/o'quvchi xabarnomalari
    scheduler.py        # muddat eslatmalari va nazorati
scripts/seed_demo.py    # demo modul
tests/                  # scoring va oqim testlari
data/bot.db             # SQLite (avtomatik yaratiladi, gitga tushmaydi)
```

## 🧪 Testlar

```bash
python -m unittest discover -s tests -v
```

## ⚙️ Sozlamalar (.env)

| Kalit | Tavsif | Standart |
|---|---|---|
| `BOT_TOKEN` | BotFather tokeni (majburiy) | — |
| `ADMIN_IDS` | Admin Telegram ID lari, vergul bilan | bo'sh |
| `DB_PATH` | SQLite fayl yo'li | `data/bot.db` |
| `DEFAULT_PASS_SCORE` | Standart o'tish balli | `6` |
| `INVITE_CODE` | O'quv markaz kodi (ixtiyoriy) | bo'sh |
| `TZ_OFFSET` | Vaqt mintaqasi | `5` (Toshkent) |
| `CHECK_INTERVAL` | Muddat tekshiruvi oralig'i, soniya | `600` |
| `MAX_ATTEMPTS` | Bitta vazifa uchun urinishlar | `5` |

## 🖥 Serverda ishlatish (systemd)

```ini
[Unit]
Description=Ascend Academy tutor bot
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/ascend-bot
ExecStart=/opt/ascend-bot/.venv/bin/python run.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ascend-bot
sudo journalctl -u ascend-bot -f
```

Baza va `.env` ni zaxiralab turing: `data/bot.db`, `.env`.

## ⚠️ Cheklovlar va xavfsizlik

- FSM xotirasi `MemoryStorage` da — bot qayta ishga tushsa, tugallanmagan ustoz ustasi
  (vazifa qo'shish) bekor bo'ladi, bazadagi ma'lumotlar saqlanadi.
- Bitta instansiya uchun mo'ljallangan (SQLite + polling). Katta yuklamada PostgreSQL va
  Redis FSM ga o'tish tavsiya etiladi.
- Avtomatik tekshiruv kalit so'zlarga asoslangan — murakkab insho va ijodiy ishlarni
  `manual` turida yuboring yoki ustoz `Qayta topshirish` bilan tekshirsin.
- `.env` va `data/` ni gitga qo'shmang (`.gitignore` da).
- Botni faqat ishonchli serverda ishga tushiring; token oshkor bo'lsa, BotFather orqali
  yangilang.

## 🔜 Keyingi qadamlar

- AI yordamida erkin matnli javoblarni baholash (LLM API kaliti bilan).
- Vazifaga fayl biriktirish (biriktirilgan shartnoma, PDF).
- Excel/CSV ga natijalarni eksport qilish.
- Veb-panel (ustoz uchun jadval ko'rinishida).
- Bir nechta ustoz uchun alohida modul va guruh biriktirish.
