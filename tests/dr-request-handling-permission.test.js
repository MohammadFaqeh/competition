// اختبار آلي لصلاحية "التعامل مع طلبات DR": الإدارة ومشرف المسابقة يقدران دائماً يوافقا/يرفضا
// أي طلب. المسؤول الفرعي ممنوع افتراضياً (نفس منع تعديل العلامة مباشرة، راجع score-edit-
// permission.test.js)، إلا إذا فُعِّلت له صلاحية can_edit_final صراحة (sub-admin-permissions-
// toggle.sql) — عندها يقدر يوافق/يرفض طلبات متسابقي جنسه هو فقط (النطاق مضمون أصلاً عبر
// sub_admin_load_state التي لا تُرسل له إلا بيانات جنسه، لا حاجة لفحص إضافي هون).
// شغّله: node tests/dr-request-handling-permission.test.js
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

function run() {
  // (isMainAdmin, isSupervisor, isSubAdmin) — نفس ثلاثية الأعلام المحسوبة فعلياً بـrenderParticipants
  sandbox.window.CloudCompetition = { context: {} };
  assert.strictEqual(sandbox.canHandleDrRequests(true, false, false), true, "الإدارة الرئيسية: تقدر دائماً");
  assert.strictEqual(sandbox.canHandleDrRequests(false, true, false), true, "مشرف المسابقة: يقدر دائماً");

  sandbox.window.CloudCompetition = { context: { subAdmin: {} } };
  assert.strictEqual(sandbox.canHandleDrRequests(false, false, true), false, "مسؤول فرعي بلا can_edit_final: ممنوع افتراضياً");

  sandbox.window.CloudCompetition = { context: { subAdmin: { can_edit_final: false } } };
  assert.strictEqual(sandbox.canHandleDrRequests(false, false, true), false, "مسؤول فرعي وcan_edit_final=false صراحة: ممنوع");

  sandbox.window.CloudCompetition = { context: { subAdmin: { can_edit_final: true } } };
  assert.strictEqual(sandbox.canHandleDrRequests(false, false, true), true, "مسؤول فرعي وcan_edit_final=true: مسموح");

  console.log("dr-request-handling-permission.test.js: كل الحالات نجحت — الإدارة/المشرف دائماً، المسؤول الفرعي فقط بعد تفعيل can_edit_final صراحة");
}

try { run(); } catch (error) { console.error("dr-request-handling-permission.test.js FAILED:", error.stack || error.message); process.exit(1); }
