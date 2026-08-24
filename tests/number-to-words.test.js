// اختبار آلي لتحويل العلامة الرقمية إلى كتابة عربية صحيحة نحوياً (بطاقة الجمعية).
// شغّله بعد أي تعديل على numberToArabicWords:
//   node tests/number-to-words.test.js
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

const { numberToArabicWords } = sandbox;

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

test("صفر", () => assert.strictEqual(numberToArabicWords(0), "صفر"));
test("واحد", () => assert.strictEqual(numberToArabicWords(1), "واحد"));
test("اثنان", () => assert.strictEqual(numberToArabicWords(2), "اثنان"));
test("ثلاثة", () => assert.strictEqual(numberToArabicWords(3), "ثلاثة"));
test("خمسة عشر", () => assert.strictEqual(numberToArabicWords(15), "خمسة عشر"));
test("عشرون بالضبط", () => assert.strictEqual(numberToArabicWords(20), "عشرون"));
test("واحد وعشرون", () => assert.strictEqual(numberToArabicWords(21), "واحد وعشرون"));
test("سبعة وثمانون", () => assert.strictEqual(numberToArabicWords(87), "سبعة وثمانون"));
test("مئة بالضبط", () => assert.strictEqual(numberToArabicWords(100), "مئة"));
test("كسر نصف", () => assert.strictEqual(numberToArabicWords(87.5), "سبعة وثمانون ونصف"));
test("كسر ربع", () => assert.strictEqual(numberToArabicWords(75.25), "خمسة وسبعون وربع"));
test("كسر ثلاثة أرباع", () => assert.strictEqual(numberToArabicWords(90.75), "تسعون وثلاثة أرباع"));
test("عُشر واحد", () => assert.strictEqual(numberToArabicWords(45.1), "خمسة وأربعون وعُشر"));
test("عُشران (مثنى)", () => assert.strictEqual(numberToArabicWords(45.2), "خمسة وأربعون وعُشران"));
test("ثمانية أعشار (مثال العلامة الفعلي)", () => assert.strictEqual(numberToArabicWords(73.8), "ثلاثة وسبعون وثمانية أعشار"));
test("كسر بخانتين عشريتين ليس من مضاعفات العشر", () => assert.strictEqual(numberToArabicWords(73.85), "ثلاثة وسبعون وخمسة وثمانون من مئة"));
test("قيمة غير رقمية ترجع نصاً فارغاً", () => assert.strictEqual(numberToArabicWords(NaN), ""));

console.log(`\n${passed} نجح، ${failed} فشل`);
if (failed > 0) process.exit(1);
