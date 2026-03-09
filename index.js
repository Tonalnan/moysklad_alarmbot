require("dotenv").config();
const axios = require("axios");
const cron = require("node-cron");

// ─────────────────────────────────────────────
//  КОНСТАНТЫ
// ─────────────────────────────────────────────

const BASE_URL = "https://api.moysklad.ru/api/remap/1.2";
const MS_TOKEN  = process.env.MOYSKLAD_API_TOKEN;
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT   = process.env.TELEGRAM_CHAT_ID;

// Часы отправки (0 = полночь)
const SCHEDULE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

// ─────────────────────────────────────────────
//  ФИЛЬТРЫ
//  Каждый объект — одна строка в итоговом сообщении.
//  label:      префикс строки (null = без префикса)
//  separator:  разделитель между вчера и сегодня
//  storeIds:   список UUID складов
//  stateIds:   список UUID статусов
// ─────────────────────────────────────────────

const FILTERS = [
  {
    label: null,
    separator: " \\ ",
    storeIds: [
      "4ba3d67d-394d-11f0-0a80-0992001f7804",
      "1cc4094b-41e0-11f0-0a80-11420007340c",
      "3beeff82-ff1b-11ef-0a80-08730006e022",
      "43d532ca-414e-11f0-0a80-015d00128e9d",
      "6a8573d6-4206-11f0-0a80-051a000ec879",
      "4f288532-e999-11ed-0a80-10a8005628d7",
      "375bb8f5-5468-11ee-0a80-01c700196b6a",
      "b777abee-43ee-11ee-0a80-13bd0042423d",
    ],
    stateIds: [
      "4faea672-e999-11ed-0a80-10a800562907",
      "4faea7cd-e999-11ed-0a80-10a800562908",
      "4faea90c-e999-11ed-0a80-10a800562909",
      "4faeabce-e999-11ed-0a80-10a80056290a",
      "4faeac5b-e999-11ed-0a80-10a80056290b",
      "064328c4-eb3d-11ed-0a80-012d002e8683",
      "ffd1b819-eb3c-11ed-0a80-0358002d5330",
      "613ded27-eb40-11ed-0a80-0ca7002ed664",
      "79290a03-eb40-11ed-0a80-0ca7002edcc4",
      "174df699-76a0-11ef-0a80-0cc30019f58e",
      "4f912733-5280-11f0-0a80-0d0400220f2e",
      "7a1b008e-5cbb-11f0-0a80-0dd1007d11bf",
      "f6466f2b-5b3c-11f0-0a80-0267003463de",
      "275b0212-6d30-11f0-0a80-14ed00beb1ee",
      "7ae7d58a-5cbb-11f0-0a80-0dd1007d1299",
      "ac3edfb6-00a8-11ef-0a80-16080043359d",
      "95cd915f-00a8-11ef-0a80-08a000436c16",
      "c4a52d92-00a8-11ef-0a80-08a0004378c4",
      "6fd538d0-00a8-11ef-0a80-048d0041d3e0",
      "7f96747c-00a8-11ef-0a80-059b00429393",
      "34af4ad2-7dd0-11f0-0a80-0ddb019122d8",
      "be56b1f5-7dd1-11f0-0a80-08b800a1d50c",
      "6184817e-8bfc-11f0-0a80-0ddf0370c9ba",
    ],
  },
  {
    label: "Сайт",
    separator: " \\ ",
    storeIds: [
      "801e10b1-51a7-11f0-0a80-193b000a44a3",
    ],
    stateIds: [
      "7a1b008e-5cbb-11f0-0a80-0dd1007d11bf",
      "275b0212-6d30-11f0-0a80-14ed00beb1ee",
      "7ae7d58a-5cbb-11f0-0a80-0dd1007d1299",
      "34af4ad2-7dd0-11f0-0a80-0ddb019122d8",
      "be56b1f5-7dd1-11f0-0a80-08b800a1d50c",
      "6184817e-8bfc-11f0-0a80-0ddf0370c9ba",
      "67a0b568-d6b9-11f0-0a80-181201e3eeeb",
      "6bf03d62-d91d-11f0-0a80-018205261eec",
    ],
  },
];

// ─────────────────────────────────────────────
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ─────────────────────────────────────────────

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function buildRange(baseDate, sendHour) {
  const from = new Date(baseDate);
  from.setHours(0, 0, 0, 0);

  const to = new Date(baseDate);
  to.setHours(sendHour === 0 ? 23 : sendHour - 1, 55, 0, 0);

  return { from: formatDate(from), to: formatDate(to) };
}

