// اختبار آلي لطبقة الاتصال الجديدة window.DiwanCompetition (راجع cloud.js وsupabase/diwan-al-
// hifadh-core.sql) — مسار "اختبارات ديوان الحفاظ" المستقل. يتحقق من: (أ) حفظ الحالة يرسل فقط
// الفروقات (نفس تحسين admin_save_state بالسنوية، مطبَّق من أول يوم هون)، (ب) الحفظ يُرفض بلا
// جلسة إدارة (kind!=="admin")، (ج) تسجيل دخول لجنة ديوان الحفاظ مستقل تماماً عن أي جلسة إدارة/
// لجنة سنوية (توكن ومفتاح localStorage مختلفان).
// شغّله: node tests/diwan-competition-core.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const projectRoot = path.join(__dirname, "..");
const cloudSrc = fs.readFileSync(path.join(projectRoot, "cloud.js"), "utf8");

function loadCloudModule(rpcHandler, fromHandler) {
  const localStorageStore = new Map();
  const sandbox = {
    console,
    localStorage: {
      getItem: k => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
      setItem: (k, v) => localStorageStore.set(k, String(v)),
      removeItem: k => localStorageStore.delete(k),
    },
    setTimeout, clearTimeout, AbortController,
    window: {},
  };
  sandbox.window = sandbox;
  sandbox.SUPABASE_CONFIG = { url: "https://example.test", anonKey: "anon" };
  const fakeClient = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: (name, args) => ({
      abortSignal() { return this; },
      then(resolve, reject) { Promise.resolve().then(() => rpcHandler(name, args)).then(resolve, reject); },
    }),
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => ({ single: async () => fromHandler(table, "single", { cols, col, val }) }),
        order: () => fromHandler(table, "list", { cols }),
      }),
    }),
  };
  sandbox.supabase = { createClient: () => fakeClient };
  vm.createContext(sandbox);
  vm.runInContext(cloudSrc, sandbox, { filename: "cloud.js" });
  return sandbox;
}

async function testDiffOnlySave() {
  const calls = [];
  async function rpcHandler(name, args) {
    calls.push({ name, args });
    if (name === "diwan_admin_save_state") return { data: {}, error: null };
    if (name === "diwan_committee_login") return { data: { token: "diwan-tok-1", committee: { id: "c1", name: "لجنة ١" } }, error: null };
    throw new Error(`unexpected rpc: ${name}`);
  }
  const sandbox = loadCloudModule(rpcHandler, () => ({ data: null, error: null }));
  await sandbox.window.CloudCompetition.init();
  sandbox.window.CloudCompetition = { ...sandbox.window.CloudCompetition, context: { kind: "admin" }, client: sandbox.window.CloudCompetition.client };

  const diwan = sandbox.window.DiwanCompetition;
  const baseline = [{ id: "P1", name: "أحمد" }, { id: "P2", name: "سارة" }];
  diwan.markAdminKnownIds(baseline, []);

  calls.length = 0;
  await diwan.saveState({ config: { x: 1 }, participants: [...baseline, { id: "P3", name: "خالد" }], draws: [] });
  assert.strictEqual(calls.length, 1, "حفظة واحدة فقط");
  assert.strictEqual(JSON.stringify(calls[0].args.p_participants.map(p => p.id)), JSON.stringify(["P3"]), "يُرسل المتسابق الجديد فقط");
  assert.strictEqual(JSON.stringify(calls[0].args.p_deleted_participant_ids), JSON.stringify([]), "لا محذوفين بهذه الخطوة");

  calls.length = 0;
  await diwan.saveState({ config: { x: 1 }, participants: [...baseline, { id: "P3", name: "خالد" }], draws: [] });
  assert.strictEqual(calls[0].args.p_participants.length, 0, "بدون أي تغيير جديد يجب ألا يُرسل أي متسابق");

  console.log("diwan-competition-core.test.js: حفظ الحالة يرسل فقط الفروقات — نجح");
}

async function testAdminGateAndCommitteeIsolation() {
  const calls = [];
  async function rpcHandler(name, args) {
    calls.push({ name, args });
    if (name === "diwan_admin_save_state") return { data: {}, error: null };
    if (name === "diwan_committee_login") return { data: { token: "diwan-tok-1", committee: { id: "c1", name: "لجنة ١" } }, error: null };
    throw new Error(`unexpected rpc: ${name}`);
  }
  const sandbox = loadCloudModule(rpcHandler, () => ({ data: null, error: null }));
  await sandbox.window.CloudCompetition.init();
  const diwan = sandbox.window.DiwanCompetition;

  // بلا جلسة إدارة (kind فارغ): queueStateSave يجب ألا يستدعي أي شيء إطلاقاً
  sandbox.window.CloudCompetition = { ...sandbox.window.CloudCompetition, context: {}, client: sandbox.window.CloudCompetition.client };
  calls.length = 0;
  let onErrorCalled = false;
  diwan.queueStateSave({ config: {}, participants: [], draws: [] }, () => { onErrorCalled = true });
  await new Promise(r => setTimeout(r, 600));
  assert.strictEqual(calls.length, 0, "بلا جلسة إدارة، لا يجب استدعاء أي RPC للحفظ");
  assert.strictEqual(onErrorCalled, false, "ولا يجب استدعاء onError أيضاً (queueStateSave يتجاهل الطلب بصمت)");

  // تسجيل دخول لجنة ديوان الحفاظ: توكن مستقل تماماً بمفتاح localStorage مختلف عن السنوية/المسؤول الفرعي
  await diwan.signInCommittee("D01", "1234");
  assert.strictEqual(sandbox.localStorage.getItem("competition.diwanCommitteeToken"), "diwan-tok-1", "توكن لجنة ديوان الحفاظ محفوظ بمفتاحه المستقل");
  assert.strictEqual(sandbox.localStorage.getItem("competition.committeeToken"), null, "لا يمس توكن لجنة السنوية إطلاقاً");
  assert.strictEqual(diwan.committeeContext.committee.id, "c1", "سياق لجنة ديوان الحفاظ محفوظ محلياً بشكل مستقل");

  console.log("diwan-competition-core.test.js: بوابة صلاحية الإدارة وعزل جلسة اللجنة — نجح");
}

async function run() {
  await testDiffOnlySave();
  await testAdminGateAndCommitteeIsolation();
}

run().catch(error => {
  console.error("diwan-competition-core.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
