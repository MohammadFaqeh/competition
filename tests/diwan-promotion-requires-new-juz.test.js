// اختبار آلي: قاعدة الترقية بديوان الحفاظ (2026-11-17) — الناجح بمراحل ١–٣ يترقّى فقط إذا كانت أجزاء محاولته
// كلها جديدة (لا شيء منها محسوب لمرحلة سابقة نجح فيها). خلط جديد+قديم أو قديم فقط = «ناجح — إعادة بلا ترقية»:
// يبقى بمرحلته، ولا تُضاف أجزاؤها لرصيده، ويعود بانتظار اختيار الأجزاء؛ والمنتقي يعلّم «سبق» على كل جزء امتُحن به.
// شغّله: node tests/diwan-promotion-requires-new-juz.test.js
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

function makeElement() {
  const classes = new Set();
  return {
    dataset: {}, style: {}, value: "", textContent: "", innerHTML: "", disabled: false,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => { if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false } classes.add(c); return true } if (force) classes.add(c); else classes.delete(c); return force },
      contains: (c) => classes.has(c),
    },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null },
    querySelector() { return makeElement() }, querySelectorAll() { return [] },
    closest() { return null }, appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, click() {},
  };
}
const elementCache = new Map();
function queryElement(sel) { if (!elementCache.has(sel)) elementCache.set(sel, makeElement()); return elementCache.get(sel) }

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    readyState: "complete", hidden: false, addEventListener() {},
    querySelector: (sel) => queryElement(sel), querySelectorAll: () => [],
    documentElement: { lang: "ar", dir: "rtl" }, body: makeElement(),
  },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
  lucide: { createIcons() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
let seq = 0;
function setup(participants, draws, sessions) {
  sandbox.confirm = () => true; sandbox.toast = () => {};
  sandbox.__diwan = { config: {}, participants, draws };
  sandbox.__sessions = sessions;
  vm.runInContext("renderDiwanParticipants=()=>{};saveDiwanState=()=>{};diwanState=__diwan;diwanAdminSessions=__sessions;", sandbox);
}
function addAttempt(p, stage, parts, score, day) {
  const id = `d${++seq}`;
  sandbox.__diwan.draws.push({ id, participantId: p.id, stage, eligibleParts: parts, createdAt: `${day.length > 2 ? day : "2026-11"}-${day.length > 2 ? "01" : day}T09:00:00.000Z` });
  p.parts = parts.slice();
  vm.runInContext(`diwanAdminSessions.push({id:'s${seq}',participant_id:'${p.id}',draw_id:'${id}',stage:${stage},status:'final',score:${score},assessment:{},finalized_at:'${day.length > 2 ? day : "2026-11"}-${day.length > 2 ? "01" : day}T10:00:00.000Z'})`, sandbox);
  sandbox.mergeFinalDiwanSessionsIntoState(vm.runInContext("diwanAdminSessions", sandbox));
  return sandbox.__diwan.draws.find(d => d.id === id);
}

async function run() {
  // ١) المرحلة الأولى: الرصيد فارغ فكل نجاح يرقّي.
  const a = { id: "a", name: "أ", stage: 1, parts: [], usedJuz: [] };
  setup([a], [], []);
  addAttempt(a, 1, range(1, 10), 90, "01");
  assert.strictEqual(a.stage, 2, "نجاح الأولى يرقّي");
  assert.strictEqual(a.usedJuz.length, 10);

  // ٢) خلط: ٦ جداد + ٤ قدام ونجح ← يبقى بالثانية، الرصيد لا يتغير، يعود بانتظار الأجزاء.
  const mixed = addAttempt(a, 2, [...range(11, 16), 1, 2, 3, 4], 92, "02");
  assert.strictEqual(a.stage, 2, "الخلط لا يرقّي");
  assert.strictEqual(JSON.stringify(a.usedJuz.slice().sort((x, y) => x - y)), JSON.stringify(range(1, 10)), "لا تُضاف أجزاء المحاولة (ولا الجديدة) للرصيد");
  assert.strictEqual(JSON.stringify(mixed.noPromotion.overlap), "[1,2,3,4]");
  assert.strictEqual(a.parts.length, 0, "يعود بانتظار اختيار الأجزاء");
  assert.strictEqual(sandbox.currentDiwanDraw(a, sandbox.__diwan.draws), null, "المحاولة لا تُعدّ سحبه الحالي");
  assert.strictEqual(sandbox.diwanParticipantStatusOf(a), "no_draw");
  const rows = sandbox.diwanAttemptRows(a);
  assert.ok(rows.some(r => r.key === "passed" && /إعادة بلا ترقية/.test(r.result)), "السجل يكتب «ناجح — إعادة بلا ترقية»");
  assert.ok(rows.find(r => /إعادة بلا ترقية/.test(r.result)).parts.length === 10, "السجل يعرض الأجزاء العشرة كلها");

  assert.strictEqual(sandbox.diwanExportResultText(a), "ناجح — إعادة بلا ترقية", "عمود النتيجة بالتصدير");
  // ٣) قديم فقط ونجح ← يبقى أيضاً.
  addAttempt(a, 2, range(1, 10), 100, "03");
  assert.strictEqual(a.stage, 2, "القديم فقط لا يرقّي");
  assert.strictEqual(a.usedJuz.length, 10);

  // ٤) رسوب بأجزاء جديدة ← يبقى (السلوك الحالي).
  addAttempt(a, 2, range(21, 30), 60, "04");
  assert.strictEqual(a.stage, 2);
  assert.strictEqual(sandbox.diwanParticipantStatusOf(a), "failed");
  assert.strictEqual(sandbox.diwanExportResultText(a), "راسب", "عمود النتيجة: راسب");

  // ٥) الستة التي امتُحن بها بالخلط (غير محسوبة) + ٤ جداد ونجح ← يترقّى للثالثة.
  addAttempt(a, 2, [...range(11, 16), ...range(21, 24)], 95, "05");
  assert.strictEqual(a.stage, 3, "أجزاء غير محسوبة سابقاً = جديدة للترقية");
  assert.strictEqual(a.usedJuz.length, 20, "الرصيد ٢٠ بالضبط");
  assert.strictEqual(sandbox.diwanExportResultText(a), "ناجح", "عمود النتيجة: ناجح");
  assert.strictEqual(sandbox.diwanExportResultText({ id: "x", withdrawn: true, score: 0 }), "منسحب");
  assert.strictEqual(sandbox.diwanExportResultText({ id: "y" }), "", "لم يُختبر = فارغ");
  const remaining = range(1, 30).filter(j => !a.usedJuz.includes(j));
  assert.strictEqual(remaining.length, 10, "بالثالثة يبقى ١٠ أجزاء بالضبط — لا أحد يعلق");

  // ٦) تعديل يدوي لمحاولة راسبة فيها جزء محسوب إلى ناجحة ← نجاح بلا ترقية.
  const b = { id: "b", name: "ب", stage: 2, parts: [], usedJuz: range(1, 10) };
  sandbox.__diwan.participants.push(b);
  const bDraw = addAttempt(b, 2, [...range(11, 19), 5], 70, "06");
  assert.strictEqual(b.stage, 2);
  const ok = await sandbox.setDiwanAttemptResult(b, bDraw, { score: 90 });
  assert.ok(ok);
  assert.strictEqual(b.stage, 2, "التعديل إلى نجاح لا يرقّي لوجود جزء محسوب");
  assert.strictEqual(b.usedJuz.length, 10);
  assert.ok(bDraw.noPromotion, "عُلّمت كإعادة بلا ترقية");
  // إلغاء هذا النجاح لا يُرجع المرحلة لأنه لم يرقِّ أصلاً.
  const ok2 = await sandbox.setDiwanAttemptResult(b, bDraw, { score: 60 });
  assert.ok(ok2);
  assert.strictEqual(b.stage, 2);
  assert.strictEqual(b.usedJuz.length, 10);

  // ٦ب) نقل يدوي للخلف: من الثالثة (رصيد ٢٠) إلى الثانية ← الرصيد يُقصّ إلى أجزاء نجاح الأولى فقط (١٠)،
  // وإلى الأولى ← صفر؛ فإعادة نفس الأجزاء ترقّيها من جديد.
  assert.strictEqual(sandbox.moveDiwanParticipantToStage(a, 2), true);
  assert.strictEqual(JSON.stringify(a.usedJuz), JSON.stringify(range(1, 10)), "العودة للثانية = رصيد الأولى فقط");
  assert.strictEqual(sandbox.moveDiwanParticipantToStage(a, 1), true);
  assert.strictEqual(a.usedJuz.length, 0, "العودة للأولى = رصيد صفر");
  addAttempt(a, 1, range(1, 10), 90, "2099-01"); // بعد وقت النقل الفعلي (stageEnteredAt = الآن)
  assert.strictEqual(a.stage, 2, "إعادة الأولى بنفس أجزائها بعد النقل للخلف ترقّي");

  // ٧) النهائي لا تنطبق عليه القاعدة (كل الثلاثين) — نجاحه يعتمد الحافظ.
  const c = { id: "c", name: "ج", stage: 4, parts: [], usedJuz: range(1, 30) };
  sandbox.__diwan.participants.push(c);
  addAttempt(c, 4, range(1, 30), 90, "07");
  assert.strictEqual(c.certified, true, "نجاح النهائي يعتمده حافظاً");

  console.log("diwan-promotion-requires-new-juz.test.js: نجح — الترقية فقط بأجزاء جديدة كلها، والخلط/القديم «ناجح — إعادة بلا ترقية» برصيد ثابت");
}
run().catch(error => { console.error("diwan-promotion-requires-new-juz.test.js FAILED:", error.stack || error.message); process.exit(1); });
