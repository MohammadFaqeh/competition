// اختبار آلي لتفضيل "تحديث تلقائي مباشر" الجديد: طلب صريح من المستخدم بعدم إرسال أي استطلاع
// دوري (كل 9 ثوانٍ) تلقائياً إطلاقاً إلا إذا فعّله بنفسه (تفضيل محلي بهذا الجهاز فقط، لا يُزامَن
// للسحابة) — الافتراضي معطّل حتى لا يستهلك داتا/رام بأيام لا امتحان فيها. زر التحديث اليدوي يبقى
// متاحاً دائماً بمعزل عن هذا التفضيل (لا علاقة له بـstartAdminAutoRefresh).
// شغّله: node tests/live-autorefresh-toggle.test.js
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

function makeStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

function run() {
  let intervalCalls = 0, clearedCount = 0;
  const localStorage = makeStorage();
  const sandbox = {
    console, localStorage,
    document: { hidden: false },
    window: {},
    setInterval: () => { intervalCalls++; return intervalCalls },
    clearInterval: () => { clearedCount++ },
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appSrc, sandbox, { filename: "app.js" });

  // 1) بلا أي تفضيل محفوظ سابقاً (جهاز جديد تماماً): يجب ألا يبدأ أي استطلاع دوري إطلاقاً
  sandbox.startAdminAutoRefresh();
  assert.strictEqual(intervalCalls, 0, "افتراضياً (بلا تفعيل صريح من المستخدم) يجب ألا يبدأ أي استطلاع دوري تلقائي");
  assert.strictEqual(vm.runInContext("adminAutoRefreshTimer", sandbox), null, "adminAutoRefreshTimer يجب أن يبقى null افتراضياً");

  // 2) بعد تفعيل المستخدم صراحة (محاكاة تبديل المفتاح): يجب أن يبدأ الاستطلاع فعلياً
  localStorage.setItem("competition-live-autorefresh", "on");
  sandbox.startAdminAutoRefresh();
  assert.strictEqual(intervalCalls, 1, "بعد التفعيل الصريح يجب أن يبدأ الاستطلاع الدوري فعلياً");

  // 3) تعطيله لاحقاً: يجب أن يتوقف الاستطلاع ولا يُعاد جدولته
  localStorage.setItem("competition-live-autorefresh", "off");
  sandbox.startAdminAutoRefresh();
  assert.strictEqual(intervalCalls, 1, "بعد التعطيل يجب ألا يُجدوَل أي استطلاع جديد");
  assert.ok(clearedCount >= 1, "يجب إيقاف أي مؤقّت سابق كان يعمل عند إعادة النداء");

  console.log("live-autorefresh-toggle.test.js: نجح — الاستطلاع الدوري معطّل افتراضياً ولا يعمل إلا بتفعيل صريح من المستخدم لهذا الجهاز");
}

try {
  run();
} catch (error) {
  console.error("live-autorefresh-toggle.test.js FAILED:", error.stack || error.message);
  process.exit(1);
}
