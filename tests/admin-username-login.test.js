// اختبار آلي لدخول الإدارة/المشرف باسم مستخدم بسيط (مثل admin) بدل الإيميل:
// اسم بلا "@" يُكمَّل لـ<اسم>@koura.local (حساب Supabase Auth بهذا الإيميل)، والإيميل الكامل يبقى كما هو
// (دخول المدير الرئيسي الحالي لا يتغير)، ومسار "نسيت كلمة السر" يكمّل الاسم للإدارة فقط — لا لرموز اللجان/المسؤولين.
// شغّله: node tests/admin-username-login.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

let appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const markerRe = /if\(document\.readyState===("|')loading\1\)document\.addEventListener\("DOMContentLoaded",init,\{once:true\}\);\s*else init\(\);/;
if (!markerRe.test(appSrc)) throw new Error("bootstrap marker not found — app.js structure changed, update this test");
appSrc = appSrc.replace(markerRe, "/* init() disabled for headless test */");

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { readyState: "complete", addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" } },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState: () => {}, replaceState: () => {} },
  setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });
const { adminLoginEmail, recoveryIdentifierFor } = sandbox;

assert.strictEqual(adminLoginEmail("admin"), "admin@koura.local", "اسم بسيط يُكمَّل للإيميل الداخلي");
assert.strictEqual(adminLoginEmail("  Admin "), "admin@koura.local", "المسافات تُحذف والحروف تصير صغيرة (إيميلات Supabase غير حساسة لحالة الأحرف)");
assert.strictEqual(adminLoginEmail("owner@gmail.com"), "owner@gmail.com", "الإيميل الكامل يبقى كما هو — دخول المدير الرئيسي لا يتغير");
assert.strictEqual(adminLoginEmail(""), "", "الحقل الفارغ يبقى فارغاً");
assert.strictEqual(recoveryIdentifierFor("admin", "admin"), "admin@koura.local", "استعادة كلمة السر للإدارة تكمّل الاسم");
assert.strictEqual(recoveryIdentifierFor("committee", "L01"), "L01", "رمز اللجنة لا يُمس");
assert.strictEqual(recoveryIdentifierFor("subAdmin", "SA-M"), "SA-M", "رمز المسؤول الفرعي لا يُمس");

console.log("admin-username-login.test.js: نجح — admin يصير admin@koura.local، والإيميل الكامل ورموز اللجان/المسؤولين تبقى كما هي");
