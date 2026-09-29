// اختبار آلي: listCommittees() صارت تطلب عمود permissions الموسَّع الجديد (راجع
// supabase/granular-permissions-core.sql) وتشتق منه can_edit_final/can_self_draw/show_score/
// show_stats_summary — لازم لا تنكسر شاشة "إدارة اللجان" كاملةً لو الملف لسا ما تطبّق على قاعدة
// بيانات معينة (عمود permissions غير موجود فيرجع خطأ من PostgREST)، بل تتراجع فورًا للقائمة
// القديمة بالأعمدة الأصلية (بدون show_stats_summary، تمامًا كسلوك التراجع قبل هذا التغيير).
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
              if (cols.includes("permissions")) {
                if (!columnExists) {
                  return { data: null, error: { message: 'column committees.permissions does not exist', code: "42703" } };
                }
                return { data: [{ id: "c1", name: "لجنة 1", permissions: { committee_can_edit_final: false, can_self_draw: false, show_score: true, show_stats_summary: true } }], error: null };
              }
              // مستوى التراجع القديم (أعمدة boolean الأصلية، بلا show_stats_summary إطلاقاً — لم يتغيّر).
              return { data: [{ id: "c1", name: "لجنة 1", can_edit_final: false, can_self_draw: false, show_score: true }], error: null };
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
  // 1) عمود permissions موجود فعلياً (SQL مُطبَّق): تُشتَق كل الحقول المسطَّحة منه، بما فيها show_stats_summary.
  {
    const cloud = loadCloudModule(true);
    await cloud.init();
    const committees = await cloud.listCommittees();
    assert.strictEqual(committees[0].show_stats_summary, true, "العمود موجود: يُشتَق show_stats_summary من permissions بشكل طبيعي");
    assert.strictEqual(committees[0].show_score, true, "العمود موجود: يُشتَق show_score من permissions بشكل طبيعي");
  }

  // 2) عمود permissions غير موجود بعد (SQL لسا ما تطبّق): لازم لا يرمي خطأ، يتراجع للقائمة القديمة بالأعمدة الأصلية.
  {
    const cloud = loadCloudModule(false);
    await cloud.init();
    const committees = await cloud.listCommittees();
    assert.strictEqual(committees[0].id, "c1", "العمود غير موجود: لا ينكسر listCommittees، يرجع بيانات اللجنة بدون الحقل الجديد");
    assert.strictEqual(committees[0].show_stats_summary, undefined, "الحقل الجديد يبقى undefined بالتراجع (يُفهَم لاحقًا كـ'ما تطبّق SQL بعد' بمنطق العرض)");
    assert.strictEqual(committees[0].show_score, true, "التراجع يبقى يرجع show_score من العمود القديم مباشرة كما كان دائماً");
  }

  console.log("list-committees-stats-column-fallback.test.js: كل الحالات نجحت — listCommittees تشتق من عمود permissions عند توفره، وتتراجع بأمان تام للأعمدة القديمة قبل تطبيق ملف SQL");
}

run().catch((error) => { console.error("list-committees-stats-column-fallback.test.js FAILED:", error.stack || error.message); process.exit(1); });
