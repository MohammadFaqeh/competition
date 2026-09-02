// اختبار آلي: listCommitteeUsedPositionsDetailed() تعتمد على دالة SQL إضافية جديدة
// (committee_used_positions_detailed) لازمة لخوارزمية Scoring الواعية باليوم/المستوى عند
// السحب الذاتي للجنة — لازم لا ينكسر السحب الذاتي لو الملف لسا ما تطبّق على قاعدة بيانات
// معينة، بل يتراجع فورًا لقائمة المعرّفات المسطّحة القديمة (بمعلومات يوم/مستوى فارغة، فتنحصر
// الأولوية بالاستخدام العام فقط ريثما يُطبَّق الملف — سلوك أضعف بس غير مكسور).
// شغّله: node tests/committee-used-positions-detailed-fallback.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const projectRoot = path.join(__dirname, "..");
const cloudSrc = fs.readFileSync(path.join(projectRoot, "cloud.js"), "utf8");

function makeFakeServer({ detailedDeployed }) {
  const flatIds = ["1-2:1-2:8", "1-2:10-2:12"];
  async function rpc(name) {
    if (name === "committee_login") return { data: { token: "tok-1", committee: { id: "c1", name: "لجنة 1", examiner_role: "chairman" } }, error: null };
    if (name === "committee_used_positions_detailed") {
      if (!detailedDeployed) return { data: null, error: { message: "function public.committee_used_positions_detailed(text) does not exist", code: "42883" } };
      return { data: flatIds.map(id => ({ id, level: 15, createdAt: "2026-09-03T10:00:00.000Z" })), error: null };
    }
    if (name === "committee_used_position_ids") return { data: flatIds, error: null };
    throw new Error(`unexpected rpc: ${name}`);
  }
  return { rpc };
}

function loadCloudModule(fakeServer) {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout,
    window: {},
  };
  sandbox.window = sandbox;
  sandbox.SUPABASE_CONFIG = { url: "https://example.test", anonKey: "anon" };
  sandbox.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: null } }) },
      rpc: (name, args) => fakeServer.rpc(name, args),
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(cloudSrc, sandbox, { filename: "cloud.js" });
  return sandbox.CloudCompetition;
}

async function run() {
  // 1) الدالة الخفيفة غير مُطبَّقة بعد: يتراجع فوراً لقائمة المعرّفات المسطّحة، بدون انهيار.
  {
    const cloud = loadCloudModule(makeFakeServer({ detailedDeployed: false }));
    await cloud.init();
    await cloud.signInCommittee("L01", "1234");
    const entries = await cloud.listCommitteeUsedPositionsDetailed();
    assert.strictEqual(entries.length, 2, "رجوع آمن: يرجع نفس عدد المواضع من القائمة المسطّحة القديمة");
    assert.strictEqual(entries[0].level, null, "بلا الدالة الجديدة: معلومة المستوى غير متوفرة (null) — سلوك أضعف بس غير مكسور");
    assert.strictEqual(entries[0].createdAt, null, "بلا الدالة الجديدة: تاريخ السحب غير متوفر (null)");
  }

  // 2) الدالة الخفيفة مُطبَّقة: تُستخدم مباشرة وترجع تفصيل المستوى/التاريخ الحقيقي.
  {
    const cloud = loadCloudModule(makeFakeServer({ detailedDeployed: true }));
    await cloud.init();
    await cloud.signInCommittee("L01", "1234");
    const entries = await cloud.listCommitteeUsedPositionsDetailed();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].level, 15, "الدالة الجديدة مُطبَّقة: معلومة المستوى الحقيقية تصل فعلياً");
    assert.strictEqual(entries[0].createdAt, "2026-09-03T10:00:00.000Z", "الدالة الجديدة مُطبَّقة: تاريخ السحب الحقيقي يصل فعلياً");
  }

  console.log("committee-used-positions-detailed-fallback.test.js: كل الحالات نجحت — الدالة الخفيفة تُستخدم عند توفرها، وتتراجع بأمان تام قبل تطبيق ملف SQL الجديد");
}

run().catch((error) => { console.error("committee-used-positions-detailed-fallback.test.js FAILED:", error.stack || error.message); process.exit(1); });
