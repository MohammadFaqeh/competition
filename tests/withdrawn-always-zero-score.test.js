// اختبار آلي: الانسحاب أقوى من أي علامة — طلب صريح من المستخدم بعد ظهور طالبات "منسحبات" بعلامة 100
// (اعتُمد اختبارهن ثم سُجّلن منسحبات، فكانت مزامنة جلسات اللجان ترجّع 100 فوق الصفر). المنسحب علامته
// صفر دائماً: المزامنة لا ترجّع علامة الجلسة، والسجلات المتضررة سابقاً تُصفَّر تلقائياً.
// شغّله: node tests/withdrawn-always-zero-score.test.js
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
  // 1) مزامنة جلسات اللجان (جانب الإدارة): جلسة final بعلامة 100 لا ترجع فوق انسحاب مسجَّل.
  sandbox.__state = {
    config: {}, resets: [], deletions: [], draws: [],
    participants: [
      { id: "p-a", name: "منسحبة بعد الاعتماد", withdrawn: true, score: 0, scoreSource: "withdrawn" },
      { id: "p-b", name: "سجل قديم متضرر", withdrawn: true, score: 100, scoreSource: "electronic", assessment: { status: "final" } },
      { id: "p-c", name: "غير منسحبة", withdrawn: false },
    ],
  };
  vm.runInContext("state = __state; committeeSessions = [];", sandbox);
  const sessions = ["p-a", "p-b", "p-c"].map((id, i) => ({ id: "s" + i, participant_id: id, committee_id: "c1", status: "final", score: 100, assessment: {}, updated_at: "2026-09-01T00:00:00.000Z", finalized_at: "2026-09-01T00:00:00.000Z" }));
  sandbox.window.CloudCompetition = { get context() { return { kind: "admin" } } };
  sandbox.mergeFinalSessionsIntoState(sessions, [{ id: "c1", name: "لجنة 1" }]);
  const byId = id => sandbox.__state.participants.find(p => p.id === id);
  assert.strictEqual(byId("p-a").score, 0, "المنسحبة تبقى علامتها صفر رغم جلسة final بعلامة 100");
  assert.strictEqual(byId("p-b").score, 0, "سجل منسحب متضرر (علامة 100) يُصفَّر تلقائياً");
  assert.strictEqual(byId("p-b").scoreSource, "withdrawn");
  assert.strictEqual(byId("p-b").assessment, null);
  assert.strictEqual(byId("p-c").score, 100, "غير المنسحبة تأخذ علامة جلستها كالمعتاد");
  assert.strictEqual(sandbox.passRateOf(sandbox.__state.participants), 100, "المنسحبات لا يدخلن نسبة النجاح (الممتحنة الوحيدة p-c)");

  // 2) قائمة متسابقي اللجنة: منسحبة بعلامة حقيقية تظهر "منسحب · العلامة 0" ولا تُحسب مكتملة.
  const committee = { id: "c1", show_score: true, examiner_role: "chairman" };
  sandbox.window.CloudCompetition = { get context() { return { kind: "committee", committee } } };
  sandbox.__state = {
    config: {}, resets: [], deletions: [],
    participants: [{ id: "p-tested", name: "اختبرت ثم انسحبت", seat: "1", center: "مركز", level: 3, score: 77, scoreSource: "electronic", withdrawn: true }],
    draws: [{ id: "d1", participantId: "p-tested", positions: [{ id: "pos1" }] }],
  };
  vm.runInContext("state = __state; committeeSessions = [{id:'sess-1',participant_id:'p-tested',status:'final',score:77}];", sandbox);
  queryElement("#committeeStatusFilter").value = "all";
  queryElement("#committeeCenterFilter").value = "all";
  sandbox.renderCommitteeStudents();
  assert.strictEqual(vm.runInContext('document.querySelector("#committeeCompletedCount").textContent', sandbox), "0", "المنسحبة لا تُحسب ضمن (مكتمل)");
  const html = vm.runInContext('document.querySelector("#committeeStudents").innerHTML', sandbox);
  assert.ok(html.includes("منسحب · العلامة 0") && !html.includes("77"), "بطاقة المنسحبة تعرض العلامة 0 لا 77");

  console.log("withdrawn-always-zero-score.test.js: نجح — الانسحاب يفرض علامة صفر دائماً (مزامنة الإدارة + قائمة اللجنة)");
}

try { run(); } catch (error) { console.error("withdrawn-always-zero-score.test.js FAILED:", error.stack || error.message); process.exit(1); }
