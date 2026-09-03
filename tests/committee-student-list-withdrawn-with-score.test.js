// اختبار آلي مكمّل: نفس معيار "ممتحن" الموحّد (علامة حقيقية > صفر، بغض النظر عن withdrawn) يجب أن
// ينعكس أيضاً بقائمة متسابقي اللجنة نفسها (renderCommitteeStudents) — لا فقط بدائرة نسبة النجاح
// ولوحة الإدارة. قبل هذا الإصلاح: خانة "مكتمل" أسفل الشاشة كانت تستبعد كل منسحب دون تمييز، وبطاقة
// المتسابق كانت تعرض "منسحب · العلامة 0" حتى لو كانت علامتها الحقيقية أعلى من صفر.
// شغّله: node tests/committee-student-list-withdrawn-with-score.test.js
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

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    readyState: "complete", hidden: false, addEventListener() {},
    querySelector: (sel) => queryElement(sel), querySelectorAll: () => [],
    documentElement: { lang: "ar", dir: "rtl" }, body: makeElement(),
  },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
  lucide: { createIcons() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

function run() {
  const committee = { id: "c1", show_score: true, examiner_role: "chairman" };
  sandbox.window.CloudCompetition = { get context() { return { kind: "committee", committee } } };

  const participantWithdrawnRealScore = { id: "p-tested", name: "اختبرت ثم انسحبت", seat: "1", center: "مركز", level: 3, score: 77, scoreSource: "electronic", withdrawn: true };
  const participantWithdrawnNoTest = { id: "p-ghost", name: "منسحبة بلا اختبار", seat: "2", center: "مركز", level: 3, score: 0, scoreSource: "withdrawn", withdrawn: true };

  sandbox.__state = {
    config: {}, resets: [], deletions: [],
    participants: [participantWithdrawnRealScore, participantWithdrawnNoTest],
    draws: [{ id: "d1", participantId: "p-tested", positions: [{ id: "pos1" }] }],
  };
  vm.runInContext("state = __state; committeeSessions = [{id:'sess-1',participant_id:'p-tested',status:'final',score:77}];", sandbox);
  queryElement("#committeeStatusFilter").value = "all";
  queryElement("#committeeCenterFilter").value = "all";

  sandbox.renderCommitteeStudents();

  const completedCount = vm.runInContext('document.querySelector("#committeeCompletedCount").textContent', sandbox);
  assert.strictEqual(completedCount, "1", "خانة (مكتمل) يجب أن تحسب المتسابقة التي اختبرت فعلياً (علامة 77) رغم انسحابها لاحقاً، لا أن تستبعدها لمجرد withdrawn=true");

  const studentsHtml = vm.runInContext('document.querySelector("#committeeStudents").innerHTML', sandbox);
  assert.ok(studentsHtml.includes("مكتمل (منسحب لاحقاً) · 77"), "بطاقة المتسابقة صاحبة العلامة الحقيقية يجب أن تعرض علامتها الفعلية (77)، لا \"العلامة 0\"");
  assert.ok(studentsHtml.includes("منسحب · العلامة 0"), "بطاقة المنسحبة فعلياً بلا اختبار حقيقي تبقى كما كانت تماماً: \"منسحب · العلامة 0\"");

  console.log("committee-student-list-withdrawn-with-score.test.js: نجح — قائمة متسابقي اللجنة (خانة مكتمل + نص الحالة) تعكس نفس معيار \"ممتحن\" الموحّد (علامة حقيقية > صفر)، متسقة الآن مع دائرة نسبة النجاح المجاورة بنفس الشاشة");
}

try { run(); } catch (error) { console.error("committee-student-list-withdrawn-with-score.test.js FAILED:", error.stack || error.message); process.exit(1); }
