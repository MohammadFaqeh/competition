// اختبار آلي لسقف أخطاء التجويد: 10 أخطاء كحد أقصى مجموعة على كل مواضع نفس الطالب، لكل
// ممتحِن على حدة (الرئيس والعضو كل واحد بمجموعه الخاص) — بعدها زر "+" ما بيزيد أكتر.
// شغّله: node tests/tajweed-cap.test.js
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

const { tajweedTotalOf } = sandbox;
const TAJWEED_ERROR_CAP = vm.runInContext("TAJWEED_ERROR_CAP", sandbox);
assert.strictEqual(TAJWEED_ERROR_CAP, 10, "السقف الثابت المتفق عليه هو 10 أخطاء بالضبط");

// نفس منطق معالج الضغط بـ openElectronicAssessment (app.js): يمنع "+" فقط لما يكون المجموع
// الحالي عبر كل المواضع >= السقف، ويسمح دائمًا بالتنقيص.
function attemptTajweedIncrement(assessment, positionIndex) {
  const position = assessment.positions[positionIndex];
  const before = Number(position.tajweed) || 0;
  if (tajweedTotalOf(assessment) >= TAJWEED_ERROR_CAP) return { blocked: true, value: before };
  position.tajweed = before + 1;
  return { blocked: false, value: position.tajweed };
}

// موزّع على مواضع متعددة لنفس الطالب — السقف على المجموع الكلي، لا على موضع واحد.
const assessment = { positions: Array.from({ length: 5 }, () => ({ tajweed: 0 })) };
for (let i = 0; i < 5; i++) attemptTajweedIncrement(assessment, 0); // 5 أخطاء بالموضع الأول
for (let i = 0; i < 4; i++) attemptTajweedIncrement(assessment, 1); // 4 أخطاء بالموضع الثاني
assert.strictEqual(tajweedTotalOf(assessment), 9, "المجموع بعد 5+4 = 9، لسا تحت السقف");

const tenth = attemptTajweedIncrement(assessment, 2); // الخطأ العاشر، بموضع ثالث مختلف
assert.strictEqual(tenth.blocked, false, "الخطأ العاشر بالضبط مسموح (الحد <=10 وليس <10)");
assert.strictEqual(tajweedTotalOf(assessment), 10, "المجموع الآن 10 بالضبط");

const eleventh = attemptTajweedIncrement(assessment, 3); // محاولة خطأ حادي عشر بموضع رابع
assert.strictEqual(eleventh.blocked, true, "الخطأ الحادي عشر يجب أن يُمنع أينما كان موضعه");
assert.strictEqual(tajweedTotalOf(assessment), 10, "المجموع يبقى 10 ولا يتجاوزه إطلاقًا");

// التنقيص يبقى مسموحًا دائمًا حتى بعد بلوغ السقف (تصحيح غلطة).
assessment.positions[2].tajweed = Math.max(0, (Number(assessment.positions[2].tajweed) || 0) - 1);
assert.strictEqual(tajweedTotalOf(assessment), 9, "التنقيص يشتغل طبيعي حتى عند السقف");

// السقف لكل ممتحِن لحاله: تقييم مستقل تمامًا (positions منفصلة) يبدأ من الصفر ولا يتأثر
// بمجموع الممتحِن الآخر لنفس الطالب.
const otherExaminerAssessment = { positions: Array.from({ length: 3 }, () => ({ tajweed: 0 })) };
const firstForOther = attemptTajweedIncrement(otherExaminerAssessment, 0);
assert.strictEqual(firstForOther.blocked, false, "ممتحِن آخر (رئيس أو عضو) يبدأ من صفر بغض النظر عن سقف الممتحِن الأول");

console.log("tajweed-cap.test.js: كل الحالات نجحت — سقف 10 أخطاء تجويد يُطبَّق على مجموع كل مواضع الطالب، ويُمنع بدقة عند تجاوزه");
