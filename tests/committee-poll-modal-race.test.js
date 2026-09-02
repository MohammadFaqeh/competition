// اختبار آلي لخلل "العلامة رجعت 100 عند الاعتماد رغم ظهور الخصم الصحيح أثناء الرصد" من
// زاوية توقيت مختلفة عن session-race.test.js: استطلاع تحديث اللجنة (refreshCommitteeChanges)
// كان يتحقق من "مودال مفتوح؟" مرة وحدة بس بأول الدالة (الفحص المضاف بـcommit df92a26). لو
// طلب الشبكة (loadCompetitionState/listSessions) كان قد بدأ قبل ما يفتح الرئيس/العضو شاشة
// الاختبار، وانتهى فقط بعد ما فتحها، كان الكود يستبدل state.participants/committeeSessions
// بأي حال رغم أن المودال صار مفتوحاً فعلياً — فيضيع التقييم الجاري بلا رحمة (سباق حقيقي بين
// الشبكة وفتح المودال، مش بس ترتيب استدعاءات). الإصلاح: إعادة فحص "مودال مفتوح؟" مباشرة قبل
// أي استبدال فعلي لـstate، لا فقط عند دخول الدالة.
// شغّله: node tests/committee-poll-modal-race.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const { execFileSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");

function currentAppSrc() {
  return fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");
}
// نسخة app.js كما كانت بـcommit df92a26 تحديداً (آخر commit قبل إصلاح هذا الخلل بالجلسة التي
// كتبت فيها هذا الاختبار) — لإثبات إنه الخلل كان يتكرر فعليًا بالكود المشحون فعلًا، لا افتراضًا
// نظريًا. مثبَّتة على SHA ثابت عمداً (لا "HEAD") لأن HEAD يتحرك مع كل commit لاحق (تحويل Real-
// Time الطبقي مثلاً)، وحينها "git show HEAD:app.js" كان سيرجع نسخة مُصلَحة أصلاً فيفشل الاختبار
// بالغلط رغم إنه الإصلاح نفسه سليم 100%.
function preFixAppSrc() {
  return execFileSync("git", ["show", "df92a26:app.js"], { cwd: projectRoot, encoding: "utf8" });
}

