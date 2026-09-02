// اختبار آلي لصلاحية "تعديل العلامة": تعديل/تغيير علامة مُسجَّلة سابقاً (أي مصدر) صار حصراً
// للإدارة الرئيسية فقط بناءً على طلب صريح من المستخدم — لا مشرف المسابقة (حتى مع can_edit_
// final) ولا المسؤول الفرعي. إدخال علامة لأول مرة لمتسابق لسا بلا علامة يبقى متاحاً للمشرف.
// شغّله: node tests/score-edit-permission.test.js
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
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

function setContext(kind, extra = {}) { sandbox.window.CloudCompetition = { context: { kind, profile: extra.profile || {}, ...extra } }; }

function run() {
  const untested = { id: "p1" }; // بلا score ولا scoreSource إطلاقًا
  const electronicallyScored = { id: "p2", score: 62, scoreSource: "electronic" };
  const manuallyScored = { id: "p3", score: 90, scoreSource: "manual" };

  setContext("admin");
  assert.strictEqual(sandbox.canEditParticipantScore(untested), true, "الإدارة: تدخل علامة أول مرة");
  assert.strictEqual(sandbox.canEditParticipantScore(electronicallyScored), true, "الإدارة: تعدّل علامة إلكترونية معتمدة سابقاً");
  assert.strictEqual(sandbox.canEditParticipantScore(manuallyScored), true, "الإدارة: تعدّل علامة يدوية مسجّلة سابقاً");

  setContext("supervisor", { profile: { can_edit_final: false } });
  assert.strictEqual(sandbox.canEditParticipantScore(untested), true, "المشرف بلا صلاحية: يقدر يدخل علامة أول مرة لمتسابق لسا بلا علامة");
  assert.strictEqual(sandbox.canEditParticipantScore(electronicallyScored), false, "المشرف بلا صلاحية: ممنوع يعدّل علامة إلكترونية معتمدة سابقاً");
  assert.strictEqual(sandbox.canEditParticipantScore(manuallyScored), false, "المشرف بلا صلاحية: ممنوع يعدّل علامة يدوية مسجّلة سابقاً");

  setContext("supervisor", { profile: { can_edit_final: true } });
  assert.strictEqual(sandbox.canEditParticipantScore(electronicallyScored), false, "المشرف حتى مع can_edit_final=true: ممنوع يعدّل علامة معتمدة سابقاً (الصلاحية صارت حصراً للإدارة)");
  assert.strictEqual(sandbox.canEditParticipantScore(manuallyScored), false, "المشرف حتى مع can_edit_final=true: ممنوع يعدّل علامة يدوية مسجّلة سابقاً");
  assert.strictEqual(sandbox.canEditParticipantScore(untested), true, "المشرف مع can_edit_final=true: لسا يقدر يدخل علامة أول مرة (لم يتأثر هذا المسار)");

  setContext("subAdmin");
  assert.strictEqual(sandbox.canEditParticipantScore(untested), false, "المسؤول الفرعي: ممنوع تماماً حتى لمتسابق بلا علامة (يستخدم مسار طلب DR فقط)");
  assert.strictEqual(sandbox.canEditParticipantScore(electronicallyScored), false, "المسؤول الفرعي: ممنوع تماماً");

  console.log("score-edit-permission.test.js: كل الحالات نجحت — تعديل علامة مسجّلة سابقاً حصراً للإدارة الرئيسية، وإدخال علامة أول مرة يبقى متاحاً للمشرف كالسابق");
}

try { run(); } catch (error) { console.error("score-edit-permission.test.js FAILED:", error.stack || error.message); process.exit(1); }
