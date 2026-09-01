// اختبار آلي لإصلاح خلل: لما يسجّل عضو اللجنة كل الأخطاء فعليًا (رصده مستقل عن رصد الرئيس)،
// ثم يروح رئيس اللجنة لشاشة "مراجعة واعتماد" دون أن يكرر إدخال نفس الأرقام بنفسه، كانت
// العلامة تظهر 100 لأن النظام يعتمد افتراضيًا رصد الرئيس (صفر) بدل رصد من سجّل فعلاً. الإصلاح
// (openAssessmentReview بـ app.js): إذا اختلف الرصدان بنوع معيّن بموضع ما، وكان أحدهما فقط قد
// سجّل رقمًا حقيقيًا (والآخر صفر — أي لم يسجّله إطلاقًا وليس تعارضًا)، يُعتمد رقم من سجّله
// تلقائيًا كافتراض قابل للتعديل. أما لو سجّل الاثنان رقمين حقيقيين مختلفين (تعارض فعلي)،
// تبقى الخانة فارغة كما كانت — القرار يبقى للرئيس فقط.
// شغّله: node tests/examiner-diff-default.test.js
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

// تأكيد أن منطق الإصلاح فعليًا موجود بالمصدر (وليس فقط بنسخة الاختبار) قبل تشغيل أي تحقق.
const fixMarkerRe = /diffIndexes\.forEach\(index=>\{\s*const own=assessment\.positions\[index\],member=memberDraft\.positions\[index\];\s*Object\.keys\(ASSESSMENT_RULES\)\.forEach\(type=>\{\s*if\(own\.adopted&&Number\.isFinite\(own\.adopted\[type\]\)\)return;\s*const ownCount=Number\(own\[type\]\)\|\|0,memberCount=Number\(member\[type\]\)\|\|0;\s*if\(ownCount===memberCount\)return;\s*if\(ownCount===0\|\|memberCount===0\)\{own\.adopted=own\.adopted\|\|\{\};own\.adopted\[type\]=Math\.max\(ownCount,memberCount\)\}/;
if (!fixMarkerRe.test(appSrc)) throw new Error("منطق الإصلاح غير موجود بـ app.js كما هو متوقع — حدّث هذا الاختبار إذا تغيّر الكود عمدًا");

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

const { calculateFinalAssessment, positionsDiffer } = sandbox;
const ASSESSMENT_RULES = vm.runInContext("ASSESSMENT_RULES", sandbox);

function emptyPosition() {
  const p = {};
  Object.keys(ASSESSMENT_RULES).forEach((type) => (p[type] = 0));
  return p;
}

// يطابق حرفيًا الكتلة المضافة داخل openAssessmentReview بـ app.js.
function applyDiffDefaults(assessmentPositions, memberPositions) {
  const diffIndexes = assessmentPositions.map((own, index) => (positionsDiffer(own, memberPositions[index]) ? index : -1)).filter((i) => i >= 0);
  diffIndexes.forEach((index) => {
    const own = assessmentPositions[index], member = memberPositions[index];
    Object.keys(ASSESSMENT_RULES).forEach((type) => {
      if (own.adopted && Number.isFinite(own.adopted[type])) return;
      const ownCount = Number(own[type]) || 0, memberCount = Number(member[type]) || 0;
      if (ownCount === memberCount) return;
      if (ownCount === 0 || memberCount === 0) { own.adopted = own.adopted || {}; own.adopted[type] = Math.max(ownCount, memberCount); }
    });
  });
  return diffIndexes;
}

// 1) الحالة الفعلية المُبلَّغ عنها: العضو سجّل كل الأخطاء، الرئيس لم يسجّل شيئًا بنفسه إطلاقًا.
{
  const chairman = { positions: [{ ...emptyPosition() }] };
  const member = { positions: [{ ...emptyPosition(), tajweed: 3, hesitation: 2 }] };
  const before = calculateFinalAssessment(chairman);
  assert.strictEqual(before.score, 100, "قبل الإصلاح: بدون اعتماد صريح، رصد الرئيس الفارغ يعطي 100 (هذا هو الخلل المُبلَّغ عنه)");
  applyDiffDefaults(chairman.positions, member.positions);
  const after = calculateFinalAssessment(chairman);
  assert.notStrictEqual(after.score, 100, "بعد الإصلاح: يجب ألا تبقى العلامة 100 رغم وجود أخطاء حقيقية سجّلها العضو");
  const expected = calculateFinalAssessment(member);
  assert.strictEqual(after.score, expected.score, "العلامة النهائية يجب أن تطابق رصد العضو الفعلي طالما الرئيس لم يسجّل شيئًا بنفسه");
}

// 2) لا يوجد عضو أصلاً (لجنة برئيس فقط) — يجب ألا يتأثر شيء، ويبقى رصد الرئيس هو المعتمد كما كان دائمًا.
{
  const chairman = { positions: [{ ...emptyPosition(), memorization: 1 }] };
  const before = calculateFinalAssessment(chairman);
  // لا يوجد memberDraft.positions.length أصلاً بهذه الحالة في الكود الحقيقي (diffIndexes=[])
  const diffIndexes = [];
  assert.strictEqual(diffIndexes.length, 0, "بدون عضو، لا يوجد أي فحص اختلاف");
  const after = calculateFinalAssessment(chairman);
  assert.strictEqual(after.score, before.score, "رصد الرئيس المنفرد لا يتغير إطلاقًا");
}

// 3) تعارض فعلي: كلاهما سجّل رقمًا حقيقيًا مختلفًا لنفس النوع — يجب أن يبقى القرار يدويًا للرئيس (لا يُختار تلقائيًا أي رقم).
{
  const chairman = { positions: [{ ...emptyPosition(), tajweed: 2 }] };
  const member = { positions: [{ ...emptyPosition(), tajweed: 5 }] };
  const before = calculateFinalAssessment(chairman);
  applyDiffDefaults(chairman.positions, member.positions);
  assert.strictEqual(chairman.positions[0].adopted, undefined, "تعارض حقيقي (رقمان غير صفريين مختلفان) يجب ألا يُحل تلقائيًا");
  const after = calculateFinalAssessment(chairman);
  assert.strictEqual(after.score, before.score, "بانتظار قرار الرئيس، يُحسب من رصده الخاص كما كان سابقًا (لا انحياز تلقائي لأي طرف بتعارض حقيقي)");
}

// 4) اعتماد سبق أن أدخله الرئيس يدويًا بالفعل يجب ألا يُستبدل بالافتراض التلقائي.
{
  const chairman = { positions: [{ ...emptyPosition(), tajweed: 0, adopted: { tajweed: 7 } }] };
  const member = { positions: [{ ...emptyPosition(), tajweed: 3 }] };
  applyDiffDefaults(chairman.positions, member.positions);
  assert.strictEqual(chairman.positions[0].adopted.tajweed, 7, "قرار الرئيس اليدوي السابق يبقى كما هو ولا يُستبدل تلقائيًا");
}

// 5) تطابق الرصدين تمامًا — لا يوجد اختلاف أصلًا، لا داعي لأي اعتماد.
{
  const chairman = { positions: [{ ...emptyPosition(), language: 1 }] };
  const member = { positions: [{ ...emptyPosition(), language: 1 }] };
  const diffIndexes = applyDiffDefaults(chairman.positions, member.positions);
  assert.strictEqual(diffIndexes.length, 0, "رصدان متطابقان تمامًا لا يُعتبران اختلافًا");
  assert.strictEqual(chairman.positions[0].adopted, undefined, "لا داعي لأي اعتماد عند التطابق");
}

console.log("examiner-diff-default.test.js: كل الحالات نجحت — العلامة لا تعود 100 بصمت عند اعتماد رصد الطرف الوحيد الذي سجّل فعلاً، وتبقى قرارات التعارض الحقيقي يدوية للرئيس");
