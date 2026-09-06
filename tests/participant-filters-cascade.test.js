// اختبار آلي لتشابك فلاتر جدول المتسابقين (الحالة/الجنس/المركز/المستوى/اللجنة) — طلب صريح:
// كل فلتر يعرض فقط القيم يلي فعلاً عندها متسابق واحد على الأقل بافتراض باقي الفلاتر المختارة
// حالياً؛ يستهدف الدالة الحقيقية populateParticipantFilterOptions المستخدمة فعلياً بالموقع،
// لا نسخة موازية مكتوبة يدوياً بالاختبار.
// شغّله: node tests/participant-filters-cascade.test.js
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

// عنصر <select> وهمي بسيط: يخزّن innerHTML الحقيقي ويشتق منه قائمة <option value="..."> فعلية،
// و.value يتصرف متل select حقيقي (لا يقبل قيمة غير موجودة ضمن الخيارات الحالية).
function makeSelect() {
  // مثل <select> حقيقي بمتصفح: قيمته الافتراضية هي value أول <option> موجود بالـHTML — كل
  // فلاتر المتسابقين الفعلية بـindex.html تبدأ بـ<option value="all"> ثابت، فنطابق هالسلوك هون
  // بدل ما تبقى value فارغة (سلسلة فارغة) وهمية لا تطابق "all" فتُسقط كل المتسابقين بالغلط.
  let html = `<option value="all">الكل</option>`;
  let val = "all";
  return {
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v;
      const opts = [...v.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
      if (!opts.includes(val)) val = opts[0] || "";
    },
    get value() { return val; },
    set value(v) {
      const opts = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
      val = opts.includes(v) ? v : (opts[0] || "");
    },
    optionValues() { return [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]); },
  };
}

const elements = {
  participantFilter: makeSelect(),
  participantGenderFilter: makeSelect(),
  participantCenterFilter: makeSelect(),
  participantLevelFilter: makeSelect(),
  participantCommitteeFilter: makeSelect(),
};

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    readyState: "complete", addEventListener: () => {},
    querySelector: (sel) => { const id = sel.replace("#", ""); return elements[id] || null; },
    querySelectorAll: () => [], documentElement: { lang: "ar", dir: "rtl" },
  },
  window: {}, navigator: { onLine: true }, crypto: require("crypto").webcrypto,
  fetch: () => Promise.reject(new Error("fetch disabled in test")),
  location: { hash: "", href: "" }, history: { pushState() {}, replaceState() {} },
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