async function fetchOrderCount(filter, from, to) {
  const enc = (d) => d.replace(/ /g, "%20");

  const storeFilters = filter.storeIds
    .map((id) => `store=${BASE_URL}/entity/store/${id}`)
    .join(";");

  const stateFilters = filter.stateIds
    .map((id) => `state=${BASE_URL}/entity/customerorder/metadata/states/${id}`)
    .join(";");

  const dateFilter = `moment%3E%3D${enc(from)};moment%3C${enc(to)}`;

  const url =
    `${BASE_URL}/entity/customerorder?limit=1` +
    `&filter=${storeFilters};${stateFilters};${dateFilter}`;

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${MS_TOKEN}` },
  });

  return response.data.meta.size;
}

async function sendTelegram(text) {
  await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    chat_id: TG_CHAT,
    text,
  });
}

// ─────────────────────────────────────────────
//  ВАЛИДАЦИЯ ID при старте
// ─────────────────────────────────────────────

async function validateIds() {
  const headers = { Authorization: `Bearer ${MS_TOKEN}` };

  for (let fi = 0; fi < FILTERS.length; fi++) {
    const f = FILTERS[fi];
    const tag = f.label ? `"${f.label}"` : `#${fi + 1}`;

    console.log(`\n--- Фильтр ${tag}: склады ---`);
    for (const id of f.storeIds) {
      try {
        const r = await axios.get(`${BASE_URL}/entity/store/${id}`, { headers });
        console.log(`  [OK] store ${id}  ->  "${r.data.name}"`);
      } catch (e) {
        console.error(`  [!!] store ${id}  ->  HTTP ${e.response ? e.response.status : "ERR"} (НЕДЕЙСТВИТЕЛЕН)`);
      }
    }

    console.log(`--- Фильтр ${tag}: статусы ---`);
    for (const id of f.stateIds) {
      try {
        const r = await axios.get(
          `${BASE_URL}/entity/customerorder/metadata/states/${id}`,
          { headers }
        );
        console.log(`  [OK] state ${id}  ->  "${r.data.name}"`);
      } catch (e) {
        console.error(`  [!!] state ${id}  ->  HTTP ${e.response ? e.response.status : "ERR"} (НЕДЕЙСТВИТЕЛЕН)`);
      }
    }
  }

  console.log("\n--- Валидация завершена ---\n");
}

// ─────────────────────────────────────────────
//  ОСНОВНАЯ ЗАДАЧА
// ─────────────────────────────────────────────

async function runTask() {
  const now = new Date();
  const sendHour = now.getHours();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const rangeYesterday = buildRange(yesterday, sendHour);
  const rangeToday     = buildRange(now, sendHour);

  console.log(`[${formatDate(now)}] Запрос данных...`);
  console.log(`  Вчера:   ${rangeYesterday.from} -> ${rangeYesterday.to}`);
  console.log(`  Сегодня: ${rangeToday.from} -> ${rangeToday.to}`);

  try {
    const results = await Promise.all(
      FILTERS.map((f) =>
        Promise.all([
          fetchOrderCount(f, rangeYesterday.from, rangeYesterday.to),
          fetchOrderCount(f, rangeToday.from, rangeToday.to),
        ])
      )
    );

    const lines = results.map(([y, t], i) => {
      const f = FILTERS[i];
      const nums = `${y}${f.separator}${t}`;
      return f.label ? `${f.label} ${nums}` : nums;
    });

    const message = lines.join("\n");
    console.log(`  Сообщение:`);
    lines.forEach((l) => console.log(`    ${l}`));

    await sendTelegram(message);
    console.log("  [OK] Сообщение отправлено в Telegram.");
  } catch (err) {
    const errMsg = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error(`  [!!] Ошибка: ${errMsg}`);
  }
}

// ─────────────────────────────────────────────
//  ИТОГОВОЕ СООБЩЕНИЕ В 00:15
//  Формат:
//    08.03.2026: 45
//    Сайт 12
// ─────────────────────────────────────────────

async function runDailySummary() {
  const now = new Date();

  // Сейчас уже новый день — «вчера» это завершившийся день
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // Полный день: 00:00:00 → 23:59:59
  const from = new Date(yesterday);
  from.setHours(0, 0, 0, 0);

  const to = new Date(yesterday);
  to.setHours(23, 59, 59, 0);

  const fromStr = formatDate(from);
  const toStr   = formatDate(to);

  // Дата в формате dd.mm.yyyy для заголовка
  const pad = (n) => String(n).padStart(2, "0");
  const dateLabel = `${pad(yesterday.getDate())}.${pad(yesterday.getMonth() + 1)}.${yesterday.getFullYear()}`;

  console.log(`[${formatDate(now)}] Итоговый отчёт за ${dateLabel}...`);
  console.log(`  Период: ${fromStr} -> ${toStr}`);

  try {
    const counts = await Promise.all(
      FILTERS.map((f) => fetchOrderCount(f, fromStr, toStr))
    );

    const lines = counts.map((count, i) => {
      const f = FILTERS[i];
      // Первый фильтр (label=null): "08.03.2026: 45"
      // Остальные: "Сайт 12"
      return f.label ? `${f.label} ${count}` : `${dateLabel}: ${count}`;
    });

    const message = lines.join("\n");
    console.log(`  Сообщение:`);
    lines.forEach((l) => console.log(`    ${l}`));

    await sendTelegram(message);
    console.log("  [OK] Итоговое сообщение отправлено в Telegram.");
  } catch (err) {
    const errMsg = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error(`  [!!] Ошибка итогового отчёта: ${errMsg}`);
  }
}

// ─────────────────────────────────────────────
//  ПЛАНИРОВЩИК
// ─────────────────────────────────────────────

const cronExpr = `0 ${SCHEDULE_HOURS.join(",")} * * *`;

console.log("===========================================");
console.log(" MoySklad -> Telegram бот запущен");
console.log(`  Расписание (cron): ${cronExpr}`);
console.log(`  Часы отправки: ${SCHEDULE_HOURS.join(", ")}`);
console.log(`  Итог за день:  00:15`);
console.log("===========================================");

validateIds().catch((e) => console.error("Ошибка валидации:", e.message));

// Обычные часовые сообщения
cron.schedule(cronExpr, () => { runTask(); });

// Итоговое сообщение каждую ночь в 00:15
cron.schedule("15 0 * * *", () => { runDailySummary(); });

// Тестовый запуск — раскомментируйте нужную строку:
// runTask();
// runDailySummary();