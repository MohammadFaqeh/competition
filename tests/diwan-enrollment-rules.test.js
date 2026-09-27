// اختبار آلي لسيناريوهات «التسجيل الحالي مقابل السجل الدائم» بديوان الحفاظ: شرط النجاح للانتقال، إعادة اختبار سابق بأجزاء
// جديدة مع بقاء السجل، الإزالة من اختبار بلا حذف، منع التكرار بالرقم التسلسلي/الجلوس، معاينة Excel، الفلترة المتعددة، وسجل العمليات.
// شغّله: node tests/diwan-enrollment-rules.test.js
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

const P = (o) => Object.assign({ gender: "أنثى", center: "مركز", usedJuz: [], parts: [], level: 10, createdAt: "2026-09-01T00:00:00.000Z" }, o);
async function importRows(csvLines) {
  const csv = ["الاسم,رقم الطالبة,الرقم التسلسلي,الأجزاء,الاختبار", ...csvLines].join("\n");
  await sandbox.importDiwanExcel({ target: { value: "x", files: [{ name: "f.csv", text: async () => csv }] } });
}
async function run() {
  sandbox.confirm = () => true; sandbox.toast = () => {};
  const passedFirst = P({ id: "A", name: "سارة", seat: "155", serialNumber: "0012", stage: 2, usedJuz: [1,2,3,4,5,6,7,8,9,10], lastGradedDrawId: "dA1", score: 95 });
  const failedFirst = P({ id: "B", name: "هدى", seat: "156", serialNumber: "0013", stage: 1, parts: [1,2,3,4,5,6,7,8,9,10], lastGradedDrawId: "dB1", score: 60 });
  const withdrawnFirst = P({ id: "C", name: "نور", seat: "157", serialNumber: "0014", stage: 1, withdrawn: true, score: 0, scoreSource: "withdrawn" });
  sandbox.__d = { config: {}, participants: [passedFirst, failedFirst, withdrawnFirst], draws: [
    { id: "dA1", participantId: "A", stage: 1, eligibleParts: [1,2,3,4,5,6,7,8,9,10], positions: [], createdAt: "2026-09-02T00:00:00.000Z" },
    { id: "dB1", participantId: "B", stage: 1, eligibleParts: [1,2,3,4,5,6,7,8,9,10], positions: [], createdAt: "2026-09-02T00:00:00.000Z" }] };
  vm.runInContext(`renderDiwanParticipants=()=>{};saveDiwanState=()=>{};diwanState=__d;diwanAdminSessions=[
    {id:'sA',participant_id:'A',draw_id:'dA1',stage:1,status:'final',score:95,assessment:{},finalized_at:'2026-09-02T01:00:00.000Z'},
    {id:'sB',participant_id:'B',draw_id:'dB1',stage:1,status:'final',score:60,assessment:{},finalized_at:'2026-09-02T01:00:00.000Z'}];`, sandbox);
  const list = () => vm.runInContext("diwanState.participants", sandbox);

  // قراءة خانة الاختبار
  assert.strictEqual(sandbox.diwanStageFromText("الاختبار الأول"), 1);
  assert.strictEqual(sandbox.diwanStageFromText("الثانية"), 2);
  assert.strictEqual(sandbox.diwanStageFromText("اختبار ٣"), 3);
  assert.strictEqual(sandbox.diwanStageFromText("النهائي"), 4);
  assert.strictEqual(sandbox.diwanStageFromText(""), null);
  assert.ok(Number.isNaN(sandbox.diwanStageFromText("مستوى متقدم")));

  // ملف واحد لعدة اختبارات + معاينة
  await importRows([
    "سارة,155,0012,11-20,الاختبار الأول",
    "هدى,156,0013,11-20,الاختبار الثاني",
    "ريم محمد,188,0099,1-10,الاختبار الأول",
    "دانة,189,0100,,الاختبار الثاني",
    "اسم آخر,157,,,الاختبار الأول",
    "سارة,155,0012,21-30,الاختبار الأول",
    "نور,157,0014,1-10,مستوى متقدم",
  ]);
  assert.strictEqual(list().length, 3, "لا شيء يُحفظ قبل التأكيد");
  queryElement("#confirmDiwanImport").onclick();
  const byName = n => list().find(p => p.name === n);
  const sara = byName("سارة");
  assert.strictEqual(list().length, 4, "أُضيفت ريم فقط كسجل جديد — لا تكرار لسارة");
  assert.strictEqual(sara.stage, 1, "سارة أعادت الاختبار الأول");
  assert.strictEqual(JSON.stringify(sara.parts), "[11,12,13,14,15,16,17,18,19,20]", "بأجزائها الجديدة");
  assert.ok(vm.runInContext("diwanState.draws", sandbox).some(d => d.id === "dA1"), "محاولتها القديمة باقية بالسجل");
  assert.ok(!sandbox.diwanStageMembers(2).some(p => p.id === "A"), "أُزيلت من قائمة الاختبار الثاني الحالية");
  assert.ok(sandbox.diwanStageMembers(1).some(p => p.id === "A"), "وتظهر بالاختبار الأول");
  const rows = sandbox.diwanAttemptRows(sara);
  assert.strictEqual(rows.length, 2, "السجل: المحاولة القديمة + التسجيل الجديد");
  assert.ok(rows[0].result.startsWith("ناجح · 95") && rows[1].pending, "المحاولة الأولى ناجحة، والثانية مسجلة بانتظار السحب");
  assert.strictEqual(byName("هدى").stage, 1, "هدى لم تُنقل للثاني");
  assert.ok(!byName("دانة"), "دانة لم تُضف");
  assert.strictEqual(byName("ريم محمد").stage, 1);
  assert.ok(sara.log.some(e => e.text.includes("إعادة الاختبار الأول") && e.text.includes("استيراد Excel")), "سجل العمليات يوثّق الإعادة");

  // نفس القواعد عند التعديل اليدوي (نفس الدالة المركزية)
  assert.strictEqual(sandbox.moveDiwanParticipantToStage(byName("هدى"), 2), false, "اليدوي أيضاً يرفض الثاني للراسبة");
  assert.strictEqual(sandbox.moveDiwanParticipantToStage(sara, 2), true, "سارة تعود للثاني لأنها ناجحة بالأول");
  assert.strictEqual(sara.stage, 2);
  assert.strictEqual(sandbox.moveDiwanParticipantToStage(byName("ريم محمد"), 3, { override: true }), true, "تجاوز إداري مسجَّل");
  assert.ok(byName("ريم محمد").grantedStages.includes(3) && byName("ريم محمد").log.some(e => e.text.includes("بتجاوز شرط النجاح")));

  // إعادة نفس الاختبار بأجزاء جديدة بعد الرسوب ← محاولة جديدة
  const huda = byName("هدى");
  assert.strictEqual(sandbox.moveDiwanParticipantToStage(huda, 1, { parts: [21,22,23,24,25,26,27,28,29,30] }), true);
  assert.strictEqual(sandbox.diwanParticipantStatusOf(huda), "no_draw", "محاولة جديدة بانتظار السحب");
  assert.strictEqual(sandbox.diwanAttemptRows(huda).length, 2, "الرسوب القديم باقٍ + المحاولة الجديدة");

  // الإزالة من اختبار دون حذف
  assert.strictEqual(sandbox.unenrollDiwanParticipant(sara), true);
  assert.strictEqual(sandbox.diwanParticipantStatusOf(sara), "unenrolled");
  assert.ok(!sandbox.diwanStageMembers(2).some(p => p.id === "A"), "لا تظهر بقائمة الثاني");
  assert.ok(list().some(p => p.id === "A") && vm.runInContext("diwanState.draws", sandbox).some(d => d.id === "dA1"), "بياناتها وسجلها باقيان");
  sandbox.window.CloudCompetition = { context: { kind: "committee", committee: { id: "c1", responsibleGender: "أنثى" } } };
  const scoped = sandbox.diwanCommitteeScope({ config: {}, participants: list(), draws: [] });
  sandbox.window.CloudCompetition = { context: {} };
  assert.ok(!scoped.participants.some(p => p.id === "A"), "لا تظهر لأي لجنة");
  assert.strictEqual(sandbox.moveDiwanParticipantToStage(sara, 2), true, "إعادة تسجيلها لاحقاً");
  assert.ok(!sara.unenrolled && sara.stage === 2);

  // فلترة متعددة بصفحة الاختبار الأول: راسب + منسحب
  vm.runInContext("diwanOpenStage = 1;", sandbox);
  vm.runInContext(`diwanState.participants.push({id:"F",name:"راسبة",seat:"160",gender:"أنثى",stage:1,parts:[],usedJuz:[],lastGradedDrawId:"dF",score:50});
    diwanState.draws.push({id:"dF",participantId:"F",stage:1,eligibleParts:[],positions:[],createdAt:"2026-09-03T00:00:00.000Z"});
    diwanAdminSessions.push({id:"sF",participant_id:"F",draw_id:"dF",stage:1,status:"final",score:50,assessment:{},finalized_at:"2026-09-03T01:00:00.000Z"});`, sandbox);
  const pick = status => sandbox.diwanStageMembers(1).filter(p => sandbox.diwanParticipantMatchesFilters(p, { status, gender: "all", center: "all", committee: "all" })).map(p => p.id).sort().join(",");
  assert.strictEqual(pick(["failed", "withdrawn"]), "B,C,F", "راسب + منسحب معاً (هدى راسبة بانتظار إعادة الاختبار)");
  assert.strictEqual(pick(["withdrawn"]), "C");
  assert.ok(pick([]).split(",").length >= 4, "بلا اختيار = الكل");

  // سجل المتسابقين: الجدول والفلترة حسب الاختبار الحالي
  vm.runInContext("diwanStudentsStageSelection = ['2']; diwanStudentsStatusSelection = [];", sandbox);
  sandbox.renderDiwanStudents();
  const html = vm.runInContext('document.querySelector("#diwanStudentsTable").innerHTML', sandbox);
  assert.ok(html.includes("سارة") && !html.includes("هدى"), "فلترة السجل حسب الاختبار الحالي");

  console.log("diwan-enrollment-rules.test.js: نجح — شرط النجاح، إعادة اختبار سابق مع بقاء السجل، الإزالة بلا حذف، منع التكرار، معاينة Excel، الفلترة المتعددة، وسجل العمليات");
}
run().catch(error => { console.error("diwan-enrollment-rules.test.js FAILED:", error.stack || error.message); process.exit(1); });