const markerRe = /if\(document\.readyState===("|')loading\1\)document\.addEventListener\("DOMContentLoaded",init,\{once:true\}\);\s*else init\(\);/;

function makeElement() {
  const classes = new Set();
  return {
    dataset: {}, style: {}, value: "", textContent: "", innerHTML: "", disabled: false,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => { if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false } classes.add(c); return true } if (force) classes.add(c); else classes.delete(c); return force },
      contains: (c) => classes.has(c),
    },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null },
    querySelector() { return makeElement() }, querySelectorAll() { return [] },
    closest() { return null }, appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, click() {},
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// يبني بيئة تنفيذ لنص app.js معطى (قديم أو حالي) مع تحكم كامل بتوقيت استجابة الشبكة وبفتح/
// إغلاق المودال، لمحاكاة السباق: استطلاع بدأ قبل فتح المودال وانتهى بعده.
function buildHarness(appSrc) {
  let src = appSrc;
  if (!markerRe.test(src)) throw new Error("bootstrap marker not found — app.js structure changed, update this test");
  src = src.replace(markerRe, "/* init() disabled for headless test */");

  const elementCache = new Map();
  const modalEl = makeElement();
  modalEl.classList.add("hidden"); // المودال مغلق افتراضيًا، تمامًا كحالة <div id="modal" class="hidden">
  elementCache.set("#modal", modalEl);
  function queryElement(sel) {
    if (!elementCache.has(sel)) elementCache.set(sel, makeElement());
    return elementCache.get(sel);
  }

  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      readyState: "complete", hidden: false,
      addEventListener() {},
      querySelector: (sel) => queryElement(sel),
      querySelectorAll: () => [],
      documentElement: { lang: "ar", dir: "rtl" },
      body: makeElement(),
    },
    window: {},
    navigator: { onLine: true },
    crypto: require("crypto").webcrypto,
    fetch: () => Promise.reject(new Error("fetch disabled in test")),
    location: { hash: "", href: "" },
    history: { pushState() {}, replaceState() {} },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout, clearTimeout,
    lucide: { createIcons() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "app.js" });

  // شبكة وهمية: تتحكم بالتأخير ومحتوى الاستجابة من خارج الـsandbox عبر مراجع قابلة للتبديل.
  let remoteDelayMs = 40;
  let remotePayload = null;
  let remoteSessions = [];
  sandbox.window.CloudCompetition = {
    get context() { return { kind: "committee", committee: sandbox.__committee } },
    refreshCommitteeAccess: async () => {},
    loadCompetitionState: async () => { await wait(remoteDelayMs); return { payload: remotePayload }; },
    listSessions: async () => { await wait(remoteDelayMs); return remoteSessions; },
    // refreshCommitteeChanges صار يستخدم النسخة "الحيّة" المُقيَّدة بدل listSessions الكاملة
    // (راجع tiered-realtime-*.test.js لاختبارات التقييد الزمني نفسه بالتفصيل) — بهذا الاختبار
    // القديم (خاص بسباق فتح المودال) لا يهمنا سلوك التقييد الزمني، فقط نُعيد نفس remoteSessions.
    listLiveCommitteeSessions: async () => { await wait(remoteDelayMs); return remoteSessions; },
    lookupChangeTimes: async () => [],
  };

  const committee = { id: "c1", levels: [3], levelNames: ["3 أجزاء"], responsibleGender: null };
  sandbox.__committee = committee;

  // متسابقة وحيدة قيد الاختبار فعليًا (رصد جارٍ لم يُعتمد بعد) — تماماً كسيناريو المستخدم.
  const draftAssessment = {
    id: "ASSESS-1", drawId: "d1", status: "draft", examinerRole: "chairman",
    updatedAt: "2026-01-01T00:00:05.000Z",
    positions: [{ positionId: "pos1", memorization: 2, language: 0, tajweed: 1, hesitation: 0, positionChange: 0, note: "", completed: false }],
  };
  const initialState = {
    config: { competitionName: "تجريبي" },
    participants: [{ id: "p1", name: "سارة", level: 3, levelName: "3 أجزاء", gender: "أنثى", parts: [1, 2, 3], assessment: draftAssessment }],
    draws: [{ id: "d1", participantId: "p1", positions: [{ id: "pos1" }] }],
    resets: [], deletions: [],
  };
  const initialSessions = [{ id: "sess1", participant_id: "p1", status: "in_progress", assessment: {}, updated_at: "2026-01-01T00:00:00.000Z" }];

  sandbox.__initialState = initialState;
  sandbox.__initialSessions = initialSessions;
  vm.runInContext("state = __initialState; committeeSessions = __initialSessions;", sandbox);

  return {
    sandbox,
    modalEl,
    openModalMidFlight() { modalEl.classList.remove("hidden") },
    closeModal() { modalEl.classList.add("hidden") },
    setRemote({ delayMs, payload, sessions }) {
      if (delayMs !== undefined) remoteDelayMs = delayMs;
      if (payload !== undefined) remotePayload = payload;
      if (sessions !== undefined) remoteSessions = sessions;
    },
    getParticipant() { return vm.runInContext("state.participants.find(p=>p.id==='p1')", sandbox) },
    getSession() { return vm.runInContext("committeeSessions.find(s=>s.id==='sess1')", sandbox) },
    getSignature() { return vm.runInContext("committeeSessionsSignature", sandbox) },
    run() { return sandbox.refreshCommitteeChanges() },
  };
}

// حمولة "الإدارة" (competition_state.payload) لا تعرف شيئاً عن التقييم الجاري — تمامًا كما
// بالخلل الحقيقي (لا يُدمَج فيها إلا بعد اعتماد النتيجة نهائيًا).
function remotePayloadNoAssessment() {
  return {
    config: { competitionName: "تجريبي" },
    participants: [{ id: "p1", name: "سارة", level: 3, levelName: "3 أجزاء", gender: "أنثى", parts: [1, 2, 3] }],
    draws: [{ id: "d1", participantId: "p1", positions: [{ id: "pos1" }] }],
  };
}
function remoteSessionsChangedUpdatedAt() {
  // نفس ما يحصل فعليًا: أي حفظ مسودة (saveAssessmentDraft) يبدّل updated_at لجلسة اللجنة.
  return [{ id: "sess1", participant_id: "p1", status: "in_progress", assessment: {}, updated_at: "2026-01-01T00:00:09.000Z" }];
}

