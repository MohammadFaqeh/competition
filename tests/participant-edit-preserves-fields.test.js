// اختبار آلي لخلل "مكتمل · راسب لمتسابقة بلا سحب إطلاقاً": نموذج "تعديل بيانات المتسابق"
// (openParticipantModal) كان يبني سجل المتسابق من الصفر بحقول محدودة فقط (name/seat/gender/
// center/phone/age/level/parts/createdAt) — أي حقل آخر غير مذكور صراحةً (withdrawn تحديداً،
// وأيضاً manualEntryBy/drRequest/transferCommitteeId) كان يُمحى بصمت عند أي تعديل بسيط (مثلاً
// تصحيح اسم المركز)، بينما score/gradedAt/scoreSource كانت تُنسَخ فقط لو !resetRequired —
// فمتسابقة انسحبت من استيراد Excel (withdrawn=true, score=0, scoreSource="withdrawn"، بلا سحب
// إطلاقاً) لو عُدِّلت بياناتها الأساسية، كانت تفقد withdrawn بينما يبقى score=0/scoreSource
// كما هما (resetRequired=false لأنه ما في oldDraw أصلاً) — فتظهر "مكتمل · راسب" رغم عدم وجود
// أي سحب أو اختبار فعلي لها. الإصلاح: بناء السجل الجديد فوق نسخة كاملة من القديم (كل الحقول
// محفوظة افتراضياً)، وحذف حقول العلامة صراحةً فقط عند resetRequired الفعلي.
// شغّله: node tests/participant-edit-preserves-fields.test.js
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

function makeElement(initial = {}) {
  const classes = new Set();
  return {
    value: initial.value ?? "", disabled: false, textContent: "",
    dataset: {}, style: { setProperty() {} },
    classList: { add(){}, remove(){}, toggle(){}, contains: () => classes.has("x") },
    addEventListener(type, handler) { if (type === "submit") this._submit = handler },
    closest() { return this }, querySelector() { return makeElement() }, querySelectorAll() { return [] },
  };
}

let modalHtml = "";
const elementCache = new Map();
function queryElement(sel) { if (!elementCache.has(sel)) elementCache.set(sel, makeElement()); return elementCache.get(sel) }

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    readyState: "complete", addEventListener: () => {},
    querySelector: (sel) => queryElement(sel), querySelectorAll: () => [],
    documentElement: { lang: "ar", dir: "rtl" },
    body: makeElement(),
  },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
  lucide: { createIcons() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

async function run() {
  // متسابقة منسحبة من استيراد Excel: withdrawn=true, score=0, بلا أي سحب إطلاقاً — تماماً
  // كالحالة الحقيقية المُبلَّغ عنها.
  const withdrawnParticipant = {
    id: "p1", name: "رهف احمد", seat: "91095", gender: "أنثى", center: "مصعب بن عمير",
    branch: "فرع الكورة", phone: null, age: null, level: 5, levelName: "المستوى السابع - ب",
    parts: [], createdAt: "2026-08-01T00:00:00.000Z",
    withdrawn: true, score: 0, gradedAt: "2026-08-01T00:00:00.000Z", scoreSource: "withdrawn", manualEntryBy: "استيراد Excel",
  };
  sandbox.__initialState = { config: {}, participants: [withdrawnParticipant], draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __initialState; operationMode = 'local';", sandbox);

  // يفتح نموذج التعديل، ويعدّل حقلاً بسيطاً فقط (اسم المركز) — بلا لمس الأجزاء أو المستوى.
  sandbox.openParticipantModal(withdrawnParticipant);
  queryElement("#pName").value = withdrawnParticipant.name;
  queryElement("#pSeat").value = withdrawnParticipant.seat;
  queryElement("#pGender").value = withdrawnParticipant.gender;
  queryElement("#pCenter").value = "مصعب بن عمير - مصحَّح"; // التعديل الوحيد المقصود
  queryElement("#pPhone").value = "";
  queryElement("#pAge").value = "";
  queryElement("#pLevel").value = "L7B"; // نفس مستواها الحالي (5 أجزاء) — بلا تغيير فعلي بالمستوى
  queryElement("#pParts").value = "";

  const form = queryElement("#participantForm");
  assert.ok(form._submit, "معالج submit مسجَّل فعلاً على النموذج");
  const fakeEvent = { preventDefault() {}, submitter: queryElement("#saveParticipantSubmitBtn") };
  fakeEvent.submitter.disabled = false;
  await form._submit(fakeEvent);

  const saved = vm.runInContext("state.participants.find(p=>p.id==='p1')", sandbox);
  assert.strictEqual(saved.withdrawn, true, "الخلل: withdrawn لازم يبقى محفوظاً بعد تعديل بسيط لحقل تاني (كان يُمحى بصمت)");
  assert.strictEqual(saved.manualEntryBy, "استيراد Excel", "manualEntryBy يبقى محفوظاً كمان (حقل آخر غير مذكور صراحةً بالنموذج القديم)");
  assert.strictEqual(saved.center, "مصعب بن عمير - مصحَّح", "التعديل المقصود (المركز) طُبِّق فعلاً");

  console.log("participant-edit-preserves-fields.test.js: كل الحالات نجحت — تعديل بيانات متسابق منسحب لا يمحو withdrawn ولا الحقول الأخرى غير المذكورة صراحةً بالنموذج");
}

run().catch((error) => { console.error("participant-edit-preserves-fields.test.js FAILED:", error.stack || error.message); process.exit(1); });
