// اختبار آلي لتحسين حجم حفظة الإدارة/المشرف: admin_save_state/supervisor_save_state مصمَّمتان
// أصلاً لتحافظا على أي متسابق/سحب لم يصل ضمن الدفعة ولم يُدرَج بالمحذوفين (راجع admin-save-
// state-performance-fix.sql)، فلا داعي لإرسال كامل قائمة المتسابقين (مئات العناصر) بكل حفظة —
// فقط من تغيّر محتواه فعلياً منذ آخر مزامنة ناجحة. هذا هو سبب تعذر/بطء مزامنة الإدارة الفعلي
// المُبلَّغ عنه أثناء الامتحان (إرسال كامل القائمة على شبكة ضعيفة).
// شغّله: node tests/admin-save-state-diff-only.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const projectRoot = path.join(__dirname, "..");
const cloudSrc = fs.readFileSync(path.join(projectRoot, "cloud.js"), "utf8");

function loadCloudModule(rpcHandler) {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout,
    clearTimeout,
    AbortController,
    window: {},
  };
  sandbox.window = sandbox;
  sandbox.SUPABASE_CONFIG = { url: "https://example.test", anonKey: "anon" };
  sandbox.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: null } }) },
      rpc: (name, args) => ({
        abortSignal() { return this; },
        then(resolve, reject) { Promise.resolve().then(() => rpcHandler(name, args)).then(resolve, reject); },
      }),
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(cloudSrc, sandbox, { filename: "cloud.js" });
  return sandbox.CloudCompetition;
}

// مقارنة عبر JSON.stringify بدل assert.deepStrictEqual مباشرة: المصفوفات القادمة من داخل
// cloud.js المُنفَّذ عبر vm.createContext تنتمي لسياق (realm) مختلف عن سياق هذا الملف، فتفشل
// deepStrictEqual لمجرد اختلاف مرجع الـPrototype حتى لو كان المحتوى مطابقاً حرفياً — خلل بالأداة
// فقط (بالمتصفح الفعلي app.js وcloud.js بنفس السياق دائماً، لا وجود لهذا التمييز إطلاقاً).
function assertSameContent(actual, expected, message) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

async function run() {
  const calls = [];
  async function handler(name, args) {
    calls.push({ name, args });
    if (name === "admin_save_state" || name === "supervisor_save_state") return { data: {}, error: null };
    throw new Error(`unexpected rpc: ${name}`);
  }
  const cloud = loadCloudModule(handler);
  await cloud.init();

  const baseline = [
    { id: "P1", name: "أحمد", score: null },
    { id: "P2", name: "سارة", score: null },
  ];
  cloud.markAdminKnownIds(baseline, []);

  // 1) إضافة متسابق جديد فقط: لازم يُرسل الجديد فقط، لا كل القائمة
  calls.length = 0;
  await cloud.saveCompetitionState({ config: { x: 1 }, participants: [...baseline, { id: "P3", name: "خالد", score: null }], draws: [] });
  assert.strictEqual(calls.length, 1, "يجب استدعاء admin_save_state مرة واحدة فقط");
  assertSameContent(calls[0].args.p_participants.map(p => p.id), ["P3"], "يجب إرسال المتسابق الجديد فقط، لا كل القائمة");
  assertSameContent(calls[0].args.p_deleted_participant_ids, [], "لا يوجد محذوفون بهذه الخطوة");

  // 2) تعديل علامة متسابق موجود مسبقاً فقط: لازم يُرسل هو فقط
  calls.length = 0;
  const updated = [baseline[0], { ...baseline[1], score: 88 }, { id: "P3", name: "خالد", score: null }];
  await cloud.saveCompetitionState({ config: { x: 1 }, participants: updated, draws: [] });
  assertSameContent(calls[0].args.p_participants.map(p => p.id), ["P2"], "يجب إرسال المتسابق المتغيّر فقط");

  // 3) حفظة بلا أي تغيير إطلاقاً: صفر متسابقين مُرسلين (لا نعيد إرسال أي شيء ثابت)
  calls.length = 0;
  await cloud.saveCompetitionState({ config: { x: 1 }, participants: updated, draws: [] });
  assert.strictEqual(calls[0].args.p_participants.length, 0, "بدون أي تغيير يجب ألا يُرسل أي متسابق");

  // 4) حذف متسابق: لازم يظهر بقائمة المحذوفين فقط، وصفر بقائمة المُرسَلين
  calls.length = 0;
  const afterDelete = updated.filter(p => p.id !== "P3");
  await cloud.saveCompetitionState({ config: { x: 1 }, participants: afterDelete, draws: [] });
  assertSameContent(calls[0].args.p_deleted_participant_ids, ["P3"], "يجب إدراج المحذوف بقائمة المحذوفين");
  assert.strictEqual(calls[0].args.p_participants.length, 0, "لا يوجد أي متسابق آخر تغيّر بهذه الخطوة");

  // 5) نفس المنطق لـsaveSupervisorState (نفس البنية بالضبط)
  cloud.markSupervisorKnownIds(baseline, []);
  calls.length = 0;
  await cloud.saveSupervisorState({ participants: [...baseline, { id: "P4", name: "منى", score: null }], draws: [] });
  assertSameContent(calls[0].args.p_participants.map(p => p.id), ["P4"], "المشرف أيضاً يجب أن يرسل الجديد فقط");

  console.log("admin-save-state-diff-only.test.js: كل الحالات نجحت — الحفظ يرسل فقط من تغيّر فعلياً");
}

run().catch(error => {
  console.error("admin-save-state-diff-only.test.js FAILED:", error.message);
  process.exit(1);
});
