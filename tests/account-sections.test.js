// اختبار آلي: «القسم» لكل حساب بالواجهة (supabase/account-sections.sql يفرضه بالخادم).
// - حساب «ديوان فقط» يدخل من رابط السنوية ⇒ يُخرَج وتظهر رسالة توجّهه لقسمه (والعكس)، و«الاثنين» يدخل كما كان.
// - تعذّر معرفة القسم (الملف غير مُشغَّل بعد) ⇒ «الاثنين» كما كان.
// - قوائم اللجان: لجنة «سنوية فقط» لا تُعرض بالديوان، و«ديوان فقط» لا تُعرض بالسنوية.
// شغّله: node tests/account-sections.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const markerRe = /if\(document\.readyState===("|')loading\1\)document\.addEventListener\("DOMContentLoaded",init,\{once:true\}\);\s*else init\(\);/;
function load(section) {
  let src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  if (!markerRe.test(src)) throw new Error("bootstrap marker not found");
  src = src.replace(markerRe, "/* init disabled */");
  const els = new Map();
  const fake = () => ({ textContent: "", innerHTML: "", value: "", classList: { add() {}, remove() {}, toggle() {}, contains: () => true }, insertAdjacentHTML() {} });
  const el = s => { if (!els.has(s)) els.set(s, fake()); return els.get(s) };
  const sb = {
    console, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: "complete", hidden: false, addEventListener() {}, querySelector: el, querySelectorAll: () => [], documentElement: { classList: { add() {}, remove() {}, toggle() {} } } },
    navigator: { onLine: true }, crypto: require("crypto").webcrypto, fetch: () => Promise.reject(new Error("no fetch")),
    location: { hash: "", href: "", search: "" }, history: { pushState() {}, replaceState() {} },
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout, lucide: { createIcons() {} },
    APP_SECTION: section,
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: "app.js" });
  return { sb, el };
}

async function enter(section, accountSections, kind = "committee") {
  const { sb } = load(section);
  const calls = [];
  const log = n => (...a) => calls.push([n, ...a]);
  Object.assign(sb, { showScreen: log("showScreen"), setAdminTheme() {}, setCommitteeTrack: log("setCommitteeTrack"), startCommitteeAutoRefresh() {}, stopCommitteeAutoRefresh() {}, resetSubAdminRestrictions() {}, showApp: log("showApp"), toast: log("toast"), renderCommitteeWorkspace: () => Promise.resolve(true) });
  let signedOut = false;
  sb.window.CloudCompetition = { context: { kind }, accountSections: accountSections === undefined ? undefined : async () => { if (accountSections instanceof Error) throw accountSections; return accountSections }, signOut: async () => { signedOut = true } };
  await sb.enterCloudContext({ kind, profile: { role: kind }, committee: { name: "لجنة 1", responsibleGender: "أنثى" } });
  return { calls, signedOut, sb };
}

async function run() {
  // ١) «ديوان فقط» من رابط السنوية ⇒ خروج ورسالة، ولا تُفتح شاشة اللجنة
  let r = await enter("annual", "diwan");
  assert.ok(r.signedOut, "يُسجَّل خروجه");
  assert.ok(r.calls.some(c => c[0] === "showScreen" && c[1] === "cloudLoginScreen"), "يعود لشاشة الدخول");
  assert.ok(!r.calls.some(c => c[0] === "showScreen" && c[1] === "committeeApp"), "لا تُفتح شاشة اللجنة");

  // ٢) «ديوان فقط» من رابط الديوان ⇒ يدخل، وشاشة اللجنة على مسار الديوان
  r = await enter("diwan", "diwan");
  assert.ok(!r.signedOut);
  assert.ok(r.calls.some(c => c[0] === "showScreen" && c[1] === "committeeApp"), "تُفتح شاشة اللجنة");
  assert.ok(r.calls.some(c => c[0] === "setCommitteeTrack" && c[1] === "diwan"));
  assert.strictEqual(vm.runInContext("accountDiwanOnlyHere()", r.sb), true, "لا تُحمَّل بيانات السنوية لهذا الحساب");

  // ٣) «سنوية فقط» من رابط الديوان ⇒ خروج ورسالة
  r = await enter("diwan", "annual");
  assert.ok(r.signedOut && !r.calls.some(c => c[1] === "committeeApp"));

  // ٤) «الاثنين» يدخل القسمين كما كان، ولا تقييد على التحميل
  for (const section of ["annual", "diwan"]) {
    r = await enter(section, "both");
    assert.ok(!r.signedOut && r.calls.some(c => c[1] === "committeeApp"), `«الاثنين» يدخل ${section}`);
    assert.strictEqual(vm.runInContext("accountDiwanOnlyHere()", r.sb), false);
  }

  // ٥) الملف غير مُشغَّل (الدالة غير موجودة بالواجهة القديمة أو ترجع خطأ) ⇒ «الاثنين»
  r = await enter("annual", undefined);
  assert.ok(!r.signedOut && r.calls.some(c => c[1] === "committeeApp"), "بلا دالة القسم: كما كان");

  // ٦) قوائم اللجان حسب القسم
  const { sb } = load("diwan");
  const committees = [
    { id: "a", name: "سنوية", active: true, responsible_gender: "أنثى", sections: "annual", levels: [10] },
    { id: "d", name: "ديوان", active: true, responsible_gender: "أنثى", sections: "diwan", levels: [10] },
    { id: "b", name: "القسمان", active: true, responsible_gender: "أنثى", sections: "both", levels: [10] },
    { id: "o", name: "قديمة بلا قسم", active: true, responsible_gender: "أنثى", levels: [10] },
  ];
  sb.__c = committees;
  const ids = opts => [...vm.runInContext(`resolveParticipantCommittee({gender:"أنثى",level:10},__c,${JSON.stringify(opts)}).committees.map(c=>c.id)`, sb)].sort().join(",");
  assert.strictEqual(ids({ includeAllGenders: true, section: "diwan" }), "b,d,o", "الديوان: بلا لجنة «سنوية فقط»");
  assert.strictEqual(ids({ includeAllGenders: true }), "a,b,o", "السنوية (الافتراضي): بلا لجنة «ديوان فقط»");
  assert.strictEqual(vm.runInContext(`resolveParticipantCommittee({gender:"أنثى",level:10},__c,{}).currentId`, sb), "a", "التعيين التلقائي بالسنوية لا يختار لجنة الديوان");

  console.log("account-sections.test.js: نجح — رفض الدخول من رابط القسم الآخر، «الاثنين» كما كان، التسامح قبل تشغيل الملف، وقوائم اللجان حسب القسم");
}
run().catch(error => { console.error("account-sections.test.js FAILED:", error); process.exit(1); });
