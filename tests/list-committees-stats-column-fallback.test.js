// اختبار آلي: listCommittees() صارت تطلب عمود show_stats_summary الجديد (زر مستقل لإخفاء/إظهار
// بطاقة إحصائية اللجنة، راجع supabase/committee-stats-summary-visibility.sql) — لازم لا تنكسر
// شاشة "إدارة اللجان" كاملةً لو الملف لسا ما تطبّق على قاعدة بيانات معينة (العمود غير موجود
// فيرجع خطأ من PostgREST)، بل تتراجع فورًا للقائمة القديمة بدون هذا العمود.
// شغّله: node tests/list-committees-stats-column-fallback.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const projectRoot = path.join(__dirname, "..");
const cloudSrc = fs.readFileSync(path.join(projectRoot, "cloud.js"), "utf8");

function loadCloudModule(columnExists) {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout,
    window: {},
  };
  sandbox.window = sandbox;
  sandbox.SUPABASE_CONFIG = { url: "https://example.test", anonKey: "anon" };
  sandbox.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: null } }) },
      from: (table) => {
        if (table !== "committees") throw new Error(`unexpected table: ${table}`);
        return {
          select: (cols) => ({
            order: async () => {
              if (cols.includes("show_stats_summary") && !columnExists) {
                return { data: null, error: { message: 'column committees.show_stats_summary does not exist', code: "42703" } };
              }
              return { data: [{ id: "c1", name: "لجنة 1", show_score: true, ...(cols.includes("show_stats_summary") ? { show_stats_summary: true } : {}) }], error: null };
            },
          }),
        };
      },
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(cloudSrc, sandbox, { filename: "cloud.js" });
  return sandbox.CloudCompetition;
}

async function run() {
  // 1) العمود موجود فعلياً (SQL مُطبَّق): يرجع show_stats_summary ضمن البيانات مباشرة.
  {
    const cloud = loadCloudModule(true);
    await cloud.init();
    const committees = await cloud.listCommittees();
    assert.strictEqual(committees[0].show_stats_summary, true, "العمود موجود: يُرجَع show_stats_summary بشكل طبيعي");
  }

  // 2) العمود غير موجود بعد (SQL لسا ما تطبّق): لازم لا يرمي خطأ، يتراجع للقائمة القديمة.
  {
    const cloud = loadCloudModule(false);
    await cloud.init();
    const committees = await cloud.listCommittees();
    assert.strictEqual(committees[0].id, "c1", "العمود غير موجود: لا ينكسر listCommittees، يرجع بيانات اللجنة بدون الحقل الجديد");
    assert.strictEqual(committees[0].show_stats_summary, undefined, "الحقل الجديد يبقى undefined بالتراجع (يُفهَم لاحقًا كـ'ما تطبّق SQL بعد' بمنطق العرض)");
  }

  console.log("list-committees-stats-column-fallback.test.js: كل الحالات نجحت — listCommittees تستخدم العمود الجديد عند توفره، وتتراجع بأمان تام قبل تطبيق ملف SQL");
}

run().catch((error) => { console.error("list-committees-stats-column-fallback.test.js FAILED:", error.stack || error.message); process.exit(1); });
