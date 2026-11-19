// اختبار آلي: فلتر «تاريخ الاختبار» بديوان الحفاظ — قائمة الأيام وصفوف من امتحن بيوم معيّن.
// شغّله: node tests/diwan-exam-day-filter.test.js
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

// ===== فلتر «تاريخ الاختبار» (طلب الإدارة 2026-11-19): تنزيل كل ما يخص من امتحن يوماً معيّناً =====
const pad = n => String(n).padStart(2, "0");
const now = new Date(), yesterday = new Date(now.getTime() - 864e5);
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0).toISOString();
const today = dayOf(now), past = dayOf(yesterday);

const mk = (id, name, center, extra = {}) => ({ id, name, gender: "أنثى", center, seat: id, serialNumber: `ث/2026/${id}`, stage: 1, parts: [], usedJuz: [], ...extra });
const a = mk("1", "ناجحة اليوم", "حذيفة"), b = mk("2", "راسبة اليوم", "الأشرفية"), c = mk("3", "راسبة أمس", "حذيفة"), d = mk("4", "لم تمتحن", "حذيفة");
const range = (x, y) => Array.from({ length: y - x + 1 }, (_, i) => x + i);
sandbox.__diwan = { config: {}, participants: [a, b, c, d], draws: [
  { id: "dA", participantId: "1", stage: 1, eligibleParts: range(1, 10), createdAt: at(now, 8) },
  { id: "dB", participantId: "2", stage: 1, eligibleParts: range(11, 20), createdAt: at(now, 8) },
  { id: "dC", participantId: "3", stage: 1, eligibleParts: range(1, 10), createdAt: at(yesterday, 8) },
  { id: "dD", participantId: "4", stage: 1, eligibleParts: range(1, 10), createdAt: at(now, 8) },
] };
sandbox.__sessions = [
  { id: "sA", participant_id: "1", draw_id: "dA", committee_id: "c9", stage: 1, status: "final", score: 95, assessment: {}, finalized_at: at(now, 10) },
  { id: "sB", participant_id: "2", draw_id: "dB", committee_id: "c5", stage: 1, status: "final", score: 70, assessment: {}, finalized_at: at(now, 11) },
  { id: "sC", participant_id: "3", draw_id: "dC", committee_id: "c5", stage: 1, status: "final", score: 80, assessment: {}, finalized_at: at(yesterday, 10) },
  { id: "sD", participant_id: "4", draw_id: "dD", committee_id: "c5", stage: 1, status: "in_progress", score: null, assessment: {}, started_at: at(now, 11) },
];
vm.runInContext("diwanState=__diwan;diwanAdminSessions=__sessions;cloudCommittees=[{id:'c9',name:'لجنة رقم 9'},{id:'c5',name:'لجنة رقم 5'}];", sandbox);

assert.strictEqual(sandbox.diwanSessionDay(sandbox.__sessions[0]), today, "يوم الاعتماد بالتوقيت المحلي");
assert.strictEqual(sandbox.diwanSessionDay(sandbox.__sessions[3]), "", "الجلسة الجارية بلا يوم");

const html = sandbox.diwanExamDayOptionsHtml(sandbox.diwanExamDaySessions());
const values = [...html.matchAll(/value="([^"]+)"/g)].map(m => m[1]);
assert.deepStrictEqual(values, ["all", today, past], "الخيارات: الكل ثم الأيام التي فيها نتائج، الأحدث أولاً");
assert.ok(/اليوم —[^<]*\(2\)/.test(html), "اليوم باسمه وبعدد من امتحن: " + html);

const rows = sandbox.diwanDayResultRows(today);
assert.deepStrictEqual(rows.map(r => r.row["اسم المتسابق"]), ["راسبة اليوم", "ناجحة اليوم"], "من امتحن اليوم فقط (مرتب بالمركز)");
const passRow = rows.find(r => r.p.id === "1").row;
assert.strictEqual(passRow["اللجنة"], "لجنة رقم 9", "لجنة الاختبار نفسه");
assert.strictEqual(passRow["العلامة"], 95);
assert.ok(passRow["النتيجة"].startsWith("ناجح"));
assert.strictEqual(passRow["الأجزاء"], range(1, 10).join("، "));
assert.strictEqual(rows.find(r => r.p.id === "2").row["النتيجة"], "راسب");
assert.deepStrictEqual(sandbox.diwanDayResultRows(past).map(r => r.p.id), ["3"], "يوم سابق يعطي نتائجه فقط");

console.log("diwan-exam-day-filter.test.js: نجح — أيام الاختبار من نتائج معتمدة فقط، واليوم أولاً، وتصدير من امتحن بيوم معيّن");
