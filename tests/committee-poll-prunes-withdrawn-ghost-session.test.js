// اختبار آلي لإصلاح: متسابقة أنهت اختبارها فعلياً (جلسة final بعلامة حقيقية) ثم سُجّلت "منسحبة"
// لاحقاً من الإدارة (toggleParticipantWithdrawn يحذف جلستها من السيرفر فعلياً عبر
// deleteParticipantSession) — لكنها تبقى ضمن نطاق اللجنة (withdrawn=true فقط، لم تُنقل/تُحذف من
// القائمة). قبل الإصلاح: refreshCommitteeChanges كان يبقيها بالـcommitteeSessions المحلي للأبد
// (upsert فقط، لا يكتشف حذفاً سيرفرياً)، فتُحتسب "شبح" ضمن أي إحصائية تعتمد عليه مباشرة (مثال:
// renderCommitteePassRate يُظهر "عدد الممتحنين" أعلى من الحقيقة، يتذبذب حتى يصير هناك تحديث كامل
// للصفحة يصحّحه). الإصلاح: نستبعد صراحةً أي جلسة لمتسابقة صارت withdrawn=true عند الدمج.
// شغّله: node tests/committee-poll-prunes-withdrawn-ghost-session.test.js
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

  sandbox.window.CloudCompetition = {
    get context() { return { kind: "committee", committee } },
    refreshCommitteeAccess: async () => {},
    loadCompetitionState: async () => ({ payload: sandbox.__remotePayload }),
    listLiveCommitteeSessions: async () => [],
    listSessions: async () => { throw new Error("لا يجب أن يُستدعى listSessions الكامل من الاستطلاع الدوري") },
    lookupChangeTimes: async () => [],
  };

  const participantStaying = { id: "p-stays", name: "باقية", level: 3, levelName: "3 أجزاء", gender: null, parts: [1, 2, 3], withdrawn: false };
  // منسحبة الآن، لكن لسا ضمن نطاق اللجنة (withdrawn=true فقط — لم تُنقل ولم تُحذف من القائمة).
  const participantWithdrawn = { id: "p-withdrawn", name: "منسحبة", level: 3, levelName: "3 أجزاء", gender: null, parts: [4, 5, 6], withdrawn: true, score: 0, scoreSource: "withdrawn" };

  const initialState = {
    config: { competitionName: "تجريبي" },
    participants: [participantStaying, participantWithdrawn],
    draws: [
      { id: "d-stays", participantId: "p-stays", positions: [{ id: "pos-stays" }] },
      { id: "d-withdrawn", participantId: "p-withdrawn", positions: [{ id: "pos-withdrawn" }] },
    ],
    resets: [], deletions: [],
  };

  // جلسة "شبح" لمنسحبة: كانت final بعلامة حقيقية قبل الانسحاب، ولا تزال محفوظة بالذاكرة المحلية
  // من نبضة استطلاع سابقة (قبل ما تُصفَّى/تُحذف على السيرفر فعليًا).
  const sessionStaying = { id: "sess-stays", participant_id: "p-stays", committee_id: "c1", status: "final", score: 88, assessment: {}, updated_at: "2026-09-01T00:00:00.000Z", finalized_at: "2026-09-01T00:00:00.000Z" };
  const sessionWithdrawnGhost = { id: "sess-withdrawn-ghost", participant_id: "p-withdrawn", committee_id: "c1", status: "final", score: 91, assessment: {}, updated_at: "2026-09-01T00:00:00.000Z", finalized_at: "2026-09-01T00:00:00.000Z" };

  sandbox.__initialState = initialState;
  sandbox.__initialSessions = [sessionStaying, sessionWithdrawnGhost];
  vm.runInContext("state = __initialState; committeeSessions = __initialSessions; activeCloudSession = null;", sandbox);

  // بيانات الإدارة المشتركة بعد الانسحاب: المنسحبة لسا موجودة بالقائمة (withdrawn=true)، لم تُنقل.
  sandbox.__remotePayload = {
    config: { competitionName: "تجريبي" },
    participants: [participantStaying, participantWithdrawn],
    draws: initialState.draws,
  };

  await sandbox.refreshCommitteeChanges();

  const finalCommitteeSessions = vm.runInContext("committeeSessions", sandbox);
  const byId = new Map(finalCommitteeSessions.map(s => [s.id, s]));

  assert.ok(byId.has("sess-stays"), "جلسة المتسابقة الباقية (غير منسحبة) يجب ألا تُحذف");
  assert.strictEqual(byId.get("sess-stays").score, 88);

  assert.ok(!byId.has("sess-withdrawn-ghost"), "جلسة المتسابقة المنسحبة (شبح، محذوفة فعلياً بالسيرفر) يجب أن تُستبعد من الذاكرة المحلية بعد الانسحاب، رغم بقائها ضمن نطاق اللجنة اسمياً");

  console.log("committee-poll-prunes-withdrawn-ghost-session.test.js: نجح — استطلاع اللجنة الدوري يستبعد جلسات المتسابقات المنسحبات من الذاكرة المحلية، فلا تُحتسب خطأً ضمن إحصائيات اللجنة (مثال: عدد الممتحنين بدائرة نسبة النجاح)");
}

run().catch((error) => {
  console.error("committee-poll-prunes-withdrawn-ghost-session.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
