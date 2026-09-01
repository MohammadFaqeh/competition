// اختبار آلي لفلتر "عرض بيانات يوم محدد" بلوحة التحكم (نظرة عامة): يتيح اختيار يوم واحد
// فيعرض من امتُحن/نجح/رسب/انسحب بذلك اليوم بالضبط (حسب gradedAt)، مع خيار "الكل" ليعرض
// تراكم الدورة كاملة كما كان دائماً. "إجمالي المتسابقين المسجَّلين" يبقى ثابتاً تراكمياً
// دائماً بغض النظر عن اليوم المختار لأنه رقم تسجيل مسبق لا علاقة له بيوم امتحان.
// شغّله: node tests/dashboard-date-filter.test.js
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

const { isParticipantGradedOn, dashboardScopedParticipants, passRateOf } = sandbox;

function p(id, gradedAt, score, withdrawn) {
  return { id, name: id, gender: "ذكر", gradedAt, score, withdrawn: Boolean(withdrawn) };
}

const participants = [
  p("day1-pass", "2026-09-01T10:00:00.000Z", 90),
  p("day1-fail", "2026-09-01T18:30:00.000Z", 60),
  p("day2-pass", "2026-09-02T09:00:00.000Z", 85),
  p("not-graded-yet", null, undefined),
];
vm.runInContext("state={participants:" + JSON.stringify(participants) + "}", sandbox);

// 1) isParticipantGradedOn: يطابق اليوم بالضبط بغض النظر عن الوقت، ويرفض بلا gradedAt.
assert.ok(isParticipantGradedOn(participants[0], "2026-09-01"), "الساعة 10:00 من يوم 09-01 يجب أن تطابق نفس اليوم");
assert.ok(isParticipantGradedOn(participants[1], "2026-09-01"), "الساعة 18:30 من نفس اليوم يجب أن تطابق أيضاً بغض النظر عن الوقت");
assert.ok(!isParticipantGradedOn(participants[2], "2026-09-01"), "يوم مختلف (09-02) يجب ألا يطابق فلتر 09-01");
assert.ok(!isParticipantGradedOn(participants[3], "2026-09-01"), "متسابق بلا gradedAt (لم يُمتحن بعد) لا يطابق أي يوم إطلاقاً");

// 2) بدون فلتر (dashboardDateFilter=null) — يجب أن يرجع كل المتسابقين كما كان السلوك دائماً.
vm.runInContext("dashboardDateFilter=null", sandbox);
assert.strictEqual(dashboardScopedParticipants().length, 4, "بلا فلتر تاريخ، يجب أن تُرجَع كل السجلات (سلوك 'الكل' التراكمي)");

// 3) بفلتر يوم 09-01 — يجب أن يقتصر على السجلين المُمتحنين بهذا اليوم فقط.
vm.runInContext("dashboardDateFilter='2026-09-01'", sandbox);
const scopedDay1 = dashboardScopedParticipants();
assert.strictEqual(JSON.stringify(scopedDay1.map((x) => x.id).sort()), JSON.stringify(["day1-fail", "day1-pass"]), "فلتر يوم 09-01 يجب أن يعزل بالضبط من امتُحن بذلك اليوم");

// 4) نسبة النجاح المحسوبة من المجموعة المُفلترة يجب أن تعكس يوم واحد فقط (1 من 2 ناجح = 50%)،
//    لا نسبة النجاح التراكمية لكل الدورة (2 من 3 ناجح = ~66.7%).
const dayPassRate = passRateOf(scopedDay1);
assert.strictEqual(dayPassRate, 50, "نسبة نجاح يوم 09-01 وحده يجب أن تكون 50% بالضبط (ناجح واحد من اثنين)");
vm.runInContext("dashboardDateFilter=null", sandbox);
const allPassRate = passRateOf(dashboardScopedParticipants());
assert.notStrictEqual(allPassRate, dayPassRate, "نسبة النجاح التراكمية لكل الدورة يجب أن تختلف عن نسبة يوم واحد بمعزل — لإثبات أن الفلترة فعلاً تُغيّر الحساب");

// 5) يوم بلا أي متسابقين مُمتحنين فيه — نتيجة فارغة (0)، لا كل السجلات بالغلط.
vm.runInContext("dashboardDateFilter='2026-09-05'", sandbox);
assert.strictEqual(dashboardScopedParticipants().length, 0, "يوم لم يُمتحن فيه أحد يجب أن يُرجع مجموعة فارغة تماماً");

console.log("dashboard-date-filter.test.js: كل الحالات نجحت — فلتر اليوم يعزل بيانات اليوم المحدد بدقة، وخيار 'الكل' يبقي السلوك التراكمي القديم دون تغيير");
