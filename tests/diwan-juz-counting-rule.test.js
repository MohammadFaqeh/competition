// اختبار آلي: قاعدة العدّ واختبار الخمسة أجزاء بديوان الحفاظ (قرار الإدارة 2026-11-18).
// - كل جزء جديد بمحاولة ناجحة يُحسب، والمحسوب سابقاً لا يُحسب مرتين، وكل ١٠ أجزاء محسوبة = انتقال (يُرحَّل الزائد).
// - ناجح لم يكمل العشرة = «ناجح بلا انتقال»: يبقى بمرحلته ويعود بانتظار اختيار الأجزاء. الراسب لا يُحسب له شيء.
// - اختبار الخمسة أجزاء: بالمرحلتين الثانية والثالثة فقط، نجاحه 90، وأجزاؤه الجديدة ضمن العشرة.
// - الاستيراد: عمود «عدد الأجزاء»، التعرّف بالاسم، والترقيم التلقائي لرقم الجلوس والرقم التسلسلي «ث/…/2026».
// شغّله: node tests/diwan-juz-counting-rule.test.js
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
const sorted = list => JSON.stringify([...list].map(Number).sort((x, y) => x - y));
let seq = 0, day = 0;
function setup(participants) {
  sandbox.confirm = () => true; sandbox.toast = () => {};
  sandbox.__diwan = { config: {}, participants, draws: [] };
  vm.runInContext("renderDiwanParticipants=()=>{};saveDiwanState=()=>{};diwanState=__diwan;diwanAdminSessions=[];", sandbox);
}
// محاولة معتمدة من اللجنة ثم دمجها (نفس مسار النتائج الحقيقي).
function addAttempt(p, parts, score, at) {
  const id = `d${++seq}`, d = at || `2026-11-${String(++day).padStart(2, "0")}`;
  sandbox.__diwan.draws.push({ id, participantId: p.id, stage: p.stage, eligibleParts: parts, createdAt: `${d}T09:00:00.000Z` });
  p.parts = parts.slice();
  vm.runInContext(`diwanAdminSessions.push({id:'s${seq}',participant_id:'${p.id}',draw_id:'${id}',stage:${p.stage},status:'final',score:${score},assessment:{},finalized_at:'${d}T10:00:00.000Z'})`, sandbox);
  sandbox.mergeFinalDiwanSessionsIntoState(vm.runInContext("diwanAdminSessions", sandbox));
  return sandbox.__diwan.draws.find(x => x.id === id);
}

