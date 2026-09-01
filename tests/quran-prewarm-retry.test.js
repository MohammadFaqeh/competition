// اختبار آلي: تحميل بيانات القرآن بالخلفية (prewarmQuranData) كان يحاول مرة وحدة بصمت،
// فلو فشلت (شبكة ضعيفة/متقطعة — تكررت عند أكثر من لجنة) ما كانت تُعاد المحاولة أبدًا إلا لما
// يضغط المستخدم "بدء الاختبار" فعليًا فتظهر رسالة خطأ بلحظة الحاجة. الإصلاح: إعادة محاولة
// تلقائية بالخلفية كل 20 ثانية لحد ما تنجح، دون أي تدخل من المستخدم.
// شغّله: node tests/quran-prewarm-retry.test.js
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

let scheduled = [];
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
  // نلتقط جدولة إعادة المحاولة (setTimeout(attempt,20000)) بدل الانتظار 20 ثانية فعلية —
  // نطلقها يدويًا بالاختبار لمحاكاة مرور الوقت فورًا.
  setTimeout: (fn, ms) => { const id = scheduled.length; scheduled.push({ fn, ms }); return id; },
  clearTimeout: () => {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

async function run() {
  let callCount = 0;
  // نستبدل ensureQuranReady الحقيقية (اللي بتحتاج شبكة فعلية وبيانات قرآن كاملة) بمحاكاة:
  // تفشل أول مرتين (شبكة ضعيفة)، وتنجح بالثالثة (رجعت الشبكة).
  sandbox.ensureQuranReady = () => {
    callCount++;
    if (callCount <= 2) return Promise.reject(new Error("تعذر تحميل بيانات أسطر المصحف: Failed to fetch"));
    return Promise.resolve(["candidate"]);
  };

  sandbox.prewarmQuranData();
  await Promise.resolve().then(() => {}).then(() => {}); // ننتظر microtask الأولى تنفّذ ensureQuranReady وتفشل
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(callCount, 1, "المحاولة الأولى تصير فورًا عند الاستدعاء");
  assert.strictEqual(scheduled.length, 1, "بعد الفشل الأول، لازم تنجدول محاولة تانية (لا تتوقف بصمت وتسكت)");
  assert.strictEqual(scheduled[0].ms, 20000, "فترة إعادة المحاولة 20 ثانية بالضبط");

  // نطلق إعادة المحاولة المجدولة يدويًا (تمثيل مرور 20 ثانية)
  scheduled[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(callCount, 2, "لازم تصير محاولة ثانية تلقائيًا بدون أي تدخل من المستخدم");
  assert.strictEqual(scheduled.length, 2, "الفشل الثاني برضو لازم يجدول محاولة ثالثة");

  scheduled[1].fn();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(callCount, 3, "المحاولة الثالثة تنجح");
  assert.strictEqual(scheduled.length, 2, "بعد النجاح، ما لازم تنجدول أي محاولة رابعة — يتوقف الحلقة");

  // استدعاء prewarmQuranData مجددًا بعد النجاح يجب أن يكون بلا أثر (لا يعيد التحميل من الصفر)
  // — نحاكي هون بالضبط شو بيصير بالواقع: ensureQuranReady الحقيقية عند نجاحها تحدّث
  // المتغيرين integrity/candidates على مستوى الملف، وهذا بالضبط ما يقرأه الفحص الأول
  // بداخل prewarmQuranData ليقرر تجاهل أي استدعاء لاحق.
  vm.runInContext("integrity={valid:true};candidates=['x']", sandbox);
  sandbox.prewarmQuranData();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(callCount, 3, "بعد النجاح، استدعاء prewarmQuranData مجددًا لا يستدعي ensureQuranReady من جديد بلا داع");

  console.log("quran-prewarm-retry.test.js: كل الحالات نجحت — إعادة المحاولة بالخلفية تلقائية كل 20 ثانية حتى النجاح، وتتوقف بعده");
}

run().catch((error) => {
  console.error("quran-prewarm-retry.test.js FAILED:", error.message);
  process.exit(1);
});
