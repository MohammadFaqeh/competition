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
    assert.strictEqual((stageCert.match(/diwan-doc-cell marked/g) || []).length, 10, "تُظلَّل بالضبط الأجزاء العشرة المسجَّلة بسحب الاختبار");
    assert.ok(/diwan-doc-cell marked[^>]*>30</.test(stageCert) && !/diwan-doc-cell marked[^>]*>1</.test(stageCert), "الجزء 30 مظلَّل والجزء 1 لا");
    assert.ok(stageCert.includes("دعاء") && stageCert.includes("05/03/2026") && stageCert.includes("مركز"), "الاسم والتاريخ والمركز تُعبَّأ");
    const finalCert = sandbox.diwanHafizCertificateHtml({ ...p3, certificateNumber: 7 }, { stage: 4, eligibleParts: Array.from({length:30},(_,i)=>i+1) }, { score: 90, finalized_at: "2026-03-05T10:00:00Z" }, "data:,");
    assert.strictEqual((finalCert.match(/diwan-doc-cell marked/g) || []).length, 30, "الاختبار النهائي: كل الأجزاء الثلاثين مظلَّلة");
    assert.ok(!finalCert.includes(">0007<") && finalCert.includes(">S-007<"), "لا يُطبع رقم شهادة؛ الرقم التسلسلي وحده يظهر");
    const recHtml = sandbox.diwanRecommendationHtml(p, { stage: 2, eligibleParts: tenParts }, { status: "final", score: 70, assessment: { recommendation: ["نقطة أولى", "نقطة ثانية"] } }, "data:,");
    assert.ok(recHtml.includes('<span class="diwan-doc-rec-num">1.</span>نقطة أولى') && recHtml.includes('<span class="diwan-doc-rec-num">2.</span>نقطة ثانية'), "التوصية تُطبع كنقاط مرقّمة");
    assert.ok(recHtml.includes("الاختبار الثاني"), "عنوان الاختبار الفرعي بقالب التوصية يتبع مرحلة المحاولة");
    const recIncomplete = sandbox.diwanRecommendationHtml(p, { stage: 4, eligibleParts: [1] }, { status: "final", score: 100, assessment: { incomplete: true } }, "data:,");
    assert.ok(recIncomplete.includes("غير مكتمل"), "«غير مكتمل» يظهر بدل الرقم الداخلي");
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

  console.log("diwan-admin-ui.test.js: كل الحالات نجحت — نظام المراحل المتتالية، السحب الموحّد لكل جزء، والترقية/الإبقاء حسب DIWAN_PASS_SCORE=85، ودوال توليد الشهادات/التوصيات");
}

run().catch(error => {
  console.error("diwan-admin-ui.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
