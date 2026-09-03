// اختبار آلي لتنقيح صريح من المستخدم: ليس كل متسابق "منسحب" يُستبعد من إحصائيات "الممتحنين"/نسبة
// النجاح — فقط من انسحب بلا اختبار حقيقي (علامته الحالية = صفر، وهذا ما يضمنه دائماً
// toggleParticipantWithdrawn/استيراد Excel عند الانسحاب الفعلي). أما متسابق اختبر فعلياً وأخذ
// علامة حقيقية أكثر من صفر ثم صار withdrawn=true لاحقاً (مثال: صُحِّحت علامته يدوياً بعد الانسحاب)
// فيجب أن يبقى محسوباً ضمن "الممتحنين" وضمن نسبة النجاح — بنفس المعيار المستخدم بكل مكان بالموقع:
// علامة حقيقية > صفر، بغض النظر عن withdrawn.
// شغّله: node tests/withdrawn-with-real-score-still-examined.test.js
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
    dataset: {}, style: { setProperty() {} }, value: "", textContent: "", innerHTML: "", disabled: false,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => { if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false } classes.add(c); return true } if (force) classes.add(c); else classes.delete(c); return force },
      contains: (c) => classes.has(c),
    },
    closest() { return this },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null },
    querySelector() { return makeElement() }, querySelectorAll() { return [] },
    appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, click() {},
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
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
  lucide: { createIcons() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

async function run() {
  // 1) passRateOf (المعيار المركزي المُستخدَم بلوحة تحكم الإدارة، بما فيها بطاقات اللجان):
  //    منسحبة بعلامة حقيقية > صفر تُحسب ضمن الممتحنين، منسحبة بعلامة صفر (الحالة الطبيعية للانسحاب
  //    الفعلي) تُستبعد كما بالسابق تماماً.
  const list = [
    { id: "p1", withdrawn: false, score: 60 }, // راسبة (غير منسحبة)
    { id: "p2", withdrawn: true, score: 0, scoreSource: "withdrawn" }, // انسحاب حقيقي بلا اختبار
    { id: "p3", withdrawn: true, score: 82, scoreSource: "electronic" }, // اختبرت فعلياً (ناجحة) ثم انسحبت لاحقاً
  ];
  const rate = sandbox.passRateOf(list);
  // لو p3 مُستبعدة (منطق "استبعد كل منسحب" القديم): الممتحنون = p1 فقط (راسبة) → 0%.
  // لو p3 محسوبة (المطلوب): الممتحنون = p1+p3 → 1 من 2 ناجحة (p3) → 50%. يميّز الحالتين فعلياً.
  assert.strictEqual(rate, 50, "passRateOf يجب أن يحسب p3 (منسحبة لاحقاً لكن علامتها الحقيقية 82 > صفر) ضمن الممتحنين — نسبة 50% (1 ناجحة من 2)، وليس 0% (لو استُبعدت كل حالة انسحاب دون تمييز)");

  // 2) refreshCommitteeChanges + renderCommitteePassRate (جانب اللجنة): نفس المبدأ على جلسات
  //    committeeSessions الحقيقية.
  const committee = { id: "c1", levels: [3], levelNames: ["3 أجزاء"], responsibleGender: null, show_score: true };
  sandbox.window.CloudCompetition = {
    get context() { return { kind: "committee", committee } },
    refreshCommitteeAccess: async () => {},
    loadCompetitionState: async () => ({ payload: sandbox.__remotePayload }),
    listLiveCommitteeSessions: async () => [],
    listSessions: async () => { throw new Error("لا يجب أن يُستدعى listSessions الكامل من الاستطلاع الدوري") },
    lookupChangeTimes: async () => [],
  };

  const participantTested = { id: "p-tested", name: "اختبرت ثم انسحبت", level: 3, levelName: "3 أجزاء", gender: null, parts: [1, 2, 3], withdrawn: true, score: 77, scoreSource: "electronic" };
  const initialState = {
    config: { competitionName: "تجريبي" },
    participants: [participantTested],
    draws: [{ id: "d-tested", participantId: "p-tested", positions: [{ id: "pos-tested" }] }],
    resets: [], deletions: [],
  };
  const sessionTested = { id: "sess-tested", participant_id: "p-tested", committee_id: "c1", status: "final", score: 77, assessment: {}, updated_at: "2026-09-01T00:00:00.000Z", finalized_at: "2026-09-01T00:00:00.000Z" };

  sandbox.__initialState = initialState;
  sandbox.__initialSessions = [sessionTested];
  vm.runInContext("state = __initialState; committeeSessions = __initialSessions; activeCloudSession = null;", sandbox);
  sandbox.__remotePayload = { config: { competitionName: "تجريبي" }, participants: [participantTested], draws: initialState.draws };

  await sandbox.refreshCommitteeChanges();

  const finalCommitteeSessions = vm.runInContext("committeeSessions", sandbox);
  assert.ok(finalCommitteeSessions.some(s => s.id === "sess-tested"), "جلسة المتسابقة التي اختبرت فعلياً (علامة 77 > صفر) يجب ألا تُحذف رغم انسحابها لاحقاً — استطلاع اللجنة الدوري");

  sandbox.renderCommitteePassRate(committee);
  const examinedCount = vm.runInContext('document.querySelector("#committeeExaminedCount").textContent', sandbox);
  assert.strictEqual(examinedCount, "1", "دائرة نسبة النجاح عند اللجنة يجب أن تحسب المتسابقة التي اختبرت فعلياً رغم انسحابها لاحقاً");

  console.log("withdrawn-with-real-score-still-examined.test.js: نجح — متسابق انسحب لاحقاً لكنه اختبر فعلياً وأخذ علامة حقيقية > صفر يبقى محسوباً ضمن الممتحنين، على عكس انسحاب حقيقي بلا اختبار (علامة صفر) الذي يبقى مستبعداً كما بالسابق");
}

run().catch(error => { console.error("withdrawn-with-real-score-still-examined.test.js FAILED:", error.stack || error.message); process.exit(1); });
