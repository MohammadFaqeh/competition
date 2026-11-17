// اختبار آلي: «ملف للمراكز» بديوان الحفاظ — الأعمدة (بلا علامة، النتيجة بدلها، أجزاء سابقة للعلم، أجزاء قادمة فارغة)،
// والاستيراد يقرأ «أجزاء الاختبار القادم» ولا يقرأ «أجزاء الاختبار السابق» أبداً.
// شغّله: node tests/diwan-centers-file.test.js
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

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
async function run() {
  const sheets = [];
  sandbox.XLSX = { utils: { book_new: () => ({}), json_to_sheet: r => { sheets.push(r); return {} }, aoa_to_sheet: r => { sheets.push(r); return {} }, book_append_sheet() {} }, writeFile(wb, name) { sandbox.__fileName = name } };
  sandbox.__diwan = { config: {}, participants: [
    { id: "a", name: "سلمى", seat: "1", serialNumber: "S1", gender: "أنثى", center: "النور", stage: 2, parts: [], usedJuz: range(1, 10), score: 95, assessment: {}, lastGradedDrawId: "d1" },
    { id: "b", name: "ريم", seat: "2", serialNumber: "S2", gender: "أنثى", center: "النور", stage: 1, parts: range(11, 20), usedJuz: [], score: 70, assessment: {}, lastGradedDrawId: "d2" },
    { id: "c", name: "هدى", seat: "3", serialNumber: "S3", gender: "أنثى", center: "الهدى", stage: 1, parts: [], usedJuz: [], withdrawn: true, score: 0 },
    { id: "d", name: "منى", seat: "4", serialNumber: "S4", gender: "أنثى", center: "الهدى", stage: 1, parts: range(21, 30), usedJuz: [] },
    { id: "e", name: "حافظة", seat: "5", serialNumber: "S5", gender: "أنثى", stage: 4, certified: true, usedJuz: range(1, 30), score: 99, assessment: {} },
    { id: "f", name: "نهائي", seat: "6", serialNumber: "S6", gender: "أنثى", stage: 4, parts: [], usedJuz: range(1, 30) },
  ], draws: [
    { id: "d1", participantId: "a", stage: 1, eligibleParts: range(1, 10), createdAt: "2026-11-01T09:00:00Z" },
    { id: "d2", participantId: "b", stage: 1, eligibleParts: range(11, 20), createdAt: "2026-11-01T09:00:00Z" },
  ] };
  vm.runInContext("toast=()=>{};diwanState=__diwan;diwanAdminSessions=[];", sandbox);
  await sandbox.exportDiwanCentersFile();
  const rows = sheets[0];
  assert.strictEqual(Object.keys(rows[0]).join("|"), "رقم الجلوس|الرقم التسلسلي|الاسم|الجنس|المركز|الاختبار القادم|النتيجة|أجزاء الاختبار السابق|أجزاء الاختبار القادم", "ترتيب الأعمدة");
  assert.ok(!rows.some(r => "آخر علامة" in r), "لا علامات");
  assert.strictEqual(rows.length, 5, "الحافظ المعتمد لا يُدرج");
  const by = Object.fromEntries(rows.map(r => [r["الاسم"], r]));
  assert.strictEqual(by["سلمى"]["الاختبار القادم"], "الاختبار الثاني");
  assert.strictEqual(by["سلمى"]["النتيجة"], "ناجح");
  assert.strictEqual(by["سلمى"]["أجزاء الاختبار السابق"], range(1, 10).join("، "));
  assert.strictEqual(by["سلمى"]["أجزاء الاختبار القادم"], "", "الناجح: القادمة فارغة");
  assert.strictEqual(by["ريم"]["النتيجة"], "راسب");
  assert.strictEqual(by["ريم"]["أجزاء الاختبار القادم"], "", "الراسب: القادمة فارغة (لا تُنسخ أجزاء رسوبه)");
  assert.strictEqual(by["هدى"]["الاختبار القادم"], "الاختبار الأول (منسحب)");
  assert.strictEqual(by["هدى"]["النتيجة"], "منسحب");
  assert.strictEqual(by["منى"]["أجزاء الاختبار القادم"], range(21, 30).join("، "), "مسجَّلة لم تُختبر: تبقى أجزاؤها");
  assert.strictEqual(by["منى"]["النتيجة"], "");
  assert.strictEqual(by["نهائي"]["أجزاء الاختبار القادم"], "القرآن كاملاً (تلقائي)");
  assert.ok(/ملف-المراكز/.test(sandbox.__fileName));
  // الاستيراد: عمود القادمة مقروء، والسابقة ليست ضمن أسماء أعمدة الأجزاء.
  const nh = sandbox.normalizeHeader;
  const row = { [nh("أجزاء الاختبار السابق")]: "1-10", [nh("أجزاء الاختبار القادم")]: "11-20" };
  const partsNames = ["اجزاءالاختبارالقادم", "الاجزاءالمشاركة", "الأجزاءالمشاركة", "ارقامالاجزاء", "أرقامالأجزاء", "الاجزاء", "الأجزاء", "parts"];
  assert.strictEqual(sandbox.pickColumn(row, partsNames), "11-20", "الاستيراد يقرأ أجزاء الاختبار القادم");
  assert.strictEqual(sandbox.pickColumn({ [nh("أجزاء الاختبار السابق")]: "1-10" }, partsNames), "", "ولا يقرأ أجزاء الاختبار السابق");
  const src = require("fs").readFileSync(require("path").join(projectRoot, "app.js"), "utf8");
  assert.ok(/async function importDiwanExcel[\s\S]*?pickColumn\(row,\["اجزاءالاختبارالقادم"/.test(src), "قائمة أعمدة الأجزاء باستيراد الديوان تتضمن الاسم الجديد");
  console.log("diwan-centers-file.test.js: نجح — أعمدة ملف المراكز صحيحة، والاستيراد يقرأ القادمة فقط");
}
run().catch(error => { console.error("diwan-centers-file.test.js FAILED:", error.stack || error.message); process.exit(1); });
