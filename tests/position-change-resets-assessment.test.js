// اختبار آلي لإصلاح ثغرة: عند تغيير موضع أثناء الاختبار الحي (زر "تغيير الموضع" — خصم 10)،
// كانت أخطاء/ترددات/ملاحظة الموضع القديم تبقى ملتصقة بنفس خانة assessment.positions[index]
// وتُحتسب خطأً على الموضع الجديد (ازدواج بالخصم على نص لم يُسمَّع أصلاً). الإصلاح: أرشفة كاملة
// لحالة الموضع القديم داخل entry.changes[].oldAssessmentSnapshot (لا فقدان معلومة)، ثم تصفير
// الخانات المستقلة فقط (memorization/language/tajweed/hesitation/note/completed) لهذا الموضع
// تحديداً — بدون أي أثر على باقي مواضع نفس المتسابق. يستخدم الدوال الحقيقية المشحونة فعلياً.
// شغّله: node tests/position-change-resets-assessment.test.js
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
    dataset: {}, style: {}, value: "", textContent: "", innerHTML: "", disabled: false, className: "",
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => { if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false } classes.add(c); return true } if (force) classes.add(c); else classes.delete(c); return force },
      contains: (c) => classes.has(c),
    },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null },
    querySelector() { return makeElement() }, querySelectorAll() { return [] },
    closest() { return null }, appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, click() {},
  };
}
const elementCache = new Map();
function queryElement(sel) { if (!elementCache.has(sel)) elementCache.set(sel, makeElement()); return elementCache.get(sel) }

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { readyState: "complete", addEventListener: () => {}, querySelector: (sel) => queryElement(sel), querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" }, body: makeElement() },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
  confirm: () => true,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

// جزء وهمي فيه 3 مواضع (كافٍ لتوفير بديل عند التبديل).
sandbox.__candidates = [
  { id: "pos-1", juz: 9, chapter: 20, startId: 5000 },
  { id: "pos-2", juz: 9, chapter: 20, startId: 5010 },
  { id: "pos-3", juz: 9, chapter: 21, startId: 5200 },
];
vm.runInContext("candidates = __candidates;", sandbox);

sandbox.window.CloudCompetition = {
  get context() { return { kind: "committee", committee: { name: "لجنة 1", examiner_role: "chairman" } } },
};

async function run() {
  sandbox.__state = { config: {}, participants: [], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state;", sandbox);

  const draw = {
    id: "DRAW-1", level: 2, rerolls: [],
    positions: [
      { id: "pos-1", juz: 9, chapter: 20, startId: 5000 },
      { id: "posOther", juz: 10, chapter: 22, startId: 6000 }, // موضع ثانٍ لنفس المتسابق، لن يُلمس إطلاقاً
    ],
  };
  const participant = { id: "P1", name: "طالبة تجريبية" };
  const assessment = participant.assessment = {
    id: "ASSESS-1", drawId: draw.id, status: "draft",
    positions: [
      { positionId: "pos-1", memorization: 3, language: 0, tajweed: 0, hesitation: 4, positionChange: 0, note: "ملاحظة قديمة", completed: true },
      { positionId: "posOther", memorization: 1, language: 2, tajweed: 0, hesitation: 0, positionChange: 0, note: "موضع آخر لم يتغير", completed: false },
    ],
    actions: [],
  };

  await sandbox.replaceAssessmentPosition(draw, participant, assessment, 0);

  const changedEntry = assessment.positions[0];
  const untouchedEntry = assessment.positions[1];

  // 1) الموضع الجديد (نفس الخانة) صار نظيفاً تماماً — لا آثار للأخطاء/الترددات/الملاحظة القديمة.
  assert.strictEqual(changedEntry.memorization, 0, "أخطاء الحفظ يجب أن تُصفَّر للموضع الجديد");
  assert.strictEqual(changedEntry.hesitation, 0, "الترددات يجب أن تُصفَّر للموضع الجديد");
  assert.strictEqual(changedEntry.note, "", "الملاحظة يجب أن تُصفَّر للموضع الجديد");
  assert.strictEqual(changedEntry.completed, false, "حالة الإنهاء يجب أن تُصفَّر للموضع الجديد");
  assert.notStrictEqual(changedEntry.positionId, "pos-1", "positionId يجب أن يتغير فعلياً لموضع آخر من نفس الجزء");

  // 2) خصم تغيير الموضع (10 علامات) يبقى يُطبَّق بشكل صحيح — لم يتأثر بالإصلاح.
  assert.strictEqual(changedEntry.positionChange, 1, "عداد تغيير الموضع يجب أن يزيد بمقدار 1 (يقود خصم 10 عبر calculateAssessment)");

  // 3) لا فقدان لأي معلومة: بيانات الموضع القديم محفوظة كاملة داخل سجل التغييرات.
  assert.strictEqual(changedEntry.changes.length, 1, "يجب تسجيل حدث تغيير واحد");
  const snapshot = changedEntry.changes[0].oldAssessmentSnapshot;
  assert.ok(snapshot, "يجب حفظ لقطة من حالة الموضع القديم قبل التصفير");
  assert.strictEqual(snapshot.memorization, 3, "اللقطة يجب أن تحفظ عدد أخطاء الحفظ الأصلي (3) للموضع القديم");
  assert.strictEqual(snapshot.hesitation, 4, "اللقطة يجب أن تحفظ عدد الترددات الأصلي (4) للموضع القديم");
  assert.strictEqual(snapshot.note, "ملاحظة قديمة", "اللقطة يجب أن تحفظ الملاحظة الأصلية للموضع القديم");
  assert.strictEqual(changedEntry.changes[0].oldPosition.id, "pos-1", "سجل التغيير يجب أن يحفظ هوية الموضع القديم أيضاً");

  // 4) الموضع الثاني لنفس المتسابق (لم يُغيَّر) يبقى كما هو تماماً — بلا أي أثر جانبي.
  assert.strictEqual(untouchedEntry.memorization, 1, "الموضع غير المُغيَّر يجب ألا يتأثر إطلاقاً");
  assert.strictEqual(untouchedEntry.language, 2, "الموضع غير المُغيَّر يجب ألا يتأثر إطلاقاً");
  assert.strictEqual(untouchedEntry.note, "موضع آخر لم يتغير", "الموضع غير المُغيَّر يجب ألا يتأثر إطلاقاً");

  console.log("position-change-resets-assessment.test.js: نجح — تغيير الموضع يصفّر أخطاء/ترددات الموضع المُغيَّر فقط، مع أرشفة كاملة لبياناته القديمة، وبدون أي أثر على باقي مواضع المتسابق أو على خصم تغيير الموضع نفسه");
}

run().catch(error => { console.error("position-change-resets-assessment.test.js FAILED:", error.stack || error.message); process.exit(1); });
