# 🎓 Ascend Academy — yordamchi ustoz boti (v3)

Telegram guruhidagi kunlik vazifalarni qabul qiladi, AI bilan tekshiradi, **guruhga yozmasdan faqat reaksiya qo'yadi**,
ball va to'g'ri javobni **shaxsiy chatga** yuboradi, har hafta **rasmli reyting** e'lon qiladi.

**Texnologiya:** Supabase (Postgres + Edge Functions, TypeScript/Deno) · Telegram webhook · Gemini AI · pg_cron.
Server kerak emas.

## Qanday ishlaydi

1. **Ustoz** yo'nalish bo'limiga (Writing, Speaking, ...) oddiy xabar tashlaydi: matn, rasm, ovoz yoki fayl.
   Bot uni kunlik vazifa deb qabul qiladi va 👌 reaksiya qo'yadi. Ustoz javob yozmaydi.
   Matnda `Javob: ...` qatori bo'lsa, u to'g'ri javob (kalit) bo'lib saqlanadi.
2. **O'quvchi** javobini (ovozli xabar, matn, rasm, video, fayl) shu bo'limga tashlaydi.
   Ro'yxatdan o'tish shart emas: Telegram ID, nik va ism avtomatik saqlanadi.
3. Bot guruhda **faqat reaksiya** qo'yadi: 👀 qabul qilindi → 👍 / 🔥 (8–9) / 💯 (10) natija. Ustoz tekshirsa 👀 qoladi.
4. **Ball, izoh va to'g'ri javob shaxsiy chatga** keladi, tagida «🎯 Qo'shimcha vazifa olish» tugmasi.
   O'quvchi botni hali ishga tushirmagan bo'lsa, guruhda 3 kunda bir marta «Botni ishga tushiring» tugmasi chiqadi.
5. **Savollar** bo'limiga o'quvchi yozadi, ustoz javob beradi. Bot jim turadi (faqat `/savol ...` yoki `@bot` deyilsa AI javob beradi).
6. Har yakshanba 20:00 (Toshkent) **haftalik reyting rasmi** reyting bo'limiga (yoki General ga) yuboriladi.
   Kun oxirida bugun topshirganlarga qo'shimcha vazifa taklif qilinadi.

## Bo'limlar o'zgarsa ham moslashadi

Kodda hech qanday bo'lim ID si yoki nomi qotirilmagan. Bot bo'limni birinchi xabaridan taniydi va nomidan turini taxmin qiladi:

| Nom | Tur |
|---|---|
| Writing, Speaking, Listening, Reading, Grammar, Vocabulary, Vazifa, Homework, Self study | 📝 vazifa (yo'nalish nomi bilan) |
| Savollar | ❓ savollar |
| Reyting, E'lonlar | 🏆 reyting (haftalik e'lon shu yerga) |
| Offline darslar, Ustozlar, Chat | 🚫 e'tiborsiz |
| O'quvchi ismi ("Muhayyo") yoki noma'lum nom | 🚫 e'tiborsiz; o'quvchi fayl tashlasa ustozdan **bir marta** turi so'raladi |

Taxmin noto'g'ri bo'lsa: kerakli bo'limda `/bolim` yuboring va tugmani bosing. `/yonalish speaking` bo'limga yo'nalish beradi.
Shaxsiy chatda `/bolimlar` hamma bo'limlarni ko'rsatadi. Bo'limsiz oddiy guruhda ham ishlaydi.

## O'rnatish (10 daqiqa)

```bash
# 0) Kutubxonalar (faqat lokal tekshiruv uchun)
npm install

# 1) Supabase loyihasiga ulanish va bazani yangilash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push                      # migrations/ ichidagi hammasini qo'llaydi

# 2) Maxfiy kalitlar
cp .env.example .env                      # to'ldiring
npx supabase secrets set --env-file .env

# 3) Funksiyalarni joylash (JWT tekshiruvi o'chiq: config.toml da ham yozilgan)
npx supabase functions deploy telegram --no-verify-jwt
npx supabase functions deploy worker   --no-verify-jwt

# 4) Webhook, buyruqlar menyusi va tavsifni sozlash
bash scripts/setup_bot.sh

# 5) Cron (tick, kunlik, haftalik): supabase/cron.sql dagi izohlarga qarang (Vault + pg_cron)
```

Keyin:
1. Botni guruhga **admin** qiling. BotFather → `/mybots` → Bot Settings → **Group Privacy → Turn off**, botni guruhdan chiqarib qayta qo'shing.
2. Guruhda `/ulash` yuboring (faqat admin/ustoz). Bo'limlar yaratilmaydi, mavjudlari taniladi.
3. Ustoz qo'shish: botga `/ustoz_taklif` → havolani ustozga yuboring (2 kun, bir martalik).
4. Vazifa bo'limlariga ustoz xabar tashlasin. Tamom.

## Buyruqlar

**O'quvchi:** `/start` `/natijam` `/reyting` `/hafta` `/vazifa` `/fikr` `/qoidalar` `/savol` `/yordam`
**Ustoz (guruhda):** `/bolim` `/yonalish` `/bahola 8` `/muddat 3` `/yopish` `/ochirish` `/reyting`
**Ustoz (shaxsiy):** `/panel` `/bolimlar` `/ustoz_taklif` `/elon matn`

## Baholash va ball

| Holat | Natija |
|---|---|
| Oddiy vazifa, AI ishonchi yuqori | 0.5–10 ball (0.5 qadam) |
| AI ishonchi past, fayl o'qilmadi, «topshira olmadim» | 👀 va ustozga yuboriladi (tugmalar bilan baholaydi) |
| Self study / bot vazifasi | bajarilsa qat'iy ball (sozlamalarda) |
| Qayta topshirish | **eng yaxshi** ball saqlanadi (pasaymaydi) |
| Kuniga hech narsa topshirilmasa | jarima (panelda 0 qilib o'chirish mumkin) |

## Fikr-mulohaza

O'quvchi `/fikr` yoki «💬 Fikr bildirish» bilan yozadi → `feedback` jadvaliga tushadi, ustozlarga xabar boradi, panelda «💬 Fikrlar» da ko'rinadi.

## Testlar

```bash
npm test      # 28 ta test: bo'lim tanish, reaksiya oqimi, avto-ro'yxat, DM, onboarding, reyting rasmi
npm run check # tip tekshiruvi
```

## Muhim eslatmalar

- **Maxfiylik:** `.env` ni gitga qo'shmang. Agar kalitlar boshqalarga ko'rinib qolgan bo'lsa, almashtiring (BotFather `/revoke`, Supabase API keys, AI kaliti).
- **Reaksiyalar:** Telegram botlarga faqat ruxsat etilgan emojilarni beradi (👍 🔥 💯 👀 🤔 👌 🤷 ...). «✅» ruxsat etilmagan.
- **Reyting rasmi** shrift va wasm ni birinchi chaqiruvda internetdan yuklaydi (keshlanadi). Yuklanmasa matnli reyting yuboriladi.
- Rasmli qoidalarni o'zgartirish: `scripts/gen_onboarding.py` ni tahrirlab `npm run slides`.
- `legacy/python-bot` — eski Python versiya (faqat tarix uchun).