async function run() {
  // 1) بنسخة app.js كما كانت آخر commit (قبل إصلاح هذا الخلل): يعيد إنتاج الخلل فعليًا —
  //    استطلاع بدأ والمودال مغلق، وانتهى بعدما فتح الرئيس شاشة الاختبار، فيمسح التقييم الجاري.
  {
    const h = buildHarness(preFixAppSrc());
    h.setRemote({ delayMs: 40, payload: remotePayloadNoAssessment(), sessions: remoteSessionsChangedUpdatedAt() });
    const before = h.getParticipant();
    assert.strictEqual(before.assessment.positions[0].memorization, 2, "قبل الاستطلاع: الخصم المسجَّل موجود فعليًا");
    const pending = h.run(); // المودال لسا مغلق هون — الفحص الأول بيسمح للاستطلاع يبلش
    await wait(10);
    h.openModalMidFlight(); // الرئيس فتح شاشة الاختبار أثناء ما طلب الشبكة قيد الانتظار
    await pending;
    const after = h.getParticipant();
    assert.ok(
      !after.assessment || after.assessment.positions?.[0]?.memorization !== 2,
      "خلل مُعاد إنتاجه بالنسخة القديمة: الاستطلاع استبدل التقييم الجاري رغم فتح المودال أثناء الانتظار (هذا بالضبط سبب رجوع العلامة 100 عند الاعتماد)"
    );
  }

  // 2) بنسخة app.js الحالية (بعد الإصلاح): نفس السيناريو بالضبط، لكن الاستبدال يُتجاهل لأن
  //    الدالة تعيد فحص "مودال مفتوح؟" مباشرة قبل تطبيق الاستبدال، لا فقط عند الدخول.
  {
    const h = buildHarness(currentAppSrc());
    h.setRemote({ delayMs: 40, payload: remotePayloadNoAssessment(), sessions: remoteSessionsChangedUpdatedAt() });
    const before = h.getParticipant();
    assert.strictEqual(before.assessment.positions[0].memorization, 2);
    const pending = h.run();
    await wait(10);
    h.openModalMidFlight();
    await pending;
    const after = h.getParticipant();
    assert.strictEqual(after.assessment.positions[0].memorization, 2, "مع الإصلاح: التقييم الجاري يبقى محفوظاً رغم أن طلب الشبكة انتهى بعد فتح المودال");
    assert.strictEqual(h.getSignature(), null, "مع الإصلاح: لا يُسجَّل توقيع الجلسات الجديد عند التجاهل، حتى يكتشف الاستطلاع التالي (بعد إغلاق المودال) نفس الفرق ويطبّقه بأمان");

    // 3) نفس الجلسة، لكن هالمرة المودال يبقى مغلقاً طوال وقت طلب الشبكة (لا يوجد سباق) —
    //    يجب أن يُطبَّق التحديث بشكل طبيعي تمامًا كالسابق، إثباتًا إنه الإصلاح ما عطّل
    //    الاستطلاع العادي (لا يوجد أي تراجع/regression بسلوك التحديث الطبيعي).
    h.closeModal();
    h.setRemote({ sessions: [{ id: "sess1", participant_id: "p1", status: "in_progress", assessment: {}, updated_at: "2026-01-01T00:00:20.000Z" }] });
    await h.run();
    const afterNormalPoll = h.getParticipant();
    assert.ok(!afterNormalPoll.assessment, "بدون سباق (مودال مغلق طوال الوقت): الاستطلاع يطبّق التحديث الحقيقي من الإدارة كالمعتاد");
    assert.notStrictEqual(h.getSignature(), null, "بدون سباق: يُسجَّل توقيع الجلسات الجديد بعد التطبيق الفعلي");
  }

  console.log("committee-poll-modal-race.test.js: كل الحالات نجحت — إعادة فحص \"مودال مفتوح؟\" قبل الاستبدال مباشرة تمنع سباق استطلاع اللجنة من مسح تقييم جارٍ، ولا تُعطّل التحديث الطبيعي");
}

run().catch((error) => {
  console.error("committee-poll-modal-race.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
