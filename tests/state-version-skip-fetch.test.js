// اختبار آلي لتوفير استهلاك الداتا بالاستطلاع الدوري (كل 9 ثوانٍ) عند الإدارة/المشرف واللجان:
// getStateVersion (راجع competition-state-version-check.sql) يُستدعى أولاً بتوقيت خفيف جداً؛
// لو لم يتغيّر عن آخر مرة معروفة، لا يُستدعى loadCompetitionState (الحمولة الكاملة) إطلاقاً.
// يتحقق هذا الاختبار من: (أ) عدم استدعاء التنزيل الكامل عندما لا يتغيّر التوقيت، (ب) استدعاؤه
// فعلياً وتطبيق التحديث بشكل صحيح عندما يتغيّر، لكل من refreshAdminChanges وrefreshCommitteeChanges.
// شغّله: node tests/state-version-skip-fetch.test.js
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

function makeSandbox() {
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
  return sandbox;
}

async function testAdmin() {
  const sandbox = makeSandbox();
  let loadCalls = 0;
  const remotePayloadV1 = { config: { competitionName: "تجريبي" }, participants: [{ id: "p1", name: "أحمد" }], draws: [] };
  const remotePayloadV2 = { config: { competitionName: "تجريبي" }, participants: [{ id: "p1", name: "أحمد" }, { id: "p2", name: "سارة" }], draws: [] };
  let version = "V1", remotePayload = remotePayloadV1;

  sandbox.window.CloudCompetition = {
    context: { kind: "admin" },
    getStateVersion: async () => version,
    loadCompetitionState: async () => { loadCalls++; return { payload: remotePayload, updated_at: version } },
    listRecentFinalSessions: async () => [],
    listCommittees: async () => [],
    markAdminKnownIds() {},
  };
  vm.runInContext("state = defaultState();", sandbox);
  sandbox.renderAll = () => {}; // غير معني بمسار العرض هون، فقط بمنطق تخطي/تنفيذ التنزيل

  // 1) أول نبضة: لا توجد نسخة معروفة سابقاً، يجب أن يُنزّل الحالة الكاملة فعلياً
  await sandbox.refreshAdminChanges();
  assert.strictEqual(loadCalls, 1, "أول نبضة يجب أن تُنزّل الحالة الكاملة (لا نسخة سابقة معروفة)");
  assert.strictEqual(vm.runInContext("state.participants.length", sandbox), 1, "المتسابق p1 وصل فعلياً بعد أول نبضة");

  // 2) نبضة ثانية بنفس النسخة (V1): يجب ألا يُعاد تنزيل الحالة الكاملة إطلاقاً
  await sandbox.refreshAdminChanges();
  assert.strictEqual(loadCalls, 1, "نبضة بنفس النسخة يجب ألا تستدعي التنزيل الكامل ثانية (توفير الداتا)");

  // 3) تغيّرت النسخة فعلياً (V2، متسابق جديد أضافه طرف آخر): يجب أن يُعاد التنزيل ويُطبَّق التحديث
  version = "V2"; remotePayload = remotePayloadV2;
  await sandbox.refreshAdminChanges();
  assert.strictEqual(loadCalls, 2, "نبضة بنسخة جديدة فعلياً يجب أن تستدعي التنزيل الكامل");
  assert.strictEqual(vm.runInContext("state.participants.length", sandbox), 2, "المتسابق الجديد p2 انعكس فعلياً بعد تغيّر النسخة");

  console.log("state-version-skip-fetch.test.js: refreshAdminChanges — نجح (تنزيل عند التغيّر فقط)");
}

async function testCommittee() {
  const sandbox = makeSandbox();
  let loadCalls = 0, liveCalls = 0;
  const committee = { id: "c1", levels: [3], levelNames: ["3 أجزاء"], responsibleGender: null };
  const participant = { id: "p1", name: "أحمد", level: 3, levelName: "3 أجزاء", gender: null, parts: [1, 2, 3] };
  let version = "V1";
  const initialState = { config: { competitionName: "تجريبي" }, participants: [participant], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __initialState; committeeSessions = []; activeCloudSession = null;", Object.assign(sandbox, { __initialState: initialState }));

  sandbox.window.CloudCompetition = {
    context: { kind: "committee", committee },
    refreshCommitteeAccess: async () => {},
    getStateVersion: async () => version,
    loadCompetitionState: async () => { loadCalls++; return { payload: { config: { competitionName: "تجريبي" }, participants: [participant], draws: [] } } },
    listLiveCommitteeSessions: async () => { liveCalls++; return [] },
  };

  // 1) أول نبضة: لا نسخة معروفة سابقاً، يجب أن يُنزّل الحالة الكاملة
  await sandbox.refreshCommitteeChanges();
  assert.strictEqual(loadCalls, 1, "أول نبضة لجنة يجب أن تُنزّل الحالة الكاملة");
  assert.strictEqual(liveCalls, 1, "الجلسات الحيّة تُفحص دائماً بكل نبضة");

  // 2) نبضة ثانية بنفس النسخة: يجب ألا يُعاد تنزيل الحالة الكاملة، لكن الجلسات الحيّة تبقى تُفحص
  await sandbox.refreshCommitteeChanges();
  assert.strictEqual(loadCalls, 1, "نبضة لجنة بنفس النسخة يجب ألا تستدعي التنزيل الكامل ثانية");
  assert.strictEqual(liveCalls, 2, "الجلسات الحيّة استمرت تُفحص رغم تخطي التنزيل الكامل");

  console.log("state-version-skip-fetch.test.js: refreshCommitteeChanges — نجح (تنزيل عند التغيّر فقط، مع بقاء فحص الجلسات الحيّة كل نبضة)");
}

async function run() {
  await testAdmin();
  await testCommittee();
}

run().catch((error) => {
  console.error("state-version-skip-fetch.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
