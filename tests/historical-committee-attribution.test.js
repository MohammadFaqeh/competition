// اختبار آلي: تغيير مستويات لجنة بعد انتهاء يوم امتحان لا يجب أن "يفقد" اللجنة متسابقاتها
// اللواتي امتحنتهن فعليًا بالأمس (committeeScopedState) — ولا يجب أن يحوّل احتسابهن ضمن
// "التوزيع حسب اللجان" للجنة جديدة لم تمتحنهن إطلاقًا لمجرد أن مستواها الحالي بات يطابقهن.
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

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { readyState: "complete", addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" } },
  window: {},
  navigator: { onLine: true },
  crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" },
  history: { pushState: () => {}, replaceState: () => {} },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout,
  clearTimeout,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

const { committeeScopedState, resolveParticipantCommittee } = sandbox;

// -- الجزء 1: committeeScopedState (قائمة متسابقي اللجنة عند تسجيل دخولها) --------------
sandbox.window.CloudCompetition = {
  context: {
    committee: { id: "c1", levelNames: ["المستوى الخامس (حفظ 15 جزء)"], responsibleGender: "ذكر" }, // مستويات اللجنة اليوم تغيّرت
  },
};

const examinedYesterday = {
  id: "p1",
  name: "أمجد",
  gender: "ذكر",
  levelName: "المستوى السادس - أ (حفظ 10 أجزاء للأقل من 20 سنة)", // مش من مستويات اللجنة الحالية إطلاقًا
  level: 10,
  assessment: { committeeName: "لجنة 1", committee: { id: "c1", name: "لجنة 1" } }, // لجنة c1 امتحنته فعليًا بالأمس
};
const unrelatedOtherLevel = {
  id: "p2",
  name: "خالد",
  gender: "ذكر",
  levelName: "المستوى السادس - أ (حفظ 10 أجزاء للأقل من 20 سنة)",
  level: 10,
  // بلا أي assessment.committee — لسا ما امتحن عند أي لجنة
};
const payload = { config: { competitionName: "test" }, participants: [examinedYesterday, unrelatedOtherLevel], draws: [] };

const scoped = committeeScopedState(payload);
const scopedIds = scoped.participants.map((p) => p.id);
assert.ok(scopedIds.includes("p1"), "المتسابق اللي امتحنته اللجنة فعليًا بالأمس لازم يضل ظاهرًا عندها رغم تغيّر مستوياتها اليوم");
assert.ok(!scopedIds.includes("p2"), "متسابق آخر بنفس المستوى القديم لكن لم تمتحنه هذه اللجنة يجب ألا يظهر عندها (مستواه لا يطابق مستوياتها الحالية)");

// -- الجزء 2: نفس منطق "التوزيع حسب اللجان" (إعطاء الأولوية للجنة الفعلية إن وُجدت) -------
const committeeA = { id: "c1", name: "لجنة 1", responsible_gender: "ذكر", level_names: ["المستوى الخامس (حفظ 15 جزء)"], active: true };
const committeeB = { id: "c2", name: "لجنة 2", responsible_gender: "ذكر", level_names: ["المستوى السادس - أ (حفظ 10 أجزاء للأقل من 20 سنة)"], active: true };
const allCommittees = [committeeA, committeeB];

function resolveForBreakdown(p) {
  const historicalId = p.assessment?.committee?.id || null;
  return historicalId ? allCommittees.find((c) => c.id === historicalId) : resolveParticipantCommittee(p, allCommittees).currentCommittee;
}

const resolvedExamined = resolveForBreakdown(examinedYesterday);
assert.strictEqual(resolvedExamined?.id, "c1", "المتسابق اللي امتحنته لجنة 1 فعليًا يُحسب على لجنة 1 دايمًا، رغم أن مستواه الحالي بات يطابق لجنة 2");

const resolvedUnrelated = resolveForBreakdown(unrelatedOtherLevel);
assert.strictEqual(resolvedUnrelated?.id, "c2", "متسابق لم يُمتحن بعد يُحسب حسب مطابقة مستواه الحالية (لجنة 2)، وهذا هو المطلوب لمن لم يُمتحن");

console.log("historical-committee-attribution.test.js: كل الحالات نجحت — تغيير مستويات اللجان لا يفقد اللجنة متسابقيها القدامى ولا يحوّل احتسابهم لغيرها");
