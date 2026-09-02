// اختبار آلي شامل لاستطلاع اللجنة الدوري (refreshCommitteeChanges) بعد تحويله لـReal-Time
// طبقي: (أ) يطلب من cloud.js فقط الجلسات "الحيّة" (listLiveCommitteeSessions بنافذة 12 ساعة)
// بدل القائمة الكاملة، (ب) لا يفقد بيانات جلسة قديمة (>12 ساعة) كانت محفوظة أصلاً محليًا طالما
// صاحبها لسا ضمن نطاق اللجنة، (ج) يحذف فقط جلسة متسابق خرج فعليًا من نطاق اللجنة (نُقل/تغيّر
// مستواه)، (د) يحدّث/يضيف جلسة ضمن النافذة الحديثة بشكل طبيعي تمامًا كالسابق.
// شغّله: node tests/tiered-realtime-committee-poll.test.js
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

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
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
  const committee = { id: "c1", levels: [3], levelNames: ["3 أجزاء"], responsibleGender: null };
  let capturedSinceIso = null;
  const liveResponse = { value: [] };

  sandbox.window.CloudCompetition = {
    get context() { return { kind: "committee", committee } },
    refreshCommitteeAccess: async () => {},
    loadCompetitionState: async () => ({ payload: sandbox.__remotePayload }),
    listLiveCommitteeSessions: async (sinceIso) => { capturedSinceIso = sinceIso; return liveResponse.value },
    listSessions: async () => { throw new Error("لا يجب أن يُستدعى listSessions الكامل من الاستطلاع الدوري بعد التحويل للنسخة الطبقية") },
    lookupChangeTimes: async () => [],
  };

  // ثلاث متسابقات: قديمة (خارج نافذة 12 ساعة، ما زالت ضمن نطاق اللجنة)، حديثة (ستتحدّث
  // بالاستجابة المُقيَّدة)، ومنقولة (خرجت من نطاق اللجنة — يجب حذف جلستها من الذاكرة).
  const participantOld = { id: "p-old", name: "قديمة", level: 3, levelName: "3 أجزاء", gender: null, parts: [1, 2, 3] };
  const participantRecent = { id: "p-recent", name: "حديثة", level: 3, levelName: "3 أجزاء", gender: null, parts: [4, 5, 6] };
  const participantTransferred = { id: "p-gone", name: "منقولة", level: 3, levelName: "3 أجزاء", gender: null, parts: [7, 8, 9] };

  const initialState = {
    config: { competitionName: "تجريبي" },
    participants: [participantOld, participantRecent, participantTransferred],
    draws: [
      { id: "d-old", participantId: "p-old", positions: [{ id: "pos-old" }] },
      { id: "d-recent", participantId: "p-recent", positions: [{ id: "pos-recent" }] },
      { id: "d-gone", participantId: "p-gone", positions: [{ id: "pos-gone" }] },
    ],
    resets: [], deletions: [],
  };
  sandbox.__initialState = initialState;

  const sessionOld = { id: "sess-old", participant_id: "p-old", committee_id: "c1", status: "final", score: 61, assessment: {}, updated_at: "2026-08-30T00:00:00.000Z", finalized_at: "2026-08-30T00:00:00.000Z" };
  const sessionGone = { id: "sess-gone", participant_id: "p-gone", committee_id: "c1", status: "final", score: 40, assessment: {}, updated_at: "2026-08-30T00:00:00.000Z", finalized_at: "2026-08-30T00:00:00.000Z" };
  sandbox.__initialSessions = [sessionOld, sessionGone];
  vm.runInContext("state = __initialState; committeeSessions = __initialSessions; activeCloudSession = null;", sandbox);

  // الاستجابة البعيدة (competition_state.payload) بعد هذه النبضة: المتسابقة المنقولة لم تعد
  // ضمن مستويات/نطاق هذه اللجنة إطلاقًا (participantCloudSignature/committeeScopedState
  // سيُسقطها من nextState.participants).
  sandbox.__remotePayload = {
    config: { competitionName: "تجريبي" },
    participants: [participantOld, participantRecent], // p-gone غائبة عمدًا: نُقلت لمستوى/لجنة أخرى
    draws: initialState.draws.filter(d => d.participantId !== "p-gone"),
  };

  // الاستجابة "الحيّة" المُقيَّدة: جلسة حديثة جديدة لِp-recent فقط — p-old وp-gone غائبتان
  // (كأنهما تجاوزتا نافذة 12 ساعة، أو ببساطة لم تعودا ضمن استعلام السيرفر المُقيَّد بالكامل).
  const sessionRecent = { id: "sess-recent", participant_id: "p-recent", committee_id: "c1", status: "in_progress", score: null, assessment: {}, updated_at: "2026-09-02T09:00:00.000Z", finalized_at: null };
  liveResponse.value = [sessionRecent];

  await sandbox.refreshCommitteeChanges();

  assert.ok(capturedSinceIso, "تم تمرير سقف زمني (sinceIso) فعليًا لـlistLiveCommitteeSessions");
  const sinceMs = new Date(capturedSinceIso).getTime();
  const expectedMs = Date.now() - 12 * 60 * 60 * 1000;
  assert.ok(Math.abs(sinceMs - expectedMs) < 5000, `النافذة الزمنية يجب أن تكون ~12 ساعة بالضبط قبل الآن (الفرق: ${Math.abs(sinceMs - expectedMs)}ms)`);

  const finalCommitteeSessions = vm.runInContext("committeeSessions", sandbox);
  const byId = new Map(finalCommitteeSessions.map(s => [s.id, s]));

  assert.ok(byId.has("sess-old"), "sess-old (اعتُمدت منذ أيام، صاحبتها لسا ضمن نطاق اللجنة) لم تُفقد رغم غيابها عن الاستجابة المُقيَّدة");
  assert.strictEqual(byId.get("sess-old").score, 61, "علامة sess-old المحفوظة سابقًا صحيحة وما زالت كما هي");

  assert.ok(byId.has("sess-recent"), "sess-recent (وصلت بالاستجابة المُقيَّدة) أُضيفت بنجاح");
  assert.strictEqual(byId.get("sess-recent").status, "in_progress");

  assert.ok(!byId.has("sess-gone"), "sess-gone حُذفت لأن صاحبتها (p-gone) لم تعد ضمن نطاق اللجنة إطلاقًا (نُقلت) — هذا حذف صحيح، لا فقدان بيانات بالغلط");

  console.log("tiered-realtime-committee-poll.test.js: كل الحالات نجحت — استطلاع اللجنة الدوري يجلب فقط الجلسات الحيّة/الحديثة (نافذة 12 ساعة)، يدمج فوق الذاكرة المحلية بلا فقدان جلسات قديمة ضمن النطاق، ويحذف فقط جلسات المتسابقين الذين خرجوا فعليًا من نطاق اللجنة");
}

run().catch((error) => {
  console.error("tiered-realtime-committee-poll.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
