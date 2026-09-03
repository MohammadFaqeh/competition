// اختبار آلي مكمّل: حتى لو بقيت جلسة "شبح" لمتسابقة منسحبة عالقة بـcommitteeSessions لأي سبب
// (سباق توقيت، أو قبل ما يلحق الاستطلاع الدوري يستبعدها)، renderCommitteePassRate نفسها يجب أن
// تستبعدها صراحةً من "عدد الممتحنين/الناجحين/الراسبين" — طبقة حماية إضافية بنفس منطق عمود "مكتمل"
// بقائمة المتسابقين (الذي يستبعد withdrawn منذ البداية أصلاً).
// شغّله: node tests/committee-pass-rate-excludes-withdrawn.test.js
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

  // جلستان final حقيقيتان: p1 باقية (ناجحة، 80)، p2 منسحبة لاحقاً لكن جلستها "الشبح" لسا بالذاكرة.
  sandbox.__committeeSessions = [
    { id: "sess-1", participant_id: "p1", committee_id: "c1", status: "final", score: 80 },
    { id: "sess-2", participant_id: "p2", committee_id: "c1", status: "final", score: 91 },
  ];
  vm.runInContext("committeeSessions = __committeeSessions;", sandbox);
  sandbox.__state = { config: {}, participants: [{ id: "p1", withdrawn: false }, { id: "p2", withdrawn: true }], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state;", sandbox);

  sandbox.renderCommitteePassRate(committee);
  const examinedCount = vm.runInContext('document.querySelector("#committeeExaminedCount").textContent', sandbox);
  const passedCount = vm.runInContext('document.querySelector("#committeePassedCount").textContent', sandbox);

  assert.strictEqual(examinedCount, "1", "جلسة المتسابقة المنسحبة (p2) يجب أن تُستبعد من عدد الممتحنين رغم بقائها بـcommitteeSessions كشبح");
  assert.strictEqual(passedCount, "1", "الناجحون يجب أن يُحسبوا فقط من غير المنسحبات (p1)");

  console.log("committee-pass-rate-excludes-withdrawn.test.js: نجح — دائرة نسبة النجاح تستبعد جلسات المتسابقات المنسحبات حتى لو بقيت عالقة بالذاكرة المحلية");
}

try { run(); } catch (error) { console.error("committee-pass-rate-excludes-withdrawn.test.js FAILED:", error.stack || error.message); process.exit(1); }
