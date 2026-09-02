// اختبار آلي لخلل "تعديل الإدارة اليدوي لعلامة متسابق مُختبَر إلكترونياً كان يُمحى تلقائياً خلال
// ثوانٍ": mergeFinalSessionsIntoState (تعمل كل استطلاع دوري للإدارة، وأيضاً عند تسجيل الدخول/
// زر تحديث النتائج) كانت تقارن فقط participant.score!==session.score بدون أي اعتبار لمصدر
// العلامة — فأي تعديل يدوي من الإدارة (زر "تعديل العلامة" بشاشة النتيجة) على متسابق له جلسة
// exam_sessions معتمدة أصلاً كان يُستبدَل صامتاً بالعلامة الإلكترونية القديمة عند أول استطلاع
// دوري لاحق (خلال 9 ثوانٍ)، فيبدو للإدارة إنه تعديلها "ما ثبت" رغم إنه انحفظ فعلاً بالسيرفر.
// الإصلاح: تجاهل الجلسة إذا كانت العلامة الحالية يدوية وأحدث من (أو تساوي) آخر اعتماد لها.
// شغّله: node tests/admin-manual-score-override.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const projectRoot = path.join(__dirname, "..");
let appSrc = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");

const markerRe = /if\(document\.readyState===("|')loading\1\)document\.addEventListener\("DOMContentLoaded",init,\{once:true\}\);\s*else init\(\);/;
if (!markerRe.test(appSrc)) throw new Error("bootstrap marker not found — app.js structure changed, update this test");
appSrc = appSrc.replace(markerRe, "/* init() disabled for headless test */");

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { readyState: "complete", addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" } },
  window: {},
  navigator: { onLine: true },
  crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" },
  history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {},
  setTimeout, clearTimeout,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

function run() {
  const committee = { id: "c1", name: "لجنة 1" };
  const session = { id: "sess-1", participant_id: "p1", committee_id: "c1", status: "final", score: 62, assessment: { updatedAt: "2026-09-01T10:00:00.000Z" }, finalized_at: "2026-09-01T10:00:00.000Z", updated_at: "2026-09-01T10:00:00.000Z" };

  // 1) أول جلب: العلامة الإلكترونية (62) تُدمج بشكل طبيعي — لا يوجد أي تعديل يدوي بعد.
  const participant = { id: "p1", name: "متسابقة" };
  const initialState = { config: { competitionName: "تجريبي" }, participants: [participant], draws: [], resets: [], deletions: [] };
  sandbox.__initialState = initialState;
  vm.runInContext("state = __initialState; committeeSessions = [];", sandbox);
  sandbox.mergeFinalSessionsIntoState([session], [committee], { replace: false });
  let p = vm.runInContext("state.participants.find(x=>x.id==='p1')", sandbox);
  assert.strictEqual(p.score, 62, "أول دمج: العلامة الإلكترونية 62 تُطبَّق بشكل طبيعي");
  assert.strictEqual(p.scoreSource, "electronic");

  // 2) الإدارة تعدّل العلامة يدوياً لـ90 (تماماً كزر "تعديل العلامة" بشاشة النتيجة) — بتاريخ
  //    أحدث من finalized_at الجلسة.
  p.score = 90; p.gradedAt = "2026-09-01T12:00:00.000Z"; p.scoreSource = "manual"; p.manualEntryBy = "الإدارة";

  // 3) استطلاع دوري لاحق (نفس الجلسة القديمة، لم تتغيّر إطلاقاً بالسيرفر): بدون الإصلاح كانت
  //    هذه الخطوة تمحو الـ90 وترجّع 62 صامتاً. مع الإصلاح، يجب أن تبقى 90.
  sandbox.mergeFinalSessionsIntoState([session], [committee], { replace: false });
  p = vm.runInContext("state.participants.find(x=>x.id==='p1')", sandbox);
  assert.strictEqual(p.score, 90, "الخلل: التعديل اليدوي (90) لا يجب أن يُمحى بعلامة exam_sessions القديمة (62) عند الاستطلاع الدوري اللاحق");
  assert.strictEqual(p.scoreSource, "manual", "مصدر العلامة يبقى 'manual' بعد الاستطلاع اللاحق");

  // 4) لو أعادت اللجنة اعتماد نتيجة جديدة فعلاً بعد التعديل اليدوي (finalized_at أحدث من
  //    gradedAt اليدوي) — يجب أن تُطبَّق النسخة الإلكترونية الجديدة (73) تلقائياً، لأنها فعلاً
  //    أحدث حدث حقيقي، ويرجع scoreSource لـ"electronic" بشكل صحيح.
  const reFinalizedSession = { ...session, score: 73, assessment: { updatedAt: "2026-09-01T15:00:00.000Z" }, finalized_at: "2026-09-01T15:00:00.000Z", updated_at: "2026-09-01T15:00:00.000Z" };
  sandbox.mergeFinalSessionsIntoState([reFinalizedSession], [committee], { replace: false });
  p = vm.runInContext("state.participants.find(x=>x.id==='p1')", sandbox);
  assert.strictEqual(p.score, 73, "اعتماد إلكتروني جديد بعد التعديل اليدوي (بتاريخ أحدث) يجب أن يُطبَّق تلقائياً");
  assert.strictEqual(p.scoreSource, "electronic", "مصدر العلامة يرجع 'electronic' بعد اعتماد جديد فعلي من اللجنة");

  console.log("admin-manual-score-override.test.js: كل الحالات نجحت — التعديل اليدوي من الإدارة يبقى ثابتاً ولا يُمحى بالاستطلاع الدوري، ويُستبدَل بأحدث اعتماد إلكتروني فقط إذا صار فعلاً بعده");
}

try {
  run();
} catch (error) {
  console.error("admin-manual-score-override.test.js FAILED:", error.stack || error.message);
  process.exit(1);
}
