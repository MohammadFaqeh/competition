// الدخول الفوري بعد التحقق (2026-11-18): شاشة «جارٍ تسجيل الدخول» كانت تنتظر كل البيانات قبل الدخول.
// - اللجنة: enterCloudContext ينتهي فوراً (شاشة اللجنة + «جارٍ تحميل المتسابقين...») حتى لو تحميل القائمة لم ينتهِ.
// - الإدارة/المشرف: اللوحة تُفتح بعد بيانات المسابقة واللجان، والنتائج المعتمدة (listFinalSessions) تُدمج بالخلفية بعدها.
// - فشل تحميل النتائج بالخلفية: رسالة فقط، بلا رفض غير معالج وبلا خروج من اللوحة.
// شغّله: node tests/fast-login.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

let appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const markerRe = /if\(document\.readyState===("|')loading\1\)document\.addEventListener\("DOMContentLoaded",init,\{once:true\}\);\s*else init\(\);/;
if (!markerRe.test(appSrc)) throw new Error("bootstrap marker not found — app.js structure changed, update this test");
appSrc = appSrc.replace(markerRe, "/* init() disabled for headless test */");

const elements = new Map();
const fakeEl = () => ({ textContent: "", innerHTML: "", value: "", classList: { add() {}, remove() {}, toggle() {}, contains: () => true } });
const el = selector => { if (!elements.has(selector)) elements.set(selector, fakeEl()); return elements.get(selector) };
const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { readyState: "complete", hidden: false, addEventListener() {}, querySelector: el, querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl", classList: { add() {}, remove() {}, toggle() {} } } },
  navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

const calls = [];
const log = name => (...args) => { calls.push([name, ...args]) };
Object.assign(sandbox, {
  showScreen: log("showScreen"), setAdminTheme: log("setAdminTheme"), setCommitteeTrack: log("setCommitteeTrack"),
  startCommitteeAutoRefresh: log("startCommitteeAutoRefresh"), stopCommitteeAutoRefresh() {}, resetSubAdminRestrictions() {},
  showApp: log("showApp"), renderAll: log("renderAll"), toast: log("toast"),
  mergeFinalSessionsIntoState: log("merge"),
});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } };
const within = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: لم ينتهِ خلال ${ms}ms — الدخول ما زال ينتظر التحميل`)), ms))]);
const tick = () => new Promise(resolve => setImmediate(resolve));
const unhandled = [];
process.on("unhandledRejection", error => unhandled.push(error));

async function run() {
  // ===== ١) اللجنة: الدخول لا ينتظر تحميل القائمة =====
  {
    calls.length = 0;
    const load = deferred();
    sandbox.renderCommitteeWorkspace = () => { calls.push(["renderCommitteeWorkspace"]); return load.promise };
    sandbox.window.CloudCompetition = { context: { kind: "committee" } };
    await within(sandbox.enterCloudContext({ kind: "committee", profile: { role: "committee" }, committee: { name: "لجنة رقم 5", responsibleGender: "أنثى" } }), 200, "دخول اللجنة");
    const names = calls.map(c => c[0]);
    assert.ok(names.includes("showScreen") && calls.find(c => c[0] === "showScreen")[1] === "committeeApp", "تُفتح شاشة اللجنة فوراً");
    assert.ok(names.includes("renderCommitteeWorkspace") && names.includes("startCommitteeAutoRefresh"), "تحميل القائمة بدأ بالخلفية والتحديث التلقائي يعمل");
    assert.strictEqual(el("#committeeName").textContent, "لجنة: لجنة رقم 5", "اسم اللجنة ظاهر فوراً");
    assert.ok(el("#committeeStudents").innerHTML.includes("جارٍ تحميل المتسابقين"), "مكان القائمة: جارٍ تحميل المتسابقين...");
    load.reject(new Error("انقطاع"));
    await tick(); await tick();
    assert.ok(calls.some(c => c[0] === "toast" && String(c[1]).includes("تعذر تحميل بيانات اللجنة")), "فشل التحميل: رسالة للجنة");
  }

  // ===== ٢) الإدارة: اللوحة تُفتح قبل النتائج المعتمدة، والنتائج تُدمج بعدها =====
  {
    calls.length = 0;
    const sessions = deferred();
    vm.runInContext("state = defaultState(); cloudCommittees = [];", sandbox);
    sandbox.window.CloudCompetition = {
      context: { kind: "admin" },
      loadCompetitionState: async () => ({ payload: { config: { competitionName: "تجريبي" }, participants: [], draws: [] }, updated_at: "2026-11-18T00:00:00Z" }),
      listCommittees: async () => [{ id: "C5", name: "لجنة رقم 5" }],
      listFinalSessions: () => sessions.promise,
      markAdminKnownIds() {},
    };
    await within(sandbox.enterCloudContext({ kind: "admin", profile: { role: "admin", display_name: "الإدارة" } }), 200, "دخول الإدارة");
    assert.ok(calls.some(c => c[0] === "showApp"), "اللوحة فُتحت بعد بيانات المسابقة واللجان");
    assert.ok(!calls.some(c => c[0] === "merge"), "النتائج المعتمدة لم تُنتظر قبل فتح اللوحة");
    assert.strictEqual(vm.runInContext("cloudCommittees.length", sandbox), 1, "اللجان محمّلة قبل فتح اللوحة");
    sessions.resolve([{ id: "S1", status: "final" }]);
    await tick(); await tick();
    const merge = calls.find(c => c[0] === "merge");
    assert.ok(merge && merge[1][0].id === "S1" && merge[2][0].id === "C5", "النتائج دُمجت بالخلفية مع اللجان");
    assert.ok(calls.findIndex(c => c[0] === "renderAll") > calls.findIndex(c => c[0] === "merge"), "ثم أُعيد رسم الأرقام");
  }

  // ===== ٣) الإدارة: فشل النتائج بالخلفية = رسالة فقط، لا خروج من اللوحة ولا رفض غير معالج =====
  {
    calls.length = 0;
    sandbox.window.CloudCompetition.listFinalSessions = () => Promise.reject(new Error("مهلة"));
    await within(sandbox.enterCloudContext({ kind: "admin", profile: { role: "admin" } }), 200, "دخول الإدارة مع فشل النتائج");
    await tick(); await tick();
    assert.ok(calls.some(c => c[0] === "showApp"), "اللوحة مفتوحة");
    assert.ok(calls.some(c => c[0] === "toast" && String(c[1]).includes("تعذر تحميل نتائج اللجان")), "رسالة فشل النتائج");
    assert.ok(!calls.some(c => c[0] === "showScreen" && c[1] === "cloudLoginScreen"), "لا رجوع لشاشة الدخول");
  }

  await tick();
  assert.strictEqual(unhandled.length, 0, `لا رفض غير معالج: ${unhandled.map(e => e.message)}`);
  console.log("fast-login.test.js: نجح — اللجنة تدخل فوراً وقائمتها تُحمَّل بالخلفية، والإدارة تفتح اللوحة قبل النتائج المعتمدة ثم تُدمج، والفشل رسالة فقط");
}

run().catch(error => { console.error("fast-login.test.js FAILED:", error.stack || error.message); process.exit(1) });
