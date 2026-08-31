// اختبار آلي لخلل "الحفظ التلقائي المتأخر يلغي اعتماد النتيجة": مسودة تلقائية مجدولة عبر
// queueSessionSave (تُرسل دائمًا حالة "in_progress" وعلامة فارغة) كانت ممكن تصل للسيرفر
// بعد اعتماد النتيجة النهائية مباشرة وترجّع الجلسة لحالة "قيد الاختبار" بعلامة فارغة، رغم
// أن رئيس اللجنة اعتمد نتيجة راسبة قبلها بلحظات. الإصلاح: cancelQueuedSessionSave تُستدعى
// فورًا قبل أي حفظ مباشر (اعتماد نهائي أو تثبيت رصد) في app.js.
// شغّله: node tests/session-race.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const projectRoot = path.join(__dirname, "..");
const cloudSrc = fs.readFileSync(path.join(projectRoot, "cloud.js"), "utf8");

// خادم وهمي يحاكي فقط سلوك عمودي status/score بدالة committee_save_session الحقيقية
// (supabase/two-examiners.sql): حفظ "in_progress" يصفّر العلامة دائمًا ويُنزل الحالة، بغض
// النظر شو كانت الحالة قبله — وهذا بالضبط الثغرة التي يستغلها حفظ تلقائي متأخر.
function makeFakeServer() {
  const sessions = new Map([["sess-1", { id: "sess-1", status: "in_progress", score: null, assessment: {} }]]);
  const calls = [];
  async function rpc(name, args) {
    if (name === "committee_login") return { data: { token: "tok-1", committee: { id: "c1", name: "لجنة 1", examiner_role: "chairman" } }, error: null };
    if (name === "committee_save_session") {
      calls.push({ status: args.p_status, score: args.p_score, at: Date.now() });
      const session = sessions.get(args.p_session_id);
      session.status = args.p_status;
      session.score = args.p_status === "final" ? args.p_score : null;
      session.assessment = args.p_assessment;
      return { data: { ...session }, error: null };
    }
    throw new Error(`unexpected rpc: ${name}`);
  }
  return { sessions, calls, rpc };
}

function loadCloudModule(fakeServer) {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout,
    clearTimeout,
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  // 1) بدون الإصلاح (بدون استدعاء cancelQueuedSessionSave): يعيد إنتاج الخلل فعليًا —
  //    يثبت أن السيناريو المُشخَّص حقيقي وليس افتراضًا نظريًا.
  {
    const server = makeFakeServer();
    const cloud = loadCloudModule(server);
    await cloud.init();
    await cloud.signInCommittee("L01", "1234");
    cloud.queueSessionSave("sess-1", { positions: [], status: "draft" }, console.error);
    await cloud.saveSession("sess-1", { positions: [{ x: 1 }], status: "final", result: { score: 62.5 } }, "final", 62.5);
    assert.strictEqual(server.sessions.get("sess-1").status, "final", "الجلسة يفترض تصير final فور الاعتماد");
    assert.strictEqual(server.sessions.get("sess-1").score, 62.5, "العلامة يفترض تكون 62.5 فور الاعتماد");
    await wait(400); // ننتظر أكثر من 300ms مهلة queueSessionSave حتى تصل المسودة المتأخرة
    assert.strictEqual(server.sessions.get("sess-1").status, "in_progress", "بدون الإصلاح: المسودة المتأخرة ترجّع الحالة in_progress (الخلل يتكرر فعليًا)");
    assert.strictEqual(server.sessions.get("sess-1").score, null, "بدون الإصلاح: العلامة ترجع null بعد اعتماد صحيح (هذا ما يُظهر لاحقًا 100 عند إعادة بناء تقييم فارغ)");
  }

  // 2) مع الإصلاح: استدعاء cancelQueuedSessionSave قبل الحفظ المباشر (تمامًا كما يفعل
  //    finalizeElectronicAssessment وopenAssessmentReview بعد التعديل) يمنع الخلل.
  {
    const server = makeFakeServer();
    const cloud = loadCloudModule(server);
    await cloud.init();
    await cloud.signInCommittee("L01", "1234");
    cloud.queueSessionSave("sess-1", { positions: [], status: "draft" }, console.error);
    cloud.cancelQueuedSessionSave();
    await cloud.saveSession("sess-1", { positions: [{ x: 1 }], status: "final", result: { score: 62.5 } }, "final", 62.5);
    await wait(400);
    assert.strictEqual(server.sessions.get("sess-1").status, "final", "مع الإصلاح: الحالة تبقى final بعد انتظار مهلة المسودة المتأخرة");
    assert.strictEqual(server.sessions.get("sess-1").score, 62.5, "مع الإصلاح: العلامة تبقى 62.5 ولا ترجع null أو تُفقد");
  }

  console.log("session-race.test.js: كل الحالات نجحت — cancelQueuedSessionSave يمنع خلل رجوع النتيجة المعتمدة لـ in_progress/null");
}

run().catch((error) => {
  console.error("session-race.test.js FAILED:", error.message);
  process.exit(1);
});
