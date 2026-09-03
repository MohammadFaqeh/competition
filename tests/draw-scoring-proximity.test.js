// اختبار آلي لطبقة "القرب" الإضافية بنظام Scoring اختيار موضع السحب (availableForParts/
// bestScoredCandidates بapp.js) — طلب صريح من المستخدم: لما يصير تكرار غير قابل للتفادي داخل نفس
// الجزء لطلاب/طالبات بنفس اليوم ونفس المستوى، نفضّل موضع "بعيد" (بعدد الآيات) عن موضع زميل/ة تم
// توزيعه فعلاً اليوم، حتى لو نفس الجزء وحتى لو سورة مختلفة تماماً — لا يكتفي فقط بتفادي نفس
// الموضع/نفس السورة. يستخدم الدوال الحقيقية المشحونة فعلياً، لا نسخة موازية مكتوبة يدوياً بالاختبار.
// شغّله: node tests/draw-scoring-proximity.test.js
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

// جزء وهمي فيه 3 مواضع بـ3 سور مختلفة كليّاً (كل سورة موضع واحد فقط، فطبقة "تكدّس السورة" صفر
// للجميع دائماً — تعزل أثر "القرب" وحده). المسافات (startId) مصمَّمة حول proximityWindow=40:
// p-Used=1000 (يُستخدم اليوم)، p-Near=1020 (بعد 20 — داخل النافذة، عقوبة متوسطة)،
// p-EdgeIn=1039 (بعد 39 — أقصى حافة داخل النافذة، عقوبة ضئيلة)،
// p-EdgeOut=1040 (بعد 40 بالضبط — أول نقطة خارج النافذة، عقوبة صفر)،
// p-Far=1500 (بعيد جداً، عقوبة صفر).
sandbox.__candidates = [
  { id: "p-Used", juz: 5, chapter: 10, startId: 1000 },
  { id: "p-Near", juz: 5, chapter: 11, startId: 1020 },
  { id: "p-EdgeIn", juz: 5, chapter: 12, startId: 1039 },
  { id: "p-EdgeOut", juz: 5, chapter: 13, startId: 1040 },
  { id: "p-Far", juz: 5, chapter: 14, startId: 1500 },
];
vm.runInContext("candidates = __candidates;", sandbox);

function draw(id, level, createdAtIso) { return { level, createdAt: createdAtIso, positions: [{ id }] } }

function run() {
  const now = new Date();
  const todayDatePart = now.toISOString().slice(0, 10);
  const today = `${todayDatePart}T10:00:00.000Z`;

  // 1) p-Used استُخدم اليوم بنفس المستوى (15). كل مرشح آخر بسورة مختلفة تماماً (صفر أثر تكدّس
  //    سورة)، فالفارق الوحيد بينهم هو "القرب" من p-Used. المتوقع: أبعد مرشح (أو المرشحين خارج
  //    نافذة الأثر) هم الأفضل، لا عشوائية كاملة بين الجميع.
  sandbox.__state = { config: {}, participants: [], draws: [draw("p-Used", 15, today)], resets: [], deletions: [] };
  vm.runInContext("state = __state;", sandbox);
  const best = sandbox.availableForParts([5], 15);
  const bestIds = best.map(c => c.id).sort();

  assert.strictEqual(bestIds.join(","), "p-EdgeOut,p-Far", "المرشّحان الواقعان خارج نافذة القرب (39 آية أو أكثر) يتعادلان كأفضل خيار؛ الأقرب (p-Near, p-EdgeIn) يُستبعدان رغم كونهم بسورة مختلفة تماماً عن الموضع المُستخدَم اليوم");
  assert.ok(!bestIds.includes("p-Near"), "p-Near (بعد 20 آية فقط عن موضع استُخدم اليوم لنفس المستوى) يجب أن يُستبعد من الأفضلية رغم صفر تكرار مباشر — طبقة القرب تعاقبه");
  assert.ok(!bestIds.includes("p-EdgeIn"), "p-EdgeIn (بعد 39 آية، لسا داخل نافذة الأثر) يجب أن تبقى له عقوبة طفيفة تُخرجه من التعادل مع الأبعد");
  assert.ok(!bestIds.includes("p-Used"), "p-Used (نفس الموضع المُستخدَم اليوم) يبقى مُستبعداً كما بالسابق (عقوبة تكرار الموضع الثقيلة أصلاً)");

  console.log("draw-scoring-proximity.test.js: نجح — عند تعادل الأسباب الأخرى، يُفضَّل الموضع الأبعد (بعدد الآيات) عن موضع وُزِّع فعلاً اليوم لنفس المستوى، حتى داخل نفس الجزء وبسورة مختلفة تماماً");
}

try { run(); } catch (error) { console.error("draw-scoring-proximity.test.js FAILED:", error.stack || error.message); process.exit(1); }
