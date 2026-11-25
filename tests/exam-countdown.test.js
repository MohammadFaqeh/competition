// اختبار آلي لعدّاد «باقي X أيام على الاختبار» بشاشات الدخول (خيار للإدارة، 2026-11-25):
// حساب الأيام التقويمية بتوقيت الجهاز (بغض النظر عن الساعة)، صيغة العربي (يوم/يومان/أيام/يوماً)،
// يوم الاختبار نفسه «اليوم»، وبعده يختفي (null/سالب)، ورفض أي تاريخ بصيغة غير YYYY-MM-DD.
// شغّله: node tests/exam-countdown.test.js
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
  history: { pushState: () => {}, replaceState: () => {} },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout,
  clearTimeout,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });
const { examCountdownDaysLeft, examCountdownLabel } = sandbox;

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

// 1) أيام تقويمية: الساعة لا تغيّر النتيجة (آخر الليل وأول الصبح بنفس اليوم = نفس العدد)
assert.strictEqual(examCountdownDaysLeft("2026-12-20", at(2026, 12, 17, 0, 5)), 3);
assert.strictEqual(examCountdownDaysLeft("2026-12-20", at(2026, 12, 17, 23, 55)), 3);
// عبر نهاية شهر وسنة
assert.strictEqual(examCountdownDaysLeft("2027-01-02", at(2026, 12, 30)), 3);
// يوم الاختبار نفسه = 0، وبعده سالب
assert.strictEqual(examCountdownDaysLeft("2026-12-20", at(2026, 12, 20, 18)), 0);
assert.strictEqual(examCountdownDaysLeft("2026-12-20", at(2026, 12, 21, 8)), -1);

// 2) صيغة غير صالحة أو فارغة = null (العدّاد يبقى مخفياً)
for (const bad of ["", null, undefined, "20-12-2026", "2026/12/20", "2026-12-20T00:00", "<b>"]) {
  assert.strictEqual(examCountdownDaysLeft(bad, at(2026, 12, 1)), null, `يجب رفض ${bad}`);
}

// 3) الصياغة العربية
assert.strictEqual(examCountdownLabel(0), "اليوم يوم الاختبار — بالتوفيق");
assert.strictEqual(examCountdownLabel(1), "باقي يوم واحد على الاختبار");
assert.strictEqual(examCountdownLabel(2), "باقي يومان على الاختبار");
assert.strictEqual(examCountdownLabel(3), "باقي 3 أيام على الاختبار");
assert.strictEqual(examCountdownLabel(10), "باقي 10 أيام على الاختبار");
assert.strictEqual(examCountdownLabel(11), "باقي 11 يوماً على الاختبار");
assert.strictEqual(examCountdownLabel(45), "باقي 45 يوماً على الاختبار");
// بعد الاختبار أو بلا تاريخ: لا نص
assert.strictEqual(examCountdownLabel(-1), "");
assert.strictEqual(examCountdownLabel(null), "");

console.log("exam-countdown: all assertions passed");
