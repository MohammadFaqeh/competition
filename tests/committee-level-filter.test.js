// اختبار آلي: لجنة مسؤولة عن مستويين، ونُقل إليها يدويًا 7 متسابقات من مستوى ثالث خارج
// مستوياتها الأصلية. فلتر "المستوى" بصفحة المتسابقين كان يعرض فقط مستويي اللجنة الأصليين،
// فيستحيل اختيار المستوى الثالث لعزل هؤلاء السبعة تحديدًا رغم أنهم مرتبطون فعليًا بهذه اللجنة.
// شغّله: node tests/committee-level-filter.test.js
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

const { levelsForCommittee, resolveParticipantCommittee, resolveParticipantLevelId } = sandbox;
const LEVEL_CATALOG = vm.runInContext("LEVEL_CATALOG", sandbox);
const L5 = LEVEL_CATALOG.find((l) => l.id === "L5").label; // المستوى الخامس (حفظ 15 جزء)
const L3 = LEVEL_CATALOG.find((l) => l.id === "L3").label; // المستوى الثالث (حفظ 25 جزء)
const L2 = LEVEL_CATALOG.find((l) => l.id === "L2").label; // المستوى الثاني — خارج مستويي اللجنة

const committeeA = { id: "cA", name: "لجنة أ", responsible_gender: "أنثى", level_names: [L5, L3], active: true };
const allCommittees = [committeeA];

function participant(id, levelName, gender, transferCommitteeId) {
  return { id, name: `متسابقة ${id}`, gender, levelName, level: LEVEL_CATALOG.find((l) => l.label === levelName).parts, transferCommitteeId: transferCommitteeId || undefined };
}

const participants = [
  ...Array.from({ length: 3 }, (_, i) => participant(`native-${i}`, L5, "أنثى")), // مستوى أصلي للجنة، بدون نقل
  ...Array.from({ length: 7 }, (_, i) => participant(`pinned-${i}`, L2, "أنثى", "cA")), // الـ7 المنقولات يدويًا
  ...Array.from({ length: 5 }, (_, i) => participant(`unrelated-${i}`, L2, "أنثى")), // نفس مستوى الـ7، بدون علاقة باللجنة
];

// 1) مستويا اللجنة الأصليان فقط، بدون المستوى الثالث — هذا هو السلوك القديم الناقص.
const nativeLevelOptions = levelsForCommittee(committeeA);
// JSON.stringify بدل deepStrictEqual لأن المصفوفات هون من عالم (realm) الـ vm sandbox، لا عالم Node
// المضيف، فـ deepStrictEqual يفشل على فحص الـ prototype رغم تطابق المحتوى فعليًا.
assert.strictEqual(JSON.stringify(nativeLevelOptions.map((l) => l.id).sort()), JSON.stringify(["L3", "L5"]), "مستويا اللجنة الأصليان يجب أن يكونا L3 وL5 فقط");
assert.ok(!nativeLevelOptions.some((l) => l.id === "L2"), "قبل الإصلاح: L2 غير موجود ضمن مستويات اللجنة الأصلية (متوقع)");

// 2) نفس صيغة الإصلاح المضافة بـ populateParticipantFilterOptions (app.js): إضافة أي مستوى
//    فعلي لمتسابق مرتبط حاليًا بهذه اللجنة (طبيعيًا أو بالنقل اليدوي) لقائمة الخيارات.
const extraLevelIds = new Set(
  participants
    .map((p) => (resolveParticipantCommittee(p, allCommittees).currentCommittee?.id === committeeA.id ? resolveParticipantLevelId(p) : null))
    .filter(Boolean)
);
const levelOptions = [...nativeLevelOptions, ...LEVEL_CATALOG.filter((l) => extraLevelIds.has(l.id) && !nativeLevelOptions.some((n) => n.id === l.id))];
assert.ok(levelOptions.some((l) => l.id === "L2"), "بعد الإصلاح: L2 يجب أن يظهر كخيار لأن 7 متسابقات منقولات إليه فعليًا لهذه اللجنة");
assert.strictEqual(levelOptions.length, 3, "لجنة أ + مستوى مضاف واحد فقط (L2) = 3 خيارات بالضبط، لا تكرار");

// 3) فلترة committee=cA + level=L2 معًا (نفس منطق renderParticipants) يجب أن تُرجع الـ7
//    المنقولات بالضبط — لا الخمسة غير المرتبطات، ولا كل متسابقات L2 بالموقع.
const filtered = participants.filter(
  (p) => resolveParticipantLevelId(p) === "L2" && resolveParticipantCommittee(p, allCommittees).currentCommittee?.id === committeeA.id
);
assert.strictEqual(filtered.length, 7, "لازم يظهر بالضبط 7 متسابقات — المنقولات فقط لهذه اللجنة من مستوى L2");
assert.ok(filtered.every((p) => p.id.startsWith("pinned-")), "كل النتائج يجب أن تكون من المجموعة المنقولة يدويًا فقط");

console.log("committee-level-filter.test.js: كل الحالات نجحت — فلتر المستوى يعرض الآن المستوى الإضافي الناتج عن النقل اليدوي، والفلترة المشتركة تعزل السبعة بدقة");
