// اختبار آلي لقراءة ملفات النسخ الاحتياطية بعد إضافة ديوان الحفاظ:
// - النسخة اليدوية الجديدة (data + diwan) والنسخة التلقائية المرسلة بالإيميل (competitionState + diwanState) تُقرآن.
// - نتيجة لجنة ديوان معتمدة موجودة بجلسات الملف ولم تُدمج بعد تُدمج بنسخة الاستعادة (علامة + انتقال مرحلة).
// - الدمج بنسخة منفصلة (persist=false) لا يلمس بيانات الديوان الحية، ولا يكرر نتيجة دُمجت سابقاً.
// - الملفات القديمة (بلا ديوان) تبقى صالحة، والملف غير الصالح يُرفض.
// شغّله: node tests/backup-includes-diwan.test.js
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
const { readBackupFile, mergeFinalDiwanSessionsIntoState, applyDiwanResultOverrides } = sandbox;

const annual = { config: { competitionName: "السنوية" }, participants: [{ id: "A1" }], draws: [{ id: "D1" }] };
const diwan = () => ({
  config: { nextCertificateSeq: 2 },
  participants: [{ id: "W1", stage: 1, level: 3, parts: [1, 2, 3], usedJuz: [] }],
  draws: [{ id: "WD1", participantId: "W1", stage: 1 }],
});
const finalSession = { participant_id: "W1", draw_id: "WD1", stage: 1, status: "final", score: 92, assessment: {}, finalized_at: "2026-10-10T08:20:00Z", updated_at: "2026-10-10T08:20:00Z" };

// 1) manual file with unmerged session → merged into the restore copy
let r = readBackupFile({ schema: 3, data: annual, diwan: { state: diwan(), sessions: [finalSession] } });
assert.ok(r && r.data === annual, "القسم السنوي يُقرأ كما هو");
let w1 = r.diwan.participants[0];
assert.strictEqual(w1.score, 92, "علامة لجنة الديوان المعتمدة تُدمج");
assert.strictEqual(w1.stage, 2, "والنجاح ينقل المتسابق للمرحلة التالية");
assert.deepStrictEqual(Array.from(w1.usedJuz), [1, 2, 3], "والأجزاء المُجازة تُسجَّل");

// 2) emailed automatic backup format
r = readBackupFile({ schema: 2, competitionState: annual, diwanState: diwan(), diwanExamSessions: [finalSession] });
assert.ok(r && r.data === annual, "النسخة التلقائية: القسم السنوي يُقرأ من competitionState");
assert.strictEqual(r.diwan.participants[0].score, 92, "النسخة التلقائية: نتيجة الجلسة تُدمج");

// 3) old file without Diwan stays valid; invalid file rejected
r = readBackupFile({ schema: 2, data: annual });
assert.ok(r && r.diwan === null, "الملف القديم بلا ديوان يبقى صالحاً");
assert.strictEqual(readBackupFile({ hello: 1 }), null, "الملف غير الصالح يُرفض");
assert.strictEqual(readBackupFile({ data: { config: {} } }), null, "ملف بلا سحوبات يُرفض");

// 4) merging into a separate copy never touches live Diwan data, and does not double-apply
const liveBefore = JSON.stringify(vm.runInContext("diwanState", sandbox));
const copy = diwan();
assert.strictEqual(mergeFinalDiwanSessionsIntoState(applyDiwanResultOverrides([finalSession], copy.draws), copy, { persist: false }), true);
assert.strictEqual(copy.participants[0].stage, 2);
assert.strictEqual(mergeFinalDiwanSessionsIntoState(applyDiwanResultOverrides([finalSession], copy.draws), copy, { persist: false }), false, "النتيجة نفسها لا تُدمج مرتين");
assert.strictEqual(copy.participants[0].stage, 2, "ولا ينتقل المتسابق مرحلة إضافية");
assert.strictEqual(JSON.stringify(vm.runInContext("diwanState", sandbox)), liveBefore, "بيانات الديوان الحية لم تتغير");

console.log("backup-includes-diwan.test.js: نجح — النسخة اليدوية والتلقائية تُقرآن، نتائج الديوان غير المدموجة تُدمج بالاستعادة دون مساس بالبيانات الحية، والملفات القديمة صالحة");
