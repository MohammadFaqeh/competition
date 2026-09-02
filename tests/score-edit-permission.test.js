// اختبار آلي لصلاحية "تعديل العلامة": الإدارة الرئيسية ومشرف المسابقة كلاهما يُعتبَران "إدارة"
// لهذا الغرض بناءً على طلب صريح — يقدران يعدّلا/يدخلا أي علامة (أول مرة أو مُسجَّلة سابقاً، أي
// مصدر) بلا قيود. المسؤول الفرعي وحده ممنوع تماماً (يستخدم مسار طلب DR فقط).
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
  document: { readyState: "complete", addEventListener: () => {}, querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" } },
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

  // بناءً على طلب صريح لاحق: مشرف المسابقة يُعتبَر "إدارة" أيضاً، بلا أي قيد إضافي (بغض النظر
  // عن can_edit_final، الذي لم يعد ذا صلة لهذا المسار إطلاقاً).
  setContext("supervisor", { profile: { can_edit_final: false } });
  assert.strictEqual(sandbox.canEditParticipantScore(untested), true, "المشرف: يدخل علامة أول مرة");
  assert.strictEqual(sandbox.canEditParticipantScore(electronicallyScored), true, "المشرف: يعدّل علامة إلكترونية معتمدة سابقاً حتى بلا can_edit_final");
  assert.strictEqual(sandbox.canEditParticipantScore(manuallyScored), true, "المشرف: يعدّل علامة يدوية مسجّلة سابقاً حتى بلا can_edit_final");

  setContext("subAdmin");
  assert.strictEqual(sandbox.canEditParticipantScore(untested), false, "المسؤول الفرعي: ممنوع تماماً حتى لمتسابق بلا علامة (يستخدم مسار طلب DR فقط)");
  assert.strictEqual(sandbox.canEditParticipantScore(electronicallyScored), false, "المسؤول الفرعي: ممنوع تماماً");
  assert.strictEqual(sandbox.canEditParticipantScore(manuallyScored), false, "المسؤول الفرعي: ممنوع تماماً");

  console.log("score-edit-permission.test.js: كل الحالات نجحت — الإدارة ومشرف المسابقة كلاهما يقدران يعدّلا أي علامة بلا قيود، المسؤول الفرعي وحده ممنوع تماماً");
}

try { run(); } catch (error) { console.error("score-edit-permission.test.js FAILED:", error.stack || error.message); process.exit(1); }
