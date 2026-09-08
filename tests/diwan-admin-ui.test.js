// اختبار آلي لمنطق واجهة إدارة "اختبارات ديوان الحفاظ" (app.js): إضافة متسابق، سحب فردي
// (makeDiwanDraw يعيد استخدام مواضع القرآن العالمية candidates بلا أي تعديل)، وحساب إحصائيات
// renderDiwanParticipants (إجمالي/امتُحن/نسبة نجاح). diwanState منفصل تماماً عن state (السنوية).
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
  // مواضع مصطنعة (لا حاجة لبيانات القرآن الحقيقية لاختبار منطق الاختيار نفسه) — 5 أجزاء بموضع
  // واحد لكل جزء، تطابق أصغر مستوى حقيقي بـLEVEL_CATALOG (5 أجزاء، LEVEL_QUESTIONS[5]=3 أسئلة).
  const fakeCandidates = [1, 2, 3, 4, 5].map(juz => ({ id: `pos-${juz}`, juz, page: juz, words: 40, lineCount: 8, startKey: `${juz}:1`, endKey: `${juz}:5` }));
  vm.runInContext('candidates = __c;', Object.assign(sandbox, { __c: fakeCandidates }));
  sandbox.ensureQuranReady = async () => vm.runInContext("candidates", sandbox);
  sandbox.window.CloudCompetition = { context: {} }; // وضع محلي (operationMode !=="cloud")

  vm.runInContext('diwanState = defaultDiwanState();', sandbox);

  // 1) إضافة متسابق ديوان الحفاظ مستقل تماماً عن state.participants (السنوية)
  const participant = { id: "DP1", name: "أحمد", seat: "001", gender: "ذكر", center: "مجتمع محلي", age: 12, level: 5, levelName: "المستوى السابع - أ (حفظ 5 أجزاء للأقل من 15 سنة)", parts: [1, 2, 3, 4, 5], createdAt: new Date().toISOString() };
  vm.runInContext('diwanState.participants.push(__p);', Object.assign(sandbox, { __p: participant }));
  assert.strictEqual(vm.runInContext("diwanState.participants.length", sandbox), 1, "المتسابق أُضيف لـdiwanState");
  assert.strictEqual(vm.runInContext("state.participants.length", sandbox), 0, "state (السنوية) لم يتأثر إطلاقاً");

  // 2) سحب فردي: يعيد استخدام candidates العالمية بلا أي منع تكرار
  const draw = await sandbox.makeDiwanDraw(participant, [1, 2, 3, 4, 5]);
  assert.strictEqual(draw.participantId, "DP1", "السحب مرتبط بالمتسابق الصحيح");
  assert.strictEqual(draw.positions.length, 3, "3 مواضع (LEVEL_QUESTIONS[5]=3) من أصل 5 أجزاء محفوظة");
  assert.ok(draw.positions.every(p => [1, 2, 3, 4, 5].includes(p.juz)), "كل المواضع المختارة من أجزاء المتسابق فقط");
  assert.ok(draw.id.startsWith("DDRAW-"), "معرّف السحب ببادئة ديوان الحفاظ المستقلة (DDRAW) لا بادئة السنوية");

  vm.runInContext('diwanState.draws.push(__d);', Object.assign(sandbox, { __d: draw }));

  // 3) إحصائيات renderDiwanParticipants: قبل أي علامة يجب أن تكون نسبة النجاح 0%، ثم تتحدّث بعد التسجيل
  sandbox.renderDiwanParticipants();
  assert.strictEqual(queryElement("#diwanStatTotal").textContent, "1", "إجمالي المتسابقين = 1");
  assert.strictEqual(queryElement("#diwanStatExamined").textContent, "0", "لا أحد امتُحن بعد (لا لجان/تصحيح إلكتروني بهذه المرحلة)");
  assert.strictEqual(queryElement("#diwanStatPassRate").textContent, "0%", "نسبة النجاح 0% قبل أي علامة");

  participant.score = 88;
  sandbox.renderDiwanParticipants();
  assert.strictEqual(queryElement("#diwanStatExamined").textContent, "1", "امتُحن = 1 بعد تسجيل علامة حقيقية");
  assert.strictEqual(queryElement("#diwanStatPassRate").textContent, "100%", "نسبة النجاح 100% (علامة 88 >= 75)");

  console.log("diwan-admin-ui.test.js: كل الحالات نجحت — سحب مستقل تماماً عن السنوية، وإحصائيات ديوان الحفاظ صحيحة");
}

run().catch(error => {
  console.error("diwan-admin-ui.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
