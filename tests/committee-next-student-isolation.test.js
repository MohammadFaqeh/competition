// اختبار آلي للسيناريو المطلوب بالضبط: متسابقة A تصل لحد الرسوب وتنهي اختبارها ويُعتمد لها
// علامة حقيقية، ثم — بدون أي تسجيل خروج — يبدأ رئيس اللجنة اختبار متسابقة B مباشرة. يتحقق
// إنه startCommitteeExam يبني تقييمًا فارغًا تمامًا لـB (لا آثار لأخطاء/علامة A على الإطلاق):
// لا بـactiveCloudSession، ولا بـstate.participants، ولا بمسودة localStorage.
// شغّله: node tests/committee-next-student-isolation.test.js
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
    closest() { return null }, appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, click() {},
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
  sandbox.ensureQuranReady = async () => ["candidate"];

  const committee = { id: "c1", levels: [3], levelNames: ["3 أجزاء"], responsibleGender: null, examiner_role: "chairman" };
  const claimedSessions = [];
  sandbox.window.CloudCompetition = {
    get context() { return { kind: "committee", committee } },
    log: async () => {},
    claimStudent: async (participantId, drawId, level) => {
      const session = { id: `sess-${participantId}`, participant_id: participantId, draw_id: drawId, level, status: "in_progress", assessment: {}, updated_at: new Date().toISOString() };
      claimedSessions.push(session);
      return session;
    },
  };

  // متسابقة A: رسبت وأُنهي اختبارها واعتُمدت علامتها الحقيقية (42) قبل قليل.
  const finalAssessmentA = {
    id: "ASSESS-A", drawId: "d_A", status: "final", examinerRole: "chairman",
    finalizedAt: "2026-01-01T00:10:00.000Z", updatedAt: "2026-01-01T00:10:00.000Z",
    result: { score: 42, passed: false },
    positions: [{ positionId: "posA1", memorization: 5, language: 3, tajweed: 2, hesitation: 1, positionChange: 0, note: "", completed: true }],
  };
  const participantA = { id: "p_A", name: "منى", level: 3, levelName: "3 أجزاء", gender: "أنثى", parts: [1, 2, 3], assessment: finalAssessmentA, score: 42, gradedAt: "2026-01-01T00:10:00.000Z", scoreSource: "electronic" };
  const participantB = { id: "p_B", name: "هبة", level: 3, levelName: "3 أجزاء", gender: "أنثى", parts: [4, 5, 6] }; // بلا assessment إطلاقًا — لسا ما بدأت

  const initialState = {
    config: { competitionName: "تجريبي" },
    participants: [participantA, participantB],
    draws: [
      { id: "d_A", participantId: "p_A", positions: [{ id: "posA1" }] },
      { id: "d_B", participantId: "p_B", positions: [{ id: "posB1" }, { id: "posB2" }] },
    ],
    resets: [], deletions: [],
  };
  const initialSessions = [{ id: "sess-p_A", participant_id: "p_A", status: "final", score: 42, assessment: finalAssessmentA, updated_at: "2026-01-01T00:10:00.000Z" }];

  sandbox.__initialState = initialState;
  sandbox.__initialSessions = initialSessions;
  vm.runInContext("state = __initialState; committeeSessions = __initialSessions; activeCloudSession = null;", sandbox);

  // بدون أي تسجيل خروج، رئيس اللجنة يضغط مباشرة على "البدء بالاختبار الآن" لمتسابقة B.
  await sandbox.startCommitteeExam("p_B");

  const activeSession = vm.runInContext("activeCloudSession", sandbox);
  assert.strictEqual(activeSession?.participant_id, "p_B", "الجلسة النشطة صارت لِـB، لا بقايا من جلسة A");

  const finalParticipantA = vm.runInContext("state.participants.find(p=>p.id==='p_A')", sandbox);
  const finalParticipantB = vm.runInContext("state.participants.find(p=>p.id==='p_B')", sandbox);

  assert.strictEqual(finalParticipantA.score, 42, "علامة A المعتمدة تبقى كما هي، ما تأثرت ببدء اختبار B");
  assert.strictEqual(finalParticipantA.assessment.status, "final", "تقييم A يبقى final بلا تغيير");

  assert.ok(finalParticipantB.assessment, "تقييم B صار موجودًا بعد بدء اختبارها");
  assert.strictEqual(finalParticipantB.assessment.drawId, "d_B", "تقييم B مربوط بسحب B لا سحب A");
  assert.strictEqual(finalParticipantB.assessment.status, "draft", "تقييم B يبلش draft، مش final (لا وراثة لحالة A)");
  assert.strictEqual(finalParticipantB.assessment.positions.length, 2, "عدد مواضع B هو عدد مواضع سحبها (2)، لا عدد مواضع A (1)");
  for (const position of finalParticipantB.assessment.positions) {
    for (const type of ["memorization", "language", "tajweed", "hesitation", "positionChange"]) {
      assert.strictEqual(position[type], 0, `موضع B (${position.positionId}) يبلش بصفر أخطاء بكل نوع (${type})، لا قيم A`);
    }
  }
  assert.strictEqual(finalParticipantB.score, undefined, "B ما إلها علامة محفوظة بعد — ما انتقلت علامة A أو أي رقم آخر بالغلط");

  const liveScoreB = vm.runInContext("calculateAssessment(state.participants.find(p=>p.id==='p_B').assessment).score", sandbox);
  assert.strictEqual(liveScoreB, 100, "العلامة الحية لتقييم B الفارغ = 100 (منطقي لتقييم بلا أخطاء)، وليست 42 (علامة A) أو أي قيمة موروثة");

  const localDraftB = localStorageStore.get(`assessment-draft-chairman-p_B`) ?? [...localStorageStore.keys()].find(k => k.includes("p_B"));
  // لا يوجد أي مفتاح localStorage خاص بـB يحتوي بيانات A (لأن claimStudent لم يُستدع لمسودة قديمة، والمسودة المحلية لـB غير موجودة أصلًا بهذه المرحلة).
  assert.ok(![...localStorageStore.keys()].some(k => k.includes("p_B") && String(localStorageStore.get(k)).includes("posA1")), "لا يوجد أي أثر لمعرّف موضع A (posA1) بأي مسودة محلية خاصة بـB");

  console.log("committee-next-student-isolation.test.js: كل الحالات نجحت — بدء اختبار B مباشرة بعد اعتماد A (بدون تسجيل خروج) يبني تقييمًا فارغًا معزولًا تمامًا، بلا أي تسريب لعلامة/أخطاء/حالة A");
}

run().catch((error) => {
  console.error("committee-next-student-isolation.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
