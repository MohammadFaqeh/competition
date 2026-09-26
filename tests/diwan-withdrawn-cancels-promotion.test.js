// اختبار آلي: انسحاب متسابق ديوان الحفاظ بعد نجاحه وترقيته (مثل 100 ← الاختبار الثاني) يلغي الترقية
// ويعيده لمرحلة ذلك النجاح منسحبًا بعلامة صفر، ولا يظهر «ناجح» بأي مرحلة؛ إلغاء الانسحاب يعيده كما كان.
// شغّله: node tests/diwan-withdrawn-cancels-promotion.test.js
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

function run() {
  sandbox.confirm = () => true; sandbox.toast = () => {};
  vm.runInContext("renderDiwanParticipants=()=>{};saveDiwanState=()=>{};diwanAdminSessions=[{id:'s1',participant_id:'p1',draw_id:'d1',stage:1,status:'final',score:100,assessment:{},finalized_at:'2026-09-20T10:00:00.000Z'}];", sandbox);
  const participant = { id: "p1", name: "بسمة", stage: 2, parts: [], usedJuz: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], lastGradedDrawId: "d1", score: 100, gradedAt: "2026-09-20T10:00:00.000Z", assessment: { status: "final" } };
  sandbox.__diwan = { config: {}, participants: [participant], draws: [{ id: "d1", participantId: "p1", stage: 1, eligibleParts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], createdAt: "2026-09-20T09:00:00.000Z" }] };
  vm.runInContext("diwanState = __diwan;", sandbox);
  assert.ok(sandbox.diwanPassedStageSession(participant, 1), "قبل الانسحاب: ناجحة بالمرحلة الأولى");

  return sandbox.toggleDiwanParticipantWithdrawn(participant).then(() => {
    assert.strictEqual(participant.withdrawn, true);
    assert.strictEqual(participant.score, 0, "علامتها صفر");
    assert.strictEqual(participant.stage, 1, "أُلغيت الترقية وعادت للاختبار الأول");
    assert.strictEqual(JSON.stringify(participant.parts), "[1,2,3,4,5,6,7,8,9,10]", "أُعيدت أجزاء مرحلتها");
    assert.strictEqual(participant.usedJuz.length, 0, "أُزيلت أجزاء النجاح الملغى من المستعمل");
    assert.strictEqual(sandbox.diwanPassedStageSession(participant, 1), null, "المنسحبة لا تظهر ناجحة");
    assert.strictEqual(sandbox.diwanStageStatusOf(participant, 1), "withdrawn");
    return sandbox.toggleDiwanParticipantWithdrawn(participant);
  }).then(() => {
    assert.strictEqual(participant.withdrawn, false);
    assert.strictEqual(participant.stage, 2, "إلغاء الانسحاب يعيد الترقية");
    assert.strictEqual(participant.score, 100);
    assert.strictEqual(participant.usedJuz.length, 10);
    // السجل: تعديل علامة راسب (آخر اختبار بمرحلته) إلى نجاح يرقّيه، وحذف اختبار النجاح يعيده.
    const q = { id: "p2", name: "راسبة", stage: 1, parts: [11, 12], usedJuz: [], lastGradedDrawId: "d2", score: 70, assessment: {} };
    sandbox.__diwan.participants.push(q);
    sandbox.__diwan.draws.push({ id: "d2", participantId: "p2", stage: 1, eligibleParts: [11, 12], createdAt: "2026-09-21T09:00:00.000Z" });
    vm.runInContext("diwanAdminSessions.push({id:'s2',participant_id:'p2',draw_id:'d2',stage:1,status:'final',score:70,assessment:{},finalized_at:'2026-09-21T10:00:00.000Z'})", sandbox);
    const d2 = sandbox.__diwan.draws.find(d => d.id === "d2");
    return sandbox.setDiwanAttemptResult(q, d2, { score: 90 }).then(ok => {
      assert.ok(ok); assert.strictEqual(q.stage, 2, "تعديل العلامة إلى 90 يرقّيها"); assert.strictEqual(q.score, 90);
      assert.strictEqual(vm.runInContext("diwanAdminSessions.find(s=>s.draw_id==='d2').original_score", sandbox), 70, "علامة اللجنة الأصلية محفوظة");
      // اختبار معتمد بالمرحلة الثانية يمنع إلغاء نجاح الأولى
      sandbox.__diwan.draws.push({ id: "d3", participantId: "p2", stage: 2, eligibleParts: [13], createdAt: "2026-09-22T09:00:00.000Z" });
      vm.runInContext("diwanAdminSessions.push({id:'s3',participant_id:'p2',draw_id:'d3',stage:2,status:'final',score:60,assessment:{},finalized_at:'2026-09-22T10:00:00.000Z'})", sandbox);
      return sandbox.setDiwanAttemptResult(q, d2, "delete");
    }).then(ok => {
      assert.strictEqual(ok, false, "لا يُحذف نجاح الأولى ولها اختبار معتمد بالثانية");
      const d3 = sandbox.__diwan.draws.find(d => d.id === "d3");
      return sandbox.setDiwanAttemptResult(q, d3, "delete").then(() => sandbox.setDiwanAttemptResult(q, d2, "delete"));
    }).then(ok => {
      assert.ok(ok); assert.strictEqual(q.stage, 1, "حذف اختبار النجاح يعيدها للأولى");
      assert.ok(!sandbox.__diwan.draws.some(d => d.id === "d2"), "السحب حُذف");
      assert.strictEqual(q.usedJuz.length, 0);
      console.log("diwan-withdrawn-cancels-promotion.test.js: نجح — الانسحاب يلغي الترقية بعلامة صفر، وإلغاؤه يعيدها، وتعديل/حذف الاختبار من السجل يعيد ضبط المرحلة");
    });
  });
}

run().catch(error => { console.error("diwan-withdrawn-cancels-promotion.test.js FAILED:", error.stack || error.message); process.exit(1); });
