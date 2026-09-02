// اختبار آلي لنظام Scoring الجديد الواعي باليوم/المستوى/السورة عند اختيار موضع السحب
// (availableForParts/bestScoredCandidates بapp.js) — بناءً على طلب صريح: لا نمنع التكرار
// نهائياً، بس نرتّب الأولوية بحيث يكون "آخر خيار" فقط لما ما يبقى بديل أفضل. يستخدم الدوال
// الحقيقية المشحونة فعلياً، لا نسخة موازية مكتوبة يدوياً بالاختبار.
// شغّله: node tests/draw-scoring-day-level-surah.test.js
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
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

// مجمّع مواضع وهمي مبسّط: جزء 1 فيه 3 مواضع فقط، اثنان بنفس السورة (2) وواحد بسورة مختلفة (3).
sandbox.__candidates = [
  { id: "p-A", juz: 1, chapter: 2 },
  { id: "p-B", juz: 1, chapter: 2 },
  { id: "p-C", juz: 1, chapter: 3 },
];
vm.runInContext("candidates = __candidates;", sandbox);

function draw(id, level, createdAtIso) { return { level, createdAt: createdAtIso, positions: [{ id }] } }

function run() {
  // "اليوم" لازم يُحسب ديناميكياً بنفس طريقة drawDayKey الحقيقية بapp.js (تاريخ اللحظة الفعلية
  // وقت تشغيل الاختبار)، لا نص ثابت مكتوب يدوياً — وإلا ممكن يوم تشغيل الاختبار الفعلي يختلف
  // عن التاريخ المكتوب فيفشل الاختبار بالغلط (بدا "أمس" رغم إنه فعلياً نفس اليوم أو العكس).
  const now = new Date();
  const todayDatePart = now.toISOString().slice(0, 10);
  const yesterdayDatePart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const today = `${todayDatePart}T10:00:00.000Z`, todayLater = `${todayDatePart}T14:00:00.000Z`, yesterday = `${yesterdayDatePart}T10:00:00.000Z`;

  // 1) بلا أي استخدام سابق إطلاقاً: كل المواضع بنفس الأولوية (نقاط=0) — أي واحد منهم "الأفضل".
  sandbox.__initialState = { config: {}, participants: [], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __initialState;", sandbox);
  let best = sandbox.availableForParts([1], 15);
  assert.strictEqual(best.length, 3, "بلا استخدام سابق: الثلاثة مواضع كلهم بأفضل أولوية (لا فرق بينهم)");

  // 2) p-A استُخدم اليوم بنفس المستوى (15): يصبح "آخر خيار". p-B (نفس سورة p-A، 2) كمان يتأثر
  //    سلباً (عقوبة "تكدّس السورة" اليوم) رغم إنه هو نفسه لم يُستخدم — بالضبط طبقة "الجزء←
  //    السورة←الموضع" المطلوبة. p-C (سورة 3 مختلفة تماماً، صفر أثر) يبقى الأفضل الوحيد بوضوح.
  sandbox.__stateToday = { config: {}, participants: [], draws: [draw("p-A", 15, today)], resets: [], deletions: [] };
  vm.runInContext("state = __stateToday;", sandbox);
  best = sandbox.availableForParts([1], 15);
  assert.strictEqual(best.map(c => c.id).sort().join(","), "p-C", "p-A (استُخدم اليوم) يُستبعد، وp-B (نفس سورته) يتأثر بعقوبة تكدّس السورة فيصبح أقل أولوية من p-C (سورة مختلفة تماماً)، فيبقى p-C الأفضل الوحيد");

  // 3) لو استُخدم p-A وp-B الاثنان اليوم بنفس المستوى (كل سورة 2 "مُشبَعة" اليوم): p-C (سورة
  //    مختلفة) يجب أن يبقى الأفضل بوضوح، أفضل من إعادة استخدام أي من A/B.
  sandbox.__stateBothUsed = { config: {}, participants: [], draws: [draw("p-A", 15, today), draw("p-B", 15, todayLater)], resets: [], deletions: [] };
  vm.runInContext("state = __stateBothUsed;", sandbox);
  best = sandbox.availableForParts([1], 15);
  assert.strictEqual(best.map(c => c.id).sort().join(","), "p-C", "لما تُستخدم كل مواضع سورة معيّنة اليوم، الموضع من سورة أخرى غير المُستخدَمة يبقى الأفضل");

  // 4) "آخر خيار لا يُمنع نهائياً": لو الثلاثة مواضع (كل الجزء) مُستخدَمة اليوم بنفس المستوى،
  //    النظام لازم يرجّع نتيجة (مش يرمي خطأ فارغ) — أقلها تعادل بينهم كـ"آخر خيار" ممكن.
  sandbox.__stateAllUsed = { config: {}, participants: [], draws: [draw("p-A", 15, today), draw("p-B", 15, today), draw("p-C", 15, today)], resets: [], deletions: [] };
  vm.runInContext("state = __stateAllUsed;", sandbox);
  best = sandbox.availableForParts([1], 15);
  assert.strictEqual(best.length > 0, true, "حتى لو كل مواضع الجزء مُستخدَمة اليوم، ما بيرجع فاضي — بيرجّح الأقل ضرراً كآخر خيار، لا يمنع نهائياً");

  // 5) استخدام من يوم سابق (أمس) بنفس المستوى لا يُعامَل بنفس شدة استخدام اليوم — p-A (أمس)
  //    يبقى أفضل من موضع لم يُستخدم اليوم لكن يُستخدم غيره اليوم بكثرة بنفس السورة لموضع ثالث.
  sandbox.__stateYesterday = { config: {}, participants: [], draws: [draw("p-A", 15, yesterday)], resets: [], deletions: [] };
  vm.runInContext("state = __stateYesterday;", sandbox);
  best = sandbox.availableForParts([1], 15);
  const bestIdsYesterday = best.map(c => c.id).sort();
  assert.strictEqual(bestIdsYesterday.join(","), "p-B,p-C", "الأولوية القصوى لتجنّب تكرار اليوم — استخدام أمس (خارج اليوم الحالي) لا يُحسب بنفس شدة استخدام اليوم لنفس المستوى، بس يبقى أثره (levelHistorical) يفرّقه عن الصفر، فما يساوي عندياً p-A نفسه");
  // تأكيد إضافي: p-A نفسه (استُخدم أمس) درجته أعلى من صفر (ليس ضمن الأفضل رغم إنه ليس اليوم)
  assert.ok(!bestIdsYesterday.includes("p-A"), "الاستخدام بنفس المستوى (حتى بيوم سابق) يبقى له أثر يفضّل الأقل استخداماً عليه — ليس تجاهلاً كاملاً");

  // 6) مستوى مختلف: استخدام p-A اليوم بمستوى 10 ما بفعّل عقوبتَي "اليوم+المستوى" و"المستوى
  //    التاريخي" الثقيلتين لطالبة بمستوى 15 (فصل صحيح بين المستويات لهاتين الطبقتين تحديداً) —
  //    بس طبقة "الاستخدام العام منذ بداية المسابقة" (بغض النظر عن المستوى، حسب الطلب بالضبط)
  //    تبقى تحسبه بوزن خفيف جداً، فيصير أقل أولوية بفرق طفيف عن p-B/p-C غير المُستخدَمين إطلاقاً.
  sandbox.__stateOtherLevel = { config: {}, participants: [], draws: [draw("p-A", 10, today)], resets: [], deletions: [] };
  vm.runInContext("state = __stateOtherLevel;", sandbox);
  best = sandbox.availableForParts([1], 15);
  assert.strictEqual(best.map(c => c.id).sort().join(","), "p-B,p-C", "استخدام بمستوى مختلف (10) ما بفعّل عقوبة اليوم/المستوى الثقيلة لمستوى آخر (15) — بس طبقة الاستخدام العام الخفيفة تبقى تحسبه، فتفضَّل عليه p-B/p-C غير المُستخدَمين إطلاقاً بفرق طفيف");

  console.log("draw-scoring-day-level-surah.test.js: كل الحالات نجحت — الأولوية تُرتَّب صح (اليوم+المستوى > السورة > المستوى التاريخي > العام)، بلا منع نهائي لأي موضع");
}

try { run(); } catch (error) { console.error("draw-scoring-day-level-surah.test.js FAILED:", error.stack || error.message); process.exit(1); }
