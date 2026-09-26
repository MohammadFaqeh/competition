// اختبار آلي لمنطق الإدارة بنظام "اختبارات ديوان الحفاظ" الجديد (مراحل متتالية ١→٢→٣→نهائي):
// drawOnePositionPerJuz (موضع واحد من كل جزء مختار)، makeDiwanStageDraw (١٠ مواضع لمراحل ١-٣)،
// makeDiwanFinalDraw (١٨ موضعاً: ٦ من كل ثلث)، ترقية/إبقاء المرحلة عبر mergeFinalDiwanSessionsIntoState
// حسب DIWAN_PASS_SCORE=85 (لا PASS_SCORE=75 السنوي)، وإحصائيات renderDiwanParticipants.
// شغّله: node tests/diwan-admin-ui.test.js
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
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => { if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false } classes.add(c); return true } if (force) classes.add(c); else classes.delete(c); return force },
      contains: (c) => classes.has(c),
    },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null },
    querySelector() { return makeElement() }, querySelectorAll() { return [] },
    closest() { return makeElement() }, appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, click() {},
  };
}
const elementCache = new Map();
const modalEl = makeElement(); modalEl.classList.add("hidden"); elementCache.set("#modal", modalEl);
function queryElement(sel) { if (!elementCache.has(sel)) elementCache.set(sel, makeElement()); return elementCache.get(sel) }

