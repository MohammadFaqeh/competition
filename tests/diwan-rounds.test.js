// اختبار آلي: «الجولة» بصفحة ديوان الحفاظ (قرار الإدارة 2026-11-24).
// - جولات مشتقة من النتائج المعتمدة (شهر لكل جولة، والأخير مفتوح) قبل حفظ أي جولة.
// - ثلاث حالات بالجولة: لم تجهز / جاهزة (أجزاء، سحب، قيد الاختبار) / انتهت — والمنسحبة بلا اختبار خارج الجولة.
// - الاختبار يُنسب للجولة التي اعتُمد فيها؛ بدء/إغلاق الجولة؛ ودمج جولات جهازين (المغلقة تغلب ولا تضيع جولة).
// شغّله: node tests/diwan-rounds.test.js
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
    classList: { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : f; if (on) classes.add(c); else classes.delete(c); return on }, contains: c => classes.has(c) },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null },
    querySelector() { return makeElement() }, querySelectorAll() { return [] }, closest() { return null }, appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, click() {},
  };
}
const cache = new Map();
const queryElement = sel => { if (!cache.has(sel)) cache.set(sel, makeElement()); return cache.get(sel) };
const sandbox = {
  console, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { readyState: "complete", hidden: false, addEventListener() {}, querySelector: queryElement, querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl", classList: { add() {}, toggle() {}, remove() {} } }, body: makeElement() },
  navigator: { onLine: true }, crypto: require("crypto").webcrypto, fetch: () => Promise.reject(new Error("fetch disabled")),
  location: { hash: "", href: "", search: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout, lucide: { createIcons() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });
const run = code => vm.runInContext(code, sandbox);

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const P = o => Object.assign({ gender: "أنثى", center: "مركز", usedJuz: [], parts: [], level: 10, stage: 1, createdAt: "2026-09-01T00:00:00.000Z" }, o);
const D = (id, participantId, stage, createdAt, parts = range(1, 10)) => ({ id, participantId, stage, createdAt, eligibleParts: parts });
const S = (id, participant_id, draw_id, stage, status, finalized_at, score, assessment = {}) => ({ id, participant_id, draw_id, stage, status, score, finalized_at, updated_at: finalized_at || "2026-11-20T09:00:00.000Z", assessment });
function load(participants, draws, sessions, config = {}) {
  sandbox.__s = { config: { competitionName: "ديوان", ...config }, participants, draws, resets: [], deletions: [] };
  sandbox.__sessions = sessions;
  run("diwanState=__s;diwanAdminSessions=__sessions");
}
const statusOf = id => run(`diwanRoundStatus(diwanState.participants.find(p=>p.id===${JSON.stringify(id)}),diwanOpenRound())`);

// ===== البيانات: جولة أيلول (مغلقة) وجولة تشرين الثاني (مفتوحة) =====
const participants = [
  P({ id: "passedNov", stage: 2, usedJuz: range(1, 10), lastGradedDrawId: "d1", score: 95 }),             // نجحت بتشرين الثاني وانتقلت
  P({ id: "failedNov", stage: 2, usedJuz: range(1, 10), parts: range(11, 20), lastGradedDrawId: "d2b", score: 70 }), // رسبت بتشرين الثاني
  P({ id: "failedSep", stage: 1, parts: range(1, 10), lastGradedDrawId: "d3", score: 60 }),               // رسبت بأيلول ولم تُسجَّل إعادتها
  P({ id: "readyParts", stage: 2, usedJuz: range(1, 10), parts: range(11, 20) }),                           // لها أجزاء ولم يُسحب
  P({ id: "drawn", stage: 2, usedJuz: range(1, 10), parts: range(11, 20) }),                                // سُحب لها ولم تبدأ اللجنة
  P({ id: "inProgress", stage: 2, usedJuz: range(1, 10), parts: range(11, 20) }),                           // قيد الاختبار
  P({ id: "noParts", stage: 3, usedJuz: range(1, 20) }),                                                     // نجحت قبلاً وتنتظر أجزاء
  P({ id: "withdrawnOld", stage: 1, withdrawn: true, score: 0 }),                                             // منسحبة بلا اختبار
  P({ id: "withdrawnNov", stage: 1, withdrawn: true, score: 0, lastGradedDrawId: "d7" }),                     // سُجّلت منسحبة على اختبار بتشرين الثاني
];
const draws = [
  D("d1", "passedNov", 1, "2026-11-18T08:00:00.000Z"),
  D("d2a", "failedNov", 2, "2026-09-25T08:00:00.000Z"), D("d2b", "failedNov", 2, "2026-11-18T08:00:00.000Z", range(11, 20)),
  D("d3", "failedSep", 1, "2026-09-25T08:00:00.000Z"),
  D("d5", "drawn", 2, "2026-11-19T08:00:00.000Z", range(11, 20)),
  D("d6", "inProgress", 2, "2026-11-19T08:00:00.000Z", range(11, 20)),
  D("d7", "withdrawnNov", 1, "2026-11-18T08:00:00.000Z"),
];
const sessions = [
  S("s1", "passedNov", "d1", 1, "final", "2026-11-20T10:00:00.000Z", 95),
  S("s2a", "failedNov", "d2a", 1, "final", "2026-09-26T10:00:00.000Z", 92),
  S("s2b", "failedNov", "d2b", 2, "final", "2026-11-20T11:00:00.000Z", 70),
  S("s3", "failedSep", "d3", 1, "final", "2026-09-26T11:00:00.000Z", 60),
  S("s6", "inProgress", "d6", 2, "in_progress", null, null),
  S("s7", "withdrawnNov", "d7", 1, "final", "2026-11-21T10:00:00.000Z", 0, { withdrawn: true }),
];
load(participants, draws, sessions);

// ١) جولات مشتقة: شهر لكل جولة، والأخير مفتوح
const rounds = run("diwanRounds()");
assert.strictEqual(rounds.length, 2, "جولتان: أيلول وتشرين الثاني");
assert.ok(rounds[0].closedAt && !rounds[1].closedAt, "أيلول مغلقة، تشرين الثاني مفتوحة");
assert.ok(/أيلول/.test(rounds[0].name) && /تشرين الثاني/.test(rounds[1].name), `الأسماء بالشهور: ${rounds.map(r => r.name).join(" / ")}`);
assert.strictEqual(run("diwanOpenRound()").id, rounds[1].id);

// ٢) الحالات الثلاث بالجولة المفتوحة
const st = id => statusOf(id);
assert.strictEqual(st("passedNov").key, "done", "نجحت بهذه الجولة = انتهت (حتى بعد انتقالها)");
assert.strictEqual(st("passedNov").kind, "passed");
assert.strictEqual(st("failedNov").key, "done", "رسبت بهذه الجولة = انتهت");
assert.strictEqual(st("failedNov").kind, "failed");
assert.strictEqual(st("failedSep").key, "todo", "رسوب جولة سابقة بلا إعادة = لم تجهز");
assert.deepStrictEqual([st("readyParts").key, st("readyParts").sub], ["ready", "parts"], "لها أجزاء = جاهزة (بانتظار السحب)");
assert.deepStrictEqual([st("drawn").key, st("drawn").sub], ["ready", "drawn"], "سُحب لها = جاهزة (بانتظار اللجنة)");
assert.deepStrictEqual([st("inProgress").key, st("inProgress").sub], ["ready", "in_progress"], "قيد الاختبار = جاهزة");
assert.strictEqual(st("noParts").key, "todo", "بلا أجزاء = لم تجهز");
assert.strictEqual(st("withdrawnOld").key, "out", "منسحبة بلا اختبار = خارج الجولة");
assert.deepStrictEqual([st("withdrawnNov").key, st("withdrawnNov").kind], ["done", "withdrawn"], "منسحبة على اختبار بهذه الجولة = انتهت (منسحبة)");

// ٣) نتائج الجولة: فقط ما اعتُمد ضمنها — وأيلول بالأرشيف بنتائجها
assert.deepStrictEqual([...run("diwanRoundSessions(diwanOpenRound()).map(s=>s.id).sort()")], ["s1", "s2b", "s7"]);
assert.deepStrictEqual([...run("diwanRoundSessions(diwanRounds()[0]).map(s=>s.id).sort()")], ["s2a", "s3"]);
const jobs = run("diwanRoundDocumentJobs(diwanOpenRound()).map(j=>j.participant.id+':'+j.kind)");
assert.deepStrictEqual([...jobs].sort(), ["failedNov:recommendation", "passedNov:certificate"], "وثائق الجولة: شهادة للناجحة وتوصية للراسبة، والمنسحبة بلا وثيقة");

// ٤) إغلاق الجولة ثم بدء جولة جديدة — تُحفظ بالإعدادات، والطالبات ينتقلن كما هنّ
run("diwanMaterializeRounds();diwanState.config.rounds.find(r=>!r.closedAt).closedAt='2026-11-24T12:00:00.000Z'");
assert.strictEqual(run("diwanOpenRound()"), null, "بعد الإغلاق: لا جولة مفتوحة");
assert.strictEqual(run("diwanRounds().length"), 2, "الجولات محفوظة بالإعدادات");
run("diwanState.config.rounds.push({id:'R-new',name:'جولة كانون الثاني 2027',startedAt:'2026-11-24T12:00:01.000Z',closedAt:null})");
assert.strictEqual(run("diwanOpenRound().id"), "R-new");
assert.strictEqual(st("passedNov").key, "todo", "بالجولة الجديدة: الناجحة سابقاً تنتظر أجزاء اختبارها التالي");
assert.strictEqual(st("failedNov").key, "todo", "والراسبة بلا إعادة مسجّلة تنتظر أجزاء إعادتها");
// تسجيل إعادة الاختبار (كما يفعل الاستيراد: stageEnteredAt بعد سحب الرسوب فلا يُعدّ حالياً) ← جاهزة
run("diwanState.participants.find(p=>p.id==='failedNov').stageEnteredAt='2026-11-24T13:00:00.000Z'");
assert.deepStrictEqual([st("failedNov").key, st("failedNov").sub], ["ready", "parts"], "بعد تسجيل إعادتها بأجزاء: جاهزة");
assert.strictEqual(st("drawn").key, "ready", "والسحب الذي لم يُمتحن بعد ينتقل معها");
assert.strictEqual(run("diwanRoundSessions(diwanOpenRound()).length"), 0, "لا نتائج بالجولة الجديدة بعد");

// ٥) دمج جولات جهازين: اتحاد، والمغلقة تغلب، ولا تضيع جولة
const merged = sandbox.mergeDiwanRounds(
  [{ id: "A", startedAt: "2026-09-01", closedAt: null }, { id: "B", startedAt: "2026-11-01", closedAt: null }],
  [{ id: "A", startedAt: "2026-09-01", closedAt: "2026-11-01" }, { id: "C", startedAt: "2027-01-01", closedAt: null }]);
assert.deepStrictEqual([...merged.map(r => r.id)], ["A", "B", "C"], "اتحاد مرتب بالبداية");
assert.ok(merged.find(r => r.id === "A").closedAt, "المغلقة بجهاز آخر تبقى مغلقة");
assert.deepStrictEqual([...sandbox.mergeDiwanRounds(null, [{ id: "X", startedAt: "2026-01-01" }]).map(r => r.id)], ["X"], "جهاز بلا جولات محفوظة يأخذ جولات الخادم");

// ٦) بلا أي نتائج معتمدة: لا جولة مشتقة (تظهر «بدء جولة جديدة»)
load([P({ id: "x" })], [], []);
assert.strictEqual(run("diwanRounds().length"), 0);
assert.strictEqual(run("diwanOpenRound()"), null);

// ٦ب) الانسحابات بالجولة: من انسحبت خلالها (بلا اختبار) + من سُجّل انسحابها على اختبار فيها — بلا تكرار
load([
  P({ id: "w1", stage: 1, withdrawn: true, score: 0, scoreSource: "withdrawn", gradedAt: "2026-11-23T10:00:00.000Z" }),
  P({ id: "w2", stage: 1, withdrawn: true, score: 0, scoreSource: "withdrawn", gradedAt: "2026-09-26T10:00:00.000Z" }),
  P({ id: "w3", stage: 1, withdrawn: true, score: 0, scoreSource: "withdrawn", gradedAt: "2026-11-21T10:00:00.000Z", lastGradedDrawId: "dw3" }),
  P({ id: "ok", stage: 2, usedJuz: range(1, 10), lastGradedDrawId: "dok", score: 95 }),
], [D("dw3", "w3", 1, "2026-11-18T08:00:00.000Z"), D("dok", "ok", 1, "2026-09-25T08:00:00.000Z")], [
  S("sw3", "w3", "dw3", 1, "final", "2026-11-21T10:00:00.000Z", 0, { withdrawn: true }),
  S("sok", "ok", "dok", 1, "final", "2026-09-26T10:00:00.000Z", 95),
  S("snov", "ok", "dok", 1, "final", "2026-11-20T10:00:00.000Z", 95),
]);
assert.strictEqual(run("diwanRoundWithdrawals(diwanRounds().find(r=>/تشرين الثاني/.test(r.name)))"), 2, "تشرين الثاني: w1 (بلا اختبار) + w3 (على اختبار) مرة واحدة");
assert.strictEqual(run("diwanRoundWithdrawals(diwanRounds().find(r=>/أيلول/.test(r.name)))"), 1, "أيلول: w2");

// ٦ج) إلغاء جولة بدأت بالخطأ: تُعلَّم ملغاة فتختفي، ودمج جهازين لا يعيدها
run("diwanMaterializeRounds();diwanState.config.rounds.forEach(r=>{if(!r.closedAt)r.closedAt='2026-11-24T00:00:00.000Z'});diwanState.config.rounds.push({id:'R-x',name:'جولة بالخطأ',startedAt:'2026-11-24T01:00:00.000Z',closedAt:null})");
assert.strictEqual(run("diwanOpenRound().id"), "R-x");
sandbox.confirm = () => true; sandbox.toast = () => {};
run("confirmCancelDiwanRound()");
assert.strictEqual(run("diwanOpenRound()"), null, "بعد الإلغاء لا جولة مفتوحة");
assert.ok(!run("diwanRounds().some(r=>r.id==='R-x')"), "الجولة الملغاة لا تظهر");
const mergedCancel = sandbox.mergeDiwanRounds([{ id: "R-x", startedAt: "2026-11-24", closedAt: null }], [{ id: "R-x", startedAt: "2026-11-24", closedAt: null, cancelled: true }]);
assert.ok(mergedCancel[0].cancelled, "دمج جهاز لم يرَ الإلغاء: الإلغاء يغلب");

// ٧) لوحة الإنجاز: الأجزاء المحسوبة تراكمية، المعدل بلا انسحاب ولا «غير مكتمل»، وإنجاز الجولة من draw.credit، والمنسحبة خارج الترتيب
load([
  P({ id: "a", name: "أ", seat: "1", stage: 3, usedJuz: range(1, 20) }),
  P({ id: "b", name: "ب", seat: "2", stage: 2, usedJuz: range(1, 15), stageCredit: 5 }),
  P({ id: "c", name: "ج", seat: "3", stage: 4, usedJuz: range(1, 30), certified: true }),
  P({ id: "w", name: "منسحبة", seat: "4", stage: 1, withdrawn: true, usedJuz: range(1, 30) }),
], [
  D("a1", "a", 2, "2026-11-18T08:00:00.000Z", range(11, 20)),
  Object.assign(D("b1", "b", 2, "2026-11-18T08:00:00.000Z", range(11, 15)), { noPromotion: true, credit: { credited: [11, 12, 13, 14, 15], before: { stage: 2, stageCredit: 0 } } }),
  D("b2", "b", 2, "2026-11-19T08:00:00.000Z", range(16, 25)),
  D("w1", "w", 1, "2026-11-18T08:00:00.000Z"),
], [
  S("sa1", "a", "a1", 2, "final", "2026-11-20T10:00:00.000Z", 96),
  S("sb1", "b", "b1", 2, "final", "2026-11-20T10:00:00.000Z", 98),
  S("sb2", "b", "b2", 2, "final", "2026-11-21T10:00:00.000Z", 0, { incomplete: true }),
  S("sw1", "w", "w1", 1, "final", "2026-11-21T10:00:00.000Z", 100),
]);
const stats = run("(()=>{const d=diwanStatsData(diwanOpenRound());return {juz:d.byJuz.map(r=>r.p.id+':'+r.juz),avg:d.byAvg.map(r=>r.p.id+':'+r.avg+'/'+r.exams),gain:d.byGain.map(r=>r.p.id+':'+r.gained),active:d.totals.active,certified:d.totals.certified}})()");
assert.deepStrictEqual([...stats.juz], ["c:30", "a:20", "b:15"], "الأكثر أجزاءً: الحافظة 30، والمنسحبة خارج الترتيب");
// «الأعلى معدّلاً»: الأكثر أجزاءً (بالجولة: الجديدة المكتسبة) أولاً ثم المعدل — «أ» كسبت 10 بعلامة 96 قبل «ب» 5 بعلامة 98
assert.deepStrictEqual([...stats.avg], ["a:96/1", "b:98/1"], "الأجزاء أولاً ثم المعدل، بلا «غير مكتمل» وبلا منسحبات");
const statsAll = run("diwanStatsData().byAvg.map(r=>r.p.id)");
assert.deepStrictEqual([...statsAll], ["a", "b"], "كل الجولات: بالأجزاء المحسوبة تراكمياً (20 قبل 15) ثم المعدل");
assert.deepStrictEqual([...stats.gain], ["a:10", "b:5"], "إنجاز الجولة: نجاح مُرقٍّ 10، وخمسة بلا انتقال من credit");
assert.strictEqual(stats.active, 3);
assert.strictEqual(stats.certified, 1);

console.log("diwan-rounds.test.js: نجح — الجولات المشتقة، الحالات الثلاث، نسب الاختبار للجولة، الوثائق، البدء والإغلاق، ودمج جهازين");
