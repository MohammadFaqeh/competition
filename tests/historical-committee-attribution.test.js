// اختبار آلي لإصلاح صريح مطلوب من المستخدم: إحصائيات اللجنة (عدد الممتحنين عند اللجنة نفسها،
// وبطاقة كل لجنة عند لوحة تحكم الإدارة) يجب أن تعتمد على "من امتحن الطالب فعلياً"، لا على مستواه
// الحالي — لأن نقل المستوى بين اللجان يصير يومياً بالمسابقة، فكان اعتماد المستوى الحالي يُسقط
// طلاباً امتحنوا فعلياً عند لجنة معينة من إحصائياتها بمجرد نقلهم لمستوى/لجنة أخرى لاحقاً.
// الإصلاح: assessment.committee={id,name} يُختم عند اعتماد النتيجة (finalizeElectronicAssessment)
// ويُعبَّأ رجعياً للجلسات القديمة (mergeFinalSessionsIntoState) — والمنطق المستهلِك لهذا الحقل
// (committeeScopedState/renderCommitteeDashboardGrid) كان موجوداً أصلاً بالكود لكنه معطَّل فعلياً
// (dead code) لعدم تعبئة البيانات، فيُفعَّل الآن تلقائياً دون أي تغيير إضافي بهما.
// شغّله: node tests/historical-committee-attribution.test.js
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
  document: { readyState: "complete", addEventListener: () => {}, querySelector: (sel) => queryElement(sel), querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" }, body: makeElement() },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

function run() {
  const committee9 = { id: "committee-9", name: "لجنة رقم 9", chairman_name: "إيثار الزعبي", member_name: "سكوت كساسبة", levels: [10], level_names: ["المستوى السادس - ب"], responsible_gender: "أنثى", active: true };
  const committee3 = { id: "committee-3", name: "لجنة رقم 3", levels: [5], level_names: ["المستوى السابع"], responsible_gender: "أنثى", active: true };

  // 1) mergeFinalSessionsIntoState يعبّئ assessment.committee رجعياً لجلسة معتمدة قديمة (اعتُمدت
  //    قبل هذا الإصلاح، assessment.committee غير موجود إطلاقاً بها أصلاً) — ويحدّث participant
  //    فعلياً رغم إنه لا شيء آخر تغيّر (العلامة/الاسم كلها متطابقة مسبقاً).
  const participant = { id: "p1", name: "متسابقة اختبرت بلجنة 9 ثم نُقلت", level: 5, levelName: "المستوى السابع", gender: "أنثى", score: 82, gradedAt: "2026-09-01T00:00:00.000Z", scoreSource: "electronic", assessment: { status: "final", finalizedAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", committeeName: "لجنة رقم 9", result: { score: 82 } } };
  sandbox.__state = { config: {}, participants: [participant], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state;", sandbox);

  const oldSession = { id: "sess-1", participant_id: "p1", committee_id: "committee-9", status: "final", score: 82, finalized_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", assessment: { status: "final", finalizedAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", committeeName: "لجنة رقم 9", result: { score: 82 } } };

  const changed = sandbox.mergeFinalSessionsIntoState([oldSession], [committee9, committee3]);
  assert.strictEqual(changed, true, "التعبئة الرجعية لحقل جديد يجب أن تُعتبر تغييراً فعلياً (وإلا لن تُحفظ/تُرفع للسحابة أبداً)");
  const updatedParticipant = vm.runInContext("state.participants.find(p=>p.id==='p1')", sandbox);
  assert.strictEqual(updatedParticipant.assessment.committee.id, "committee-9", "assessment.committee.id يجب أن يُعبَّأ رجعياً من committee_id الجلسة (committee-9)");
  assert.strictEqual(updatedParticipant.assessment.committee.name, "لجنة رقم 9");

  // 2) committeeScopedState: متسابقة امتحنت فعلياً عند لجنة 9 (assessment.committee.id) لكن
  //    مستواها الحالي صار "المستوى السابع" (يطابق لجنة 3 لا لجنة 9) — يجب أن تبقى ظاهرة عند لجنة
  //    9 (من امتحنها فعلياً)، رغم عدم تطابق مستواها الحالي إطلاقاً.
  sandbox.window.CloudCompetition = { get context() { return { committee: { id: "committee-9", levelNames: ["المستوى السادس - ب"], levels: [10], responsibleGender: "أنثى" } } } };
  const payload = { config: {}, participants: [participant], draws: [] };
  const scoped = sandbox.committeeScopedState(payload);
  assert.strictEqual(scoped.participants.length, 1, "المتسابقة يجب أن تبقى ضمن نطاق لجنة 9 رغم أن مستواها الحالي (المستوى السابع) لا يطابق لجنة 9 إطلاقاً — لأنها من امتحنتها فعلياً");

  // 3) renderCommitteeDashboardGrid (لوحة الإدارة): نفس المتسابقة يجب أن تُحسب على بطاقة لجنة 9
  //    (من امتحنها فعلياً)، لا على بطاقة لجنة 3 (مستواها الحالي فقط، لم تُمتحن هناك إطلاقاً).
  vm.runInContext("cloudCommittees = __committees; operationMode = 'cloud';", Object.assign(sandbox, { __committees: [committee9, committee3] }));
  sandbox.renderCommitteeDashboardGrid([participant]);
  const gridHtml = vm.runInContext('document.querySelector("#committeeDashboardGrid").innerHTML', sandbox);
  const committee9Card = gridHtml.slice(gridHtml.indexOf("لجنة رقم 9"), gridHtml.indexOf("لجنة رقم 9") + 400);
  const committee3Card = gridHtml.slice(gridHtml.indexOf("لجنة رقم 3"), gridHtml.indexOf("لجنة رقم 3") + 400);
  assert.ok(/عدد الطلاب<\/span><b>1<\/b>/.test(committee9Card), "بطاقة لجنة 9 يجب أن تحسب المتسابقة (امتحنتها فعلياً) ضمن عدد الطلاب");
  assert.ok(/عدد الطلاب<\/span><b>0<\/b>/.test(committee3Card), "بطاقة لجنة 3 يجب ألا تحسبها إطلاقاً (لم تُمتحن هناك، فقط مستواها الحالي يطابقها)");

  console.log("historical-committee-attribution.test.js: نجح — إحصائيات اللجنة (عند اللجنة نفسها وعند لوحة الإدارة) تعتمد الآن على من امتحن الطالب فعلياً، لا على مستواه الحالي، مع تعبئة رجعية للجلسات القديمة");
}

try { run(); } catch (error) { console.error("historical-committee-attribution.test.js FAILED:", error.stack || error.message); process.exit(1); }
