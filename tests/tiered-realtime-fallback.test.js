// اختبار آلي لتراجع cloud.js الآمن عند استخدام دوال SQL الخفيفة الجديدة (committee_list_live_
// sessions / committee_get_session) قبل تطبيق ملف supabase/exam-sessions-tiered-realtime.sql
// فعليًا على قاعدة بيانات معيّنة: لازم لا ينكسر عمل اللجنة إطلاقًا، بل يتراجع فورًا للدوال
// الكاملة القديمة (committee_list_sessions) دون أي خطأ يظهر للمستخدم.
// شغّله: node tests/tiered-realtime-fallback.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const projectRoot = path.join(__dirname, "..");
const cloudSrc = fs.readFileSync(path.join(projectRoot, "cloud.js"), "utf8");

function makeFakeServer({ liveFunctionsDeployed }) {
  const sessions = [
    { id: "sess-old", participant_id: "p-old", committee_id: "c1", status: "final", score: 55, assessment: {}, updated_at: "2026-08-30T00:00:00.000Z", finalized_at: "2026-08-30T00:00:00.000Z" },
    { id: "sess-new", participant_id: "p-new", committee_id: "c1", status: "in_progress", score: null, assessment: {}, updated_at: "2026-09-02T09:00:00.000Z", finalized_at: null },
  ];
  const calls = [];
  async function rpc(name, args) {
    calls.push(name);
    if (name === "committee_login") return { data: { token: "tok-1", committee: { id: "c1", name: "لجنة 1", examiner_role: "chairman" } }, error: null };
    if (name === "committee_list_sessions") return { data: sessions, error: null };
    if (name === "committee_list_live_sessions") {
      if (!liveFunctionsDeployed) return { data: null, error: { message: "function public.committee_list_live_sessions(text, timestamp with time zone) does not exist", code: "42883" } };
      return { data: sessions.filter(s => s.status === "in_progress" || s.finalized_at >= args.p_since), error: null };
    }
    if (name === "committee_get_session") {
      if (!liveFunctionsDeployed) return { data: null, error: { message: "function public.committee_get_session(text, uuid) does not exist", code: "42883" } };
      return { data: sessions.find(s => s.id === args.p_session_id) || null, error: null };
    }
    throw new Error(`unexpected rpc: ${name}`);
  }
  return { sessions, calls, rpc };
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
      from: () => { throw new Error("raw table access not expected in this test") },
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(cloudSrc, sandbox, { filename: "cloud.js" });
  return sandbox.CloudCompetition;
}

async function run() {
  // 1) الدوال الخفيفة غير مُطبَّقة بعد بقاعدة البيانات (محاكاة "قبل تشغيل ملف الـSQL الجديد"):
  //    لازم يتراجع تلقائيًا لـcommittee_list_sessions/بحث القائمة الكاملة، بلا أي كسر.
  {
    const server = makeFakeServer({ liveFunctionsDeployed: false });
    const cloud = loadCloudModule(server);
    await cloud.init();
    await cloud.signInCommittee("L01", "1234");

    const live = await cloud.listLiveCommitteeSessions("2026-09-01T00:00:00.000Z");
    assert.strictEqual(live.length, 2, "رجوع آمن: يرجع كامل القائمة (سلوك committee_list_sessions القديم) بدل الانهيار");
    assert.ok(server.calls.includes("committee_list_live_sessions"), "حاول الدالة الخفيفة أولاً");
    assert.ok(server.calls.includes("committee_list_sessions"), "ثم تراجع فعليًا للدالة الكاملة القديمة");

    const single = await cloud.getCommitteeSession("sess-old");
    assert.strictEqual(single?.id, "sess-old", "getCommitteeSession ترجع الجلسة الصحيحة حتى بالتراجع للقائمة الكاملة والبحث فيها");
  }

  // 2) الدوال الخفيفة مُطبَّقة فعليًا: تُستخدم مباشرة، وترجع فقط الجلسات الحيّة/الحديثة —
  //    الجلسة القديمة (final قبل النافذة الزمنية) لا تظهر بـlistLiveCommitteeSessions.
  {
    const server = makeFakeServer({ liveFunctionsDeployed: true });
    const cloud = loadCloudModule(server);
    await cloud.init();
    await cloud.signInCommittee("L01", "1234");

    const live = await cloud.listLiveCommitteeSessions("2026-09-01T00:00:00.000Z");
    assert.strictEqual(live.length, 1, "بالنافذة الزمنية: الجلسة القديمة (sess-old، اعتُمدت قبل النافذة) مُستبعدة، الجارية (sess-new) فقط تبقى");
    assert.strictEqual(live[0].id, "sess-new");
    assert.ok(!server.calls.includes("committee_list_sessions"), "لا حاجة للتراجع للقائمة الكاملة طالما الدالة الخفيفة نجحت — توفير فعلي بالشبكة/قاعدة البيانات");

    const single = await cloud.getCommitteeSession("sess-old");
    assert.strictEqual(single?.id, "sess-old", "getCommitteeSession تجلب الجلسة بعينها بدون قيد النافذة الزمنية (تُستخدم لمزامنة جلسة محددة قيد الرصد فعليًا)");
  }

  console.log("tiered-realtime-fallback.test.js: كل الحالات نجحت — الدوال الخفيفة تُستخدم عند توفرها، وتتراجع بأمان تام قبل تطبيق ملف SQL الجديد");
}

run().catch((error) => {
  console.error("tiered-realtime-fallback.test.js FAILED:", error.stack || error.message);
  process.exit(1);
});
