// اختبار آلي لإصلاح: "إلغاء الاختبار" (رئيس اللجنة) كان يحاول مسح مسودة المتصفح المحلية بمفتاح
// خاطئ (بلا اسم الدور: `${ASSESSMENT_DRAFT_PREFIX}${participantId}`) بينما المسودة الحقيقية
// محفوظة بمفتاح examinerDraftKey الذي يتضمن الدور (`${ASSESSMENT_DRAFT_PREFIX}chairman-${id}` أو
// `-member-${id}`) — فالمسح لم يكن يعمل فعلياً، والمسودة القديمة (بأخطائها وموضعها الحالي) كانت
// تُسترجَع تلقائياً عند بدء الاختبار من جديد رغم أن السيرفر يحذف الجلسة بالكامل فعلياً. السيناريو
// الحقيقي المُبلَّغ: إلغاء اختبار، ثم البدء من جديد يرجّع لنفس الموضع الرابع بنفس الأخطاء القديمة.
// شغّله: node tests/cancel-exam-clears-local-draft.test.js
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
    dataset: {}, style: {}, value: "", textContent: "", innerHTML: "", disabled: false,
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

// localStorage حقيقي (Map)، لا no-op — لازم نتحقق فعليًا من إنه المفتاح الصحيح انمسح.
const localStorageStore = new Map();

const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
    setItem: (k, v) => localStorageStore.set(k, v),
    removeItem: (k) => localStorageStore.delete(k),
  },
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

async function run() {
  const ASSESSMENT_DRAFT_PREFIX = vm.runInContext("ASSESSMENT_DRAFT_PREFIX", sandbox);
  const chairmanKey = `${ASSESSMENT_DRAFT_PREFIX}chairman-P1`;
  const memberKey = `${ASSESSMENT_DRAFT_PREFIX}member-P1`;

  // مسودة قديمة حقيقية بالموضع الرابع (index 3) مع أخطاء مسجَّلة — بالضبط سيناريو البلاغ.
  const staleDraft = {
    id: "ASSESS-OLD", drawId: "DRAW-1", status: "draft", currentPosition: 3, updatedAt: "2026-09-03T05:00:00.000Z",
    positions: [
      { positionId: "pos-1", memorization: 2, language: 0, tajweed: 1, hesitation: 3, positionChange: 0, note: "", completed: true },
      { positionId: "pos-2", memorization: 1, language: 0, tajweed: 0, hesitation: 0, positionChange: 0, note: "", completed: true },
      { positionId: "pos-3", memorization: 0, language: 0, tajweed: 0, hesitation: 1, positionChange: 0, note: "", completed: true },
      { positionId: "pos-4", memorization: 4, language: 2, tajweed: 0, hesitation: 5, positionChange: 0, note: "", completed: false },
    ],
    actions: [],
  };
  localStorageStore.set(chairmanKey, JSON.stringify(staleDraft));

  const participant = { id: "P1", name: "طالب تجريبي", assessment: { ...staleDraft } };
  sandbox.__state = { config: {}, participants: [participant], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state; committeeSessions = [{id:'sess-1',participant_id:'P1',status:'in_progress'}]; activeCloudSession = {id:'sess-1', participant_id:'P1'};", sandbox);

  let cancelCalled = false;
  sandbox.window.CloudCompetition = {
    get context() { return { kind: "committee", committee: { name: "لجنة 1", examiner_role: "chairman" } } },
    cancelCommitteeSession: async () => { cancelCalled = true; },
  };

  await sandbox.cancelCommitteeExam("P1");

  assert.ok(cancelCalled, "يجب استدعاء إلغاء الجلسة على السيرفر فعلياً");
  assert.strictEqual(localStorageStore.has(chairmanKey), false, "مفتاح المسودة الصحيح (بالدور chairman) يجب أن يُمسح فعلياً بعد الإلغاء — هذا هو الإصلاح");
  assert.strictEqual(localStorageStore.has(memberKey), false, "مفتاح مسودة العضو (لو كان موجودًا) يُمسح أيضًا — الإلغاء يمحو كل ما سُجّل بغض النظر عن الدور");
  assert.strictEqual(participant.assessment, undefined, "participant.assessment يجب أن يُحذف بالكامل بعد الإلغاء");

  // محاكاة "البدء من جديد": مسودة محلية جديدة فاضية (كأن claimStudent أنشأ جلسة فارغة تمامًا) —
  // بما إنه المفتاح صار فاضيًا فعليًا الآن، لا يوجد أي مسودة قديمة يمكن أن "تُسترجع" بالغلط.
  const recovered = vm.runInContext(`JSON.parse(localStorage.getItem("${chairmanKey}") || "null")`, sandbox);
  assert.strictEqual(recovered, null, "لا يوجد أي مسودة قديمة عالقة يمكن استرجاعها بالغلط عند بدء اختبار جديد لنفس المتسابق");

  console.log("cancel-exam-clears-local-draft.test.js: نجح — إلغاء الاختبار يمسح فعليًا مسودة المتصفح المحلية (بمفتاحها الصحيح المتضمن للدور)، فلا يعود الاختبار الجديد لنفس الموضع/الأخطاء القديمة");
}

run().catch(error => { console.error("cancel-exam-clears-local-draft.test.js FAILED:", error.stack || error.message); process.exit(1); });
