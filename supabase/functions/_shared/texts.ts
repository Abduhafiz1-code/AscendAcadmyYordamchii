import type { Period } from "./types.ts";

export const BTN = {
  tasks: "📌 Vazifalarim",
  results: "📊 Natijam",
  rating: "🏆 Reyting",
  daily: "🎯 Kunlik vazifa",
  question: "❓ AI ustoz",
  panel: "🛠 Panel",
  code: "🔑 Kod bilan kirish",
  status: "📨 Ariza holati",
  cancel: "❌ Bekor qilish",
  skip: "⏭ O'tkazib yuborish",
  howto: "📖 Qanday ishlatiladi",
  register: "📝 Ro'yxatdan o'tish",
  feedback: "💬 Fikr bildirish",
  topics: "🧩 Bo'limlar",
} as const;

export const T = {
  welcomeStart: "Assalomu alaykum, <b>{{name}}</b>! 👋\n\n" +
    "Men <b>Ascend Academy</b>ning yordamchi botiman.\n\n" +
    "🤖 <b>Nima qilaman?</b>\n" +
    "• Guruhga tashlagan topshiriqlaringizni qabul qilaman (ovoz, matn, rasm, video, fayl)\n" +
    "• Qabul qilinganini reaksiya bilan bildiraman, ball va to'g'ri javobni shu yerga yuboraman\n" +
    "• Haftalik reytingni e'lon qilaman\n\n" +
    "Boshlash uchun quyidagi tugmalardan birini tanlang 👇",

  howTo: "📖 <b>Bot qanday ishlatiladi?</b>\n\n" +
    "1️⃣ Ustoz guruhdagi <b>yo'nalish bo'limiga</b> (Writing, Speaking va h.k.) kunlik vazifani tashlaydi.\n" +
    "2️⃣ Siz javobingizni (ovozli xabar, matn, rasm, video yoki fayl) shu bo'limga yuborasiz — \n" +
    "ro'yxatdan o'tish shart emas, ID va nik avtomatik saqlanadi.\n" +
    "3️⃣ Bot qabul qilsa, xabaringizga <b>reaksiya</b> qo'yadi: 👍 qabul qilindi, 🔥 a'lo, 💯 mukammal, 👀 ustoz tekshiradi.\n" +
    "4️⃣ <b>Ball va to'g'ri javob</b> shaxsiy chatga keladi — buning uchun botga bir marta /start bosing.\n" +
    "5️⃣ Savollaringiz bo'lsa <b>Savollar</b> bo'limiga yozing — ustoz javob beradi.\n\n" +
    "<b>Ballar:</b> vazifa 0.5–10 · self study va bot vazifasi — qat'iy ball · kuniga hech narsa topshirilmasa jarima.\n\n" +
    "<b>Buyruqlar:</b> /natijam · /reyting · /vazifa · /fikr · /qoidalar · /id",

  adminClaimed: "✅ Siz bot administratori sifatida tanildingiz. Boshqaruv: /panel",

  nameConfirm: "👋 Siz <b>{{group}}</b> guruhidasiz.\n\n" +
    "Telegramdagi ismingiz: <b>{{name}}</b>\n\nShu ism bilan ro'yxatdan o'tkazaymi?",
  notMember: "❌ Siz hali <b>{{group}}</b> guruhida emassiz.\n\n" +
    "Avval guruhga qo'shiling, so'ng /start ni qayta bosing.",
  noGroupYet: "Guruh hali botga ulanmagan. Administrator guruhda /ulash yuborishi kerak.",
  registeredAuto:
    "✅ <b>Ro'yxatdan o'tdingiz!</b>\n\n👤 {{name}}\n🎓 {{group}}\n👨‍🏫 {{teacher}}\n📞 {{phone}}\n\n" +
    "Topshiriqlarni guruhdagi bo'limlarga tashlang — natijalar shu yerga keladi.",
  studentRegisteredTeacher:
    "🆕 <b>Yangi o'quvchi ro'yxatdan o'tdi</b>\n\n👤 {{name}}\n🎓 {{group}}\n📞 {{phone}}\n🔗 @{{username}}",

  welcomeNew: "Assalomu alaykum! 👋\n\n" +
    "Men <b>Ascend Academy</b> yordamchi ustoziman. Guruhdagi vazifalarni tekshiraman, " +
    "ball qo'yaman va reytingni yuritaman.\n\n" +
    "Ro'yxatdan o'tish uchun bir necha savolga javob bering.",

  askName: "1/4 — <b>Ism va familiyangizni</b> yozing:",
  askGroup: "2/4 — <b>Guruh nomini</b> yozing (masalan: IELTS-2, General English):",
  askTeacher: "3/4 — <b>Qaysi ustozda o'qiysiz?</b>\n\n" +
    "Ro'yxatdan ustozingizni tanlang — so'rovingiz shu ustozga yuboriladi. " +
    "Ustozingiz ro'yxatda bo'lmasa, «O'tkazib yuborish» tugmasini bosing.",
  teacherSelected: "✅ Ustoz: <b>{{name}}</b>",
  noTeachers:
    "Hozircha ustozlar ro'yxatga olinmagan. O'tkazib yuborsangiz, so'rov tizimdagi administratorlarga yuboriladi.",
  askPhone: "4/4 — <b>Telefon raqamingizni</b> yuboring.\n\n" +
    "Tugma orqali yuborsangiz yoki +998901234567 ko'rinishida yozsangiz bo'ladi.",

  nameTooShort: "Ism juda qisqa. Iltimos, ism va familiyani to'liq yozing.",
  badPhone: "Telefon raqam noto'g'ri. Masalan: +998901234567",
  pending:
    "⏳ <b>So'rovingiz yuborildi.</b>\n\nMas'ul ustoz yoki administrator tasdiqlagach shu yerda xabar beraman. " +
    "O'quv kodingiz bo'lsa, «Kod bilan kirish» tugmasini bosing.",
  pendingAlready:
    "Arizangiz avval yuborilgan. Uning holatini tekshirishingiz, o'quv kodini kiritishingiz yoki qo'llanmani ko'rishingiz mumkin.",
  pendingStart:
    "Ro'yxatdan o'tish ma'lumotlaringiz saqlangan. Quyidagi menyudan ariza holatini tekshiring, o'quv kodini kiriting yoki bot qo'llanmasini ko'ring.",
  pendingStatus:
    "📨 Arizangiz ko'rib chiqish uchun yuborilgan. O'quv kodingiz bo'lsa, «Kod bilan kirish» tugmasini bosing.",
  approved:
    "✅ <b>Tayyor!</b>\n\nEndi guruhdagi bo'limlarga topshiriqlarni tashlashingiz mumkin. " +
    "Ball va natijalar shu yerga keladi.",
  rejected: "❌ Afsus, so'rovingiz tasdiqlanmadi. Savol bo'lsa ustozga murojaat qiling.",
  blocked: "🚫 Hisobingiz bloklangan. Ustozga murojaat qiling.",
  notRegistered: "Avval /start orqali ro'yxatdan o'ting.",
  unknownCommand:
    "Buyruqni tushunmadim. /yordam ni ko'ring yoki savolingizni yozing — AI ustoz javob beradi.",

  helpStudent: "📖 <b>Yordam</b>\n\n" +
    "📌 Ustoz bergan vazifaning bo'limiga (Writing, Speaking, ...) javobingizni tashlang — " +
    "ovozli xabar, matn, rasm, video yoki fayl bo'lishi mumkin. Bot reaksiya qo'yadi.\n\n" +
    "📊 /natijam — ballaringiz va oxirgi topshiriqlar\n" +
    "🏆 /reyting — leaderboard (hafta / oy / umumiy)\n" +
    "🎯 /vazifa — botdan qo'shimcha mashq\n" +
    "💬 /fikr — bot haqida fikr yoki taklif yozish\n" +
    "📖 /qoidalar — qoidalarni qayta ko'rish\n" +
    "❓ /savol &lt;savol&gt; — AI ustozga savol\n" +
    "🆔 /id — Telegram ID ingiz",

  helpStaff: "🛠 <b>Ustoz buyruqlari</b>\n\n" +
    "<b>Guruhda:</b>\n" +
    "/ulash — guruhni botga ulash (bo'limlar o'zgarmaydi)\n" +
    "/bolim — joriy bo'lim turini belgilash (vazifa / savollar / reyting / e'tiborsiz)\n" +
    "/yonalish speaking — bo'limga yo'nalish nomini berish\n" +
    "/bahola 8 — topshiriqqa reply qilib baho qo'yish\n" +
    "/muddat 3 — vazifaga reply qilib muddat (kun)\n" +
    "/yopish · /ochirish — vazifani yopish / o'chirish\n" +
    "/reyting — leaderboard\n\n" +
    "<b>Shaxsiy chatda:</b>\n" +
    "/panel — statistika, navbat, bo'limlar, fikrlar\n" +
    "/bolimlar — guruh bo'limlari ro'yxati\n" +
    "/ustoz_taklif — ustoz uchun bir martalik havola\n" +
    "/elon matn — barcha o'quvchilarga xabar\n\n" +
    "Vazifa berish: kerakli <b>yo'nalish bo'limiga</b> oddiy xabar yozing (matn, rasm, ovoz, fayl) — " +
    "bot uni kunlik vazifa deb qabul qiladi va 👌 reaksiya qo'yadi. Javob yozish shart emas.",

  taskPostedClass: "✅ <b>Vazifa qabul qilindi</b> · #{{id}}\n" +
    "🎯 Baholash: 0.5–10 ball\n" +
    "✍️ Javobingizni shu vazifa xabariga <b>reply</b> qilib yuboring.\n" +
    "📎 Matn, rasm, ovoz, video yoki fayl — hammasi qabul qilinadi.",

  taskPostedSelf: "✅ <b>Self study vazifasi</b> · #{{id}}\n" +
    "🎁 Bajarilganda: <b>+{{points}} ball</b>\n" +
    "✍️ Javobni shu xabarga <b>reply</b> qilib yuboring.",

  taskPostedPersonal: "✅ <b>Shaxsiy vazifa</b> · #{{id}}\n" +
    "🎯 Baholash: 0.5–10 ball\n" +
    "✍️ Javobni shu xabarga <b>reply</b> qilib yuboring.",

  onlyStaff: "Bu amal faqat ustoz va admin uchun.",
  onlyPrivate: "Bu buyruqni botning shaxsiy chatida ishlating.",
  onlyGroup: "Bu buyruqni guruhda ishlating.",
  needForum: "Guruhda <b>Mavzular (Topics)</b> yoqilmagan. Guruh sozlamalari → Topics ni yoqing, " +
    "so'ng /ulash ni qayta yuboring.",
  needBotAdmin: "Bot guruhda administrator emas yoki mavzu yaratish huquqi yo'q. " +
    "Botni admin qilib, «Manage topics» huquqini bering.",

  submitting: "⏳ <b>Tekshirilmoqda...</b>",
  submissionManual: "👨‍🏫 <b>Ustoz tekshiradi</b>\n\nAI bu javobni ishonchli baholay olmadi. " +
    "Natija tez orada shu yerda chiqadi.",
  submissionRejected: "❌ Javob qabul qilinmadi. Iltimos, qaytadan urinib ko'ring.",
  submissionLimit: "Bu vazifa uchun urinishlar soni tugadi. Ustozga murojaat qiling.",
  notYourTask: "Bu vazifa sizga tegishli emas.",
  taskClosed: "Bu vazifa yopilgan.",
  replyToTask: "Javob berish uchun vazifa xabariga <b>reply</b> qiling.",
  noTasks: "Hozircha faol vazifa yo'q. Ustoz vazifa tashlaganda shu yerda ko'rinadi.",

  dailyLimit:
    "Bugun uchun bot vazifalari limiti tugadi ({{limit}} ta). Ertaga qayta urinib ko'ring.",
  dailyNoAi: "AI hozircha sozlanmagan, kunlik vazifa yaratib bo'lmaydi. Ustozga murojaat qiling.",
  dailyGenerating: "🎯 Sizga mashq tayyorlayapman...",
  dailyFailed: "Vazifa yaratishda xatolik bo'ldi. Birozdan so'ng qayta urinib ko'ring.",
  dailyCreated: "🎯 <b>Kunlik vazifa</b> · #{{id}}\n" +
    "To'g'ri bajarsangiz <b>+{{points}} ball</b>.\n\n" +
    "✍️ Javobni shu xabarga <b>reply</b> qilib yuboring.",
  askQuestion: "❓ Savolingizni yozing. AI ustoz imkon qadar qisqa javob beradi.",
  aiThinking: "🤖 O'ylayapman...",
  aiLimit: "Bugun AI savollar limiti tugadi ({{limit}} ta). Ertaga davom eting.",
  aiOff: "AI hozircha o'chirilgan. Savolingizni ustozga yuboring.",
  aiFailed: "AI javob bera olmadi. Birozdan so'ng qayta urinib ko'ring.",

  scoreResult: "✅ <b>Baho: {{score}}/10</b>\n💬 {{feedback}}",
  fixedDone: "✅ <b>Bajarildi!</b> +{{points}} ball\n💬 {{feedback}}",
  fixedNotDone: "❌ <b>Bajarilmagan.</b> Ball qo'shilmadi.\n💬 {{feedback}}",
  manualResult: "👨‍🏫 <b>Ustoz bahosi: {{score}}/10</b>\n💬 {{feedback}}",

  leaderboardEmpty: "Hali reyting bo'sh.",
  myResultsTitle: "📊 <b>Natijalarim</b>",
  myResultsEmpty: "Hali topshiriq yo'q. Birinchi vazifani boshlang!",

  pendingApproval:
    "🆕 <b>Yangi o'quvchi</b>\n\n👤 {{name}}\n🎓 {{group}}\n👨‍🏫 {{teacher}}\n📞 {{phone}}\n🔗 @{{username}}",
  approvedNotify: "✅ {{name}} tasdiqlandi.",
  rejectedNotify: "❌ {{name}} rad etildi.",
  approveError: "⚠️ {{name}} tasdiqlandi, lekin mavzu yaratilmadi: {{error}}\n\n" +
    "Guruhda /ulash ni tekshiring yoki mavzuni qo'lda /bogla bilan bog'lang.",

  taskGradedForTeacher:
    "📥 <b>Yangi javob</b>\n\n👤 {{name}}\n📝 {{task}}\n🤖 AI: {{score}}/10\n💬 {{feedback}}",
  needManual: "👨‍🏫 <b>Qo'lda tekshirish kerak</b>\n\n👤 {{name}}\n📝 {{task}}",
  askGrade: "0.5–10 oralig'ida baho yuboring (masalan: 8 yoki 7.5).",
  badGrade: "Baho 0.5–10 oralig'ida bo'lishi kerak. Qayta yuboring.",
  gradeSaved: "✅ Baho saqlandi: {{score}}/10",
  gradeNoSubmission: "Topshiriq topilmadi.",

  dueSet: "⏰ Muddat belgilandi: {{date}}",
  dueBad: "Muddat noto'g'ri. Masalan: /muddat 3 kun, /muddat 6 soat yoki /muddat 2026-11-20",
  taskClosedMsg: "🔒 Vazifa yopildi.",
  notTaskReply: "Vazifa xabariga reply qilib yuboring.",

  linked: "✅ <b>Guruh ulandi:</b> {{title}}\n\n" +
    "Bo'limlarni yaratish shart emas — bot ularni o'zi taniydi. Bo'lim turi nomidan taxmin qilinadi " +
    "(Writing, Speaking, Self study → vazifa · Savollar → savollar). To'g'rilash uchun kerakli " +
    "bo'limda /bolim yuboring.",
  topicBound: "✅ Joriy mavzu «{{kind}}» sifatida biriktirildi.",
  topicTypeAsk: "🧩 <b>Bo'lim sozlamasi</b>\n\nBo'lim: <b>{{name}}</b>\nJoriy tur: {{type}}\n\n" +
    "Bu bo'limda nima bo'ladi?",
  topicTypeSet: "✅ «{{name}}» bo'limi turi: <b>{{type}}</b>",
  topicTypeBad: "Bo'lim turi noto'g'ri.",
  onlyAdmin: "Bu amal faqat admin uchun.",
  adminAddAsk:
    "👑 Yangi adminning @username yoki Telegram ID sini yuboring (/bekor — bekor qilish):",
  adminAdded: "✅ {{name}} admin qilindi.",
  adminYouAre: "Siz bot administratori bo'ldingiz. /panel orqali boshqarasiz.",
  adminNoUser: "Foydalanuvchi topilmadi. U avval botga /start yuborgan bo'lishi kerak.",
  adminLeft: "🚪 Adminlikdan chiqdingiz. Hisobingiz ustoz sifatida qoldi.",
  lastAdminWarn:
    "Oxirgi admin chiqib keta olmaydi. Avval «👑 Admin qo'shish» orqali boshqa admin qo'shing.",
  inviteCreated: "🔗 <b>Ustoz taklif havolasi</b> (2 kun, bir martalik):\n{{link}}\n\n" +
    "Havolani ustozga yuboring — u bosganda avtomatik ustoz bo'ladi.",
  inviteInvalid: "Havola yaroqsiz yoki muddati tugagan.",
  inviteUsed: "✅ Siz ustoz sifatida qo'shildingiz. Endi guruhdagi vazifalarni boshqarasiz.",
  topicBad: "Mavzu turi noto'g'ri: vazifalar | selfstudy | ustozlar | savollar",
  studentBound: "✅ Mavzu {{name}} ga biriktirildi.",
  studentNotFound: "O'quvchi topilmadi. Ismni to'liqroq yozing yoki xabariga reply qiling.",
  alreadyBound: "Bu o'quvchining mavzusi allaqachon boshqa mavzuga bog'langan.",

  broadcastAsk: "📢 Barcha faol o'quvchilarga yuboriladigan xabarni yozing. /bekor — bekor qilish.",
  broadcastDone: "✅ Xabar {{sent}}/{{total}} o'quvchiga yuborildi.",
  cancelled: "Bekor qilindi.",
  newTeacher: "✅ {{name}} ustoz qilib qo'shildi.",
  teacherNotFound: "Foydalanuvchi topilmadi. Avval u botga /start yuborishi kerak.",
  teacherAdded: "Siz ustoz sifatida qo'shildingiz. /yordam ni ko'ring.",
  menu: "Asosiy menyu:",
  idText: "🆔 Sizning Telegram ID ingiz: <code>{{id}}</code>",

  // --- ro'yxatdan o'tish va guruh ---
  welcomeBack: "Xush kelibsiz, {{name}}! 👋\n\nQuyidagi menyudan foydalaning.",
  codeAsk: "🔑 O'quv kodini yuboring:",
  codeWrong: "❌ Kod noto'g'ri. Ustozdan kodni so'rang yoki tasdiqlashni kuting.",
  codeOk: "✅ Kod qabul qilindi va hisobingiz faollashtirildi.\n\n" +
    "Endi guruhdagi bo'limlarga topshiriq tashlashingiz mumkin.",
  codeNotSet: "Markazda o'quv kodi belgilanmagan. Ustoz tasdiqlashini kuting.",
  studentTopicWelcome: "👋 <b>Xush kelibsiz, {{name}}!</b>\n\n" +
    "Bu — sizning <b>shaxsiy mavzuingiz</b>. Ustoz vazifalarni shu yerga yuboradi.\n\n" +
    "✍️ Javobni vazifa xabariga <b>reply</b> qilib yuboring. Matn, rasm, ovozli xabar, " +
    "video yoki fayl — hammasi qabul qilinadi.\n\n" +
    "🎯 Vazifa: 0.5–10 ball · 📖 Self study: +{{self}} ball · 🤖 Bot vazifasi: +{{bot}} ball",
  topicCreatedStaff: "✅ {{name}} uchun shaxsiy mavzu yaratildi.",
  topicFailed: "⚠️ {{name}} tasdiqlandi, lekin mavzu yaratilmadi: {{error}}\n\n" +
    "Bot guruhda admin va «Manage topics» huquqiga ega ekanini tekshiring.",
  groupRules: "🏁 <b>Ascend Academy</b>\n\n" +
    "📝 Ustoz vazifani yo'nalish bo'limiga tashlaydi — javobingizni shu bo'limga yuboring.\n" +
    "👍 Bot qabul qilsa reaksiya qo'yadi; ball va to'g'ri javob shaxsiy chatda.\n" +
    "❓ <b>Savollar</b> bo'limiga savol yozing — ustoz javob beradi.\n\n" +
    "⚠️ Kuniga hech vazifa topshirilmasa: <b>−{{penalty}} ball</b>.",
  groupNotLinked: "Guruh hali botga ulanmagan. Administrator guruhda /ulash buyrug'ini yuborsin.",
  groupLinkedOnce: "✅ Guruh allaqachon ulangan.\n\n" +
    "Bo'lim turini o'zgartirish uchun kerakli bo'limda /bolim yuboring.",
  needGroup: "Bu buyruq faqat guruhda ishlaydi.",
  useTopic: "Iltimos, javobni ustoz vazifa tashlagan yo'nalish bo'limiga yuboring.",

  // --- vazifalar / topshirish ---
  tasksTitle: "📌 <b>Vazifalarim</b>",
  tasksEmpty: "Hozircha faol vazifa yo'q. Ustoz vazifa yuborganda shu yerda ko'rinadi.",
  taskLine: "{status} <b>#{{id}}</b> · {{kind}} · {{title}}\n   {{points}}",
  noActiveTask: "Faol vazifa topilmadi. Ustoz vazifa yuborgach, unga reply qilib javob bering.",
  noTaskInTopic:
    "🔓 Bu bo'limda hozircha faol vazifa yo'q. Ustoz vazifa tashlaganda javobni shu bo'limga yuboring.",
  taskExpired: "⏰ Bu vazifaning muddati o'tgan. Ustozga murojaat qiling.",
  attemptsExhausted:
    "Bu vazifa uchun urinishlar tugadi. Javobingiz ustozga qo'lda tekshirishga yuborildi.",
  fileTooLarge:
    "📦 Fayl juda katta (14 MB dan oshmasligi kerak). Iltimos, qisqaroq ovoz yoki kichikroq fayl yuboring.",
  gradeReceivedTeacher: "✅ <b>{{score}}/10</b> · {{kind}} · #{{id}}",
  retryAllowed: "🔁 Qayta topshirishga ruxsat berildi. Yaxshilangan javobni yuboring.",
  taskClosedByStaff: "🔒 Vazifa yopildi: #{{id}}",
  taskDeleted: "🗑 Vazifa o'chirildi: #{{id}}",
  dueReminder: "⏰ <b>Eslatma:</b> «{{title}}» vazifasiga {{hours}} soat qoldi.\n" +
    "Javobni vazifaga reply qilib yuboring.",
  overdueStaff: "⌛ <b>Muddat o'tdi</b>\n\n👤 {{name}}\n📝 {{title}}\n\nO'quvchi javob yubormadi.",

  // --- panel ---
  panelTitle: "🛠 <b>Ustoz paneli</b>\n\nKerakli bo'limni tanlang:",
  adminPanelTitle: "🛡 <b>Admin paneli</b>\n\nKerakli bo'limni tanlang:",
  panelStats: "📈 <b>Statistika</b>\n\n" +
    "👥 Faol o'quvchilar: <b>{{students}}</b>\n" +
    "🕓 Tasdiqlash kutayotgan: <b>{{pending}}</b>\n" +
    "⏳ Qo'lda tekshirish navbati: <b>{{queue}}</b>\n" +
    "📚 Faol vazifalar: <b>{{tasks}}</b>\n" +
    "🏆 Bugun topshirilgan: <b>{{today}}</b>",
  panelQueueEmpty: "✅ Tekshirish navbati bo'sh — hamma javob baholangan.",
  panelPendingEmpty: "✅ Yangi so'rovlar yo'q.",
  panelStudentsEmpty: "Hali faol o'quvchi yo'q.",
  panelTasksEmpty: "Faol vazifalar yo'q.",
  panelStudents: "🎓 <b>O'quvchilar</b> ({{count}})\n\n{{list}}",
  panelTasks: "📚 <b>Faol vazifalar</b>\n\n{{list}}",
  panelSettings: "⚙️ <b>Sozlamalar</b>\n\n" +
    "🔑 O'quv kodi: {{code}}\n" +
    "📖 Self study: <b>+{{self}}</b> ball\n" +
    "🤖 Bot vazifasi: <b>+{{bot}}</b> ball\n" +
    "⚠️ Kunlik jarima: <b>−{{penalty}}</b> ball\n" +
    "⏰ Standart vazifa muddati: <b>{{due}} soat</b>\n" +
    "🎯 Kunlik bot vazifasi: <b>{{limit}}</b> ta\n" +
    "📉 Jarima chegarasi: <b>{{minpct}}%</b> dan past natija\n" +
    "🧾 Qo'shimcha vazifa muddati: <b>{{remedial}} soat</b>\n" +
    "🕐 Vaqt mintaqasi: {{tz}}",
  askValue: "Yangi qiymatni yuboring (/bekor — bekor qilish):",
  valueSaved: "✅ Saqlandi.",
  valueBad: "❌ Qiymat noto'g'ri. Qayta yuboring.",

  // --- hisobotlar ---
  dailyReport: "📊 <b>Kunlik hisobot</b> · {{date}}\n\n" +
    "✅ Topshiriqlar: <b>{{submissions}}</b>\n" +
    "👥 Qatnashgan o'quvchilar: <b>{{active}}/{{total}}</b>\n" +
    "⚠️ Jarima olganlar: <b>{{penalties}}</b>\n\n" +
    "🏆 <b>Kunlik top</b>\n{{top}}",
  weeklyReport: "🏆 <b>Haftalik leaderboard</b>\n\n{{top}}",
  // --- yangi: moslashuvchan bo'limlar, reaksiya, fikr-mulohaza ---
  topicNewAuto: "🧩 <b>Yangi bo'lim aniqlandi:</b> {{name}}\n" +
    "Turi: <b>{{type}}</b>{{track}}\n\n" +
    "Noto'g'ri bo'lsa, quyidagi tugmalar bilan o'zgartiring:",
  topicNewAsk:
    "🧩 <b>«{{name}}»</b> bo'limida o'quvchi xabar yubordi, lekin bu bo'lim turi belgilanmagan.\n\n" +
    "Bot bu bo'limda nima qilsin?",
  topicsListTitle: "🧩 <b>Guruh bo'limlari</b>\n\nTurini o'zgartirish uchun bo'limni tanlang:",
  topicsEmpty:
    "Hali bo'lim ko'rilmagan. Bot bo'limlarni ulardagi birinchi xabardan taniydi, yoki " +
    "kerakli bo'limda /bolim yuboring.",
  trackAsk: "Yo'nalish nomini yozing: /yonalish speaking",
  trackSet: "✅ «{{name}}» yo'nalishi: <b>{{track}}</b>",
  dmNudge:
    "👋 <b>{{name}}</b>, topshirig'ingiz qabul qilindi! Ball va to'g'ri javoblarni olish uchun " +
    "botga bir marta /start bosing:",
  dmNudgeButton: "🤖 Botni ishga tushirish",
  dmScore:
    "📬 <b>Topshirig'ingiz natijasi</b>\n📝 {{task}}\n\n✅ <b>Baho: {{score}}/10</b>\n💬 {{feedback}}",
  dmFixed:
    "📬 <b>Topshirig'ingiz natijasi</b>\n📝 {{task}}\n\n✅ <b>Bajarildi!</b> +{{points}} ball\n💬 {{feedback}}",
  dmFixedNot:
    "📬 <b>Topshirig'ingiz natijasi</b>\n📝 {{task}}\n\n❌ <b>Bajarilmagan.</b> Ball qo'shilmadi.\n💬 {{feedback}}",
  dmManual:
    "📬 <b>Topshirig'ingiz ustozga yuborildi</b>\n📝 {{task}}\n\n👨‍🏫 Ustoz tekshirgach natija shu yerga keladi.",
  dmTeacherScore: "📬 <b>Ustoz bahosi</b>\n📝 {{task}}\n\n👨‍🏫 <b>{{score}}/10</b>\n💬 {{feedback}}",
  dmRetry:
    "🔁 <b>Qayta topshirish mumkin</b>\n📝 {{task}}\n\nYaxshilangan javobingizni bo'limga yuboring.",
  dmRejected: "❌ <b>Javob qabul qilinmadi</b>\n📝 {{task}}\n\nIltimos, qaytadan urinib ko'ring.",
  dmAnswerKey: "🔑 <b>To'g'ri javob / namuna</b>\n{{key}}",
  dmFileTooLarge:
    "📦 Fayl juda katta (14 MB dan oshmasligi kerak). Qisqaroq ovoz yoki kichikroq fayl yuboring.",
  dmAttemptsExhausted:
    "Bu vazifa uchun urinishlar tugadi. Javobingiz ustozga qo'lda tekshirishga yuborildi.",
  feedbackAsk:
    "💬 <b>Fikr bildirish</b>\n\nBot nimasini yangilash, qo'shish yoki tuzatish kerak? " +
    "Xohlagan fikr yoki taklifingizni yozing.\n\n/bekor — bekor qilish",
  feedbackThanks: "🙏 Rahmat! Fikringiz ustozlarga yuborildi.",
  feedbackTooShort: "Iltimos, fikringizni kamida bir-ikki so'z bilan yozing.",
  feedbackStaff: "💬 <b>Yangi fikr</b> · {{name}}\n\n{{text}}",
  feedbackListTitle: "💬 <b>So'nggi fikrlar</b>\n\n{{list}}",
  feedbackEmpty: "Hali fikr kelmagan.",
  obSlide1:
    "👋 <b>Ascend Academy botiga xush kelibsiz!</b>\n\nMen kunlik vazifalaringizni qabul qilaman, " +
    "ball qo'yaman va reytingni yuritaman. 1/4",
  obSlide2:
    "📝 <b>Vazifani qanday topshiraman?</b>\n\nUstoz vazifani guruhdagi yo'nalish bo'limiga tashlaydi. " +
    "Javobingizni (ovoz, matn, rasm, video, fayl) shu bo'limga yuboring. 2/4",
  obSlide3:
    "👍 <b>Bot qanday javob beradi?</b>\n\nQabul qilinsa xabaringizga reaksiya qo'yadi: 👍 🔥 💯. " +
    "Ball va to'g'ri javob shu chatga keladi. 3/4",
  obSlide4:
    "🏆 <b>Reyting va yangiliklar</b>\n\nHar hafta leaderboard e'lon qilinadi. Ko'proq ball uchun " +
    "🎯 kunlik vazifani oling. Fikr yoki taklifingiz bo'lsa — 💬 Fikr bildirish. 4/4",
  obNext: "Keyingi ➡️",
  obDone: "🚀 Boshladik!",
  weeklyCaption:
    "🏆 <b>Haftalik reyting</b> · {{range}}\n\nO'z o'rningizni ko'rish uchun botda /reyting ni bosing.",
  bonusNudge:
    "🌙 <b>Bugun zo'r ishladingiz!</b>\n\nYana mashq qilmoqchimisiz? Botdan qo'shimcha vazifa oling va ball to'plang.",
} as const;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
}

export const PERIOD_LABEL: Record<Period, string> = {
  week: "hafta",
  month: "oy",
  all: "umumiy",
};

export const TASK_KIND_LABEL = {
  personal: "shaxsiy",
  class: "umumiy",
  self_study: "self study",
  bot: "bot",
} as const;
