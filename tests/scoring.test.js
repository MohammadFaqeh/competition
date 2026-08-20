// اختبار آلي لمنطق احتساب العلامة والخصومات — الجزء الأكثر حساسية بالمشروع لأنه
// يقرر نجاح أو رسوب متسابق حقيقي. شغّله بعد أي تعديل على قواعد التقييم:
//   node tests/scoring.test.js
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

// دوال function تُضاف لكائن sandbox تلقائياً، أما const/let على مستوى الملف فلا تُضاف —
// لذلك نقرأ الثوابت عبر vm.runInContext صراحةً.
const { calculateAssessment, calculateFinalAssessment, positionsDiffer } = sandbox;
const PASS_SCORE = vm.runInContext("PASS_SCORE", sandbox);
const ASSESSMENT_RULES = vm.runInContext("ASSESSMENT_RULES", sandbox);

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
function emptyPosition(overrides = {}) {
  return { positionId: "P1", memorization: 0, language: 0, tajweed: 0, hesitation: 0, positionChange: 0, note: "", completed: true, ...overrides };
}

console.log("PASS_SCORE =", PASS_SCORE);
console.log("ASSESSMENT_RULES =", JSON.stringify(ASSESSMENT_RULES));

test("بلا أي أخطاء => العلامة 100 وناجح", () => {
  const r = calculateAssessment({ positions: [emptyPosition(), emptyPosition()] });
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.passed, true);
});

test("خطأ تجويد واحد => خصم علامة واحدة بالضبط", () => {
  const r = calculateAssessment({ positions: [emptyPosition({ tajweed: 1 })] });
  assert.strictEqual(r.deductions.tajweed, ASSESSMENT_RULES.tajweed.deduction);
  assert.strictEqual(r.score, 100 - ASSESSMENT_RULES.tajweed.deduction);
});

test("تراكم كل أنواع الأخطاء يساوي مجموعها بدقة", () => {
  const r = calculateAssessment({ positions: [emptyPosition({ memorization: 1, language: 1, tajweed: 1, hesitation: 5, positionChange: 1 })] });
  const expectedDeduction = ASSESSMENT_RULES.memorization.deduction + ASSESSMENT_RULES.language.deduction +
    ASSESSMENT_RULES.tajweed.deduction + ASSESSMENT_RULES.hesitation.deduction * 5 + ASSESSMENT_RULES.positionChange.deduction;
  assert.strictEqual(r.totalDeduction, Math.round(expectedDeduction * 100) / 100);
  assert.strictEqual(r.score, Math.max(0, Math.round((100 - expectedDeduction) * 100) / 100));
});

test("العلامة لا تنزل عن صفر مهما كثرت الأخطاء", () => {
  const r = calculateAssessment({ positions: [emptyPosition({ memorization: 999, language: 999 })] });
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.passed, false);
});

test("حد النجاح: العلامة = 75 بالضبط تُعتبر ناجحة", () => {
  // 100 - (12.5 * 2 خطأ حفظ) = 75
  const r = calculateAssessment({ positions: [emptyPosition({ memorization: 12.5 })] });
  assert.strictEqual(r.score, 75);
  assert.strictEqual(r.passed, true);
});

test("أقل من حد النجاح بقليل => راسب", () => {
  const r = calculateAssessment({ positions: [emptyPosition({ memorization: 12.6 })] });
  assert.ok(r.score < 75);
  assert.strictEqual(r.passed, false);
});

test("positionsDiffer: يرصد اختلاف نوع خطأ واحد فقط", () => {
  const own = emptyPosition({ tajweed: 2 });
  const memberSame = emptyPosition({ tajweed: 2 });
  const memberDiff = emptyPosition({ tajweed: 3 });
  assert.strictEqual(positionsDiffer(own, memberSame), false);
  assert.strictEqual(positionsDiffer(own, memberDiff), true);
});

test("calculateFinalAssessment: العدد المعتمد يطغى على رصد الرئيس الخام لهذا النوع فقط", () => {
  const position = emptyPosition({ tajweed: 3, hesitation: 2, adopted: { tajweed: 1 } });
  const r = calculateFinalAssessment({ positions: [position] });
  // tajweed معتمد=1 (لا 3)، hesitation بلا اعتماد فيرجع لقيمة الرئيس الخام=2
  const expected = 1 * ASSESSMENT_RULES.tajweed.deduction + 2 * ASSESSMENT_RULES.hesitation.deduction;
  assert.strictEqual(r.totalDeduction, Math.round(expected * 100) / 100);
});

test("calculateFinalAssessment بلا أي اعتماد يساوي الحساب الخام للرئيس", () => {
  const position = emptyPosition({ memorization: 1, tajweed: 2 });
  const raw = calculateAssessment({ positions: [position] });
  const final = calculateFinalAssessment({ positions: [position] });
  assert.strictEqual(final.score, raw.score);
});

console.log(`\n${passed} نجح، ${failed} فشل`);
if (failed > 0) process.exit(1);
