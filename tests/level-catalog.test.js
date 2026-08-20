// اختبار آلي لمطابقة مستوى المتسابق (LEVEL_CATALOG) من ملفات Excel قديمة وحديثة —
// نقطة تكرر فيها الخطأ سابقاً (مستوى فارغ لملفات قديمة برقم فقط بلا اسم). شغّله بعد أي تعديل
// على LEVEL_CATALOG أو inferCompetitionLevel أو resolveParticipantLevelId:
//   node tests/level-catalog.test.js
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

const { inferCompetitionLevel } = sandbox;
const LEVEL_CATALOG = vm.runInContext("LEVEL_CATALOG", sandbox);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.log(`  ✗ ${name}\n    ${error.message}`); }
}

test("تسع مستويات بالضبط بدون تكرار أرقام أجزاء متضاربة", () => {
  assert.strictEqual(LEVEL_CATALOG.length, 9);
  const ids = new Set(LEVEL_CATALOG.map((l) => l.id));
  assert.strictEqual(ids.size, 9, "أرقام معرّفات مكررة داخل LEVEL_CATALOG");
});

test("ملف قديم: مستوى رقمي فقط بلا اسم (مثال: 15) يُطابَق بنجاح", () => {
  const result = inferCompetitionLevel({ "المستوى": "15" });
  assert.ok(result, "لم يُطابَق أي مستوى لعمود رقمي بسيط");
  assert.strictEqual(result.parts, 15);
});

test("اسم مستوى كامل مع مسافات فوضوية إضافية يُطابَق رغم ذلك", () => {
  const messy = LEVEL_CATALOG[0].label.split("").join(" ").replace(/\s+/g, "   ");
  const result = inferCompetitionLevel({ "المستوى": `   ${messy}   ` });
  assert.ok(result, "فشلت المطابقة رغم أن الاسم صحيح مع مسافات زائدة فقط");
  assert.strictEqual(result.label, LEVEL_CATALOG[0].label);
});

test("قيمة مستوى غير موجودة إطلاقاً ترجع null بدل مطابقة خاطئة", () => {
  const result = inferCompetitionLevel({ "المستوى": "مستوى غير موجود إطلاقاً 999" });
  assert.strictEqual(result, null);
});

console.log(`\n${passed} نجح، ${failed} فشل`);
if (failed > 0) process.exit(1);
