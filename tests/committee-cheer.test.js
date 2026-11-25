// اختبار آلي لرسائل تحفيز اللجان (2026-11-25): إعدادات الإدارة وحدودها، متى تظهر الرسالة (كل N متسابقين معتمدين)،
// عدم الظهور عند أول دخول، صيغة المؤنث للجان الإناث، وتجاهل المنسحبين والجلسات غير المعتمدة.
// شغّله: node tests/committee-cheer.test.js
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

const store = new Map();
const sandbox = {
  console,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
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
const run = code => vm.runInContext(code, sandbox);
const { committeeCheerConfig, committeeCheerCrossed, committeeCheerCountLabel, committeeCheerPool } = sandbox;

// 1) الإعدادات: الافتراضي مفعّل، كل 3، دقيقة، كل الأنواع؛ والقيم الخاطئة تُصحَّح
let cfg = committeeCheerConfig(undefined);
assert.strictEqual(cfg.enabled, true);
assert.strictEqual(cfg.every, 3);
assert.strictEqual(cfg.seconds, 60);
assert.deepStrictEqual([...cfg.kinds], ["verse", "hadith", "dua", "cheer", "custom"]);
cfg = committeeCheerConfig({ enabled: false, every: "0", seconds: 999, kinds: ["dua", "hack"], custom: [" أ ", "", "x".repeat(400)] });
assert.strictEqual(cfg.enabled, false);
assert.strictEqual(cfg.every, 3); // 0 أو فارغ = الافتراضي
assert.strictEqual(cfg.seconds, 60);
assert.deepStrictEqual([...cfg.kinds], ["dua"]);
assert.deepStrictEqual(cfg.custom.map(t => t.length), [1, 300]);
assert.strictEqual(committeeCheerConfig({ every: 999 }).every, 50);
// النوع المحدد فقط يدخل التدوير، ورسائل الإدارة تُضاف عند اختيارها
assert.ok(committeeCheerPool(committeeCheerConfig({ kinds: ["dua"] })).every(m => m.kind === "dua"));
assert.strictEqual(committeeCheerPool(committeeCheerConfig({ kinds: ["custom"], custom: ["رسالة"] }))[0].text, "رسالة");

// 2) متى تظهر: عند عبور مضاعف جديد فقط
assert.strictEqual(committeeCheerCrossed(2, 3, 3), true);
assert.strictEqual(committeeCheerCrossed(3, 4, 3), false);
assert.strictEqual(committeeCheerCrossed(5, 6, 3), true);
assert.strictEqual(committeeCheerCrossed(2, 7, 3), true);
assert.strictEqual(committeeCheerCrossed(6, 5, 3), false); // إلغاء اختبار لا يُظهر رسالة
assert.strictEqual(committeeCheerCrossed(0, 1, 1), true);

// 3) الصيغ: مذكر ومؤنث
assert.strictEqual(committeeCheerCountLabel(3), "أتممتم 3 متسابقين");
assert.strictEqual(committeeCheerCountLabel(3, true), "أتممتنّ 3 متسابقات");
assert.strictEqual(committeeCheerCountLabel(12, true), "أتممتنّ 12 متسابقةً");
assert.strictEqual(committeeCheerCountLabel(2), "أتممتم متسابقَين");
const female = committeeCheerPool(committeeCheerConfig({ kinds: ["cheer"] }))[0];
assert.ok(female.textF.includes("حافظات") && female.text.includes("حفّاظ"));

// 4) التدفق باللجنة: أول تحميل يحفظ فقط، ثم المتسابق الثالث المعتمد يجهّز رسالة (والمنسحب/غير المعتمد لا يُحسب)
sandbox.CloudCompetition = { context: { committee: { id: "c1", examiner_role: "member", responsible_gender: "أنثى" } } };
const session = (id, status = "final", score = 90) => ({ participant_id: id, status, score });
run(`state={config:{committeeCheer:{every:3}},participants:[{id:"a"},{id:"b"},{id:"c"},{id:"w",withdrawn:true}],draws:[]}`);
sandbox.__sessions = [session("a"), session("w")];
run("committeeSessions=__sessions;committeeCheerPending=null;checkCommitteeCheer()");
assert.strictEqual(JSON.parse(store.get("competition-committee-cheer-c1-member")).count, 1);
assert.strictEqual(run("committeeCheerPending"), null);
sandbox.__sessions = [session("a"), session("w"), session("b"), session("c", "in_progress")];
run("committeeSessions=__sessions;checkCommitteeCheer()");
assert.strictEqual(run("committeeCheerPending"), null);
sandbox.__sessions = [session("a"), session("w"), session("b"), session("c")];
run("committeeSessions=__sessions;checkCommitteeCheer()");
assert.deepStrictEqual({ ...run("committeeCheerPending") }, { count: 3 });
assert.strictEqual(run("committeeCheerFemale()"), true);
// معطّلة من الإدارة = لا رسالة
store.set("competition-committee-cheer-c1-member", JSON.stringify({ count: 2, next: 0 }));
run(`state.config.committeeCheer={enabled:false,every:3};committeeCheerPending=null;checkCommitteeCheer()`);
assert.strictEqual(run("committeeCheerPending"), null);

console.log("committee-cheer.test.js passed");
