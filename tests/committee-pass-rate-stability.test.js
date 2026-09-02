// اختبار آلي لخلل "دائرة نسبة النجاح عند اللجنة بتظهر وبتختفي": renderCommitteePassRate كانت
// تحسب من state.participants مباشرة — تلك المصفوفة تُستبدَل بالكامل من بيانات الإدارة المشتركة
// (competition_state.payload) بكل نبضة استطلاع (9 ثوانٍ)، وتلك البيانات لا تعرف بنتيجة اعتمدتها
// اللجنة للتو محلياً إلا بعد ما جهاز إدارة يدمجها ويرفعها لاحقاً — فكانت الدائرة والأعداد تتذبذب
// بين القيمة الصحيحة والفارغة كل ما تمر نبضة استطلاع قبل ما تلحق بيانات الإدارة. الإصلاح: تُحسب
// الآن من committeeSessions (تُدمَج/تُحدَّث محلياً باستقلالية تامة، لا تُستبدَل أبداً — نفس مصدر
// عرض "مكتمل · العلامة" بقائمة المتسابقين أصلاً).
// شغّله: node tests/committee-pass-rate-stability.test.js
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

function makeElement() {
  const classes = new Set();
  return {
    dataset: {}, style: { setProperty() {} }, value: "", textContent: "", innerHTML: "",
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => { if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false } classes.add(c); return true } if (force) classes.add(c); else classes.delete(c); return force },
      contains: (c) => classes.has(c),
    },
    closest() { return this },
    addEventListener() {}, querySelector() { return makeElement() }, querySelectorAll() { return [] },
  };
}
const elementCache = new Map();
function queryElement(sel) { if (!elementCache.has(sel)) elementCache.set(sel, makeElement()); return elementCache.get(sel) }

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { readyState: "complete", addEventListener: () => {}, querySelector: (sel) => queryElement(sel), querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" } },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

function run() {
  const committee = { id: "c1", show_score: true };

  // جلسة معتمدة فعلياً بـcommitteeSessions (المصدر المستقر).
  sandbox.__committeeSessions = [{ id: "sess-1", participant_id: "p1", committee_id: "c1", status: "final", score: 80 }];
  vm.runInContext("committeeSessions = __committeeSessions;", sandbox);

  // state.participants (المصدر القديم غير المستقر): بالغلط ما زالت لا تعرف بعلامة p1 إطلاقًا
  // (تمامًا كما لو كانت لحظة وصول بيانات الإدارة المشتركة المتأخرة عن اعتماد اللجنة للتو).
  sandbox.__state = { config: {}, participants: [{ id: "p1" }], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state;", sandbox);

  sandbox.renderCommitteePassRate(committee);
  const examinedCount = vm.runInContext('document.querySelector("#committeeExaminedCount").textContent', sandbox);
  const passedCount = vm.runInContext('document.querySelector("#committeePassedCount").textContent', sandbox);
  assert.strictEqual(examinedCount, "1", "العدد يُحسب من committeeSessions (1 جلسة معتمدة) رغم أن state.participants لا يعرف بها إطلاقًا");
  assert.strictEqual(passedCount, "1", "الناجحون يُحسبون من علامة committeeSessions (80) بشكل صحيح");

  // محاكاة نبضة استطلاع: state.participants تُستبدَل بالكامل (كما يحصل فعليًا كل 9 ثوانٍ) —
  // لكن committeeSessions تبقى كما هي (upsert لا استبدال، مُصلَحة سابقًا بنفس الجلسة). النتيجة
  // يجب أن تبقى ثابتة تمامًا، بلا أي "اختفاء" أو رجوع لصفر.
  sandbox.__state2 = { config: {}, participants: [{ id: "p1" }, { id: "p2" }], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state2;", sandbox);
  sandbox.renderCommitteePassRate(committee);
  const examinedCountAfterPoll = vm.runInContext('document.querySelector("#committeeExaminedCount").textContent', sandbox);
  assert.strictEqual(examinedCountAfterPoll, "1", "بعد استبدال state.participants بالكامل (محاكاة نبضة استطلاع): العدد يبقى ثابتاً (1)، لا يختفي ولا يرجع صفر");

  // بناءً على طلب صريح لاحق: إخفاء العلامة الفردية عن اللجنة (show_score=false) لا يخفي هذه
  // البطاقة المجمَّعة — يبقى عدد الممتحَنين/الناجحين/الراسبين ونسبة النجاح ظاهرين للجنة دائماً،
  // فقط العلامة الدقيقة لكل متسابق تبقى محجوبة (بمكان آخر بالواجهة).
  sandbox.renderCommitteePassRate({ id: "c1", show_score: false });
  const panelHiddenWhenScoreHidden = vm.runInContext('document.querySelector("#committeePassRateRing").closest(".x").classList.contains("hidden")', sandbox);
  assert.strictEqual(panelHiddenWhenScoreHidden, false, "إخفاء العلامة الفردية عن اللجنة لا يخفي بطاقة الإحصائية المجمَّعة");
  const examinedCountWhenScoreHidden = vm.runInContext('document.querySelector("#committeeExaminedCount").textContent', sandbox);
  assert.strictEqual(examinedCountWhenScoreHidden, "1", "الأعداد المجمَّعة تبقى تُحسب وتُعرض بشكل صحيح حتى مع إخفاء العلامة الفردية");

  console.log("committee-pass-rate-stability.test.js: كل الحالات نجحت — إحصائية اللجنة تُحسب من committeeSessions المستقرة، فلا تتذبذب/تختفي بعد كل استبدال دوري لـstate.participants");
}

try { run(); } catch (error) { console.error("committee-pass-rate-stability.test.js FAILED:", error.stack || error.message); process.exit(1); }
