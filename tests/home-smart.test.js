// اختبار آلي لتقسيمة «ب» (2026-11-25): مرحلة الدورة بالرئيسية الذكية (التسجيل ← السحب ← الاختبار ← النتائج)،
// تفعيل «يوم الاختبار» (موعد العدّاد اليوم أو تصحيح اليوم)، وتطبيع نص البحث السريع (همزات/تاء مربوطة/تشكيل).
// شغّله: node tests/home-smart.test.js
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
const { homeSmartModel, layoutBActive } = sandbox;
const normalizeQuickSearch = vm.runInContext("normalizeQuickSearch", sandbox);

const now = new Date(2026, 11, 10, 11, 0);
const yesterday = new Date(2026, 11, 9, 10, 0).toISOString();
const today = new Date(2026, 11, 10, 9, 30).toISOString();
const setState = value => { sandbox.__next = value; vm.runInContext("state=__next", sandbox); };
const P = (id, extra = {}) => ({ id, name: "متسابق " + id, gender: "ذكر", level: 5, ...extra });

// 0) لا متسابقين = التسجيل
setState({ participants: [], draws: [], config: {} });
let m = homeSmartModel(now);
assert.strictEqual(m.phase, 0);
assert.strictEqual(m.examDay, false);

// 1) متسابقون بلا علامات = السحب، والمسحوب له يُعدّ
setState({ participants: [P("a"), P("b"), P("c")], draws: [{ participantId: "a", createdAt: yesterday }], config: {} });
m = homeSmartModel(now);
assert.strictEqual(m.phase, 1);
assert.strictEqual(m.drawn.length, 1);

// 2) يوم الاختبار حسب العدّاد (حتى قبل أي علامة) = مرحلة الاختبار + وضع المتابعة المباشرة
setState({ participants: [P("a"), P("b")], draws: [], config: { examCountdown: { enabled: true, date: "2026-12-10" } } });
m = homeSmartModel(now);
assert.strictEqual(m.days, 0);
assert.strictEqual(m.phase, 2);
assert.strictEqual(m.examDay, true);

// 3) علامات قديمة فقط (أمس) = مرحلة الاختبار بلا وضع مباشر؛ علامة اليوم تفعّله
setState({ participants: [P("a", { score: 90, gradedAt: yesterday }), P("b")], draws: [], config: {} });
m = homeSmartModel(now);
assert.strictEqual(m.phase, 2);
assert.strictEqual(m.examDay, false);
setState({ participants: [P("a", { score: 90, gradedAt: today }), P("b")], draws: [], config: {} });
m = homeSmartModel(now);
assert.strictEqual(m.examDay, true);
assert.strictEqual(m.gradedToday.length, 1);

// 4) المنسحب لا يمنع اكتمال الدورة، والاكتمال = النتائج (بلا وضع مباشر حتى لو صُحّح اليوم)
setState({ participants: [P("a", { score: 80, gradedAt: today }), P("b", { score: 60, gradedAt: today }), P("c", { withdrawn: true, score: 0 })], draws: [], config: {} });
m = homeSmartModel(now);
assert.strictEqual(m.phase, 3);
assert.strictEqual(m.examDay, false);
assert.strictEqual(m.passed.length, 1);

// 5) تطبيع البحث السريع: الهمزات والتاء المربوطة والتشكيل لا تمنع المطابقة
assert.strictEqual(normalizeQuickSearch("الإعدادات"), normalizeQuickSearch("الاعدادات"));
assert.strictEqual(normalizeQuickSearch("مراقبة حيّة"), normalizeQuickSearch("مراقبه حية"));
assert.strictEqual(normalizeQuickSearch("  أنس "), "انس");

// 6) بيئة بلا classList (مثل هذه الاختبارات) لا تنكسر
assert.strictEqual(layoutBActive(), false);

console.log("home-smart.test.js passed");
