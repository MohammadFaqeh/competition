// اختبار آلي لإصلاح خلل حقيقي واجهه المستخدم فعلياً: امتلاء حصة تخزين المتصفح (localStorage
// quota) كان يرمي استثناء "Failed to execute 'setItem' on 'Storage': ... exceeded the quota"
// من أول سطر بـsaveState() (وenterCloudContext عند تسجيل الدخول) — وبما إنه هذا الاستثناء لم
// يكن مُعالَجاً، كان يوقف تنفيذ الدالة بالكامل فورًا، فيمنع أي مزامنة سحابية لاحقة (queueStateSave)
// رغم أن Supabase نفسها بخير تمامًا — تظهر عندها "تعذر مزامنة/تعذر فتح البيانات المشتركة" ويصير
// المستخدم عالقاً بالكامل (حتى تسجيل الدخول يفشل). الإصلاح: safeSetItem تلتقط الاستثناء وتتابع
// (النسخة المحلية Cache ثانوي فقط بوضع cloud، لا تُفقَد أي بيانات حقيقية — المصدر الأصلي بالسحابة).
// شغّله: node tests/localstorage-quota-does-not-block-sync.test.js
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
  localStorage: {
    getItem: () => null,
    setItem: () => { throw new DOMException("Setting the value of 'annualQuranCompetition.v2' exceeded the quota.", "QuotaExceededError") },
    removeItem: () => {},
  },
  document: { readyState: "complete", addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" } },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

function run() {
  sandbox.__state = { config: { competitionName: "تجريبي" }, participants: [], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state; operationMode = 'cloud'; cloudEnabled = true;", sandbox);

  let queueStateSaveCalled = false;
  sandbox.window.CloudCompetition = {
    get context() { return { kind: "admin" } },
    queueStateSave: (state, onError) => { queueStateSaveCalled = true },
  };

  // قبل الإصلاح: هذا السطر كان يرمي استثناء (localStorage.setItem الحقيقي يرمي دائمًا هنا).
  assert.doesNotThrow(() => sandbox.saveState(), "saveState لا يجب أن ترمي استثناءً حتى لو فشل الحفظ المحلي بسبب امتلاء الحصة");

  assert.strictEqual(queueStateSaveCalled, true, "المزامنة السحابية (queueStateSave) يجب أن تُستدعى رغم فشل الحفظ المحلي — البيانات الحقيقية بالسحابة، لا يجوز أن يمنعها فشل الـCache الثانوي");

  console.log("localstorage-quota-does-not-block-sync.test.js: نجح — امتلاء حصة التخزين المحلي لم يعد يوقف المزامنة السحابية إطلاقاً");
}

try { run(); } catch (error) { console.error("localstorage-quota-does-not-block-sync.test.js FAILED:", error.stack || error.message); process.exit(1); }
