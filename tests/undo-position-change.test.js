// اختبار آلي لزر "رجوع للموضع السابق" (التراجع عن تغيير الموضع لو ضُغط بالخطأ):
// - يعيد الموضع القديم نفسه ورصده كما كان (من oldAssessmentSnapshot)، ويلغي خصم الـ10.
// - المحاولة تبقى محسوبة ضمن حد المرتين (rerolls تُعلَّم undone ولا تُحذف) — لا "تغيير ثم تراجع" بلا حد.
// - رئيس لجنة سحابي: يمرّ عبر دالة الخادم، ولو رفض الخادم لا يتغير شيء محلياً إطلاقاً.
// - العضو الذي اعتمد تغييراً تراجع عنه الرئيس يُعاد موضعه تلقائياً بالمزامنة.
// - وجود أخطاء مسجلة على الموضع الجديد يطلب تأكيداً، والرفض لا يغيّر شيئاً.
// شغّله: node tests/undo-position-change.test.js
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
    dataset: {}, style: {}, value: "", textContent: "", innerHTML: "", disabled: false, className: "",
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

let confirmAnswer = true;
const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { readyState: "complete", addEventListener: () => {}, querySelector: (sel) => queryElement(sel), querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" }, body: makeElement() },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
  confirm: () => confirmAnswer,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

sandbox.__candidates = [
  { id: "pos-1", juz: 9, chapter: 20, startId: 5000 },
  { id: "pos-2", juz: 9, chapter: 20, startId: 5010 },
  { id: "pos-3", juz: 9, chapter: 21, startId: 5200 },
  { id: "pos-4", juz: 9, chapter: 21, startId: 5300 },
];
vm.runInContext("candidates = __candidates;", sandbox);

let context = { kind: "committee", committee: { name: "لجنة 1", examiner_role: "chairman" } };
sandbox.window.CloudCompetition = { get context() { return context } };

function fixture() {
  sandbox.__state = { config: {}, participants: [], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state;", sandbox);
  const draw = {
    id: "DRAW-1", level: 2, rerolls: [],
    positions: [
      { id: "pos-1", juz: 9, chapter: 20, startId: 5000 },
      { id: "posOther", juz: 10, chapter: 22, startId: 6000 },
    ],
  };
  const participant = { id: "P1", name: "طالب تجريبي" };
  const assessment = participant.assessment = {
    id: "ASSESS-1", drawId: draw.id, status: "draft",
    positions: [
      { positionId: "pos-1", memorization: 3, language: 0, tajweed: 1, hesitation: 4, positionChange: 0, note: "ملاحظة قديمة", completed: true },
      { positionId: "posOther", memorization: 1, language: 2, tajweed: 0, hesitation: 0, positionChange: 0, note: "", completed: false },
    ],
    actions: [{ positionId: "pos-1", type: "memorization", delta: 1, at: "2026-01-01T00:00:00.000Z" }],
  };
  return { draw, participant, assessment };
}

async function localUndoRestoresEverything() {
  vm.runInContext("operationMode = 'local';", sandbox);
  const { draw, participant, assessment } = fixture();
  const scoreBefore = sandbox.calculateAssessment(assessment).score;
  await sandbox.replaceAssessmentPosition(draw, participant, assessment, 0);
  assert.notStrictEqual(draw.positions[0].id, "pos-1");
  assert.strictEqual(sandbox.calculateAssessment(assessment).score, scoreBefore - 10 + 3 * 2 + 1 + 4 * 0.2, "التغيير يخصم 10 ويصفّر رصد الموضع");

  const done = await sandbox.undoAssessmentPositionChange(draw, participant, assessment, 0);
  assert.strictEqual(done, true);
  const entry = assessment.positions[0];
  assert.strictEqual(draw.positions[0].id, "pos-1", "يجب أن يعود الموضع القديم نفسه");
  assert.strictEqual(entry.positionId, "pos-1");
  assert.strictEqual(entry.positionChange, 0, "خصم تغيير الموضع يُلغى");
  assert.strictEqual(entry.memorization, 3); assert.strictEqual(entry.tajweed, 1); assert.strictEqual(entry.hesitation, 4);
  assert.strictEqual(entry.note, "ملاحظة قديمة"); assert.strictEqual(entry.completed, true);
  assert.strictEqual(entry.changes.length, 0, "التغيير الملغى يخرج من changes (لا يظهر كـ'تغيّر من' بورقة النتيجة)");
  assert.strictEqual(entry.undoneChanges.length, 1, "ويبقى مؤرشفاً في undoneChanges");
  assert.strictEqual(sandbox.calculateAssessment(assessment).score, scoreBefore, "العلامة ترجع كما كانت قبل التغيير تماماً");
  assert.ok(!assessment.actions.some(a => a.type === "positionChange"), "حدث تغيير الموضع يخرج من سجل التراجع");
  assert.strictEqual(assessment.actions.length, 1, "تسجيلات الموضع القديم السابقة تبقى");
  assert.strictEqual(draw.rerolls.length, 1, "المحاولة تبقى محسوبة ضمن حد المرتين");
  assert.strictEqual(draw.rerolls[0].undone, true);
  assert.strictEqual(assessment.positions[1].memorization, 1, "الموضع الآخر لا يتأثر");

  // المحاولة الثانية ثم تراجع، ثم الثالثة ممنوعة (الحد مرتان يشمل المحاولات المتراجَع عنها).
  await sandbox.replaceAssessmentPosition(draw, participant, assessment, 0);
  await sandbox.undoAssessmentPositionChange(draw, participant, assessment, 0);
  assert.strictEqual(draw.rerolls.length, 2);
  await sandbox.replaceAssessmentPosition(draw, participant, assessment, 0);
  assert.strictEqual(draw.positions[0].id, "pos-1", "المحاولة الثالثة ممنوعة");
  assert.strictEqual(assessment.positions[0].positionChange, 0);
  assert.strictEqual(await sandbox.undoAssessmentPositionChange(draw, participant, assessment, 0), false, "لا شيء للتراجع عنه");
}

async function marksOnNewPositionNeedConfirmation() {
  vm.runInContext("operationMode = 'local';", sandbox);
  const { draw, participant, assessment } = fixture();
  await sandbox.replaceAssessmentPosition(draw, participant, assessment, 0);
  const newId = draw.positions[0].id;
  assessment.positions[0].language = 2;
  confirmAnswer = false;
  assert.strictEqual(await sandbox.undoAssessmentPositionChange(draw, participant, assessment, 0), false);
  confirmAnswer = true;
  assert.strictEqual(draw.positions[0].id, newId, "رفض التأكيد لا يغيّر شيئاً");
  assert.strictEqual(assessment.positions[0].language, 2);
  assert.strictEqual(assessment.positions[0].positionChange, 1);
  assert.strictEqual(await sandbox.undoAssessmentPositionChange(draw, participant, assessment, 0), true);
  assert.strictEqual(assessment.positions[0].language, 0, "رصد الموضع الجديد الملغى لا يُحسب");
  assert.strictEqual(assessment.positions[0].undoneChanges[0].discardedAssessment.language, 2, "لكنه مؤرشف");
}

async function cloudChairmanGoesThroughServerAndRollsBackOnError() {
  vm.runInContext("operationMode = 'cloud';", sandbox);
  context = { kind: "committee", committee: { name: "لجنة 1", examiner_role: "chairman" } };
  const calls = [];
  sandbox.window.CloudCompetition = {
    get context() { return context },
    replaceCommitteePosition: async () => ({}),
    undoCommitteePositionChange: async (...args) => { calls.push(args); if (calls.length === 1) throw new Error("انتهت جلسة اللجنة"); return { draw: { positions: [{ id: "pos-1", juz: 9, chapter: 20, startId: 5000, fromServer: true }], rerolls: [{ positionIndex: 0, undone: true, server: true }] } } },
  };
  const { draw, participant, assessment } = fixture();
  await sandbox.replaceAssessmentPosition(draw, participant, assessment, 0);
  const newId = draw.positions[0].id;

  await assert.rejects(sandbox.undoAssessmentPositionChange(draw, participant, assessment, 0, { remote: sandbox.annualPositionChangeRemote() }), /انتهت جلسة اللجنة/);
  assert.strictEqual(draw.positions[0].id, newId, "رفض الخادم: الموضع الجديد يبقى");
  assert.strictEqual(assessment.positions[0].positionChange, 1, "رفض الخادم: الخصم يبقى");
  assert.strictEqual(assessment.positions[0].changes.length, 1, "رفض الخادم: سجل التغيير يبقى");
  assert.ok(!draw.rerolls[0].undone, "رفض الخادم: المحاولة لا تُعلَّم");

  assert.strictEqual(await sandbox.undoAssessmentPositionChange(draw, participant, assessment, 0, { remote: sandbox.annualPositionChangeRemote() }), true);
  const [participantId, drawId, index, oldPosition, sentAssessment] = calls[1];
  assert.deepStrictEqual([participantId, drawId, index, oldPosition.id], ["P1", "DRAW-1", 0, "pos-1"]);
  assert.strictEqual(sentAssessment.positions[0].positionChange, 0, "الخادم يستلم الرصد بعد التراجع");
  assert.strictEqual(draw.positions[0].fromServer, true, "الموضع المعتمد هو ما أعاده الخادم");
  assert.strictEqual(draw.rerolls[0].server, true);

  context = { kind: "committee", committee: { name: "لجنة 1", examiner_role: "member" } };
  assert.strictEqual(sandbox.annualPositionChangeRemote(), null, "العضو لا يستدعي دالة الخادم");
  vm.runInContext("operationMode = 'local';", sandbox);
  context = null;
  assert.strictEqual(sandbox.annualPositionChangeRemote(), null, "المحلي لا يستدعي الخادم");
}

async function memberFollowsChairmanUndo() {
  vm.runInContext("operationMode = 'cloud';", sandbox);
  context = { kind: "committee", committee: { name: "لجنة 1", examiner_role: "member" } };
  sandbox.window.CloudCompetition = { get context() { return context } };
  const { draw, participant, assessment } = fixture();
  // العضو اعتمد تغيير الرئيس سابقاً (pos-1 → pos-2).
  const entry = assessment.positions[0];
  entry.changes = [{ oldPosition: draw.positions[0], newPosition: { id: "pos-2", juz: 9 }, at: "2026-01-01T00:01:00.000Z", oldAssessmentSnapshot: { memorization: 3, language: 0, tajweed: 1, hesitation: 4, note: "ملاحظة قديمة", completed: true } }];
  Object.assign(entry, { positionId: "pos-2", memorization: 0, tajweed: 0, hesitation: 0, note: "", completed: false, positionChange: 1 });
  draw.positions[0] = { id: "pos-2", juz: 9 };
  assessment.actions.push({ positionId: "pos-2", type: "positionChange", delta: 1, at: "2026-01-01T00:01:01.000Z" });

  assert.strictEqual(sandbox.syncMemberWithChairmanUndo(draw, participant, assessment, [1, 0], () => {}), -1, "الرئيس ما زال على التغيير: لا شيء");
  assert.strictEqual(draw.positions[0].id, "pos-2");
  assert.strictEqual(sandbox.syncMemberWithChairmanUndo(draw, participant, assessment, [0, 0], () => {}), 0, "الرئيس تراجع: يُعاد موضع العضو");
  assert.strictEqual(draw.positions[0].id, "pos-1");
  assert.strictEqual(entry.positionChange, 0);
  assert.strictEqual(entry.memorization, 3);
}

(async () => {
  await localUndoRestoresEverything();
  await marksOnNewPositionNeedConfirmation();
  await cloudChairmanGoesThroughServerAndRollsBackOnError();
  await memberFollowsChairmanUndo();
  console.log("undo-position-change.test.js: نجح — الرجوع للموضع السابق يعيد الموضع ورصده ويلغي الخصم، يحترم حد المرتين، يمرّ عبر الخادم لرئيس اللجنة مع تراجع آمن عند الرفض، ويزامن العضو");
})().catch(error => { console.error("undo-position-change.test.js FAILED:", error.stack || error.message); process.exit(1); });