async function run() {
  // ===== ١) قاعدة العدّ بمسار طالبة كامل =====
  const a = { id: "a", name: "أ", stage: 1, parts: [], usedJuz: [] };
  setup([a]);
  addAttempt(a, range(1, 10), 90);
  assert.strictEqual(a.stage, 2, "نجاح الأولى بعشرة جديدة ينقلها");
  assert.strictEqual(sandbox.diwanStageCreditOf(a), 0, "رصيد المرحلة الجديدة صفر");

  // خلط ٦ جديدة + ٤ قديمة ونجحت ← تُحسب الستة فقط، تبقى بالثانية، وتعود بانتظار اختيار الأجزاء.
  const mixed = addAttempt(a, [...range(11, 16), 1, 2, 3, 4], 92);
  assert.strictEqual(a.stage, 2, "رصيد ٦ من ١٠ لا ينقلها");
  assert.strictEqual(sandbox.diwanStageCreditOf(a), 6, "حُسبت الأجزاء الستة الجديدة");
  assert.strictEqual(a.usedJuz.length, 16);
  assert.strictEqual(sorted(mixed.credit.credited), sorted(range(11, 16)), "السحب يحفظ ما حُسب منه");
  assert.ok(mixed.noPromotion, "نجاح بلا انتقال");
  assert.strictEqual(a.parts.length, 0, "تعود بانتظار اختيار الأجزاء");
  assert.strictEqual(sandbox.currentDiwanDraw(a, sandbox.__diwan.draws), null, "المحاولة لا تُعدّ سحبها الحالي");
  assert.strictEqual(sandbox.diwanParticipantStatusOf(a), "no_draw");
  assert.strictEqual(sandbox.diwanExportResultText(a), "ناجح — حُسب 6 أجزاء جديدة بلا انتقال", "عمود النتيجة بالتصدير");
  assert.ok(sandbox.diwanAttemptRows(a).some(r => r.key === "passed" && /حُسب 6 أجزاء جديدة بلا انتقال/.test(r.result)), "السجل يذكر الأجزاء المحسوبة");

  // قديم فقط ونجحت ← لا شيء جديد.
  addAttempt(a, range(1, 10), 100);
  assert.strictEqual(sandbox.diwanStageCreditOf(a), 6, "الإعادة بأجزاء قديمة لا تزيد الرصيد");
  assert.strictEqual(sandbox.diwanExportResultText(a), "ناجح — إعادة بلا أجزاء جديدة");

  // رسوب بأجزاء جديدة ← لا يُحسب شيء.
  addAttempt(a, range(21, 30), 60);
  assert.strictEqual(sandbox.diwanStageCreditOf(a), 6, "الرسوب لا يُحسب له شيء");
  assert.strictEqual(a.usedJuz.length, 16);

  // ===== ٢) اختبار الخمسة أجزاء بالمرحلة الثانية: نجاحه 90 =====
  assert.strictEqual(sandbox.diwanPassScoreForDraw({ stage: 2, eligibleParts: range(21, 25) }), 90);
  // حدود العلامة بالضبط: الخمسة 90، العشرة 85 — ومن الجلسة نفسها حتى لو السحب غير موجود على الجهاز (من عدد المواضع)
  const fiveSession = score => ({ status: "final", stage: 3, draw_id: "NO-DRAW-HERE", score, assessment: { positions: [1, 2, 3, 4, 5].map(() => ({})) } });
  const tenSession = score => ({ status: "final", stage: 2, draw_id: "NO-DRAW-HERE", score, assessment: { positions: range(1, 10).map(() => ({})) } });
  assert.ok(!sandbox.diwanScorePasses(fiveSession(89.99), []) && sandbox.diwanScorePasses(fiveSession(90), []), "الخمسة: 89.99 رسوب و90 نجاح");
  assert.ok(!sandbox.diwanScorePasses(tenSession(84.99), []) && sandbox.diwanScorePasses(tenSession(85), []), "العشرة: 84.99 رسوب و85 نجاح");
  assert.strictEqual(sandbox.diwanPassScoreForDraw({ stage: 1, eligibleParts: range(1, 10) }), 85, "المرحلة الأولى (عشرة) 85");
  assert.strictEqual(sandbox.diwanPassScoreForDraw({ stage: 2, eligibleParts: range(21, 30) }), 85);
  addAttempt(a, range(21, 25), 88);
  assert.strictEqual(sandbox.diwanStageCreditOf(a), 6, "88 بالخمسة أجزاء رسوب (نجاحها 90)");
  assert.strictEqual(sandbox.diwanParticipantStatusOf(a), "failed");
  assert.strictEqual(sandbox.diwanExportResultText(a), "راسب");
  addAttempt(a, range(21, 25), 90);
  assert.strictEqual(a.stage, 3, "6 + 5 = 11 ← انتقلت للثالثة");
  assert.strictEqual(sandbox.diwanStageCreditOf(a), 1, "يُرحَّل الجزء الزائد للمرحلة الثالثة");
  assert.strictEqual(a.usedJuz.length, 21);

  // بالثالثة: عشرة فيها ٥ قديمة + ٥ جديدة، ثم خمسة فيها ٤ جديدة ← ١ + ٥ + ٤ = ١٠ ← النهائي.
  addAttempt(a, range(21, 30), 86);
  assert.strictEqual(sandbox.diwanStageCreditOf(a), 6);
  addAttempt(a, [17, 18, 19, 20, 1], 95);
  assert.strictEqual(a.stage, 4, "اكتمل رصيد الثالثة ← الاختبار النهائي");
  assert.strictEqual(a.usedJuz.length, 30, "الثلاثون كلها محسوبة");

  // نقل يدوي للخلف للثالثة: الرصيد = ما حُسب بالمرحلتين الأولى والثانية (٢١) ← رصيد الثالثة ١.
  assert.strictEqual(sandbox.moveDiwanParticipantToStage(a, 3), true);
  assert.strictEqual(a.usedJuz.length, 21);
  assert.strictEqual(sandbox.diwanStageCreditOf(a), 1);

  // ===== ٣) تعديل النتيجة يدوياً =====
  const b = { id: "b", name: "ب", stage: 2, parts: [], usedJuz: range(1, 10) };
  sandbox.__diwan.participants.push(b);
  const bDraw = addAttempt(b, [...range(11, 16), 1, 2, 3, 4], 70);
  assert.ok(await sandbox.setDiwanAttemptResult(b, bDraw, { score: 90 }));
  assert.strictEqual(b.stage, 2);
  assert.strictEqual(sandbox.diwanStageCreditOf(b), 6, "تعديل الرسوب إلى نجاح يحسب الأجزاء الجديدة");
  assert.ok(await sandbox.setDiwanAttemptResult(b, bDraw, { score: 60 }));
  assert.strictEqual(sandbox.diwanStageCreditOf(b), 0, "إلغاء النجاح يسحب أجزاءه من الرصيد");
  assert.strictEqual(b.usedJuz.length, 10);
  assert.strictEqual(sandbox.currentDiwanDraw(b, sandbox.__diwan.draws)?.id, bDraw.id, "يعود سحبه الحالي (راسباً)");
  // نجاح مُنقِل ثم إلغاؤه ← يعود للمرحلة ورصيدها السابق.
  const b2 = addAttempt(b, range(11, 20), 90);
  assert.strictEqual(b.stage, 3);
  assert.ok(await sandbox.setDiwanAttemptResult(b, b2, { score: 50 }));
  assert.strictEqual(b.stage, 2, "إلغاء النجاح المُنقِل يعيده");
  assert.strictEqual(sandbox.diwanStageCreditOf(b), 0);
  assert.strictEqual(b.usedJuz.length, 10);

  // ===== ٤) الانسحاب يلغي نجاحاً بلا انتقال =====
  const c = { id: "c", name: "ج", gender: "أنثى", stage: 2, parts: [], usedJuz: range(1, 10) };
  sandbox.__diwan.participants.push(c);
  addAttempt(c, range(11, 15), 95);
  assert.strictEqual(sandbox.diwanStageCreditOf(c), 5);
  await sandbox.toggleDiwanParticipantWithdrawn(c);
  assert.strictEqual(c.withdrawn, true);
  assert.strictEqual(sandbox.diwanStageCreditOf(c), 0, "الانسحاب يلغي ما حُسب");
  assert.strictEqual(c.usedJuz.length, 10);

  // ===== ٥) قواعد عدد الأجزاء =====
  assert.ok(sandbox.diwanPartsCountError(1, 5), "الخمسة غير متاحة بالمرحلة الأولى");
  assert.strictEqual(sandbox.diwanPartsCountError(2, 5), "");
  assert.strictEqual(sandbox.diwanPartsCountError(3, 5), "");
  assert.ok(sandbox.diwanPartsCountError(2, 7));
  assert.strictEqual(sandbox.planDiwanEnrollment(null, { stage: 1, parts: range(1, 5) }).kind, "error", "خمسة بالأولى تُرفض");
  assert.strictEqual(sandbox.planDiwanEnrollment(null, { stage: 1, parts: range(1, 10), partsCount: 5 }).kind, "error", "عدد الأجزاء لا يطابق");

  // ===== ٦) الاستيراد: التعرّف بالاسم، والترقيم التلقائي =====
  setup([
    { id: "x1", name: "ترتيل سعيد", gender: "أنثى", seat: "001", serialNumber: "ث/2026/1", stage: 2, parts: [], usedJuz: range(1, 10) },
    { id: "x2", name: "هبة علي", gender: "أنثى", seat: "002", serialNumber: "", stage: 1, parts: [], usedJuz: [] },
    { id: "x3", name: "مكررة", gender: "أنثى", seat: "003", serialNumber: "ث/2026/3", stage: 1, parts: [], usedJuz: [] },
    { id: "x4", name: "مكررة", gender: "أنثى", seat: "004", serialNumber: "ث/2026/4", stage: 1, parts: [], usedJuz: [] },
  ]);
  const row = (name, extra = {}) => ({ name, gender: "أنثى", center: "", seat: "", serial: "", stageRaw: "", stage: null, rawParts: "", parts: null, partsCountRaw: "", ...extra });
  const rows = sandbox.planDiwanImportRows([
    row("ترتيل سعيد", { rawParts: "1-5", parts: range(1, 5), partsCountRaw: "5" }),   // بالاسم، خمسة كلها سبق
    row("هبة علي", { rawParts: "1-10", parts: range(1, 10) }),                          // بالاسم، بلا رقم تسلسلي
    row("جديدة أولى", { rawParts: "1-10", parts: range(1, 10) }),
    row("جديدة ثانية", { seat: "010" }),
    row("جديدة ثالثة"),
    row("مكررة"),
    row("خمسة بالأولى", { rawParts: "1-5", parts: range(1, 5) }),
    row("عدد لا يطابق", { rawParts: "1-10", parts: range(1, 10), partsCountRaw: "5" }),
  ].map((r, i) => ({ ...r, rowNo: i + 1 })));
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.strictEqual(by["ترتيل سعيد"].status, "ready");
  assert.strictEqual(by["ترتيل سعيد"].existing.id, "x1", "تعرّف عليها بالاسم");
  assert.ok(/بالاسم/.test(by["ترتيل سعيد"].warning), "تنبيه التعرّف بالاسم");
  assert.ok(/اختبار خمسة أجزاء — إعادة/.test(by["ترتيل سعيد"].action), "وصف نوع الاختبار");
  assert.strictEqual(by["هبة علي"].existing.id, "x2");
  assert.strictEqual(by["هبة علي"].assignedSerial, "ث/2026/2", "الرقم التسلسلي = ث/2026/رقم الجلوس");
  assert.ok(/كلها جديدة/.test(by["هبة علي"].action));
  assert.strictEqual(by["جديدة أولى"].existing, null);
  assert.strictEqual(by["جديدة أولى"].assignedSeat, "011", "رقم الجلوس بعد أكبر رقم (ومنه رقم الملف 010) وبنفس العرض");
  assert.strictEqual(by["جديدة أولى"].assignedSerial, "ث/2026/11");
  assert.strictEqual(by["جديدة ثانية"].assignedSeat, undefined, "رقم الملف يبقى كما هو");
  assert.strictEqual(by["جديدة ثانية"].assignedSerial, "ث/2026/10");
  assert.strictEqual(by["جديدة ثالثة"].assignedSeat, "012");
  assert.strictEqual(by["مكررة"].status, "rejected", "الاسم المكرر بالموقع يُرفض");
  assert.strictEqual(by["خمسة بالأولى"].status, "rejected");
  assert.strictEqual(by["عدد لا يطابق"].status, "rejected");
  // التنفيذ يكتب الأرقام المقترحة.
  sandbox.openModal = () => {};
  sandbox.applyDiwanImport(rows);
  const all = sandbox.__diwan.participants;
  const added = all.find(p => p.name === "جديدة أولى");
  assert.strictEqual(added.seat, "011");
  assert.strictEqual(added.serialNumber, "ث/2026/11");
  assert.strictEqual(all.find(p => p.id === "x2").serialNumber, "ث/2026/2", "الموجودة بلا رقم تسلسلي أُعطيت رقماً");
  assert.strictEqual(all.find(p => p.id === "x1").serialNumber, "ث/2026/1", "الرقم الموجود لا يتغير");
  assert.strictEqual(all.filter(p => p.name === "ترتيل سعيد").length, 1, "لم تُكرَّر");
  assert.strictEqual(sandbox.parseDiwanSerial("2026/4/ث").num, 4, "يقرأ الصيغة بالاتجاهين");

  // ===== ٧) إعادة رفع ملف فيه أسماء موجودة (من النظام القديم): لا حذف، نفس السجل، تُعبّأ الأجزاء =====
  const mk = (id, name, extra) => ({ id, name, gender: "أنثى", center: "النور", seat: id, serialNumber: `ث/2026/${id}`, stage: 1, parts: [], usedJuz: [], ...extra });
  const passed = mk("1", "ناجحة سابقاً"), failed = mk("2", "راسبة سابقاً"), pending = mk("3", "بانتظار اللجنة"), removed = mk("4", "مُزالة"), absent = mk("5", "غير موجودة بالملف");
  setup([passed, failed, pending, removed, absent]);
  addAttempt(passed, range(1, 10), 92);
  addAttempt(failed, range(1, 10), 60);
  addAttempt(removed, range(1, 10), 90);
  assert.strictEqual(sandbox.unenrollDiwanParticipant(removed), true, "نجحت بالأولى ثم أُزيلت من الثانية");
  sandbox.__diwan.draws.push({ id: "pend", participantId: "3", stage: 1, eligibleParts: range(1, 10), createdAt: "2026-11-20T09:00:00.000Z" });
  pending.parts = range(1, 10);
  const drawsBefore = sandbox.__diwan.draws.length;
  const reRows = sandbox.planDiwanImportRows([
    row("ناجحة سابقاً", { gender: "غير محدد", rawParts: "11-20", parts: range(11, 20) }),
    row("راسبة سابقاً", { gender: "غير محدد", rawParts: "1-10", parts: range(1, 10) }),
    row("بانتظار اللجنة", { rawParts: "21-30", parts: range(21, 30) }),
    row("مُزالة", { rawParts: "11-20", parts: range(11, 20) }),
    row("طالبة جديدة", { rawParts: "1-10", parts: range(1, 10) }),
    row("طالبة جديدة", { rawParts: "1-10", parts: range(1, 10) }),
    row("ناجحة سابقاً", { rawParts: "21-30", parts: range(21, 30) }),
  ].map((r, i) => ({ ...r, rowNo: i + 1 })));
  assert.strictEqual(reRows[5].status, "rejected", "الاسم الجديد المكرر بالملف لا يُضاف مرتين");
  assert.strictEqual(reRows[6].status, "rejected", "الاسم الموجود المكرر بالملف: يُعتمد أول صف فقط");
  sandbox.applyDiwanImport(reRows);
  const list = sandbox.__diwan.participants;
  assert.strictEqual(list.length, 6, "لا حذف — أُضيفت الجديدة مرة واحدة فقط");
  assert.ok(list.includes(absent) && absent.parts.length === 0 && absent.stage === 1, "غير الموجودة بالملف لم تُمس");
  assert.strictEqual(sandbox.__diwan.draws.length, drawsBefore, "كل المحاولات السابقة باقية");
  assert.strictEqual(passed.stage, 2, "الناجحة تبقى بمرحلتها");
  assert.strictEqual(sorted(passed.parts), sorted(range(11, 20)), "وتُعبّأ أجزاؤها الجديدة");
  assert.strictEqual(passed.gender, "أنثى", "خانة الجنس الفارغة لا تمسح المحفوظ");
  assert.strictEqual(passed.usedJuz.length, 10, "رصيدها كما هو");
  assert.strictEqual(failed.stage, 1);
  assert.strictEqual(sorted(failed.parts), sorted(range(1, 10)), "الراسبة: محاولة جديدة بأجزائها");
  assert.ok(sandbox.diwanAttemptRows(failed).some(r => r.key === "failed"), "رسوبها السابق باقٍ بالسجل");
  assert.strictEqual(sorted(pending.parts), sorted(range(1, 10)), "من له سحب بانتظار اللجنة لا تتغير أجزاؤه");
  assert.ok(/بانتظار اللجنة/.test(reRows[2].warning), "مع تنبيه بالسبب");
  assert.strictEqual(removed.unenrolled, undefined, "المُزالة أُعيد تسجيلها");
  assert.strictEqual(removed.stage, 2, "بآخر مرحلة لها");
  assert.strictEqual(sorted(removed.parts), sorted(range(11, 20)));
  assert.strictEqual(removed.usedJuz.length, 10, "ورصيدها كما هو");

  // ===== ٨) اسم أكمل بالملف: الرقمان معاً يطابقان ← يُحدَّث الاسم؛ رقم واحد فقط ← يُرفض =====
  const jana = mk("59", "جنى محمد مقابلة"), saja = mk("92", "سجى حاتم بني عبد الرحمن");
  setup([jana, saja]);
  const nameRows = sandbox.planDiwanImportRows([
    row("جنى محمد عارف مقابلة", { seat: "059", serial: "ث/2026/59" }),
    row("سجى حاتم عبد النبي بني عبد الرحمن", { serial: "ث/2026/92" }),
  ].map((r, i) => ({ ...r, rowNo: i + 1 })));
  assert.strictEqual(nameRows[0].status, "ready", "رقم الجلوس (059 = 59) والتسلسلي يطابقانها");
  assert.ok(/سيُعدَّل الاسم/.test(nameRows[0].warning));
  assert.strictEqual(nameRows[1].status, "rejected", "رقم واحد فقط مع اسم مختلف يُرفض");
  sandbox.applyDiwanImport(nameRows);
  assert.strictEqual(jana.name, "جنى محمد عارف مقابلة", "حُدّث الاسم");
  assert.strictEqual(sandbox.__diwan.participants.length, 2, "لم تُضف طالبة جديدة");

  // ===== ٩) ملف الإدارة الحقيقي: عمود «أجزاء الاختبار القادم ( مطلوب تعبئته )»، وتصحيح «ث/الرقم/2026» =====
  const nh2 = sandbox.normalizeHeader;
  assert.strictEqual(sandbox.diwanPrefixColumn({ [nh2("أجزاء الاختبار القادم ( مطلوب تعبئته )")]: "1، 2، 3" }, ["أجزاء الاختبار القادم"]), "1، 2، 3", "يُقرأ العمود بإضافته");
  assert.strictEqual(sandbox.diwanPrefixColumn({ [nh2("أجزاء الاختبار السابق")]: "1-10" }, ["أجزاء الاختبار القادم"]), "", "ولا يُقرأ السابق");
  assert.strictEqual(sandbox.parsePartSpec("1، 2، 3، 4، 5، 6، 7، 10، 29، 30").length, 10, "صيغة الأجزاء بالملف تُفهم");
  assert.strictEqual(sandbox.parseDiwanSerial("ث/2026/10").num, 10);
  assert.strictEqual(sandbox.parseDiwanSerial("ث/2026/10").order, "lyn");
  const wrong = mk("097", "أنفال كامل صالح بني ياسين", { serialNumber: "ث/1/2026" }), ok97 = mk("10", "لين أحمد", { serialNumber: "ث/2026/10" }), junk = mk("093", "بشرى", { serialNumber: "23434" });
  setup([wrong, ok97, junk]);
  const fixRows = sandbox.planDiwanImportRows([row("أنفال كامل صالح بني ياسين", { rawParts: "1-10", parts: range(1, 10) }), row("لين أحمد"), row("بشرى")].map((r, i) => ({ ...r, rowNo: i + 1 })));
  assert.strictEqual(fixRows[0].assignedSerial, "ث/2026/97", "الرقم الخاطئ يُصحَّح إلى ث/2026/رقم الجلوس");
  assert.ok(/تصحيح الرقم التسلسلي/.test(fixRows[0].action));
  assert.strictEqual(fixRows[1].assignedSerial, undefined, "الرقم الصحيح لا يُمس");
  assert.strictEqual(fixRows[2].assignedSerial, undefined, "رقم بصيغة أخرى (غير الخاطئة) لا يُمس");
  sandbox.applyDiwanImport(fixRows);
  assert.strictEqual(wrong.serialNumber, "ث/2026/97");
  assert.strictEqual(sorted(wrong.parts), sorted(range(1, 10)), "وتُعبّأ أجزاؤها");
  assert.strictEqual(ok97.serialNumber, "ث/2026/10");
  assert.strictEqual(junk.serialNumber, "23434");
  assert.strictEqual(sandbox.diwanSerialForSeat("098"), "ث/2026/98");
  assert.strictEqual(sandbox.diwanSerialForSeat("10"), "ث/2026/98", "إن أُخذ رقم الجلوس فبعد أكبر رقم مستخدم (97)");

  // ===== ١٠) فلاتر صفحة المرحلة: «بانتظار السحب» و«نوع الاختبار» =====
  const f5 = mk("201", "خمسة", { stage: 2, usedJuz: range(1, 10), parts: range(11, 15) }), f10 = mk("202", "عشرة", { stage: 2, usedJuz: range(1, 10), parts: range(11, 20) }), f0 = mk("203", "بلا أجزاء", { stage: 2, usedJuz: range(1, 10) });
  setup([f5, f10, f0]);
  vm.runInContext("diwanOpenStage=2", sandbox);
  assert.strictEqual(sandbox.diwanStageFilterKey(f5, 2), "ready", "أجزاؤها مسجّلة بلا سحب = بانتظار السحب");
  assert.strictEqual(sandbox.diwanStageFilterKey(f0, 2), "no_draw", "بلا أجزاء = بانتظار الأجزاء");
  assert.strictEqual(sandbox.diwanExamTypeKey(f5, 2), "5");
  assert.strictEqual(sandbox.diwanExamTypeKey(f10, 2), "10");
  assert.strictEqual(sandbox.diwanExamTypeKey(f0, 2), "none");
  const pick = filters => [f5, f10, f0].filter(p => sandbox.diwanParticipantMatchesFilters(p, { status: "all", type: "all", gender: "all", center: "all", committee: "all", ...filters })).map(p => p.id).join(",");
  assert.strictEqual(pick({ type: "5" }), "201", "فلتر خمسة أجزاء");
  assert.strictEqual(pick({ status: ["ready"] }), "201,202", "فلتر بانتظار السحب");
  assert.strictEqual(pick({ status: ["ready"], type: "10" }), "202", "الفلاتر مترابطة");
  vm.runInContext("diwanOpenStage=null", sandbox);

  // ===== ١١) المنسحبة تبقى منسحبة: الاستيراد لا يسجّل لها أجزاء ولا يلغي انسحابها =====
  const wd = mk("301", "منسحبة", { stage: 1, withdrawn: true, score: 0, scoreSource: "withdrawn", center: "قديم" });
  setup([wd]);
  const wdRows = sandbox.planDiwanImportRows([row("منسحبة", { center: "جديد", rawParts: "1-10", parts: range(1, 10) }), row("منسحبة", { rawParts: "1-5", parts: range(1, 5), partsCountRaw: "5" })].map((r, i) => ({ ...r, rowNo: i + 1 })));
  assert.strictEqual(wdRows[0].status, "ready", "تُحدَّث بياناتها");
  assert.ok(/بقيت منسحبة/.test(wdRows[0].warning), "مع تنبيه");
  sandbox.applyDiwanImport(wdRows);
  assert.strictEqual(wd.withdrawn, true, "لم يُلغَ انسحابها");
  assert.strictEqual((wd.parts || []).length, 0, "ولا أجزاء لها");
  assert.strictEqual(wd.center, "جديد", "وبياناتها حُدّثت");

  console.log("diwan-juz-counting-rule.test.js: نجح — قاعدة العدّ، اختبار الخمسة أجزاء (90، المرحلتان ٢–٣)، التعديل/الانسحاب، والاستيراد بالاسم والترقيم التلقائي");
}
run().catch(error => { console.error("diwan-juz-counting-rule.test.js FAILED:", error.stack || error.message); process.exit(1); });
