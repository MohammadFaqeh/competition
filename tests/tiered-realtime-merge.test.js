// اختبار آلي لتصميم "Real-Time طبقي": الاستطلاع الدوري (كل 9 ثوانٍ) صار يجلب فقط الجلسات
// الجارية + المعتمدة خلال آخر LIVE_RECENT_WINDOW_MS (12 ساعة)، بدل كل جلسة مُعتمدة منذ أول يوم
// بالمسابقة. التحقق المطلوب: هذا التقليل بالجلب لا يعني ضياع بيانات — mergeFinalSessionsIntoState
// بوضع replace:false يجب أن يدمج (upsert) فوق committeeSessions المحفوظة أصلاً، لا يستبدلها،
// حتى تبقى جلسة اعتُمدت قبل أكثر من 12 ساعة ظاهرة بعلامتها الصحيحة (تُستخدمها examDurationRows
// مثلاً)، رغم إنها لم تعد تُجلب من قاعدة البيانات بكل نبضة استطلاع.
// شغّله: node tests/tiered-realtime-merge.test.js
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

async function run() {
  const LIVE_RECENT_WINDOW_MS = vm.runInContext("LIVE_RECENT_WINDOW_MS", sandbox);
  assert.strictEqual(LIVE_RECENT_WINDOW_MS, 12 * 60 * 60 * 1000, "نافذة الحداثة المتفق عليها 12 ساعة بالضبط");

  const participantOld = { id: "p-old", name: "قديمة", level: 3, levelName: "3 أجزاء", gender: "أنثى" };
  const participantRecent = { id: "p-recent", name: "حديثة", level: 3, levelName: "3 أجزاء", gender: "أنثى" };
  const initialState = { config: { competitionName: "تجريبي" }, participants: [participantOld, participantRecent], draws: [], resets: [], deletions: [] };
  sandbox.__initialState = initialState;
  vm.runInContext("state = __initialState; committeeSessions = [];", sandbox);

  const committee = { id: "c1", name: "لجنة 1", chairman_name: null, member_name: null };

  // 1) أول نبضة استطلاع (أو الجلب الكامل عند تسجيل الدخول): الجلستان تظهران — تُدمَجان (upsert)
  //    فوق committeeSessions الفارغة أصلاً، تمامًا كما يحصل بأي استدعاء (كامل أو مُقيَّد).
  const sessionOldFinal = { id: "sess-old", participant_id: "p-old", committee_id: "c1", status: "final", score: 55, assessment: {}, finalized_at: "2026-09-01T20:00:00.000Z", updated_at: "2026-09-01T20:00:00.000Z" };
  const sessionRecentFinal = { id: "sess-recent-v1", participant_id: "p-recent", committee_id: "c1", status: "final", score: 70, assessment: {}, finalized_at: "2026-09-02T08:00:00.000Z", updated_at: "2026-09-02T08:00:00.000Z" };
  sandbox.mergeFinalSessionsIntoState([sessionOldFinal, sessionRecentFinal], [committee], { replace: false });

  let committeeSessions = vm.runInContext("committeeSessions", sandbox);
  assert.strictEqual(committeeSessions.length, 2, "أول دمج: الجلستان محفوظتان محليًا");
  let p = vm.runInContext("state.participants.find(x=>x.id==='p-old')", sandbox);
  assert.strictEqual(p.score, 55, "علامة المتسابقة القديمة انضمّت بشكل صحيح");

  // 2) نبضة استطلاع لاحقة (بعد أكثر من 12 ساعة): استطلاع الإدارة المُقيَّد الآن لا يرى إلا
  //    الجلسات المعتمدة خلال آخر 12 ساعة — sess-old لم تعد جزءاً من الاستجابة إطلاقاً (كأنها
  //    خرجت من نافذة listRecentFinalSessions الحقيقية)، فقط sess-recent (المتسابقة الحديثة)
  //    تصل، وبعلامة مُحدَّثة (73 بدل 70 — مثلاً بعد تعديل يدوي بصلاحية اللجنة).
  const sessionRecentFinalUpdated = { ...sessionRecentFinal, id: "sess-recent-v1", score: 73, updated_at: "2026-09-02T09:30:00.000Z" };
  sandbox.mergeFinalSessionsIntoState([sessionRecentFinalUpdated], [committee], { replace: false });

  committeeSessions = vm.runInContext("committeeSessions", sandbox);
  assert.strictEqual(committeeSessions.length, 2, "replace:false: sess-old تبقى محفوظة رغم غيابها عن آخر استجابة مُقيَّدة (لم تُفقد، فقط لم تُعَد جلبها)");
  assert.ok(committeeSessions.some(s => s.id === "sess-old"), "sess-old (القديمة) موجودة حتمًا بعد الدمج الثاني");
  const updatedRecent = committeeSessions.find(s => s.id === "sess-recent-v1");
  assert.strictEqual(updatedRecent.score, 73, "sess-recent تحدّثت بالعلامة الجديدة (upsert بالمعرّف نجح)");

  p = vm.runInContext("state.participants.find(x=>x.id==='p-old')", sandbox);
  assert.strictEqual(p.score, 55, "علامة المتسابقة القديمة (p-old) ما زالت صحيحة ومحفوظة رغم عدم إعادة جلب جلستها إطلاقًا بالنبضة الثانية");
  const pRecent = vm.runInContext("state.participants.find(x=>x.id==='p-recent')", sandbox);
  assert.strictEqual(pRecent.score, 73, "علامة المتسابقة الحديثة تحدّثت لآخر قيمة معتمدة");

  // 3) للمقارنة: الاستدعاءات ذات الجلب الكامل (replace:true الافتراضي — تسجيل الدخول/زر
  //    تحديث النتائج اليدوي) يجب أن تبقى تستبدل كليًا كالسابق تمامًا (تصحيح ذاتي كامل عند الطلب).
  vm.runInContext("committeeSessions = []", sandbox);
  sandbox.mergeFinalSessionsIntoState([sessionOldFinal], [committee]); // بلا خيار ثالث = replace:true افتراضيًا
  committeeSessions = vm.runInContext("committeeSessions", sandbox);
  assert.strictEqual(committeeSessions.length, 1, "الجلب الكامل (replace الافتراضي) يستبدل القائمة بالكامل كما بالسابق تمامًا — لا تغيير بسلوك تسجيل الدخول/التحديث اليدوي");

  console.log("tiered-realtime-merge.test.js: كل الحالات نجحت — الاستطلاع الدوري المُقيَّد يدمج (upsert) فوق الجلسات المحفوظة بدل استبدالها، فلا تُفقد بيانات الجلسات الأقدم من 12 ساعة رغم توقف إعادة جلبها");
}

run().catch((error) => {
  console.error("tiered-realtime-merge.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