function run() {
  const LEVEL_CATALOG = vm.runInContext("LEVEL_CATALOG", sandbox);
  const L5 = LEVEL_CATALOG.find((l) => l.id === "L5").label; // مستوى أصلي للجنة أ
  const L3 = LEVEL_CATALOG.find((l) => l.id === "L3").label; // مستوى أصلي للجنة أ (بلا أي متسابقة فعلية عليه — لن يظهر كخيار إطلاقاً)
  const L2 = LEVEL_CATALOG.find((l) => l.id === "L2").label; // مستوى منقول يدوياً للجنة أ فقط
  const L4 = LEVEL_CATALOG.find((l) => l.id === "L4").label; // مستوى غير مرتبط بلجنة أ أو ب إطلاقاً (لا بالإعداد ولا بالنقل)

  const committeeA = { id: "cA", name: "لجنة أ", responsible_gender: "أنثى", level_names: [L5, L3], active: true };
  const committeeB = { id: "cB", name: "لجنة ب", responsible_gender: "ذكر", level_names: [L5], active: true };

  function participant(id, levelName, gender, center, withdrawn, transferCommitteeId) {
    return {
      id, name: `متسابق ${id}`, seat: id, gender, center,
      levelName, level: LEVEL_CATALOG.find((l) => l.label === levelName).parts,
      withdrawn: withdrawn || false, transferCommitteeId: transferCommitteeId || undefined,
    };
  }

  const participants = [
    ...Array.from({ length: 3 }, (_, i) => participant(`a-native-${i}`, L5, "أنثى", "مركز 1")),
    ...Array.from({ length: 7 }, (_, i) => participant(`a-pinned-${i}`, L2, "أنثى", "مركز 2", false, "cA")),
    ...Array.from({ length: 4 }, (_, i) => participant(`b-native-${i}`, L5, "ذكر", "مركز 3")),
    participant("withdrawn-1", L4, "أنثى", "مركز 1", true),
  ];

  sandbox.__state = { config: {}, participants, draws: [], resets: [], deletions: [] };
  vm.runInContext("state = __state; operationMode = 'cloud'; cloudCommittees = __committees;", Object.assign(sandbox, { __committees: [committeeA, committeeB] }));
  sandbox.window.CloudCompetition = { context: { kind: "admin" } };

  // 1) بلا أي فلتر مفعّل: كل اللجان/المستويات/المراكز الفعلية تظهر، بلا أي شيء وهمي.
  sandbox.populateParticipantFilterOptions();
  assert.deepStrictEqual(elements.participantCommitteeFilter.optionValues().sort(), ["all", "cA", "cB"].sort(), "كلتا اللجنتين يجب أن تظهرا (كل وحدة عندها متسابقون فعليون)");
  assert.deepStrictEqual(elements.participantLevelFilter.optionValues().sort(), ["L2", "L4", "L5", "all"].sort(), "المستويات الثلاثة الفعلية (L2 المنقول، L4 المنسحبة، L5) يجب أن تظهر جميعاً — L3 (بلا أي متسابق) لا يظهر إطلاقاً");

  // 2) اختيار لجنة أ يجب أن يضيّق الجنس (إناث فقط فعلياً) والمستوى (L5 وL2 فقط — لا L4 لأنه
  //    فقط عند المنسحبة يلي مش مرتبطة بلجنة أ أصلاً) بدون أي منطق خاص بـ"مستويات اللجنة المُعدّة"،
  //    بحساب المتسابقين الفعليين فقط.
  elements.participantCommitteeFilter.value = "cA";
  sandbox.populateParticipantFilterOptions();
  assert.deepStrictEqual(elements.participantGenderFilter.optionValues().sort(), ["all", "أنثى"].sort(), "لجنة أ إناث فقط فعلياً — خيار (ذكور) يجب أن يختفي");
  assert.deepStrictEqual(elements.participantLevelFilter.optionValues().sort(), ["L2", "L5", "all"].sort(), "لجنة أ: L5 (أصلي) وL2 (منقول يدوياً) فقط — L4 لا يظهر لأنه غير مرتبط فعلياً بلجنة أ");

  // 3) اختيار "الحالة: منسحب" يجب أن يعزل المنسحبة الوحيدة فقط — فتظهر خياراتها هي (مركز 1،
  //    L4، أنثى) فقط بباقي الفلاتر، لا كل بيانات الموقع. نعيد بناء الخيارات فوراً بعد إلغاء
  //    فلتر اللجنة (متل ما يصير فعلياً عند كل تغيير حقيقي من مستخدم حقيقي) قبل اختيار "منسحب" —
  //    وإلا يبقى خيار "منسحب" نفسه غير متاح أصلاً بقائمة الحالة المبنية تحت فلتر لجنة أ السابق.
  elements.participantCommitteeFilter.value = "all";
  sandbox.populateParticipantFilterOptions();
  elements.participantFilter.value = "withdrawn";
  sandbox.populateParticipantFilterOptions();
  assert.deepStrictEqual(elements.participantLevelFilter.optionValues().sort(), ["L4", "all"].sort(), "الحالة=منسحب: يجب أن يظهر L4 فقط (مستوى المنسحبة الوحيدة)");
  assert.deepStrictEqual(elements.participantCenterFilter.optionValues().sort(), ["all", "مركز 1"].sort(), "الحالة=منسحب: يجب أن يظهر مركز 1 فقط");
  assert.deepStrictEqual(elements.participantCommitteeFilter.optionValues().sort(), ["all"].sort(), "الحالة=منسحب: لا لجنة مرتبطة بالمنسحبة (لم تُنقل لأي لجنة)، فتبقى القائمة فارغة إلا (الكل)");

  // 4) فلتر "المستوى: L2" مختار وصالح، وبعدين تغيّرت البيانات الفعلية خارج الفلاتر (مثال واقعي:
  //    الإدارة صحّحت مستوى السبعة المنقولين من L2 إلى L5) فصار L2 بلا أي متسابق إطلاقاً — يجب
  //    أن يتصحّح فلتر المستوى تلقائياً لـ"all" بالتحديث التالي، بدل ما يبقى عالقاً على قيمة
  //    فارغة تماماً بصمت (تُخفي كل الجدول بلا أي تفسير للمستخدم).
  elements.participantFilter.value = "all";
  sandbox.populateParticipantFilterOptions();
  elements.participantLevelFilter.value = "L2";
  sandbox.populateParticipantFilterOptions();
  assert.strictEqual(elements.participantLevelFilter.value, "L2", "تأكيد تمهيدي: L2 يجب أن يبقى قابلاً للاختيار بلا فلتر لجنة");
  const L5parts = LEVEL_CATALOG.find((l) => l.id === "L5").parts;
  participants.filter((p) => p.id.startsWith("a-pinned-")).forEach((p) => { p.levelName = L5; p.level = L5parts });
  sandbox.populateParticipantFilterOptions();
  assert.strictEqual(elements.participantLevelFilter.value, "all", "L2 صار بلا أي متسابق بعد تصحيح مستوياتهم لـL5، يجب أن يتصحّح فلتر المستوى تلقائياً لـ(الكل) بدل البقاء عالقاً");

  console.log("participant-filters-cascade.test.js: كل الحالات نجحت — فلاتر المتسابقين تتشابك فعلياً حسب البيانات الحقيقية، وتُصحَّح تلقائياً عند اختيار غير متاح");
}

try { run(); } catch (error) { console.error("participant-filters-cascade.test.js FAILED:", error.stack || error.message); process.exit(1); }