const localStorageStore = new Map();
const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
    setItem: (k, v) => localStorageStore.set(k, v),
    removeItem: (k) => localStorageStore.delete(k),
  },
  document: {
    readyState: "complete", hidden: false, addEventListener() {},
    querySelector: (sel) => queryElement(sel), querySelectorAll: () => [],
    documentElement: { lang: "ar", dir: "rtl" }, body: makeElement(),
  },
  window: {},
  navigator: { onLine: true },
  crypto: require("crypto").webcrypto,
  TextEncoder,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" },
  history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {},
  setTimeout, clearTimeout,
  lucide: { createIcons() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

async function run() {
  // مواضع مصطنعة تغطي الـ30 جزءاً كاملة (موضعان لكل جزء) — كافية لاختبار مراحل ١-٣ (10 أجزاء)
  // والاختبار النهائي (30 جزءاً موزّعة على 3 مجموعات ثابتة).
  const fakeCandidates = [];
  for (let juz = 1; juz <= 30; juz++) {
    for (let n = 1; n <= 2; n++) fakeCandidates.push({ id: `pos-${juz}-${n}`, juz, page: juz, words: 40, lineCount: 8, startKey: `${juz}:1`, endKey: `${juz}:5` });
  }
  vm.runInContext('candidates = __c;', Object.assign(sandbox, { __c: fakeCandidates }));
  sandbox.ensureQuranReady = async () => vm.runInContext("candidates", sandbox);
  sandbox.window.CloudCompetition = { context: {} }; // وضع محلي (operationMode !=="cloud")

  vm.runInContext('diwanState = defaultDiwanState();', sandbox);

  // 1) drawOnePositionPerJuz: موضع واحد بالضبط من كل جزء مختار، بلا تكرار جزء، وخطأ عند نقص المجموعة
  const juzPool10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const positions10 = sandbox.drawOnePositionPerJuz(juzPool10, 10);
  assert.strictEqual(positions10.length, 10, "10 مواضع من 10 أجزاء مختارة");
  assert.strictEqual(new Set(positions10.map(p => p.juz)).size, 10, "كل موضع من جزء مختلف (لا تكرار جزء)");
  assert.ok(positions10.every(p => juzPool10.includes(p.juz)), "كل المواضع من الأجزاء العشرة المختارة فقط");
  assert.throws(() => sandbox.drawOnePositionPerJuz([1, 2], 5), /لا توجد مواضع كافية/, "خطأ واضح عند طلب عدد أكبر من الأجزاء المتاحة");

  // 2) إضافة متسابق ديوان الحفاظ — يبدأ دائماً بالمرحلة 1، مستقل تماماً عن state.participants (السنوية)
  const participant = { id: "DP1", name: "أحمد", seat: "001", serialNumber: "S-001", gender: "ذكر", center: "مجتمع محلي", age: 12, stage: 1, usedJuz: [], parts: [], level: 10, createdAt: new Date().toISOString() };
  vm.runInContext('diwanState.participants.push(__p);', Object.assign(sandbox, { __p: participant }));
  assert.strictEqual(vm.runInContext("diwanState.participants.length", sandbox), 1, "المتسابق أُضيف لـdiwanState");
  assert.strictEqual(vm.runInContext("state.participants.length", sandbox), 0, "state (السنوية) لم يتأثر إطلاقاً");

  // 3) makeDiwanStageDraw: سحب مرحلة ١ (10 مواضع، جزء واحد من كل جزء مختار)
  const stageDraw = await sandbox.makeDiwanStageDraw(participant, juzPool10);
  assert.strictEqual(stageDraw.participantId, "DP1", "السحب مرتبط بالمتسابق الصحيح");
  assert.strictEqual(stageDraw.stage, 1, "السحب مُعلَّم بمرحلة المتسابق الحالية");
  assert.strictEqual(stageDraw.positions.length, 10, "10 مواضع لمرحلة من 10 أجزاء (لا نسبة LEVEL_QUESTIONS السنوية)");
  assert.ok(stageDraw.id.startsWith("DDRAW-"), "معرّف السحب ببادئة ديوان الحفاظ المستقلة (DDRAW)");
  participant.parts = juzPool10;
  vm.runInContext('diwanState.draws.push(__d);', Object.assign(sandbox, { __d: stageDraw }));

  // 4) makeDiwanFinalDraw: القرآن كامل تلقائياً — 18 موضعاً (6 من كل ثلث)، بلا اختيار أجزاء يدوي
  const finalParticipant = { id: "DP2", name: "سارة", seat: "002", serialNumber: "S-002", gender: "أنثى", center: "مركز آخر", age: 20, stage: 4, usedJuz: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20], parts: [], level: 30, createdAt: new Date().toISOString() };
  const finalDraw = await sandbox.makeDiwanFinalDraw(finalParticipant);
  assert.strictEqual(finalDraw.stage, 4, "سحب المرحلة النهائية مُعلَّم بالمرحلة 4");
  assert.strictEqual(finalDraw.positions.length, 18, "18 موضعاً بالضبط (6+6+6)");
  const bandCounts = [[1,10],[11,20],[21,30]].map(([from,to]) => finalDraw.positions.filter(p => p.juz >= from && p.juz <= to).length);
  assert.deepStrictEqual(bandCounts, [6, 6, 6], "6 مواضع بالضبط من كل ثلث من القرآن");

  // 5) mergeFinalDiwanSessionsIntoState: نجاح (>=85) يرحّل الأجزاء إلى usedJuz ويرقّي المرحلة؛ رسوب يبقيها كما هي
  const passSession = { participant_id: "DP1", draw_id: stageDraw.id, stage: 1, status: "final", score: 85, finalized_at: new Date().toISOString(), assessment: {} };
  vm.runInContext('mergeFinalDiwanSessionsIntoState([__s]);', Object.assign(sandbox, { __s: passSession }));
  assert.strictEqual(participant.stage, 2, "المرحلة ترقّت إلى 2 بعد نجاح بعلامة 85 (>= DIWAN_PASS_SCORE=85)");
  assert.deepStrictEqual([...participant.usedJuz].sort((a,b)=>a-b), juzPool10, "الأجزاء العشرة المُمتحَنة انتقلت إلى usedJuz");
  assert.strictEqual(JSON.stringify(participant.parts), "[]", "الأجزاء المختارة تُصفَّر استعداداً لاختيار جديد بالمرحلة التالية");

  // إعادة إرسال نفس الجلسة (draw_id نفسه) لا يجب أن تُرقّي المرحلة مرتين (idempotency عبر lastGradedDrawId)
  vm.runInContext('mergeFinalDiwanSessionsIntoState([__s]);', Object.assign(sandbox, { __s: passSession }));
  assert.strictEqual(participant.stage, 2, "لا ترقية مضاعفة لنفس الجلسة المُعالَجة مسبقاً");

  const stage2Draw = { id: "DDRAW-STAGE2", participantId: "DP1", stage: 2, positions: [], createdAt: new Date().toISOString() };
  vm.runInContext('diwanState.draws.push(__d);', Object.assign(sandbox, { __d: stage2Draw }));
  const failSession = { participant_id: "DP1", draw_id: stage2Draw.id, stage: 2, status: "final", score: 60, finalized_at: new Date().toISOString(), assessment: {} };
  vm.runInContext('mergeFinalDiwanSessionsIntoState([__s]);', Object.assign(sandbox, { __s: failSession }));
  assert.strictEqual(participant.stage, 2, "الرسوب (60 < 85) يبقي المتسابق بنفس المرحلة");
  assert.strictEqual(sandbox.diwanParticipantStatusOf(participant), "failed", "الحالة المشتقة: راسب لأن آخر جلسة لمرحلته الحالية مُعتمدة برسوب");

  // 6) نجاح المرحلة 4 (النهائي) يُعلّم certified بدل ترقية المرحلة لرقم وهمي 5
  const stage4Participant = { id: "DP3", name: "خالد", seat: "003", serialNumber: "S-003", gender: "ذكر", center: "مركز", age: 22, stage: 4, usedJuz: Array.from({length:20},(_,i)=>i+1), parts: Array.from({length:30},(_,i)=>i+1), level: 30, createdAt: new Date().toISOString() };
  vm.runInContext('diwanState.participants.push(__p);', Object.assign(sandbox, { __p: stage4Participant }));
  const stage4Draw = { id: "DDRAW-FINAL", participantId: "DP3", stage: 4, positions: [], createdAt: new Date().toISOString() };
  vm.runInContext('diwanState.draws.push(__d);', Object.assign(sandbox, { __d: stage4Draw }));
  const finalPassSession = { participant_id: "DP3", draw_id: stage4Draw.id, stage: 4, status: "final", score: 92, finalized_at: new Date().toISOString(), assessment: {} };
  vm.runInContext('mergeFinalDiwanSessionsIntoState([__s]);', Object.assign(sandbox, { __s: finalPassSession }));
  assert.strictEqual(stage4Participant.stage, 4, "المرحلة تبقى 4 (لا رقم وهمي 5)");
  assert.strictEqual(stage4Participant.certified, true, "certified=true بعد اجتياز الاختبار النهائي");
  assert.strictEqual(stage4Participant.certificateNumber, 1, "أول شهادة حافظ تأخذ الرقم التسلسلي 1");
  assert.strictEqual(sandbox.diwanParticipantStatusOf(stage4Participant), "certified", "الحالة المشتقة: حافظ معتمد");

  // 7) إحصائيات renderDiwanParticipants: نسبة النجاح مبنية على عدد المعتمدين (certified) لا على مقارنة علامة فردية
  // (DP2/finalParticipant لم يُضَف لـdiwanState.participants فعلياً — استُخدم فقط لاختبار makeDiwanFinalDraw بمعزل)
  sandbox.renderDiwanParticipants();
  assert.strictEqual(queryElement("#diwanStatTotal").textContent, "2", "إجمالي المتسابقين = 2 (DP1 وDP3)");
  assert.strictEqual(queryElement("#diwanStatExamined").textContent, "2", "كلاهما له علامة مسجَّلة (DP1=60 بعد الرسوب، DP3=92)");
  assert.strictEqual(queryElement("#diwanStatPassRate").textContent, "50%", "معتمد واحد (DP3) من أصل 2 = 50%");

  // 8) دوال توليد الشهادات/التوصيات (الجزء النقي منها — بلا html2canvas/jsPDF غير المتاحين هنا)
  assert.strictEqual(sandbox.diwanGenderWord({ gender: "أنثى" }, "الحافظ", "الحافظة"), "الحافظة", "الأنثى تأخذ الصيغة المؤنثة");
  assert.strictEqual(sandbox.diwanGenderWord({ gender: "ذكر" }, "الحافظ", "الحافظة"), "الحافظ", "الذكر يأخذ الصيغة المذكّرة");
  assert.strictEqual(sandbox.diwanGenderWord({}, "الحافظ", "الحافظة"), "الحافظ", "الافتراضي مذكّر عند غياب الجنس");
  assert.strictEqual(sandbox.formatDiwanCertDate(new Date(2026, 0, 5).toISOString()), "05/01/2026", "تنسيق التاريخ DD/MM/YYYY");
  assert.strictEqual((sandbox.diwanJuzGridHtml(new Set([1, 5, 30])).match(/class="marked"/g) || []).length, 3, "3 أجزاء مُظلَّلة بالضبط لمجموعة {1,5,30}");
  assert.ok(sandbox.diwanJuzGridHtml(new Set()).includes(">30<"), "الشبكة تغطي الأجزاء الثلاثين كاملة");

  const historyParticipant = { id: "DP4", name: "منى", gender: "أنثى", stage: 3, usedJuz: [], parts: [], level: 10, seat: "004", center: "مركز" };
  vm.runInContext('diwanState.participants.push(__p);', Object.assign(sandbox, { __p: historyParticipant }));
  const historyDraw1 = { id: "DDRAW-H1", participantId: "DP4", stage: 1, eligibleParts: [1,2,3,4,5,6,7,8,9,10], positions: [], createdAt: new Date().toISOString() };
  const historyDraw2 = { id: "DDRAW-H2", participantId: "DP4", stage: 2, eligibleParts: [11,12,13,14,15,16,17,18,19,20], positions: [], createdAt: new Date().toISOString() };
  vm.runInContext('diwanState.draws.push(__d1, __d2);', Object.assign(sandbox, { __d1: historyDraw1, __d2: historyDraw2 }));
  const historySession1 = { participant_id: "DP4", draw_id: historyDraw1.id, stage: 1, status: "final", score: 85, finalized_at: new Date().toISOString(), assessment: {} };
  const historySession2 = { participant_id: "DP4", draw_id: historyDraw2.id, stage: 2, status: "final", score: 90, finalized_at: new Date().toISOString(), assessment: {} };
  vm.runInContext('diwanAdminSessions = [__s1, __s2];', Object.assign(sandbox, { __s1: historySession1, __s2: historySession2 }));

  const foundSession = sandbox.diwanSessionForDraw(historyDraw2);
  assert.strictEqual(foundSession.score, 90, "diwanSessionForDraw يجد الجلسة الصحيحة بمعرّف السحب (draw_id)");

  const cumulativeThroughStage2 = sandbox.diwanCumulativeJuzThroughStage(historyParticipant, 2);
  assert.strictEqual(JSON.stringify([...cumulativeThroughStage2].sort((a, b) => a - b)), JSON.stringify(Array.from({ length: 20 }, (_, i) => i + 1)), "اتحاد أجزاء كل محاولة ناجحة حتى المرحلة 2 (20 جزءاً)");
  const cumulativeStage1Only = sandbox.diwanCumulativeJuzThroughStage(historyParticipant, 1);
  assert.strictEqual(cumulativeStage1Only.size, 10, "الاقتصار على المرحلة 1 فقط يعطي 10 أجزاء لا 20");

  // 7) عتبة النجاح 85 بالضبط: 84.99 راسب، 85 ناجح، ولا ترقية ولا شهادة لمن دون 85 (الرقم التسلسلي إجباري قبل السحب)
  {
    const p = { id: "DP5", name: "هدى", seat: "005", serialNumber: "S-005", gender: "أنثى", center: "مركز", stage: 4, usedJuz: Array.from({length:20},(_,i)=>i+1), parts: Array.from({length:30},(_,i)=>i+1), level: 30, createdAt: new Date().toISOString() };
    vm.runInContext('diwanState.participants.push(__p);', Object.assign(sandbox, { __p: p }));
    const d = { id: "DDRAW-T85", participantId: "DP5", stage: 4, eligibleParts: p.parts, createdAt: new Date().toISOString() };
    vm.runInContext('diwanState.draws.push(__d);', Object.assign(sandbox, { __d: d }));
    sandbox.mergeFinalDiwanSessionsIntoState([{ participant_id: "DP5", draw_id: "DDRAW-T85", stage: 4, status: "final", score: 84.99, finalized_at: new Date().toISOString(), assessment: {} }]);
    assert.strictEqual(p.certified, undefined, "84.99 لا يمنح شهادة حافظ");
    const p2 = { id: "DP6", name: "لينا", seat: "006", serialNumber: "S-006", gender: "أنثى", center: "مركز", stage: 4, usedJuz: [], parts: [], level: 30, createdAt: new Date().toISOString() };
    vm.runInContext('diwanState.participants.push(__p);', Object.assign(sandbox, { __p: p2 }));
    sandbox.mergeFinalDiwanSessionsIntoState([{ participant_id: "DP6", draw_id: "DDRAW-T85B", stage: 4, status: "final", score: 100, finalized_at: new Date().toISOString(), assessment: { incomplete: true } }]);
    assert.strictEqual(p2.certified, undefined, "«غير مكتمل» لا يمنح شهادة حتى لو رقم العلامة داخلياً 100");
    const p3 = { id: "DP7", name: "دعاء", seat: "007", serialNumber: "S-007", gender: "أنثى", center: "مركز", stage: 4, usedJuz: [], parts: [], level: 30, createdAt: new Date().toISOString() };
    vm.runInContext('diwanState.participants.push(__p);', Object.assign(sandbox, { __p: p3 }));
    sandbox.mergeFinalDiwanSessionsIntoState([{ participant_id: "DP7", draw_id: "DDRAW-T85C", stage: 4, status: "final", score: 85, finalized_at: new Date().toISOString(), assessment: {} }]);
    assert.strictEqual(p3.certified, true, "85 بالضبط = ناجح");
    // بلا رقم تسلسلي: السحب مرفوض
    const noSerial = { id: "DP8", name: "بلا رقم", seat: "008", gender: "أنثى", center: "مركز", stage: 4, usedJuz: [], parts: [], level: 30, createdAt: new Date().toISOString() };
    await assert.rejects(() => sandbox.makeDiwanFinalDraw(noSerial), /الرقم التسلسلي/, "لا سحب نهائي بلا رقم تسلسلي");
    await assert.rejects(() => sandbox.makeDiwanStageDraw(noSerial, [1,2,3,4,5,6,7,8,9,10]), /الرقم التسلسلي/, "لا سحب مرحلي بلا رقم تسلسلي");
    // الشهادة/التوصية: بيانات المتسابق + الرقم التسلسلي + الأجزاء المظلَّلة من سحب المحاولة نفسها + توصية بنقاط مرقّمة
    const tenParts = [2,5,7,11,12,19,20,24,27,30];
    const stageDraw10 = { id: "DDRAW-T10", participantId: "DP7", stage: 1, eligibleParts: tenParts, createdAt: new Date().toISOString() };
    const stageCert = sandbox.diwanHafizCertificateHtml(p3, stageDraw10, { score: 91, finalized_at: "2026-03-05T10:00:00Z" }, "data:image/png;base64,AA==");
    assert.ok(stageCert.includes(">S-007<"), "الرقم التسلسلي يظهر بخانته بالشهادة");
    assert.strictEqual((stageCert.match(/hc-part is-marked/g) || []).length, 10, "تُظلَّل بالضبط الأجزاء العشرة المسجَّلة بسحب الاختبار");
    assert.ok(/hc-part is-marked[^>]*>30</.test(stageCert) && !/hc-part is-marked[^>]*>1</.test(stageCert), "الجزء 30 مظلَّل والجزء 1 لا");
    assert.ok(stageCert.includes("فرع الكورة أنّ <u") && !stageCert.includes("الطالبة") && !stageCert.includes("الطالب:"), "الشهادة: «أنّ [الاسم]» بلا كلمة الطالبة");
    assert.ok(stageCert.includes("دعاء") && stageCert.includes("05/03/2026") && stageCert.includes("مركز"), "الاسم والتاريخ والمركز تُعبَّأ");
    const finalCert = sandbox.diwanHafizCertificateHtml({ ...p3, certificateNumber: 7 }, { stage: 4, eligibleParts: Array.from({length:30},(_,i)=>i+1) }, { score: 90, finalized_at: "2026-03-05T10:00:00Z" }, "data:,");
    assert.strictEqual((finalCert.match(/hc-part is-marked/g) || []).length, 30, "الاختبار النهائي: كل الأجزاء الثلاثين مظلَّلة");
    assert.ok(!finalCert.includes(">0007<") && finalCert.includes(">S-007<"), "لا يُطبع رقم شهادة؛ الرقم التسلسلي وحده يظهر");
    const recHtml = sandbox.diwanRecommendationHtml(p, { stage: 2, eligibleParts: tenParts }, { status: "final", score: 70, assessment: { recommendation: ["نقطة أولى", "نقطة ثانية"] } }, "data:,");
    assert.ok(recHtml.includes('<span class="hc-rec-num">1.</span>نقطة أولى') && recHtml.includes('<span class="hc-rec-num">2.</span>نقطة ثانية'), "التوصية تُطبع كنقاط مرقّمة");
    // توصية الإدارة (draw.adminRecommendation) تُقدَّم على توصية اللجنة، وتُستخدم حتى لو نسيتها اللجنة
    const recAdmin = sandbox.diwanRecommendationHtml(p, { stage: 2, eligibleParts: tenParts, adminRecommendation: ["نقطة الإدارة"] }, { status: "final", score: 70, assessment: { recommendation: ["نقطة اللجنة"] } }, "data:,");
    assert.ok(recAdmin.includes("نقطة الإدارة") && !recAdmin.includes("نقطة اللجنة"), "توصية الإدارة تحل محل توصية اللجنة");
    const recForgot = sandbox.diwanRecommendationHtml(p, { stage: 2, eligibleParts: tenParts, adminRecommendation: ["كتبتها الإدارة"] }, { status: "final", score: 70, assessment: {} }, "data:,");
    assert.ok(recForgot.includes("كتبتها الإدارة"), "تُطبع توصية الإدارة حين لا توجد توصية من اللجنة");
    assert.ok(recHtml.includes("الاختبار الثاني"), "عنوان الاختبار الفرعي بقالب التوصية يتبع مرحلة المحاولة");
    const recIncomplete = sandbox.diwanRecommendationHtml(p, { stage: 4, eligibleParts: [1] }, { status: "final", score: 100, assessment: { incomplete: true } }, "data:,");
    assert.ok(recIncomplete.includes("غير مكتمل"), "«غير مكتمل» يظهر بدل الرقم الداخلي");
    // وثيقة التوصية: عمودية، عنوانها «وثيقة توصية»، الاسم أعلاها بلا «الطالبة»، بلا أجزاء/موعد إعادة/ملاحظات/رقم شهادة/مدير،
    // الرقم التسلسلي مرة واحدة، «ملاحظات اللجنة»، توقيع أعضاء اللجنة من بياناتها، والتاريخ سنة/شهر/يوم.
    vm.runInContext('cloudCommittees = [{ id: "C9", name: "لجنة ٩", chairman_name: "رئيس التجربة", member_name: "عضو التجربة" }];', sandbox);
    const recDoc = sandbox.diwanRecommendationHtml({ ...p, serialNumber: "S-777" }, { stage: 2, eligibleParts: tenParts }, { status: "final", score: 70, finalized_at: "2026-09-21T10:00:00Z", assessment: { committee: { id: "C9", name: "لجنة ٩" } } }, "data:,");
    assert.ok(recDoc.includes("hc-rec") && recDoc.includes(">وثيقة توصية<") && !recDoc.includes("توصية اللجنة"), "العنوان «وثيقة توصية»");
    assert.ok(recDoc.includes("فرع الكورة – هدى") && !recDoc.includes("الطالبة"), "الاسم أعلى الوثيقة بلا كلمة الطالبة");
    assert.ok(recDoc.includes('<div class="hc-label">الاسم</div>') && !recDoc.includes("اسم الطالب"), "حقل الاسم بعنوان «الاسم»");
    assert.ok(!recDoc.includes("hc-part") && !recDoc.includes("الأجزاء") && !recDoc.includes("موعد إعادة") && !recDoc.includes("ملاحظات:"), "لا أجزاء ولا موعد إعادة ولا حقل ملاحظات");
    assert.ok(!recDoc.includes("رقم الشهادة") && !recDoc.includes("مدير الفرع") && !recDoc.includes("قيس العوايشة") && !recDoc.includes(">005<"), "لا رقم شهادة ولا رقم جلوس ولا توقيع مدير");
    assert.strictEqual((recDoc.match(/S-777/g) || []).length, 1, "الرقم التسلسلي يظهر مرة واحدة فقط");
    assert.ok(recDoc.includes(">ملاحظات اللجنة<"), "عنوان «ملاحظات اللجنة»");
    assert.ok(recDoc.includes("رئيس التجربة") && recDoc.includes("عضو التجربة"), "التوقيع باسم رئيس اللجنة وعضوها من بيانات اللجنة");
    assert.ok(recDoc.includes('<bdi dir="ltr">2026/09/21</bdi>') && !recDoc.includes("21/09/2026"), "التاريخ بصيغة سنة/شهر/يوم");
    const recSnapshot = sandbox.diwanRecommendationHtml(p, { stage: 2 }, { status: "final", score: 70, assessment: { committeeChairmanName: "رئيس محفوظ" } }, "data:,");
    assert.ok(recSnapshot.includes("رئيس محفوظ") && !recSnapshot.includes("عضو اللجنة"), "لقطة أسماء اللجنة المحفوظة بالتقييم تُستخدم عند غياب اللجنة، ولا سطر لعضو غير موجود");
    const recNoNames = sandbox.diwanRecommendationHtml(p, { stage: 2 }, { status: "final", score: 70, assessment: {} }, "data:,");
    assert.ok(recNoNames.includes("رئيس اللجنة") && recNoNames.includes("عضو اللجنة"), "بلا أي أسماء: سطرا توقيع فارغان للرئيس والعضو");
    vm.runInContext('cloudCommittees = [];', sandbox);
  }

  // 9) لوحة الصناديق الأربعة + النقل اليدوي لمرحلة (يبدأ من جديد ولا يعيد تطبيق نتائج قديمة) + منتقي أجزاء لا يمنع المُختبَرة سابقاً
  {
    sandbox.renderDiwanParticipants();
    const boardHtml = queryElement("#diwanStageBoard").innerHTML;
    assert.strictEqual((boardHtml.match(/data-open-stage="/g) || []).length, 4, "أربعة صناديق ملخّص للمراحل");
    assert.ok(!boardHtml.includes("data-diwan-move-stage") && !boardHtml.includes("خالد"), "الصناديق أعداد فقط بلا بطاقات متسابقين");
    sandbox.openDiwanStage(4);
    const stagePageHtml = queryElement("#diwanStageParticipants").innerHTML;
    assert.ok(stagePageHtml.includes("خالد") && stagePageHtml.includes("data-diwan-move-stage"), "صفحة المرحلة تعرض متسابقيها ببطاقات فيها زر النقل اليدوي لمرحلة");
    assert.ok(!stagePageHtml.includes("أحمد"), "صفحة المرحلة 4 لا تعرض متسابقي مراحل أخرى");
    sandbox.closeDiwanStage();
    queryElement("#diwanParticipantSearch").value = "خالد";
    sandbox.renderDiwanParticipants();
    assert.ok(queryElement("#diwanSearchResults").innerHTML.includes("خالد"), "البحث السريع يعرض النتيجة من أي مرحلة");
    queryElement("#diwanParticipantSearch").value = "";
    sandbox.renderDiwanParticipants();
    const pm = { id: "DP9", name: "سلمى", seat: "009", serialNumber: "S-009", gender: "أنثى", center: "مركز", stage: 2, usedJuz: [1,2,3,4,5,6,7,8,9,10], parts: [11,12,13,14,15,16,17,18,19,20], level: 10, createdAt: new Date().toISOString() };
    vm.runInContext('diwanState.participants.push(__p);', Object.assign(sandbox, { __p: pm }));
    const dOld = { id: "DDRAW-M1", participantId: "DP9", stage: 1, eligibleParts: [1,2,3,4,5,6,7,8,9,10], createdAt: "2026-01-01T00:00:00Z" };
    const dCur = { id: "DDRAW-M2", participantId: "DP9", stage: 2, eligibleParts: pm.parts, createdAt: "2026-01-02T00:00:00Z" };
    vm.runInContext('diwanState.draws.push(__a, __b);', Object.assign(sandbox, { __a: dOld, __b: dCur }));
    assert.strictEqual(sandbox.currentDiwanDraw(pm, vm.runInContext('diwanState.draws', sandbox)).id, "DDRAW-M2", "قبل النقل: سحب المرحلة الحالية");
    assert.strictEqual(sandbox.moveDiwanParticipantToStage(pm, 1), true, "نقل يدوي للمرحلة الأولى ينجح");
    assert.strictEqual(pm.stage, 1); assert.strictEqual(pm.parts.length, 0, "الأجزاء تُفرَّغ بعد النقل"); assert.ok(pm.stageEnteredAt, "يُسجَّل وقت دخول المرحلة");
    assert.strictEqual(sandbox.currentDiwanDraw(pm, vm.runInContext('diwanState.draws', sandbox)), null, "بعد النقل لا يُعدّ سحب قديم بالمرحلة سحباً حالياً (حالة: لم يتم اختيار الأجزاء)");
    sandbox.mergeFinalDiwanSessionsIntoState([{ participant_id: "DP9", draw_id: "DDRAW-M1", stage: 1, status: "final", score: 95, finalized_at: "2026-01-01T01:00:00Z", assessment: {} }]);
    assert.strictEqual(pm.stage, 1, "نتيجة قديمة (قبل النقل) لا ترقّي المتسابق من جديد");
    const dNew = { id: "DDRAW-M3", participantId: "DP9", stage: 1, eligibleParts: [1,2,3,4,5,6,7,8,9,10], createdAt: new Date(Date.now() + 1000).toISOString() };
    vm.runInContext('diwanState.draws.push(__a);', Object.assign(sandbox, { __a: dNew }));
    assert.strictEqual(sandbox.currentDiwanDraw(pm, vm.runInContext('diwanState.draws', sandbox)).id, "DDRAW-M3", "سحب جديد بعد النقل يُعدّ سحب المرحلة");
    sandbox.mergeFinalDiwanSessionsIntoState([{ participant_id: "DP9", draw_id: "DDRAW-M3", stage: 1, status: "final", score: 90, finalized_at: new Date(Date.now() + 2000).toISOString(), assessment: {} }]);
    assert.strictEqual(pm.stage, 2, "نتيجة ناجحة جديدة تنقله تلقائياً للمرحلة التالية");
    assert.strictEqual(sandbox.moveDiwanParticipantToStage(pm, 9), false, "مرحلة غير صالحة مرفوضة");
  }

  // 10) الأجزاء تُسحب تلقائياً من Excel/CSV (١٠ بالضبط)، ولا تتغير أجزاء من له سحب بانتظار اللجنة، ثم «سحب للجميع» يستخدمها بلا اختيار يدوي
  {
    const pending = { id: "DP-PEND", name: "رهف", seat: "103", serialNumber: "S-103", gender: "أنثى", center: "مركز", stage: 1, usedJuz: [], parts: [1,2,3,4,5,6,7,8,9,10], level: 10, createdAt: new Date().toISOString() };
    vm.runInContext('diwanState.participants.push(__p); diwanState.draws.push(__d);', Object.assign(sandbox, { __p: pending, __d: { id: "DDRAW-PEND", participantId: "DP-PEND", stage: 1, eligibleParts: pending.parts, positions: [], createdAt: new Date().toISOString() } }));
    assert.strictEqual(sandbox.diwanParticipantStatusOf(pending), "pending");
    const pendingPartsBefore = JSON.stringify(pending.parts);
    const csv = [
      "الاسم,رقم الجلوس,الرقم التسلسلي,الجنس,المركز,الأجزاء",
      "مريم,101,S-101,أنثى,مركز,\"1-5، 21، 22، 23، 24، 25\"",
      "نور,102,S-102,أنثى,مركز,1،2،3",
      `${pending.name},${pending.seat},${pending.serialNumber},${pending.gender},${pending.center},11-20`,
    ].filter(Boolean).join("\n");
    const event = { target: { value: "x", files: [{ name: "diwan.csv", text: async () => csv }] } };
    await sandbox.importDiwanExcel(event);
    const list = vm.runInContext('diwanState.participants', sandbox);
    const maryam = list.find(p => p.name === "مريم"), noor = list.find(p => p.name === "نور");
    assert.deepStrictEqual([...maryam.parts], [1,2,3,4,5,21,22,23,24,25], "أجزاء مريم العشرة سُحبت من الملف تلقائياً");
    assert.strictEqual(noor.parts.length, 0, "خانة أجزاء لا تحوي ١٠ أجزاء لا تُعتمد");
    assert.strictEqual(JSON.stringify(pending.parts), pendingPartsBefore, "لا تتغير أجزاء متسابق له سحب بانتظار اللجنة");
    const drawsBefore = vm.runInContext('diwanState.draws.length', sandbox);
    await sandbox.runDiwanBulkDraw([maryam, noor]);
    const draws = vm.runInContext('diwanState.draws', sandbox);
    assert.strictEqual(draws.length, drawsBefore + 1, "سحب للجميع: سحب واحد لمن أجزاؤه جاهزة فقط");
    const maryamDraw = draws.find(d => d.participantId === maryam.id);
    assert.deepStrictEqual([...maryamDraw.eligibleParts], [1,2,3,4,5,21,22,23,24,25], "السحب الجماعي بأجزاء Excel نفسها");
    assert.strictEqual(maryamDraw.positions.length, 10, "موضع من كل جزء");
    assert.strictEqual(sandbox.diwanParticipantStatusOf(noor), "no_draw", "من لا أجزاء له يُتخطّى");
    const origConfirm = queryElement("#deleteAllDiwanConfirm");
    sandbox.confirmDeleteAllDiwanParticipants();
    origConfirm.value = "خطأ"; queryElement("#deleteAllDiwanNow").onclick();
    assert.ok(vm.runInContext('diwanState.participants.length', sandbox) > 0, "حذف الجميع لا يتم بلا عبارة التأكيد الصحيحة");
    origConfirm.value = "حذف المتسابقين"; queryElement("#deleteAllDiwanNow").onclick();
    assert.strictEqual(vm.runInContext('diwanState.participants.length + diwanState.draws.length', sandbox), 0, "حذف الجميع يحذف المتسابقين وسحوباتهم");
  }

  // 10ب) قراءة الأجزاء بأي صيغة يكتبها Excel: «1-5،13-17» مع شَرطات/فواصل مختلفة ومحارف اتجاه مخفية
  {
    const expected = [1,2,3,4,5,13,14,15,16,17];
    for (const text of ["1-5،13-17", "1-5؛13-17", "1–5،13–17", "‏1-5‏،‏13-17", "1-5؜،13-17", "1 - 5 ، 13 - 17", "1ـ5،13ـ17", "١-٥،١٣-١٧", "1,2,3,4,5,13,14,15,16,17"])
      assert.deepStrictEqual([...sandbox.parsePartSpec(text)], expected, `قراءة الأجزاء من «${text}»`);
  }

  // 11) متسابقات الديوان يظهرن لكل لجان الإناث بغض النظر عن مستوى اللجنة؛ المنقولة يدوياً للجنة أخرى لا؛ الذكور على الفرز المعتاد
  {
    const payload = { config: {}, participants: [
      { id: "F1", name: "حلا", gender: "أنثى", level: 10 },
      { id: "F2", name: "منقولة", gender: "أنثى", level: 10, transferCommitteeId: "OTHER" },
      { id: "M1", name: "عمر", gender: "ذكر", level: 10 },
      { id: "U1", name: "قديمة", gender: "غير محدد", level: 10 },
      { id: "U2", name: "قديمة٢", level: 10 },
    ], draws: [{ id: "D1", participantId: "F1" }, { id: "D3", participantId: "M1" }] };
    const saved = sandbox.window.CloudCompetition.context;
    sandbox.window.CloudCompetition.context = { committee: { id: "FC", responsibleGender: "أنثى", levels: [5], levelNames: [] } };
    const femaleScope = sandbox.diwanCommitteeScope(payload);
    assert.deepStrictEqual(femaleScope.participants.map(p => p.id), ["F1", "U1", "U2"], "لجنة إناث بمستوى آخر ترى المتسابقات ومن بلا جنس مسجَّل (بيانات قديمة)، لا المنقولة للجنة أخرى ولا الذكر");
    assert.deepStrictEqual(femaleScope.draws.map(d => d.id), ["D1"], "وسحبها معها");
    sandbox.window.CloudCompetition.context = { committee: { id: "MC", responsibleGender: "ذكر", levels: [5], levelNames: [] } };
    assert.strictEqual(sandbox.diwanCommitteeScope(payload).participants.length, 0, "لجنة ذكور بمستوى غير مطابق: بلا تغيير عن السابق (الإناث فقط لكل اللجان)");
    sandbox.window.CloudCompetition.context = { committee: { id: "NC", responsibleGender: "", levels: [5], levelNames: [] } };
    assert.strictEqual(sandbox.diwanCommitteeScope(payload).participants.length, 0, "لجنة بلا جنس محدد: على الفرز المعتاد");
    // من امتحنتها لجنة أخرى تظهر «امتُحنت عند …» بلا زر بدء؛ غيرها جاهزة للاختبار
    sandbox.window.CloudCompetition.context = { kind: "committee", committee: { id: "FC", responsibleGender: "أنثى", levels: [5], levelNames: [], examiner_role: "chairman" } };
    const tState = { ...vm.runInContext("defaultDiwanState()", sandbox), participants: [
      { id: "T1", name: "حلا", gender: "أنثى", stage: 1, level: 10, seat: "1", center: "مركز" },
      { id: "T2", name: "سارة", gender: "أنثى", stage: 1, level: 10, seat: "2", center: "مركز" },
    ], draws: [
      { id: "TD1", participantId: "T1", stage: 1, positions: [], createdAt: "2026-09-01T00:00:00Z" },
      { id: "TD2", participantId: "T2", stage: 1, positions: [], createdAt: "2026-09-01T00:00:00Z" },
    ] };
    vm.runInContext('diwanCommitteeScopedState = __s; diwanCommitteeSessions = []; diwanCommitteeTakenDraws = new Map([["TD1", { draw_id: "TD1", status: "final", committee_name: "لجنة ٢" }]]);', Object.assign(sandbox, { __s: tState }));
    queryElement("#diwanCommitteeSearch").value = ""; queryElement("#diwanCommitteeStatusFilter").value = "all";
    sandbox.renderDiwanCommitteeStudents();
    const listHtml = queryElement("#diwanCommitteeStudents").innerHTML;
    assert.ok(listHtml.includes("امتُحنت عند لجنة ٢") && !listHtml.includes('data-diwan-committee-confirm-start="T1"'), "المتسابقة الممتحنة عند لجنة أخرى تظهر كذلك بلا زر بدء");
    assert.ok(listHtml.includes('data-diwan-committee-confirm-start="T2"'), "غيرها يبقى جاهزاً للاختبار");
    assert.strictEqual(queryElement("#diwanCommitteePendingCount").textContent, "1", "لا تُحسب الممتحنة عند لجنة أخرى ضمن «بانتظار الاختبار»");
    // المنسحبة تظهر للجنة «منسحب · 0» بلا زر بدء ولا تُحسب بانتظار الاختبار
    tState.participants[1].withdrawn = true; tState.participants[1].score = 0;
    sandbox.renderDiwanCommitteeStudents();
    const withdrawnHtml = queryElement("#diwanCommitteeStudents").innerHTML;
    assert.ok(withdrawnHtml.includes("منسحب · 0") && !withdrawnHtml.includes('data-diwan-committee-confirm-start="T2"'), "المنسحبة بلا زر بدء عند اللجنة");
    assert.strictEqual(queryElement("#diwanCommitteePendingCount").textContent, "0", "المنسحبة لا تُحسب بانتظار الاختبار");
    sandbox.window.CloudCompetition.context = saved;
  }

  // 12) الانسحاب من الإدارة: علامة صفر وحالة «منسحب» بلا أزرار سحب، ولا يدخل «سحب للجميع»؛ وإلغاؤه يعيد الحالة والعلامة السابقة
  {
    sandbox.confirm = () => true;
    const w = { id: "W1", name: "آية", seat: "201", serialNumber: "S-201", gender: "أنثى", center: "مركز", stage: 1, usedJuz: [], parts: [1,2,3,4,5,6,7,8,9,10], level: 10, score: 70, gradedAt: "2026-09-01T00:00:00Z", lastGradedDrawId: "WD1", createdAt: new Date().toISOString() };
    vm.runInContext('diwanState.participants.push(__p); diwanState.draws.push(__d);', Object.assign(sandbox, { __p: w, __d: { id: "WD1", participantId: "W1", stage: 1, eligibleParts: w.parts, positions: [], createdAt: new Date().toISOString() } }));
    assert.strictEqual(sandbox.diwanParticipantStatusOf(w), "failed");
    await sandbox.toggleDiwanParticipantWithdrawn(w);
    assert.ok(w.withdrawn && w.score === 0 && w.scoreSource === "withdrawn", "الانسحاب يصفّر العلامة");
    assert.strictEqual(sandbox.diwanParticipantStatusOf(w), "withdrawn");
    const card = sandbox.diwanParticipantCardHtml(w);
    assert.ok(card.includes("منسحب · 0") && card.includes("إلغاء الانسحاب") && !card.includes("data-diwan-recommendation=") && !card.includes("data-diwan-retry="), "بطاقة المنسحب بلا توصية/إعادة اختبار");
    sandbox.mergeFinalDiwanSessionsIntoState([{ participant_id: "W1", draw_id: "WD2", stage: 1, status: "final", score: 95, finalized_at: new Date().toISOString(), assessment: {} }]);
    assert.ok(w.withdrawn && w.stage === 1 && w.score === 0, "نتيجة لاحقة لا تغيّر المنسحب");
    await sandbox.toggleDiwanParticipantWithdrawn(w);
    assert.ok(!w.withdrawn && w.score === 70 && w.gradedAt === "2026-09-01T00:00:00Z" && !w.preWithdrawal, "إلغاء الانسحاب يعيد العلامة السابقة");
    assert.strictEqual(sandbox.diwanParticipantStatusOf(w), "failed", "ويعيد الحالة السابقة");
  }

  // 13) التوزيع على لجان الإناث: بلا ذكور/منسحبات/من بدأت، عدد متساوٍ لكل لجنة، وتناوب حسب وقت حضور المركز ثم المركز ثم الجلوس
  {
    vm.runInContext('diwanState = defaultDiwanState(); diwanAdminSessions = [];', sandbox);
    // جدول «توزيع طالبات ديوان الحفاظ على اللجان» (90 طالبة على اللجان 5–9) بترتيب الدور داخل كل لجنة
    const expected = {
      "لجنة 5": [17, 22, 27, 32, 37, 42, 56, 61, 66, 73, 1, 6, 11, 16, 89, 45, 76, 81],
      "لجنة 6": [18, 23, 28, 33, 38, 52, 57, 62, 68, 74, 2, 7, 12, 48, 90, 46, 77, 82],
      "لجنة 7": [19, 24, 29, 34, 39, 53, 58, 63, 69, 3, 8, 13, 49, 91, 47, 78, 83, 86],
      "لجنة 8": [20, 25, 30, 35, 40, 54, 59, 64, 70, 4, 9, 14, 50, 43, 92, 79, 84, 87],
      "لجنة 9": [21, 26, 31, 36, 41, 55, 60, 65, 71, 5, 10, 15, 51, 44, 75, 80, 85, 88],
    };
    const centers = [
      ["مركز حذيفة بن اليمان القرآني", [17, 42]], ["مركز كفر أبيل القرآني", [52, 74]], ["مركز الأشرفية القرآني", [1, 16]], ["مركز مصعب بن عمير القرآني", [48, 51]],
      ["مركز الحاج أبو زكريا القرآني", [89, 91]], ["مركز المقداد بن عمرو القرآني", [43, 47]], ["مركز جنين الصفا القرآني", [92, 92]], ["مركز طلحة بن عبيد الله القرآني", [75, 79]], ["مركز عائشة أم المؤمنين القرآني", [80, 88]],
    ];
    const seats = new Set(Object.values(expected).flat());
    const centerOf = seat => centers.find(([, [a, b]]) => seat >= a && seat <= b)[0];
    const people = [...seats].sort(() => Math.random() - 0.5).map(seat => ({ id: `S${seat}`, name: `ط${seat}`, seat: String(seat), center: centerOf(seat), gender: seat % 10 === 0 ? "غير محدد" : "أنثى", stage: 1, parts: [], level: 10 }));
    people.push({ id: "SM", name: "ذكر", seat: "500", gender: "ذكر", stage: 1, level: 10 }, { id: "SW", name: "منسحبة", seat: "501", gender: "أنثى", stage: 1, level: 10, withdrawn: true }, { id: "SS", name: "بدأت", seat: "502", gender: "أنثى", stage: 1, level: 10 });
    vm.runInContext('diwanState.participants = __p; diwanState.draws = [{ id: "SSD", participantId: "SS", stage: 1, positions: [], createdAt: new Date().toISOString() }]; diwanAdminSessions = [{ draw_id: "SSD", status: "in_progress" }];', Object.assign(sandbox, { __p: people }));
    const list = sandbox.diwanDistributableParticipants();
    assert.strictEqual(list.length, 90, "الإناث ومن بلا جنس فقط، بلا الذكر والمنسحبة ومن بدأت اختبارها");
    const committees = Object.keys(expected).map(name => ({ name }));
    const plan = sandbox.diwanDistributionPlan(list, committees);
    plan.forEach(({ committee, members }) => assert.deepStrictEqual(Array.from(members, p => Number(p.seat)), expected[committee.name], `${committee.name} تطابق الجدول المعتمد بالترتيب`));
    assert.deepStrictEqual(Array.from(sandbox.diwanDistributionPlan(list, [{}, {}, {}, {}]), x => x.members.length), [23, 23, 22, 22], "90 على 4 لجان: 23،23،22،22");
    assert.strictEqual(sandbox.diwanCenterArrival("مركز جديد"), "11:00", "المركز غير المعروف آخر وقت افتراضياً");
    // أعداد مخصصة: مجموعها أقل من العدد → الباقي بلا لجنة
    const custom = sandbox.diwanDistributionPlan(list, committees, { capacities: [30, 20, 10, 10, 10] });
    assert.deepStrictEqual(Array.from(custom, x => x.members.length), [30, 20, 10, 10, 10], "كل لجنة بعددها المخصص");
    assert.strictEqual(custom.leftover.length, 10, "10 بلا لجنة");
    // مراكز محددة: لجنة 5 لكفر أبيل فقط، ولجنة 6 للأشرفية فقط، والباقي كل المراكز
    const kafr = "مركز كفر أبيل القرآني", ashr = "مركز الأشرفية القرآني";
    const limited = sandbox.diwanDistributionPlan(list, committees, { capacities: [21, 16, 20, 20, 13], centers: [[kafr], [ashr], null, null, null] });
    assert.ok(Array.from(limited[0].members).every(p => p.center === kafr) && limited[0].members.length === 21, "لجنة 5 = كل طالبات كفر أبيل");
    assert.ok(Array.from(limited[1].members).every(p => p.center === ashr) && limited[1].members.length === 16, "لجنة 6 = كل طالبات الأشرفية");
    assert.strictEqual(limited.leftover.length, 0, "الإصلاح بالتبديل يضمن مكاناً للجميع");
  }

  // المسؤول الفرعي (مسؤولة الإناث) ومشرف المسابقة: يُحمَّل ديوان الحفاظ من الخادم (لا من نسخة الجهاز)، وبصلاحيات تعديل الإدارة نفسها
  // عبر الحفظ السحابي، مع إخفاء الحذف/النقل بين اللجان إلا بمفتاح الحساب، وبلا كتابة في localStorage.
  {
    const saved = [];
    sandbox.window.DiwanCompetition = {
      loadViewerState: async () => ({ payload: { participants: [{ id: "F1", name: "فاطمة", seat: "1", gender: "أنثى", stage: 1, parts: [], level: 10 }], draws: [] } }),
      listViewerSessions: async () => [],
      loadState: async () => { throw new Error("loadState للإدارة الرئيسية فقط") },
      markAdminKnownIds: () => {},
      queueStateSave: () => saved.push("save"),
    };
    for (const [kind, flags] of [["subAdmin", { can_delete_data: false, can_transfer_participant: false }], ["supervisor", { can_delete_data: true, can_transfer_participant: true }]]) {
      sandbox.window.CloudCompetition = { context: { kind, token: "t", subAdmin: { gender: "أنثى", ...flags }, profile: { role: kind, ...flags } } };
      vm.runInContext('operationMode = "cloud"; cloudEnabled = true; diwanStateLoaded = false; diwanState = { ...defaultDiwanState(), participants: [{ id: "OLD", name: "بيانات محلية قديمة" }] };', sandbox);
      const before = [...localStorageStore.entries()].map(([k, v]) => k + v).join();
      await sandbox.ensureDiwanStateLoaded();
      assert.deepStrictEqual(vm.runInContext("diwanState.participants.map(p => p.id)", sandbox), ["F1"], `${kind}: المتسابقات يظهرن من الخادم`);
      const card = sandbox.diwanParticipantCardHtml(vm.runInContext("diwanState.participants[0]", sandbox));
      assert.ok(/data-diwan-pick-juz=/.test(card) && /data-diwan-edit=/.test(card) && /data-diwan-withdraw=/.test(card) && /data-diwan-move-stage=/.test(card), `${kind}: أزرار السحب والتعديل والانسحاب والنقل لمرحلة متاحة`);
      assert.ok(/data-diwan-delete=/.test(card), `${kind}: الحذف متاح (صلاحية كاملة)`);
      assert.ok(/data-diwan-transfer=/.test(card), `${kind}: النقل للجنة متاح (صلاحية كاملة)`);
      sandbox.saveDiwanState();
      assert.strictEqual([...localStorageStore.entries()].map(([k, v]) => k + v).join(), before, `${kind}: لا كتابة في نسخة الجهاز`);
    }
    assert.strictEqual(saved.length, 2, "الحفظ يذهب للخادم من الحسابين");
    // «تغيير الأجزاء» يظهر فقط لمن عنده سحب بانتظار اللجنة بمراحل ١-٣
    vm.runInContext('diwanState.participants[0].parts = [1,2,3,4,5,6,7,8,9,10]; diwanState.draws = [{ id: "DX", participantId: "F1", stage: 1, positions: [], createdAt: new Date().toISOString() }];', sandbox);
    assert.ok(/data-diwan-change-parts=/.test(sandbox.diwanParticipantCardHtml(vm.runInContext("diwanState.participants[0]", sandbox))), "زر تغيير الأجزاء للسحب المنتظر");
    vm.runInContext('diwanState.draws = [];', sandbox);
    assert.ok(!/data-diwan-change-parts=/.test(sandbox.diwanParticipantCardHtml(vm.runInContext("diwanState.participants[0]", sandbox))), "لا زر تغيير أجزاء بلا سحب");
    vm.runInContext('operationMode = "local"; cloudEnabled = false;', sandbox);
    sandbox.window.CloudCompetition = { context: {} };
  }

  // الناجح بالاختبار الأول يبقى ظاهراً بصفحة الاختبار الأول (فلتر «ناجح») مع علامته، ويظهر أيضاً بمرحلته الجديدة.
  {
    vm.runInContext(`diwanState = { ...defaultDiwanState(), participants: [
        { id: "P1", name: "ناجحة", seat: "1", gender: "أنثى", stage: 2, parts: [], level: 10 },
        { id: "P2", name: "بالأول", seat: "2", gender: "أنثى", stage: 1, parts: [], level: 10 }],
      draws: [{ id: "D1", participantId: "P1", stage: 1, positions: [], createdAt: new Date().toISOString() }] };
      diwanAdminSessions = [{ participant_id: "P1", draw_id: "D1", stage: 1, status: "final", score: 93, assessment: {}, finalized_at: new Date().toISOString() }];`, sandbox);
    assert.deepStrictEqual(Array.from(sandbox.diwanStageMembers(1), p => p.id), ["P1", "P2"], "الناجحة تبقى بقائمة الاختبار الأول");
    assert.deepStrictEqual(Array.from(sandbox.diwanStageMembers(2), p => p.id), ["P1"], "وتظهر بالاختبار الثاني أيضاً");
    const p1 = vm.runInContext("diwanState.participants[0]", sandbox);
    assert.strictEqual(sandbox.diwanStageStatusOf(p1, 1), "passed", "حالتها بصفحة الأول: ناجح");
    assert.strictEqual(sandbox.diwanStageStatusOf(p1, 2), "no_draw", "حالتها بصفحة الثاني: بانتظار الأجزاء");
    const card = sandbox.diwanParticipantCardHtml(p1, false, 1);
    assert.ok(card.includes("ناجح · 93") && card.includes("data-diwan-draw-sheet=\"D1\""), "البطاقة تعرض العلامة وورقة مواضع الاختبار الأول");
    // فلتر «مكتمل الاختبار» بصفحة الأول: الناجحة (انتقلت) والراسبة معاً، بلا من لم يُمتحن بعد.
    vm.runInContext(`diwanState.participants.push({ id: "P3", name: "راسبة", seat: "3", gender: "أنثى", stage: 1, parts: [], level: 10, lastGradedDrawId: "D3", score: 70 });
      diwanState.draws.push({ id: "D3", participantId: "P3", stage: 1, positions: [], createdAt: new Date().toISOString() });
      diwanOpenStage = 1;`, sandbox);
    const completed = sandbox.diwanStageMembers(1).filter(p => sandbox.diwanParticipantMatchesFilters(p, { status: "completed", gender: "all", center: "all", committee: "all" }));
    assert.deepStrictEqual(Array.from(completed, p => p.id), ["P1", "P3"], "مكتمل الاختبار = الناجحة والراسبة فقط");
    assert.ok(sandbox.diwanParticipantCardHtml(vm.runInContext("diwanState.participants[2]", sandbox), false, 1).includes("راسب · 70"), "الراسبة تظهر بعلامتها");
    vm.runInContext('diwanAdminSessions = []; diwanOpenStage = null;', sandbox);
  }

  console.log("diwan-admin-ui.test.js: كل الحالات نجحت — نظام المراحل المتتالية، السحب الموحّد لكل جزء، والترقية/الإبقاء حسب DIWAN_PASS_SCORE=85، ودوال توليد الشهادات/التوصيات");
}

run().catch(error => {
  console.error("diwan-admin-ui.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
