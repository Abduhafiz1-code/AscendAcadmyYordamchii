#!/usr/bin/env bash
# Botni bir martalik sozlash: webhook (secret bilan), buyruqlar menyusi, tavsif.
# Ishlatish:  cp .env.example .env  (to'ldiring)  →  bash scripts/setup_bot.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN .env da yo'q}"
: "${TELEGRAM_WEBHOOK_SECRET:?TELEGRAM_WEBHOOK_SECRET .env da yo'q}"
: "${SUPABASE_URL:?SUPABASE_URL .env da yo'q}"

API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
call() { curl -sS -X POST "${API}/$1" -H 'content-type: application/json' -d "$2"; echo; }

echo "→ webhook"
call setWebhook "{\"url\":\"${SUPABASE_URL}/functions/v1/telegram\",\"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\",\"drop_pending_updates\":true,\"allowed_updates\":[\"message\",\"edited_message\",\"callback_query\"]}"

echo "→ buyruqlar menyusi (o'quvchilar)"
call setMyCommands '{"commands":[
 {"command":"start","description":"Boshlash va qoidalar"},
 {"command":"natijam","description":"Ballarim va natijalarim"},
 {"command":"reyting","description":"Leaderboard"},
 {"command":"hafta","description":"Haftalik reyting (rasm)"},
 {"command":"vazifa","description":"Qo'shimcha vazifa olish"},
 {"command":"fikr","description":"Fikr yoki taklif yozish"},
 {"command":"qoidalar","description":"Qoidalarni qayta ko'rish"},
 {"command":"yordam","description":"Yordam"}
]}'

echo "→ buyruqlar menyusi (guruh ma'muriyati)"
call setMyCommands '{"scope":{"type":"all_chat_administrators"},"commands":[
 {"command":"bolim","description":"Bo'lim turini belgilash"},
 {"command":"yonalish","description":"Bo'lim yo'nalishi (speaking, writing...)"},
 {"command":"bahola","description":"Topshiriqqa baho (reply)"},
 {"command":"muddat","description":"Vazifa muddati (reply)"},
 {"command":"yopish","description":"Vazifani yopish (reply)"},
 {"command":"reyting","description":"Leaderboard"},
 {"command":"ulash","description":"Guruhni botga ulash"}
]}'

echo "→ tavsif (START dan oldin ko'rinadi)"
call setMyDescription '{"description":"🎓 Ascend Academy yordamchi ustozi\n\n🎙 Kunlik vazifalarni guruhga tashlang — bot qabul qiladi\n👍 Reaksiya bilan javob beradi, ball va to'"'"'g'"'"'ri javobni shaxsiy chatga yuboradi\n🏆 Har hafta reyting e'"'"'lon qilinadi\n\nBoshlash uchun START ni bosing 👇"}'
call setMyShortDescription '{"short_description":"Ascend Academy: kunlik vazifalar, ball va haftalik reyting 🏆"}'

echo "→ holat"
curl -sS "${API}/getWebhookInfo"; echo
