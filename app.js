"use strict";

const CLOUD_STORAGE_KEY = "annualQuranCompetition.v2";
const LOCAL_STORAGE_KEY = "quranCompetition.localBranch.v1";
// localStorage هنا Cache ثانوي فقط (الأصل بالسحابة) — بدون هذا الغلاف امتلاء حصة التخزين يوقف saveState بالكامل ويمنع المزامنة.
function safeSetItem(key,value){try{localStorage.setItem(key,value)}catch(error){console.warn(`[localStorage] تعذر الحفظ محلياً (${key}), سيُتابَع بدون Cache محلي`,error)}}
const BRANCH_NAME = "فرع الكورة";
const LEVEL_QUESTIONS = {3:3,5:3,7:4,10:5,15:8,20:10,25:13,30:15};
const LEVEL_CATALOG = [
  {id:"L1",label:"المستوى الاول (حفظ القرآن كاملاً بغير رواية حفص عن عاصم)",parts:30},
  {id:"L2",label:"المستوى الثاني (حفظ القرآن كاملا برواية حفص عن عاصم)",parts:30},
  {id:"L3",label:"المستوى الثالث (حفظ 25 جزء)",parts:25},
  {id:"L4",label:"المستوى الرابع (حفظ 20 جزء)",parts:20},
  {id:"L5",label:"المستوى الخامس (حفظ 15 جزء)",parts:15},
  {id:"L6A",label:"المستوى السادس - أ (حفظ 10 أجزاء للأقل من 20 سنة)",parts:10},
  {id:"L6B",label:"المستوى السادس - ب (حفظ 10 أجزاء للأكبر من 20 سنة)",parts:10},
  {id:"L7A",label:"المستوى السابع - أ (حفظ 5 أجزاء للأقل من 15 سنة)",parts:5},
  {id:"L7B",label:"المستوى السابع - ب (حفظ 5 أجزاء للأكبر من 15 سنة)",parts:5}
];
function levelCatalogById(id){return LEVEL_CATALOG.find(l=>l.id===id)||null}
function normalizeLevelSpacing(value){return String(value||"").replace(/\s+/g," ").trim()}
function matchLevelCatalog(value){
  const spaced=normalizeLevelSpacing(value);if(!spaced)return null;
  const exact=LEVEL_CATALOG.find(l=>normalizeLevelSpacing(l.label)===spaced);if(exact)return exact;
  const key=normalizeHeader(spaced);if(!key)return null;
  return LEVEL_CATALOG.find(l=>normalizeHeader(l.label)===key)||null;
}
const PASS_SCORE = 75;
// ديوان الحفاظ: علامة نجاح مختلفة عن السنوية (85 لا 75)، ونظام مراحل (1/2/3/نهائي) بدل مستوى ثابت.
const DIWAN_PASS_SCORE = 85;
// أسطر صندوق التوصية المنقّط بقالب PDF الرسمي: ٥ نقاط بحد أقصى، كل نقطة بسطر واحد.
const DIWAN_RECOMMENDATION_MAX_POINTS = 5;
const DIWAN_RECOMMENDATION_MAX_CHARS = 70;
const DIWAN_STAGE_LABELS = {1:"الاختبار الأول",2:"الاختبار الثاني",3:"الاختبار الثالث",4:"الاختبار النهائي"};
const DIWAN_FINAL_BANDS = [[1,2,3,4,5,6,7,8,9,10],[11,12,13,14,15,16,17,18,19,20],[21,22,23,24,25,26,27,28,29,30]];
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];

let operationMode="gateway",cloudStartup=null,cloudStartupPromise=null;
let state = loadState();
const DIWAN_STORAGE_KEY = "diwanAlHifadh.v1";
let diwanState = loadDiwanState();
let diwanStateLoaded = false;
// صفحة المرحلة المفتوحة بلوحة ديوان الحفاظ (null = اللوحة الرئيسية بصناديق الملخّص فقط).
let diwanOpenStage = null;
// اختبار تجريبي: لحظي بالكامل، localStorage فقط بلا أي مزامنة سحابية — يعمل بأي وضع تشغيل، وحساب
// دخول مشترك واحد (رمز PIN) بدل تسجيل دخول مستقل لكل مستخدم (راجع القسم قرب نهاية الملف).
const TRIAL_STORAGE_KEY = "trialTest.v1";
const TRIAL_ACCESS_KEY = "competition-trial-access";
let trialState = loadTrialState();
let trialWorkingAssessment = null, trialExamOpenFor = null;
let diwanAdminSessions = [];
let candidates = [];
let integrity = {valid:false, errors:[], verseCount:0};
let cloudEnabled=false;
let committeeSessions=[];
let activeCloudSession=null;
let committeeAutoRefreshTimer=null,committeeRefreshBusy=false,committeeSessionsSignature=null,lastCommitteeStateVersion=null;
// اختبارات ديوان الحفاظ من شاشة اللجنة: تبويب مستقل بلا استطلاع دوري تلقائي (تحديث يدوي فقط،
// طلب صريح) — نفس حساب/رمز اللجنة يمتحن الطرفين، فقط بيانات ديوان الحفاظ (diwanCommitteeScopedState)
// منفصلة تماماً عن state (السنوية).
let diwanCommitteeSessions=[],diwanCommitteeTakenDraws=new Map(),diwanCommitteeRefreshSignature="",activeDiwanCloudSession=null,diwanCommitteeScopedState=defaultDiwanState();
let diwanCommitteeStudentsPage=1,diwanCommitteeStudentsPageSignature="";
// جلسة اعتُمدت قبل أكثر من 12 ساعة لا تتغيّر إلا بإعادة فتحها يدوياً — لا داعي لإعادة جلبها كل استطلاع (راجع listRecentFinalSessions/listLiveCommitteeSessions بـcloud.js).
const LIVE_RECENT_WINDOW_MS=12*60*60*1000;
let adminAutoRefreshTimer=null,adminRefreshBusy=false,lastAdminStateUpdatedAt=null;
let memberPositionSyncTimer=null;
function stopMemberPositionSync(){if(memberPositionSyncTimer)clearInterval(memberPositionSyncTimer);memberPositionSyncTimer=null}
let idleLogoutTimer=null;
let clockTimer=null;
function updateClock(){const el=$("#todayTime");if(el)el.textContent=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})}
const LAST_ADMIN_VIEW_KEY="competition-last-admin-view";
const ACTIVE_MODE_KEY="competition-active-mode";
const LOCAL_ACCESS_KEY="competition-local-access";
const COMMITTEE_ALERTS_KEY="competition-committee-alerts";
// تفضيل محلي بهذا الجهاز فقط، معطّل افتراضياً — لا تحديث تلقائي دوري إلا بتفعيل صريح من المستخدم (زر التحديث اليدوي يبقى متاحاً دائماً).
const LIVE_AUTOREFRESH_KEY="competition-live-autorefresh";
function liveAutoRefreshEnabled(){return localStorage.getItem(LIVE_AUTOREFRESH_KEY)==="on"}
const ASSESSMENT_DRAFT_PREFIX="competition-assessment-draft-";
const DIWAN_ASSESSMENT_DRAFT_PREFIX="diwan-assessment-draft-";
const IDLE_LOGOUT_MS=30*60*1000;
const optionalScripts=new Map();
let quranReadyPromise=null;
let quranLines=null;
let applyingBrowserHistory=false;
const HISTORY_MARKER="quran-competition-route-v1";
const QURAN_CACHE_NAME="competition-quran-assets-v2";

function loadOptionalScript(src,ready){if(ready())return Promise.resolve();if(optionalScripts.has(src))return optionalScripts.get(src);const promise=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=src;script.onload=()=>ready()?resolve():reject(new Error(`تعذر تشغيل ${src}`));script.onerror=()=>reject(new Error(`تعذر تحميل ${src}`));document.head.appendChild(script)});optionalScripts.set(src,promise);promise.catch(()=>optionalScripts.delete(src));return promise}
const ensureXlsx=()=>loadOptionalScript("vendor/xlsx.full.min.js",()=>Boolean(window.XLSX));
const ensurePdfLibraries=()=>Promise.all([loadOptionalScript("vendor/html2canvas.min.js",()=>Boolean(window.html2canvas)),loadOptionalScript("vendor/jspdf.umd.min.js",()=>Boolean(window.jspdf?.jsPDF))]);
const imageDataUrlCache=new Map();
function preloadImageAsDataUrl(src){
  if(imageDataUrlCache.has(src))return imageDataUrlCache.get(src);
  const promise=fetch(src).then(response=>response.blob()).then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("تعذر تحميل الشعار"));reader.readAsDataURL(blob)})).catch(()=>src);
  imageDataUrlCache.set(src,promise);
  return promise;
}
async function fetchJsonWithDeviceCache(url,validator,label){
  let cachedResponse=null;
  if("caches" in window){try{const cache=await caches.open(QURAN_CACHE_NAME);cachedResponse=await cache.match(url);if(cachedResponse){const data=await cachedResponse.clone().json();if(validator(data))return data}}catch{cachedResponse=null}}
  let lastError=null;
  // 4 محاولات و15 ثانية لكل محاولة: شبكة الامتحان الضعيفة كانت تقطع تحميل ملفات القرآن الكبيرة قبل اكتمالها.
  for(let attempt=1;attempt<=4;attempt++){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(url,{cache:"no-cache",signal:controller.signal});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const copy=response.clone(),data=await response.json();
      if(!validator(data))throw new Error("البيانات غير مكتملة");
      if("caches" in window)try{const cache=await caches.open(QURAN_CACHE_NAME);await cache.put(url,copy)}catch{}
      return data;
    }catch(error){lastError=error}finally{clearTimeout(timeout)}
  }
  throw new Error(`${label}: ${lastError?.name==="AbortError"?"انتهت مهلة الاتصال":lastError?.message||"تعذر التحميل"}`);
}
async function loadQuranDataResilient(){
  if(validateQuranData(window.QURAN_DATA).valid)return window.QURAN_DATA;
  try{
    const data=await fetchJsonWithDeviceCache("data/quran.json",value=>validateQuranData(value).valid,"تعذر تحميل بيانات القرآن");
    window.QURAN_DATA=data;
    return data;
  }catch(primaryError){
    try{await loadOptionalScript("data/quran-data.js",()=>validateQuranData(window.QURAN_DATA).valid);return window.QURAN_DATA}
    catch{throw primaryError}
  }
}
const validateQuranLines=value=>Boolean(value?.verses)&&Object.keys(value.verses).length===6236;
async function loadQuranLinesResilient(){
  if(validateQuranLines(window.QURAN_LINES_DATA))return window.QURAN_LINES_DATA;
  try{
    const data=await fetchJsonWithDeviceCache("data/quran-lines.json",validateQuranLines,"تعذر تحميل بيانات أسطر المصحف");
    window.QURAN_LINES_DATA=data;
    return data;
  }catch(primaryError){
    try{await loadOptionalScript("data/quran-lines-data.js",()=>validateQuranLines(window.QURAN_LINES_DATA));return window.QURAN_LINES_DATA}
    catch{throw primaryError}
  }
}
function ensureQuranReady(){
  if(integrity.valid&&candidates.length)return Promise.resolve(candidates);
  if(quranReadyPromise)return quranReadyPromise;
  quranReadyPromise=(async()=>{
    const [quranData,loadedLines]=await Promise.all([
      loadQuranDataResilient(),
      loadQuranLinesResilient()
    ]);
    const checked=validateQuranData(quranData);
    if(!checked.valid)throw new Error(checked.errors.join("، "));
    quranLines=loadedLines;
    integrity=checked;
    candidates=buildCandidates(window.QURAN_DATA,quranLines);
    const positionsCount=$("#setupPositions");
    if(positionsCount)positionsCount.textContent=formatNumber(candidates.length);
    return candidates;
  })().catch(error=>{quranReadyPromise=null;throw error});
  return quranReadyPromise;
}
let quranPrewarmTimer=null,quranPrewarmActive=false,quranPrewarmDelay=20000;
const QURAN_PREWARM_MIN_DELAY=20000,QURAN_PREWARM_MAX_DELAY=180000;
// إعادة محاولة صامتة بالخلفية بفاصل متزايد (20 ثانية إلى 3 دقائق) بدل محاولة واحدة فقط —
// على شبكة ضعيفة كانت تفشل بصمت ولا تُعاد حتى يضغط الفاحص "بدء الاختبار" فعلياً.
function prewarmQuranData(){
  if(integrity.valid&&candidates.length){clearTimeout(quranPrewarmTimer);quranPrewarmTimer=null;quranPrewarmActive=false;quranPrewarmDelay=QURAN_PREWARM_MIN_DELAY;return}
  if(quranPrewarmActive)return;
  quranPrewarmActive=true;
  const attempt=()=>{ensureQuranReady().then(()=>{quranPrewarmActive=false;quranPrewarmDelay=QURAN_PREWARM_MIN_DELAY}).catch(error=>{console.warn("Quran data preloading failed, retrying in background",error);quranPrewarmTimer=setTimeout(attempt,quranPrewarmDelay);quranPrewarmDelay=Math.min(quranPrewarmDelay*2,QURAN_PREWARM_MAX_DELAY)})};
  attempt();
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
else init();

async function init(){
  try{
    bindEvents();
    setupIdleLogout();
    buildPartsGrid();
    initColorModeToggle();
    lucide.createIcons();
    $("#setupPositions").textContent = "عند السحب";
    initializeBrowserNavigation();
    const rememberedMode=sessionStorage.getItem(ACTIVE_MODE_KEY);
    if(rememberedMode==="cloud"){
      operationMode="cloud";state=loadState(CLOUD_STORAGE_KEY);applyModeBranding();
      $("#gatewayScreen").classList.add("hidden");$("#loadingScreen").classList.remove("hidden");
      const startup=await initializeCloud();
      $("#loadingScreen").classList.add("hidden");
      if(startup?.enabled&&startup.context){cloudEnabled=true;await enterCloudContext(startup.context)}
      else{sessionStorage.removeItem(ACTIVE_MODE_KEY);showScreen("cloudLoginScreen")}
    }else if(rememberedMode==="local"){
      operationMode="local";state=loadState(LOCAL_STORAGE_KEY);applyModeBranding();
      $("#loadingScreen").classList.add("hidden");$("#app").classList.add("local-branch-app");
      if(state.config&&sessionStorage.getItem(LOCAL_ACCESS_KEY)==="granted")showApp();
      else if(state.config){$("#loginCompetitionName").textContent=state.config.competitionName;showScreen("loginScreen")}
      else showScreen("setupScreen");
    }else{
      $("#loadingScreen").classList.add("hidden");
      if(operationMode==="gateway"&&$("#trialStandaloneScreen").classList.contains("hidden"))showScreen("gatewayScreen");
    }
  }catch(error){
    $("#loadingScreen").classList.remove("hidden");
    $("#loadingScreen").innerHTML = `<div class="brand-mark"><span>تنبيه</span></div><strong>تعذر تشغيل المنصة</strong><p>${escapeHtml(error.message)}</p>`;
  }
}

function defaultState(){return {config:null,participants:[],draws:[],resets:[],deletions:[]}}
function activeStorageKey(){return operationMode==="local"?LOCAL_STORAGE_KEY:CLOUD_STORAGE_KEY}
function loadState(key=activeStorageKey()){try{return {...defaultState(),...JSON.parse(localStorage.getItem(key)||"null")}}catch{return defaultState()}}
function saveState(){safeSetItem(activeStorageKey(),JSON.stringify(state));if(operationMode==="cloud"&&cloudEnabled){const kind=window.CloudCompetition.context?.kind;showSyncStatus("saving");const onSuccess=()=>showSyncStatus("saved");if(kind==="subAdmin")window.CloudCompetition.queueSubAdminParticipantsSave(state.participants,error=>{showSyncStatus("error");toast(`تعذر مزامنة البيانات: ${error.message}`)},onSuccess);else if(kind==="supervisor")window.CloudCompetition.queueSupervisorSave(state,error=>{showSyncStatus("error");toast(`تعذر مزامنة البيانات: ${error.message}`)},onSuccess);else window.CloudCompetition.queueStateSave(state,error=>{showSyncStatus("error");toast(`تعذر مزامنة بيانات الإدارة: ${error.message}`)},onSuccess)}}
// شارة حفظ ثابتة بالهيدر: تبقى ظاهرة طول فترة "جارٍ الحفظ" وتختفي تلقائياً بعد النجاح/الفشل.
let syncStatusHideTimer=null;
function showSyncStatus(kind){
  const pill=$("#syncStatusPill");if(!pill)return;
  clearTimeout(syncStatusHideTimer);
  pill.classList.remove("hidden","is-saving","is-saved","is-error");
  if(kind==="saving"){pill.classList.add("is-saving");pill.innerHTML=`<i data-lucide="loader-2" class="spin"></i> جارٍ الحفظ...`}
  else if(kind==="saved"){pill.classList.add("is-saved");pill.innerHTML=`<i data-lucide="check"></i> تم الحفظ`;syncStatusHideTimer=setTimeout(()=>pill.classList.add("hidden"),1800)}
  else if(kind==="error"){pill.classList.add("is-error");pill.innerHTML=`<i data-lucide="alert-triangle"></i> تعذر الحفظ`;syncStatusHideTimer=setTimeout(()=>pill.classList.add("hidden"),4000)}
  lucide.createIcons();
}
function defaultDiwanState(){return {config:{competitionName:"اختبارات ديوان الحفاظ",nextCertificateSeq:0},participants:[],draws:[],resets:[],deletions:[]}}
function loadDiwanState(){try{return {...defaultDiwanState(),...JSON.parse(localStorage.getItem(DIWAN_STORAGE_KEY)||"null")}}catch{return defaultDiwanState()}}
// المسؤول الفرعي (ضمن جنس حسابه) ومشرف المسابقة يعملون على ديوان الحفاظ بصلاحيات الإدارة نفسها عبر دوال diwan_staff_*
// (راجع supabase/diwan-sub-admin-supervisor-view.sql)؛ الحذف والنقل بين اللجان حسب مفاتيح كل حساب، والتوزيع وحذف الجميع للإدارة الرئيسية.
function isDiwanCloudStaff(){return operationMode==="cloud"&&cloudEnabled&&["subAdmin","supervisor"].includes(window.CloudCompetition?.context?.kind)}
function isDiwanCloudWriter(){return operationMode==="cloud"&&cloudEnabled&&["admin","subAdmin","supervisor"].includes(window.CloudCompetition?.context?.kind)}
// طلب صريح: حسابات الديوان بصلاحية كاملة مثل الإدارة الرئيسية على متسابقي الديوان (بلا مفاتيح حذف/نقل).
function diwanStaffCan(){return true}
// نسخة الجهاز (localStorage) للإدارة الرئيسية/الوضع المحلي فقط — لا تُخزَّن بيانات حساب محصور بجنس واحد مكان بيانات الإدارة الكاملة.
function saveDiwanState(){if(!isDiwanCloudStaff())safeSetItem(DIWAN_STORAGE_KEY,JSON.stringify(diwanState));if(isDiwanCloudWriter())window.DiwanCompetition.queueStateSave(diwanState,error=>toast(`تعذر مزامنة بيانات ديوان الحفاظ: ${error.message}`))}
// يُحمَّل مرة واحدة فقط عند أول دخول فعلي لصفحة ديوان الحفاظ (لا عند دخول الإدارة نفسها) حتى لا يُبطئ تحميل لوحة التحكم الرئيسية بميزة ثانوية.
async function ensureDiwanStateLoaded(){
  if(diwanStateLoaded)return;
  diwanStateLoaded=true;
  if(operationMode==="cloud"&&cloudEnabled&&window.CloudCompetition.context?.kind==="admin"){
    try{
      const [remote,sessions]=await Promise.all([window.DiwanCompetition.loadState(),window.DiwanCompetition.listSessions()]);
      diwanState={...defaultDiwanState(),...remote.payload};
      window.DiwanCompetition.markAdminKnownIds(diwanState.participants,diwanState.draws);
      diwanAdminSessions=sessions;
      mergeFinalDiwanSessionsIntoState(sessions);
      safeSetItem(DIWAN_STORAGE_KEY,JSON.stringify(diwanState));
    }catch(error){diwanStateLoaded=false;toast(`تعذر تحميل بيانات ديوان الحفاظ: ${error.message}`)}
  }else if(isDiwanCloudStaff()){
    // لا نعرض أبداً نسخة الجهاز المحلية (قد تكون بيانات الإدارة كاملة بكل الأجناس) — فقط ما يرجعه الخادم لهذا الحساب.
    diwanState=defaultDiwanState();diwanAdminSessions=[];
    try{
      const [remote,sessions]=await Promise.all([window.DiwanCompetition.loadViewerState(),window.DiwanCompetition.listViewerSessions()]);
      diwanState={...defaultDiwanState(),...remote.payload};
      window.DiwanCompetition.markAdminKnownIds(diwanState.participants,diwanState.draws);
      diwanAdminSessions=sessions;
      mergeFinalDiwanSessionsIntoState(sessions);
    }catch(error){diwanStateLoaded=false;toast(`تعذر تحميل بيانات ديوان الحفاظ: ${error.message}`)}
  }
}
// آخر سحب للمشارك بمرحلته الحالية تحديداً — قد يملك المشارك سحوباً أقدم من مراحل سابقة (نجح
// فيها) أو محاولات فاشلة بنفس المرحلة (تاريخ محفوظ بالكامل)، فلا يكفي أول سحب يُطابق المعرّف.
function currentDiwanDraw(participant,draws){
  if(!participant)return null;
  // stageEnteredAt (يُكتب فقط عند النقل اليدوي لمرحلة): سحوبات ما قبله تبقى بالسجل لكنها لا تُعدّ سحب المرحلة الحالية.
  const enteredAt=participant.stageEnteredAt?new Date(participant.stageEnteredAt):null;
  const stageDraws=draws.filter(draw=>draw.participantId===participant.id&&draw.stage===participant.stage&&(!enteredAt||new Date(draw.createdAt)>=enteredAt));
  if(!stageDraws.length)return null;
  return stageDraws.reduce((best,item)=>new Date(item.createdAt)>new Date(best.createdAt)?item:best);
}
// يدمج نتائج اللجان المعتمدة (diwan_exam_sessions) داخل diwanState.participants — لكل مشارك
// نأخذ فقط الجلسات المطابقة لمرحلته الحالية (jلسات مراحل سابقة اعتُمدت أصلاً ولا تؤثر بعد الآن)،
// وبمعرّف lastGradedDrawId نمنع معالجة نفس النتيجة مرتين. النجاح (علامة ≥ DIWAN_PASS_SCORE بلا
// "غير مكتمل") يرحّل الأجزاء إلى usedJuz ويرقّي المرحلة تلقائياً؛ الرسوب يبقي المرحلة كما هي.
function mergeFinalDiwanSessionsIntoState(sessions){
  let changed=false;
  const finalByParticipant=new Map();
  sessions.filter(session=>session.status==="final").forEach(session=>{
    const list=finalByParticipant.get(session.participant_id)||[];list.push(session);finalByParticipant.set(session.participant_id,list);
  });
  diwanState.participants.forEach(participant=>{
    const list=finalByParticipant.get(participant.id);if(!list||participant.certified||participant.withdrawn)return;
    const enteredAt=participant.stageEnteredAt?new Date(participant.stageEnteredAt):null;const currentStageSessions=list.filter(session=>session.stage===participant.stage&&(!enteredAt||new Date(session.finalized_at||session.updated_at)>=enteredAt));if(!currentStageSessions.length)return;
    const latest=currentStageSessions.reduce((best,item)=>new Date(item.finalized_at||item.updated_at)>new Date(best.finalized_at||best.updated_at)?item:best);
    if(participant.lastGradedDrawId===latest.draw_id)return;
    participant.lastGradedDrawId=latest.draw_id;
    participant.score=latest.score;
    participant.gradedAt=latest.finalized_at;
    participant.assessment=latest.assessment||null;
    const incomplete=Boolean(latest.assessment?.incomplete);
    if(!incomplete&&Number.isFinite(latest.score)&&latest.score>=DIWAN_PASS_SCORE){
      participant.usedJuz=[...new Set([...(participant.usedJuz||[]),...(participant.parts||[])])];
      if(participant.stage<4)participant.stage+=1;
      else{participant.certified=true;diwanState.config.nextCertificateSeq=(diwanState.config.nextCertificateSeq||0)+1;participant.certificateNumber=diwanState.config.nextCertificateSeq}
      participant.parts=[];
    }
    changed=true;
  });
  if(changed)saveDiwanState();
  return changed;
}
// ensureDiwanStateLoaded تجيب نتائج اللجان مرة وحدة بس عند أول دخول للصفحة (تفادياً لإبطاء لوحة
// التحكم)، فما في تحديث تلقائي بعدها — هذا الزر يعيد جلب نتائج كل اللجان يدوياً بأي وقت (نفس
// #syncCloudBtn بالسنوية بالضبط).
// يعمل فقط أثناء فتح صفحة ديوان الحفاظ مع تفعيل «التحديث التلقائي المباشر»: يجلب النتائج الجديدة ويدمجها (نقل تلقائي بين المراحل) دون رسائل.
let diwanQuietRefreshBusy=false;
async function refreshDiwanResultsQuietly(){
  if(diwanQuietRefreshBusy||document.hidden||!diwanStateLoaded||!$("#diwanView")?.classList.contains("active-view"))return;
  if(!(operationMode==="cloud"&&cloudEnabled&&(window.CloudCompetition.context?.kind==="admin"||isDiwanCloudStaff())))return;
  diwanQuietRefreshBusy=true;
  try{const sessions=await window.DiwanCompetition.listViewerSessions();diwanAdminSessions=sessions;if(mergeFinalDiwanSessionsIntoState(sessions)&&$("#modal")?.classList.contains("hidden"))renderDiwanParticipants()}
  catch(error){console.warn("Diwan quiet refresh failed",error)}
  finally{diwanQuietRefreshBusy=false}
}
async function refreshDiwanCommitteeResults(){
  const button=$("#diwanSyncCommitteesBtn");button.disabled=true;
  try{
    if(isDiwanCloudStaff()){diwanStateLoaded=false;await ensureDiwanStateLoaded()}
    else{const sessions=await window.DiwanCompetition.listSessions();diwanAdminSessions=sessions;mergeFinalDiwanSessionsIntoState(sessions)}
    renderDiwanParticipants();
    if(!diwanStateLoaded)return;
    toast("تم تحديث نتائج جميع اللجان");
  }catch(error){toast(`تعذر تحديث النتائج: ${error.message}`)}
  finally{button.disabled=false}
}
async function hashText(value){const bytes=new TextEncoder().encode(value);const hash=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function uid(prefix="ID"){const bytes=new Uint32Array(2);crypto.getRandomValues(bytes);return `${prefix}-${Date.now().toString(36).toUpperCase()}-${bytes[0].toString(36).toUpperCase()}`}
function randomIndex(max){if(max<=0) throw new Error("لا توجد عناصر متاحة للسحب");const range=0x100000000-(0x100000000%max);const box=new Uint32Array(1);do{crypto.getRandomValues(box)}while(box[0]>=range);return box[0]%max}
function secureShuffle(items){const result=[...items];for(let i=result.length-1;i>0;i--){const j=randomIndex(i+1);[result[i],result[j]]=[result[j],result[i]]}return result}

function validateQuranData(data){
  const errors=[];
  if(!data||!Array.isArray(data.verses)||!Array.isArray(data.chapters)) errors.push("ملف القرآن غير صالح");
  if(errors.length) return {valid:false,errors,verseCount:0};
  if(data.verses.length!==6236) errors.push(`عدد الآيات ${data.verses.length} بدلاً من 6236`);
  if(data.chapters.length!==114) errors.push(`عدد السور ${data.chapters.length} بدلاً من 114`);
  const keys=new Set();
  for(const verse of data.verses){
    if(keys.has(verse.verse_key)) errors.push(`تكرار الآية ${verse.verse_key}`); keys.add(verse.verse_key);
    if(verse.juz_number<1||verse.juz_number>30||verse.page_number<1||verse.page_number>604) errors.push(`بيانات تقسيم غير صالحة عند ${verse.verse_key}`);
    if(!verse.text_uthmani) errors.push(`نص مفقود عند ${verse.verse_key}`);
    if(errors.length>20) break;
  }
  return {valid:errors.length===0,errors,verseCount:data.verses.length};
}

function buildCandidates(data,lineData){
  const chapterMap=new Map(data.chapters.map(c=>[c.id,c.name_arabic]));
  const chapterCounts=new Map(data.chapters.map(c=>[c.id,c.verses_count]));
  const result=[];
  for(let juz=1;juz<=30;juz++){
    const verses=data.verses.filter(v=>v.juz_number===juz).sort((a,b)=>a.id-b.id).map(verse=>{const layout=lineData.verses[verse.verse_key];return {...verse,layoutPage:Number(layout.page),lineStart:Number(layout.from),lineEnd:Number(layout.to)}});
    // مواضع متتابعة غير متداخلة (1-8 ثم 9-16...) بدل نافذة منزلقة آية بآية (كانت تولّد مواضع شبه متطابقة).
    let i=0;
    while(i<verses.length){
      const start=verses[i];
      const [chapter,startAyah]=start.verse_key.split(":").map(Number);
      const shortSurah=juz===30&&chapter>=93&&chapterCounts.get(chapter)<=20;
      // نفضّل موضعاً بـ8 أسطر بالضبط، ونسمح بـ9 فقط لو ما وجدت نهاية تعطي 8 (يرفع عدد المواضع ~30% بالأجزاء الطويلة). delta الأصغر يفوز عند التعادل.
      let bestCandidate=null,bestDelta=Infinity,bestEndIndex=-1;
      const occupiedLines=new Map();
      let words=0;
      for(let end=i;end<verses.length;end++){
        const finish=verses[end],[endChapter,endAyah]=finish.verse_key.split(":").map(Number);
        addVerseLines(occupiedLines,finish);
        words+=wordCount(finish.text_uthmani);
        const lineCount=countOccupiedLines(occupiedLines);
        if(lineCount>9)break;
        if(shortSurah&&endAyah!==chapterCounts.get(endChapter))continue;
        if(lineCount<8)continue;
        const delta=Math.abs(lineCount-8);
        if(delta>=bestDelta)continue;
        bestDelta=delta;
        const segments=occupiedLineSegments(occupiedLines);
        bestCandidate={id:`${juz}-${start.verse_key}-${finish.verse_key}`,juz,chapter,chapterName:chapterMap.get(chapter),endChapter,endChapterName:chapterMap.get(endChapter),startAyah,endAyah,startId:start.id,endId:finish.id,page:start.layoutPage,endPage:finish.layoutPage,words,lineCount,lineModel:"occupied-v2",lineSegments:segments,startKey:start.verse_key,endKey:finish.verse_key};
        bestEndIndex=end;
      }
      if(bestCandidate){result.push(bestCandidate);i=bestEndIndex+1}
      else i++; // آية طويلة جداً تتجاوز 9 أسطر لحالها (مثل آية الدَّين) — نجرّب الآية التالية بدل التخلي عن باقي الجزء.
    }
  }
  return dedupeCandidates(result);
}
function addVerseLines(linesByPage,verse){if(!linesByPage.has(verse.layoutPage))linesByPage.set(verse.layoutPage,new Set());const lines=linesByPage.get(verse.layoutPage);for(let line=verse.lineStart;line<=verse.lineEnd;line++)lines.add(line)}
function countOccupiedLines(linesByPage){let count=0;linesByPage.forEach(lines=>count+=lines.size);return count}
function occupiedLineSegments(linesByPage){const segments=[];[...linesByPage.entries()].sort((a,b)=>a[0]-b[0]).forEach(([page,lineSet])=>{const lines=[...lineSet].sort((a,b)=>a-b);let from=null,previous=null;lines.forEach(line=>{if(from===null){from=previous=line;return}if(line===previous+1){previous=line;return}segments.push({page,from,to:previous});from=previous=line});if(from!==null)segments.push({page,from,to:previous})});return segments}
function wordCount(text){return text.trim().split(/\s+/).filter(Boolean).length}
function dedupeCandidates(list){const seen=new Set();return list.filter(item=>{const key=`${item.startKey}-${item.endKey}`;if(seen.has(key))return false;seen.add(key);return true})}

function bindEvents(){
  document.addEventListener("click",event=>{$$(".dropdown-menu[open]").forEach(menu=>{if(!menu.contains(event.target)||event.target.closest("button"))menu.open=false})});
  // قائمة "المزيد" بآخر صف كانت تُقص لأن .table-wrap عندها overflow:auto — نحوّلها لـposition:fixed
  // بإحداثيات محسوبة وقت الفتح (تفلت من القص)، وتفتح للأعلى لو ما في مساحة تحتها.
  document.addEventListener("toggle",event=>{
    const details=event.target;
    if(!details?.classList?.contains?.("row-actions-more"))return;
    const list=details.querySelector(".row-actions-more-list");
    if(!list)return;
    if(!details.open){list.style.cssText="";return}
    requestAnimationFrame(()=>{
      if(!details.open)return;
      const rect=details.getBoundingClientRect(),listRect=list.getBoundingClientRect(),spaceBelow=window.innerHeight-rect.bottom;
      const openUpward=spaceBelow<listRect.height+12&&rect.top>listRect.height;
      list.style.position="fixed";
      list.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-listRect.width-8))}px`;
      list.style.top=openUpward?`${rect.top-listRect.height-4}px`:`${rect.bottom+4}px`;
      list.style.zIndex="70";
    });
  },true);
  // الاستطلاعات الدورية تتوقف بالخلفية (document.hidden) لتوفير النت — هذا يحدّثها فوراً عند العودة للتبويب.
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden)return;
    if(monitorPollTimer)renderMonitorCommittees();
    if(committeeAutoRefreshTimer)refreshCommitteeChanges();
    if(adminAutoRefreshTimer)refreshAdminChanges();
    if(issueReportsPollTimer)renderIssueReports();
    refreshDiwanResultsQuietly();
  });
  // نتائج لجان ديوان الحفاظ تُجلب دورياً طالما صفحة الديوان مفتوحة (بغض النظر عن إعداد التحديث المباشر) حتى تظهر العلامة ويتم الترحيل للمرحلة التالية فور اعتماد اللجنة.
  setInterval(refreshDiwanResultsQuietly,8000);
  $$('[data-back-gateway]').forEach(button=>button.addEventListener("click",returnToGateway));
  $("#localBackupShortcut").addEventListener("click",downloadBackup);
  $("#setupForm").addEventListener("submit",setupApp);
  $("#loginForm").addEventListener("submit",login);
  $("#logoutBtn").addEventListener("click",logout);
  $("#menuBtn").addEventListener("click",toggleSidebar);
  $$("[data-view]").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.view)));
  $$("[data-go]").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.go)));
  $("#addParticipantBtn").addEventListener("click",()=>openParticipantModal());
  $("#bulkDrawBtn").addEventListener("click",openBulkDrawModal);
  $("#sendCommitteeBroadcastBtn")?.addEventListener("click",()=>openCommitteeBroadcastModal());
  $("#closeCommitteeBroadcast")?.addEventListener("click",dismissCommitteeBroadcast);
  $("#deleteAllParticipantsBtn").addEventListener("click",confirmDeleteAllParticipants);
  $("#exportResultsBtn").addEventListener("click",exportFinalResults);
  $("#exportUnifiedResultsBtn")?.addEventListener("click",exportUnifiedResults);
  $("#bulkPdfBtn")?.addEventListener("click",openBulkPdfDialog);
  $("#bulkDrawPdfBtn")?.addEventListener("click",openBulkDrawPdfDialog);
  $("#associationCardBtn")?.addEventListener("click",openAssociationCardDialog);
  $("#participantSearch").addEventListener("input",renderParticipants);
  $("#participantFilter").addEventListener("change",()=>{savePersistedParticipantFilters();renderParticipants()});
  $("#participantGenderFilter").addEventListener("change",()=>{savePersistedParticipantFilters();renderParticipants()});
  $("#participantCenterFilter").addEventListener("change",()=>{savePersistedParticipantFilters();renderParticipants()});
  $("#participantLevelFilter").addEventListener("change",()=>{savePersistedParticipantFilters();renderParticipants()});
  $("#participantCommitteeFilter").addEventListener("change",()=>{savePersistedParticipantFilters();renderParticipants()});
  $("#csvInput").addEventListener("change",importCsv);
  $("#addDiwanParticipantBtn").addEventListener("click",()=>openDiwanParticipantModal());
  $("#diwanParticipantSearch").addEventListener("input",renderDiwanParticipants);
  $("#diwanStageBackBtn")?.addEventListener("click",closeDiwanStage);
  $("#diwanStageSearch")?.addEventListener("input",renderDiwanParticipants);
  $$(`#diwanStatusFilter,#diwanGenderFilter,#diwanCenterFilter,#diwanCommitteeFilter`).forEach(select=>select.addEventListener("change",()=>{saveDiwanPersistedParticipantFilters();renderDiwanParticipants()}));
  $("#diwanExportBtn").addEventListener("click",exportDiwanParticipants);
  $("#diwanBulkPdfBtn")?.addEventListener("click",openDiwanBulkPdfDialog);
  $("#diwanSyncCommitteesBtn").addEventListener("click",refreshDiwanCommitteeResults);
  $("#diwanImportInput").addEventListener("change",importDiwanExcel);
  $("#diwanBulkDrawBtn")?.addEventListener("click",openDiwanBulkDrawModal);
  $("#diwanDistributeBtn")?.addEventListener("click",openDiwanDistributeModal);
  $("#diwanDeleteAllBtn")?.addEventListener("click",confirmDeleteAllDiwanParticipants);
  $("#trialBackBtn")?.addEventListener("click",closeTrialScreen);
  $("#addTrialParticipantBtn")?.addEventListener("click",()=>openTrialParticipantModal());
  $("#trialParticipantSearch")?.addEventListener("input",renderTrialParticipants);
  $("#trialChangePinBtn")?.addEventListener("click",openTrialSetPinModal);
  $("#drawParticipant").addEventListener("change",loadParticipantIntoDraw);
  $("#drawLevel").addEventListener("change",levelChanged);
  $("#drawQuestionCount").addEventListener("input",updateAvailability);
  const dashboardDateInput=$("#dashboardDateInput");
  if(dashboardDateInput){
    dashboardDateInput.max=dateStamp();
    const dashboardDateDayBtn=$("#dashboardDateDayBtn"),dashboardDateAllBtn=$("#dashboardDateAllBtn");
    // مفتاح ثنائي واضح (تراكمي/يوم محدد) بدل حقل تاريخ ظاهر دائماً بجانب زر — الحقل يظهر فقط
    // باختيار "يوم محدد" حتى لا يبدو خياراً فعّالاً أثناء وضع "الكل".
    const setDashboardDateMode=dayMode=>{dashboardDateAllBtn.classList.toggle("is-active",!dayMode);dashboardDateDayBtn.classList.toggle("is-active",dayMode);dashboardDateInput.classList.toggle("hidden",!dayMode)};
    dashboardDateInput.addEventListener("change",()=>{dashboardDateFilter=dashboardDateInput.value||null;renderDashboard()});
    dashboardDateDayBtn.addEventListener("click",()=>{setDashboardDateMode(true);dashboardDateInput.focus();try{dashboardDateInput.showPicker?.()}catch{}});
    dashboardDateAllBtn.addEventListener("click",()=>{dashboardDateFilter=null;dashboardDateInput.value="";setDashboardDateMode(false);renderDashboard()});
  }
  $("#drawForm").addEventListener("submit",performDraw);
  $("#drawPartsEditBtn").addEventListener("click",openDrawPartsEditor);
  $("#drawPartsSaveBtn").addEventListener("click",saveDrawParticipantParts);
  $("#drawPartsCancelBtn").addEventListener("click",closeDrawPartsEditor);
  $("#scoreComparisonSearch").addEventListener("input",renderScoreComparisonTable);
  $("#scoreComparisonCommitteeFilter").addEventListener("change",renderScoreComparisonTable);
  $("#refreshScoreComparisonBtn").addEventListener("click",async()=>{if(await renderScoreComparison())toast("تم تحديث البيانات بنجاح")});
  $("#deleteAllScoreComparisonBtn").addEventListener("click",confirmDeleteAllScoreComparisonRows);
  $("#committeeBreakdownGender").addEventListener("change",()=>{committeeBreakdownGender=$("#committeeBreakdownGender").value;renderCommitteeBreakdownBody()});
  $("#exportScoreComparisonBtn").addEventListener("click",exportScoreComparison);
  $("#historySearch").addEventListener("input",renderHistory);
  $("#exportHistoryBtn").addEventListener("click",exportHistory);
  $("#examDurationSearch").addEventListener("input",renderExamDurations);
  $("#examDurationCommitteeFilter")?.addEventListener("change",renderExamDurations);
  $("#exportExamDurationsBtn").addEventListener("click",exportExamDurations);
  $("#deleteAllDrawsBtn").addEventListener("click",confirmDeleteAllDraws);
  $("#runAuditBtn").addEventListener("click",runAudit);
  $("#settingsForm").addEventListener("submit",saveSettings);
  $("#centerForm")?.addEventListener("submit",event=>{event.preventDefault();addManagedCenter($("#newCenterName").value);$("#newCenterName").value=""});
  // تفضيل محلي مستقل عن نموذج الإعدادات، يُطبَّق فوراً بلا حاجة لـ«حفظ التغييرات».
  $("#settingsLiveAutoRefresh")?.addEventListener("change",event=>{const enabled=event.target.checked;safeSetItem(LIVE_AUTOREFRESH_KEY,enabled?"on":"off");if(enabled)startAdminAutoRefresh();else stopAdminAutoRefresh();toast(enabled?"تم تفعيل التحديث التلقائي المباشر كل 9 ثوانٍ بهذا الجهاز":"تم إيقاف التحديث التلقائي — استخدم زر «تحديث نتائج اللجان» يدوياً عند الحاجة")});
  $("#backupBtn").addEventListener("click",downloadBackup);
  $("#restoreInput").addEventListener("change",restoreBackup);
  $("#newCycleBtn").addEventListener("click",confirmNewCycle);
  $("#modal").addEventListener("click",event=>{if(event.target.id==="modal")closeModal()});
  $("#cloudLoginForm").addEventListener("submit",cloudLogin);
  $("#forgotPasswordBtn").addEventListener("click",()=>openLoginRecoveryModal("admin"));
  $("#committeeForgotPinBtn").addEventListener("click",()=>openLoginRecoveryModal("committee"));
  $("#subAdminForgotPinBtn").addEventListener("click",()=>openLoginRecoveryModal("subAdmin"));
  $("#committeeLoginForm").addEventListener("submit",committeeLogin);
  $("#subAdminLoginForm").addEventListener("submit",subAdminLogin);
  $("#showAdminLoginBtn").addEventListener("click",()=>showCloudLoginMode("admin"));
  $("#showSubAdminLoginBtn").addEventListener("click",()=>showCloudLoginMode("subAdmin"));
  $$(`[data-back-committee-login]`).forEach(button=>button.addEventListener("click",()=>showCloudLoginMode("committee")));
  $("#committeeLogoutBtn").addEventListener("click",cloudLogout);
  $("#showExamInstructionsBtn").addEventListener("click",()=>window.open("assets/exam-instructions.pdf","_blank"));
  $("#refreshCommitteeBtn").addEventListener("click",async()=>{if(await renderCommitteeWorkspace())toast("تم تحديث البيانات بنجاح")});
  $("#committeeSearch").addEventListener("input",renderCommitteeStudents);
  $("#committeeStatusFilter").addEventListener("change",renderCommitteeStudents);
  $("#committeeCenterFilter").addEventListener("change",renderCommitteeStudents);
  $$(`[data-committee-track]`).forEach(button=>button.addEventListener("click",()=>setCommitteeTrack(button.dataset.committeeTrack)));
  $("#refreshDiwanCommitteeBtn").addEventListener("click",async()=>{if(await renderDiwanCommitteeWorkspace())toast("تم تحديث البيانات بنجاح")});
  $("#diwanCommitteeSearch").addEventListener("input",renderDiwanCommitteeStudents);
  $("#diwanCommitteeStatusFilter").addEventListener("change",renderDiwanCommitteeStudents);
  $("#clearCommitteeAlertsBtn").addEventListener("click",clearCommitteeAlerts);
  $("#committeeAccountForm").addEventListener("submit",linkCommitteeAccount);
  $("#cancelCommitteeEdit").addEventListener("click",resetCommitteeForm);
  $("#subAdminAccountForm").addEventListener("submit",saveSubAdminAccount);
  $("#cancelSubAdminEdit").addEventListener("click",resetSubAdminForm);
  $("#supervisorAccountForm").addEventListener("submit",saveSupervisorAccount);
  $("#cancelSupervisorEdit").addEventListener("click",resetSupervisorForm);
  $("#syncCloudBtn").addEventListener("click",refreshAdminCloudResults);
  $("#refreshActivityLogBtn").addEventListener("click",async()=>{if(await renderActivityLog())toast("تم تحديث البيانات بنجاح")});
  $("#activityLogFilter").addEventListener("change",renderActivityLogList);
  $("#approveAllDrBtn").addEventListener("click",approveAllDrRequests);
  $("#refreshIssueReportsBtn").addEventListener("click",async()=>{if(await renderIssueReports())toast("تم تحديث البيانات بنجاح")});
}

async function setupApp(event){
  event.preventDefault();
  state.config={competitionName:$("#setupCompetitionName").value.trim(),adminName:$("#setupAdminName").value.trim(),pinHash:await hashText($("#setupPin").value),createdAt:new Date().toISOString()};
  saveState();if(operationMode==="local"){sessionStorage.setItem(ACTIVE_MODE_KEY,"local");sessionStorage.setItem(LOCAL_ACCESS_KEY,"granted")}showApp();toast("تم إنشاء دورة المسابقة بنجاح");
}
async function login(event){event.preventDefault();const ok=await hashText($("#loginPin").value)===state.config.pinHash;$("#loginError").classList.toggle("hidden",ok);if(ok){$("#loginPin").value="";if(operationMode==="local"){sessionStorage.setItem(ACTIVE_MODE_KEY,"local");sessionStorage.setItem(LOCAL_ACCESS_KEY,"granted")}showApp()}}
function setAdminTheme(theme){document.documentElement.classList.toggle("theme-rose",theme==="rose")}
const COLOR_MODE_KEY="competition-color-mode";
function setColorMode(mode){
  document.documentElement.classList.toggle("theme-dark",mode==="dark");
  safeSetItem(COLOR_MODE_KEY,mode);
  const btn=$("#colorModeToggle");
  if(btn){btn.innerHTML=mode==="dark"?`<i data-lucide="sun"></i>`:`<i data-lucide="moon"></i>`;lucide.createIcons()}
}
function initColorModeToggle(){
  const btn=$("#colorModeToggle");if(!btn)return;
  const current=localStorage.getItem(COLOR_MODE_KEY)==="dark"?"dark":"light";
  setColorMode(current);
  btn.onclick=()=>setColorMode(document.documentElement.classList.contains("theme-dark")?"light":"dark");
}
function dockColorModeToggle(dock){
  const btn=$("#colorModeToggle"),chip=$(".date-chip");
  if(!btn)return;
  if(dock&&chip&&btn.nextElementSibling!==chip){chip.parentElement.insertBefore(btn,chip);btn.classList.add("docked")}
  else if(!dock&&btn.parentElement!==document.body){document.body.appendChild(btn);btn.classList.remove("docked")}
}
const SIDEBAR_COLLAPSED_KEY="competition-sidebar-collapsed";
const MOBILE_BREAKPOINT=780;
function toggleSidebar(){if(window.innerWidth<=MOBILE_BREAKPOINT){$(".sidebar").classList.toggle("open");return}const collapsed=$("#app").classList.toggle("sidebar-collapsed");safeSetItem(SIDEBAR_COLLAPSED_KEY,collapsed?"1":"0")}
function restoreSidebarState(){if(window.innerWidth<=MOBILE_BREAKPOINT)return;$("#app").classList.toggle("sidebar-collapsed",localStorage.getItem(SIDEBAR_COLLAPSED_KEY)==="1")}
function applyModeBranding(){const local=operationMode==="local";$("#setupBrandLine").textContent=local?"استخدام محلي مستقل · بياناتك تبقى على هذا الجهاز":"جمعية المحافظة على القرآن الكريم | فرع الكورة";$("#localLoginBrandLine").textContent=local?"استخدام محلي مستقل · لا يتم إرسال البيانات":"جمعية المحافظة على القرآن الكريم | فرع الكورة";$("#sidebarBrandTitle").textContent=local?"منصة إدارة المسابقات القرآنية":"جمعية المحافظة على القرآن الكريم";$("#sidebarBrandSubtitle").textContent=local?"وضع محلي مستقل":"فرع الكورة | المسابقة السنوية"}
function initializeCloud(){if(cloudStartup)return Promise.resolve(cloudStartup);if(cloudStartupPromise)return cloudStartupPromise;cloudStartupPromise=window.CloudCompetition.init().then(status=>{cloudEnabled=status.enabled;cloudStartup=status;return status}).catch(error=>{console.warn("Cloud initialization failed",error);cloudStartup={enabled:false,context:null,error};return cloudStartup});return cloudStartupPromise}
function returnToGateway(){sessionStorage.removeItem(ACTIVE_MODE_KEY);sessionStorage.removeItem(LOCAL_ACCESS_KEY);operationMode="gateway";$("#app").classList.add("hidden");showScreen("gatewayScreen");recordBrowserRoute({surface:"gateway"})}
async function openKouraMode(){operationMode="cloud";sessionStorage.setItem(ACTIVE_MODE_KEY,"cloud");state=loadState(CLOUD_STORAGE_KEY);applyModeBranding();$("#app").classList.remove("local-branch-app");const startup=await initializeCloud();if(!startup?.enabled){sessionStorage.removeItem(ACTIVE_MODE_KEY);return toast("تعذر الاتصال بنظام فرع الكورة حالياً")}cloudEnabled=true;if(startup.context)return enterCloudContext(startup.context);showScreen("cloudLoginScreen")}
function openLocalMode(){operationMode="local";sessionStorage.setItem(ACTIVE_MODE_KEY,"local");sessionStorage.removeItem(LOCAL_ACCESS_KEY);state=loadState(LOCAL_STORAGE_KEY);applyModeBranding();$("#app").classList.add("local-branch-app");if(!state.config){$("#setupCompetitionName").value="مسابقة تحفيظ القرآن الكريم";$("#setupAdminName").value="";showScreen("setupScreen")}else{$("#loginCompetitionName").textContent=state.config.competitionName;showScreen("loginScreen")}}
function logout(){if(operationMode==="cloud")return cloudLogout();sessionStorage.removeItem(ACTIVE_MODE_KEY);sessionStorage.removeItem(LOCAL_ACCESS_KEY);$("#app").classList.add("hidden");showScreen("gatewayScreen")}
function showScreen(id){if(!$("#trialStandaloneScreen").classList.contains("hidden")){closeTrialAssessmentIfOpen();$("#trialStandaloneScreen").classList.add("hidden")}["gatewayScreen","setupScreen","loginScreen","cloudLoginScreen"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));$("#committeeApp").classList.toggle("hidden",id!=="committeeApp");if(id)dockColorModeToggle(false);if(id&&!applyingBrowserHistory)recordBrowserRoute({surface:id==="committeeApp"?"committee":"screen",screen:id})}
function currentViewKey(){return operationMode==="local"?`${LAST_ADMIN_VIEW_KEY}.local`:`${LAST_ADMIN_VIEW_KEY}.cloud`}
function currentListUi(){return {participantSearch:$("#participantSearch")?.value||"",participantFilter:$("#participantFilter")?.value||"all",participantGenderFilter:$("#participantGenderFilter")?.value||"all",participantCenterFilter:$("#participantCenterFilter")?.value||"all",participantLevelFilter:$("#participantLevelFilter")?.value||"all",participantCommitteeFilter:$("#participantCommitteeFilter")?.value||"all",historySearch:$("#historySearch")?.value||"",committeeSearch:$("#committeeSearch")?.value||"",committeeStatusFilter:$("#committeeStatusFilter")?.value||"all",scrollY:Math.max(0,window.scrollY||0)}}
// فلاتر جدول المتسابقين تبقى محفوظة دائماً عبر localStorage (طبقة ثانية فوق history.state، الذي يتصفّر عند تحديث الصفحة).
const PARTICIPANT_LIST_UI_KEY="competition-participant-list-ui";
function savePersistedParticipantFilters(){const ui=currentListUi();safeSetItem(PARTICIPANT_LIST_UI_KEY,JSON.stringify({participantFilter:ui.participantFilter,participantGenderFilter:ui.participantGenderFilter,participantCenterFilter:ui.participantCenterFilter,participantLevelFilter:ui.participantLevelFilter,participantCommitteeFilter:ui.participantCommitteeFilter}))}
function loadPersistedParticipantFilters(){try{return JSON.parse(localStorage.getItem(PARTICIPANT_LIST_UI_KEY)||"null")||{}}catch{return {}}}
function restoreListControls(ui={}){for(const [id,value] of Object.entries(ui)){const element=$("#"+id);if(element&&id!=="scrollY")element.value=value}}
function recordBrowserRoute(route,{replace=false}={}){if(applyingBrowserHistory)return;const current=history.state,same=current?.marker===HISTORY_MARKER&&current.surface===route.surface&&current.view===(route.view||current.view)&&current.screen===(route.screen||current.screen);const entry={marker:HISTORY_MARKER,mode:operationMode,...route,ui:currentListUi()};const url=new URL(location.href);url.hash=route.surface==="admin"?`admin/${route.view||"dashboard"}`:route.surface==="committee"?"committee":route.surface==="gateway"?"gateway":route.screen||"gateway";((replace||same)?history.replaceState:history.pushState).call(history,entry,"",url)}
function hasUnfinishedAssessment(){if(!activeCloudSession)return false;const participant=state.participants.find(item=>item.id===activeCloudSession.participant_id);return Boolean(participant?.assessment&&participant.assessment.status!=="final")}
function initializeBrowserNavigation(){if(history.state?.marker!==HISTORY_MARKER)recordBrowserRoute({surface:"gateway"},{replace:true});window.addEventListener("popstate",event=>{const target=event.state;if(!target||target.marker!==HISTORY_MARKER){history.forward();return}if(hasUnfinishedAssessment()&&!confirm("التقييم الحالي غير معتمد بعد، لكنه محفوظ كمسودة. هل تريد مغادرة شاشة التقييم؟")){history.forward();return}applyingBrowserHistory=true;try{closeModal();restoreListControls(target.ui);operationMode=target.mode||operationMode;if(target.surface==="admin"){showScreen("");$("#app").classList.remove("hidden");dockColorModeToggle(true);navigate(target.view||"dashboard",{historyMode:"none",ui:target.ui})}else if(target.surface==="committee"){$("#app").classList.add("hidden");showScreen("committeeApp");renderCommitteeStudents();requestAnimationFrame(()=>window.scrollTo(0,target.ui?.scrollY||0))}else{$("#app").classList.add("hidden");showScreen(target.surface==="gateway"?"gatewayScreen":target.screen||"gatewayScreen");requestAnimationFrame(()=>window.scrollTo(0,target.ui?.scrollY||0))}}finally{applyingBrowserHistory=false}});let routeTimer;document.addEventListener("input",event=>{if(!["participantSearch","historySearch","committeeSearch"].includes(event.target.id))return;clearTimeout(routeTimer);routeTimer=setTimeout(()=>{if(history.state?.marker===HISTORY_MARKER)recordBrowserRoute(history.state,{replace:true})},150)});document.addEventListener("change",event=>{if(!["participantFilter","committeeStatusFilter"].includes(event.target.id))return;if(history.state?.marker===HISTORY_MARKER)recordBrowserRoute(history.state,{replace:true})})}
function showApp(){showScreen("");$("#app").classList.remove("hidden");dockColorModeToggle(true);restoreSidebarState();$("#app").classList.toggle("local-branch-app",operationMode==="local");$("#localModeNotice").classList.toggle("hidden",operationMode!=="local");$("#topCompetitionName").textContent=state.config.competitionName;$("#todayText").textContent=new Intl.DateTimeFormat("ar-JO",{weekday:"long",day:"numeric",month:"long",year:"numeric",numberingSystem:"latn"}).format(new Date());updateClock();if(!clockTimer)clockTimer=setInterval(updateClock,1000);hydrateSettings();restoreListControls(loadPersistedParticipantFilters());renderAll();const savedRoute=history.state?.marker===HISTORY_MARKER&&history.state.surface==="admin"?history.state:null;navigate(savedRoute?.view||localStorage.getItem(currentViewKey())||"dashboard",{historyMode:savedRoute?"replace":"push",ui:savedRoute?.ui});if(operationMode==="cloud"&&cloudEnabled&&["admin","supervisor"].includes(window.CloudCompetition.context?.profile.role)){setupCloudAdminPanel();startAdminAutoRefresh()}else stopAdminAutoRefresh();if(operationMode==="cloud"&&cloudEnabled&&["admin","supervisor","subAdmin"].includes(window.CloudCompetition.context?.kind)){renderIssueReports();startIssueReportsPoll()}else stopIssueReportsPoll();prewarmQuranData()}
async function cloudLogin(event){event.preventDefault();const button=event.submitter,errorBox=$("#cloudLoginError");const originalHtml=button.innerHTML;button.disabled=true;button.textContent="جارٍ التحقق من البيانات...";errorBox.classList.add("hidden");try{const context=await window.CloudCompetition.signInAdmin($("#cloudLoginEmail").value.trim(),$("#cloudLoginPassword").value);$("#cloudLoginPassword").value="";await enterCloudContext(context)}catch(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden")}finally{button.disabled=false;button.innerHTML=originalHtml}}
const LOGIN_RECOVERY_KINDS={
  admin:{prefillId:"cloudLoginEmail",passwordId:"cloudLoginPassword",fieldLabel:"الإيميل",fieldType:"email",fieldPlaceholder:"",newLabel:"كلمة السر الجديدة",newType:"password",newMin:6,title:"نسيت كلمة السر"},
  committee:{prefillId:"committeeLoginCode",passwordId:"committeeLoginPin",fieldLabel:"رمز الدخول (رمزك الشخصي)",fieldType:"text",fieldPlaceholder:"مثال: L01",newLabel:"PIN جديد",newType:"password",newMin:4,title:"نسيت الرمز السري (PIN)"},
  subAdmin:{prefillId:"subAdminLoginCode",passwordId:"subAdminLoginPin",fieldLabel:"رمز الدخول",fieldType:"text",fieldPlaceholder:"مثال: SA-M",newLabel:"PIN جديد",newType:"password",newMin:4,title:"نسيت الرمز السري (PIN)"},
};
function openLoginRecoveryModal(kind){
  const cfg=LOGIN_RECOVERY_KINDS[kind];
  const prefill=$(`#${cfg.prefillId}`)?.value.trim()||"";
  openModal(`<div class="modal-head"><div><span class="eyebrow">استعادة الدخول</span><h2>${cfg.title}</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">اكتب ${cfg.fieldLabel} — بيوصل رمز تحقق للإدارة، اطلبه منها هاتفياً وأدخله بالخطوة التالية.</p><form id="loginRecoveryStep1" class="form-grid"><label>${cfg.fieldLabel}<input id="recoveryIdentifier" type="${cfg.fieldType}" required value="${escapeAttr(prefill)}" placeholder="${cfg.fieldPlaceholder}"></label><p id="recoveryStep1Error" class="form-error hidden"></p><button class="primary-btn wide" type="submit">إرسال الرمز</button></form></div>`,"bulk-pdf-modal");
  $("#loginRecoveryStep1").addEventListener("submit",event=>submitLoginRecoveryRequest(event,kind));
  $("#recoveryIdentifier").focus();
}
async function submitLoginRecoveryRequest(event,kind){
  event.preventDefault();
  const button=event.submitter,errorBox=$("#recoveryStep1Error"),identifier=$("#recoveryIdentifier").value.trim();
  button.disabled=true;errorBox.classList.add("hidden");
  try{await window.CloudCompetition.requestLoginRecoveryCode(identifier);openLoginRecoveryStep2(kind,identifier)}
  catch(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden");button.disabled=false}
}
function openLoginRecoveryStep2(kind,identifier){
  const cfg=LOGIN_RECOVERY_KINDS[kind];
  openModal(`<div class="modal-head"><div><span class="eyebrow">استعادة الدخول</span><h2>أدخل الرمز</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">اطلب الرمز من الإدارة هاتفياً، وحطه هون مع ${cfg.newLabel}.</p><form id="loginRecoveryStep2" class="form-grid"><label>الرمز<input id="recoveryCode" required inputmode="numeric" maxlength="6" placeholder="123456"></label><label>${cfg.newLabel}<input id="recoveryNewValue" required type="${cfg.newType}" minlength="${cfg.newMin}" autocomplete="new-password"></label><p id="recoveryStep2Error" class="form-error hidden"></p><button class="primary-btn wide" type="submit">تحديث</button><button id="recoveryResendBtn" class="text-login-btn" type="button">لم يصلك الرمز؟ أعد الإرسال</button></form></div>`,"bulk-pdf-modal");
  $("#loginRecoveryStep2").addEventListener("submit",event=>submitLoginRecoveryReset(event,kind,identifier));
  $("#recoveryResendBtn").onclick=async()=>{const btn=$("#recoveryResendBtn");btn.disabled=true;try{await window.CloudCompetition.requestLoginRecoveryCode(identifier);toast("تم إرسال رمز جديد")}catch(error){toast(error.message)}finally{btn.disabled=false}};
  $("#recoveryCode").focus();
}
async function submitLoginRecoveryReset(event,kind,identifier){
  event.preventDefault();
  const cfg=LOGIN_RECOVERY_KINDS[kind];
  const button=event.submitter,errorBox=$("#recoveryStep2Error"),code=$("#recoveryCode").value.trim(),newValue=$("#recoveryNewValue").value;
  button.disabled=true;errorBox.classList.add("hidden");
  try{
    await window.CloudCompetition.confirmLoginRecovery(identifier,code,newValue);
    closeModal();
    const identifierInput=$(`#${cfg.prefillId}`);if(identifierInput)identifierInput.value=identifier;
    const passwordInput=$(`#${cfg.passwordId}`);if(passwordInput)passwordInput.value="";
    toast(kind==="admin"?"تم تحديث كلمة السر بنجاح، سجّل دخولك الآن بكلمة السر الجديدة":"تم تحديث الرمز السري بنجاح، سجّل دخولك الآن به");
  }catch(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden");button.disabled=false}
}
async function committeeLogin(event){event.preventDefault();const button=event.submitter,errorBox=$("#committeeLoginError");const originalHtml=button.innerHTML;button.disabled=true;button.textContent="جارٍ التحقق من البيانات...";errorBox.classList.add("hidden");try{const context=await window.CloudCompetition.signInCommittee($("#committeeLoginCode").value.trim(),$("#committeeLoginPin").value);$("#committeeLoginPin").value="";await enterCloudContext(context)}catch(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden")}finally{button.disabled=false;button.innerHTML=originalHtml}}
function showCloudLoginMode(mode){const committee=mode==="committee",admin=mode==="admin",subAdmin=mode==="subAdmin";$("#committeeLoginForm").classList.toggle("hidden",!committee);$(".login-mode-links").classList.toggle("hidden",!committee);$("#cloudLoginForm").classList.toggle("hidden",!admin);$("#subAdminLoginForm").classList.toggle("hidden",!subAdmin);$("#cloudLoginTitle").textContent=admin?"دخول إدارة المسابقة":subAdmin?"دخول مسؤول فرعي":"دخول لجنة الاختبار";$(admin?"#cloudLoginEmail":subAdmin?"#subAdminLoginCode":"#committeeLoginCode").focus()}
async function subAdminLogin(event){event.preventDefault();const button=event.submitter,errorBox=$("#subAdminLoginError");const originalHtml=button.innerHTML;button.disabled=true;button.textContent="جارٍ التحقق من البيانات...";errorBox.classList.add("hidden");try{const context=await window.CloudCompetition.signInSubAdmin($("#subAdminLoginCode").value.trim(),$("#subAdminLoginPin").value);$("#subAdminLoginPin").value="";await enterCloudContext(context)}catch(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden")}finally{button.disabled=false;button.innerHTML=originalHtml}}
async function cloudLogout(){stopCommitteeAutoRefresh();stopAdminAutoRefresh();stopMonitorPoll();stopIssueReportsPoll();stopMemberPositionSync();clearTimeout(idleLogoutTimer);sessionStorage.removeItem(ACTIVE_MODE_KEY);try{await window.CloudCompetition.signOut()}catch(error){console.warn("Sign out failed",error)}activeCloudSession=null;committeeSessions=[];cloudStartup={enabled:cloudEnabled,context:null};diwanStateLoaded=false;diwanAdminSessions=[];
  // تصفير صريح لبقايا لجنة سابقة على نفس الجهاز (كشك مشترك) — بدونه ممكن اللجنة التالية تشوف
  // للحظة بيانات اللجنة السابقة بشاشة ديوان الحفاظ قبل ما يكتمل التحديث الفعلي.
  activeDiwanCloudSession=null;diwanCommitteeSessions=[];diwanCommitteeScopedState=defaultDiwanState();diwanCommitteeStudentsPage=1;diwanCommitteeStudentsPageSignature="";
  const diwanStudentsBox=$("#diwanCommitteeStudents");if(diwanStudentsBox)diwanStudentsBox.innerHTML="";
  resetSubAdminRestrictions();setAdminTheme("green");$("#app").classList.add("hidden");showScreen("gatewayScreen")}
function setupIdleLogout(){const reset=()=>{clearTimeout(idleLogoutTimer);if(!window.CloudCompetition?.context)return;idleLogoutTimer=setTimeout(async()=>{await cloudLogout();toast("تم تسجيل الخروج بعد 30 دقيقة دون نشاط")},IDLE_LOGOUT_MS)};["pointerdown","keydown","touchstart","scroll"].forEach(type=>document.addEventListener(type,reset,{passive:true}));document.addEventListener("visibilitychange",()=>{if(!document.hidden)reset()});setInterval(()=>{if(window.CloudCompetition?.context&&!idleLogoutTimer)reset()},60000)}
function toggleCommitteeMemberFields(){const enabled=$("#enableCommitteeMember")?.checked,fields=$("#committeeMemberFields");if(!fields)return;fields.classList.toggle("hidden",!enabled);$("#newCommitteeMemberName").required=Boolean(enabled);$("#newCommitteeMemberCode").required=Boolean(enabled);$("#newCommitteeMemberPin").required=Boolean(enabled&&!$("#newCommitteeMemberCode").dataset.existing)}
function ensureCommitteeMemberFields(){if($("#newCommitteeMemberCode"))return;const chairmanPin=$("#newCommitteePin")?.closest("label");if(!chairmanPin)return;chairmanPin.insertAdjacentHTML("afterend",`<label class="committee-member-toggle"><input id="enableCommitteeMember" type="checkbox"> تفعيل حساب عضو اللجنة ورصده المستقل</label><div id="committeeMemberFields" class="committee-member-fields hidden"><label>اسم عضو اللجنة<input id="newCommitteeMemberName" placeholder="الاسم الثلاثي"></label><label>رمز عضو اللجنة<input id="newCommitteeMemberCode" maxlength="20" placeholder="مثال: L01-M"></label><label>PIN عضو اللجنة<input id="newCommitteeMemberPin" type="password" inputmode="numeric" minlength="4" placeholder="4 خانات أو أكثر"></label></div>`);$("#enableCommitteeMember").addEventListener("change",toggleCommitteeMemberFields);toggleCommitteeMemberFields()}
function renderCommitteeLevelOptions(){const box=$("#committeeLevelOptions");if(!box||box.children.length)return;box.innerHTML=LEVEL_CATALOG.map(l=>`<label><input type="checkbox" name="committeeLevel" value="${l.id}"> ${escapeHtml(l.label)}</label>`).join("")}
async function setupCloudAdminPanel(){ensureCommitteeMemberFields();renderCommitteeLevelOptions();window.CloudCompetition.pruneOldLogs?.();const isMainAdmin=window.CloudCompetition.context?.profile.role==="admin";$("#cloudCommitteesPanel").classList.remove("hidden");$("#scoreComparisonPanel")?.classList.remove("hidden");$("#subAdminsPanel").classList.remove("hidden");$("#drRequestsPanel").classList.remove("hidden");$("#activityLogPanel").classList.toggle("hidden",!isMainAdmin);$("#syncCloudBtn").classList.remove("hidden");$("#diwanSyncCommitteesBtn")?.classList.remove("hidden");$("#supervisorsPanel").classList.toggle("hidden",!isMainAdmin);$("#sendCommitteeBroadcastBtn")?.classList.toggle("hidden",!isMainAdmin);renderDrRequests();const tasks=[renderCloudCommittees(),renderSubAdmins()];if(isMainAdmin){tasks.push(renderSupervisors());tasks.push(renderActivityLog())}await Promise.all(tasks)}
async function refreshAdminCloudResults(){const button=$("#syncCloudBtn");button.disabled=true;try{await syncFinalSessionsIntoState();renderAll();toast("تم تحديث نتائج جميع اللجان")}catch(error){toast(`تعذر تحديث النتائج: ${error.message}`)}finally{button.disabled=false}}
let cloudCommittees=[];
// صفحات كثيرة (>7): تُختصر لأول صفحة + جوار الصفحة الحالية + آخر صفحة، مع "..." بالفجوات.
function paginationRange(current,total,siblingCount=1){
  const totalNumbers=siblingCount*2+5;
  if(total<=totalNumbers)return Array.from({length:total},(_,i)=>i+1);
  const leftSibling=Math.max(current-siblingCount,1),rightSibling=Math.min(current+siblingCount,total);
  const showLeftDots=leftSibling>2,showRightDots=rightSibling<total-1;
  if(!showLeftDots&&showRightDots){const leftCount=3+2*siblingCount;return [...Array.from({length:leftCount},(_,i)=>i+1),"...",total]}
  if(showLeftDots&&!showRightDots){const rightCount=3+2*siblingCount;return [1,"...",...Array.from({length:rightCount},(_,i)=>total-rightCount+1+i)]}
  return [1,"...",...Array.from({length:rightSibling-leftSibling+1},(_,i)=>leftSibling+i),"...",total]
}
function renderPagerTabs(containerId,currentPage,totalPages,onSelect){
  const el=$(`#${containerId}`);if(!el)return;
  if(totalPages<=1){el.innerHTML="";return}
  // زر السابق/التالي يظهر فقط عند أول/آخر صفحة (RTL: السابق=يمين، التالي=يسار).
  const prevBtn=currentPage>1?`<button type="button" class="pager-nav" data-pager-page="${currentPage-1}" aria-label="الصفحة السابقة"><i data-lucide="chevron-right"></i></button>`:"";
  const nextBtn=currentPage<totalPages?`<button type="button" class="pager-nav" data-pager-page="${currentPage+1}" aria-label="الصفحة التالية"><i data-lucide="chevron-left"></i></button>`:"";
  const middle=paginationRange(currentPage,totalPages).map(n=>n==="..."?`<span class="pager-ellipsis">…</span>`:`<button type="button" class="${n===currentPage?"active":""}" data-pager-page="${n}">${formatNumber(n)}</button>`).join("");
  el.innerHTML=prevBtn+middle+nextBtn;
  $$(`#${containerId} [data-pager-page]`).forEach(button=>button.onclick=()=>onSelect(Number(button.dataset.pagerPage)));
  lucide.createIcons();
}
let committeeStudentsPage=1,committeeStudentsPageSignature="";
let participantsPage=1,participantsPageSignature="";
let subAdminCommittees=[];
let monitorPollTimer=null,monitorSessions=[],monitorSelectedCommitteeId=null,monitorSelectedSessionId=null,monitorSelectedRole="chairman";
function stopMonitorPoll(){if(monitorPollTimer)clearInterval(monitorPollTimer);monitorPollTimer=null}
async function renderMonitorView(){
  if(!(operationMode==="cloud"&&["admin","supervisor","subAdmin"].includes(window.CloudCompetition.context?.kind))){$("#monitorDetailPanel").innerHTML=`<div class="monitor-empty">المراقبة الحية متاحة فقط لحساب الإدارة الرئيسي أو مشرف المسابقة أو المسؤول الفرعي في وضع فرع الكورة.</div>`;$("#monitorCommitteeList").innerHTML="";return}
  stopMonitorPoll();
  await renderMonitorCommittees();
  monitorPollTimer=setInterval(()=>{if(!document.hidden)renderMonitorCommittees()},4000);
}
// اختبارات ديوان الحفاظ الجارية عند اللجان (نفس بنية جلسة السنوية: examinerDrafts/positions) — تُدمج بالمراقبة الحية مع track:"diwan".
async function listDiwanMonitorSessions(){
  // محاولة تحميل واحدة لكل تسجيل دخول (المراقبة تتحدّث كل 4 ثوانٍ — لا تكرار لرسالة خطأ التحميل).
  try{const context=window.CloudCompetition.context;if(!diwanStateLoaded&&listDiwanMonitorSessions.triedFor!==context){listDiwanMonitorSessions.triedFor=context;await ensureDiwanStateLoaded()}const list=await window.DiwanCompetition.listViewerSessions();return (list||[]).filter(s=>s.status==="in_progress").map(s=>({...s,track:"diwan"}))}
  catch(error){console.warn("Diwan monitor sessions failed",error);return []}
}
function monitorSessionRecord(session){
  if(session.track==="diwan"){const participant=diwanState.participants.find(p=>p.id===session.participant_id);return {participant,draw:diwanState.draws.find(d=>d.id===session.draw_id)}}
  return {participant:state.participants.find(p=>p.id===session.participant_id),draw:state.draws.find(d=>d.participantId===session.participant_id)};
}
async function renderMonitorCommittees(){
  try{
    const monitorKind=window.CloudCompetition.context?.kind;
    if(monitorKind==="subAdmin")cloudCommittees=subAdminCommittees;
    const [sessions,diwanSessions]=await Promise.all([window.CloudCompetition.listActiveSessions(),listDiwanMonitorSessions(),monitorKind==="subAdmin"||cloudCommittees.length?null:window.CloudCompetition.listCommittees().then(list=>{cloudCommittees=list})]);
    monitorSessions=[...sessions,...diwanSessions];
    const activeByCommittee=new Map();
    monitorSessions.filter(s=>s.status==="in_progress").forEach(s=>{const list=activeByCommittee.get(s.committee_id)||[];list.push(s);activeByCommittee.set(s.committee_id,list)});
    const list=$("#monitorCommitteeList");if(!list)return;
    list.innerHTML=cloudCommittees.length?cloudCommittees.map(committee=>{
      const active=activeByCommittee.get(committee.id)||[];
      return `<button type="button" class="committee-row monitor-committee-btn ${committee.id===monitorSelectedCommitteeId?"is-selected":""}" data-monitor-committee="${committee.id}"><div class="committee-row-head"><div><b>${escapeHtml(committee.name)}</b><small>${committee.responsible_gender==="أنثى"?"إناث":"ذكور"}</small></div><span class="status-pill ${active.length?"is-live":""}">${active.length?`${formatNumber(active.length)} قيد الاختبار الآن`:"لا يوجد اختبار جارٍ"}</span></div></button>`;
    }).join(""):`<div class="committee-empty">لا توجد لجان بعد.</div>`;
    $$(`[data-monitor-committee]`).forEach(btn=>btn.onclick=()=>{monitorSelectedCommitteeId=btn.dataset.monitorCommittee;monitorSelectedSessionId=null;monitorSelectedRole="chairman";renderMonitorCommittees();renderMonitorDetail()});
    renderMonitorDetail();
  }catch(error){console.warn("Monitor refresh failed",error);if(!monitorSessions.length)$("#monitorDetailPanel").innerHTML=`<div class="monitor-empty">تعذر تحميل المراقبة الحية: ${escapeHtml(error.message)}</div>`}
}
function renderMonitorDetail(){
  const panel=$("#monitorDetailPanel");if(!panel)return;
  if(!monitorSelectedCommitteeId){panel.innerHTML=`<div class="monitor-empty">اختر لجنة من القائمة لعرض ما يجري داخلها الآن.</div>`;return}
  const committee=cloudCommittees.find(c=>c.id===monitorSelectedCommitteeId);
  const activeSessions=monitorSessions.filter(s=>s.committee_id===monitorSelectedCommitteeId&&s.status==="in_progress");
  if(!activeSessions.length){panel.innerHTML=`<div class="monitor-empty">لا يوجد اختبار جارٍ حاليًا عند لجنة ${escapeHtml(committee?.name||"")}.</div>`;return}
  if(!monitorSelectedSessionId||!activeSessions.some(s=>s.id===monitorSelectedSessionId))monitorSelectedSessionId=activeSessions[0].id;
  const session=activeSessions.find(s=>s.id===monitorSelectedSessionId);
  const isDiwan=session.track==="diwan";
  const {participant,draw}=monitorSessionRecord(session);
  if((!participant||!draw)&&isDiwan){panel.innerHTML=`<div class="monitor-empty">اختبار ديوان الحفاظ هذا لمتسابق أُضيف أو سُحب له بعد فتح الصفحة — اضغط «تحديث نتائج اللجان» بصفحة ديوان الحفاظ ثم ارجع هنا.</div>`;return}
  if(!participant||!draw){panel.innerHTML=`<div class="monitor-empty"><p>تعذر إيجاد بيانات هذا الاختبار — قد تكون بيانات المتسابقين قيد التحديث، حاول لاحقًا.</p><p class="field-help">إذا استمرت المشكلة بعد الانتظار وإعادة فتح الصفحة، غالبًا هذه جلسة معلّقة لمتسابق لم يعد موجودًا (حُذف أو عُدّلت بياناته من مكان آخر). بدأت هذه الجلسة: ${formatDate(session.started_at)}.</p><button type="button" class="secondary-btn danger-compact" id="closeStaleMonitorSession"><i data-lucide="trash-2"></i> إغلاق هذه الجلسة المعلّقة نهائيًا</button></div>`;$("#closeStaleMonitorSession").onclick=async()=>{if(!confirm("إغلاق هذه الجلسة المعلّقة نهائيًا؟ هذا الإجراء لا يمكن التراجع عنه."))return;try{await window.CloudCompetition.deleteParticipantSession(session.participant_id);monitorSessions=monitorSessions.filter(s=>s.id!==session.id);monitorSelectedSessionId=null;renderMonitorDetail();toast("تم إغلاق الجلسة المعلّقة")}catch(error){toast(error.message)}};lucide.createIcons();return}
  const hasMember=Boolean(committee?.member_name);
  if(!hasMember)monitorSelectedRole="chairman";
  const draft=session.assessment?.examinerDrafts?.[monitorSelectedRole]||null;
  const positions=draw.positions.map((drawPosition,index)=>({...emptyPositionAssessment(drawPosition),...(draft?.positions?.[index]||{})}));
  const result=calculateAssessment({positions},isDiwan?DIWAN_PASS_SCORE:undefined);
  const currentIndex=Number(draft?.currentPosition)||0;
  panel.innerHTML=`<div class="monitor-detail-head">${activeSessions.length>1?`<div class="monitor-session-tabs">${activeSessions.map(s=>{const p=monitorSessionRecord(s).participant;return `<button type="button" class="compact-btn ${s.id===session.id?"is-active":""}" data-monitor-session="${s.id}">${escapeHtml(p?.name||"—")}${s.track==="diwan"?" · ديوان":""}</button>`}).join("")}</div>`:""}<div class="monitor-participant"><h3>${escapeHtml(participant.name)}</h3><span>${isDiwan?`ديوان الحفاظ · ${escapeHtml(DIWAN_STAGE_LABELS[draw.stage]||"")}`:`${participant.level} أجزاء`} · ${escapeHtml(participant.center||"")} · رقم الجلوس ${escapeHtml(participant.seat)}</span></div>${hasMember?`<div class="monitor-role-tabs"><button type="button" class="compact-btn ${monitorSelectedRole==="chairman"?"is-active":""}" data-monitor-role="chairman">رصد الرئيس</button><button type="button" class="compact-btn ${monitorSelectedRole==="member"?"is-active":""}" data-monitor-role="member">رصد العضو</button></div>`:""}<div class="monitor-live-score ${result.passed?"pass-text":"fail-text"}">العلامة الحالية: ${formatAssessmentNumber(result.score)}</div></div><div class="monitor-positions">${draft?positions.map((position,index)=>monitorPositionHtml(position,draw.positions[index],index,index===currentIndex)).join(""):`<p class="committee-alerts-empty">لم يبدأ ${monitorSelectedRole==="chairman"?"الرئيس":"العضو"} برصد هذا المتسابق بعد.</p>`}</div>`;
  $$(`[data-monitor-session]`).forEach(btn=>btn.onclick=()=>{monitorSelectedSessionId=btn.dataset.monitorSession;renderMonitorDetail()});
  $$(`[data-monitor-role]`).forEach(btn=>btn.onclick=()=>{monitorSelectedRole=btn.dataset.monitorRole;renderMonitorDetail()});
  lucide.createIcons();
}
function monitorPositionHtml(position,drawPosition,index,isCurrent){
  const deduction=calculateAssessment({positions:[position]}).totalDeduction;
  const typeBadges=Object.entries(ASSESSMENT_RULES).filter(([type])=>Number(position[type])>0).map(([type,rule])=>`<span>${rule.label}: ${formatAssessmentNumber(position[type])}</span>`).join("");
  return `<article class="monitor-position-card ${isCurrent?"is-current":""} ${position.completed?"is-done":""}"><div class="monitor-position-head"><span>الموضع ${index+1}${isCurrent?" · الحالي الآن":""}${position.completed?" · مُنهى":""}</span><b>خصم: ${formatAssessmentNumber(deduction)}</b></div><p>${escapeHtml(positionTitle(drawPosition))} · الجزء ${drawPosition.juz} · الصفحة ${drawPosition.page}</p>${typeBadges?`<div class="monitor-position-badges">${typeBadges}</div>`:`<div class="monitor-position-badges empty">لا أخطاء مسجّلة بعد</div>`}</article>`;
}
function committeePermissionRowHtml(label,attr,id,checked){return `<label class="permission-row"><span>${label}</span><span class="switch"><input type="checkbox" ${attr}="${id}" ${checked?"checked":""}><span class="switch-slider"></span></span></label>`}
async function renderCloudCommittees(){try{const canDeleteCommittee=window.CloudCompetition.context?.profile.role==="admin";cloudCommittees=await window.CloudCompetition.listCommittees();if($("#participantsView")?.classList.contains("active-view"))renderParticipants();$("#committeesList").innerHTML=cloudCommittees.length?cloudCommittees.map(committee=>`<div class="committee-row ${committee.active?"":"inactive"}" data-committee-row="${committee.id}"><div class="committee-row-head"><div><b>${escapeHtml(committee.name)}</b><small>${committee.responsible_gender==="أنثى"?"إناث":"ذكور"}</small><small>الرئيس: ${escapeHtml(committee.chairman_name||"—")} · رمز الدخول: ${escapeHtml(committee.login_code||"—")}</small>${committee.member_name?`<small>العضو: ${escapeHtml(committee.member_name)} · رمز الدخول: ${escapeHtml(committee.member_login_code||"—")}</small>`:""}</div><div class="row-actions">${canDeleteCommittee?`<button class="compact-btn" data-send-broadcast="${committee.id}"><i data-lucide="megaphone"></i> رسالة</button>`:""}<button class="compact-btn" data-edit-committee="${committee.id}">تعديل</button>${canDeleteCommittee?`<button class="compact-btn danger-compact" data-delete-committee="${committee.id}" data-committee-name="${escapeAttr(committee.name)}"><i data-lucide="trash-2"></i> حذف</button>`:""}</div></div><div class="committee-permissions">${committeePermissionRowHtml("اللجنة مفعّلة","data-toggle-committee",committee.id,committee.active)}${committeePermissionRowHtml("صلاحية تعديل النتائج المعتمدة","data-final-edit",committee.id,committee.can_edit_final)}${committeePermissionRowHtml("صلاحية السحب للمتسابقين غير المسجَّلين","data-self-draw-permission",committee.id,committee.can_self_draw)}${committeePermissionRowHtml("إظهار العلامة للجنة بعد الاعتماد","data-show-score",committee.id,committee.show_score!==false)}${committeePermissionRowHtml("إظهار بطاقة الإحصائية للجنة","data-show-stats",committee.id,committee.show_stats_summary!==false)}</div><div class="committee-levels-badges">${(committee.level_names||[]).length?committee.level_names.map(name=>`<span>${escapeHtml(name)}</span>`).join(""):`<span>${(committee.levels||[]).sort((a,b)=>a-b).join("، ")} أجزاء</span>`}</div></div>`).join(""):`<div class="committee-empty">لا توجد لجان بعد. أضفها عندما يتحدد توزيع يوم المسابقة.</div>`;$$(`[data-edit-committee]`).forEach(button=>button.onclick=()=>editCommittee(button.dataset.editCommittee));$$(`[data-send-broadcast]`).forEach(button=>button.onclick=()=>openCommitteeBroadcastModal(button.dataset.sendBroadcast));$$(`[data-final-edit]`).forEach(input=>input.onchange=async()=>{const enabled=input.checked;input.disabled=true;try{await window.CloudCompetition.setCommitteeFinalEdit(input.dataset.finalEdit,enabled);toast(enabled?"تم منح صلاحية تعديل النتائج المعتمدة":"تم سحب صلاحية تعديل النتائج المعتمدة")}catch(error){input.checked=!enabled;toast(error.message)}finally{input.disabled=false}});$$(`[data-self-draw-permission]`).forEach(input=>input.onchange=async()=>{const enabled=input.checked;input.disabled=true;try{await window.CloudCompetition.setCommitteeSelfDraw(input.dataset.selfDrawPermission,enabled);toast(enabled?"تم منح اللجنة صلاحية السحب للمتسابقين غير المسجَّلين":"تم سحب صلاحية السحب من اللجنة")}catch(error){input.checked=!enabled;toast(error.message)}finally{input.disabled=false}});$$(`[data-show-score]`).forEach(input=>input.onchange=async()=>{const enabled=input.checked;input.disabled=true;try{await window.CloudCompetition.setCommitteeShowScore(input.dataset.showScore,enabled);toast(enabled?"تم إظهار العلامة للجنة بعد الاعتماد":"تم إخفاء العلامة عن اللجنة بعد الاعتماد")}catch(error){input.checked=!enabled;toast(error.message)}finally{input.disabled=false}});$$(`[data-show-stats]`).forEach(input=>input.onchange=async()=>{const enabled=input.checked;input.disabled=true;try{await window.CloudCompetition.setCommitteeShowStatsSummary(input.dataset.showStats,enabled);toast(enabled?"تم إظهار بطاقة إحصائية اللجنة لها":"تم إخفاء بطاقة إحصائية اللجنة عنها")}catch(error){input.checked=!enabled;toast(error.message)}finally{input.disabled=false}});$$(`[data-toggle-committee]`).forEach(input=>input.onchange=async()=>{const enabled=input.checked;input.disabled=true;input.closest(".committee-row").classList.toggle("inactive",!enabled);try{await window.CloudCompetition.setCommitteeActive(input.dataset.toggleCommittee,enabled)}catch(error){input.checked=!enabled;input.closest(".committee-row").classList.toggle("inactive",!input.checked);toast(error.message)}finally{input.disabled=false}});$$(`[data-delete-committee]`).forEach(button=>button.onclick=async()=>{const id=button.dataset.deleteCommittee,name=button.dataset.committeeName;if(!confirm(`حذف لجنة «${name}» نهائياً؟`))return;button.disabled=true;try{await window.CloudCompetition.deleteCommittee(id);await Promise.all([renderCloudCommittees(),renderActivityLog()]);toast(`تم حذف لجنة ${name}`)}catch(error){if(error.message.includes("اختبارات مسجلة")&&confirm(`لجنة «${name}» لديها اختبارات/نتائج مسجلة (على الأرجح بيانات تجريبية). المتابعة ستحذف اللجنة نهائيًا مع كل اختباراتها وسجل نشاطها بشكل لا رجعة فيه. متابعة؟`)){try{await window.CloudCompetition.deleteCommittee(id,true);await Promise.all([renderCloudCommittees(),renderActivityLog()]);toast(`تم حذف لجنة ${name} وكل اختباراتها وسجل نشاطها نهائيًا`)}catch(innerError){toast(innerError.message);button.disabled=false}}else{toast(error.message);button.disabled=false}}});lucide.createIcons()}catch(error){toast(`تعذر تحميل اللجان: ${error.message}`)}}
function openCommitteeBroadcastModal(presetCommitteeId=null){
  const options=`<option value="">كل اللجان</option>`+cloudCommittees.map(c=>`<option value="${c.id}" ${c.id===presetCommitteeId?"selected":""}>${escapeHtml(c.name)}</option>`).join("");
  openModal(`<div class="modal-head"><h2>إرسال رسالة للجان</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><label>الجهة المستهدفة<select id="broadcastTargetCommittee">${options}</select></label><label>نص الرسالة<textarea id="broadcastText" rows="4" maxlength="300" required placeholder="مثال: تبقّى 10 دقائق على وقت الاستراحة"></textarea></label><p class="field-help">تظهر الرسالة 7 ثوانٍ بمنتصف الشاشة عند اللجنة (أو اللجان) المختارة، لأي عضو فاتح الشاشة حالياً.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="sendCommitteeBroadcastNow" class="primary-btn"><i data-lucide="send"></i> إرسال</button></div>`,"broadcast-modal");
  $("#sendCommitteeBroadcastNow").onclick=()=>{
    const text=$("#broadcastText").value.trim();
    if(!text)return toast("اكتب نص الرسالة أولاً");
    const committeeId=$("#broadcastTargetCommittee").value||null;
    state.broadcast={id:uid("BC"),text,committeeId,createdAt:new Date().toISOString()};
    saveState();
    closeModal();
    toast(committeeId?"تم إرسال الرسالة للجنة المختارة":"تم إرسال الرسالة لكل اللجان");
  };
}
let scoreComparisonRows=[],scoreComparisonCommittees=[];
async function renderScoreComparison(){
  const box=$("#scoreComparisonTable");if(!box)return;
  try{
    const [sessions,committees]=await Promise.all([window.CloudCompetition.listSessions(),window.CloudCompetition.listCommittees()]);
    const committeeById=new Map(committees.map(c=>[c.id,c]));
    scoreComparisonCommittees=committees.filter(c=>c.active!==false).sort((a,b)=>a.name.localeCompare(b.name,"ar"));
    scoreComparisonRows=sessions.filter(session=>session.assessment&&Object.keys(session.assessment).length).map(session=>{
      const participant=state.participants.find(p=>p.id===session.participant_id);
      const committee=committeeById.get(session.committee_id);
      const chairmanDraft=session.assessment?.examinerDrafts?.chairman;
      const memberDraft=session.assessment?.examinerDrafts?.member;
      const chairmanScore=chairmanDraft?calculateAssessment(chairmanDraft).score:null;
      const memberScore=memberDraft?calculateAssessment(memberDraft).score:null;
      const finalScore=Number.isFinite(session.score)?session.score:null;
      return {participantId:session.participant_id,name:participant?.name||session.participant_id,committeeId:session.committee_id||null,committeeName:committee?committeeLabelWithRoles(committee):"—",chairmanScore,memberScore,finalScore};
    }).filter(row=>row.chairmanScore!=null||row.memberScore!=null||row.finalScore!=null);
    populateScoreComparisonCommitteeFilter();
    renderScoreComparisonTable();
    return true;
  }catch(error){box.innerHTML=`<tr><td colspan="5" class="table-empty">تعذر تحميل مقارنة العلامات: ${escapeHtml(error.message)}</td></tr>`}
}
function populateScoreComparisonCommitteeFilter(){
  const select=$("#scoreComparisonCommitteeFilter");if(!select)return;
  const current=select.value;
  const committeeIdsWithRows=new Set(scoreComparisonRows.map(row=>row.committeeId).filter(Boolean));
  const availableCommittees=scoreComparisonCommittees.filter(c=>committeeIdsWithRows.has(c.id));
  select.innerHTML=`<option value="all">اللجنة: الكل</option>`+availableCommittees.map(c=>`<option value="${c.id}">${escapeHtml(committeeLabelWithRoles(c))}</option>`).join("");
  select.value=availableCommittees.some(c=>c.id===current)?current:"all";
}
function filteredScoreComparisonRows(){
  const query=($("#scoreComparisonSearch")?.value||"").trim().toLowerCase();
  const committeeFilter=$("#scoreComparisonCommitteeFilter")?.value||"all";
  return scoreComparisonRows.filter(row=>(!query||row.name.toLowerCase().includes(query))&&(committeeFilter==="all"||row.committeeId===committeeFilter));
}
function renderScoreComparisonTable(){
  const box=$("#scoreComparisonTable");if(!box)return;
  const rows=filteredScoreComparisonRows();
  box.innerHTML=rows.length?rows.map(row=>`<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.committeeName)}</td><td>${row.chairmanScore!=null?formatAssessmentNumber(row.chairmanScore):"—"}</td><td>${row.memberScore!=null?formatAssessmentNumber(row.memberScore):"—"}</td><td>${row.finalScore!=null?formatAssessmentNumber(row.finalScore):"—"}</td><td><button type="button" class="compact-btn danger-compact" data-delete-score-comparison="${row.participantId}" data-name="${escapeAttr(row.name)}"><i data-lucide="trash-2"></i> حذف السجل</button></td></tr>`).join(""):`<tr><td colspan="6" class="table-empty">لا توجد بيانات مطابقة</td></tr>`;
  $$(`[data-delete-score-comparison]`).forEach(button=>button.onclick=async()=>{
    const participantId=button.dataset.deleteScoreComparison,name=button.dataset.name;
    if(!confirm(`حذف سجل اختبار «${name}» نهائياً؟ سيعود المتسابق إلى حالة بانتظار العلامة، ولا يمكن التراجع عن هذا الإجراء.`))return;
    button.disabled=true;
    try{
      await window.CloudCompetition.deleteParticipantSession(participantId);
      const participant=state.participants.find(p=>p.id===participantId);
      if(participant){delete participant.score;delete participant.gradedAt;delete participant.scoreSource;participant.assessment=null;saveState()}
      await renderScoreComparison();renderAll();
      toast(`تم حذف سجل ${name}`)
    }catch(error){toast(error.message);button.disabled=false}
  });
}
// حذف مجمّع لكل السجلات الظاهرة حالياً بالجدول (بعد تطبيق البحث/فلتر اللجنة) — طلب صريح: يمسح
// المعروض فقط، لا كل سجلات المقارنة بغض النظر عن الفلتر.
async function confirmDeleteAllScoreComparisonRows(){
  const rows=filteredScoreComparisonRows();
  if(!rows.length)return toast("لا توجد سجلات مطابقة للفلتر الحالي لحذفها");
  openModal(`<div class="modal-head"><h2>حذف كل السجلات الظاهرة</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سيتم حذف <b>${rows.length} سجل اختبار</b> (حسب البحث/فلتر اللجنة الحالي فقط)، ويعود كل متسابق منهم إلى حالة "بانتظار العلامة".</p><p class="form-error">هذا الإجراء نهائي ولا يمكن التراجع عنه.</p><label>اكتب <b>حذف السجلات</b> للتأكيد<input id="deleteAllScoreComparisonConfirm" autocomplete="off"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="deleteAllScoreComparisonNow" class="danger-btn"><i data-lucide="trash-2"></i> حذف ${rows.length} سجل</button></div>`);
  $("#deleteAllScoreComparisonNow").onclick=async()=>{
    if($("#deleteAllScoreComparisonConfirm").value.trim()!=="حذف السجلات")return toast("اكتب عبارة التأكيد كما تظهر");
    const button=$("#deleteAllScoreComparisonNow");button.disabled=true;button.textContent="جارٍ الحذف...";
    const results=await Promise.allSettled(rows.map(row=>window.CloudCompetition.deleteParticipantSession(row.participantId)));
    let succeeded=0;
    results.forEach((result,index)=>{
      if(result.status!=="fulfilled")return;
      succeeded++;
      const participant=state.participants.find(p=>p.id===rows[index].participantId);
      if(participant){delete participant.score;delete participant.gradedAt;delete participant.scoreSource;participant.assessment=null}
    });
    if(succeeded)saveState();
    closeModal();
    await renderScoreComparison();renderAll();
    const failed=results.length-succeeded;
    toast(failed?`تم حذف ${succeeded} سجل، وتعذر حذف ${failed} سجل`:`تم حذف ${succeeded} سجل بنجاح`);
  };
}
async function exportScoreComparison(){
  if(!scoreComparisonRows.length)return toast("لا توجد بيانات مقارنة لتصديرها");
  try{await ensureXlsx()}catch(error){return toast(error.message)}
  const data=scoreComparisonRows.map(row=>({"المتسابق":row.name,"اللجنة":row.committeeName,"علامة الرئيس":row.chairmanScore!=null?row.chairmanScore:"—","علامة العضو":row.memberScore!=null?row.memberScore:"—","العلامة المعتمدة":row.finalScore!=null?row.finalScore:"—"}));
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(data);
  sheet["!cols"]=[{wch:32},{wch:38},{wch:14},{wch:14},{wch:16}];sheet["!views"]=[{rightToLeft:true}];workbook.Workbook={Views:[{RTL:true}]};
  XLSX.utils.book_append_sheet(workbook,sheet,"مقارنة علامات اللجان");
  XLSX.writeFile(workbook,`مقارنة-علامات-اللجان-${dateStamp()}.xlsx`);
  toast("تم تنزيل ملف مقارنة العلامات");
}
function resetCommitteeForm(){$("#committeeAccountForm").reset();$("#editingCommitteeId").value="";$("#newCommitteePin").required=true;if($("#newCommitteeMemberCode"))delete $("#newCommitteeMemberCode").dataset.existing;toggleCommitteeMemberFields();$("#committeeSubmitLabel").textContent="إضافة اللجنة";$("#cancelCommitteeEdit").classList.add("hidden")}
let cloudSubAdmins=[];
async function renderSubAdmins(){try{cloudSubAdmins=await window.CloudCompetition.listSubAdmins();$("#subAdminsList").innerHTML=cloudSubAdmins.length?cloudSubAdmins.map(admin=>`<div class="committee-row ${admin.active?"":"inactive"}"><div><b>${escapeHtml(admin.name)}</b><small>${admin.gender==="أنثى"?"إناث":"ذكور"} · رمز الدخول: ${escapeHtml(admin.login_code||"—")}</small></div><span></span><div class="row-actions"><button class="compact-btn" data-edit-sub-admin="${admin.id}">تعديل</button><button class="compact-btn ${admin.active?"danger-compact":""}" data-toggle-sub-admin="${admin.id}" data-active="${admin.active}">${admin.active?"تعطيل":"تفعيل"}</button><button class="compact-btn danger-compact" data-delete-sub-admin="${admin.id}" data-sub-admin-name="${escapeAttr(admin.name)}"><i data-lucide="trash-2"></i> حذف</button></div><div class="committee-permissions">${committeePermissionRowHtml("يقدر يعدّل نتائج معتمدة إلكترونيًا","data-sub-admin-final-edit",admin.id,admin.can_edit_final)}${committeePermissionRowHtml("يقدر يحذف متسابقين/سحوبات","data-sub-admin-delete-data",admin.id,admin.can_delete_data)}${committeePermissionRowHtml("يقدر ينقل متسابقين بين اللجان","data-sub-admin-transfer",admin.id,admin.can_transfer_participant)}</div></div>`).join(""):`<div class="committee-empty">لا توجد حسابات مسؤول فرعي بعد.</div>`;$$(`[data-edit-sub-admin]`).forEach(button=>button.onclick=()=>editSubAdmin(button.dataset.editSubAdmin));$$(`[data-toggle-sub-admin]`).forEach(button=>button.onclick=async()=>{button.disabled=true;try{const admin=cloudSubAdmins.find(item=>item.id===button.dataset.toggleSubAdmin);await window.CloudCompetition.saveSubAdmin({id:admin.id,name:admin.name,code:admin.login_code,gender:admin.gender,active:button.dataset.active!=="true"});await renderSubAdmins()}catch(error){toast(error.message)}});$$(`[data-delete-sub-admin]`).forEach(button=>button.onclick=async()=>{const name=button.dataset.subAdminName;if(!confirm(`حذف حساب «${name}» نهائياً؟`))return;button.disabled=true;try{await window.CloudCompetition.deleteSubAdmin(button.dataset.deleteSubAdmin);await renderSubAdmins();toast(`تم حذف حساب ${name}`)}catch(error){toast(error.message);button.disabled=false}});$$(`[data-sub-admin-final-edit]`).forEach(input=>input.onchange=async()=>{const admin=cloudSubAdmins.find(item=>item.id===input.dataset.subAdminFinalEdit);const enabled=input.checked;input.disabled=true;try{await window.CloudCompetition.setSubAdminPermissions(admin.id,enabled,admin.can_delete_data,admin.can_transfer_participant);admin.can_edit_final=enabled;toast(enabled?"تم منح صلاحية تعديل النتائج المعتمدة":"تم سحب صلاحية تعديل النتائج المعتمدة")}catch(error){input.checked=!enabled;toast(error.message)}finally{input.disabled=false}});$$(`[data-sub-admin-delete-data]`).forEach(input=>input.onchange=async()=>{const admin=cloudSubAdmins.find(item=>item.id===input.dataset.subAdminDeleteData);const enabled=input.checked;input.disabled=true;try{await window.CloudCompetition.setSubAdminPermissions(admin.id,admin.can_edit_final,enabled,admin.can_transfer_participant);admin.can_delete_data=enabled;toast(enabled?"تم منح صلاحية حذف المتسابقين/السحوبات":"تم سحب صلاحية الحذف")}catch(error){input.checked=!enabled;toast(error.message)}finally{input.disabled=false}});$$(`[data-sub-admin-transfer]`).forEach(input=>input.onchange=async()=>{const admin=cloudSubAdmins.find(item=>item.id===input.dataset.subAdminTransfer);const enabled=input.checked;input.disabled=true;try{await window.CloudCompetition.setSubAdminPermissions(admin.id,admin.can_edit_final,admin.can_delete_data,enabled);admin.can_transfer_participant=enabled;toast(enabled?"تم منح صلاحية نقل المتسابقين بين اللجان":"تم سحب صلاحية النقل")}catch(error){input.checked=!enabled;toast(error.message)}finally{input.disabled=false}});lucide.createIcons()}catch(error){toast(`تعذر تحميل حسابات المسؤول الفرعي: ${error.message}`)}}
function resetSubAdminForm(){$("#subAdminAccountForm").reset();$("#editingSubAdminId").value="";$("#newSubAdminPin").required=true;$("#subAdminSubmitLabel").textContent="إضافة الحساب";$("#cancelSubAdminEdit").classList.add("hidden")}
function editSubAdmin(id){const admin=cloudSubAdmins.find(item=>item.id===id);if(!admin)return;$("#editingSubAdminId").value=admin.id;$("#newSubAdminName").value=admin.name;$("#newSubAdminGender").value=admin.gender;$("#newSubAdminCode").value=admin.login_code||"";$("#newSubAdminPin").value="";$("#newSubAdminPin").required=false;$("#subAdminSubmitLabel").textContent="حفظ التعديل";$("#cancelSubAdminEdit").classList.remove("hidden");$("#newSubAdminName").focus()}
let cloudSupervisors=[];
async function renderSupervisors(){try{cloudSupervisors=await window.CloudCompetition.listSupervisors();$("#supervisorsList").innerHTML=cloudSupervisors.length?cloudSupervisors.map(supervisor=>`<div class="committee-row"><div><b>${escapeHtml(supervisor.display_name)}</b><small>UID: ${escapeHtml(supervisor.id)}</small>${supervisor.can_edit_final?`<small class="permission-on">يقدر يعدّل نتائج معتمدة</small>`:""}${supervisor.can_delete_data?`<small class="permission-on">يقدر يحذف متسابقين/سحوبات</small>`:""}${supervisor.can_transfer_participant?`<small class="permission-on">يقدر ينقل متسابقين بين اللجان</small>`:""}</div><span></span><div class="row-actions"><button class="compact-btn" data-edit-supervisor="${supervisor.id}">تعديل</button><button class="compact-btn danger-compact" data-delete-supervisor="${supervisor.id}" data-supervisor-name="${escapeAttr(supervisor.display_name)}"><i data-lucide="trash-2"></i> إلغاء الربط</button></div></div>`).join(""):`<div class="committee-empty">لا توجد حسابات مشرفين بعد.</div>`;$$(`[data-edit-supervisor]`).forEach(button=>button.onclick=()=>editSupervisor(button.dataset.editSupervisor));$$(`[data-delete-supervisor]`).forEach(button=>button.onclick=async()=>{const name=button.dataset.supervisorName;if(!confirm(`إلغاء ربط حساب «${name}» كمشرف مسابقة؟ يقدر يُربط من جديد لاحقًا بنفس الـ UID.`))return;button.disabled=true;try{await window.CloudCompetition.unlinkSupervisor(button.dataset.deleteSupervisor);await renderSupervisors();toast(`تم إلغاء ربط ${name}`)}catch(error){toast(error.message);button.disabled=false}});lucide.createIcons()}catch(error){toast(`تعذر تحميل حسابات المشرفين: ${error.message}`)}}
function resetSupervisorForm(){$("#supervisorAccountForm").reset();$("#editingSupervisorId").value="";$("#newSupervisorUid").disabled=false;$("#supervisorSubmitLabel").textContent="ربط الحساب";$("#cancelSupervisorEdit").classList.add("hidden")}
function editSupervisor(id){const supervisor=cloudSupervisors.find(item=>item.id===id);if(!supervisor)return;$("#editingSupervisorId").value=supervisor.id;$("#newSupervisorUid").value=supervisor.id;$("#newSupervisorUid").disabled=true;$("#newSupervisorName").value=supervisor.display_name;$("#newSupervisorCanEditFinal").checked=Boolean(supervisor.can_edit_final);$("#newSupervisorCanDeleteData").checked=Boolean(supervisor.can_delete_data);$("#newSupervisorCanTransferParticipant").checked=Boolean(supervisor.can_transfer_participant);$("#supervisorSubmitLabel").textContent="حفظ التعديل";$("#cancelSupervisorEdit").classList.remove("hidden");$("#newSupervisorName").focus()}
async function saveSupervisorAccount(event){event.preventDefault();const id=$("#editingSupervisorId").value||null,userId=id||$("#newSupervisorUid").value.trim(),name=$("#newSupervisorName").value.trim(),canEditFinal=$("#newSupervisorCanEditFinal").checked,canDeleteData=$("#newSupervisorCanDeleteData").checked,canTransferParticipant=$("#newSupervisorCanTransferParticipant").checked,button=event.submitter;if(!userId)return toast("أدخل معرّف المستخدم (UID) من لوحة Supabase");if(!name)return toast("أدخل اسم المشرف");button.disabled=true;try{await window.CloudCompetition.linkSupervisor({userId,name,canEditFinal,canDeleteData,canTransferParticipant});resetSupervisorForm();await renderSupervisors();toast("تم حفظ حساب مشرف المسابقة")}catch(error){toast(`تعذر حفظ الحساب: ${error.message}`)}finally{button.disabled=false}}
let activityLogEntries=[];
function activityLogActorOf(entry){const details=entry.details||{};return details.supervisor_name?`مشرف المسابقة: ${details.supervisor_name}`:details.sub_admin_name?`مسؤول فرعي: ${details.sub_admin_name}`:details.committee_name?`لجنة: ${details.committee_name}`:"الإدارة"}
async function renderActivityLog(){
  try{
    activityLogEntries=await window.CloudCompetition.listActivityLog(150);
    const filterSelect=$("#activityLogFilter"),previousChoice=filterSelect?.value||"all";
    const actors=[...new Set(activityLogEntries.map(activityLogActorOf))].sort((a,b)=>a.localeCompare(b,"ar"));
    if(filterSelect){filterSelect.innerHTML=`<option value="all">الكل</option>${actors.map(actor=>`<option value="${escapeAttr(actor)}">${escapeHtml(actor)}</option>`).join("")}`;filterSelect.value=actors.includes(previousChoice)?previousChoice:"all"}
    renderActivityLogList();
    return true;
  }catch(error){$("#activityLogList").innerHTML=`<p class="form-error">تعذر تحميل سجل النشاط: ${escapeHtml(error.message)}</p>`}
}
function renderActivityLogList(){
  const labels={create_committee:"إنشاء لجنة",update_committee:"تعديل لجنة",delete_committee:"حذف لجنة",activate_committee:"تفعيل لجنة",deactivate_committee:"تعطيل لجنة",create_sub_admin:"إنشاء حساب مسؤول فرعي",update_sub_admin:"تعديل حساب مسؤول فرعي",delete_sub_admin:"حذف حساب مسؤول فرعي",link_supervisor:"ربط حساب مشرف مسابقة",unlink_supervisor:"إلغاء ربط حساب مشرف مسابقة",assign_participant_to_committee:"نقل متسابق للجنة",unassign_participant_from_committee:"إلغاء نقل متسابق",transfer_participant:"نقل متسابق بين اللجان",sub_admin_save_participants:"حفظ بيانات متسابقين (مسؤول فرعي)",sub_admin_draw:"سحب موضع (مسؤول فرعي)",admin_draw:"سحب موضع (الإدارة)",supervisor_draw:"سحب موضع (مشرف المسابقة)",committee_draw:"سحب موضع (لجنة)",committee_change_parts:"تعديل أجزاء متسابق (لجنة)",replace_exam_position:"تغيير موضع أثناء الاختبار",grant_final_edit:"منح صلاحية تعديل النتائج",revoke_final_edit:"سحب صلاحية تعديل النتائج",grant_self_draw:"منح صلاحية السحب للجنة",revoke_self_draw:"سحب صلاحية السحب من اللجنة",show_committee_score:"إظهار العلامة للجنة",hide_committee_score:"إخفاء العلامة عن اللجنة",reopen_final_result:"فتح نتيجة معتمدة للتعديل",revise_final_result:"إعادة اعتماد نتيجة معدلة",finalize:"اعتماد نتيجة",save_examiner_draft:"حفظ مسودة تقييم"};
  const chosen=$("#activityLogFilter")?.value||"all";
  const entries=chosen==="all"?activityLogEntries:activityLogEntries.filter(entry=>activityLogActorOf(entry)===chosen);
  $("#activityLogList").innerHTML=entries.length?entries.map(entry=>{
    const participant=entry.entity_type==="participant"?state.participants.find(p=>p.id===entry.entity_id):null;
    const who=activityLogActorOf(entry);
    const subject=participant?` · ${participant.name}`:"";
    return `<article><div><b>${labels[entry.action]||entry.action}${escapeHtml(subject)}</b><span>${escapeHtml(who)}</span></div><small>${formatDate(entry.created_at)}</small></article>`;
  }).join(""):`<p class="committee-alerts-empty">لا يوجد نشاط مطابق للفلترة.</p>`;
}
async function saveSubAdminAccount(event){event.preventDefault();const id=$("#editingSubAdminId").value||null,name=$("#newSubAdminName").value.trim(),gender=$("#newSubAdminGender").value,code=$("#newSubAdminCode").value.trim(),pin=$("#newSubAdminPin").value,button=event.submitter;if(!gender)return toast("اختر جنس الحساب");if(!id&&pin.length<4)return toast("أدخل PIN من 4 خانات على الأقل");button.disabled=true;try{await window.CloudCompetition.saveSubAdmin({id,name,code,pin,gender});resetSubAdminForm();await renderSubAdmins();toast("تم حفظ حساب المسؤول الفرعي")}catch(error){toast(`تعذر حفظ الحساب: ${error.message}`)}finally{button.disabled=false}}
function editCommittee(id){const committee=cloudCommittees.find(item=>item.id===id);if(!committee)return;ensureCommitteeMemberFields();renderCommitteeLevelOptions();$("#editingCommitteeId").value=committee.id;$("#newCommitteeName").value=committee.name;$("#newCommitteeGender").value=committee.responsible_gender||"";$("#newCommitteeChairmanName").value=committee.chairman_name||"";$("#newCommitteeCode").value=committee.login_code||"";$("#newCommitteePin").value="";$("#newCommitteePin").required=false;$("#enableCommitteeMember").checked=Boolean(committee.member_login_code);$("#newCommitteeMemberName").value=committee.member_name||"";$("#newCommitteeMemberCode").value=committee.member_login_code||`${committee.login_code||"L"}-M`;$("#newCommitteeMemberCode").dataset.existing=committee.member_login_code||"";$("#newCommitteeMemberPin").value="";const hasLevelNames=(committee.level_names||[]).length>0;$$(`[name="committeeLevel"]`).forEach(input=>{const entry=levelCatalogById(input.value);input.checked=hasLevelNames?(committee.level_names||[]).includes(entry?.label):(committee.levels||[]).includes(entry?.parts)});if(!hasLevelNames&&(committee.levels||[]).length)toast("هذه لجنة قديمة بلا أسماء مستويات محددة؛ راجع الاختيار أدناه ثم احفظ لتحديثها للنظام الجديد");toggleCommitteeMemberFields();$("#committeeSubmitLabel").textContent="حفظ التعديل";$("#cancelCommitteeEdit").classList.remove("hidden");$("#newCommitteeName").focus()}
async function linkCommitteeAccount(event){event.preventDefault();ensureCommitteeMemberFields();const levelNames=$$(`[name="committeeLevel"]`).filter(input=>input.checked).map(input=>levelCatalogById(input.value)?.label).filter(Boolean),id=$("#editingCommitteeId").value||null,name=$("#newCommitteeName").value.trim(),responsibleGender=$("#newCommitteeGender").value,chairmanName=$("#newCommitteeChairmanName").value.trim(),code=$("#newCommitteeCode").value.trim(),pin=$("#newCommitteePin").value,memberEnabled=$("#enableCommitteeMember").checked,memberName=memberEnabled?$("#newCommitteeMemberName").value.trim():"",memberCode=memberEnabled?$("#newCommitteeMemberCode").value.trim():"",memberPin=memberEnabled?$("#newCommitteeMemberPin").value:"",button=event.submitter;if(!responsibleGender)return toast("اختر الجنس الذي تُشرف عليه اللجنة");if(!chairmanName)return toast("أدخل اسم رئيس اللجنة");if(!levelNames.length)return toast("اختر مستوى واحداً على الأقل");if(!id&&pin.length<4)return toast("أدخل PIN للرئيس من 4 خانات على الأقل");if(memberEnabled&&!memberName)return toast("أدخل اسم عضو اللجنة");if(memberEnabled&&!id&&memberPin.length<4)return toast("أدخل PIN للعضو من 4 خانات على الأقل");if(memberEnabled&&code.toLowerCase()===memberCode.toLowerCase())return toast("يجب أن يختلف رمز الرئيس عن رمز العضو");button.disabled=true;try{await window.CloudCompetition.saveCommittee({id,name,chairmanName,code,pin,memberName,memberCode,memberPin,responsibleGender,levelNames});resetCommitteeForm();await renderCloudCommittees();toast(memberEnabled?"تم حفظ حسابي الرئيس والعضو":"تم حفظ اللجنة بحساب الرئيس فقط");
    // بعد التعديل نمرّر النظر ونومض صف اللجنة المعدَّلة بالقائمة كتأكيد بصري (النموذج نفسه يُفرَّغ).
    if(id){const row=document.querySelector(`[data-committee-row="${CSS.escape(id)}"]`);if(row){row.scrollIntoView({behavior:"smooth",block:"center"});row.classList.add("just-saved");setTimeout(()=>row.classList.remove("just-saved"),1600)}}
  }catch(error){toast(`تعذر حفظ اللجنة: ${error.message}`)}finally{button.disabled=false}}
function applySubAdminRestrictions(){$("#deleteAllParticipantsBtn")?.classList.toggle("hidden",!window.CloudCompetition.context?.subAdmin?.can_delete_data);$(`[data-view="settings"]`)?.classList.add("hidden");$(`[data-view="examDuration"]`)?.classList.add("hidden");$("#importParticipantsBtn")?.classList.add("hidden");$("#scoreComparisonPanel")?.classList.add("hidden")}
function applySupervisorRestrictions(){$("#deleteAllParticipantsBtn")?.classList.add("hidden");$("#rootOnlySettingsGrid")?.classList.add("hidden")}
function resetSubAdminRestrictions(){$("#deleteAllParticipantsBtn")?.classList.remove("hidden");$(`[data-view="settings"]`)?.classList.remove("hidden");$(`[data-view="examDuration"]`)?.classList.remove("hidden");$("#importParticipantsBtn")?.classList.remove("hidden");$("#rootOnlySettingsGrid")?.classList.remove("hidden");$("#scoreComparisonPanel")?.classList.remove("hidden")}
async function enterCloudContext(context){try{operationMode="cloud";stopCommitteeAutoRefresh();
  if(context.profile.role==="subAdmin"){
    const remote=await window.CloudCompetition.loadCompetitionState();
    state={...defaultState(),config:remote.payload?.config||{competitionName:"منصة المسابقة",adminName:context.subAdmin.name},participants:remote.payload?.participants||[],draws:remote.payload?.draws||[]};
    subAdminCommittees=remote.payload?.committees||[];
    window.CloudCompetition.markSubAdminKnownIds(state.participants.map(p=>p.id));
    setAdminTheme(context.subAdmin.gender==="أنثى"?"rose":"green");
    const greeting=$("#topAdminGreeting");if(greeting)greeting.textContent=`أهلاً، ${context.subAdmin.name}`;
    applySubAdminRestrictions();
    showApp();
    return;
  }
  resetSubAdminRestrictions();
  if(!["admin","supervisor"].includes(context.profile.role)){setAdminTheme(context.committee?.responsibleGender==="أنثى"?"rose":"green");$("#app").classList.add("hidden");showScreen("committeeApp");setCommitteeTrack("annual");await renderCommitteeWorkspace();startCommitteeAutoRefresh();return}
  const isSupervisor=context.profile.role==="supervisor";
  setAdminTheme("green");
  const [remote,sessions,committees]=await Promise.all([window.CloudCompetition.loadCompetitionState(),window.CloudCompetition.listFinalSessions(),window.CloudCompetition.listCommittees()]);
  if(remote.payload?.config){state={...defaultState(),...remote.payload};if(!isSupervisor){safeSetItem(CLOUD_STORAGE_KEY,JSON.stringify(state));lastAdminStateUpdatedAt=remote.updated_at||null}}
  else if(!isSupervisor&&state.config){await window.CloudCompetition.saveCompetitionState(state)}
  if(!isSupervisor&&!state.config){showScreen("setupScreen");return}
  if(isSupervisor){window.CloudCompetition.markSupervisorKnownIds(state.participants,state.draws);applySupervisorRestrictions()}
  else window.CloudCompetition.markAdminKnownIds(state.participants,state.draws);
  cloudCommittees=committees;
  mergeFinalSessionsIntoState(sessions,committees);
  const greeting=$("#topAdminGreeting");if(greeting)greeting.textContent=context.profile.display_name?`أهلاً، ${context.profile.display_name}`:"الدورة الحالية";
  showApp()}catch(error){toast(`تعذر فتح البيانات المشتركة: ${error.message}`);showScreen("cloudLoginScreen")}}
// الانسحاب أقوى من أي علامة: المنسحب علامته صفر دائماً مهما كانت علامة جلسة لجنته المعتمدة
// (كانت المزامنة الدورية ترجّع 100 فوق الصفر لمنسحبة سبق اعتماد اختبارها). تُصلح أيضاً السجلات
// القديمة المتضررة. ترجع true إذا عدّلت شيئاً (المستدعي يقرر الحفظ).
function enforceWithdrawnZeroScore(participants){let changed=false;(participants||[]).forEach(p=>{if(p?.withdrawn&&(p.score!==0||p.scoreSource!=="withdrawn"||p.assessment)){p.score=0;p.scoreSource="withdrawn";p.assessment=null;p.gradedAt=p.gradedAt||new Date().toISOString();delete p.drRequest;changed=true}});return changed}
function mergeFinalSessionsIntoState(sessions,committees,{replace=true}={}){
  // replace=false (استطلاع الإدارة الدوري المُقيَّد بآخر LIVE_RECENT_WINDOW_MS): ندمج (upsert)
  // فوق committeeSessions المحفوظة بدل استبدالها بالكامل، حتى لا تُمحى الجلسات الأقدم من 12 ساعة.
  committeeSessions=replace?sessions:(()=>{const byId=new Map(committeeSessions.map(item=>[item.id,item]));sessions.forEach(item=>byId.set(item.id,item));return [...byId.values()]})();
  const committeeById=new Map(committees.map(item=>[item.id,item]));let changed=false;committeeSessions.filter(session=>session.status==="final").forEach(session=>{const participant=state.participants.find(item=>item.id===session.participant_id);if(!participant||participant.withdrawn)return;
    // حماية تعديل الإدارة اليدوي: بدون هذا الفحص كان الاستطلاع الدوري يرجّع العلامة الإلكترونية
    // القديمة فوق أي تعديل يدوي خلال ثوانٍ. نتجاهل الجلسة إذا كانت العلامة الحالية يدوية وأحدث من
    // (أو تساوي) آخر اعتماد — تُطبَّق النسخة الإلكترونية تلقائياً فقط لو صدر اعتماد جديد فعلاً بعدها.
    const sessionFinalizedAt=session.finalized_at||session.updated_at;
    if(participant.scoreSource==="manual"&&sessionFinalizedAt&&participant.gradedAt&&new Date(participant.gradedAt)>=new Date(sessionFinalizedAt))return;
    const assessment={...(session.assessment||{})};const committee=committeeById.get(session.committee_id);if(committee){if(!assessment.committeeName)assessment.committeeName=committee.name;if(!assessment.committeeChairmanName&&committee.chairman_name)assessment.committeeChairmanName=committee.chairman_name;if(!assessment.committeeMemberName&&committee.member_name)assessment.committeeMemberName=committee.member_name;
      // تعبئة رجعية لجلسات اعتُمدت قبل إضافة هذا الحقل — بدونها تعتمد إحصائيات اللجنة على المستوى
      // الحالي للمتسابق بدل من امتحنه فعلياً، فتختلف كل ما يُنقل متسابقون بين اللجان.
      if(!assessment.committee)assessment.committee={id:committee.id,name:committee.name}}if(participant.score!==Number(session.score)||participant.assessment?.updatedAt!==assessment.updatedAt||participant.assessment?.committeeName!==assessment.committeeName||participant.assessment?.committeeChairmanName!==assessment.committeeChairmanName||participant.assessment?.committeeMemberName!==assessment.committeeMemberName||participant.assessment?.committee?.id!==assessment.committee?.id){participant.score=Number(session.score);participant.gradedAt=session.finalized_at;participant.scoreSource="electronic";participant.assessment=assessment;changed=true}});if(enforceWithdrawnZeroScore(state.participants))changed=true;if(changed)saveState();return changed}
async function syncFinalSessionsIntoState(){const [sessions,committees]=await Promise.all([window.CloudCompetition.listFinalSessions(),window.CloudCompetition.listCommittees()]);return mergeFinalSessionsIntoState(sessions,committees)}
// رسالة تبثّها الإدارة لكل اللجان أو للجنة محدَّدة، تظهر 7 ثوانٍ بمنتصف شاشة اللجنة — مخزّنة
// كحقل broadcast{id,text,committeeId,createdAt} أعلى مستوى competition_state.payload.
// committeeId=null يعني كل اللجان. كل لجنة تحفظ محلياً آخر معرّف رسالة عرضته لتفادي التكرار.
let committeeBroadcastTimer=null;
function committeeBroadcastSeenKey(){return `competition-committee-broadcast-seen-${window.CloudCompetition.context?.committee?.id||"unknown"}`}
function checkCommitteeBroadcast(payload){
  const broadcast=payload?.broadcast,committee=window.CloudCompetition.context?.committee;
  if(!broadcast?.id||!committee)return;
  if(broadcast.committeeId&&broadcast.committeeId!==committee.id)return;
  // رسالة أقدم من 5 دقائق لا تظهر لجهاز يدخل من جديد — البث تنبيه "الآن" فقط، لا سجل معلَّق.
  if(!broadcast.createdAt||Date.now()-new Date(broadcast.createdAt).getTime()>5*60*1000)return;
  const key=committeeBroadcastSeenKey();
  if(localStorage.getItem(key)===broadcast.id)return;
  safeSetItem(key,broadcast.id);
  showCommitteeBroadcast(broadcast.text);
}
function showCommitteeBroadcast(text){
  const overlay=$("#committeeBroadcastOverlay");if(!overlay)return;
  $("#committeeBroadcastText").textContent=text;
  overlay.classList.remove("hidden");
  lucide.createIcons();
  clearTimeout(committeeBroadcastTimer);
  committeeBroadcastTimer=setTimeout(dismissCommitteeBroadcast,7000);
}
function dismissCommitteeBroadcast(){clearTimeout(committeeBroadcastTimer);$("#committeeBroadcastOverlay")?.classList.add("hidden")}
async function renderCommitteeWorkspace(){let context=window.CloudCompetition.context;if(!context?.committee)return;try{await window.CloudCompetition.refreshCommitteeAccess(true);context=window.CloudCompetition.context;const examinerName=context.committee.examiner_role==="member"?context.committee.memberName:context.committee.chairmanName;$("#committeeExaminerGreeting").textContent=examinerName?`أهلاً، ${examinerName}`:context.committee.name;$("#committeeName").textContent=`لجنة: ${context.committee.name}`;const levelNamesLabel=(context.committee.levelNames||[]).join("، ")||`${(context.committee.levels||[]).sort((a,b)=>a-b).join("، ")} أجزاء`,genderLabel=context.committee.responsibleGender==="أنثى"?"إناث":context.committee.responsibleGender==="ذكر"?"ذكور":"";$("#committeeLevels").textContent=`${genderLabel?genderLabel+" · ":""}${levelNamesLabel}`;const [remote,sessions]=await Promise.all([window.CloudCompetition.loadCompetitionState(),window.CloudCompetition.listSessions()]);checkCommitteeBroadcast(remote.payload);if(remote.payload?.config){const previous=loadCommitteeSnapshot(),next=committeeScopedState(remote.payload),previousById=new Map(previous.participants.map(item=>[item.id,item])),nextById=new Map(next.participants.map(item=>[item.id,item])),previousDraws=new Map(previous.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw])),nextDraws=new Map(next.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw]));if(previous.config){const updates=[];for(const participant of next.participants){const old=previousById.get(participant.id);if(!old||participantCloudSignature(old,previousDraws.get(participant.id))!==participantCloudSignature(participant,nextDraws.get(participant.id)))updates.push({text:describeCommitteeChange(participant,old),participantId:participant.id})}for(const old of previous.participants)if(!nextById.has(old.id))updates.push({text:describeCommitteeChange(null,old),participantId:old.id});if(updates.length)addCommitteeAlerts(await withRealChangeTimes(updates))}if($("#modal")?.classList.contains("hidden"))state=next;else console.warn("[examTrace] renderCommitteeWorkspace: تم فتح مودال أثناء انتظار الشبكة، تم تجاهل الاستبدال");saveCommitteeSnapshot(state)}committeeSessions=sessions;await syncServerCommitteeNotifications();renderCommitteeAlerts();renderCommitteeStudents();lucide.createIcons();prewarmQuranData();return true}catch(error){toast(`تعذر تحديث قائمة اللجنة: ${error.message}`)}}
function stopCommitteeAutoRefresh(){if(committeeAutoRefreshTimer)clearInterval(committeeAutoRefreshTimer);committeeAutoRefreshTimer=null;committeeRefreshBusy=false}
function startCommitteeAutoRefresh(){stopAdminAutoRefresh();stopCommitteeAutoRefresh();committeeAutoRefreshTimer=setInterval(()=>{if(!document.hidden){refreshCommitteeChanges();refreshDiwanCommitteeQuietly()}},9000)}
function stopAdminAutoRefresh(){if(adminAutoRefreshTimer)clearInterval(adminAutoRefreshTimer);adminAutoRefreshTimer=null;adminRefreshBusy=false}
function startAdminAutoRefresh(){stopAdminAutoRefresh();if(!liveAutoRefreshEnabled())return;adminAutoRefreshTimer=setInterval(()=>{if(!document.hidden){refreshAdminChanges();refreshDiwanResultsQuietly()}},9000)}
// نتحقق أولاً من توقيت آخر تعديل (competition_state_version) قبل أي تنزيل كامل — لو لم يتغيّر
// شيء، نتجنّب تنزيل/استبدال الحالة كاملة (كانت تتكرر كل 9 ثوانٍ بلا داعٍ). تدهور آمن تلقائي لو
// الدالة غير مطبَّقة بعد (getStateVersion ترجع null). ندمج أي نتيجة نهائية اعتمدتها لجنة رغم ذلك.
async function refreshAdminChanges(){const kind=window.CloudCompetition.context?.kind;if(adminRefreshBusy||!["admin","supervisor"].includes(kind)||!$("#modal")?.classList.contains("hidden"))return;adminRefreshBusy=true;try{const version=await window.CloudCompetition.getStateVersion?.();const skipFetch=version!=null&&version===lastAdminStateUpdatedAt;const [remote,sessions,committees]=await Promise.all([skipFetch?Promise.resolve(null):window.CloudCompetition.loadCompetitionState(),window.CloudCompetition.listRecentFinalSessions(new Date(Date.now()-LIVE_RECENT_WINDOW_MS).toISOString()),window.CloudCompetition.listCommittees()]);cloudCommittees=committees;if(!skipFetch&&!remote.payload?.config)return;if(!$("#modal")?.classList.contains("hidden")){console.warn("[examTrace] refreshAdminChanges: تم فتح مودال أثناء انتظار الشبكة، تم تجاهل الاستبدال");return}let stateChanged;const unchanged=skipFetch||(kind==="admin"&&remote.updated_at&&remote.updated_at===lastAdminStateUpdatedAt);if(unchanged){stateChanged=mergeFinalSessionsIntoState(sessions,committees,{replace:false})}else{const previous=JSON.stringify({participants:state.participants,draws:state.draws});if(kind==="supervisor"){state={...defaultState(),config:remote.payload.config?.competitionName?{competitionName:remote.payload.config.competitionName,adminName:state.config?.adminName}:state.config,participants:remote.payload.participants||[],draws:remote.payload.draws||[]};window.CloudCompetition.markSupervisorKnownIds(state.participants,state.draws)}else{state={...defaultState(),...remote.payload};window.CloudCompetition.markAdminKnownIds(state.participants,state.draws);safeSetItem(CLOUD_STORAGE_KEY,JSON.stringify(state))}lastAdminStateUpdatedAt=version??remote.updated_at??null;mergeFinalSessionsIntoState(sessions,committees,{replace:false});stateChanged=previous!==JSON.stringify({participants:state.participants,draws:state.draws})}if(stateChanged)renderAll()}catch(error){console.warn("Admin auto refresh failed",error)}finally{adminRefreshBusy=false}}
function participantCloudSignature(participant,draw){return JSON.stringify({level:Number(participant?.level)||0,parts:(participant?.parts||[]).map(Number).sort((a,b)=>a-b),drawId:draw?.id||null,eligibleParts:(draw?.eligibleParts||[]).map(Number).sort((a,b)=>a-b),positions:(draw?.positions||[]).map(item=>item.id)})}
function committeeScopedState(payload){
  const merged={...defaultState(),...payload};
  const committee=window.CloudCompetition.context?.committee;
  if(!committee)return merged;
  const levelNames=committee.levelNames||[],levels=(committee.levels||[]).map(Number);
  const participants=merged.participants.filter(participant=>{
    // متسابق امتحنته هذه اللجنة فعلياً يضل ظاهراً عندها دائماً، حتى لو تغيّرت مستويات اللجنة بعدين.
    if(participant.assessment?.committee?.id===committee.id)return true;
    if(committee.responsibleGender&&participant.gender&&participant.gender!==committee.responsibleGender)return false;
    if(participant.transferCommitteeId)return participant.transferCommitteeId===committee.id;
    if(participant.levelName)return levelNames.includes(participant.levelName);
    return levels.includes(Number(participant.level));
  });
  const participantIds=new Set(participants.map(item=>item.id));
  return {...merged,participants,draws:merged.draws.filter(draw=>participantIds.has(draw.participantId))};
}
function committeeStateKey(){return `competition-committee-state-${window.CloudCompetition.context?.committee?.id||"unknown"}`}
function loadCommitteeSnapshot(){try{return {...defaultState(),...JSON.parse(localStorage.getItem(committeeStateKey())||"null")}}catch{return defaultState()}}
function saveCommitteeSnapshot(value){safeSetItem(committeeStateKey(),JSON.stringify(value))}
function describeCommitteeChange(current,previous){if(current&&previous&&Number(current.level)!==Number(previous.level))return `تم تغيير مستوى المتسابق ${current.name}: من ${previous.level} إلى ${current.level} أجزاء`;if(current&&!previous)return `تمت إضافة المتسابق إلى لجنتكم: ${current.name} (${current.level} أجزاء)`;if(!current&&previous)return `لم يعد المتسابق ${previous.name} ضمن لجنتكم (نُقل إلى لجنة أخرى أو تغيّر مستواه)`;return `تم تحديث بيانات المتسابق: ${current?.name||previous?.name}`}
// إيقاف الاستطلاع طالما أي مودال مفتوح (تماماً كجهاز الإدارة): بدونه، حفظ مسودة أثناء اختبار
// جارٍ كان "يكتشف تغييراً" ويستبدل state.participants بنسخة لا تعرف بالتقييم الجاري، فيُعاد
// بناء تقييم شبه فارغ عند الاعتماد لاحقاً (خصم/علامة خاطئة رغم ظهورها صحيحة أثناء التسجيل).
// نفس فحص التوقيت الخفيف بـrefreshAdminChanges — أجهزة اللجان أكثر ما تستفيد منه (أضعف وأكثر
// عدداً). لو لم يتغيّر شيء نتجنّب تنزيل الحمولة الكاملة (nextState=previousState)، وتبقى فقط
// جلسات الاختبار الحية تُفحص كل مرة (تتغيّر مستقلة عن بيانات المتسابقين).
async function refreshCommitteeChanges(){if(committeeRefreshBusy||window.CloudCompetition.context?.kind!=="committee"||!$("#modal")?.classList.contains("hidden"))return;committeeRefreshBusy=true;try{await window.CloudCompetition.refreshCommitteeAccess();const committee=window.CloudCompetition.context?.committee;const version=await window.CloudCompetition.getStateVersion?.();const skipFetch=version!=null&&version===lastCommitteeStateVersion;const [remote,sessions]=await Promise.all([skipFetch?Promise.resolve(null):window.CloudCompetition.loadCompetitionState(),window.CloudCompetition.listLiveCommitteeSessions(new Date(Date.now()-LIVE_RECENT_WINDOW_MS).toISOString())]);checkCommitteeBroadcast(skipFetch?state:remote.payload);if(!skipFetch&&(!remote.payload?.config||!committee))return;if(skipFetch&&!committee)return;if(!skipFetch)lastCommitteeStateVersion=version??lastCommitteeStateVersion;const previousState=state,nextState=skipFetch?previousState:committeeScopedState(remote.payload,committee),previousById=new Map(previousState.participants.map(item=>[item.id,item])),nextById=new Map(nextState.participants.map(item=>[item.id,item])),previousDraws=new Map(previousState.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw])),nextDraws=new Map(nextState.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw])),changed=skipFetch?[]:nextState.participants.filter(participant=>{const previous=previousById.get(participant.id);return !previous||participantCloudSignature(previous,previousDraws.get(participant.id))!==participantCloudSignature(participant,nextDraws.get(participant.id))}),removed=skipFetch?[]:previousState.participants.filter(previous=>!nextById.has(previous.id));
  // نقارن توقيع الجلسات أيضاً (لا بس المتسابقين): بدء/اعتماد اختبار لا يغيّر بيانات المتسابق نفسه.
  const sessionsSignature=sessions.map(s=>`${s.id}:${s.status}:${s.updated_at}`).sort().join("|"),sessionsChanged=sessionsSignature!==committeeSessionsSignature;
  if(!changed.length&&!removed.length&&!sessionsChanged)return;
  // إعادة فحص "مودال مفتوح" هون تحديداً: الفحص الأول بأول الدالة لا يوقف استطلاعاً كان قد بدأ
  // قبل فتح شاشة الاختبار وانتهى بعدها — نفس خلل "العلامة رجعت 100" من زاوية توقيت مختلفة.
  // لو انفتح المودال أثناء انتظار الشبكة، نتجاهل النتيجة بالكامل (الاستطلاع التالي يكتشفها بأمان).
  if(!$("#modal")?.classList.contains("hidden")){console.warn("[examTrace] refreshCommitteeChanges: تم فتح مودال أثناء انتظار الشبكة، تم تجاهل الاستبدال لتفادي فقدان تقييم جارٍ");return}
  committeeSessionsSignature=sessionsSignature;
  state=nextState;saveCommitteeSnapshot(state);
  // sessions مُقيَّدة بآخر LIVE_RECENT_WINDOW_MS فقط — ندمج (upsert) فوق committeeSessions
  // الحالية بدل استبدالها، حتى تبقى الجلسات الأقدم من 12 ساعة ظاهرة بعلامتها الصحيحة. نستبعد فقط
  // جلسة متسابق خرج من نطاق اللجنة، أو انسحبت بلا اختبار حقيقي فعلاً (علامتها ليست > صفر).
  committeeSessions=(()=>{const byId=new Map(committeeSessions.map(item=>[item.id,item]));sessions.forEach(item=>byId.set(item.id,item));return [...byId.values()].filter(item=>{const participant=nextById.get(item.participant_id);if(!participant)return false;return !participant.withdrawn})})();
  const activeParticipantId=activeCloudSession?.participant_id;if(activeParticipantId&&!nextDraws.has(activeParticipantId)){closeModal();activeCloudSession=null}
  if(changed.length||removed.length){const updates=await withRealChangeTimes(changed.map(item=>{const previous=previousById.get(item.id);return {text:describeCommitteeChange(item,previous),participantId:item.id}}).concat(removed.map(item=>({text:describeCommitteeChange(null,item),participantId:item.id}))));addCommitteeAlerts(updates);const names=[...changed,...removed].map(item=>item.name).filter(Boolean);toast(names.length===1?updates[0].text:`تم تحديث بيانات ${names.length} طلاب تخص لجنتكم`)}
  renderCommitteeStudents();
}catch(error){console.warn("Committee auto refresh failed",error);if(String(error?.message||"").includes("انتهت جلسة اللجنة")){toast("انتهت صلاحية جلسة الدخول، الرجاء تسجيل الدخول مجددًا");await cloudLogout()}}finally{committeeRefreshBusy=false}}

function committeeAlertsKey(){return `${COMMITTEE_ALERTS_KEY}.${window.CloudCompetition.context?.committee?.id||"unknown"}`}
function committeeAlerts(){try{return JSON.parse(localStorage.getItem(committeeAlertsKey())||"[]")}catch{return []}}
async function withRealChangeTimes(updates){
  const ids=[...new Set(updates.map(item=>item.participantId).filter(Boolean))];
  if(!ids.length)return updates;
  try{
    const times=await window.CloudCompetition.lookupChangeTimes(ids);
    const timeById=new Map(times.map(item=>[item.participant_id,item.changed_at]));
    return updates.map(item=>timeById.has(item.participantId)?{...item,at:timeById.get(item.participantId)}:item);
  }catch(error){console.warn("تعذر جلب توقيت التغييرات الحقيقي",error);return updates}
}
function addCommitteeAlerts(items){const now=new Date().toISOString(),alerts=[...items.map((item,index)=>({id:`${Date.now()}-${index}`,text:item.text,participantId:item.participantId||null,at:item.at||now,read:false})),...committeeAlerts()].slice(0,50);safeSetItem(committeeAlertsKey(),JSON.stringify(alerts));renderCommitteeAlerts()}
async function syncServerCommitteeNotifications(){try{const items=await window.CloudCompetition.listCommitteeNotifications();mergeServerCommitteeNotifications(items)}catch(error){console.warn("تعذر جلب تنبيهات اللجنة من الخادم",error)}}
function mergeServerCommitteeNotifications(items){
  if(!items?.length)return;
  const existing=committeeAlerts(),knownServerIds=new Set(existing.filter(a=>a.serverId!=null).map(a=>a.serverId)),fresh=items.filter(item=>!knownServerIds.has(item.id));
  if(!fresh.length)return;
  const merged=[...fresh.map(item=>({id:`srv-${item.id}`,serverId:item.id,text:item.message,participantId:item.participant_id||null,at:item.created_at,read:false})),...existing]
    .sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,50);
  safeSetItem(committeeAlertsKey(),JSON.stringify(merged));
}
function renderCommitteeAlerts(){const alerts=committeeAlerts(),panel=$(".committee-alerts");panel.classList.toggle("is-empty",!alerts.length);$("#committeeAlertsList").innerHTML=alerts.length?alerts.map(alert=>`<article class="committee-alert ${alert.read?"read":"unread"}"><i data-lucide="bell-ring"></i><div><b>${escapeHtml(alert.text)}</b><small>${formatDate(alert.at)}</small></div>${alert.read?"":`<span>جديد</span>`}</article>`).join(""):`<p class="committee-alerts-empty">لا توجد تنبيهات جديدة.</p>`;lucide.createIcons()}
function clearCommitteeAlerts(){const alerts=committeeAlerts().map(alert=>({...alert,read:true}));safeSetItem(committeeAlertsKey(),JSON.stringify(alerts));renderCommitteeAlerts();toast("تم تحديد التنبيهات كمقروءة")}
function populateCommitteeCenterOptions(){
  const centerSelect=$("#committeeCenterFilter");if(!centerSelect)return;
  const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  const current=centerSelect.value;
  centerSelect.innerHTML=`<option value="all">المركز: الكل</option>`+centers.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  centerSelect.value=centers.includes(current)?current:"all";
}
// نظرة عامة اللجنة (رقم إجمالي بلا تفصيل مستوى): تُحسب من المتسابقين الذين امتحنتهم فعلياً (نفس إسناد assessment.committee.id)، لا كل المسندين لها حالياً.
function renderCommitteePassRate(committee){
  const panel=$("#committeePassRateRing")?.closest(".committee-pass-rate-panel");if(!panel)return;
  // show_stats_summary مستقل عن show_score — لو الحقل غير موجود بعد (SQL غير مُطبَّق)، نتراجع مؤقتاً لقيمة show_score القديمة.
  const migrationNotAppliedYet=committee.show_stats_summary===undefined;
  const hidden=committee.show_stats_summary===false||(migrationNotAppliedYet&&committee.show_score===false);
  if(hidden){panel.classList.add("hidden");return}
  panel.classList.remove("hidden");
  // نحسب من committeeSessions (تُحدَّث محلياً فوراً عند كل اعتماد) لا من state.participants —
  // تلك تُستبدَل بالكامل من بيانات الإدارة المشتركة كل نبضة استطلاع، ولا تعرف بنتيجة اعتمدتها
  // اللجنة للتو محلياً، فكانت الأرقام "تظهر وتختفي" بين النبضات. نستبعد فقط شبح انسحاب حقيقي
  // (بلا اختبار، علامتها ليست > صفر) — انسحاب لاحق مع علامة حقيقية > صفر يبقى محسوباً "ممتحنة".
  const participantById=new Map(state.participants.map(p=>[p.id,p]));
  const isGhostWithdrawnSession=participantId=>Boolean(participantById.get(participantId)?.withdrawn);
  const finalSessions=committeeSessions.filter(s=>s.status==="final"&&isRealExam(s)&&!isGhostWithdrawnSession(s.participant_id));
  const passed=finalSessions.filter(s=>s.score>=PASS_SCORE);
  const failed=finalSessions.filter(s=>s.score<PASS_SCORE);
  renderPassRateRing("committeePassRateRing","committeePassRateValue",finalSessions.length?passed.length/finalSessions.length*100:null);
  $("#committeeExaminedCount").textContent=formatNumber(finalSessions.length);
  $("#committeePassedCount").textContent=formatNumber(passed.length);
  $("#committeeFailedCount").textContent=formatNumber(failed.length);
}
function renderCommitteeStudents(){enforceWithdrawnZeroScore(state.participants);
  const committee=window.CloudCompetition.context?.committee;
  if(!committee)return;
  renderCommitteePassRate(committee);
  const chairman=committee.examiner_role!=="member";
  if($("#committeeRoleLabel"))$("#committeeRoleLabel").textContent=chairman?"رئيس لجنة الاختبار":"عضو لجنة الاختبار";
  const query=$("#committeeSearch").value.trim().toLowerCase();
  const filter=$("#committeeStatusFilter").value;
  populateCommitteeCenterOptions();
  const centerFilter=$("#committeeCenterFilter").value;
  const drawsVisible=state.config?.showDrawsToCommittees!==false;
  const drawByParticipant=drawsVisible?new Map(state.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw])):new Map();
  const sessionByParticipant=new Map(committeeSessions.map(session=>[session.participant_id,session]));
  // قفل لجنة واحدة على اختبار واحد بنفس الوقت — يمنع ظهور اسمين "قيد الاختبار" لنفس اللجنة.
  const activeSession=committeeSessions.find(s=>s.status==="in_progress");
  const activeParticipant=activeSession?state.participants.find(p=>p.id===activeSession.participant_id):null;
  const statusOrder={in_progress:0,pending:1,no_draw:2,final:3,manual_dr:4,withdrawn:5};
  const statusOf=participant=>participant.withdrawn?"withdrawn":participant.scoreSource==="manual"&&participant.manualEntryBy?"manual_dr":!drawByParticipant.has(participant.id)?"no_draw":sessionByParticipant.get(participant.id)?.status||"pending";
  const allEligible=state.participants.filter(participant=>`${participant.name} ${participant.seat} ${participant.center}`.toLowerCase().includes(query)).filter(participant=>centerFilter==="all"||participant.center===centerFilter);
  const eligible=allEligible.filter(participant=>filter==="all"||statusOf(participant)===filter).sort((a,b)=>(statusOrder[statusOf(a)]-statusOrder[statusOf(b)])||String(a.name).localeCompare(String(b.name),"ar"));
  $("#committeePendingCount").textContent=formatNumber(allEligible.filter(participant=>["no_draw","pending"].includes(statusOf(participant))).length);
  $("#committeeActiveCount").textContent=formatNumber(allEligible.filter(participant=>statusOf(participant)==="in_progress").length);
  // المنسحب لا يُحسب ممتحناً أبداً (علامته صفر قسراً، راجع enforceWithdrawnZeroScore) — للتطابق مع دائرة نسبة النجاح المجاورة.
  $("#committeeCompletedCount").textContent=formatNumber(allEligible.filter(participant=>!participant.withdrawn&&["final","manual_dr"].includes(statusOf(participant))).length);
  $("#committeeWithdrawnCount").textContent=formatNumber(allEligible.filter(participant=>participant.withdrawn).length);
  const COMMITTEE_STUDENTS_PAGE_SIZE=15;
  const committeePageSignature=JSON.stringify([query,filter,centerFilter]);
  if(committeePageSignature!==committeeStudentsPageSignature){committeeStudentsPage=1;committeeStudentsPageSignature=committeePageSignature}
  const committeeTotalPages=Math.max(1,Math.ceil(eligible.length/COMMITTEE_STUDENTS_PAGE_SIZE));
  committeeStudentsPage=Math.min(Math.max(1,committeeStudentsPage),committeeTotalPages);
  const eligiblePage=eligible.slice((committeeStudentsPage-1)*COMMITTEE_STUDENTS_PAGE_SIZE,committeeStudentsPage*COMMITTEE_STUDENTS_PAGE_SIZE);
  renderPagerTabs("committeeStudentsPager",committeeStudentsPage,committeeTotalPages,page=>{committeeStudentsPage=page;renderCommitteeStudents()});
  $("#committeeStudents").innerHTML=eligiblePage.length?eligiblePage.map(participant=>{
    const draw=drawByParticipant.get(participant.id),session=sessionByParticipant.get(participant.id),status=statusOf(participant),withdrawn=Boolean(participant.withdrawn);
    const canSeeScore=committee.show_score!==false;
        const statusText=withdrawn?"منسحب · العلامة 0":status==="manual_dr"?(canSeeScore?`مسجّلة يدويًا من الإدارة · ${participant.score}`:"مسجّلة يدويًا من الإدارة"):status==="no_draw"?"لم يتم السحب بعد":status==="final"?(session?.assessment?.incomplete?"مكتمل · غير مكتمل":canSeeScore?`مكتمل · ${session.score}`:"مكتمل · العلامة غير ظاهرة للجنة"):status==="in_progress"?"مسودة محفوظة":"جاهز للاختبار";
    const canSelfDrawThis=Boolean(committee?.can_self_draw)&&!withdrawn&&!draw&&!(participant.parts?.length);
    const positions=withdrawn?"":draw?`<ol class="committee-position-preview">${draw.positions.map((position,index)=>`<li><b>${index+1}</b><span>${escapeHtml(positionTitle(position))}</span><small>الجزء ${position.juz} · صفحة ${position.page}</small></li>`).join("")}</ol>`:canSelfDrawThis?`<div class="committee-no-draw">لم تُسجَّل أجزاء هذا المتسابق بعد — يمكنكم تسجيلها وتنفيذ السحب مباشرة</div>`:`<div class="committee-no-draw">بانتظار قيام الإدارة بإجراء السحب لهذا المتسابق</div>`;
    // بدء اختبار جديد يقتصر على رئيس اللجنة، ويُمنع طالما في اختبار آخر قيد التنفيذ بنفس اللجنة.
    const blockedByActiveOther=Boolean(activeParticipant)&&activeParticipant.id!==participant.id;
    const startBlockedHtml=!chairman?`<button class="secondary-btn" disabled>بانتظار البدء من رئيس اللجنة</button>`:blockedByActiveOther?`<button class="secondary-btn" disabled title="أنهوا اختبار «${escapeAttr(activeParticipant.name)}» الجاري أولاً">لجنتكم تختبر متسابقًا آخر حاليًا</button>`:null;
    const memberHasStarted=Boolean(session?.assessment?.examinerDrafts?.member&&Object.keys(session.assessment.examinerDrafts.member).length);
    const action=withdrawn?`<button class="secondary-btn" disabled>منسحب من المسابقة</button>`:status==="manual_dr"?`<button class="secondary-btn" disabled>سُجلت العلامة يدويًا من الإدارة</button>`:canSelfDrawThis?(startBlockedHtml||`<button class="primary-btn" data-self-draw="${participant.id}">تسجيل الأجزاء وتنفيذ السحب</button>`):!draw?`<button class="secondary-btn" disabled>بانتظار سحب الإدارة</button>`:status==="pending"?(startBlockedHtml||`<button class="primary-btn" data-committee-confirm-start="${participant.id}">البدء بالاختبار الآن</button>`):status==="in_progress"?(chairman?`<div class="committee-action-group"><button class="primary-btn" data-committee-student="${participant.id}">متابعة الرصد</button><button type="button" class="compact-btn danger-compact" data-cancel-exam="${participant.id}"><i data-lucide="rotate-ccw"></i> إلغاء الاختبار</button></div>`:`<button class="primary-btn" data-committee-student="${participant.id}">${memberHasStarted?"متابعة الرصد":"ابدأ الاختبار الآن"}</button>`):`<button class="secondary-btn" data-committee-student="${participant.id}">عرض التقييم</button>`;
    return `<article class="committee-student ${status}"><div><h3>${escapeHtml(participant.name)}</h3><p>${escapeHtml(participant.center)} · رقم الجلوس ${escapeHtml(participant.seat)}</p><div class="committee-student-meta"><span>${participant.level} أجزاء</span>${draw?`<span>${draw.positions.length} مواضع</span>`:""}<span class="state ${status==="withdrawn"?"failed":status==="final"||status==="manual_dr"?"completed":status==="in_progress"?"drawn":status==="no_draw"?"not-drawn":""}">${statusText}</span></div>${positions}</div>${action}</article>`;
  }).join(""):`<div class="committee-empty"><b>لا يوجد متسابقون بهذه الحالة</b><p>غيّر حالة الفرز أو عبارة البحث لعرض بقية الطلاب.</p></div>`;
  $$(`[data-committee-student]`).forEach(button=>button.onclick=()=>startCommitteeExam(button.dataset.committeeStudent));
  $$(`[data-committee-confirm-start]`).forEach(button=>button.onclick=()=>openCommitteeStartConfirm(button.dataset.committeeConfirmStart));
  $$(`[data-self-draw]`).forEach(button=>button.onclick=()=>openCommitteeSelfDrawModal(button.dataset.selfDraw));
  $$(`[data-cancel-exam]`).forEach(button=>button.onclick=()=>cancelCommitteeExam(button.dataset.cancelExam));
  lucide.createIcons();
}
async function cancelCommitteeExam(participantId){
  const participant=state.participants.find(item=>item.id===participantId);
  if(!participant)return toast("المتسابق غير موجود");
  if(!confirm(`إلغاء اختبار «${participant.name}» الجاري؟ سيُحذف كل ما سُجّل حتى الآن وتعود حالته إلى "جاهز للاختبار".`))return;
  try{
    await window.CloudCompetition.cancelCommitteeSession(participantId);
    // نمسح مفتاحي الرئيس والعضو صراحةً (examinerDraftKey يتضمن الدور) — الإلغاء يجب يمحو كل مسودة بغض النظر مين سجّلها.
    localStorage.removeItem(`${ASSESSMENT_DRAFT_PREFIX}chairman-${participantId}`);
    localStorage.removeItem(`${ASSESSMENT_DRAFT_PREFIX}member-${participantId}`);
    if(activeCloudSession?.participant_id===participantId)activeCloudSession=null;
    delete participant.assessment;
    committeeSessions=committeeSessions.filter(session=>session.participant_id!==participantId);
    renderCommitteeStudents();
    toast(`تم إلغاء اختبار ${participant.name}`);
  }catch(error){toast(error.message)}
}
function openCommitteeStartConfirm(participantId){
  const participant=state.participants.find(p=>p.id===participantId);
  if(!participant)return toast("المتسابق غير موجود");
  const partsText=participant.parts?.length?participant.parts.join("، "):"غير مسجّلة";
  openModal(`<div class="modal-head"><h2>تأكيد بيانات المتسابق قبل البدء</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">يرجى التحقق من مطابقة البيانات أدناه مع بيانات الطالب الحاضر أمامكم، وذلك قبل البدء بإجراءات تسجيل الأخطاء.</p><p class="field-help">الاسم: <b>${escapeHtml(participant.name)}</b></p><p class="field-help">المركز: <b>${escapeHtml(participant.center||"—")}</b></p><p class="field-help">المستوى: <b>${escapeHtml(participant.levelName||`${participant.level} أجزاء`)}</b></p><p class="field-help committee-confirm-parts">الأجزاء المشارك فيها: <b>${escapeHtml(partsText)}</b></p><div id="committeeConfirmIssueBox" class="hidden"><label>ما هي نوع المشكلة؟<textarea id="committeeConfirmIssueText" rows="3" placeholder="مثال: خطأ في اسم المركز المسجَّل"></textarea></label><p id="committeeConfirmIssueError" class="form-error hidden"></p><p class="field-help">في حال كان الخطأ لا يؤثر على إمكانية اختبار الطالب وبدء الاختبار (مثل وجود خطأ بسيط في اسم المركز)، يرجى إرسال البلاغ ومتابعة إجراءات الاختبار. أمّا إذا كان الخطأ يمنع اختبار الطالب أو يؤثر على صحة بياناته، فيرجى إرسال البلاغ وعدم البدء بالاختبار إلى حين معالجة الخطأ.</p><div class="modal-actions"><button type="button" class="secondary-btn" id="committeeConfirmIssueBackBtn">رجوع</button><button type="button" class="secondary-btn" id="committeeConfirmIssueStopBtn">إرسال البلاغ وعدم بدء الاختبار</button><button type="button" class="primary-btn" id="committeeConfirmIssueContinueBtn">إرسال البلاغ والبدء بالاختبار</button></div></div></div><div class="modal-actions" id="committeeConfirmMainActions"><button type="button" class="secondary-btn" id="committeeConfirmIssueBtn">إبلاغ عن خطأ</button><button type="button" class="primary-btn" id="committeeConfirmStartBtn">تأكيد والبدء</button></div>`);
  $("#committeeConfirmStartBtn").onclick=()=>{closeModal();startCommitteeExam(participantId)};
  $("#committeeConfirmIssueBtn").onclick=()=>{
    $("#committeeConfirmIssueBox").classList.remove("hidden");
    $("#committeeConfirmMainActions").classList.add("hidden");
    $("#committeeConfirmIssueText").focus();
  };
  $("#committeeConfirmIssueBackBtn").onclick=()=>{
    $("#committeeConfirmIssueBox").classList.add("hidden");
    $("#committeeConfirmMainActions").classList.remove("hidden");
    $("#committeeConfirmIssueText").value="";
    $("#committeeConfirmIssueError").classList.add("hidden");
  };
  $("#committeeConfirmIssueStopBtn").onclick=()=>submitCommitteeIssueReport(participantId,false);
  $("#committeeConfirmIssueContinueBtn").onclick=()=>submitCommitteeIssueReport(participantId,true);
}
async function submitCommitteeIssueReport(participantId,continueExam){
  const message=$("#committeeConfirmIssueText").value.trim(),errorBox=$("#committeeConfirmIssueError");
  if(!message){errorBox.textContent="اكتب وصف المشكلة أولاً";errorBox.classList.remove("hidden");return}
  errorBox.classList.add("hidden");
  const buttons=[$("#committeeConfirmIssueStopBtn"),$("#committeeConfirmIssueContinueBtn")];
  buttons.forEach(button=>button.disabled=true);
  (continueExam?$("#committeeConfirmIssueContinueBtn"):$("#committeeConfirmIssueStopBtn")).textContent="جاري الإرسال...";
  try{
    await window.CloudCompetition.reportCommitteeIssue(participantId,message);
    closeModal();
    if(continueExam){toast("تم إرسال البلاغ للإدارة، سيتم بدء الاختبار الآن");startCommitteeExam(participantId)}
    else toast("تم إرسال البلاغ للإدارة، لن يبدأ الاختبار الآن");
  }catch(error){
    errorBox.textContent=error.message;errorBox.classList.remove("hidden");
    buttons.forEach(button=>button.disabled=false);
    $("#committeeConfirmIssueStopBtn").textContent="إرسال البلاغ وعدم بدء الاختبار";
    $("#committeeConfirmIssueContinueBtn").textContent="إرسال البلاغ والبدء بالاختبار";
  }
}
function showCommitteeSelfDrawError(message){const box=$("#committeeSelfDrawError");if(!box)return;box.textContent=message;box.classList.remove("hidden")}
function openCommitteeSelfDrawModal(participantId){
  const participant=state.participants.find(p=>p.id===participantId);
  if(!participant)return toast("المتسابق غير موجود");
  const level=Number(participant.level);
  openModal(`<div class="modal-head"><h2>تسجيل الأجزاء وتنفيذ السحب</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">${escapeHtml(participant.name)} · اختر ${level} جزءاً بالضبط شارك بها المتسابق، ثم نفّذوا السحب مباشرة.</p><div id="committeeSelfDrawParts" class="committee-level-options">${Array.from({length:30},(_,i)=>i+1).map(n=>`<label><input type="checkbox" value="${n}"> جزء ${n}</label>`).join("")}</div><p id="committeeSelfDrawError" class="form-error hidden"></p></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button id="confirmCommitteeSelfDraw" class="primary-btn">تسجيل الأجزاء وتنفيذ السحب</button></div>`);
  $$(`#committeeSelfDrawParts input`).forEach(input=>input.addEventListener("change",()=>{const checked=$$(`#committeeSelfDrawParts input`).filter(i=>i.checked);if(checked.length>level){input.checked=false;toast(`لا يمكن اختيار أكثر من ${level} جزءاً لهذا المستوى`)}}));
  $("#confirmCommitteeSelfDraw").onclick=async()=>{
    const button=$("#confirmCommitteeSelfDraw");
    $("#committeeSelfDrawError").classList.add("hidden");
    const parts=$$(`#committeeSelfDrawParts input`).filter(i=>i.checked).map(i=>Number(i.value)).sort((a,b)=>a-b);
    if(parts.length!==level)return showCommitteeSelfDrawError(`اختر ${level} جزءاً بالضبط`);
    button.disabled=true;button.textContent="جاري تجهيز بيانات القرآن...";
    try{
      await ensureQuranReady();
      button.textContent="جاري السحب...";
      const questionCount=LEVEL_QUESTIONS[level]||3;
      const pools=new Map(parts.map(j=>[j,availableForParts([j],level)]));
      const eligibleParts=parts.filter(j=>pools.get(j).length);
      if(eligibleParts.length<questionCount)throw new Error("لا توجد مواضع كافية ضمن الأجزاء المختارة");
      const drawnParts=secureShuffle(eligibleParts).slice(0,questionCount);
      const positions=drawnParts.map(j=>pools.get(j)[randomIndex(pools.get(j).length)]).sort((a,b)=>a.juz-b.juz);
      const draw={id:uid("DRAW"),sequence:nextDrawSequence(),participantId,name:participant.name,seat:participant.seat,center:participant.center,age:participant.age||null,level,eligibleParts:parts,positions,createdAt:new Date().toISOString(),rerolls:[],verification:""};
      draw.verification=await createVerification(draw);
      const result=await window.CloudCompetition.createCommitteeDraw(participantId,level,parts,draw);
      Object.assign(draw,result.draw||{});
      participant.parts=parts;
      state.draws.push(draw);
      if(result.session)committeeSessions.unshift(result.session);
      saveCommitteeSnapshot(state);
      closeModal();
      renderCommitteeStudents();
      toast("تم تسجيل الأجزاء وتنفيذ السحب");
      startCommitteeExam(participantId);
    }catch(error){button.disabled=false;button.textContent="تسجيل الأجزاء وتنفيذ السحب";showCommitteeSelfDrawError(error.message)}
  };
}
async function startCommitteeExam(participantId){const participant=state.participants.find(item=>item.id===participantId);let draw=state.draws.find(item=>item.participantId===participantId);if(!participant)return toast("المتسابق غير موجود");if(participant.scoreSource==="manual"&&participant.manualEntryBy)return toast("عُلامة هذا المتسابق مسجّلة يدويًا من الإدارة؛ لا يمكن فتح تقييم إلكتروني له إلا بعد إلغاء التسجيل اليدوي من الإدارة");const role=currentExaminerRole();const unfinished=state.participants.find(p=>p.id!==participantId&&p.assessment?.examinerRole===role&&p.assessment?.status==="draft"&&!(role==="member"&&p.assessment?.memberSubmittedAt));if(unfinished)return toast(`أنهِ اختبار «${unfinished.name}» أولاً (لا يزال قيد الاختبار) قبل بدء اختبار متسابق آخر`);if(!draw)return toast("بانتظار قيام الإدارة بإجراء السحب لهذا المتسابق");let session=committeeSessions.find(item=>item.participant_id===participantId);try{await ensureQuranReady();if(!session){session=await window.CloudCompetition.claimStudent(participant.id,draw.id,participant.level);committeeSessions.unshift(session);await window.CloudCompetition.log("claim","participant",participant.id,{drawId:draw.id,level:participant.level})}activeCloudSession=session;console.log("[examTrace] startCommitteeExam: بدء/متابعة اختبار",{studentId:participant.id,examId:draw.id,attemptId:session.id,sessionStatus:session.status});const cloudDraft=session.assessment&&Object.keys(session.assessment).length?session.assessment:null,localDraft=loadLocalAssessmentDraft(participant.id),newestDraft=localDraft?.drawId===draw.id&&new Date(localDraft.updatedAt||0)>new Date(cloudDraft?.updatedAt||0)?localDraft:cloudDraft;if(newestDraft)participant.assessment=newestDraft;if(session.status==="final"){localStorage.removeItem(ASSESSMENT_DRAFT_PREFIX+participant.id);return openCompletedAssessment(draw,participant,session)}openElectronicAssessment(draw,session)}catch(error){
    // نافذة ثابتة (لا توست يختفي) توضح سبب تعذر تحميل بيانات القرآن مع زر إعادة محاولة مباشر.
    if(String(error?.message||"").includes("تعذر تحميل بيانات")){
      openModal(`<div class="modal-head"><h2>تعذر تحميل بيانات القرآن</h2><button type="button" class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="form-error">${escapeHtml(error.message)}</p><p class="field-help">غالبًا بسبب ضعف أو انقطاع الاتصال بالإنترنت عند هذا الجهاز حاليًا. تحقق من اتصال الشبكة (واي فاي أو بيانات الجوال) ثم أعد المحاولة.</p></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إغلاق</button><button type="button" id="retryStartCommitteeExamBtn" class="primary-btn"><i data-lucide="refresh-cw"></i> إعادة المحاولة</button></div>`);
      $("#retryStartCommitteeExamBtn").onclick=()=>{closeModal();startCommitteeExam(participantId)};
    }else toast(error.message);
    await renderCommitteeWorkspace()
  }}
function navigate(view,{historyMode="push",ui=null}={}){if(!$("#"+view+"View"))view="dashboard";safeSetItem(currentViewKey(),view);if(ui)restoreListControls(ui);$$(`.view`).forEach(v=>v.classList.toggle("active-view",v.id===`${view}View`));$$(`[data-view]`).forEach(b=>b.classList.toggle("active",b.dataset.view===view));$(".sidebar").classList.remove("open");if(view!=="monitor")stopMonitorPoll();if(view==="draw"){refreshDrawParticipants();const count=$("#availableCount");if(count&&!integrity.valid)count.textContent="تُجهّز بيانات القرآن عند السحب"}if(view==="participants"){if(!ui&&$("#participantSearch"))$("#participantSearch").value="";renderParticipants()}if(view==="history")renderHistory();if(view==="examDuration")renderExamDurations();if(view==="analytics"){renderAnalytics();renderCommitteeBreakdown();if(operationMode==="cloud"&&["admin","supervisor"].includes(window.CloudCompetition.context?.kind))renderScoreComparison()}if(view==="diwan"){diwanOpenStage=null;restoreListControls(loadDiwanPersistedParticipantFilters());ensureDiwanStateLoaded().then(renderDiwanParticipants);renderDiwanParticipants()}if(view==="monitor")renderMonitorView();if(historyMode!=="none")recordBrowserRoute({surface:"admin",view},{replace:historyMode==="replace"});requestAnimationFrame(()=>window.scrollTo(0,ui?.scrollY||0));lucide.createIcons()}
function renderAll(){enforceWithdrawnZeroScore(state.participants);renderDashboard();renderParticipants();renderHistory();refreshDrawParticipants();renderAnalytics();lucide.createIcons()}

// "ممتحن" = علامة حقيقية > صفر. المنسحب علامته صفر دائماً (enforceWithdrawnZeroScore) فلا يُحسب ممتحناً حتى لو انسحب بعد اعتماد علامته.
// انتهاء مبكر (endExamNow) يسجّل علامة رقمية حقيقية (دائماً <75) بعلامة assessment.incomplete=true،
// فيُحسب ضمن "امتُحن"/"راسب" كأي رسوب عادي — "غير مكتمل" نصياً يظهر فقط بعرض الطالب الفردي.
function isRealExam(entity){return Number.isFinite(entity?.score)&&entity.score>0}
function passRateOf(list){const examined=list.filter(isRealExam);return examined.length?examined.filter(p=>p.score>=PASS_SCORE).length/examined.length*100:null}
function formatPct(n){return n==null?"—":`${new Intl.NumberFormat("ar-JO",{maximumFractionDigits:1,numberingSystem:"latn"}).format(n)}%`}
function renderPassRateRing(ringId,valueId,pct){const ring=$(`#${ringId}`),value=$(`#${valueId}`);if(!ring||!value)return;const empty=pct==null;ring.classList.toggle("is-empty",empty);ring.style.setProperty("--pct",empty?0:Math.max(0,Math.min(100,pct)));value.textContent=empty?"لا يوجد بيانات":formatPct(pct)}
let dashboardDateFilter=null;
// "إجمالي المتسابقين" و"منسحبون" أرقام تسجيل/استيراد بلا تاريخ حقيقي فتبقى تراكمية دائماً — أما
// امتُحن/نجح/رسب فأحداث فعلية (gradedAt) تُفلتَر حسب اليوم المختار عند تفعيله.
function isParticipantGradedOn(participant,dateStr){
  const iso=participant?.gradedAt;if(!iso)return false;
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return false;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`===dateStr;
}
function dashboardScopedParticipants(){return dashboardDateFilter?state.participants.filter(p=>isParticipantGradedOn(p,dashboardDateFilter)):state.participants}
function renderDashboardDateFilterUi(){
  const hint=$("#dashboardDateHint");if(!hint)return;
  $("#dashboardDateAllBtn")?.classList.toggle("is-active",!dashboardDateFilter);
  const dayLabel=dashboardDateFilter?new Intl.DateTimeFormat("ar-JO",{dateStyle:"long",numberingSystem:"latn"}).format(new Date(`${dashboardDateFilter}T00:00:00`)):"";
  hint.textContent=dashboardDateFilter?`بيانات يوم ${dayLabel} فقط (باستثناء إجمالي المتسابقين المسجَّلين الثابت دائماً؛ وعدد المنسحبين لا يظهر إلا بالعرض التراكمي)`:"الأرقام أدناه تراكمية لكامل الدورة (باستثناء إجمالي المتسابقين المسجَّلين الثابت دائماً)";
}
function renderDashboard(){
  const byGender=(list,g)=>list.filter(p=>p.gender===g);
  const total=state.participants;
  const scoped=dashboardScopedParticipants();
  const withdrawnAll=total.filter(p=>p.withdrawn);
  const examined=scoped.filter(isRealExam);
  const passed=examined.filter(p=>p.score>=PASS_SCORE);
  const failed=examined.filter(p=>p.score<PASS_SCORE);
  $("#statTotal").textContent=formatNumber(total.length);
  $("#statTotalM").textContent=formatNumber(byGender(total,"ذكر").length);
  $("#statTotalF").textContent=formatNumber(byGender(total,"أنثى").length);
  $("#statExamined").textContent=formatNumber(examined.length);
  $("#statExaminedM").textContent=formatNumber(byGender(examined,"ذكر").length);
  $("#statExaminedF").textContent=formatNumber(byGender(examined,"أنثى").length);
  $("#statWithdrawn").textContent=dashboardDateFilter?"-":formatNumber(withdrawnAll.length);
  $("#statWithdrawnM").textContent=dashboardDateFilter?"-":formatNumber(byGender(withdrawnAll,"ذكر").length);
  $("#statWithdrawnF").textContent=dashboardDateFilter?"-":formatNumber(byGender(withdrawnAll,"أنثى").length);
  $("#statPassed").textContent=formatNumber(passed.length);
  $("#statPassedM").textContent=formatNumber(byGender(passed,"ذكر").length);
  $("#statPassedF").textContent=formatNumber(byGender(passed,"أنثى").length);
  $("#statFailed").textContent=formatNumber(failed.length);
  $("#statFailedM").textContent=formatNumber(byGender(failed,"ذكر").length);
  $("#statFailedF").textContent=formatNumber(byGender(failed,"أنثى").length);
  renderPassRateRing("passRateAllRing","passRateAll",passRateOf(scoped));
  renderPassRateRing("passRateMRing","passRateM",passRateOf(byGender(scoped,"ذكر")));
  renderPassRateRing("passRateFRing","passRateF",passRateOf(byGender(scoped,"أنثى")));
  renderLevelBreakdown(total);
  renderDashboardDateFilterUi();
}
function renderLevelBreakdown(total){
  const UNRESOLVED="__unresolved__";
  // بلوحة التحكم فقط: مستويات السادس (10 أجزاء) والسابع (5 أجزاء) تُدمج بغض النظر عن الفئة العمرية أ/ب.
  const dashboardGroupKey=p=>{const parts=Number(p.level);if(parts===10)return "merged-10";if(parts===5)return "merged-5";return resolveParticipantLevelId(p)||UNRESOLVED};
  const groups=new Map();
  for(const p of total){const key=dashboardGroupKey(p);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p)}
  const showFull=Boolean(state.config?.showFullQuranStats);
  const labelFor=key=>key==="merged-10"?"المستوى السادس (حفظ 10 أجزاء)":key==="merged-5"?"المستوى السابع (حفظ 5 أجزاء)":key===UNRESOLVED?"مستوى غير محدد (يحتاج تصحيح)":(levelCatalogById(key)?.label||key);
  const partsFor=key=>key==="merged-10"?10:key==="merged-5"?5:key===UNRESOLVED?0:(levelCatalogById(key)?.parts??0);
  // بطاقة "غير محدد" لا تظهر هنا عمداً — لا تفيد تلخيصياً، وتصحيح هؤلاء المتسابقين متاح يدوياً.
  const orderedKeys=[...groups.keys()].filter(key=>key!==UNRESOLVED&&(showFull||partsFor(key)<30)).sort((a,b)=>partsFor(a)-partsFor(b)||labelFor(a).localeCompare(labelFor(b),"ar"));
  // "عدد الطلاب" تسجيل مسبق فيبقى تراكمياً دائماً؛ "نسبة النجاح" تُحسب حسب المجموعة الزمنية المختارة أعلى الصفحة.
  const cards=orderedKeys.map(key=>{
    const list=groups.get(key),m=byGenderList(list,"ذكر"),f=byGenderList(list,"أنثى");
    const scopedList=dashboardDateFilter?list.filter(p=>isParticipantGradedOn(p,dashboardDateFilter)):list;
    const scopedM=byGenderList(scopedList,"ذكر"),scopedF=byGenderList(scopedList,"أنثى");
    return `<article class="level-card${key===UNRESOLVED?" level-card-unresolved":""}"><h4>${escapeHtml(labelFor(key))}</h4><div class="level-card-row"><span>عدد الطلاب</span><b>${formatNumber(list.length)}</b></div><div class="stat-split"><span class="split-m">ذكور <b>${formatNumber(m.length)}</b></span><span class="split-f">إناث <b>${formatNumber(f.length)}</b></span></div><div class="level-card-row"><span>نسبة النجاح</span><b>${formatPct(passRateOf(scopedList))}</b></div><div class="stat-split"><span class="split-m">ذكور <b>${formatPct(passRateOf(scopedM))}</b></span><span class="split-f">إناث <b>${formatPct(passRateOf(scopedF))}</b></span></div></article>`;
  }).join("");
  $("#levelBreakdownGrid").innerHTML=cards||`<p class="committee-alerts-empty">لا يوجد متسابقون بعد.</p>`;
}
function byGenderList(list,g){return list.filter(p=>p.gender===g)}

function resolveParticipantLevelId(participant){
  if(!participant)return null;
  const exact=LEVEL_CATALOG.find(l=>l.label===participant.levelName);if(exact)return exact.id;
  const candidates=LEVEL_CATALOG.filter(l=>l.parts===Number(participant.level));
  if(candidates.length===1)return candidates[0].id;
  if(candidates.length<2)return null;
  const hasAge=participant.age!=null&&participant.age!==""&&Number.isFinite(Number(participant.age)),age=hasAge?Number(participant.age):null;
  if(candidates.some(l=>l.id==="L6A"||l.id==="L6B")&&hasAge)return age<20?"L6A":"L6B";
  if(candidates.some(l=>l.id==="L7A"||l.id==="L7B")&&hasAge)return age<15?"L7A":"L7B";
  if(candidates.some(l=>l.id==="L1"||l.id==="L2")){
    const recitation=String(participant.recitation||"").trim();
    if(recitation)return /حفص|عاصم/i.test(recitation)?"L2":"L1";
  }
  return null;
}
function openParticipantModal(participant=null){
  const resolvedLevelId=resolveParticipantLevelId(participant);
  const levelAmbiguityHint=(()=>{
    if(!participant||resolvedLevelId)return "";
    const parts=Number(participant.level);
    const candidates=LEVEL_CATALOG.filter(l=>l.parts===parts);
    if(candidates.length<2)return "";
    return `<p class="form-error" style="grid-column:1/-1">⚠ لم يُحدَّد المستوى تلقائيًا في القائمة أدناه لأن عدد الأجزاء (${parts}) مشترك بين أكثر من مستوى: ${candidates.map(l=>escapeHtml(l.label)).join(" — ")}. أدخل عمر المتسابق فوق ليتحدد تلقائيًا في المرة القادمة، أو اختر المستوى الصحيح يدويًا من القائمة الآن.</p>`;
  })();
  openModal(`<form id="participantForm"><div class="modal-head"><h2>${participant?"تعديل بيانات المتسابق":"إضافة متسابق جديد"}</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid"><label>اسم المتسابق<input id="pName" required value="${escapeAttr(participant?.name||"")}"></label><label>رقم الجلوس<input id="pSeat" required value="${escapeAttr(participant?.seat||nextSeat())}"></label><label>الجنس<select id="pGender" required><option value="">اختر</option><option value="ذكر" ${participant?.gender==="ذكر"?"selected":""}>ذكر</option><option value="أنثى" ${participant?.gender==="أنثى"?"selected":""}>أنثى</option></select></label><label>المركز<select id="pCenter" required>${centerSelectOptions(participant?.center)}</select></label><label>الهاتف<input id="pPhone" value="${escapeAttr(participant?.phone||"")}" placeholder="اختياري"></label><label>العمر<input id="pAge" type="number" min="4" max="100" value="${participant?.age||""}" placeholder="اختياري"></label><label>المستوى<select id="pLevel" required><option value="">اختر المستوى</option>${LEVEL_CATALOG.map(l=>`<option value="${l.id}" ${l.id===resolvedLevelId?"selected":""}>${escapeHtml(l.label)}</option>`).join("")}</select></label>${levelAmbiguityHint}<label>الأجزاء المشمولة<input id="pParts" value="${escapeAttr((participant?.parts||[]).join(","))}" placeholder="تُترك فارغة الآن، مثال لاحقاً: 1-5"></label></div></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button class="primary-btn" type="submit">حفظ المتسابق</button></div></form>`);
  if(window.CloudCompetition?.context?.kind==="subAdmin"){$("#pGender").value=window.CloudCompetition.context.subAdmin.gender;$("#pGender").disabled=true}
  $("#participantForm").addEventListener("submit",async event=>{
    event.preventDefault();
    const button=event.submitter,catalogEntry=levelCatalogById($("#pLevel").value);
    if(!catalogEntry)return toast("اختر المستوى من القائمة");
    const level=catalogEntry.parts,levelName=catalogEntry.label,partText=$("#pParts").value.trim(),parsedParts=parsePartSpec(partText);
    if(partText&&parsedParts.length!==level)return toast(`سجّل ${level} أجزاء بالضبط، أو اترك الحقل فارغاً لتسجيلها لاحقاً`);
    const newSeat=$("#pSeat").value.trim();
    if(newSeat&&state.participants.some(p=>p.id!==(participant?.id||null)&&String(p.seat).trim()===newSeat))return toast(`رقم الجلوس ${newSeat} مسجَّل مسبقًا لمتسابق آخر — استخدم رقمًا مختلفًا`);
    const parts=(parsedParts.length===level?parsedParts:[]).map(Number).sort((a,b)=>a-b),oldParts=[...(participant?.parts||[])].map(Number).sort((a,b)=>a-b),partsChanged=Boolean(participant)&&(Number(participant.level)!==level||JSON.stringify(oldParts)!==JSON.stringify(parts)),oldDraw=participant&&state.draws.find(draw=>draw.participantId===participant.id),drawParts=[...(oldDraw?.eligibleParts||[])].map(Number).filter(Number.isFinite).sort((a,b)=>a-b),drawPartsKnown=drawParts.length>0,drawPartsMismatch=Boolean(oldDraw)&&(Number(oldDraw.level)!==level||(drawPartsKnown?JSON.stringify(drawParts)!==JSON.stringify(parts):partsChanged)),resetRequired=Boolean(oldDraw)&&drawPartsMismatch;
    button.disabled=true;const stateBeforeEdit=JSON.parse(JSON.stringify(state));
    try{
      // نبني item فوق نسخة كاملة من participant الحالي (لا حقول محدودة) — بدونه كان تعديل بسيط
      // لمتسابق منسحب يمسح withdrawn بصمت ويُبقي score=0 فتظهر بطاقته "مكتمل · راسب" خطأً.
      const item={...(participant||{}),id:participant?.id||uid("P"),name:$("#pName").value.trim(),seat:$("#pSeat").value.trim(),gender:$("#pGender").value,center:$("#pCenter").value.trim(),branch:BRANCH_NAME,phone:$("#pPhone").value.trim()||null,age:Number($("#pAge").value)||null,level,levelName,parts,createdAt:participant?.createdAt||new Date().toISOString()};
      if(resetRequired){delete item.score;delete item.gradedAt;delete item.scoreSource;delete item.assessment}
      if(resetRequired&&oldDraw){state.deletions=state.deletions||[];state.deletions.push({type:"draw-parts-changed",drawId:oldDraw.id,participantId:participant.id,name:participant.name,oldParts:drawParts.length?drawParts:oldParts,newParts:parts,at:new Date().toISOString()});state.draws=state.draws.filter(draw=>draw.participantId!==participant.id);committeeSessions=committeeSessions.filter(session=>session.participant_id!==participant.id)}
      const index=state.participants.findIndex(p=>p.id===item.id);if(index>=0)state.participants[index]=item;else state.participants.push(item);
      saveState();if(resetRequired&&oldDraw&&cloudEnabled){const editorKind=window.CloudCompetition.context?.kind;if(editorKind==="subAdmin"){await window.CloudCompetition.deleteParticipantSession(participant.id)}else{if(editorKind==="supervisor")await window.CloudCompetition.saveSupervisorState(state);else await window.CloudCompetition.saveCompetitionState(state);await window.CloudCompetition.deleteParticipantSession(participant.id)}}closeModal();renderAll();toast(resetRequired&&oldDraw?"تم تصحيح الأجزاء وإلغاء السحب والتقييم القديم وإعادة المتسابق لانتظار السحب":"تم حفظ بيانات المتسابق");
    }catch(error){state=stateBeforeEdit;safeSetItem(activeStorageKey(),JSON.stringify(state));renderAll();toast(`تعذر تعديل أجزاء المتسابق: ${error.message}`);button.disabled=false}
  });
}
function nextSeat(){return String(state.participants.length+1).padStart(3,"0")}
function nextDrawSequence(){return Math.max(0,...state.draws.map(draw=>Number(draw.sequence)||0))+1}
function levelsForCommittee(committee){
  if(!committee)return LEVEL_CATALOG;
  const hasLevelNames=(committee.level_names||[]).length>0;
  return LEVEL_CATALOG.filter(l=>hasLevelNames?(committee.level_names||[]).includes(l.label):(committee.levels||[]).map(Number).includes(l.parts));
}
const PARTICIPANT_STATUS_OPTIONS=[{value:"pending",label:"بانتظار السحب"},{value:"drawn",label:"تم السحب / بانتظار العلامة"},{value:"completed",label:"تم الاختبار"},{value:"withdrawn",label:"منسحب"}];
function participantStatusOf(p,drawByParticipant){return p.withdrawn?"withdrawn":Number.isFinite(p.score)?"completed":drawByParticipant.has(p.id)?"drawn":"pending"}
// من امتحن الطالب فعلياً (assessment.committee) يبقى ثابتاً لتلك اللجنة دائماً حتى لو نُقل لاحقاً.
function participantCommitteeId(p,committees){return p.assessment?.committee?.id||resolveParticipantCommittee(p,committees).currentCommittee?.id||null}
function participantMatchesFilters(p,filters,ctx){
  if(filters.status!=="all"&&participantStatusOf(p,ctx.drawByParticipant)!==filters.status)return false;
  if(filters.gender!=="all"&&p.gender!==filters.gender)return false;
  if(filters.center!=="all"&&p.center!==filters.center)return false;
  if(filters.level!=="all"&&resolveParticipantLevelId(p)!==filters.level)return false;
  if(filters.committee!=="all"&&participantCommitteeId(p,ctx.participantCommittees)!==filters.committee)return false;
  return true;
}
// فلاتر متشابكة: كل فلتر يعرض فقط القيم التي فعلاً عندها نتيجة، محسوبة من بيانات المتسابقين
// الحقيقية باستثناء نفسه (poolExcluding) — لا من قوائم ثابتة. البحث الحر لا يدخل بهذا الحساب
// عمداً (فلترة أخيرة على القائمة المعروضة فقط) حتى لا تتغيّر الخيارات المتاحة أثناء الكتابة.
function populateParticipantFilterOptions(){
  const statusSelect=$("#participantFilter"),genderSelect=$("#participantGenderFilter"),centerSelect=$("#participantCenterFilter"),levelSelect=$("#participantLevelFilter"),committeeSelect=$("#participantCommitteeFilter");
  const isSubAdmin=window.CloudCompetition?.context?.kind==="subAdmin";
  const participantCommittees=operationMode==="cloud"?(isSubAdmin?subAdminCommittees:cloudCommittees).filter(c=>c.active!==false):[];
  const drawByParticipant=new Map(state.draws.filter(d=>d.participantId).map(d=>[d.participantId,d]));
  const ctx={drawByParticipant,participantCommittees};
  const current={status:statusSelect.value,gender:genderSelect.value,center:centerSelect.value,level:levelSelect.value,committee:committeeSelect?.value||"all"};
  const poolExcluding=dimension=>state.participants.filter(p=>participantMatchesFilters(p,{...current,[dimension]:"all"},ctx));

  const statusPool=poolExcluding("status");
  const availableStatuses=new Set(statusPool.map(p=>participantStatusOf(p,drawByParticipant)));
  statusSelect.innerHTML=`<option value="all">جميع الحالات</option>`+PARTICIPANT_STATUS_OPTIONS.filter(o=>availableStatuses.has(o.value)).map(o=>`<option value="${o.value}">${o.label}</option>`).join("");
  statusSelect.value=availableStatuses.has(current.status)?current.status:"all";
  current.status=statusSelect.value;

  const genderPool=poolExcluding("gender");
  const availableGenders=new Set(genderPool.map(p=>p.gender).filter(Boolean));
  genderSelect.innerHTML=`<option value="all">الجنس: الكل</option>`+["ذكر","أنثى"].filter(g=>availableGenders.has(g)).map(g=>`<option value="${g}">${g==="أنثى"?"إناث":"ذكور"}</option>`).join("");
  genderSelect.value=availableGenders.has(current.gender)?current.gender:"all";
  current.gender=genderSelect.value;

  const centerPool=poolExcluding("center");
  const availableCenters=[...new Set(centerPool.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  centerSelect.innerHTML=`<option value="all">المركز: الكل</option>`+availableCenters.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  centerSelect.value=availableCenters.includes(current.center)?current.center:"all";
  current.center=centerSelect.value;

  if(committeeSelect){
    const committeePool=poolExcluding("committee");
    const availableCommitteeIds=new Set(committeePool.map(p=>participantCommitteeId(p,participantCommittees)).filter(Boolean));
    const availableCommittees=participantCommittees.filter(c=>availableCommitteeIds.has(c.id));
    committeeSelect.innerHTML=`<option value="all">اللجنة: الكل</option>`+availableCommittees.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
    committeeSelect.value=availableCommitteeIds.has(current.committee)?current.committee:"all";
    current.committee=committeeSelect.value;
  }

  const levelPool=poolExcluding("level");
  const availableLevelIds=new Set(levelPool.map(p=>resolveParticipantLevelId(p)).filter(Boolean));
  const levelOptions=LEVEL_CATALOG.filter(l=>availableLevelIds.has(l.id));
  levelSelect.innerHTML=`<option value="all">المستوى: الكل</option>`+levelOptions.map(l=>`<option value="${l.id}">${escapeHtml(l.label)}</option>`).join("");
  levelSelect.value=availableLevelIds.has(current.level)?current.level:"all";
}
function renderParticipants(){
  populateParticipantFilterOptions();
  const isSubAdmin=window.CloudCompetition?.context?.kind==="subAdmin",isSupervisor=window.CloudCompetition?.context?.kind==="supervisor",isMainAdmin=operationMode==="cloud"?window.CloudCompetition?.context?.kind==="admin":true;
  const participantCommittees=operationMode==="cloud"?(isSubAdmin?subAdminCommittees:cloudCommittees):[];
  const query=$("#participantSearch").value.trim().toLowerCase(),filter=$("#participantFilter").value,genderFilter=$("#participantGenderFilter").value,centerFilter=$("#participantCenterFilter").value,levelFilter=$("#participantLevelFilter").value,committeeFilter=$("#participantCommitteeFilter")?.value||"all",drawByParticipant=new Map(state.draws.filter(d=>d.participantId).map(d=>[d.participantId,d]));
  const statusOf=p=>participantStatusOf(p,drawByParticipant);
  const activeFilters={status:filter,gender:genderFilter,center:centerFilter,level:levelFilter,committee:committeeFilter},filterCtx={drawByParticipant,participantCommittees};
  const list=state.participants.filter(p=>[p.name,p.seat,p.center].some(x=>String(x).toLowerCase().includes(query))).filter(p=>participantMatchesFilters(p,activeFilters,filterCtx));
  $("#participantFilterCount").textContent=list.length===state.participants.length?`${formatNumber(list.length)} متسابق`:`${formatNumber(list.length)} من ${formatNumber(state.participants.length)} متسابق`;
  $("#participantsTable").closest(".table-wrap").classList.toggle("is-empty",!list.length);
  const PARTICIPANTS_PAGE_SIZE=15;
  const pageSignature=JSON.stringify([query,filter,genderFilter,centerFilter,levelFilter,committeeFilter]);
  if(pageSignature!==participantsPageSignature){participantsPage=1;participantsPageSignature=pageSignature}
  const participantsTotalPages=Math.max(1,Math.ceil(list.length/PARTICIPANTS_PAGE_SIZE));
  participantsPage=Math.min(Math.max(1,participantsPage),participantsTotalPages);
  const listPage=list.slice((participantsPage-1)*PARTICIPANTS_PAGE_SIZE,participantsPage*PARTICIPANTS_PAGE_SIZE);
  renderPagerTabs("participantsPager",participantsPage,participantsTotalPages,page=>{participantsPage=page;renderParticipants()});
  $("#participantsTable").innerHTML=listPage.length?listPage.map(p=>{const status=statusOf(p),hasDraw=drawByParticipant.has(p.id),passed=Number.isFinite(p.score)&&p.score>=PASS_SCORE,isIncomplete=Boolean(p.assessment?.incomplete),isManualDr=p.scoreSource==="manual"&&Boolean(p.manualEntryBy),isWithdrawn=Boolean(p.withdrawn),hasPendingDr=p.drRequest?.status==="pending";let scoreCell;if(isWithdrawn){scoreCell=`<div class="dr-score-cell"><b>0</b><small class="manual-dr-tag">منسحب</small>${(isMainAdmin||isSubAdmin)?`<button class="compact-btn danger-compact" data-toggle-withdrawn="${p.id}" data-withdrawn="true">إلغاء الانسحاب</button>`:""}</div>`}else if(isManualDr){scoreCell=`<div class="dr-score-cell"><b>${p.score}</b><small class="manual-dr-tag">مسجّلة يدويًا${p.manualEntryBy?` · ${escapeHtml(p.manualEntryBy)}`:""}</small>${(isMainAdmin||isSupervisor)?`<button class="compact-btn danger-compact" data-cancel-dr="${p.id}">إلغاء التسجيل اليدوي</button>`:""}</div>`}else if(hasPendingDr){scoreCell=canHandleDrRequests(isMainAdmin,isSupervisor,isSubAdmin)?`<div class="dr-score-cell"><span class="score-help">طلب DR: ${formatAssessmentNumber(p.drRequest.score)}</span><button class="compact-btn" data-approve-dr-inline="${p.id}">موافقة</button><button class="compact-btn danger-compact" data-reject-dr-inline="${p.id}">رفض</button></div>`:`<span class="score-help">طلب DR بانتظار الموافقة (${formatAssessmentNumber(p.drRequest.score)})</span>`}else if(!hasDraw){scoreCell=`<span class="score-help">تُدخل بعد إجراء السحب</span>`}else if(isSubAdmin&&!Number.isFinite(p.score)){scoreCell=`<button class="compact-btn" data-request-dr="${p.id}"><i data-lucide="file-edit"></i> طلب DR</button>`}else if(!canEditParticipantScore(p)){
  // هذا الفرع حصراً للمسؤول الفرعي (الإدارة/المشرف يعدّلان دائماً، راجع canEditParticipantScore):
  // تظهر العلامة بنفس شكل مربّع الإدارة (أخضر) لكن readonly لا disabled، بلا data-score.
  scoreCell=isIncomplete?`<input class="score-input score-saved" type="text" value="غير مكتمل" readonly title="أُنهي الاختبار مبكراً — للعرض فقط">`:`<input class="score-input score-saved" type="number" value="${Number.isFinite(p.score)?p.score:""}" readonly title="نتيجة معتمدة — للعرض فقط">`
}else if(isIncomplete){scoreCell=`<input class="score-input score-saved" data-score="${p.id}" type="text" value="غير مكتمل" title="أُنهي الاختبار مبكراً — يمكن استبدالها بعلامة يدوية">`
}else{scoreCell=`<input class="score-input ${Number.isFinite(p.score)?"score-saved":""}" data-score="${p.id}" type="number" min="0" max="100" step="0.01" value="${Number.isFinite(p.score)?p.score:""}" placeholder="أدخل العلامة">`}const historicalCommitteeName=resultCommitteeName(p);const assignedCommittee=participantCommittees.length?resolveParticipantCommittee(p,participantCommittees).currentCommittee:null;const committeeCell=historicalCommitteeName?`<span class="score-help" title="اللجنة التي أجرت اختباره فعليًا · رئيس اللجنة: ${escapeAttr(resultCommitteeChairmanName(p)||"-")}${resultCommitteeMemberName(p)?` · عضو اللجنة: ${escapeAttr(resultCommitteeMemberName(p))}`:""}">${escapeHtml(historicalCommitteeName)}</span>`:assignedCommittee?`<button type="button" class="compact-btn" data-committee-info="${assignedCommittee.id}">${escapeHtml(assignedCommittee.name)}</button>`:`<span class="score-help">—</span>`;return `<tr><td><strong>${escapeHtml(p.seat)}</strong></td><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.gender||"غير محدد")}</td><td>${p.center?escapeHtml(p.center):`<span class="missing-center-tag">⚠ بلا مركز</span>`}</td><td>${escapeHtml(p.levelName||`${p.level} أجزاء`)}</td><td>${committeeCell}</td><td>${status==="completed"||status==="withdrawn"?`<span class="state completed">مكتمل</span><span class="outcome ${isIncomplete?"incomplete":passed?"pass":"fail"}">${isIncomplete?"غير مكتمل":passed?"ناجح":"راسب"}</span>${isWithdrawn?`<small class="manual-dr-tag">منسحب</small>`:p.scoreSource==="electronic"?`<small class="electronic-score-tag">تقييم إلكتروني</small>`:""}`:`<span class="state ${status}">${status==="drawn"?"تم السحب · أدخل العلامة":"لم يُسحب بعد"}</span>`}</td><td>${scoreCell}</td><td><div class="row-actions">${hasDraw?`<button class="compact-btn" data-result-participant="${p.id}"><i data-lucide="eye"></i> النتيجة</button>`:`<button class="compact-btn" data-draw="${p.id}"><i data-lucide="sparkles"></i> إجراء السحب</button>`}<details class="dropdown-menu row-actions-more"><summary class="icon-btn" title="المزيد من الإجراءات"><i data-lucide="more-vertical"></i></summary><div class="row-actions-more-list"><button class="compact-btn" data-edit="${p.id}"><i data-lucide="pencil"></i> تعديل</button>${operationMode==="cloud"?`<button class="compact-btn" data-assign-committee="${p.id}"><i data-lucide="shuffle"></i> نقل</button>`:""}${(isMainAdmin||isSubAdmin)&&!isWithdrawn?`<button class="compact-btn" data-toggle-withdrawn="${p.id}" data-withdrawn="false"><i data-lucide="user-x"></i> تسجيل انسحاب</button>`:""}<button class="compact-btn danger-compact" data-delete-participant="${p.id}"><i data-lucide="trash-2"></i> حذف</button></div></details></div></td></tr>`}).join(""):`<tr><td class="table-empty" colspan="9">لا توجد أسماء مطابقة</td></tr>`;
  $$(`[data-edit]`).forEach(b=>b.onclick=()=>openParticipantModal(state.participants.find(p=>p.id===b.dataset.edit)));
  $$(`[data-assign-committee]`).forEach(b=>b.onclick=()=>openAssignCommitteeModal(b.dataset.assignCommittee));
  $$(`[data-committee-info]`).forEach(b=>b.onclick=()=>openCommitteeInfoModal(b.dataset.committeeInfo));
  $$(`[data-draw]`).forEach(b=>b.onclick=()=>{navigate("draw");$("#drawParticipant").value=b.dataset.draw;loadParticipantIntoDraw()});lucide.createIcons();
  $$(`[data-result-participant]`).forEach(button=>button.onclick=()=>showResult(drawByParticipant.get(button.dataset.resultParticipant)));
  $$(`[data-delete-participant]`).forEach(button=>button.onclick=()=>confirmDeleteParticipant(button.dataset.deleteParticipant));
  $$(`[data-score]`).forEach(input=>input.onchange=()=>saveParticipantScore(input));
  $$(`[data-request-dr]`).forEach(button=>button.onclick=()=>openRequestDrModal(button.dataset.requestDr));
  $$(`[data-approve-dr-inline]`).forEach(button=>button.onclick=()=>{approveDrRequest(button.dataset.approveDrInline);renderParticipants()});
  $$(`[data-reject-dr-inline]`).forEach(button=>button.onclick=()=>{rejectDrRequest(button.dataset.rejectDrInline);renderParticipants()});
  $$(`[data-cancel-dr]`).forEach(button=>button.onclick=()=>cancelManualDrScore(button.dataset.cancelDr));
  $$(`[data-toggle-withdrawn]`).forEach(button=>button.onclick=()=>toggleParticipantWithdrawn(button.dataset.toggleWithdrawn,button.dataset.withdrawn==="true"));
}
async function toggleParticipantWithdrawn(participantId,currentlyWithdrawn){
  const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;
  if(!currentlyWithdrawn){
    if(!confirm(`تسجيل ${participant.name} منسحبًا؟ سيتم تصفير علامته تلقائيًا وإظهاره مكتملاً عند لجنته.`))return;
    participant.withdrawn=true;participant.score=0;participant.gradedAt=new Date().toISOString();participant.scoreSource="withdrawn";participant.manualEntryBy=currentActorLabel();participant.assessment=null;delete participant.drRequest;
    saveState();
    committeeSessions=committeeSessions.filter(session=>session.participant_id!==participantId);
    let sessionCloseError=null;
    if(operationMode==="cloud"&&cloudEnabled){try{await window.CloudCompetition.deleteParticipantSession(participantId)}catch(error){sessionCloseError=error.message}}
    renderAll();
    toast(sessionCloseError?`تم تسجيل ${participant.name} منسحبًا، لكن تعذر إنهاء جلسة اختباره الجارية على السيرفر: ${sessionCloseError}`:`تم تسجيل ${participant.name} منسحبًا`);
  }else{
    if(!confirm(`إلغاء انسحاب ${participant.name}؟ سيعود لحالة بانتظار العلامة.`))return;
    participant.withdrawn=false;delete participant.score;delete participant.gradedAt;delete participant.scoreSource;delete participant.manualEntryBy;participant.assessment=null;
    saveState();renderAll();toast(`تم إلغاء انسحاب ${participant.name}`);
  }
}
function openRequestDrModal(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;openModal(`<div class="modal-head"><h2>طلب تسجيل يدوي (DR)</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help"><b>${escapeHtml(participant.name)}</b> — يُستخدم فقط عند تعطل النظام وتحويل الاختبار لورقي. يُرسل الطلب للإدارة الرئيسية للموافقة قبل تسجيل العلامة فعليًا.</p><label>العلامة من 100<input id="drRequestScore" type="number" min="0" max="100" step="0.01" placeholder="مثال: 88"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="submitDrRequest" class="primary-btn">إرسال الطلب للإدارة</button></div>`);$("#submitDrRequest").onclick=()=>{const score=Number($("#drRequestScore").value);if(!Number.isFinite(score)||score<0||score>100)return toast("أدخل علامة صحيحة بين 0 و100");participant.drRequest={status:"pending",score:Math.round(score*100)/100,requestedBy:currentActorLabel(),requestedAt:new Date().toISOString()};saveState();closeModal();renderParticipants();toast("تم إرسال الطلب للإدارة، بانتظار الموافقة")}}
function cancelManualDrScore(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;if(!confirm(`إلغاء التسجيل اليدوي لـ ${participant.name}؟ سيعود المتسابق لحالة بانتظار العلامة ويمكن فتح تقييم إلكتروني جديد له.`))return;delete participant.score;delete participant.gradedAt;delete participant.scoreSource;delete participant.manualEntryBy;participant.assessment=null;saveState();renderAll();toast("تم إلغاء التسجيل اليدوي، المتسابق بانتظار العلامة من جديد")}
function renderDrRequests(){const pending=state.participants.filter(p=>p.drRequest?.status==="pending");$("#drRequestsList").innerHTML=pending.length?pending.map(p=>`<div class="committee-row"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.drRequest.requestedBy||"")} · العلامة المطلوبة ${formatAssessmentNumber(p.drRequest.score)} · ${formatDate(p.drRequest.requestedAt)}</small></div><span>${escapeHtml(p.gender||"")}</span><div class="row-actions"><button class="compact-btn" data-approve-dr="${p.id}">موافقة</button><button class="compact-btn danger-compact" data-reject-dr="${p.id}">رفض</button></div></div>`).join(""):`<p class="committee-alerts-empty">لا توجد طلبات حاليًا.</p>`;$$(`[data-approve-dr]`).forEach(button=>button.onclick=()=>{approveDrRequest(button.dataset.approveDr);renderDrRequests();renderParticipants()});$$(`[data-reject-dr]`).forEach(button=>button.onclick=()=>{rejectDrRequest(button.dataset.rejectDr);renderDrRequests();renderParticipants()})}
function approveDrRequest(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant?.drRequest)return;participant.score=participant.drRequest.score;participant.gradedAt=new Date().toISOString();participant.scoreSource="manual";participant.manualEntryBy=participant.drRequest.requestedBy;participant.assessment=null;delete participant.drRequest;saveState();toast(`تم اعتماد علامة ${participant.name} يدويًا`)}
function rejectDrRequest(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant?.drRequest)return;delete participant.drRequest;saveState();toast(`تم رفض طلب ${participant.name}`)}
function approveAllDrRequests(){const pending=state.participants.filter(p=>p.drRequest?.status==="pending");if(!pending.length)return toast("لا توجد طلبات بانتظار الموافقة");pending.forEach(p=>approveDrRequest(p.id));renderDrRequests();renderParticipants();toast(`تمت الموافقة على ${pending.length} طلباً`)}
let issueReportsPollTimer=null,knownIssueReportIds=null;
function stopIssueReportsPoll(){if(issueReportsPollTimer)clearInterval(issueReportsPollTimer);issueReportsPollTimer=null;knownIssueReportIds=null}
function startIssueReportsPoll(){stopIssueReportsPoll();issueReportsPollTimer=setInterval(()=>{if(!document.hidden)renderIssueReports()},6000)}
async function renderIssueReports(){
  const panel=$("#issueReportsPanel");if(!panel)return;
  panel.classList.remove("hidden");
  try{
    const reports=await window.CloudCompetition.listIssueReports();
    const currentIds=new Set(reports.map(r=>r.id));
    if(knownIssueReportIds){
      const fresh=reports.filter(r=>!knownIssueReportIds.has(r.id));
      if(fresh.length===1)toast(`بلاغ خطأ جديد: ${fresh[0].participant_name||"متسابق"} — ${fresh[0].message}`,7000);
      else if(fresh.length>1)toast(`وصلت ${fresh.length} بلاغات أخطاء جديدة من اللجان`,7000);
    }
    knownIssueReportIds=currentIds;
    $("#issueReportsList").innerHTML=reports.length?reports.map(r=>`<div class="committee-row"><div><b>${escapeHtml(r.participant_name||"متسابق غير معروف")}</b><small>${escapeHtml(r.message)} · ${formatDate(r.created_at)}</small></div><div class="row-actions"><button class="compact-btn" data-resolve-issue-report="${r.id}">تم الاطلاع</button></div></div>`).join(""):`<p class="committee-alerts-empty">لا توجد بلاغات حالياً.</p>`;
    $$(`[data-resolve-issue-report]`).forEach(button=>button.onclick=async()=>{button.disabled=true;try{await window.CloudCompetition.resolveIssueReport(Number(button.dataset.resolveIssueReport));renderIssueReports()}catch(error){toast(error.message);button.disabled=false}});
    return true;
  }catch(error){console.warn("تعذر تحميل بلاغات اللجان",error)}
}
function currentActorLabel(){const kind=window.CloudCompetition?.context?.kind;if(kind==="subAdmin")return `مسؤول فرعي: ${window.CloudCompetition.context.subAdmin.name}`;if(kind==="supervisor")return `مشرف المسابقة: ${window.CloudCompetition.context.profile.display_name}`;if(kind==="admin")return "الإدارة";return state.config?.adminName||"الإدارة"}
// تعديل علامة مسجَّلة/معتمدة سابقاً (أي مصدر) متاح للإدارة ومشرف المسابقة معاً بلا قيود — المسؤول الفرعي وحده ممنوع (يستخدم DR فقط).
function canEditParticipantScore(participant){const kind=window.CloudCompetition?.context?.kind;return kind!=="subAdmin"}
// مسؤول فرعي بصلاحية can_edit_final (راجع sub-admin-permissions-toggle.sql) يقدر يوافق/يرفض
// طلبات DR لمتسابقي جنسه مباشرة، بدل انتظار الإدارة — الصلاحية الوحيدة القابلة للتفويض له هون،
// دون المساس بمنع تعديل العلامات المباشر (راجع canEditParticipantScore، قرار سابق منفصل).
function canHandleDrRequests(isMainAdmin,isSupervisor,isSubAdmin){return isMainAdmin||isSupervisor||(isSubAdmin&&Boolean(window.CloudCompetition.context?.subAdmin?.can_edit_final))}
function saveParticipantScore(input){const participant=state.participants.find(p=>p.id===input.dataset.score);if(!participant)return;const score=Number(input.value);if(input.value===""){delete participant.score;delete participant.gradedAt;delete participant.scoreSource;delete participant.manualEntryBy;participant.assessment=null}else if(!Number.isFinite(score)||score<0||score>100){toast("العلامة يجب أن تكون بين 0 و100");input.value=Number.isFinite(participant.score)?participant.score:"";return}else{participant.score=Math.round(score*100)/100;participant.gradedAt=new Date().toISOString();participant.scoreSource="manual";participant.manualEntryBy=currentActorLabel();participant.assessment=null;delete participant.drRequest}saveState();renderDashboard();renderParticipants();toast(Number.isFinite(participant.score)?"تم حفظ العلامة اليدوية، وأُلغيت أي خطوات تقييم إلكتروني سابقة لهذا المتسابق":"تم حذف العلامة وإعادة الحالة إلى بانتظار العلامة")}
function committeeLabelWithRoles(c){const names=[c.chairman_name,c.member_name].filter(Boolean).join(" - ");return names?`${c.name} (${names})`:c.name}
function resolveParticipantCommittee(participant,allCommittees,{includeAllGenders=false}={}){
  const committees=(allCommittees||[]).filter(c=>c.active!==false&&(includeAllGenders||!c.responsible_gender||c.responsible_gender===participant.gender));
  const matchesNaturally=c=>participant.levelName?(c.level_names||[]).includes(participant.levelName):(c.levels||[]).map(Number).includes(Number(participant.level));
  const pinnedId=participant.transferCommitteeId||null;
  const naturalCommittee=pinnedId?null:committees.find(matchesNaturally);
  const currentId=pinnedId||naturalCommittee?.id||null;
  return {committees,currentId,currentCommittee:currentId?committees.find(c=>c.id===currentId):null};
}
function openCommitteeInfoModal(committeeId){
  const isSubAdmin=window.CloudCompetition.context?.kind==="subAdmin",allCommittees=isSubAdmin?subAdminCommittees:cloudCommittees;
  const committee=allCommittees.find(c=>c.id===committeeId);if(!committee)return;
  openModal(`<div class="modal-head"><h2>${escapeHtml(committee.name)}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">رئيس اللجنة: <b>${escapeHtml(committee.chairman_name||"—")}</b></p><p class="field-help">عضو اللجنة: <b>${escapeHtml(committee.member_name||"—")}</b></p></div><div class="modal-actions"><button class="secondary-btn" type="button" data-close>إغلاق</button></div>`);
}
function openAssignCommitteeModal(participantId){
  const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;
  const isSubAdmin=window.CloudCompetition.context?.kind==="subAdmin",isRootAdmin=window.CloudCompetition.context?.kind==="admin",allCommittees=isSubAdmin?subAdminCommittees:cloudCommittees;
  const {committees,currentId,currentCommittee}=resolveParticipantCommittee(participant,allCommittees,{includeAllGenders:isRootAdmin});
  const pinnedId=participant.transferCommitteeId||null;
  const options=committees.filter(c=>c.id!==currentId);
  const rows=options.length?options.map(c=>`<label class="committee-member-toggle"><input type="radio" name="transferTarget" data-transfer-target="${c.id}"> ${escapeHtml(committeeLabelWithRoles(c))}</label>`).join(""):`<p>لا توجد لجان أخرى متاحة.</p>`;
  const currentInfo=pinnedId?`اللجنة الحالية (نُقل يدويًا): <b>${escapeHtml(currentCommittee?committeeLabelWithRoles(currentCommittee):"—")}</b>`:currentCommittee?`اللجنة الحالية (حسب مستواه الطبيعي): <b>${escapeHtml(committeeLabelWithRoles(currentCommittee))}</b>`:"لم يُنقل يدويًا ولا توجد لجنة مطابقة لمستواه حاليًا.";
  openModal(`<div class="modal-head"><h2>نقل ${escapeHtml(participant.name)}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">${currentInfo} اختيار لجنة أخرى ينقل المتسابق إليها فورًا ويُخفيه عن لجنته الحالية.</p><div class="committee-member-fields">${rows}</div>${pinnedId?`<button type="button" id="cancelTransferBtn" class="secondary-btn">إلغاء النقل (إعادة لمستواه الأصلي)</button>`:""}</div><div class="modal-actions"><button class="primary-btn" type="button" data-close>تم</button></div>`);
  const doTransfer=async(committeeId,confirmMessage)=>{if(confirmMessage&&!confirm(confirmMessage))return openAssignCommitteeModal(participantId);try{await window.CloudCompetition.transferParticipant(participantId,committeeId);participant.transferCommitteeId=committeeId||undefined;toast(committeeId?"تم نقل المتسابق":"تم إلغاء النقل")}catch(error){toast(error.message)}openAssignCommitteeModal(participantId)};
  $$(`[data-transfer-target]`).forEach(input=>input.onchange=()=>{const targetId=input.dataset.transferTarget,target=committees.find(c=>c.id===targetId);doTransfer(targetId,`نقل ${participant.name} إلى ${target?committeeLabelWithRoles(target):"اللجنة المختارة"}؟ سيختفي فورًا من لجنته الحالية.`)});
  if($("#cancelTransferBtn"))$("#cancelTransferBtn").onclick=()=>doTransfer(null,"إلغاء نقل المتسابق وإعادته لمستواه الأصلي؟");
}
function confirmDeleteParticipant(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;const draws=state.draws.filter(d=>d.participantId===participantId);openModal(`<div class="modal-head"><h2>حذف المتسابق</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>هل تريد حذف <b>${escapeHtml(participant.name)}</b>؟</p>${draws.length?`<p class="form-error">للمتسابق ${draws.length} سحب محفوظ. سيُحذف معه وتصبح مواضعه متاحة من جديد.</p>`:"<p>لا يوجد لهذا المتسابق سحب محفوظ.</p>"}</div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="deleteParticipantNow" class="danger-btn"><i data-lucide="trash-2"></i> حذف نهائي</button></div>`);$("#deleteParticipantNow").onclick=async()=>{state.deletions=state.deletions||[];state.deletions.push({type:"participant",participant:{id:participant.id,name:participant.name,seat:participant.seat},drawIds:draws.map(d=>d.id),at:new Date().toISOString()});state.participants=state.participants.filter(p=>p.id!==participantId);state.draws=state.draws.filter(d=>d.participantId!==participantId);saveState();committeeSessions=committeeSessions.filter(session=>session.participant_id!==participantId);let sessionCloseError=null;if(operationMode==="cloud"&&cloudEnabled){try{await window.CloudCompetition.deleteParticipantSession(participantId)}catch(error){sessionCloseError=error.message}}closeModal();renderAll();toast(sessionCloseError?`تم حذف المتسابق وسحوباته، لكن تعذر إغلاق جلسة اختباره الجارية على السيرفر: ${sessionCloseError}`:"تم حذف المتسابق وسحوباته")}}
function confirmDeleteAllParticipants(){if(!state.participants.length)return toast("لا يوجد متسابقون لحذفهم");openModal(`<div class="modal-head"><h2>حذف جميع المتسابقين</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سيتم حذف <b>${state.participants.length} متسابقاً</b> من الدورة.</p><p class="form-error">سيتم أيضاً حذف جميع السحوبات والعلامات، وتصبح المواضع متاحة من جديد. إعدادات المسابقة لن تتغير.</p><label>اكتب <b>حذف المتسابقين</b> للتأكيد<input id="deleteAllParticipantsConfirm" autocomplete="off"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="deleteAllParticipantsNow" class="danger-btn"><i data-lucide="trash-2"></i> حذف الجميع</button></div>`);$("#deleteAllParticipantsNow").onclick=()=>{if($("#deleteAllParticipantsConfirm").value.trim()!=="حذف المتسابقين")return toast("اكتب عبارة التأكيد كما تظهر");state.deletions=state.deletions||[];state.deletions.push({type:"all-participants",participantCount:state.participants.length,drawCount:state.draws.length,at:new Date().toISOString()});state.participants=[];state.draws=[];saveState();closeModal();renderAll();toast("تم حذف جميع المتسابقين والسحوبات")}}

// الرقم التسلسلي: يُدخله المسؤول يدوياً (لا توليد تلقائي) ويجب وجوده قبل السحب/بدء الاختبار؛ مصدر الحقيقة الوحيد participant.serialNumber.
function diwanSerialOf(participant){return String(participant?.serialNumber||"").trim()}
const DIWAN_SERIAL_MISSING_MESSAGE="أدخل الرقم التسلسلي للمتسابق أولاً (زر تعديل بيانات المتسابق) قبل السحب وبدء الاختبار";
function nextDiwanSeat(){return String(diwanState.participants.length+1).padStart(3,"0")}
// كل مشارك حافظ كامل بالتعريف — لا اختيار مستوى هنا إطلاقاً، المرحلة (stage) تحدّد كل شيء لاحقاً.
function openDiwanParticipantModal(participant=null){
  openModal(`<form id="diwanParticipantForm"><div class="modal-head"><h2>${participant?"تعديل بيانات المتسابق":"إضافة متسابق"}</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid"><label>اسم المتسابق<input id="dpName" required value="${escapeAttr(participant?.name||"")}"></label><label>رقم الجلوس<input id="dpSeat" required value="${escapeAttr(participant?.seat||nextDiwanSeat())}"></label><label>الرقم التسلسلي<input id="dpSerial" required value="${escapeAttr(participant?.serialNumber||"")}" placeholder="يُدخل قبل بدء الاختبار"></label><label>الجنس<select id="dpGender" required><option value="">اختر</option><option value="ذكر" ${participant?.gender==="ذكر"?"selected":""}>ذكر</option><option value="أنثى" ${participant?.gender==="أنثى"?"selected":""}>أنثى</option></select></label><label>المركز<select id="dpCenter" required>${diwanCenterSelectOptions(participant?.center)}</select></label><label>العمر<input id="dpAge" type="number" min="4" max="100" value="${participant?.age||""}" placeholder="اختياري"></label></div></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button class="primary-btn" type="submit">حفظ المتسابق</button></div></form>`);
  // المسؤول الفرعي: جنس المتسابق = جنس حسابه دائماً (الخادم يرفض غيره أصلاً).
  if(window.CloudCompetition?.context?.kind==="subAdmin"&&isDiwanCloudStaff()){$("#dpGender").value=window.CloudCompetition.context.subAdmin.gender;$("#dpGender").disabled=true}
  $("#diwanParticipantForm").addEventListener("submit",event=>{
    event.preventDefault();
    const newSeat=$("#dpSeat").value.trim();
    if(newSeat&&diwanState.participants.some(p=>p.id!==(participant?.id||null)&&String(p.seat).trim()===newSeat))return toast(`رقم الجلوس ${newSeat} مسجَّل مسبقًا لمتسابق آخر — استخدم رقمًا مختلفًا`);
    const newSerial=normalizeDigits($("#dpSerial").value).trim();
    if(!newSerial)return toast("الرقم التسلسلي مطلوب قبل بدء الاختبار");
    if(diwanState.participants.some(p=>p.id!==(participant?.id||null)&&normalizeDigits(diwanSerialOf(p))===newSerial))return toast(`الرقم التسلسلي ${newSerial} مسجَّل مسبقًا لمتسابق آخر — استخدم رقمًا مختلفًا`);
    const item=participant?{...participant}:{id:uid("DP"),stage:1,usedJuz:[],parts:[],level:10,createdAt:new Date().toISOString()};
    item.name=$("#dpName").value.trim();item.seat=$("#dpSeat").value.trim();item.serialNumber=newSerial;item.gender=$("#dpGender").value;item.center=$("#dpCenter").value.trim();item.age=Number($("#dpAge").value)||null;
    const index=diwanState.participants.findIndex(p=>p.id===item.id);if(index>=0)diwanState.participants[index]=item;else diwanState.participants.push(item);
    saveDiwanState();closeModal();renderDiwanParticipants();toast("تم حفظ بيانات المتسابق");
  });
}
// مواضع القرآن (candidates) مشتركة عالمياً بلا أي منع تكرار (راجع buildCandidates) — إعادة
// استخدام مباشرة بلا أي فحص إضافي، تماماً كما تفعل availableForParts بالمسابقة السنوية.
function diwanAvailableForParts(parts){return candidates.filter(c=>parts.includes(c.juz))}
function nextDiwanDrawSequence(){return Math.max(0,...diwanState.draws.map(draw=>Number(draw.sequence)||0))+1}
// اختيار `count` جزء من `juzPool` (كلها إن تساوى العددان)، موضع عشوائي واحد من كل جزء مختار —
// تُستخدم لمراحل ١-٣ (count=10 من ١٠ أجزاء مختارة) وللنهائي (count=6 لكل مجموعة من ٣، انظر
// makeDiwanFinalDraw). لا علاقة لهذا بـLEVEL_QUESTIONS (نسبة السنوية، غير مناسبة هنا).
function drawOnePositionPerJuz(juzPool,count){
  const pools=new Map(juzPool.map(juz=>[juz,diwanAvailableForParts([juz])]));
  const eligible=juzPool.filter(juz=>pools.get(juz)?.length);
  if(eligible.length<count)throw new Error("لا توجد مواضع كافية ضمن الأجزاء المختارة");
  return secureShuffle(eligible).slice(0,count).map(juz=>pools.get(juz)[randomIndex(pools.get(juz).length)]).sort((a,b)=>a.juz-b.juz);
}
async function makeDiwanStageDraw(participant,chosenJuz){
  if(!diwanSerialOf(participant))throw new Error(DIWAN_SERIAL_MISSING_MESSAGE);
  await ensureQuranReady();
  const positions=drawOnePositionPerJuz(chosenJuz,chosenJuz.length);
  const draw={id:uid("DDRAW"),sequence:nextDiwanDrawSequence(),participantId:participant.id,name:participant.name,seat:participant.seat,center:participant.center,age:participant.age||null,stage:participant.stage,level:Number(participant.level),eligibleParts:[...chosenJuz],positions,createdAt:new Date().toISOString(),rerolls:[],verification:""};
  draw.verification=await createVerification(draw);
  if(isDiwanCloudWriter())Object.assign(draw,await window.DiwanCompetition.createDraw(draw));
  return draw;
}
// الاختبار النهائي: القرآن كامل تلقائياً، ١٨ موضعاً (٦ من كل ثلث)، بلا اختيار يدوي للأجزاء.
async function makeDiwanFinalDraw(participant){
  if(!diwanSerialOf(participant))throw new Error(DIWAN_SERIAL_MISSING_MESSAGE);
  await ensureQuranReady();
  const positions=DIWAN_FINAL_BANDS.flatMap(band=>drawOnePositionPerJuz(band,6)).sort((a,b)=>a.juz-b.juz);
  const draw={id:uid("DDRAW"),sequence:nextDiwanDrawSequence(),participantId:participant.id,name:participant.name,seat:participant.seat,center:participant.center,age:participant.age||null,stage:4,level:30,eligibleParts:Array.from({length:30},(_,i)=>i+1),positions,createdAt:new Date().toISOString(),rerolls:[],verification:""};
  draw.verification=await createVerification(draw);
  if(isDiwanCloudWriter())Object.assign(draw,await window.DiwanCompetition.createDraw(draw));
  return draw;
}
// شبكة اختيار ١٠ أجزاء لمراحل ١-٣ — أجزاء usedJuz (امتُحن بها بمرحلة سابقة ناجحة) تُعلَّم بـ«سبق» للعلم فقط
// ولا تُمنع (يمكن اختيارها لإعادة اختبار أو اختبار جديد)؛ تُحدَّد افتراضياً الـ١٠ المتبقية بمرحلة ٣ وقابلة للتعديل.
// changeOnly: «تغيير الأجزاء» لمتسابق عنده سحب بانتظار اللجنة — تُحفظ الأجزاء الجديدة ويُحذف سحبه الحالي فيعود «بانتظار السحب»
// (يلزم سحب جديد بالأجزاء الجديدة). يُرفض لو بدأت لجنة اختباره (يُفحص من الخادم لحظة الحفظ لا من نسخة قديمة).
function openDiwanJuzPicker(participant,{changeOnly=false}={}){
  if(!participant)return;
  if(!changeOnly&&!diwanSerialOf(participant)){toast(DIWAN_SERIAL_MISSING_MESSAGE);return openDiwanParticipantModal(participant)}
  const used=new Set(participant.usedJuz||[]);
  const remaining=[];for(let j=1;j<=30;j++)if(!used.has(j))remaining.push(j);
  const selected=new Set(changeOnly?(participant.parts||[]):remaining.length<=10?remaining:(participant.parts||[]));
  const rows=[[1,2,3,4,5,6,7,8,9,10],[11,12,13,14,15,16,17,18,19,20],[21,22,23,24,25,26,27,28,29,30]];
  const cellHtml=j=>`<button type="button" class="diwan-juz-cell ${used.has(j)?"is-used ":""}${selected.has(j)?"is-selected":""}" data-juz="${j}" ${used.has(j)?'title="سبق اختبار المتسابق بهذا الجزء (للعلم فقط)"':""}>${j}</button>`;
  const gridHtml=rows.map(row=>`<div class="diwan-juz-row">${row.map(cellHtml).join("")}</div>`).join("");
  openModal(`<div class="modal-head"><h2>اختيار ١٠ أجزاء — ${escapeHtml(DIWAN_STAGE_LABELS[participant.stage]||"")}</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body">${changeOnly?`<p class="form-error">عند الحفظ يُحذف سحبه الحالي (المواضع المسحوبة) ويعود «لم يتم السحب» — ثم اضغط «اختيار الأجزاء والسحب» لسحب جديد بالأجزاء الجديدة.</p>`:""}<p class="field-help">${escapeHtml(participant.name)} — الأجزاء التي عليها علامة «سبق» اختُبر بها المتسابق سابقاً — للعلم فقط، ويمكنك اختيارها مجدداً (لإعادة اختبار أو لاختبار جديد).</p><div id="diwanJuzGrid" class="diwan-juz-grid">${gridHtml}</div><p id="diwanJuzCount" class="field-help"></p><p id="diwanJuzError" class="form-error hidden"></p></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button>${changeOnly?`<button id="confirmDiwanPartsChange" class="primary-btn"><i data-lucide="save"></i> حفظ الأجزاء وحذف السحب الحالي</button>`:`<button id="confirmDiwanJuzDraw" class="primary-btn"><i data-lucide="sparkles"></i> تنفيذ السحب</button>`}</div>`);
  const updateCount=()=>{$("#diwanJuzCount").textContent=`${selected.size} من 10 مختارة`};
  updateCount();
  $("#diwanJuzGrid").addEventListener("click",event=>{
    const cell=event.target.closest("[data-juz]");if(!cell||cell.disabled)return;
    const juz=Number(cell.dataset.juz);
    if(selected.has(juz))selected.delete(juz);
    else{if(selected.size>=10)return toast("اخترت ١٠ أجزاء بالفعل — ألغِ واحداً أولاً");selected.add(juz)}
    cell.classList.toggle("is-selected",selected.has(juz));updateCount();
  });
  if(changeOnly){
    $("#confirmDiwanPartsChange").onclick=async()=>{
      const button=$("#confirmDiwanPartsChange"),error=$("#diwanJuzError");
      if(selected.size!==10){error.textContent="اختر ١٠ أجزاء بالضبط";return error.classList.remove("hidden")}
      const chosenJuz=[...selected].sort((a,b)=>a-b);
      if(chosenJuz.join()===(participant.parts||[]).slice().sort((a,b)=>a-b).join())return toast("لم تتغير الأجزاء");
      button.disabled=true;
      try{
        if(isDiwanCloudWriter())diwanAdminSessions=await window.DiwanCompetition.listViewerSessions();
        const draw=currentDiwanDraw(participant,diwanState.draws),session=draw?diwanSessionForDraw(draw):null;
        if(session){button.disabled=false;error.textContent=session.status==="final"?"اعتُمدت نتيجة هذا السحب — لا يمكن تغيير أجزائه":"بدأت إحدى اللجان اختباره بهذا السحب — أنهوه أو ألغوه أولاً";return error.classList.remove("hidden")}
        participant.parts=chosenJuz;
        if(draw)diwanState.draws=diwanState.draws.filter(item=>item.id!==draw.id);
        saveDiwanState();closeModal();renderDiwanParticipants();
        toast(`تم تغيير أجزاء ${participant.name} وحذف سحبه السابق — بانتظار سحب جديد`);
      }catch(changeError){button.disabled=false;error.textContent=changeError.message;error.classList.remove("hidden")}
    };
    return lucide.createIcons();
  }
  $("#confirmDiwanJuzDraw").onclick=async()=>{
    const button=$("#confirmDiwanJuzDraw"),error=$("#diwanJuzError");
    if(selected.size!==10){error.textContent="اختر ١٠ أجزاء بالضبط";return error.classList.remove("hidden")}
    button.disabled=true;button.textContent="جارٍ سحب مواضع الطالب...";
    try{
      const chosenJuz=[...selected].sort((a,b)=>a-b);
      const draw=await makeDiwanStageDraw(participant,chosenJuz);
      participant.parts=chosenJuz;diwanState.draws.push(draw);saveDiwanState();
      closeModal();renderDiwanParticipants();showDiwanResult(draw);
    }catch(drawError){button.disabled=false;button.textContent="تنفيذ السحب";error.textContent=drawError.message;error.classList.remove("hidden")}
  };
  lucide.createIcons();
}
async function startDiwanFinalDraw(participant){
  if(!participant)return;
  if(!diwanSerialOf(participant)){toast(DIWAN_SERIAL_MISSING_MESSAGE);return openDiwanParticipantModal(participant)}
  if(!confirm(`تنفيذ السحب النهائي (١٨ موضعاً من القرآن كاملاً) لـ${participant.name}؟`))return;
  try{
    const draw=await makeDiwanFinalDraw(participant);
    participant.parts=Array.from({length:30},(_,i)=>i+1);
    diwanState.draws.push(draw);saveDiwanState();
    renderDiwanParticipants();showDiwanResult(draw);
  }catch(error){toast(error.message)}
}
// إعادة محاولة عند الرسوب — بلا حد أقصى (طلب صريح). مراحل ١-٣: يعيد فتح منتقي الأجزاء (معبّأ
// مسبقاً باختيار المحاولة الفاشلة، قابل للتعديل). المرحلة النهائية: سحب مباشر (لا اختيار أجزاء).
function retryDiwanStage(participant){
  if(!participant)return;
  if(participant.stage===4)return startDiwanFinalDraw(participant);
  openDiwanJuzPicker(participant);
}
function showDiwanResult(draw){
  openModal(`<div class="result-modal"><div class="print-only print-letterhead"><div><b>جمعية المحافظة على القرآن الكريم</b><span>فرع الكورة</span></div><strong>بسم الله الرحمن الرحيم</strong></div><div class="result-hero"><div><small>جمعية المحافظة على القرآن الكريم | فرع الكورة</small><h2>ورقة مواضع الاختبار</h2><small>اختبارات ديوان الحفاظ · ${escapeHtml(DIWAN_STAGE_LABELS[draw.stage]||"")}</small></div><div class="draw-code"><small>رقم السحب</small><b>${draw.sequence.toString().padStart(4,"0")}</b><small>${escapeHtml(draw.verification)}</small></div></div><div class="result-person"><div><span>اسم المتسابق</span><b>${escapeHtml(draw.name)}</b></div><div><span>رقم الجلوس</span><b>${escapeHtml(draw.seat||"-")}</b></div><div><span>المركز</span><b>${escapeHtml(draw.center)}</b></div><div><span>المرحلة</span><b>${escapeHtml(DIWAN_STAGE_LABELS[draw.stage]||"")}</b></div><div><span>العمر</span><b>${draw.age||"-"}</b></div></div><div class="positions-list"><div class="positions-title"><span>الرقم</span><span>الموضع المختار</span><span>الصفحة</span></div>${draw.positions.map((p,i)=>positionHtml(p,i)).join("")}</div><div class="print-only print-footer"><span>تصميم وتطوير م. مأمون محمود الفقيه</span><span>تحسين م. محمد عادل الفقيه</span></div><p class="result-warning">تم تثبيت هذه المواضع.</p><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button><button class="primary-btn" onclick="window.print()"><i data-lucide="printer"></i> طباعة النتيجة</button></div></div>`,"result-modal");
  $(".result-modal .modal-actions .primary-btn").insertAdjacentHTML("beforebegin",`<button id="saveResultPdf" class="secondary-btn"><i data-lucide="file-down"></i> حفظ PDF</button>`);
  $("#saveResultPdf").onclick=()=>saveResultAsPdf(draw);
  lucide.createIcons();
  $(".print-letterhead").insertAdjacentHTML("afterbegin",`<img class="print-logo" src="assets/association-logo.png" alt="شعار جمعية المحافظة على القرآن الكريم">`);
  $(".print-letterhead>strong")?.remove();
  $(".print-footer").innerHTML=`<div class="developer-credit"><b>تصميم وتطوير</b><span>م. مأمون محمود الفقيه</span><span>م. محمد عادل الفقيه</span></div>`;
}
// سحب للجميع (مثل «سحب للجميع» بالسنوية): لكل من لا سحب له بمرحلته الحالية — مراحل ١-٣ بأجزائه العشرة المسحوبة من Excel
// (بلا اختيار يدوي)، والنهائي من القرآن كاملاً تلقائياً. من لا أجزاء له أو لا رقم تسلسلي يُتخطّى ويُذكر بالملخص.
function openDiwanBulkDrawModal(){
  const allPending=diwanState.participants.filter(p=>!p.certified&&diwanParticipantStatusOf(p)==="no_draw");
  if(!allPending.length)return toast(diwanState.participants.length?"جميع المتسابقين لديهم سحب بمرحلتهم الحالية":"أضف المتسابقين أو استورد ملف Excel أولاً");
  const hasParts=p=>diwanStageOf(p)===4||(p.parts||[]).length===10;
  const missingParts=allPending.filter(p=>!hasParts(p)),missingSerial=allPending.filter(p=>hasParts(p)&&!diwanSerialOf(p));
  const readyCount=allPending.length-missingParts.length-missingSerial.length;
  const centers=[...new Set(allPending.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
  const stageBoxes=`<label class="committee-member-toggle level-select-all"><input type="checkbox" data-level-all="diwanBulkDrawStage"> <b>كل المراحل</b></label>`+[1,2,3,4].map(stage=>`<label class="committee-member-toggle"><input type="checkbox" name="diwanBulkDrawStage" value="${stage}"> ${DIWAN_STAGE_LABELS[stage]}</label>`).join("");
  openModal(`<div class="modal-head"><h2>سحب لجميع متسابقي ديوان الحفاظ</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سينفذ النظام سحباً مستقلاً لكل متسابق لا سحب له بمرحلته الحالية: المراحل ١-٣ بأجزائه العشرة المسحوبة من ملف Excel، والاختبار النهائي من القرآن كاملاً. حدد فلترة اختيارية أو اتركها فارغة للسحب للجميع.</p><div class="form-grid">${genderFieldHtml("diwanBulkDraw")}</div><fieldset><legend>المركز (اختياري — اتركه فارغًا ليشمل كل المراكز)</legend><div class="committee-level-options">${centerCheckboxesHtml("diwanBulkDrawCenter",centers)}</div></fieldset><fieldset><legend>المرحلة (اختياري — اتركها فارغة لتشمل كل المراحل)</legend><div class="committee-level-options">${stageBoxes}</div></fieldset><div class="bulk-summary"><div><b>${readyCount}</b><span>جاهز للسحب (قبل الفلترة)</span></div><div><b>${diwanState.draws.length}</b><span>سحباً محفوظاً حالياً</span></div></div>${missingParts.length?`<p class="form-error">${missingParts.length} متسابقاً بلا ١٠ أجزاء مسجّلة (استوردها من Excel أو اخترها يدوياً) سيُتخطَّون:</p><div class="missing-parts-list">${missingParts.map(p=>`<span>${escapeHtml(p.name)} · ${escapeHtml(DIWAN_STAGE_LABELS[diwanStageOf(p)])}</span>`).join("")}</div>`:""}${missingSerial.length?`<p class="form-error">${missingSerial.length} متسابقاً بلا رقم تسلسلي سيُتخطَّون: ${missingSerial.map(p=>escapeHtml(p.name)).join("، ")}</p>`:""}<p class="form-error">بعد التنفيذ تصبح المواضع مثبتة.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="confirmDiwanBulkDraw" class="primary-btn" ${readyCount?"":"disabled"}><i data-lucide="layers"></i> تنفيذ السحب لمن أجزاؤه جاهزة</button></div>`);
  wireLevelSelectAll("diwanBulkDrawCenter");wireLevelSelectAll("diwanBulkDrawStage");lucide.createIcons();
  $("#confirmDiwanBulkDraw").onclick=()=>{
    const gender=$("#diwanBulkDrawGender").value,centersSelected=checkedValuesOf("diwanBulkDrawCenter"),stages=checkedValuesOf("diwanBulkDrawStage").map(Number);
    const filtered=allPending.filter(p=>(gender==="all"||p.gender===gender)&&(!centersSelected.length||centersSelected.includes(p.center))&&(!stages.length||stages.includes(diwanStageOf(p))));
    if(!filtered.length)return toast("لا يوجد متسابقون مطابقون للفلتر بانتظار السحب");
    runDiwanBulkDraw(filtered);
  };
}
async function runDiwanBulkDraw(participants){
  const button=$("#confirmDiwanBulkDraw");button.disabled=true;
  let completed=0;const missingPartsNames=[],failedNames=[];
  for(const p of participants){
    button.textContent=`جاري السحب ${completed+missingPartsNames.length+failedNames.length+1} من ${participants.length}`;
    const isFinal=diwanStageOf(p)===4;
    if(!isFinal&&(p.parts||[]).length!==10){missingPartsNames.push(p.name);continue}
    try{
      const draw=isFinal?await makeDiwanFinalDraw(p):await makeDiwanStageDraw(p,[...p.parts].map(Number).sort((a,b)=>a-b));
      if(isFinal)p.parts=Array.from({length:30},(_,i)=>i+1);
      diwanState.draws.push(draw);saveDiwanState();completed++;
    }catch(error){failedNames.push(`${p.name}: ${error.message}`)}
  }
  renderDiwanParticipants();
  openModal(`<div class="modal-head"><h2>اكتمل السحب الجماعي</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="bulk-summary"><div><b>${completed}</b><span>سحباً تم حفظه</span></div><div><b>${missingPartsNames.length+failedNames.length}</b><span>لم يتم سحبه</span></div></div>${missingPartsNames.length?`<p class="form-error"><b>لا أجزاء مسجّلة لهم:</b> ${missingPartsNames.map(escapeHtml).join("، ")}</p>`:""}${failedNames.length?`<p class="form-error"><b>تعذر السحب:</b><br>${failedNames.map(escapeHtml).join("<br>")}</p>`:""}${!missingPartsNames.length&&!failedNames.length?"<p>جميع السحوبات جاهزة، ويمكن فتح ورقة مواضع كل متسابق من بطاقته.</p>":""}</div><div class="modal-actions"><button class="primary-btn" data-close>حسناً</button></div>`);
}
// توزيع متسابقات الديوان على لجان الإناث بالتساوي حسب رقم الجلوس (شرائح متتالية: أول شريحة لأول لجنة…)، عبر نفس «النقل للجنة»
// (transferCommitteeId) فتراها لجنتها فقط. يشمل فقط من لم يبدأ اختبار مرحلته الحالية (لا جلسة) — لا يُمس من بدأ أو اعتُمد، ولا المنسحب.
const diwanSeatNumber=p=>{const n=Number(normalizeDigits(p.seat).replace(/[^\d]/g,""));return Number.isFinite(n)&&String(p.seat||"").trim()?n:Infinity};
const diwanCommitteeNumber=c=>{const m=normalizeDigits(c.name).match(/\d+/);return m?Number(m[0]):Infinity};
function diwanDistributableParticipants(){
  return diwanState.participants.filter(p=>p.gender!=="ذكر"&&!p.certified&&!p.withdrawn&&(()=>{const draw=currentDiwanDraw(p,diwanState.draws);return !draw||!diwanSessionForDraw(draw)})())
    .sort((a,b)=>(diwanSeatNumber(a)-diwanSeatNumber(b))||String(a.seat||"").localeCompare(String(b.seat||""),"ar"));
}
// وقت حضور كل مركز حسب جدول توزيع الديوان المعتمد: الأبكر يُختبَر أولاً، وأي مركز آخر 11:00.
const DIWAN_CENTER_ARRIVAL_DEFAULTS=[["حذيفة","9:00"],["كفر","9:00"],["شرفية","10:00"],["مصعب","10:00"]];
function diwanCenterArrival(center){const name=String(center||""),hit=DIWAN_CENTER_ARRIVAL_DEFAULTS.find(([key])=>name.includes(key));return hit?hit[1]:"11:00"}
const diwanSlotMinutes=slot=>{const [h,m]=String(slot).split(":").map(Number);return (h||0)*60+(m||0)};
// ترتيب الدور: وقت حضور المركز، ثم اسم المركز، ثم رقم الجلوس.
const diwanQueueCompare=(arrivalOf=diwanCenterArrival)=>(a,b)=>(diwanSlotMinutes(arrivalOf(a.center))-diwanSlotMinutes(arrivalOf(b.center)))||String(a.center||"").localeCompare(String(b.center||""),"ar")||(diwanSeatNumber(a)-diwanSeatNumber(b))||String(a.seat||"").localeCompare(String(b.seat||""),"ar");
// الأعداد: متساوية افتراضياً (الباقي على أول اللجان) أو capacities لكل لجنة، وcenters (اختياري) = المراكز المسموحة لكل لجنة.
// المتسابقات يُوزَّعن بالتناوب (لجنة 5، 6، 7…) حسب الدور، ويبدأ التناوب من أول لجنة مع كل وقت حضور،
// وتُتخطّى اللجنة المكتملة أو التي لا تقبل مركز المتسابقة. من لم تتسع لها أي لجنة تبقى في plan.leftover.
function diwanDistributionPlan(participants,committees,{capacities,centers}={}){
  const base=Math.floor(participants.length/Math.max(1,committees.length)),extra=participants.length%Math.max(1,committees.length);
  const plan=committees.map((committee,index)=>({committee,members:[],capacity:capacities?Math.max(0,Math.floor(Number(capacities[index])||0)):base+(index<extra?1:0),centers:centers?.[index]||null}));
  const accepts=(entry,participant)=>!entry.centers||entry.centers.includes(participant.center||"");
  const leftover=[];let slot=null,next=0;
  [...participants].sort(diwanQueueCompare()).forEach(participant=>{
    const arrival=diwanCenterArrival(participant.center);if(arrival!==slot){slot=arrival;next=0}
    for(let step=0;step<plan.length;step++){const index=(next+step)%plan.length,entry=plan[index];if(entry.members.length<entry.capacity&&accepts(entry,participant)){entry.members.push(participant);next=index+1;return}}
    leftover.push(participant);
  });
  // إصلاح: متسابقة بلا مكان لأن لجان مركزها امتلأت بمن تقبلها لجنة أخرى فيها متسع → تُنقل تلك وتأخذ هي مكانها.
  for(let i=leftover.length-1;i>=0;i--){
    const participant=leftover[i];
    swap:for(const full of plan.filter(entry=>accepts(entry,participant)))for(const member of [...full.members].reverse()){const target=plan.find(entry=>entry!==full&&entry.members.length<entry.capacity&&accepts(entry,member));if(target){full.members.splice(full.members.indexOf(member),1,participant);target.members.push(member);leftover.splice(i,1);break swap}}
  }
  const queue=diwanQueueCompare();plan.forEach(entry=>entry.members.sort(queue));
  const result=plan.map(({committee,members})=>({committee,members}));result.leftover=leftover.sort(queue);return result;
}
async function openDiwanDistributeModal(){
  if(!isDiwanCloudWriter())return toast("التوزيع على اللجان متاح بالوضع السحابي فقط");
  if(!isDiwanCloudStaff()&&!cloudCommittees.length)try{cloudCommittees=await window.CloudCompetition.listCommittees()}catch(error){return toast(error.message)}
  const committees=diwanCommitteesList().filter(c=>c.active!==false&&c.responsible_gender==="أنثى").sort((a,b)=>(diwanCommitteeNumber(a)-diwanCommitteeNumber(b))||String(a.name).localeCompare(String(b.name),"ar"));
  if(!committees.length)return toast("لا توجد لجان إناث مفعّلة");
  const eligible=diwanDistributableParticipants();
  if(!eligible.length)return toast("لا توجد متسابقات للتوزيع (الجميع بدأ اختباره أو منسحب أو معتمد)");
  const allCenters=[...new Set(eligible.map(p=>p.center||""))].sort((a,b)=>(diwanSlotMinutes(diwanCenterArrival(a))-diwanSlotMinutes(diwanCenterArrival(b)))||a.localeCompare(b,"ar"));
  const pinned=eligible.filter(p=>p.transferCommitteeId);
  const centerLabel=center=>center||"بلا مركز";
  // تعديلات يدوية فوق الخطة: participantId → committeeId أو "" (بلا لجنة).
  const manual=new Map();
  openModal(`<div class="modal-head"><h2>توزيع المتسابقات على لجان الإناث</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body diwan-distribute">
    <p class="field-help">التوزيع بالتناوب حسب جدول توزيع الديوان. حدّد اللجان والعدد والمراكز لكل لجنة، وعدّل أي متسابقة يدوياً من القوائم بالأسفل قبل التنفيذ. لا يشمل من بدأ اختبارها أو المنسحبات أو المعتمدات.</p>
    <div class="diwan-distribute-options"><label><input type="radio" name="diwanDistributeScope" value="all" checked> كل المتسابقات (${eligible.length})</label><label><input type="radio" name="diwanDistributeScope" value="new"> غير الموزَّعات فقط (${eligible.length-pinned.length}) — تبقى الموزَّعات بلجانهن</label></div>
    <div class="diwan-distribute-options"><label><input type="radio" name="diwanDistributeMode" value="equal" checked> عدد متساوٍ</label><label><input type="radio" name="diwanDistributeMode" value="custom"> عدد مخصص لكل لجنة</label></div>
    <div class="diwan-distribute-rows">${committees.map((c,i)=>`<div class="diwan-distribute-row" data-row="${i}"><label class="diwan-distribute-name"><input type="checkbox" name="diwanDistributeCommittee" value="${c.id}" checked> ${escapeHtml(committeeLabelWithRoles(c))}</label><label class="diwan-distribute-count">العدد <input type="number" min="0" step="1" data-count="${i}"></label><details class="diwan-distribute-centers"><summary class="compact-btn" data-centers-summary="${i}">كل المراكز</summary><div>${allCenters.map(center=>`<label><input type="checkbox" data-center-of="${i}" value="${escapeAttr(center)}" checked> ${escapeHtml(centerLabel(center))}</label>`).join("")}</div></details></div>`).join("")}</div>
    <div id="diwanDistributeTotals" class="field-help"></div>
    <div id="diwanDistributePreview"></div>
  </div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button>${pinned.length?`<button id="diwanUndistributeBtn" class="secondary-btn">إلغاء التوزيع (إظهارهن لكل اللجان)</button>`:""}<button id="confirmDiwanDistribute" class="primary-btn"><i data-lucide="shuffle"></i> تنفيذ التوزيع</button></div>`);
  lucide.createIcons();
  const mode=()=>document.querySelector('[name="diwanDistributeMode"]:checked')?.value||"equal";
  const scoped=()=>(document.querySelector('[name="diwanDistributeScope"]:checked')?.value==="new")?eligible.filter(p=>!p.transferCommitteeId):eligible;
  const chosenRows=()=>committees.map((committee,index)=>({committee,index})).filter(({index})=>$(`[data-row="${index}"] [name="diwanDistributeCommittee"]`).checked);
  const rowCenters=index=>{const boxes=$$(`[data-center-of="${index}"]`),checked=boxes.filter(b=>b.checked).map(b=>b.value);return checked.length===boxes.length?null:checked};
  let current=null;
  // الخطة النهائية = التوزيع التلقائي + التعديلات اليدوية.
  const finalAssignment=()=>{const map=new Map();current.forEach(({committee,members})=>members.forEach(p=>map.set(p.id,committee.id)));current.leftover.forEach(p=>map.set(p.id,""));manual.forEach((committeeId,id)=>{if(map.has(id)&&(committeeId===""||current.some(entry=>entry.committee.id===committeeId)))map.set(id,committeeId)});return map};
  const refresh=()=>{
    const rows=chosenRows(),people=scoped();
    if(mode()==="equal"){const base=Math.floor(people.length/Math.max(1,rows.length)),extra=people.length%Math.max(1,rows.length);rows.forEach(({index},position)=>{$(`[data-count="${index}"]`).value=base+(position<extra?1:0)})}
    committees.forEach((_,index)=>{const active=rows.some(r=>r.index===index),input=$(`[data-count="${index}"]`);input.disabled=!active||mode()==="equal";if(!active)input.value="";const centers=rowCenters(index);$(`[data-centers-summary="${index}"]`).textContent=!centers?"كل المراكز":centers.length?`${centers.length} من ${allCenters.length} مراكز`:"لا مراكز"});
    if(!rows.length){$("#diwanDistributeTotals").innerHTML="";$("#diwanDistributePreview").innerHTML=`<p class="form-error">اختر لجنة واحدة على الأقل</p>`;current=null;return}
    const capacities=rows.map(({index})=>Number($(`[data-count="${index}"]`).value)||0),total=capacities.reduce((a,b)=>a+b,0);
    current=diwanDistributionPlan(people,rows.map(r=>r.committee),{capacities,centers:rows.map(({index})=>rowCenters(index))});
    $("#diwanDistributeTotals").innerHTML=`مجموع الأعداد <b>${total}</b> من <b>${people.length}</b> متسابقة${total>people.length?` — ستبقى ${total-people.length} أماكن فارغة`:""}${current.leftover.length?` — <span class="form-error">${current.leftover.length} لا مكان لها بالأعداد/المراكز المحددة وستبقى بلا لجنة (تظهر لكل لجان الإناث)</span>`:""}`;
    const assignment=finalAssignment();
    const groups=[...rows.map(({committee})=>({id:committee.id,name:committee.name})),{id:"",name:"بلا لجنة (تظهر لكل لجان الإناث)"}].map(group=>({...group,members:people.filter(p=>assignment.get(p.id)===group.id).sort(diwanQueueCompare())})).filter(group=>group.id||group.members.length);
    const options=selectedId=>[...rows.map(({committee})=>`<option value="${committee.id}" ${selectedId===committee.id?"selected":""}>${escapeHtml(committee.name)}</option>`),`<option value="" ${selectedId===""?"selected":""}>بلا لجنة</option>`].join("");
    const openGroups=new Set($$("#diwanDistributePreview details[open]").map(d=>d.dataset.group));
    $("#diwanDistributePreview").innerHTML=`<div class="bulk-summary diwan-distribute-summary">${groups.map(g=>`<div><b>${g.members.length}</b><span>${escapeHtml(g.name)}</span></div>`).join("")}</div>${manual.size?`<p class="field-help">${manual.size} تعديل يدوي · <button type="button" class="compact-btn" id="diwanManualReset">إلغاء التعديلات اليدوية</button></p>`:""}${groups.map(g=>`<details class="diwan-distribute-group" data-group="${g.id}" ${openGroups.has(g.id)?"open":""}><summary><b>${escapeHtml(g.name)}</b> — ${g.members.length} متسابقة</summary><table><tbody>${g.members.map((p,turn)=>`<tr${manual.has(p.id)?' class="diwan-manual-row"':""}><td>${turn+1}</td><td>${escapeHtml(p.seat||"")}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(centerLabel(p.center))}</td><td><select data-move="${p.id}">${options(assignment.get(p.id))}</select></td></tr>`).join("")||`<tr><td class="table-empty">لا أحد</td></tr>`}</tbody></table></details>`).join("")}`;
    $$("[data-move]").forEach(select=>select.onchange=()=>{manual.set(select.dataset.move,select.value);refresh()});
    const reset=$("#diwanManualReset");if(reset)reset.onclick=()=>{manual.clear();refresh()};
  };
  $$('[name="diwanDistributeCommittee"],[name="diwanDistributeMode"],[name="diwanDistributeScope"],[data-center-of]').forEach(input=>input.onchange=refresh);
  $$("[data-count]").forEach(input=>input.oninput=refresh);
  refresh();
  const run=async(assignments,button,doneMessage)=>{
    $$(".modal-actions button").forEach(b=>b.disabled=true);
    let done=0;const failed=[];
    for(const {participant,committeeId} of assignments){
      button.textContent=`جارٍ ${done+failed.length+1} من ${assignments.length}`;
      try{await window.DiwanCompetition.transferParticipant(participant.id,committeeId);participant.transferCommitteeId=committeeId||undefined;done++}catch(error){failed.push(`${participant.name}: ${error.message}`)}
    }
    renderDiwanParticipants();
    openModal(`<div class="modal-head"><h2>${doneMessage}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="bulk-summary"><div><b>${done}</b><span>تم</span></div><div><b>${failed.length}</b><span>تعذّر</span></div></div>${failed.length?`<p class="form-error">${failed.map(escapeHtml).join("<br>")}</p>`:""}</div><div class="modal-actions"><button class="primary-btn" data-close>حسناً</button></div>`);
  };
  $("#confirmDiwanDistribute").onclick=()=>{
    if(!current)return toast("اختر لجنة واحدة على الأقل");
    const assignment=finalAssignment(),people=scoped();
    const assignments=people.map(participant=>({participant,committeeId:assignment.get(participant.id)||null})).filter(({participant,committeeId})=>(participant.transferCommitteeId||null)!==committeeId);
    if(!assignments.length)return toast("التوزيع مطبَّق بالفعل");
    const unassigned=people.filter(p=>!assignment.get(p.id)).length;
    if(!confirm(`تنفيذ التوزيع؟ سيتغيّر ${assignments.length} متسابقة${unassigned?`، و${unassigned} ستبقى بلا لجنة (تظهر لكل لجان الإناث)`:""}.`))return;
    run(assignments,$("#confirmDiwanDistribute"),"اكتمل التوزيع");
  };
  const undo=$("#diwanUndistributeBtn");if(undo)undo.onclick=()=>{if(!confirm(`إلغاء توزيع ${pinned.length} متسابقة وإظهارهن لكل لجان الإناث؟`))return;run(pinned.map(participant=>({participant,committeeId:null})),undo,"أُلغي التوزيع")};
}
function confirmDeleteAllDiwanParticipants(){
  if(!diwanState.participants.length)return toast("لا يوجد متسابقون لحذفهم");
  openModal(`<div class="modal-head"><h2>حذف جميع متسابقي ديوان الحفاظ</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سيتم حذف <b>${diwanState.participants.length} متسابقاً</b> من ديوان الحفاظ.</p><p class="form-error">سيُحذف معهم ${diwanState.draws.length} سحباً بكل المراحل، ولا يمكن التراجع. إعدادات الديوان واللجان لن تتغير.</p><label>اكتب <b>حذف المتسابقين</b> للتأكيد<input id="deleteAllDiwanConfirm" autocomplete="off"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="deleteAllDiwanNow" class="danger-btn"><i data-lucide="trash-2"></i> حذف الجميع</button></div>`);
  lucide.createIcons();
  $("#deleteAllDiwanNow").onclick=()=>{
    if($("#deleteAllDiwanConfirm").value.trim()!=="حذف المتسابقين")return toast("اكتب عبارة التأكيد كما تظهر");
    diwanState.deletions=diwanState.deletions||[];diwanState.deletions.push({type:"all-participants",participantCount:diwanState.participants.length,drawCount:diwanState.draws.length,at:new Date().toISOString()});
    diwanState.participants=[];diwanState.draws=[];saveDiwanState();closeModal();renderDiwanParticipants();toast("تم حذف جميع متسابقي ديوان الحفاظ وسحوباتهم");
  };
}
// انسحاب متسابق ديوان الحفاظ (مثل السنوية): علامته صفر ويظهر «منسحب» للإدارة واللجان بلا زر بدء. يُحفظ ما قبله (العلامة/التقييم)
// ليُستعاد عند إلغاء الانسحاب، وتُحذف جلسة اختبار جارية (غير معتمدة) لسحبه الحالي فقط — النتائج المعتمدة لا تُمس.
async function toggleDiwanParticipantWithdrawn(participant){
  if(!participant||participant.certified)return;
  if(!participant.withdrawn){
    if(!confirm(`تسجيل ${participant.name} منسحبًا؟ ستصبح علامته صفرًا ويظهر منسحبًا عند اللجان.`))return;
    participant.preWithdrawal={score:participant.score??null,gradedAt:participant.gradedAt??null,assessment:participant.assessment??null};
    participant.withdrawn=true;participant.score=0;participant.gradedAt=new Date().toISOString();participant.scoreSource="withdrawn";participant.manualEntryBy=currentActorLabel();participant.assessment=null;
    saveDiwanState();
    const draw=currentDiwanDraw(participant,diwanState.draws),session=draw?diwanSessionForDraw(draw):null;
    let sessionCloseError=null;
    if(session&&session.status!=="final"){
      if(isDiwanCloudWriter()){try{await window.DiwanCompetition.deleteParticipantDraw(draw.id)}catch(error){sessionCloseError=error.message}}
      if(!sessionCloseError)diwanAdminSessions=diwanAdminSessions.filter(item=>item.draw_id!==draw.id);
    }
    renderDiwanParticipants();
    toast(sessionCloseError?`تم تسجيل ${participant.name} منسحبًا، لكن تعذر إنهاء اختباره الجاري على السيرفر: ${sessionCloseError}`:`تم تسجيل ${participant.name} منسحبًا`);
  }else{
    if(!confirm(`إلغاء انسحاب ${participant.name}؟ يعود لحالته السابقة.`))return;
    const before=participant.preWithdrawal||{};
    participant.withdrawn=false;delete participant.scoreSource;delete participant.manualEntryBy;delete participant.preWithdrawal;
    if(Number.isFinite(before.score)){participant.score=before.score;participant.gradedAt=before.gradedAt;participant.assessment=before.assessment}else{delete participant.score;delete participant.gradedAt;participant.assessment=null}
    saveDiwanState();renderDiwanParticipants();toast(`تم إلغاء انسحاب ${participant.name}`);
  }
}
function confirmDeleteDiwanParticipant(participantId){const participant=diwanState.participants.find(p=>p.id===participantId);if(!participant)return;if(!confirm(`حذف ${participant.name} وكل سحوباته المحفوظة (كل المراحل)؟`))return;diwanState.participants=diwanState.participants.filter(p=>p.id!==participantId);diwanState.draws=diwanState.draws.filter(d=>d.participantId!==participantId);saveDiwanState();renderDiwanParticipants();toast("تم الحذف")}
// نقل مشارك ديوان الحفاظ للجنة أخرى — يعيد استخدام resolveParticipantCommittee/cloudCommittees
// المشتركين مع السنوية بلا أي تعديل (نفس مبدأ فرز اللجان: جنس + مستوى/levelName). إدارة فقط
// (لا مسؤول فرعي لديوان الحفاظ حالياً).
function openDiwanAssignCommitteeModal(participantId){
  const participant=diwanState.participants.find(p=>p.id===participantId);if(!participant)return;
  const {committees,currentId,currentCommittee}=resolveParticipantCommittee(participant,diwanCommitteesList(),{includeAllGenders:true});
  const pinnedId=participant.transferCommitteeId||null;
  const options=committees.filter(c=>c.id!==currentId);
  const rows=options.length?options.map(c=>`<label class="committee-member-toggle"><input type="radio" name="diwanTransferTarget" data-diwan-transfer-target="${c.id}"> ${escapeHtml(committeeLabelWithRoles(c))}</label>`).join(""):`<p>لا توجد لجان أخرى متاحة.</p>`;
  const currentInfo=pinnedId?`اللجنة الحالية (نُقل يدويًا): <b>${escapeHtml(currentCommittee?committeeLabelWithRoles(currentCommittee):"—")}</b>`:currentCommittee?`اللجنة الحالية (حسب مرحلته الطبيعية): <b>${escapeHtml(committeeLabelWithRoles(currentCommittee))}</b>`:"لم يُنقل يدويًا ولا توجد لجنة مطابقة لمرحلته حاليًا.";
  openModal(`<div class="modal-head"><h2>نقل ${escapeHtml(participant.name)}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">${currentInfo} اختيار لجنة أخرى ينقل المتسابق إليها فورًا ويُخفيه عن لجنته الحالية.</p><div class="committee-member-fields">${rows}</div>${pinnedId?`<button type="button" id="cancelDiwanTransferBtn" class="secondary-btn">إلغاء النقل (إعادة لمرحلته الطبيعية)</button>`:""}</div><div class="modal-actions"><button class="primary-btn" type="button" data-close>تم</button></div>`);
  const doTransfer=async(committeeId,confirmMessage)=>{if(confirmMessage&&!confirm(confirmMessage))return openDiwanAssignCommitteeModal(participantId);try{await window.DiwanCompetition.transferParticipant(participantId,committeeId);participant.transferCommitteeId=committeeId||undefined;toast(committeeId?"تم نقل المتسابق":"تم إلغاء النقل")}catch(error){toast(error.message)}openDiwanAssignCommitteeModal(participantId)};
  $$(`[data-diwan-transfer-target]`).forEach(input=>input.onchange=()=>{const targetId=input.dataset.diwanTransferTarget,target=committees.find(c=>c.id===targetId);doTransfer(targetId,`نقل ${participant.name} إلى ${target?committeeLabelWithRoles(target):"اللجنة المختارة"}؟ سيختفي فورًا من لجنته الحالية.`)});
  if($("#cancelDiwanTransferBtn"))$("#cancelDiwanTransferBtn").onclick=()=>doTransfer(null,"إلغاء نقل المتسابق وإعادته لمرحلته الطبيعية؟");
}
async function exportDiwanParticipants(){
  if(!diwanState.participants.length)return toast("لا يوجد متسابقون لتصديرهم");
  try{await ensureXlsx()}catch(error){return toast(error.message)}
  if(!cloudCommittees.length&&operationMode==="cloud"&&cloudEnabled)try{cloudCommittees=await window.CloudCompetition.listCommittees()}catch{}
  const rows=diwanState.participants.map(p=>({"رقم الجلوس":p.seat||"","الرقم التسلسلي":diwanSerialOf(p),"اسم المتسابق":p.name,"الجنس":p.gender||"","المركز":p.center||"","اللجنة":diwanAssignedCommittee(p).name,"المرحلة الحالية":p.certified?"حافظ معتمد":`${DIWAN_STAGE_LABELS[p.stage]||""}${p.withdrawn?" (منسحب)":""}`,"الأجزاء":(p.parts||[]).join("، "),"العمر":p.age||"","آخر علامة":Number.isFinite(p.score)?(p.assessment?.incomplete?"غير مكتمل":p.score):""}));
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(rows);sheet["!cols"]=[{wch:12},{wch:14},{wch:32},{wch:10},{wch:22},{wch:20},{wch:18},{wch:30},{wch:10},{wch:10}];sheet["!views"]=[{rightToLeft:true}];workbook.Workbook={Views:[{RTL:true}]};
  XLSX.utils.book_append_sheet(workbook,sheet,"متسابقو ديوان الحفاظ");
  // شيت ثانٍ: من على أي لجنة، مرتّب حسب رقم اللجنة ثم رقم الجلوس.
  const byCommittee=diwanState.participants.map(p=>({p,committee:diwanAssignedCommittee(p)})).sort((a,b)=>(diwanCommitteeNumber(a.committee)-diwanCommitteeNumber(b.committee))||a.committee.name.localeCompare(b.committee.name,"ar")||(diwanSeatNumber(a.p)-diwanSeatNumber(b.p)));
  const committeeSheet=XLSX.utils.json_to_sheet(byCommittee.map(({p,committee})=>({"اللجنة":committee.name,"رقم الجلوس":p.seat||"","الاسم":p.name,"المركز":p.center||"","الحالة":p.withdrawn?"منسحب":p.certified?"حافظ معتمد":DIWAN_STAGE_LABELS[p.stage]||""})));
  committeeSheet["!cols"]=[{wch:20},{wch:12},{wch:32},{wch:22},{wch:18}];committeeSheet["!views"]=[{rightToLeft:true}];
  XLSX.utils.book_append_sheet(workbook,committeeSheet,"توزيع اللجان");
  XLSX.writeFile(workbook,`ديوان-الحفاظ-${dateStamp()}.xlsx`);toast("تم تنزيل ملف المتسابقين");
}
// يعيد استخدام دوال تحليل Excel العامة (rowsFromMatrix/pickColumn) نفسها المستخدمة باستيراد
// المسابقة السنوية بلا أي تعديل — لا عمود مستوى هنا (كل مشارك يبدأ حافظاً كاملاً بالمرحلة ١).
async function importDiwanExcel(event){
  const file=event.target.files[0];if(!file)return;
  try{
    if(!/\.csv$/i.test(file.name))await ensureXlsx();
    const sources=[];
    if(/\.csv$/i.test(file.name)){const text=await file.text();sources.push({matrix:text.replace(/^﻿/,"").split(/\r?\n/).filter(Boolean).map(parseCsvLine)})}
    else{const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});for(const sheetName of workbook.SheetNames){if(String(sheetName).trim()==="تعليمات")continue;sources.push({matrix:XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:"",raw:false})})}}
    let added=0,updated=0,empty=0,duplicateSeat=0,partsImported=0;const importedCenters=new Set(),rejectedNames=[],invalidPartsNames=[],partsKeptNames=[];
    for(const source of sources){
      const parsed=rowsFromMatrix(source.matrix);if(!parsed.hasNameColumn)continue;
      for(const row of parsed.rows){
        const name=pickColumn(row,["الاسم","اسمالمتسابق","اسمالطالب","اسمالمشارك","الاسمالرباعي","اسمالحافظ","المتسابق","الطالب","المشارك","name"]);
        if(!String(name).trim()){empty++;continue}
        let gender=normalizeGender(pickColumn(row,["الجنس","النوع","ذكرانثى","gender","sex"]));
        // المسؤول الفرعي: صفوف الجنس الآخر تُتخطّى (الخادم يرفضها)، وبلا جنس تُسجَّل بجنس حسابه.
        const importerGender=window.CloudCompetition?.context?.kind==="subAdmin"&&isDiwanCloudStaff()?window.CloudCompetition.context.subAdmin?.gender:null;
        if(importerGender){if(!gender)gender=importerGender;else if(gender!==importerGender){rejectedNames.push(`${String(name).trim()}: ${gender} — خارج صلاحية حسابك`);continue}}
        const center=String(pickColumn(row,["المركز","اسمالمركز","المسجد","الدار","الجمعية","center"])||"").trim();
        const seat=String(pickColumn(row,["رقمالجلوس","رقمالمتسابق","الرقم","التسلسل","م","seat"])||"").trim();
        const age=Number(normalizeDigits(pickColumn(row,["العمر","السن","age"])))||null;
        const serial=normalizeDigits(pickColumn(row,["الرقمالتسلسلي","رقمتسلسلي","serial","serialnumber"])).trim();
        // أجزاء المرحلة الحالية من الملف (نفس أعمدة/صيغة استيراد السنوية: «2، 5، 7» أو «1-10») — ١٠ أجزاء بالضبط وإلا تُتجاهل.
        const rawParts=String(pickColumn(row,["الاجزاءالمشاركة","الأجزاءالمشاركة","ارقامالاجزاء","أرقامالأجزاء","الاجزاء","الأجزاء","parts"])||"").trim();
        const fileParts=rawParts?parsePartSpec(rawParts):[];
        const existing=seat?diwanState.participants.find(p=>String(p.seat).trim()===seat):null;
        if(rawParts&&fileParts.length!==10&&!(existing&&(existing.certified||diwanStageOf(existing)===4)))invalidPartsNames.push(`${name} (${fileParts.length} أجزاء)`);
        if(existing&&existing.name.trim()!==String(name).trim()){duplicateSeat++;rejectedNames.push(`${name}: رقم الجلوس ${seat} مسجَّل مسبقًا لمتسابق آخر باسم مختلف (${existing.name})`);continue}
        const serialOwner=serial?diwanState.participants.find(p=>p!==existing&&normalizeDigits(diwanSerialOf(p))===serial):null;
        if(serialOwner){duplicateSeat++;rejectedNames.push(`${name}: الرقم التسلسلي ${serial} مسجَّل مسبقًا للمتسابق ${serialOwner.name}`);continue}
        const validParts=fileParts.length===10?fileParts:null;
        if(existing){
          existing.name=String(name).trim();existing.gender=gender;existing.center=center;existing.age=age;if(serial)existing.serialNumber=serial;
          // لا نغيّر أجزاء من له سحب بانتظار اللجنة (أجزاؤه تُرحَّل لـusedJuz عند نجاحه)، ولا أجزاء المرحلة النهائية (القرآن كاملاً تلقائياً).
          if(validParts&&!existing.certified&&diwanStageOf(existing)<4){if(diwanParticipantStatusOf(existing)==="pending")partsKeptNames.push(existing.name);else{existing.parts=validParts;partsImported++}}
          updated++;if(center)importedCenters.add(center);
        }else{
          const item={id:uid("DP"),name:String(name).trim(),seat:seat||nextDiwanSeat(),serialNumber:serial,gender,center,age,stage:1,usedJuz:[],parts:validParts||[],level:10,createdAt:new Date().toISOString()};
          if(validParts)partsImported++;
          diwanState.participants.push(item);added++;if(center)importedCenters.add(center);
        }
      }
    }
    if(!added&&!updated)throw new Error("لم أجد شيتاً يحتوي على عمود لأسماء المتسابقين.");
    saveDiwanState();renderDiwanParticipants();
    openModal(`<div class="modal-head"><h2>اكتمل استيراد ملف Excel</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="bulk-summary"><div><b>${added}</b><span>متسابقاً تمت إضافتهم</span></div><div><b>${updated}</b><span>تم تحديث بياناتهم</span></div><div><b>${importedCenters.size}</b><span>مركزاً</span></div><div><b>${partsImported}</b><span>سُحبت أجزاؤهم من الملف</span></div></div>${invalidPartsNames.length?`<p class="form-error"><b>${invalidPartsNames.length} متسابقاً</b> — خانة الأجزاء بالملف لا تحوي ١٠ أجزاء بالضبط فلم تُعتمد: ${invalidPartsNames.map(escapeHtml).join("، ")}</p>`:""}${partsKeptNames.length?`<p class="form-error"><b>${partsKeptNames.length} متسابقاً</b> — لديهم سحب بانتظار اللجنة فبقيت أجزاؤه كما هي: ${partsKeptNames.map(escapeHtml).join("، ")}</p>`:""}${duplicateSeat?`<p class="form-error"><b>${duplicateSeat} متسابقاً لم يُسجَّلوا</b> — رقم جلوسهم مكرر مع متسابق آخر.</p>`:""}${rejectedNames.length?`<details><summary>عرض الأسماء المستبعدة وأسبابها</summary><p>${rejectedNames.map(escapeHtml).join("<br>")}</p></details>`:""}${empty?`<p>تم تجاوز ${empty} صفوف فارغة.</p>`:""}</div><div class="modal-actions"><button class="primary-btn" data-close>حسناً</button></div>`);
  }catch(error){openModal(`<div class="modal-head"><h2>تعذر استيراد الملف</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>${escapeHtml(error.message||"تعذر قراءة ملف Excel")}</p><p class="form-error">يجب أن يحتوي الملف على عمود لاسم المتسابق.</p></div><div class="modal-actions"><button class="primary-btn" data-close>حسناً</button></div>`)}
  event.target.value="";
}
// حالة المشارك بمرحلته الحالية تحديداً: لا سحب بعد، بانتظار العلامة (سُحب لكن لم يُعتمد شيء
// جديد بهذه المرحلة)، راسب (آخر محاولة بهذه المرحلة اعتُمدت ولم ترفعه)، أو حافظ معتمد.
function diwanParticipantStatusOf(participant){
  if(participant.certified)return "certified";
  if(participant.withdrawn)return "withdrawn";
  const draw=currentDiwanDraw(participant,diwanState.draws);
  if(!draw)return "no_draw";
  return participant.lastGradedDrawId===draw.id?"failed":"pending";
}
// فلاتر متتالية لشاشة متسابقي ديوان الحفاظ — نفس منهجية populateParticipantFilterOptions
// بالسنوية بالضبط (poolExcluding/متشابكة) بس بمفرداتها الخاصة (status/stage بدل status/level)، مبنية
// كدالة موازية منفصلة لا كإعادة استخدام مباشر — نفس نهج ديوان الحفاظ بكل شاشاته السابقة (مثل
// saveDiwanAssessmentDraft مقابل saveAssessmentDraft) تفادياً لأي مخاطرة على منطق السنوية المعتمد.
// «ناجح»: من اجتاز هذه المرحلة وانتقل للتالية — يبقى ظاهراً بصفحة المرحلة التي نجح فيها مع علامته (لا يلزم فتح المرحلة التالية لرؤية النتائج).
function diwanPassedStageSession(p,stage){
  if(stage==null||diwanStageOf(p)<=stage)return null;
  const passed=diwanAdminSessions.filter(x=>x.participant_id===p.id&&Number(x.stage)===stage&&x.status==="final"&&!x.assessment?.incomplete&&Number(x.score)>=DIWAN_PASS_SCORE);
  return passed.length?passed.reduce((best,x)=>new Date(x.finalized_at||x.updated_at)>new Date(best.finalized_at||best.updated_at)?x:best):null;
}
function diwanStageStatusOf(p,stage){return diwanPassedStageSession(p,stage)?"passed":diwanParticipantStatusOf(p)}
function diwanStageMembers(stage){return diwanState.participants.filter(p=>diwanStageOf(p)===stage||diwanPassedStageSession(p,stage))}
const DIWAN_COMPLETED_STATUSES=new Set(["passed","failed","certified"]);
// راسب بهذه المرحلة ثم أُعيد سحبه/تغيّرت أجزاؤه (إعادة اختبار) — تبقى نتيجة رسوبه المعتمدة ظاهرة بعلامتها ضمن «مكتمل الاختبار».
function diwanFailedStageSession(p,stage){
  const status=diwanParticipantStatusOf(p);
  if(stage==null||diwanStageOf(p)!==stage||(status!=="pending"&&status!=="no_draw"))return null;
  const failed=diwanAdminSessions.filter(x=>x.participant_id===p.id&&Number(x.stage)===stage&&x.status==="final"&&(x.assessment?.incomplete||Number(x.score)<DIWAN_PASS_SCORE));
  return failed.length?failed.reduce((best,x)=>new Date(x.finalized_at||x.updated_at)>new Date(best.finalized_at||best.updated_at)?x:best):null;
}
function diwanStageCompleted(p,stage){return DIWAN_COMPLETED_STATUSES.has(diwanStageStatusOf(p,stage))||!!diwanFailedStageSession(p,stage)}
// خيارات فلتر الحالة بلا تداخل: كل متسابق بخيار واحد فقط — «مكتمل الاختبار» يجمع الناجح/الحافظ المعتمد/الراسب (ومنهم الراسب المعاد سحبه).
const DIWAN_STATUS_OPTIONS=[{value:"completed",label:"مكتمل الاختبار — ناجح أو راسب"},{value:"no_draw",label:"لم يتم اختيار الأجزاء بعد"},{value:"pending",label:"تم السحب — بانتظار اللجنة"},{value:"withdrawn",label:"منسحب"}];
function diwanFilterStatusOf(p,stage){return diwanStageCompleted(p,stage)?"completed":diwanStageStatusOf(p,stage)}
function diwanParticipantCommitteeId(p){return diwanAssignedCommittee(p).id||"none"}
function diwanParticipantMatchesFilters(p,filters){
  if(filters.status!=="all"&&diwanFilterStatusOf(p,diwanOpenStage)!==filters.status)return false;
  if(filters.gender!=="all"&&p.gender!==filters.gender)return false;
  if(filters.center!=="all"&&p.center!==filters.center)return false;
  if(filters.committee!=="all"&&diwanParticipantCommitteeId(p)!==filters.committee)return false;
  return true;
}
function populateDiwanParticipantFilterOptions(){
  const statusSelect=$("#diwanStatusFilter"),genderSelect=$("#diwanGenderFilter"),centerSelect=$("#diwanCenterFilter"),committeeSelect=$("#diwanCommitteeFilter");
  if(!statusSelect)return;
  const current={status:statusSelect.value,gender:genderSelect.value,center:centerSelect.value,committee:committeeSelect?.value||"all"};
  const poolExcluding=dimension=>(diwanOpenStage==null?diwanState.participants:diwanStageMembers(diwanOpenStage)).filter(p=>diwanParticipantMatchesFilters(p,{...current,[dimension]:"all"}));

  const statusPool=poolExcluding("status");
  const statusCounts=new Map();statusPool.forEach(p=>{const key=diwanFilterStatusOf(p,diwanOpenStage);statusCounts.set(key,(statusCounts.get(key)||0)+1)});
  const availableStatuses=new Set(statusCounts.keys());
  statusSelect.innerHTML=`<option value="all">جميع الحالات</option>`+DIWAN_STATUS_OPTIONS.filter(o=>availableStatuses.has(o.value)).map(o=>`<option value="${o.value}">${o.label} (${formatNumber(statusCounts.get(o.value))})</option>`).join("");
  statusSelect.value=availableStatuses.has(current.status)?current.status:"all";current.status=statusSelect.value;

  const genderPool=poolExcluding("gender");
  const availableGenders=new Set(genderPool.map(p=>p.gender).filter(Boolean));
  genderSelect.innerHTML=`<option value="all">الجنس: الكل</option>`+["ذكر","أنثى"].filter(g=>availableGenders.has(g)).map(g=>`<option value="${g}">${g==="أنثى"?"إناث":"ذكور"}</option>`).join("");
  genderSelect.value=availableGenders.has(current.gender)?current.gender:"all";current.gender=genderSelect.value;

  const centerPool=poolExcluding("center");
  const availableCenters=[...new Set(centerPool.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  centerSelect.innerHTML=`<option value="all">المركز: الكل</option>`+availableCenters.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  centerSelect.value=availableCenters.includes(current.center)?current.center:"all";current.center=centerSelect.value;

  if(committeeSelect){
    const committeePool=poolExcluding("committee");
    const counts=new Map();committeePool.forEach(p=>{const id=diwanParticipantCommitteeId(p);counts.set(id,(counts.get(id)||0)+1)});
    const staffGender=window.CloudCompetition?.context?.kind==="subAdmin"?window.CloudCompetition.context.subAdmin?.gender:null;
    const committees=diwanCommitteesList().filter(c=>(c.active!==false&&(!staffGender||!c.responsible_gender||c.responsible_gender===staffGender))||counts.has(c.id))
      .sort((a,b)=>(diwanCommitteeNumber(a)-diwanCommitteeNumber(b))||String(a.name).localeCompare(String(b.name),"ar"));
    const ids=new Set(["none",...committees.map(c=>c.id)]);
    committeeSelect.innerHTML=`<option value="all">اللجنة: الكل</option>`+committees.map(c=>`<option value="${c.id}">${escapeHtml(c.name)} (${formatNumber(counts.get(c.id)||0)})</option>`).join("")+`<option value="none">بلا لجنة محددة / كل لجان الإناث (${formatNumber(counts.get("none")||0)})</option>`;
    committeeSelect.value=ids.has(current.committee)?current.committee:"all";
  }
}
const DIWAN_PARTICIPANT_LIST_UI_KEY="competition-diwan-participant-list-ui";
function saveDiwanPersistedParticipantFilters(){safeSetItem(DIWAN_PARTICIPANT_LIST_UI_KEY,JSON.stringify({diwanStatusFilter:$("#diwanStatusFilter")?.value||"all",diwanGenderFilter:$("#diwanGenderFilter")?.value||"all",diwanCenterFilter:$("#diwanCenterFilter")?.value||"all",diwanCommitteeFilter:$("#diwanCommitteeFilter")?.value||"all"}))}
function loadDiwanPersistedParticipantFilters(){try{return JSON.parse(localStorage.getItem(DIWAN_PARTICIPANT_LIST_UI_KEY)||"null")||{}}catch{return {}}}
function diwanSessionForDraw(draw){return draw?diwanAdminSessions.find(s=>s.draw_id===draw.id):null}
function diwanGenderWord(participant,male,female){return participant?.gender==="أنثى"?female:male}
function formatDiwanCertDate(value){const date=value?new Date(value):new Date();return `${String(date.getDate()).padStart(2,"0")}/${String(date.getMonth()+1).padStart(2,"0")}/${date.getFullYear()}`}
// شبكة الـ30 جزءاً المُظلَّلة — نفس نمط assoc-parts-grid/marked المستخدم أصلاً ببطاقة اختبار
// الجمعية (associationCardHtml)، بلا أي تعديل على الأصل، فقط إعادة استخدام لنفس الأسلوب البصري.
function diwanJuzGridHtml(markedSet){return Array.from({length:30},(_,i)=>i+1).map(n=>`<span class="${markedSet.has(n)?"marked":""}">${n}</span>`).join("")}
// كل الأجزاء المُجازة فعلياً حتى مرحلة معيّنة (اتحاد أجزاء كل محاولة ناجحة بمرحلة <= stage) —
// يُعاد بناؤها من التاريخ الكامل (diwanState.draws + diwanAdminSessions) لا من usedJuz الحالي
// وحده، لأن usedJuz قد يكون تقدّم لاحقاً بعد صدور هذه الشهادة تحديداً.
function diwanCumulativeJuzThroughStage(participant,stage){
  const juz=new Set();
  diwanState.draws.filter(draw=>draw.participantId===participant.id&&draw.stage<=stage).forEach(draw=>{
    const session=diwanSessionForDraw(draw);
    if(session&&session.status==="final"&&!session.assessment?.incomplete&&Number(session.score)>=DIWAN_PASS_SCORE)(draw.eligibleParts||[]).forEach(j=>juz.add(j));
  });
  return juz;
}
// ===== مستندات ديوان الحفاظ (شهادة حافظ / توصية اللجنة) =====
// القوالب الرسمية (assets/diwan-*.jpg بدقة 1241×1754) خلفية كاملة الصفحة كما هي بلا أي تعديل، والبيانات
// حقول متراكبة بإحداثيات القالب نفسه (نسب مئوية من أبعاده)، والأجزاء شبكة من ٣٠ خلية تُرسم كاملةً فوق
// القالب (مظلَّلة/غير مظلَّلة حسب أجزاء المحاولة الفعلية) فلا يبقى أي تظليل ثابت من القالب نفسه.
const DIWAN_DOC_W=1241,DIWAN_DOC_H=1754;
const DIWAN_DOC_TEMPLATES={
  certificate:{stage:"assets/diwan-cert-10juz.jpg",final:"assets/diwan-cert-full.jpg"},
  recommendation:{stage:"assets/diwan-rec-stage.jpg",final:"assets/diwan-rec-full.jpg"}
};
// أزاحة الصفوف بين قالب الشهادة وقالب التوصية (عنوان التوصية أطول بسطر الاختبار الفرعي).
const DIWAN_DOC_GEOMETRY={
  certificate:{rows:[449,491,533],grid:[637,699],score:796},
  recommendation:{rows:[482,524,566],grid:[671,733],score:832}
};
function diwanDocBox(x,y,w,h,inner,cls="",style=""){
  const pct=(value,total)=>(value/total*100).toFixed(3);
  return `<div class="diwan-doc-field ${cls}" style="left:${pct(x,DIWAN_DOC_W)}%;top:${pct(y,DIWAN_DOC_H)}%;width:${pct(w,DIWAN_DOC_W)}%;height:${pct(h,DIWAN_DOC_H)}%;${style}">${inner}</div>`;
}
// يصغّر الخط تدريجياً (تقدير عرض الحرف ≈ ٠٫٥٦ من حجم الخط) للأسماء/المراكز الطويلة كي لا تتجاوز عرض الخانة المحددة بالقالب.
function diwanDocFitStyle(text,basePx,widthImgPx,minPx=9){
  const availablePx=widthImgPx*794/DIWAN_DOC_W-8,estimatedPx=Math.max(String(text||"").length,1)*basePx*.56;
  return `font-size:${Math.max(minPx,basePx*Math.min(1,availablePx/estimatedPx)).toFixed(1)}px`;
}
function diwanDocDateParts(value){const date=value?new Date(value):new Date();return {day:String(date.getDate()).padStart(2,"0"),month:String(date.getMonth()+1).padStart(2,"0"),year:String(date.getFullYear())}}
function diwanDocLevelText(draw){return draw?.stage===4?"القرآن الكريم كاملاً":`${DIWAN_STAGE_LABELS[draw?.stage]||""} · ${(draw?.eligibleParts||[]).length||10} أجزاء`}
// شبكة الأجزاء: ١-١٥ بالصف الأول و١٦-٣٠ بالثاني، الجزء ١ أقصى اليمين (نفس ترتيب القالب).
function diwanDocPartsGridHtml(markedSet,rowsY){
  return Array.from({length:30},(_,index)=>{
    const number=index+1,row=number<=15?0:1,column=(number-1)%15;
    return diwanDocBox(1053-66*column-2,rowsY[row]-2,62,59,number,`diwan-doc-cell${markedSet.has(number)?" marked":""}`);
  }).join("");
}
// الجدول العلوي (الاسم/الرقم/المركز/المستوى/تاريخ الاختبار) — مشترك بين الشهادة والتوصية.
function diwanDocInfoTableHtml(participant,draw,session,geometry){
  const [rowName,rowNumber,rowLevel]=geometry.rows,date=diwanDocDateParts(session?.finalized_at);
  return diwanDocBox(132,rowName+1,830,38,escapeHtml(participant.name),"diwan-doc-value",diwanDocFitStyle(participant.name,18,830,11))
    +diwanDocBox(622,rowNumber+1,340,38,escapeHtml(participant.seat||""),"diwan-doc-value")
    +diwanDocBox(132,rowNumber+1,340,38,escapeHtml(participant.center||""),"diwan-doc-value",diwanDocFitStyle(participant.center,18,340,11))
    +diwanDocBox(622,rowLevel+1,340,38,escapeHtml(diwanDocLevelText(draw)),"diwan-doc-value",diwanDocFitStyle(diwanDocLevelText(draw),18,340,11))
    +diwanDocBox(132,rowLevel+1,340,38,`${date.day}/${date.month}/${date.year}`,"diwan-doc-value");
}
function diwanDocScoreHtml(session,geometry){
  const incomplete=Boolean(session?.assessment?.incomplete);
  return diwanDocBox(316,geometry.score,694,36,incomplete?"غير مكتمل":formatAssessmentNumber(session?.score),"diwan-doc-value")
    +(incomplete?"":diwanDocBox(160,geometry.score,120,36,"100","diwan-doc-value"));
}
function diwanDocSerialHtml(participant){
  return diwanDocBox(638,1598,190,34,escapeHtml(diwanSerialOf(participant)),"diwan-doc-value diwan-doc-small");
}
// شهادة الحافظ: HTML/CSS خالص (بلا صورة خلفية) بنفس تصميم القالب القديم — النص والحدود والشبكة متجهية فتخرج حادّة، وتُملأ الحقول مباشرة بلا إحداثيات.
// الصياغة تتبع جنس المشارك (الطالبة/الطالب…)، والأجزاء المظلَّلة من سحب المحاولة نفسها. logos = {association, diwan} بصيغة data URL.
// أجزاء مشتركة بين الشهادة والتوصية (نفس الترويسة والجدول والشبكة والتذييل).
const diwanDocFit=(text,base,width,min=10)=>`font-size:${Math.max(min,base*Math.min(1,(width-10)/(Math.max(String(text||"").length,1)*base*.56))).toFixed(1)}px`;
function diwanDocHeaderHtml(female,logos={}){
  return `<div class="hc-bismillah">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>
      <div class="hc-head">
        ${logos.association?`<img class="hc-logo" src="${escapeAttr(logos.association)}" alt="">`:`<span class="hc-logo"></span>`}
        <div class="hc-head-text"><small>المملكة الأردنية الهاشمية</small><b>جمعيّة المحافظة على القرآن الكريم</b><span>فرع لواء الكورة — ${female?"ديوان الحافظات":"ديوان الحفاظ"}</span></div>
        ${logos.diwan?`<img class="hc-logo hc-logo-diwan" src="${escapeAttr(logos.diwan)}" alt="">`:`<span class="hc-logo"></span>`}
      </div>
      <div class="hc-rule"><i></i></div>`;
}
function diwanDocInfoHtml(participant,draw,date,female){
  const cell=(label,value,extraClass="",style="")=>`<div class="hc-label">${label}</div><div class="hc-value ${extraClass}" style="${style}">${value}</div>`;
  return `<div class="hc-info">
        ${cell("الاسم",escapeHtml(participant.name||""),"hc-span",diwanDocFit(participant.name,16,520,11))}
        ${cell("الرقم",escapeHtml(participant.seat||""))}${cell("المركز",escapeHtml(participant.center||""),"",diwanDocFit(participant.center,16,190,10))}
        ${cell("المستوى",escapeHtml(diwanDocLevelText(draw)),"",diwanDocFit(diwanDocLevelText(draw),16,190,10))}${cell("تاريخ الاختبار",`<bdi dir="ltr">${date.day}/${date.month}/${date.year}</bdi>`)}
      </div>`;
}
function diwanDocPartsHtml(draw){
  const marked=new Set(draw?.eligibleParts||[]);
  return `<div class="hc-parts">${Array.from({length:30},(_,index)=>{const n=index+1,row=n<=15?1:2,col=n<=15?n:n-15;return `<i class="hc-part${marked.has(n)?" is-marked":""}" style="grid-row:${row};grid-column:${col}">${n}</i>`}).join("")}</div>`;
}
function diwanDocFooterHtml(participant,firstLabel="رقم الشهادة:"){
  return `<div class="hc-foot">
        <div class="hc-foot-numbers"><p><span>${firstLabel}</span><b></b></p><p><span>الرقم التسلسلي:</span><b>${escapeHtml(diwanSerialOf(participant))}</b></p></div>
        <div class="hc-foot-sign"><small>مدير الفرع</small><b>قيس العوايشة</b></div>
      </div>`;
}
function diwanHafizCertificateHtml(participant,draw,session,logos={}){
  const female=participant.gender!=="ذكر",isFinal=draw?.stage===4,date=diwanDocDateParts(session?.finalized_at);
  const fit=diwanDocFit;
  const name=escapeHtml(participant.name||""),center=escapeHtml(participant.center||"");
  const incomplete=Boolean(session?.assessment?.incomplete);
  const score=incomplete?"غير مكتمل":formatAssessmentNumber(session?.score);
  const body=isFinal
    ?`تشهد جمعيّة المحافظة على القرآن الكريم / فرع الكورة أنّ <u class="hc-fill" style="${fit(participant.name,19,340,13)}">${name}</u>، من مركز: <u class="hc-fill" style="${fit(participant.center,19,190,12)}">${center}</u>، قد أتمّ${female?"ت":""} متطلبات الحصول على شهادة الحافظ لكتاب الله غيباً عن ظهر قلب، ونوصي ${female?"الحافظة":"الحافظ"} بتقوى الله والتخلّق بأخلاق القرآن الكريم.`
    :`تشهد جمعيّة المحافظة على القرآن الكريم / فرع الكورة أنّ <u class="hc-fill" style="${fit(participant.name,19,340,13)}">${name}</u>، من مركز: <u class="hc-fill" style="${fit(participant.center,19,190,12)}">${center}</u>، قد أتمّ${female?"ت":""} متطلبات الحصول على شهادة حفظ عشرة أجزاء، ونوصي${female?"ها":"ه"} بتقوى الله والتخلّق بأخلاق القرآن الكريم.`;
  return `<div class="pdf-export-sheet diwan-doc-sheet hc-sheet">
    <div class="hc-frame"></div>
    <div class="hc-inner">
      ${diwanDocHeaderHtml(female,logos)}
      <div class="hc-title">${female?"شهادة حافظة":"شهادة حافظ"}</div>
      <div class="hc-mid">
      ${diwanDocInfoHtml(participant,draw,date,female)}
      <div class="hc-score">
        <div class="hc-score-row"><span>العلامة:</span><b dir="ltr">${score}${incomplete?"":` <em>/ 100</em>`}</b></div>
        <div class="hc-score-row"><span>النتيجة:</span><strong class="hc-badge${incomplete?" is-warn":""}">${incomplete?"غير مكتمل":"ناجح"}</strong></div>
      </div>
      </div>
      <div class="hc-section">الأجزاء المشمولة في الاختبار</div>
      ${diwanDocPartsHtml(draw)}
      <div class="hc-stars"><i>✦</i><i>✦</i><i>✦</i></div>
      <p class="hc-body">${body}</p>
      <p class="hc-place">في دير أبي سعيد بتاريخ: <b><bdi dir="ltr">${date.day}/${date.month}/${date.year}</bdi></b></p>
      ${diwanDocFooterHtml(participant)}
    </div>
  </div>`;
}
// نقاط التوصية الفعلية: ما كتبته الإدارة (draw.adminRecommendation) إن وُجد — تحسباً لنسيان اللجنة أو لتصحيحها — وإلا ما كتبته اللجنة عند الاعتماد.
function diwanRecommendationLines(draw,session){
  const clean=list=>Array.isArray(list)?list.map(x=>String(x||"").trim()).filter(Boolean):[];
  const admin=clean(draw?.adminRecommendation),committee=clean(session?.assessment?.recommendation);
  return (admin.length?admin:committee).slice(0,DIWAN_RECOMMENDATION_MAX_POINTS);
}
// أسماء اللجنة التي امتحنت المحاولة: من سجل اللجان الحالي (cloudCommittees) بمعرّف لجنة الجلسة، وإلا من لقطة الأسماء المحفوظة بالتقييم.
function diwanDocCommitteeMembers(session){
  const assessment=session?.assessment||{},id=assessment.committee?.id||session?.committee_id;
  const committee=id?cloudCommittees.find(c=>c.id===id):null;
  return {chairman:String(committee?.chairman_name||assessment.committeeChairmanName||"").trim(),member:String(committee?.member_name||assessment.committeeMemberName||"").trim()};
}
// وثيقة التوصية: HTML/CSS خالص بنفس ألوان الشهادة لكن A4 عمودي. بلا أجزاء ولا موعد إعادة ولا رقم شهادة ولا توقيع مدير —
// الرقم التسلسلي وحده أعلى الوثيقة، و«ملاحظات اللجنة» خمسة أسطر مرقّمة، والتوقيع لرئيس اللجنة وعضوها. التاريخ سنة/شهر/يوم.
function diwanRecommendationHtml(participant,draw,session,logos={}){
  const female=participant.gender!=="ذكر",date=diwanDocDateParts(session?.finalized_at),lines=diwanRecommendationLines(draw,session);
  const incomplete=Boolean(session?.assessment?.incomplete);
  const score=incomplete?"غير مكتمل":formatAssessmentNumber(session?.score);
  const name=escapeHtml(participant.name||""),serial=diwanSerialOf(participant),{chairman,member}=diwanDocCommitteeMembers(session);
  const cell=(label,value,extraClass="",style="")=>`<div class="hc-label">${label}</div><div class="hc-value ${extraClass}" style="${style}">${value}</div>`;
  const rows=Array.from({length:DIWAN_RECOMMENDATION_MAX_POINTS},(_,index)=>lines[index]?`<li><span class="hc-rec-num">${index+1}.</span>${escapeHtml(lines[index])}</li>`:`<li></li>`).join("");
  const sign=(role,person)=>`<div class="hc-rec-sign"><small>${role}</small><b>${escapeHtml(person)||"&nbsp;"}</b><i></i><span>التوقيع</span></div>`;
  return `<div class="pdf-export-sheet diwan-doc-sheet hc-sheet hc-rec">
    <div class="hc-frame"></div>
    <div class="hc-inner">
      ${serial?`<div class="hc-rec-serial"><span>الرقم التسلسلي:</span><b>${escapeHtml(serial)}</b></div>`:""}
      ${diwanDocHeaderHtml(female,logos)}
      <div class="hc-title">وثيقة توصية</div>
      <div class="hc-rec-name" style="${diwanDocFit(`فرع الكورة – ${participant.name||""}`,24,650,15)}">فرع الكورة – ${name}</div>
      <div class="hc-info">
        ${cell("الاسم",name,"hc-span",diwanDocFit(participant.name,16,520,11))}
        ${cell("المركز",escapeHtml(participant.center||""),"",diwanDocFit(participant.center,16,200,10))}${cell("المستوى",escapeHtml(diwanDocLevelText(draw)),"",diwanDocFit(diwanDocLevelText(draw),16,200,10))}
        ${cell("تاريخ الاختبار",`<bdi dir="ltr">${date.year}/${date.month}/${date.day}</bdi>`,"hc-span")}
      </div>
      <div class="hc-score hc-rec-score">
        <div class="hc-score-row"><span>العلامة:</span><b dir="ltr">${score}${incomplete?"":` <em>/ 100</em>`}</b></div>
        <div class="hc-score-row"><span>النتيجة:</span><strong class="hc-badge is-outline">${incomplete?"غير مكتمل":"غير ناجح"}</strong></div>
      </div>
      <div class="hc-section hc-rec-heading">ملاحظات اللجنة</div>
      <ol class="hc-rec-box">${rows}</ol>
      <div class="hc-rec-foot">${sign("رئيس اللجنة",chairman)}${member||!chairman?sign("عضو اللجنة",member):""}</div>
    </div>
  </div>`;
}
// توليد PDF بصفحة A4 واحدة كاملة (بلا هوامش، القالب يملأ الصفحة) من HTML خارج DOM — html2canvas + jsPDF.
async function captureDiwanDocumentCanvas(html,captureScale){
  const wrapper=document.createElement("div");wrapper.innerHTML=html;
  const clone=wrapper.firstElementChild;document.body.appendChild(clone);
  try{
    // ننتظر الخطوط والصور قبل الالتقاط، وإلا يُلتقط النص بخط بديل أو الخلفية ناقصة.
    try{await Promise.all(["400 20px 'HC Amiri'","700 20px 'HC Amiri'","500 14px 'HC Tajawal'","700 16px 'HC Tajawal'","800 30px 'HC Tajawal'"].map(font=>document.fonts.load(font,"بسم الله 0123")));await document.fonts.ready}catch{}
    await Promise.all([...clone.querySelectorAll("img")].map(img=>img.decode?img.decode().catch(()=>{}):null));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const canvas=await window.html2canvas(clone,{scale:captureScale,useCORS:false,allowTaint:false,backgroundColor:"#ffffff",logging:false});
    if(!canvas.width||!canvas.height)throw new Error("تعذر إنشاء المستند");
    return canvas;
  }finally{clone.remove()}
}
function saveDiwanPdfBlob(pdf,filenamePrefix){
  const blob=pdf.output("blob");if(!blob.size)throw new Error("تم إنشاء ملف فارغ");
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${filenamePrefix}-${dateStamp()}.pdf`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function downloadDiwanDocumentPdf(html,filenamePrefix){
  try{
    await ensurePdfLibraries();
    // دقة عالية: القالب الأصلي 1241×1754 (150dpi)، والصفحة 794px عرضاً، فمقياس ٤ يعطي ~3176px (نص حاد عند التكبير/الطباعة). الجوال بمقياس ٣ حتى لا يتجاوز حد الـcanvas.
    const captureScale=window.matchMedia?.("(pointer:coarse)").matches?3:4;
    const canvas=await captureDiwanDocumentCanvas(html,captureScale);
    const {jsPDF}=window.jspdf,pdf=new jsPDF({orientation:canvas.width>canvas.height?"landscape":"portrait",unit:"mm",format:"a4",compress:true});
    pdf.addImage(canvas.toDataURL("image/jpeg",.97),"JPEG",0,0,pdf.internal.pageSize.getWidth(),pdf.internal.pageSize.getHeight(),undefined,"SLOW");
    saveDiwanPdfBlob(pdf,filenamePrefix);
    toast("تم تنزيل المستند");
  }catch(error){toast(`تعذر إنشاء المستند: ${error.message}`)}
}
// وثائق مرحلة كاملة: لكل من أكمل اختبار المرحلة وثيقة واحدة — الناجح (انتقل/حافظ معتمد) شهادة، والراسب (ومنه المعاد سحبه) توصية —
// من الجلسة المعتمدة لتلك المحاولة نفسها، لا من حالته الحالية.
function diwanStageDocumentJobs(stage){
  const drawById=id=>diwanState.draws.find(d=>d.id===id);
  return diwanStageMembers(stage).map(p=>{
    const status=diwanStageStatusOf(p,stage);
    if(status==="passed"){const session=diwanPassedStageSession(p,stage),draw=drawById(session.draw_id);return draw?{participant:p,draw,session,kind:"certificate"}:null}
    if(status==="certified"||status==="failed"){
      const draw=currentDiwanDraw(p,diwanState.draws),session=diwanSessionForDraw(draw);
      if(!draw||session?.status!=="final")return null;
      const passed=!session.assessment?.incomplete&&Number(session.score)>=DIWAN_PASS_SCORE;
      return {participant:p,draw,session,kind:passed?"certificate":"recommendation"};
    }
    const failedSession=diwanFailedStageSession(p,stage),draw=failedSession&&drawById(failedSession.draw_id);
    return draw?{participant:p,draw,session:failedSession,kind:"recommendation"}:null;
  }).filter(Boolean);
}
function openDiwanBulkPdfModal(){
  const stage=diwanOpenStage;if(stage==null)return;
  const jobs=diwanStageDocumentJobs(stage);
  if(!jobs.length)return toast("لا يوجد بهذه المرحلة من أكمل الاختبار بعد");
  const centers=[...new Set(jobs.map(j=>j.participant.center||""))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  openModal(`<div class="modal-head"><div><span class="eyebrow">حفظ PDF · ${escapeHtml(DIWAN_STAGE_LABELS[stage])}</span><h2>شهادات الناجحين وتوصيات الراسبين</h2><small>الناجح تُصدر له شهادة، والراسب وثيقة توصية — ملف PDF واحد</small></div><button class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body">
    <label>المركز<select id="diwanBulkCenter"><option value="all">كل المراكز</option>${centers.map(c=>`<option value="${escapeAttr(c)}">${c?escapeHtml(c):"بلا مركز"}</option>`).join("")}</select></label>
    <label>النتيجة<select id="diwanBulkResult"><option value="all">الكل — شهادات وتوصيات</option><option value="certificate">الناجحون — شهادات</option><option value="recommendation">الراسبون — توصيات</option></select></label>
    <p id="diwanBulkSummary" class="field-help"></p>
  </div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button type="button" class="primary-btn" id="diwanBulkPdfBtn"><i data-lucide="download"></i> حفظ PDF</button></div>`);
  lucide.createIcons();
  const selected=()=>{const center=$("#diwanBulkCenter").value,result=$("#diwanBulkResult").value;return jobs.filter(j=>(center==="all"||(j.participant.center||"")===center)&&(result==="all"||j.kind===result))};
  const refresh=()=>{const list=selected(),certs=list.filter(j=>j.kind==="certificate").length;$("#diwanBulkSummary").textContent=`${formatNumber(list.length)} وثيقة: ${formatNumber(certs)} شهادة و${formatNumber(list.length-certs)} توصية`;$("#diwanBulkPdfBtn").disabled=!list.length};
  $("#diwanBulkCenter").onchange=refresh;$("#diwanBulkResult").onchange=refresh;refresh();
  $("#diwanBulkPdfBtn").onclick=async()=>{
    const list=selected(),center=$("#diwanBulkCenter").value,result=$("#diwanBulkResult").value;if(!list.length)return;
    const btn=$("#diwanBulkPdfBtn");btn.disabled=true;
    const prefix=["وثائق",DIWAN_STAGE_LABELS[stage],center==="all"?"كل-المراكز":(center||"بلا-مركز"),result==="certificate"?"شهادات":result==="recommendation"?"توصيات":""].filter(Boolean).join("-").replace(/[\\/:*?"<>|\s]+/g,"-");
    try{
      await ensurePdfLibraries();
      const [association,diwan]=await Promise.all([preloadImageAsDataUrl("assets/association-logo.png"),preloadImageAsDataUrl("assets/diwan-logo.jpg").then(whiteToTransparentDataUrl)]);
      const logos={association,diwan};
      // مقياس أقل من الوثيقة المفردة كي يبقى حجم الملف معقولاً مع عشرات الصفحات.
      const {jsPDF}=window.jspdf;let pdf=null;
      for(let i=0;i<list.length;i++){
        btn.textContent=`جارٍ الإنشاء ${formatNumber(i+1)} / ${formatNumber(list.length)}`;
        const job=list[i],html=job.kind==="certificate"?diwanHafizCertificateHtml(job.participant,job.draw,job.session,logos):diwanRecommendationHtml(job.participant,job.draw,job.session,logos);
        const canvas=await captureDiwanDocumentCanvas(html,2.5),orientation=canvas.width>canvas.height?"landscape":"portrait";
        if(!pdf)pdf=new jsPDF({orientation,unit:"mm",format:"a4",compress:true});else pdf.addPage("a4",orientation);
        pdf.addImage(canvas.toDataURL("image/jpeg",.92),"JPEG",0,0,pdf.internal.pageSize.getWidth(),pdf.internal.pageSize.getHeight(),undefined,"FAST");
      }
      saveDiwanPdfBlob(pdf,prefix);
      closeModal();toast(`تم تنزيل ${formatNumber(list.length)} وثيقة`);
    }catch(error){toast(`تعذر إنشاء الملف: ${error.message}`);btn.disabled=false;btn.innerHTML=`<i data-lucide="download"></i> حفظ PDF`;lucide.createIcons()}
  };
}
// شعار الديوان JPG بخلفية بيضاء: نحوّل الأبيض إلى شفافية ناعمة كي يندمج مع لون الشهادة بلا مربع أبيض حوله.
function whiteToTransparentDataUrl(src){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{try{
      const canvas=document.createElement("canvas");canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0);
      const frame=ctx.getImageData(0,0,canvas.width,canvas.height),px=frame.data;
      for(let i=0;i<px.length;i+=4){
        const alpha=255-Math.min(px[i],px[i+1],px[i+2]);
        if(alpha<=0){px[i+3]=0;continue}
        const k=255/alpha;
        px[i]=Math.max(0,Math.min(255,255-(255-px[i])*k));px[i+1]=Math.max(0,Math.min(255,255-(255-px[i+1])*k));px[i+2]=Math.max(0,Math.min(255,255-(255-px[i+2])*k));px[i+3]=alpha;
      }
      ctx.putImageData(frame,0,0);resolve(canvas.toDataURL("image/png"));
    }catch{resolve(src)}};
    img.onerror=()=>resolve(src);
    img.src=src;
  });
}
// طباعة/حفظ PDF بجودة متجهية (نص حاد بأي تكبير): تُفتح الشهادة في iframe مخفي وتُطبع بمحرّك المتصفح نفسه، فيختار المستخدم «حفظ كـPDF».
async function printDiwanDocumentHtml(html,title,{portrait=false}={}){
  const frame=document.createElement("iframe"),[pageW,pageH]=portrait?[794,1123]:[1123,794];
  frame.style.cssText=`position:fixed;right:-99999px;top:0;width:${pageW}px;height:${pageH}px;border:0`;
  const cssHref=document.querySelector('link[href^="styles.css"]')?.href||"styles.css";
  frame.srcdoc=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${escapeAttr(cssHref)}"><style>@page{size:A4 ${portrait?"portrait":"landscape"};margin:0}html,body{margin:0;padding:0;background:#fff!important;width:${pageW}px;height:${pageH-1}px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}.pdf-export-sheet{position:relative!important;right:auto!important;top:auto!important;z-index:auto!important;height:${pageH-1}px!important}</style></head><body>${html}</body></html>`;
  const cleanup=()=>setTimeout(()=>frame.remove(),1500);
  frame.onload=async()=>{
    try{
      const doc=frame.contentDocument;
      await Promise.all(["400 20px 'HC Amiri'","700 20px 'HC Amiri'","500 14px 'HC Tajawal'","700 16px 'HC Tajawal'","800 30px 'HC Tajawal'"].map(font=>doc.fonts.load(font,"بسم الله 0123")));
      await doc.fonts.ready;
      await Promise.all([...doc.images].map(img=>img.decode?img.decode().catch(()=>{}):null));
      frame.contentWindow.addEventListener("afterprint",cleanup);
      frame.contentWindow.focus();frame.contentWindow.print();
      setTimeout(cleanup,120000);
    }catch(error){cleanup();toast(`تعذرت الطباعة: ${error.message}`)}
  };
  document.body.appendChild(frame);
}
async function downloadDiwanCertificate(participant,draw,{print=false}={}){
  if(!participant||!draw)return toast("تعذر تحديد السحب المطلوب");
  const session=diwanSessionForDraw(draw);
  if(!session||session.status!=="final"||session.assessment?.incomplete||Number(session.score)<DIWAN_PASS_SCORE)return toast("لا توجد نتيجة ناجحة معتمدة لهذه المحاولة");
  const safeName=String(participant.name||"مشارك").replace(/[\\/:*?"<>|]/g,"-");
  const [association,diwan]=await Promise.all([preloadImageAsDataUrl("assets/association-logo.png"),preloadImageAsDataUrl("assets/diwan-logo.jpg").then(whiteToTransparentDataUrl)]);
  const html=diwanHafizCertificateHtml(participant,draw,session,{association,diwan});
  const prefix=draw.stage===4?`شهادة-حافظ-${safeName}`:`شهادة-${DIWAN_STAGE_LABELS[draw.stage]}-${safeName}`;
  if(print)return printDiwanDocumentHtml(html,prefix);
  await downloadDiwanDocumentPdf(html,prefix);
}
async function downloadDiwanRecommendation(participant,draw,sessionOverride=null,{print=false}={}){
  if(!participant||!draw)return toast("تعذر تحديد السحب المطلوب");
  const session=sessionOverride||diwanSessionForDraw(draw);
  if(!session||session.status!=="final")return toast("لا توجد نتيجة معتمدة لهذه المحاولة");
  if(!session.assessment?.incomplete&&Number(session.score)>=DIWAN_PASS_SCORE)return toast("هذه المحاولة ناجحة — لا تُصدر لها توصية رسوب، بل شهادة");
  const safeName=String(participant.name||"مشارك").replace(/[\\/:*?"<>|]/g,"-");
  const [association,diwan]=await Promise.all([preloadImageAsDataUrl("assets/association-logo.png"),preloadImageAsDataUrl("assets/diwan-logo.jpg").then(whiteToTransparentDataUrl)]);
  const html=diwanRecommendationHtml(participant,draw,session,{association,diwan});
  const prefix=`وثيقة-توصية-${DIWAN_STAGE_LABELS[draw.stage]}-${safeName}`;
  if(print)return printDiwanDocumentHtml(html,prefix,{portrait:true});
  await downloadDiwanDocumentPdf(html,prefix);
}
// كتابة/تعديل التوصية من الإدارة (تُقدَّم على توصية اللجنة): تُحفظ على السحب نفسه ضمن حالة الديوان.
function openDiwanRecommendationEditModal(participant,draw){
  if(!participant||!draw)return toast("تعذر تحديد المحاولة");
  const session=diwanSessionForDraw(draw);
  if(!session||session.status!=="final")return toast("لا توجد نتيجة معتمدة لهذه المحاولة");
  if(!session.assessment?.incomplete&&Number(session.score)>=DIWAN_PASS_SCORE)return toast("هذه المحاولة ناجحة — لا توصية لها");
  const hasAdmin=Array.isArray(draw.adminRecommendation)&&draw.adminRecommendation.length>0;
  openModal(`<div class="modal-head"><div><span class="eyebrow">توصية اللجنة · تحرير الإدارة</span><h2>${escapeHtml(participant.name)}</h2><small>${DIWAN_STAGE_LABELS[draw.stage]||""}</small></div><button class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">${hasAdmin?"هذه توصية أدخلتها الإدارة وتُطبع بدل توصية اللجنة.":"النقاط الحالية هي ما كتبته اللجنة (قد تكون فارغة). أي تعديل هنا يُطبع بدلها."} حتى ${DIWAN_RECOMMENDATION_MAX_POINTS} نقاط.</p>${diwanRecommendationEditorHtml(diwanRecommendationLines(draw,session))}</div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button>${hasAdmin?`<button type="button" class="secondary-btn" id="diwanRecRevertBtn">العودة لتوصية اللجنة</button>`:""}<button type="button" class="secondary-btn" id="diwanRecSaveBtn">حفظ</button><button type="button" class="primary-btn" id="diwanRecSaveDownloadBtn"><i data-lucide="download"></i> حفظ وتنزيل</button></div>`);
  bindDiwanRecommendationEditor();lucide.createIcons();
  const save=()=>{const lines=readDiwanRecommendationEditor();if(lines.length)draw.adminRecommendation=lines;else delete draw.adminRecommendation;saveDiwanState();renderDiwanParticipants();toast(lines.length?"تم حفظ التوصية":"تم حذف توصية الإدارة");return lines};
  $("#diwanRecSaveBtn").onclick=()=>{save();closeModal()};
  $("#diwanRecSaveDownloadBtn").onclick=()=>{save();closeModal();downloadDiwanRecommendation(participant,draw)};
  const revert=$("#diwanRecRevertBtn");if(revert)revert.onclick=()=>{delete draw.adminRecommendation;saveDiwanState();renderDiwanParticipants();closeModal();toast("رجعت التوصية لما كتبته اللجنة")};
}
function openDiwanAttemptHistory(participant){
  if(!participant)return;
  const drawsForParticipant=diwanState.draws.filter(d=>d.participantId===participant.id).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const sessionsByDrawId=new Map(diwanAdminSessions.filter(s=>s.participant_id===participant.id).map(s=>[s.draw_id,s]));
  const rows=drawsForParticipant.map((draw,index)=>{
    const session=sessionsByDrawId.get(draw.id);
    const stageLabel=DIWAN_STAGE_LABELS[draw.stage]||`مرحلة ${draw.stage}`;
    const passed=session?.status==="final"&&!session.assessment?.incomplete&&Number(session.score)>=DIWAN_PASS_SCORE;
    const scoreText=!session?`<span class="state">بانتظار اللجنة</span>`:session.status!=="final"?`<span class="state drawn">قيد الاختبار</span>`:session.assessment?.incomplete?`<span class="state failed">غير مكتمل</span>`:`<b class="diwan-history-score">${formatAssessmentNumber(session.score)}</b> <span class="state ${passed?"completed":"failed"}">${passed?"ناجح":"راسب"}</span>`;
    const actionHtml=session?.status!=="final"?"":passed?`<button class="compact-btn" data-diwan-history-cert="${index}"><i data-lucide="award"></i> الشهادة</button> <button class="compact-btn" data-diwan-history-cert-print="${index}" title="طباعة أو حفظ PDF بجودة عالية"><i data-lucide="printer"></i></button>`:`<button class="compact-btn" data-diwan-history-rec="${index}"><i data-lucide="file-text"></i> التوصية</button> <button class="compact-btn" data-diwan-history-rec-print="${index}" title="طباعة أو حفظ PDF بجودة عالية"><i data-lucide="printer"></i></button> <button class="compact-btn" data-diwan-history-rec-edit="${index}" title="كتابة/تعديل التوصية"><i data-lucide="pencil-line"></i></button>`;
    return `<tr><td class="nowrap">${escapeHtml(stageLabel)}</td><td class="nowrap">${formatDate(draw.createdAt)}</td><td class="nowrap">${scoreText}</td><td>${actionHtml}</td></tr>`;
  }).join("");
  openModal(`<div class="modal-head"><h2>سجل محاولات ${escapeHtml(participant.name)}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="table-wrap"><table class="diwan-history-table"><thead><tr><th>المرحلة</th><th>تاريخ السحب</th><th>النتيجة</th><th>مستند</th></tr></thead><tbody>${rows||`<tr><td colspan="4" class="table-empty">لا يوجد سحب بعد</td></tr>`}</tbody></table></div></div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button></div>`,"diwan-history-modal");
  $$(`[data-diwan-history-cert]`).forEach(button=>button.onclick=()=>downloadDiwanCertificate(participant,drawsForParticipant[Number(button.dataset.diwanHistoryCert)]));
  $$(`[data-diwan-history-cert-print]`).forEach(button=>button.onclick=()=>downloadDiwanCertificate(participant,drawsForParticipant[Number(button.dataset.diwanHistoryCertPrint)],{print:true}));
  $$(`[data-diwan-history-rec-print]`).forEach(button=>button.onclick=()=>downloadDiwanRecommendation(participant,drawsForParticipant[Number(button.dataset.diwanHistoryRecPrint)],null,{print:true}));
  $$(`[data-diwan-history-rec-edit]`).forEach(button=>button.onclick=()=>openDiwanRecommendationEditModal(participant,drawsForParticipant[Number(button.dataset.diwanHistoryRecEdit)]));
  $$(`[data-diwan-history-rec]`).forEach(button=>button.onclick=()=>downloadDiwanRecommendation(participant,drawsForParticipant[Number(button.dataset.diwanHistoryRec)]));
  lucide.createIcons();
}
// اللجنة الفعلية التي امتحنت المشارك (لجنته وقت الاعتماد، من نفس assessment.committee التي
// تُبنى بـfinalizeDiwanElectronicAssessment) إن وُجدت، وإلا اللجنة المُسنَدة له حالياً حسب
// النقل اليدوي أو الفرز الطبيعي (جنس + مستوى) — نفس أولوية عمود "اللجنة" بالسنوية بالضبط
// (resultCommitteeName ثم resolveParticipantCommittee)، بلا أي تعديل على تلك الدوال المشتركة.
// اللجنة التي تراها المتسابقة حالياً (نفس قاعدة diwanCommitteeScope): المنقولة/الموزَّعة → لجنتها، غير الذكور → كل لجان الإناث، الذكور → لجنة مستواهم.
// المسؤول الفرعي لا يملك cloudCommittees (قائمة الإدارة) — لجانه تصل مع حالته (subAdminCommittees).
function diwanCommitteesList(){return window.CloudCompetition?.context?.kind==="subAdmin"?subAdminCommittees:cloudCommittees}
function diwanAssignedCommittee(participant){
  const cloudCommittees=diwanCommitteesList();
  if(participant.transferCommitteeId){const committee=cloudCommittees.find(c=>c.id===participant.transferCommitteeId);return {id:participant.transferCommitteeId,name:committee?.name||"لجنة محددة",committee}}
  if(participant.gender!=="ذكر")return {id:null,name:"كل لجان الإناث",committee:null};
  const committee=cloudCommittees.length?resolveParticipantCommittee(participant,cloudCommittees,{includeAllGenders:true}).currentCommittee:null;
  return {id:committee?.id||null,name:committee?.name||"",committee};
}
function diwanCommitteeCellHtml(participant){
  const historicalName=resultCommitteeName(participant);
  if(historicalName){
    const historicalCommittee=participant.assessment?.committee?.id?diwanCommitteesList().find(c=>c.id===participant.assessment.committee.id):null;
    return `${escapeHtml(historicalName)}${historicalCommittee?.login_code?` <small>(${escapeHtml(historicalCommittee.login_code)})</small>`:""}`;
  }
  const {name,committee:assigned}=diwanAssignedCommittee(participant);
  return name?`${escapeHtml(name)}${assigned?.login_code?` <small>(${escapeHtml(assigned.login_code)})</small>`:""}`:`<span class="score-help">—</span>`;
}
const DIWAN_STAGE_SUBTITLES={1:"عشرة أجزاء تختارها الإدارة",2:"عشرة أجزاء تختارها الإدارة",3:"عشرة أجزاء تختارها الإدارة",4:"القرآن الكريم كاملاً — ١٨ موضعاً"};
// أي قيمة مرحلة غير صالحة تُعرض ضمن المرحلة الأولى بدل أن يختفي المتسابق من اللوحة.
function diwanStageOf(participant){return [1,2,3,4].includes(participant?.stage)?participant.stage:1}
function diwanParticipantCardHtml(p,showStage=false,viewStage=null){
  const status=diwanStageStatusOf(p,viewStage),passedSession=status==="passed"?diwanPassedStageSession(p,viewStage):null,failedSession=diwanFailedStageSession(p,viewStage);
  if(passedSession)showStage=true;
  const statusLabel=passedSession?`ناجح · ${formatAssessmentNumber(passedSession.score)} — ${p.certified?"حافظ معتمد":`انتقل إلى ${DIWAN_STAGE_LABELS[diwanStageOf(p)]}`}`:status==="certified"?(Number.isFinite(p.score)?`ناجح · ${formatAssessmentNumber(p.score)} — حافظ معتمد`:"حافظ معتمد"):status==="withdrawn"?"منسحب · 0":status==="failed"?(p.assessment?.incomplete?"غير مكتمل":`راسب · ${formatAssessmentNumber(p.score)}`)
    :(failedSession?`${failedSession.assessment?.incomplete?"غير مكتمل":`راسب · ${formatAssessmentNumber(failedSession.score)}`} — `:"")+(status==="no_draw"?"لم يتم اختيار الأجزاء بعد":failedSession?"إعادة اختبار بانتظار اللجنة":"تم السحب — بانتظار اللجنة");
  const stateClass=status==="certified"||status==="passed"?"completed":status==="failed"||status==="withdrawn"?"failed":status==="no_draw"?"not-drawn":"drawn";
  const primaryHtml=passedSession?`<button class="compact-btn" data-diwan-draw-sheet="${escapeAttr(passedSession.draw_id)}"><i data-lucide="eye"></i> ورقة المواضع</button>`
    :status==="withdrawn"?""
    :status==="certified"?`<button class="compact-btn" data-diwan-certificate="${p.id}"><i data-lucide="award"></i> شهادة حافظ</button><button class="compact-btn" data-diwan-certificate-print="${p.id}" title="طباعة أو حفظ PDF بجودة عالية"><i data-lucide="printer"></i></button>`
    :status==="no_draw"?(diwanStageOf(p)===4?`<button class="compact-btn" data-diwan-final-draw="${p.id}"><i data-lucide="sparkles"></i> السحب النهائي</button>`:`<button class="compact-btn" data-diwan-pick-juz="${p.id}"><i data-lucide="list-checks"></i> اختيار الأجزاء والسحب</button>`)
    :status==="failed"?`<button class="compact-btn" data-diwan-recommendation="${p.id}"><i data-lucide="file-text"></i> التوصية</button><button class="compact-btn" data-diwan-recommendation-print="${p.id}" title="طباعة أو حفظ PDF بجودة عالية"><i data-lucide="printer"></i></button><button class="compact-btn" data-diwan-recommendation-edit="${p.id}" title="كتابة/تعديل التوصية"><i data-lucide="pencil-line"></i></button><button class="compact-btn" data-diwan-retry="${p.id}"><i data-lucide="rotate-ccw"></i> إعادة الاختبار</button>`
    :`<button class="compact-btn" data-diwan-result="${p.id}"><i data-lucide="eye"></i> ورقة المواضع</button>`;
  const serial=diwanSerialOf(p);
  return `<article class="diwan-card is-${status}"><div class="diwan-card-top"><b>${escapeHtml(p.name)}</b><span class="diwan-card-seat">رقم الجلوس ${escapeHtml(p.seat)}</span></div><div class="diwan-card-meta">${showStage?`<span class="diwan-card-stage">${escapeHtml(DIWAN_STAGE_LABELS[diwanStageOf(p)])}</span>`:""}<span>${escapeHtml(p.gender||"غير محدد")}</span><span>${p.center?escapeHtml(p.center):`<span class="missing-center-tag">⚠ بلا مركز</span>`}</span><span>${diwanCommitteeCellHtml(p)}</span>${serial?`<span>الرقم التسلسلي ${escapeHtml(serial)}</span>`:`<span class="missing-center-tag">⚠ بلا رقم تسلسلي</span>`}</div><div class="diwan-card-foot"><span class="state ${stateClass}">${statusLabel}</span><div class="row-actions">${primaryHtml}<details class="row-actions-more"><summary class="icon-btn" title="المزيد من الإجراءات"><i data-lucide="more-vertical"></i></summary><div class="row-actions-more-list"><button class="compact-btn" data-diwan-history="${p.id}"><i data-lucide="history"></i> السجل</button>${status==="pending"&&diwanStageOf(p)<4?`<button class="compact-btn" data-diwan-change-parts="${p.id}"><i data-lucide="list-checks"></i> تغيير الأجزاء</button>`:""}<button class="compact-btn" data-diwan-move-stage="${p.id}"><i data-lucide="git-branch"></i> نقل لمرحلة</button>${diwanStaffCan("can_transfer_participant")?`<button class="compact-btn" data-diwan-transfer="${p.id}"><i data-lucide="shuffle"></i> نقل للجنة</button>`:""}${status==="certified"?"":`<button class="compact-btn" data-diwan-withdraw="${p.id}"><i data-lucide="${p.withdrawn?"user-check":"user-x"}"></i> ${p.withdrawn?"إلغاء الانسحاب":"تسجيل انسحاب"}</button>`}<button class="compact-btn" data-diwan-edit="${p.id}"><i data-lucide="pencil"></i> تعديل</button>${diwanStaffCan("can_delete_data")?`<button class="compact-btn danger-compact" data-diwan-delete="${p.id}"><i data-lucide="trash-2"></i> حذف</button>`:""}</div></details></div></div></article>`;
}
// نقل يدوي لمرحلة (صلاحية الإدارة): يبدأ المتسابق المرحلة المختارة من جديد بلا سحب حالي، وتبقى محاولاته السابقة بالسجل.
// النقل التلقائي بعد اعتماد نتيجة (نجاح ← المرحلة التالية، رسوب ← نفس المرحلة) يتم في mergeFinalDiwanSessionsIntoState.
function moveDiwanParticipantToStage(participant,stage){
  if(!participant||![1,2,3,4].includes(stage))return false;
  const currentSession=diwanSessionForDraw(currentDiwanDraw(participant,diwanState.draws));
  if(currentSession?.status==="in_progress"){toast("لا يمكن نقل المتسابق أثناء اختبار جارٍ عند إحدى اللجان — أنهوه أو ألغوه أولاً");return false}
  participant.stage=stage;participant.certified=false;delete participant.certificateNumber;participant.parts=[];participant.stageEnteredAt=new Date().toISOString();
  saveDiwanState();
  return true;
}
function openDiwanMoveStageModal(participantId){
  const participant=diwanState.participants.find(p=>p.id===participantId);if(!participant)return;
  const current=diwanStageOf(participant);
  const options=[1,2,3,4].map(stage=>`<label class="diwan-move-option"><input type="radio" name="diwanMoveStage" value="${stage}" ${stage===current?"checked":""}> <b>${escapeHtml(DIWAN_STAGE_LABELS[stage])}</b> <small>${escapeHtml(DIWAN_STAGE_SUBTITLES[stage])}${stage===current?" · المرحلة الحالية":""}</small></label>`).join("");
  openModal(`<div class="modal-head"><h2>نقل ${escapeHtml(participant.name)} إلى مرحلة</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">اختر المرحلة التي يبدأها المتسابق الآن. يبدأها من جديد بلا سحب حالي (يلزم اختيار الأجزاء وإجراء سحب جديد)، وتبقى كل محاولاته السابقة وعلاماتها محفوظة بالسجل.</p><div class="diwan-move-options">${options}</div></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button id="confirmDiwanMoveStage" class="primary-btn">نقل المتسابق</button></div>`);
  $("#confirmDiwanMoveStage").onclick=()=>{
    const stage=Number(document.querySelector('input[name="diwanMoveStage"]:checked')?.value);
    if(stage===current)return toast("المتسابق موجود بهذه المرحلة أصلاً");
    if(!moveDiwanParticipantToStage(participant,stage))return;
    closeModal();renderDiwanParticipants();toast(`تم نقل ${participant.name} إلى ${DIWAN_STAGE_LABELS[stage]}`);
  };
}
function openDiwanStage(stage){
  diwanOpenStage=[1,2,3,4].includes(stage)?stage:null;
  if($("#diwanStageSearch"))$("#diwanStageSearch").value="";
  renderDiwanParticipants();
  globalThis.window?.scrollTo?.(0,0);
}
function closeDiwanStage(){
  diwanOpenStage=null;
  renderDiwanParticipants();
  globalThis.window?.scrollTo?.(0,0);
}
function renderDiwanParticipants(){
  $("#diwanDistributeBtn")?.classList.toggle("hidden",!isDiwanCloudWriter());
  const staff=isDiwanCloudStaff();
  if(staff)$("#diwanSyncCommitteesBtn")?.classList.remove("hidden");
  populateDiwanParticipantFilterOptions();
  const query=$("#diwanParticipantSearch")?.value.trim().toLowerCase()||"";
  const all=diwanState.participants;
  const activeFilters={status:$("#diwanStatusFilter")?.value||"all",gender:$("#diwanGenderFilter")?.value||"all",center:$("#diwanCenterFilter")?.value||"all",committee:$("#diwanCommitteeFilter")?.value||"all"};
  const certifiedCount=all.filter(p=>p.certified).length;
  const examinedCount=all.filter(p=>Number.isFinite(p.score)&&!(p.withdrawn&&!(Number(p.score)>0))).length;
  $("#diwanStatTotal").textContent=formatNumber(all.length);
  $("#diwanStatExamined").textContent=formatNumber(examinedCount);
  $("#diwanStatPassRate").textContent=all.length?`${Math.round(certifiedCount/all.length*100)}%`:"0%";
  // اللوحة الرئيسية: صندوق ملخّص لكل مرحلة (أعداد فقط) — تفاصيل المتسابقين تُفتح بصفحة المرحلة عند الضغط على الصندوق.
  $("#diwanStageBoard").innerHTML=[1,2,3,4].map(stage=>{
    const members=all.filter(p=>diwanStageOf(p)===stage);
    const tally=members.reduce((acc,p)=>{const key=diwanParticipantStatusOf(p);acc[key]=(acc[key]||0)+1;return acc},{});
    const passedCount=all.filter(p=>diwanPassedStageSession(p,stage)).length;if(passedCount)tally.passed=passedCount;
    const chips=[["no_draw","بانتظار الأجزاء"],["pending","بانتظار اللجنة"],["passed","ناجح وانتقل"],["failed","راسب"],["withdrawn","منسحب"],["certified","حافظ معتمد"]].filter(([key])=>tally[key]).map(([key,label])=>`<span class="diwan-stage-chip is-${key}">${label} ${formatNumber(tally[key])}</span>`).join("")||`<span class="diwan-stage-chip">لا يوجد متسابقون</span>`;
    return `<button type="button" class="diwan-stage-box stage-${stage}" data-open-stage="${stage}"><span class="diwan-stage-head"><span class="diwan-stage-num">${stage===4?"★":stage}</span><span class="diwan-stage-titles"><strong>${escapeHtml(DIWAN_STAGE_LABELS[stage])}</strong><small>${DIWAN_STAGE_SUBTITLES[stage]}</small></span><b class="diwan-stage-count">${formatNumber(members.length)}</b></span><span class="diwan-stage-chips">${chips}</span><span class="diwan-stage-open">عرض المتسابقين <i data-lucide="arrow-left"></i></span></button>`;
  }).join("");
  // بحث سريع بكل المراحل: يستبدل الصناديق بنتائج البحث ما دام نص البحث غير فارغ.
  const matches=query?all.filter(p=>[p.name,p.seat,p.center,p.serialNumber].some(x=>String(x??"").toLowerCase().includes(query))):[];
  $("#diwanStageBoard").classList.toggle("hidden",Boolean(query));
  $("#diwanSearchResults").classList.toggle("hidden",!query);
  $("#diwanSearchResults").innerHTML=query?(matches.length?matches.map(p=>diwanParticipantCardHtml(p,true)).join(""):`<p class="diwan-stage-empty">لا توجد نتائج مطابقة</p>`):"";
  // صفحة المرحلة: كل متسابقيها ببطاقات كاملة مع الفلاتر.
  const inStage=diwanOpenStage!=null;
  $("#diwanOverviewPanel").classList.toggle("hidden",inStage);
  $("#diwanStagePanel").classList.toggle("hidden",!inStage);
  if(inStage){
    const stageAll=diwanStageMembers(diwanOpenStage);
    // بحث داخل صفحة المرحلة نفسها (بالاسم/الجلوس/المركز/الرقم التسلسلي) فوق الفلاتر.
    const stageQuery=$("#diwanStageSearch")?.value.trim().toLowerCase()||"";
    const stageList=stageAll.filter(p=>diwanParticipantMatchesFilters(p,activeFilters)&&(!stageQuery||[p.name,p.seat,p.center,p.serialNumber].some(x=>String(x??"").toLowerCase().includes(stageQuery))));
    $("#diwanStagePageTitle").textContent=DIWAN_STAGE_LABELS[diwanOpenStage];
    $("#diwanStagePageSub").textContent=DIWAN_STAGE_SUBTITLES[diwanOpenStage];
    $("#diwanParticipantCount").textContent=stageList.length===stageAll.length?`${formatNumber(stageList.length)} متسابق`:`${formatNumber(stageList.length)} من ${formatNumber(stageAll.length)} متسابق`;
    $("#diwanStageParticipants").innerHTML=stageList.length?stageList.map(p=>diwanParticipantCardHtml(p,false,diwanOpenStage)).join(""):`<p class="diwan-stage-empty">${stageAll.length?"لا يوجد متسابقون مطابقون للفلاتر":"لا يوجد متسابقون بهذه المرحلة"}</p>`;
  }
  $$(`[data-open-stage]`).forEach(b=>b.onclick=()=>openDiwanStage(Number(b.dataset.openStage)));
  const bulkPdfBtn=$("#diwanBulkPdfOpenBtn");if(bulkPdfBtn)bulkPdfBtn.onclick=openDiwanBulkPdfModal;
  $$(`[data-diwan-pick-juz]`).forEach(b=>b.onclick=()=>openDiwanJuzPicker(diwanState.participants.find(p=>p.id===b.dataset.diwanPickJuz)));
  $$(`[data-diwan-final-draw]`).forEach(b=>b.onclick=()=>startDiwanFinalDraw(diwanState.participants.find(p=>p.id===b.dataset.diwanFinalDraw)));
  $$(`[data-diwan-retry]`).forEach(b=>b.onclick=()=>retryDiwanStage(diwanState.participants.find(p=>p.id===b.dataset.diwanRetry)));
  $$(`[data-diwan-result]`).forEach(b=>b.onclick=()=>{const p=diwanState.participants.find(x=>x.id===b.dataset.diwanResult);const draw=currentDiwanDraw(p,diwanState.draws);if(draw)showDiwanResult(draw)});
  $$(`[data-diwan-certificate-print]`).forEach(b=>b.onclick=()=>{const p=diwanState.participants.find(x=>x.id===b.dataset.diwanCertificatePrint);downloadDiwanCertificate(p,currentDiwanDraw(p,diwanState.draws),{print:true})});
  $$(`[data-diwan-certificate]`).forEach(b=>b.onclick=()=>{const p=diwanState.participants.find(x=>x.id===b.dataset.diwanCertificate);downloadDiwanCertificate(p,currentDiwanDraw(p,diwanState.draws))});
  $$(`[data-diwan-recommendation-print]`).forEach(b=>b.onclick=()=>{const p=diwanState.participants.find(x=>x.id===b.dataset.diwanRecommendationPrint);downloadDiwanRecommendation(p,currentDiwanDraw(p,diwanState.draws),null,{print:true})});
  $$(`[data-diwan-recommendation-edit]`).forEach(b=>b.onclick=()=>{const p=diwanState.participants.find(x=>x.id===b.dataset.diwanRecommendationEdit);openDiwanRecommendationEditModal(p,currentDiwanDraw(p,diwanState.draws))});
  $$(`[data-diwan-recommendation]`).forEach(b=>b.onclick=()=>{const p=diwanState.participants.find(x=>x.id===b.dataset.diwanRecommendation);downloadDiwanRecommendation(p,currentDiwanDraw(p,diwanState.draws))});
  $$(`[data-diwan-draw-sheet]`).forEach(b=>b.onclick=()=>{const draw=diwanState.draws.find(d=>d.id===b.dataset.diwanDrawSheet);if(draw)showDiwanResult(draw);else toast("تعذر إيجاد سحب هذه المرحلة")});
  $$(`[data-diwan-change-parts]`).forEach(b=>b.onclick=()=>openDiwanJuzPicker(diwanState.participants.find(p=>p.id===b.dataset.diwanChangeParts),{changeOnly:true}));
  $$(`[data-diwan-move-stage]`).forEach(b=>b.onclick=()=>openDiwanMoveStageModal(b.dataset.diwanMoveStage));
  $$(`[data-diwan-history]`).forEach(b=>b.onclick=()=>openDiwanAttemptHistory(diwanState.participants.find(p=>p.id===b.dataset.diwanHistory)));
  $$(`[data-diwan-transfer]`).forEach(b=>b.onclick=()=>openDiwanAssignCommitteeModal(b.dataset.diwanTransfer));
  $$(`[data-diwan-edit]`).forEach(b=>b.onclick=()=>openDiwanParticipantModal(diwanState.participants.find(p=>p.id===b.dataset.diwanEdit)));
  $$(`[data-diwan-withdraw]`).forEach(b=>b.onclick=()=>toggleDiwanParticipantWithdrawn(diwanState.participants.find(p=>p.id===b.dataset.diwanWithdraw)));
  $$(`[data-diwan-delete]`).forEach(b=>b.onclick=()=>confirmDeleteDiwanParticipant(b.dataset.diwanDelete));
  lucide.createIcons();
}
function resultsExportRow(p){
  const isIncomplete=Boolean(p.assessment?.incomplete);
  const hasScore=Number.isFinite(p.score);
  const exportScore=isIncomplete?"غير مكتمل":hasScore?p.score:0;
  return {"المسابقة":state.config?.competitionName||"","المشارك":p.name,"الجنس":p.gender||"غير محدد","رقم المتسابق":p.seat,"الهاتف":p.phone||"","الفرع":p.branch||"","المركز":p.center||"","الأجزاء المشارك فيها":(p.parts||[]).join("،"),"المستوى":p.levelName||`${p.level} أجزاء`,"الروايات":p.recitation||"","علامة التصفية 1":exportScore,"علامة التصفية 2":"","النتيجة":isIncomplete?"غير مكتمل":exportScore>=PASS_SCORE?"ناجح":"راسب","الحالة":p.withdrawn?"منسحب":""};
}
function filterParticipantsFor(filters){return state.participants.filter(p=>(filters.gender==="all"||p.gender===filters.gender)&&(!filters.centers?.length||filters.centers.includes(p.center))&&(filters.level==="all"||(p.levelName||`${p.level} أجزاء`)===filters.level))}
function openResultsFilterModal(title,onConfirm){
  const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  openModal(`<div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid">${genderFieldHtml("resultsFilter")}<label>المستوى<select id="resultsFilterLevel"><option value="all">الكل</option>${LEVEL_CATALOG.map(l=>`<option value="${escapeAttr(l.label)}">${escapeHtml(l.label)}</option>`).join("")}</select></label></div><fieldset><legend>المركز (اختياري، يمكن اختيار أكثر من مركز — اتركه فارغًا ليشمل كل المراكز)</legend><div class="committee-level-options">${centerCheckboxesHtml("resultsFilterCenter",centers)}</div></fieldset></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="resultsFilterConfirm" class="primary-btn">تنزيل</button></div>`);
  wireLevelSelectAll("resultsFilterCenter");
  $("#resultsFilterConfirm").onclick=()=>{const filters={gender:$("#resultsFilterGender").value,centers:checkedValuesOf("resultsFilterCenter"),level:$("#resultsFilterLevel").value};closeModal();onConfirm(filters)};
}
async function exportFinalResults(){
  if(!state.participants.length)return toast("لا يوجد متسابقون لتصديرهم");
  openResultsFilterModal("النتائج والترتيب — تصفية قبل التنزيل",async filters=>{
    const list=filterParticipantsFor(filters);
    if(!list.length)return toast("لا يوجد متسابقون مطابقون للفلتر");
    try{await ensureXlsx()}catch(error){return toast(error.message)}
    const byLevel=new Map();for(const p of list){const key=p.levelName||`${p.level} أجزاء`;if(!byLevel.has(key))byLevel.set(key,[]);byLevel.get(key).push(p)}
    const orderedKeys=[...LEVEL_CATALOG.map(l=>l.label),...[...byLevel.keys()].filter(k=>!LEVEL_CATALOG.some(l=>l.label===k))].filter(k=>byLevel.has(k));
    const sortGroup=group=>[...group].sort((a,b)=>(Number.isFinite(b.score)?b.score:-1)-(Number.isFinite(a.score)?a.score:-1)||String(a.name).localeCompare(String(b.name),"ar"));
    const workbook=XLSX.utils.book_new(),setSheetOptions=sheet=>{sheet["!cols"]=[{wch:32},{wch:26},{wch:9},{wch:14},{wch:14},{wch:16},{wch:20},{wch:20},{wch:38},{wch:16},{wch:14},{wch:14},{wch:12},{wch:12}];sheet["!views"]=[{rightToLeft:true}]};workbook.Workbook={Views:[{RTL:true}]};
    for(const key of orderedKeys){const rows=sortGroup(byLevel.get(key)).map(resultsExportRow);const sheet=XLSX.utils.json_to_sheet(rows);setSheetOptions(sheet);XLSX.utils.book_append_sheet(workbook,sheet,key.slice(0,31))}
    XLSX.writeFile(workbook,`نتائج-وترتيب-المسابقة-${dateStamp()}.xlsx`);toast("تم تنزيل ملف النتائج مقسماً حسب المستوى")
  });
}
async function exportUnifiedResults(){
  if(!state.participants.length)return toast("لا يوجد متسابقون لتصديرهم");
  openResultsFilterModal("النتائج كاملة بشيت واحد — تصفية قبل التنزيل",async filters=>{
    const list=filterParticipantsFor(filters);
    if(!list.length)return toast("لا يوجد متسابقون مطابقون للفلتر");
    try{await ensureXlsx()}catch(error){return toast(error.message)}
    const rows=[...list].sort((a,b)=>String(a.levelName||a.level).localeCompare(String(b.levelName||b.level),"ar")||String(a.name).localeCompare(String(b.name),"ar")).map(resultsExportRow);
    const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(rows);sheet["!views"]=[{rightToLeft:true}];sheet["!cols"]=[{wch:32},{wch:26},{wch:9},{wch:14},{wch:14},{wch:16},{wch:20},{wch:20},{wch:38},{wch:16},{wch:14},{wch:14},{wch:12},{wch:12}];workbook.Workbook={Views:[{RTL:true}]};XLSX.utils.book_append_sheet(workbook,sheet,"جميع النتائج");XLSX.writeFile(workbook,`النتائج-الكاملة-${dateStamp()}.xlsx`);toast("تم تنزيل جميع النتائج في شيت واحد")
  });
}
function levelCheckboxesHtml(name){return `<label class="committee-member-toggle level-select-all"><input type="checkbox" data-level-all="${name}"> <b>جميع المستويات</b></label>`+LEVEL_CATALOG.map(l=>`<label class="committee-member-toggle"><input type="checkbox" name="${name}" value="${escapeAttr(l.label)}"> ${escapeHtml(l.label)}</label>`).join("")}
function wireLevelSelectAll(name){const all=$(`[data-level-all="${name}"]`),boxes=$$(`[name="${name}"]`);if(!all||!boxes.length)return;all.onchange=()=>boxes.forEach(box=>box.checked=all.checked);boxes.forEach(box=>box.onchange=()=>{all.checked=boxes.every(item=>item.checked)})}
function genderFieldHtml(idPrefix){return `<label>الجنس<select id="${idPrefix}Gender"><option value="all">الكل</option><option value="ذكر">ذكور</option><option value="أنثى">إناث</option></select></label>`}
function centerCheckboxesHtml(name,centers){return `<label class="committee-member-toggle level-select-all"><input type="checkbox" data-level-all="${name}"> <b>كل المراكز</b></label>`+centers.map(c=>`<label class="committee-member-toggle"><input type="checkbox" name="${name}" value="${escapeAttr(c)}"> ${escapeHtml(c)}</label>`).join("")}
function checkedValuesOf(name){return $$(`[name="${name}"]`).filter(i=>i.checked).map(i=>i.value)}
async function openBulkPdfDialog(){let committees=[...new Set(state.participants.map(resultCommitteeName).filter(Boolean))];if(operationMode==="cloud"&&["admin","supervisor"].includes(window.CloudCompetition.context?.profile?.role))try{cloudCommittees=await window.CloudCompetition.listCommittees();committees=cloudCommittees.map(item=>item.name)}catch(error){toast(`تعذر تحديث قائمة اللجان: ${error.message}`)}committees=[...new Set(committees)].sort((a,b)=>a.localeCompare(b,"ar"));const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));openModal(`<div class="modal-head"><div><span class="eyebrow">ملف واحد للطباعة</span><h2>تجميع ملفات الطلاب PDF</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid"><label>الحالة<select id="bulkPdfStatus"><option value="all">كل من تم سحبهم</option><option value="completed">المكتملون فقط</option></select></label>${genderFieldHtml("bulkPdf")}<label>اللجنة<select id="bulkPdfCommittee"><option value="all">كل اللجان</option>${committees.map(name=>`<option>${escapeHtml(name)}</option>`).join("")}</select></label></div><fieldset><legend>المركز (اختياري، يمكن اختيار أكثر من مركز)</legend><div class="committee-level-options">${centerCheckboxesHtml("bulkPdfCenter",centers)}</div></fieldset><fieldset><legend>المستوى (اختياري، يمكن اختيار أكثر من مستوى)</legend><div class="committee-level-options">${levelCheckboxesHtml("bulkPdfLevel")}</div></fieldset><p>تُحدّث قائمة اللجان مباشرة من الإعدادات. لكل متسابق صفحة واحدة، ويظهر معه المواضع واللجنة والعلامة وملخص التقييم.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="createBulkPdf" class="primary-btn"><i data-lucide="files"></i> إنشاء الملف</button></div>`,"bulk-pdf-modal");$("#createBulkPdf").onclick=()=>createBulkResultsPdf({status:$("#bulkPdfStatus").value,gender:$("#bulkPdfGender").value,centers:checkedValuesOf("bulkPdfCenter"),committee:$("#bulkPdfCommittee").value,levels:$$(`[name="bulkPdfLevel"]`).filter(i=>i.checked).map(i=>i.value)},{buttonId:"createBulkPdf",filenamePrefix:"ملفات-طلاب-المسابقة"});wireLevelSelectAll("bulkPdfCenter");wireLevelSelectAll("bulkPdfLevel");lucide.createIcons()}
async function openBulkDrawPdfDialog(){const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));openModal(`<div class="modal-head"><div><span class="eyebrow">قبل الاختبار — بدون علامات</span><h2>حفظ السحب للطلاب PDF</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid">${genderFieldHtml("bulkDrawPdf")}</div><fieldset><legend>المركز (اختياري، يمكن اختيار أكثر من مركز)</legend><div class="committee-level-options">${centerCheckboxesHtml("bulkDrawPdfCenter",centers)}</div></fieldset><fieldset><legend>المستوى (اختياري، يمكن اختيار أكثر من مستوى)</legend><div class="committee-level-options">${levelCheckboxesHtml("bulkDrawPdfLevel")}</div></fieldset><p>ملف واحد يجمع مواضع كل من تم سحبهم (بدون علامات)، حسب الفلترة المختارة.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="createBulkDrawPdf" class="primary-btn"><i data-lucide="file-stack"></i> إنشاء الملف</button></div>`,"bulk-pdf-modal");$("#createBulkDrawPdf").onclick=()=>createBulkResultsPdf({status:"all",gender:$("#bulkDrawPdfGender").value,centers:checkedValuesOf("bulkDrawPdfCenter"),committee:"all",levels:$$(`[name="bulkDrawPdfLevel"]`).filter(i=>i.checked).map(i=>i.value)},{buttonId:"createBulkDrawPdf",filenamePrefix:"سحب-الطلاب"});wireLevelSelectAll("bulkDrawPdfCenter");wireLevelSelectAll("bulkDrawPdfLevel");lucide.createIcons()}
async function createBulkResultsPdf(filters,options){
  const button=$(`#${options.buttonId}`);
  let draws=state.draws.filter(draw=>draw.participantId).filter(draw=>{
    const participant=state.participants.find(item=>item.id===draw.participantId);
    if(!participant)return false;
    if(filters.status==="completed"&&!Number.isFinite(participant.score))return false;
    if(filters.gender&&filters.gender!=="all"&&participant.gender!==filters.gender)return false;
    if(filters.centers?.length&&!filters.centers.includes(participant.center))return false;
    if(filters.committee&&filters.committee!=="all"&&resultCommitteeName(participant)!==filters.committee)return false;
    if(filters.levels?.length&&!filters.levels.includes(participant.levelName||`${participant.level} أجزاء`))return false;
    return true;
  });
  if(!draws.length)return toast("لا توجد ملفات مطابقة للاختيار");
  const originalHtml=button.innerHTML;button.disabled=true;button.textContent=`جاري تجهيز 1 من ${draws.length}`;
  let cancelled=false;const cancelBtn=document.createElement("button");cancelBtn.type="button";cancelBtn.className="secondary-btn";cancelBtn.textContent="إلغاء التصدير";cancelBtn.onclick=()=>{cancelled=true;cancelBtn.disabled=true;cancelBtn.textContent="جارٍ الإلغاء..."};button.insertAdjacentElement("afterend",cancelBtn);
  try{
    await ensurePdfLibraries();
    const {jsPDF}=window.jspdf,pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
    let produced=0;
    for(let index=0;index<draws.length&&!cancelled;index++){
      const draw=draws[index];const progressPct=Math.round((index/draws.length)*100);toast(`جاري تجهيز ${index+1} من ${draws.length} (${progressPct}%)`);button.textContent=`جاري تجهيز ${index+1} من ${draws.length}`;
      showResult(draw);const source=$(".result-modal"),clone=source.cloneNode(true);preparePdfClone(clone,draw);clone.querySelectorAll(".modal-actions,.result-warning,img").forEach(item=>item.remove());document.body.appendChild(clone);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const canvas=await window.html2canvas(clone,{scale:1.4,useCORS:false,allowTaint:false,backgroundColor:"#fff",logging:false});
      clone.remove();
      await new Promise(resolve=>setTimeout(resolve,0));
      if(cancelled)break;
      if(produced)pdf.addPage();await addCanvasAsSinglePdfPage(pdf,canvas,"JPEG",.82);produced++;
    }
    if(!produced)return toast(cancelled?"تم إلغاء التصدير":"تعذر إنشاء أي صفحة");
    const blob=pdf.output("blob"),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${options.filenamePrefix}-${dateStamp()}.pdf`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);closeModal();
    toast(cancelled?`تم إلغاء التصدير بعد حفظ ${produced} متسابقاً`:`تم تنزيل ${produced} متسابقاً؛ صفحة واحدة لكل متسابق`)
  }catch(error){console.error(error);toast(`تعذر إنشاء الملف: ${error.message}`)}
  finally{cancelBtn.remove();button.disabled=false;button.innerHTML=originalHtml}
}
// نظير createBulkResultsPdf/openBulkPdfDialog لديوان الحفاظ — نفس آلية التصدير حرفياً (استنساخ
// showDiwanResult كل سحب ثم تحويله لصورة صفحة PDF)، بفلتر واحد مُدمَج (نوع الاختبار + الاكتمال معاً
// بخانة اختيار واحدة لكل تركيبة) بدل فلترين منفصلين — طلب صريح.
function diwanStageCompletionCheckboxesHtml(name){
  const rows=[1,2,3,4].flatMap(stage=>[{stage,complete:true},{stage,complete:false}]);
  return `<label class="committee-member-toggle level-select-all"><input type="checkbox" data-level-all="${name}"> <b>الكل</b></label>`+
    rows.map(({stage,complete})=>`<label class="committee-member-toggle"><input type="checkbox" name="${name}" value="${stage}:${complete?"complete":"incomplete"}"> ${escapeHtml(DIWAN_STAGE_LABELS[stage])} - ${complete?"مكتمل":"غير مكتمل"}</label>`).join("");
}
function openDiwanBulkPdfDialog(){
  const centers=[...new Set(diwanState.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
  openModal(`<div class="modal-head"><div><span class="eyebrow">ملف واحد للطباعة</span><h2>تجميع ملفات ديوان الحفاظ PDF</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid">${genderFieldHtml("diwanBulkPdf")}</div><fieldset><legend>المركز (اختياري، يمكن اختيار أكثر من مركز)</legend><div class="committee-level-options">${centerCheckboxesHtml("diwanBulkPdfCenter",centers)}</div></fieldset><fieldset><legend>الاختبار والحالة (اختياري، يمكن اختيار أكثر من خيار — اتركه فارغاً ليشمل الكل)</legend><div class="committee-level-options">${diwanStageCompletionCheckboxesHtml("diwanBulkPdfStage")}</div></fieldset><p>لكل سحب صفحة واحدة (ورقة مواضع الاختبار).</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="createDiwanBulkPdf" class="primary-btn"><i data-lucide="files"></i> إنشاء الملف</button></div>`,"bulk-pdf-modal");
  $("#createDiwanBulkPdf").onclick=()=>createDiwanBulkResultsPdf({gender:$("#diwanBulkPdfGender").value,centers:checkedValuesOf("diwanBulkPdfCenter"),stageCompletion:checkedValuesOf("diwanBulkPdfStage")},{buttonId:"createDiwanBulkPdf",filenamePrefix:"ملفات-ديوان-الحفاظ"});
  wireLevelSelectAll("diwanBulkPdfCenter");wireLevelSelectAll("diwanBulkPdfStage");
  lucide.createIcons();
}
async function createDiwanBulkResultsPdf(filters,options){
  const button=$(`#${options.buttonId}`);
  const stageCompletionSet=filters.stageCompletion?.length?new Set(filters.stageCompletion):null;
  let draws=diwanState.draws.filter(draw=>draw.participantId).filter(draw=>{
    const participant=diwanState.participants.find(item=>item.id===draw.participantId);
    if(!participant)return false;
    if(filters.gender&&filters.gender!=="all"&&participant.gender!==filters.gender)return false;
    if(filters.centers?.length&&!filters.centers.includes(participant.center))return false;
    if(stageCompletionSet){
      const session=diwanSessionForDraw(draw),complete=Boolean(session&&session.status==="final");
      if(!stageCompletionSet.has(`${draw.stage}:${complete?"complete":"incomplete"}`))return false;
    }
    return true;
  });
  if(!draws.length)return toast("لا توجد ملفات مطابقة للاختيار");
  const originalHtml=button.innerHTML;button.disabled=true;button.textContent=`جاري تجهيز 1 من ${draws.length}`;
  let cancelled=false;const cancelBtn=document.createElement("button");cancelBtn.type="button";cancelBtn.className="secondary-btn";cancelBtn.textContent="إلغاء التصدير";cancelBtn.onclick=()=>{cancelled=true;cancelBtn.disabled=true;cancelBtn.textContent="جارٍ الإلغاء..."};button.insertAdjacentElement("afterend",cancelBtn);
  try{
    await ensurePdfLibraries();
    const {jsPDF}=window.jspdf,pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
    let produced=0;
    for(let index=0;index<draws.length&&!cancelled;index++){
      const draw=draws[index];const progressPct=Math.round((index/draws.length)*100);toast(`جاري تجهيز ${index+1} من ${draws.length} (${progressPct}%)`);button.textContent=`جاري تجهيز ${index+1} من ${draws.length}`;
      showDiwanResult(draw);const source=$(".result-modal"),clone=source.cloneNode(true);preparePdfClone(clone,draw);clone.querySelectorAll(".modal-actions,.result-warning,img").forEach(item=>item.remove());document.body.appendChild(clone);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const canvas=await window.html2canvas(clone,{scale:1.4,useCORS:false,allowTaint:false,backgroundColor:"#fff",logging:false});
      clone.remove();
      await new Promise(resolve=>setTimeout(resolve,0));
      if(cancelled)break;
      if(produced)pdf.addPage();await addCanvasAsSinglePdfPage(pdf,canvas,"JPEG",.82);produced++;
    }
    if(!produced)return toast(cancelled?"تم إلغاء التصدير":"تعذر إنشاء أي صفحة");
    const blob=pdf.output("blob"),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${options.filenamePrefix}-${dateStamp()}.pdf`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);closeModal();
    toast(cancelled?`تم إلغاء التصدير بعد حفظ ${produced} ملفاً`:`تم تنزيل ${produced} ملفاً؛ صفحة واحدة لكل سحب`)
  }catch(error){console.error(error);toast(`تعذر إنشاء الملف: ${error.message}`)}
  finally{cancelBtn.remove();button.disabled=false;button.innerHTML=originalHtml}
}
function preparePdfClone(clone,draw){clone.classList.add("pdf-export-sheet");if(draw.positions.length>=8)clone.classList.add("pdf-dense");if(draw.positions.length>=11)clone.classList.add("pdf-ultra-dense")}
function canvasToDataUrlAsync(canvas,format,quality){return new Promise((resolve,reject)=>{if(!canvas.toBlob)return resolve(canvas.toDataURL(`image/${format.toLowerCase()}`,quality));canvas.toBlob(blob=>{if(!blob)return reject(new Error("تعذر إنشاء صورة الصفحة"));const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("تعذر قراءة صورة الصفحة"));reader.readAsDataURL(blob)},`image/${format.toLowerCase()}`,quality)})}
async function addCanvasAsSinglePdfPage(pdf,canvas,format="JPEG",quality=.88){const margin=7,pageWidth=pdf.internal.pageSize.getWidth(),pageHeight=pdf.internal.pageSize.getHeight(),availableWidth=pageWidth-margin*2,availableHeight=pageHeight-margin*2,scale=Math.min(availableWidth/canvas.width,availableHeight/canvas.height),width=canvas.width*scale,height=canvas.height*scale,x=(pageWidth-width)/2,y=margin;const dataUrl=await canvasToDataUrlAsync(canvas,format,quality);pdf.addImage(dataUrl,format,x,y,width,height,undefined,"FAST")}
function openAssociationCardDialog(){const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));openModal(`<div class="modal-head"><div><span class="eyebrow">نموذج جمعية المحافظة على القرآن الكريم</span><h2>حفظ بطاقات الاختبار للجمعية</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid"><label>الحالة<select id="assocCardStatus"><option value="all">الكل</option><option value="drawn">تم السحب فقط ولم يُختبر بعد</option><option value="completed">المكتملون فقط (تم اختبارهم)</option></select></label>${genderFieldHtml("assocCard")}</div><fieldset><legend>المركز (اختياري، يمكن اختيار أكثر من مركز)</legend><div class="committee-level-options">${centerCheckboxesHtml("assocCardCenter",centers)}</div></fieldset><fieldset><legend>المستوى (اختياري، يمكن اختيار أكثر من مستوى)</legend><div class="committee-level-options">${levelCheckboxesHtml("assocCardLevel")}</div></fieldset><p>ملف واحد يجمع بطاقة اختبار بصيغة الجمعية لكل متسابق مطابق للفلترة، بصفحة مستقلة لكل متسابق.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="createAssociationCards" class="primary-btn"><i data-lucide="badge-check"></i> إنشاء الملف</button></div>`,"bulk-pdf-modal");$("#createAssociationCards").onclick=()=>createAssociationCardsPdf({status:$("#assocCardStatus").value,gender:$("#assocCardGender").value,centers:checkedValuesOf("assocCardCenter"),levels:$$(`[name="assocCardLevel"]`).filter(i=>i.checked).map(i=>i.value)},{buttonId:"createAssociationCards",filenamePrefix:"بطاقات-الجمعية"});wireLevelSelectAll("assocCardCenter");wireLevelSelectAll("assocCardLevel");lucide.createIcons()}
async function createAssociationCardsPdf(filters,options){
  const button=$(`#${options.buttonId}`);
  const list=state.participants.filter(participant=>{
    const hasDraw=state.draws.some(draw=>draw.participantId===participant.id),hasScore=Number.isFinite(participant.score);
    if(filters.status==="drawn"&&!(hasDraw&&!hasScore))return false;
    if(filters.status==="completed"&&!hasScore)return false;
    if(filters.gender&&filters.gender!=="all"&&participant.gender!==filters.gender)return false;
    if(filters.centers?.length&&!filters.centers.includes(participant.center))return false;
    if(filters.levels?.length&&!filters.levels.includes(participant.levelName||`${participant.level} أجزاء`))return false;
    return true;
  });
  if(!list.length)return toast("لا يوجد متسابقون مطابقون للاختيار");
  const originalHtml=button.innerHTML;button.disabled=true;button.textContent=`جاري تجهيز 1 من ${list.length}`;
  let cancelled=false;const cancelBtn=document.createElement("button");cancelBtn.type="button";cancelBtn.className="secondary-btn";cancelBtn.textContent="إلغاء التصدير";cancelBtn.onclick=()=>{cancelled=true;cancelBtn.disabled=true;cancelBtn.textContent="جارٍ الإلغاء..."};button.insertAdjacentElement("afterend",cancelBtn);
  try{
    await ensurePdfLibraries();
    const logoSrc=await preloadImageAsDataUrl("assets/association-logo.png");
    const {jsPDF}=window.jspdf,pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
    let produced=0;
    for(let index=0;index<list.length&&!cancelled;index++){
      const participant=list[index];
      const progressPct=Math.round((index/list.length)*100);
      toast(`جاري تجهيز ${index+1} من ${list.length} (${progressPct}%)`);button.textContent=`جاري تجهيز ${index+1} من ${list.length} (${progressPct}%)`;
      const wrapper=document.createElement("div");wrapper.innerHTML=associationCardHtml(participant,logoSrc);
      const clone=wrapper.firstElementChild;document.body.appendChild(clone);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const canvas=await window.html2canvas(clone,{scale:1.2,useCORS:false,allowTaint:false,backgroundColor:"#ffffff",logging:false});
      clone.remove();
      await new Promise(resolve=>setTimeout(resolve,0));
      if(cancelled)break;
      if(produced)pdf.addPage();
      await addCanvasAsSinglePdfPage(pdf,canvas,"JPEG",.85);produced++;
    }
    if(!produced)return toast(cancelled?"تم إلغاء التصدير":"تعذر إنشاء أي بطاقة");
    const blob=pdf.output("blob"),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${options.filenamePrefix}-${dateStamp()}.pdf`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);closeModal();
    toast(cancelled?`تم إلغاء التصدير بعد حفظ ${produced} بطاقة`:`تم تنزيل ${produced} بطاقة؛ صفحة واحدة لكل متسابق`)
  }catch(error){console.error(error);toast(`تعذر إنشاء الملف: ${error.message}`)}
  finally{cancelBtn.remove();button.disabled=false;button.innerHTML=originalHtml}
}
function numberToArabicWords(value){
  const num=Number(value);
  if(!Number.isFinite(num))return "";
  const ones=["","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة"];
  const teens=["عشرة","أحد عشر","اثنا عشر","ثلاثة عشر","أربعة عشر","خمسة عشر","ستة عشر","سبعة عشر","ثمانية عشر","تسعة عشر"];
  const tens=["","","عشرون","ثلاثون","أربعون","خمسون","ستون","سبعون","ثمانون","تسعون"];
  function upTo99(n){
    if(n===0)return "";
    if(n<10)return ones[n];
    if(n<20)return teens[n-10];
    const t=Math.floor(n/10),o=n%10;
    return o===0?tens[t]:`${ones[o]} و${tens[t]}`;
  }
  function wholeWords(n){return n===0?"صفر":n===100?"مئة":upTo99(n)}
  const whole=Math.floor(Math.abs(num));
  const fracRaw=Math.round((Math.abs(num)-whole)*100);
  let words=wholeWords(whole);
  if(fracRaw>0){
    if(fracRaw===25)words+=" وربع";
    else if(fracRaw===50)words+=" ونصف";
    else if(fracRaw===75)words+=" وثلاثة أرباع";
    else if(fracRaw%10===0){
      const tenth=fracRaw/10;
      words+=tenth===1?" وعُشر":tenth===2?" وعُشران":` و${ones[tenth]} أعشار`;
    }
    else words+=` و${upTo99(fracRaw)} من مئة`;
  }
  return num<0?`سالب ${words}`:words;
}
function associationCardHtml(participant,logoSrc="assets/association-logo.png"){
  const final=participant?.assessment?.positions?.length?calculateFinalAssessment(participant.assessment):null;
  const totals=final?.totals||{},deductions=final?.deductions||{};
  const isIncomplete=Boolean(participant?.assessment?.incomplete);
  const score=Number.isFinite(participant?.score)?participant.score:(final?final.score:null);
  const hasScore=!isIncomplete&&Number.isFinite(score),passed=hasScore&&score>=PASS_SCORE;
  const errorRow=(label,type,perError)=>`<tr><td class="assoc-err-label">${escapeHtml(label)}</td><td colspan="3">${totals[type]?formatAssessmentNumber(totals[type]):"-"}</td><td>(${perError})</td><td>${deductions[type]?formatAssessmentNumber(deductions[type]):"-"}</td></tr>`;
  const parts=Array.isArray(participant?.parts)?participant.parts:[];
  const partsGrid=Array.from({length:30},(_,i)=>i+1).map(n=>`<span class="${parts.includes(n)?"marked":""}">${n}</span>`).join("");
  const center=participant?.center||"-";
  const examDate=participant?.assessment?.startedAt||participant?.gradedAt||null;
  const infoField=(label,value)=>`<td><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value??"")||"-")}</b></td>`;
  return `<div class="pdf-export-sheet association-card-sheet">
    <div class="assoc-header">
      <img class="assoc-logo" src="${escapeAttr(logoSrc)}" alt="شعار جمعية المحافظة على القرآن الكريم">
      <div class="assoc-header-text"><b>جمعية المحافظة على القرآن الكريم</b><span>بسم الله الرحمن الرحيم</span></div>
      <div class="assoc-year">1448هـ – 2026م</div>
    </div>
    <h2 class="assoc-title">بطاقة الاختبار</h2>
    <table class="assoc-info-table">
      <tr>${infoField("الاسم",participant?.name)}${infoField("الرقم",participant?.seat)}${infoField("العمر",participant?.age)}</tr>
      <tr>${infoField("الفرع",participant?.branch)}${infoField("المركز",center)}${infoField("المنطقة",center)}</tr>
      <tr>${infoField("المستوى",participant?.levelName||(participant?.level?`${participant.level} أجزاء`:""))}${infoField("رقم الهاتف",participant?.phone)}${infoField("التاريخ",examDate?formatExamDate(examDate):"")}</tr>
    </table>
    <div class="assoc-parts"><span>الأجزاء المحفوظة</span><div class="assoc-parts-grid">${partsGrid}</div></div>
    <table class="assoc-errors-table">
      <thead><tr><th>نوع الخطأ</th><th colspan="3">عدد الأخطاء</th><th>علامة كل خطأ</th><th>مجموع العلامات المخصومة</th></tr></thead>
      <tbody>
        ${errorRow("أخطاء اللغة","language",2)}
        ${errorRow("أخطاء الحفظ","memorization",2)}
        ${errorRow("أخطاء الأحكام","tajweed",1)}
        ${errorRow("الاعتذار عن القراءة من أحد المواضع","positionChange",10)}
        ${errorRow("أخطاء الأداء","hesitation",.2)}
        <tr class="assoc-total-row"><td colspan="5">مجموع علامات الأخطاء</td><td>${final?formatAssessmentNumber(final.totalDeduction):"-"}</td></tr>
      </tbody>
    </table>
    <table class="assoc-score-table">
      <tr><td rowspan="2" class="assoc-score-label">العلامة ( بعد طرح مجموع الأخطاء من 100 )<br>علامة النجاح (75%)</td><td>رقماً</td><td>${isIncomplete?"غير مكتمل":hasScore?score:"-"}</td></tr>
      <tr><td>كتابة</td><td>${hasScore?escapeHtml(numberToArabicWords(score)):""}</td></tr>
    </table>
    <div class="assoc-result-row"><span>النتيجة :</span><label><span class="assoc-check ${passed?"checked":""}"></span> ناجح</label><label><span class="assoc-check ${hasScore&&!passed?"checked":""}"></span> غير ناجح</label></div>
    <div class="assoc-notes-row"><span>ملاحظات</span><b></b></div>
    <div class="assoc-committee-row"><span>${escapeHtml(resultCommitteeName(participant)||"لجنة الاختبار")}</span><div class="assoc-committee-members"><b>رئيس اللجنة: ${escapeHtml(resultCommitteeChairmanName(participant)||"-")}</b>${resultCommitteeMemberName(participant)?`<b>عضو اللجنة: ${escapeHtml(resultCommitteeMemberName(participant))}</b>`:""}</div></div>
  </div>`;
}
async function importCsv(event){
  const file=event.target.files[0];if(!file)return;
  try{
    const includeSpecial=confirm("هل تريد شمل طلاب مستوى 30 والروايات الأخرى؟\nموافق: شملهم — إلغاء: استبعدهم (الموصى به للمسابقة)");
    if(!/\.csv$/i.test(file.name))await ensureXlsx();
    const sources=[];
    if(/\.csv$/i.test(file.name)){const text=await file.text();sources.push({matrix:text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean).map(parseCsvLine)})}
    else{const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});for(const sheetName of workbook.SheetNames){if(String(sheetName).trim()==="تعليمات")continue;sources.push({matrix:XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:"",raw:false})})}}
    let added=0,updated=0,empty=0,invalidLevel=0,awaitingParts=0,excludedSpecial=0,ignoredSheets=0,missingCenter=0,duplicateSeat=0,withdrawnFromImport=0;const importedCenters=new Set(),rejectedNames=[],levelKeptNames=[];
    for(const source of sources){
      const parsed=rowsFromMatrix(source.matrix);if(!parsed.hasNameColumn){ignoredSheets++;continue}
      for(const row of parsed.rows){
        const name=pickColumn(row,["الاسم","اسمالمتسابق","اسمالطالب","اسمالمشارك","الاسمالرباعي","اسمالحافظ","المتسابق","الطالب","المشارك","name"]);
        if(!String(name).trim()){empty++;continue}
        const levelInfo=inferCompetitionLevel(row);
        if(!levelInfo){invalidLevel++;rejectedNames.push(`${name}: مستوى غير معروف`);continue}
        const level=levelInfo.parts,levelName=levelInfo.label;
        const recitation=String(pickColumn(row,["الرواية","القراءة","نوعالرواية","recitation"])).trim(),otherRecitation=Boolean(recitation)&&!/حفص|عاصم/i.test(recitation);
        if(!includeSpecial&&(level===30||otherRecitation)){excludedSpecial++;rejectedNames.push(`${name}: ${level===30?"مستوى كامل القرآن":"رواية أخرى"}`);continue}
        const rawParts=pickColumn(row,["الاجزاءالمشاركة","الأجزاءالمشاركة","ارقامالاجزاء","أرقامالأجزاء","الاجزاء","الأجزاء","parts"]);
        const withdrawnFromCell=/منسحب|انسحاب|انسحب/.test(String(rawParts||""));
        const parsedParts=withdrawnFromCell?[]:parsePartSpec(rawParts);
        const parts=parsedParts.length===level?parsedParts:[];
        if(!parts.length&&!withdrawnFromCell)awaitingParts++;
        const gender=normalizeGender(pickColumn(row,["الجنس","النوع","ذكرانثى","gender","sex"]));
        const rowCenter=String(pickColumn(row,["المركز","اسمالمركز","المسجد","الدار","الجمعية","center"])||"").trim();
        const center=rowCenter;if(!center)missingCenter++;
        const phone=String(pickColumn(row,["الهاتف","رقمالهاتف","الجوال","phone"])||"").trim();
        const seat=String(pickColumn(row,["رقمالجلوس","رقمالمتسابق","الرقم","التسلسل","م","seat"])||"").trim();
        const age=Number(normalizeDigits(pickColumn(row,["العمر","السن","age"])))||null;
        const existing=seat?state.participants.find(p=>String(p.seat).trim()===seat):null;
        if(existing&&existing.name.trim()!==String(name).trim()){
          duplicateSeat++;rejectedNames.push(`${name}: رقم الجلوس ${seat} مسجَّل مسبقًا لمتسابق آخر باسم مختلف (${existing.name}) — لم يُسجَّل`);continue
        }
        if(existing){
          // تحديث بيانات التسجيل من الملف (المصدر الصحيح) دون المساس بأي علامة أو سحب موجود مسبقاً لهذا المتسابق.
          existing.name=String(name).trim();existing.gender=gender;existing.center=center;existing.phone=phone||null;existing.branch=BRANCH_NAME;existing.age=age;existing.recitation=recitation||"حفص عن عاصم";
          const hasDraw=state.draws.some(d=>d.participantId===existing.id);
          if(!hasDraw){existing.level=level;existing.levelName=levelName;existing.parts=parts}
          else if(existing.level!==level)levelKeptNames.push(existing.name);
          if(withdrawnFromCell&&!hasDraw){existing.withdrawn=true;existing.score=0;existing.gradedAt=new Date().toISOString();existing.scoreSource="withdrawn";existing.manualEntryBy="استيراد Excel";existing.assessment=null;delete existing.drRequest;withdrawnFromImport++}
          updated++;if(center)importedCenters.add(center)
        }else{
          const item={id:uid("P"),name:String(name).trim(),seat:seat||nextSeat(),gender,center,phone:phone||null,branch:BRANCH_NAME,age,level,levelName,parts,recitation:recitation||"حفص عن عاصم",createdAt:new Date().toISOString()};
          if(withdrawnFromCell){item.withdrawn=true;item.score=0;item.gradedAt=item.createdAt;item.scoreSource="withdrawn";item.manualEntryBy="استيراد Excel";withdrawnFromImport++}
          state.participants.push(item);
          added++;if(center)importedCenters.add(center)
        }
      }
    }
    if(!added&&!updated)throw new Error(invalidLevel?"لم أتمكن من تحديد مستوى أي متسابق. تحقق من عمود المستوى ومطابقته لأسماء المستويات المعتمدة.":"لم أجد شيتاً يحتوي على عمود لأسماء المتسابقين.");
    saveState();renderAll();openModal(`<div class="modal-head"><h2>اكتمل استيراد ملف Excel</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="bulk-summary"><div><b>${added}</b><span>متسابقاً تمت إضافتهم</span></div><div><b>${updated}</b><span>تم تحديث بياناتهم من الملف</span></div><div><b>${importedCenters.size}</b><span>مركزاً</span></div></div>${missingCenter?`<p class="form-error"><b>${missingCenter} متسابقاً بلا مركز محدد</b> — لم يُعثر على عمود المركز أو كان فارغاً لهذه الصفوف، لم يُخمَّن أي اسم مركز. عدّل مركزهم يدوياً من قائمة المتسابقين.</p>`:""}${levelKeptNames.length?`<p class="form-error"><b>${levelKeptNames.length} متسابقاً</b> — مستواهم بالملف يختلف عمّا هو محفوظ، لكن تُرك كما هو لأن لديهم سحباً قائماً بالفعل (لتجنّب إلغاء مواضعه). لتغيير المستوى فعلياً، عدّله يدوياً من زر «تعديل» بعد مراجعة السحب: ${levelKeptNames.map(escapeHtml).join("، ")}</p>`:""}${awaitingParts?`<p>${awaitingParts} من المتسابقين المضافين بانتظار إدخال أرقام أجزائهم يدوياً قبل إمكانية سحبهم.</p>`:""}${withdrawnFromImport?`<p>${withdrawnFromImport} من المتسابقين سُجّلوا منسحبين تلقائياً (وردت كلمة انسحاب في خانة أجزائهم بالملف) وعلامتهم صفر.</p>`:""}${excludedSpecial?`<p>استُبعد ${excludedSpecial} من كامل القرآن أو الروايات الأخرى حسب اختيارك.</p>`:""}${invalidLevel?`<p class="form-error">تم تجاوز ${invalidLevel} صفاً لأن المستوى غير معروف أو غير مطابق لأسماء المستويات المعتمدة.</p>`:""}${duplicateSeat?`<p class="form-error"><b>${duplicateSeat} متسابقاً لم يُسجَّلوا</b> — رقم جلوسهم مكرر مع متسابق آخر مختلف الاسم مسجَّل مسبقًا. يكفي تسجيل واحد فقط لكل رقم جلوس؛ راجع القائمة أدناه وصحّح رقم الجلوس ثم أعد الاستيراد.</p>`:""}${rejectedNames.length?`<details><summary>عرض الأسماء المستبعدة وأسبابها</summary><p>${rejectedNames.map(escapeHtml).join("<br>")}</p></details>`:""}${ignoredSheets?`<p class="form-error">تم تجاهل ${ignoredSheets} شيت لعدم العثور على عمود الاسم.</p>`:""}${empty?`<p>تم تجاوز ${empty} صفوف فارغة.</p>`:""}</div><div class="modal-actions"><button class="primary-btn" data-close>حسناً</button></div>`);
  }catch(error){openModal(`<div class="modal-head"><h2>تعذر استيراد الملف</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>${escapeHtml(error.message||"تعذر قراءة ملف Excel")}</p><p class="form-error">يجب أن يحتوي الملف على عمود لاسم المتسابق، ويفضل عمود للمستوى أو عدد الأجزاء.</p></div><div class="modal-actions"><button class="primary-btn" data-close>حسناً</button></div>`)}
  event.target.value="";
}
function inferCompetitionLevel(row){
  const preferred=pickColumn(row,["المستوى","عددالاجزاء","الاجزاءالمحفوظة","مستوىالحفظ","الفئة","فرعالمسابقة","level"]);
  const catalogMatch=matchLevelCatalog(preferred);if(catalogMatch)return {parts:catalogMatch.parts,label:catalogMatch.label};
  const direct=parseCompetitionLevel(preferred);if(direct)return {parts:direct,label:null};
  for(const [header,value] of Object.entries(row)){
    if(!isMarkedExcelCell(value))continue;
    const headerCatalog=matchLevelCatalog(header);if(headerCatalog)return {parts:headerCatalog.parts,label:headerCatalog.label};
    const headerLevel=parseCompetitionLevel(header);if(headerLevel)return {parts:headerLevel,label:null};
  }
  return null;
}
function parseCompetitionLevel(value){
  const raw=normalizeDigits(value),text=normalizeHeader(raw);if(!text)return null;if(text.includes("القرانكاملا")||text.includes("كاملالقران")||text.includes("ختمالقران"))return 30;
  const partsMatch=String(raw).match(/(30|25|20|15|10|5)\s*(?:جزء(?:اً|ا)?|أجزاء|اجزاء)/i);if(partsMatch)return Number(partsMatch[1]);
  const memorizationMatch=String(raw).match(/(?:حفظ|يحفظ)\s*(30|25|20|15|10|5)(?!\d)/i);if(memorizationMatch)return Number(memorizationMatch[1]);
  const numbers=[...text.matchAll(/\d+/g)].map(match=>Number(match[0]));for(const level of [30,25,20,15,10,5])if(numbers.includes(level))return level;
  const wordLevels=[[30,["ثلاثون","ثلاثين","الثلاثون"]],[25,["خمسةوعشرون","خمسةوعشرين","خمسوعشرون","خمسوعشرين","الخامسوالعشرون"]],[20,["عشرون","عشرين","العشرون"]],[15,["خمسةعشر","خمسةعشرة","خمسعشر","الخامسعشر"]],[10,["عشرة","عشر","العاشر"]],[5,["خمسة","خمس","الخامس"]]];for(const [level,words] of wordLevels)if(words.some(word=>text.includes(normalizeHeader(word))))return level;return null;
}
function isMarkedExcelCell(value){const text=normalizeHeader(normalizeDigits(value));return Boolean(text)&&!["0","لا","كلا","no","false","غيرمشترك"].includes(text)}
function rowsFromMatrix(matrix){const known=["الاسم","اسمالمتسابق","اسمالطالب","اسمالمشارك","الاسمالرباعي","اسمالحافظ","المتسابق","الطالب","المشارك","name"];let headerIndex=-1,bestScore=0;matrix.slice(0,25).forEach((row,index)=>{const normalized=row.map(canonicalHeader),score=normalized.filter(cell=>known.includes(cell)).length*10+normalized.filter(cell=>["المستوى","عددالاجزاء","المركز","العمر","رقمالجلوس"].includes(cell)).length;if(score>bestScore){bestScore=score;headerIndex=index}});if(headerIndex<0)headerIndex=matrix.findIndex(row=>row.filter(value=>String(value).trim()).length>=2);const headers=(matrix[headerIndex]||[]).map(canonicalHeader);return {headers,hasNameColumn:headers.some(header=>known.includes(header)),rows:matrix.slice(headerIndex+1).filter(row=>row.some(value=>String(value).trim())).map(row=>Object.fromEntries(row.map((value,index)=>[headers[index]||`column${index}`,value])))}}
function normalizeHeader(value){return String(value).trim().toLowerCase().replace(/[أإآ]/g,"ا").replace(/[^\p{L}\p{N}]/gu,"")}
function canonicalHeader(value){const header=normalizeHeader(value);if(header==="name"||header==="الاسم"||(header.includes("اسم")&&["طالب","متسابق","مشارك","حافظ"].some(word=>header.includes(word))))return "الاسم";if(header.includes("مستوى"))return "المستوى";if(header.includes("عدد")&&header.includes("جز"))return "عددالاجزاء";if(header.includes("جز")&&["مشارك","ارقام","رقم","محفوظ","مشمول"].some(word=>header.includes(word)))return "الاجزاءالمشاركة";if(header.includes("رواي")||header.includes("قراء"))return "الرواية";if(header.includes("مركز"))return "المركز";if(header.includes("جلوس"))return "رقمالجلوس";if(header.includes("عمر")||header==="السن")return "العمر";return header}
function pickColumn(row,names){for(const name of names){const key=normalizeHeader(name);if(row[key]!==undefined&&row[key]!=="")return row[key]}return ""}
function normalizeDigits(value){return String(value??"").replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d))}
function normalizeGender(value){const gender=normalizeHeader(value);if(["ذكر","ذكور","male","m"].includes(gender))return "ذكر";if(["انثى","اناث","female","f"].includes(gender))return "أنثى";return "غير محدد"}
// يقرأ الأجزاء من أي صيغة: «1-5، 13-17» أو «1 - 5 ؛ 13–17» أو أرقام مفردة — بأي فاصل وأي شكل شَرطة (- – — − ـ ~)، ويتجاهل محارف الاتجاه المخفية التي يضيفها Excel للنص العربي. النطاق «1-5» = 1،2،3،4،5.
function parsePartSpec(value){const text=normalizeDigits(value).replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/g,"");const parts=new Set(),add=n=>{if(n>=1&&n<=30)parts.add(n)};for(const match of text.matchAll(/(\d+)(?:\s*[-_\u2010-\u2015\u2212\u0640~]+\s*(\d+))?/g)){const a=Number(match[1]);if(match[2]===undefined){add(a);continue}const b=Number(match[2]);for(let n=Math.max(1,Math.min(a,b));n<=Math.min(30,Math.max(a,b));n++)add(n)}return [...parts].sort((a,b)=>a-b)}
function parseCsvLine(line){const result=[];let value="",quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'&&line[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=!quoted;else if(c===","&&!quoted){result.push(value);value=""}else value+=c}result.push(value);return result}

function buildPartsGrid(){updateAvailability()}
function refreshDrawParticipants(){const current=$("#drawParticipant").value;$("#drawParticipant").innerHTML=`<option value="">اختر متسابقًا مسجلًا</option>`+state.participants.map(p=>`<option value="${p.id}">${escapeHtml(p.seat)} · ${escapeHtml(p.name)}</option>`).join("");$("#drawParticipant").value=current}
function loadParticipantIntoDraw(){const p=state.participants.find(x=>x.id===$("#drawParticipant").value);$("#drawLevel").disabled=Boolean(p);closeDrawPartsEditor();if(!p){$("#drawPartsSummary").textContent="اختر متسابقًا مسجلًا";$("#drawPartsEditBtn").classList.add("hidden");return updateAvailability()}$("#drawName").value=p.name;$("#drawSeat").value=p.seat;$("#drawCenter").value=p.center;$("#drawAge").value=p.age||"";$("#drawLevel").value=p.level;$("#drawQuestionCount").value=LEVEL_QUESTIONS[p.level]||3;$("#drawPartsSummary").textContent=p.parts?.length===p.level?p.parts.join("، "):"الأجزاء غير مسجلة بعد";$("#drawPartsEditBtn").classList.remove("hidden");$("#drawPartsEditBtn").textContent=p.parts?.length===p.level?"تعديل الأجزاء":"تسجيل الأجزاء";updateAvailability();if(p.parts?.length!==p.level)showDrawError("الرجاء تسجيل الأجزاء المشاركة فيها للمتسابق (من زر «تسجيل/تعديل الأجزاء» بالأسفل، أو من تعديل بيانات المتسابق) قبل إجراء السحب")}
function openDrawPartsEditor(){const p=state.participants.find(x=>x.id===$("#drawParticipant").value);if(!p)return;$("#drawPartsInput").value=(p.parts||[]).join(",");$("#drawPartsEditor").classList.remove("hidden");$("#drawPartsInput").focus()}
function closeDrawPartsEditor(){const editor=$("#drawPartsEditor");if(editor)editor.classList.add("hidden")}
function saveDrawParticipantParts(){
  const p=state.participants.find(x=>x.id===$("#drawParticipant").value);
  if(!p)return;
  if(state.draws.some(d=>d.participantId===p.id))return toast("لهذا المتسابق سحب مسجَّل مسبقًا؛ لتغيير أجزائه استخدم زر «تعديل» من قائمة المتسابقين حتى يُلغى السحب والتقييم القديم بأمان");
  const parsedParts=parsePartSpec($("#drawPartsInput").value.trim());
  if(parsedParts.length!==p.level)return toast(`سجّل ${p.level} أجزاء بالضبط`);
  p.parts=parsedParts.map(Number).sort((a,b)=>a-b);
  saveState();
  closeDrawPartsEditor();
  loadParticipantIntoDraw();
  toast("تم تسجيل أجزاء المتسابق");
}
function levelChanged(){const level=Number($("#drawLevel").value);$("#drawQuestionCount").value=LEVEL_QUESTIONS[level]||3;updateAvailability()}
function selectFirstParts(){const count=Number($("#drawLevel").value)||0;$$(`#partsGrid input`).forEach((input,index)=>input.checked=index<count);updateAvailability()}
function handlePartSelection(event){const level=Number($("#drawLevel").value);if(!level){event.target.checked=false;toast("اختر عدد الأجزاء أولاً");return updateAvailability()}if(selectedParts().length>level){event.target.checked=false;toast(`لا يمكن اختيار أكثر من ${level} أجزاء لهذا المستوى`)}updateAvailability()}
function togglePartRange(range){const level=Number($("#drawLevel").value);if(!level)return toast("اختر عدد الأجزاء أولاً");const [start,end]=range.split("-").map(Number),inputs=$$("#partsGrid input"),rangeInputs=inputs.filter(input=>Number(input.value)>=start&&Number(input.value)<=end),allSelected=rangeInputs.every(input=>input.checked);if(!allSelected){const selectedOutside=inputs.filter(input=>input.checked&&!rangeInputs.includes(input)).length;if(selectedOutside+rangeInputs.length>level)return toast(`هذا الاختيار يتجاوز عدد أجزاء هذا المستوى (${level})`)}rangeInputs.forEach(input=>input.checked=!allSelected);updateAvailability()}
function selectedParts(){const participant=state.participants.find(item=>item.id===$("#drawParticipant").value);return participant&&participant.parts?.length===participant.level?[...participant.parts]:[]}
// تكرار نفس الموضع بين متسابقين مختلفين مقبول — اختيار عشوائي بحت (randomIndex) بلا أي تفضيل حسب سبق الاستخدام.
function availableForParts(parts,level=null){return candidates.filter(c=>parts.includes(c.juz))}
function updateAvailability(){const parts=selectedParts(),level=Number($("#drawLevel")?.value)||null,available=availableForParts(parts,level);$("#availableCount").textContent=parts.length?`${formatNumber(available.length)} موضعاً`:"اختر متسابقًا بأجزاء مكتملة"}

async function performDraw(event){
  event.preventDefault();const error=$("#drawError");error.classList.add("hidden");const submit=event.submitter;let submitOriginalHtml=null;if(submit){submitOriginalHtml=submit.innerHTML;submit.disabled=true;submit.textContent="جاري تجهيز بيانات القرآن..."}try{await ensureQuranReady()}catch(loadError){if(submit){submit.disabled=false;submit.innerHTML=submitOriginalHtml??"إجراء السحب"}return showDrawError(`تعذر تجهيز بيانات القرآن: ${loadError.message}`)}if(submit){submit.disabled=false;submit.innerHTML=submitOriginalHtml??"إجراء السحب"}const level=Number($("#drawLevel").value),parts=selectedParts(),questionCount=Number($("#drawQuestionCount").value);
  const registeredParticipant=state.participants.find(item=>item.id===$("#drawParticipant").value);
  if(!registeredParticipant)return showDrawError("اختر متسابقًا مسجلًا؛ الأجزاء تُعتمد من بيانات المتسابق فقط");
  if(registeredParticipant&&registeredParticipant.parts?.length!==registeredParticipant.level)return showDrawError("الرجاء إدخال الأجزاء المشاركة فيها للمتسابق من زر تعديل قبل إجراء السحب");
  if(!level||parts.length!==level)return showDrawError(`يجب اختيار ${level||"عدد المستوى"} أجزاء بالضبط`);
  if(questionCount<1||questionCount>Math.min(15,parts.length))return showDrawError("عدد الأسئلة يجب ألا يتجاوز عدد الأجزاء المختارة أو 15 سؤالاً");
  const pools=new Map(parts.map(j=>[j,availableForParts([j],level)]));const eligibleParts=parts.filter(j=>pools.get(j).length);
  if(eligibleParts.length<questionCount)return showDrawError("لا توجد مواضع كافية ضمن الأجزاء المختارة.");
  const drawnParts=secureShuffle(eligibleParts).slice(0,questionCount);const positions=drawnParts.map(j=>pools.get(j)[randomIndex(pools.get(j).length)]).sort((a,b)=>a.juz-b.juz);
  const draw={id:uid("DRAW"),sequence:nextDrawSequence(),participantId:$("#drawParticipant").value||null,name:$("#drawName").value.trim(),seat:$("#drawSeat").value.trim(),center:$("#drawCenter").value.trim(),age:Number($("#drawAge").value)||null,level,eligibleParts:parts,positions,createdAt:new Date().toISOString(),rerolls:[],verification:""};
  if(submit){submit.disabled=true;submit.textContent="جارٍ سحب مواضع الطلاب..."}
  try{draw.verification=await createVerification(draw);if(operationMode==="cloud"&&cloudEnabled&&window.CloudCompetition.context?.kind==="admin")Object.assign(draw,await window.CloudCompetition.createAdminDraw(draw));else if(operationMode==="cloud"&&cloudEnabled&&window.CloudCompetition.context?.kind==="subAdmin")Object.assign(draw,await window.CloudCompetition.createSubAdminDraw(draw));else if(operationMode==="cloud"&&cloudEnabled&&window.CloudCompetition.context?.kind==="supervisor")Object.assign(draw,await window.CloudCompetition.createSupervisorDraw(draw));state.draws.push(draw);if(operationMode!=="cloud")saveState();renderAll();await playIndividualReveal(draw);showResult(draw);$("#drawForm").reset();$("#drawLevel").disabled=false;$("#drawPartsSummary").textContent="اختر متسابقًا مسجلًا";updateAvailability()}catch(drawError){showDrawError(drawError.message)}finally{if(submit){submit.disabled=false;submit.innerHTML=submitOriginalHtml??"إجراء السحب"}}
}
async function createVerification(draw){return (await hashText(JSON.stringify({id:draw.id,name:draw.name,positions:draw.positions.map(p=>p.id),createdAt:draw.createdAt}))).slice(0,12).toUpperCase()}
function playIndividualReveal(draw){return new Promise(resolve=>{openModal(`<div class="draw-reveal"><span class="eyebrow light">جمعية المحافظة على القرآن الكريم | فرع الكورة</span><h2>${escapeHtml(draw.name)}</h2><p>${draw.level} أجزاء · ${draw.positions.length} مواضع</p><div id="revealCountdown" class="reveal-countdown">3</div><small>جاري إجراء السحب</small></div>`,"reveal-modal");let count=3;const timer=setInterval(()=>{count--;if(count>0){$("#revealCountdown").textContent=count}else{clearInterval(timer);$("#revealCountdown").innerHTML=`<i data-lucide="check"></i>`;$(".draw-reveal small").textContent="تم تثبيت المواضع";lucide.createIcons();setTimeout(()=>{closeModal();resolve()},650)}},650)})}
function showDrawError(message){$("#drawError").textContent=message;$("#drawError").classList.remove("hidden")}
function resultCommitteeName(participant){return participant?.assessment?.committeeName||participant?.assessment?.committee?.name||""}
function resultCommitteeChairmanName(participant){return participant?.assessment?.committeeChairmanName||""}
function resultCommitteeMemberName(participant){return participant?.assessment?.committeeMemberName||""}
function compactAssessmentSummary(participant,draw){const assessment=participant?.assessment;if(!assessment?.positions?.length)return "";const labels={memorization:"حفظ",language:"لغة",tajweed:"تجويد",hesitation:"تردد",positionChange:"تغيير"},failedAt=failurePositionIndex(assessment),drawById=new Map(draw.positions.map(position=>[position.id,position]));const rows=assessment.positions.map((item,index)=>{const result=calculateAssessment({positions:[item]}),errors=Object.keys(labels).filter(type=>(Number(item[type])||0)>0).map(type=>`${labels[type]} ${Number(item[type])} (−${formatAssessmentNumber(result.deductions[type])})`).join(" · ")||"دون أخطاء",position=drawById.get(item.positionId)||draw.positions[index],note=String(item.note||"").trim(),changed=item.changes?.length?` · تغيّر من ${positionTitle(item.changes[item.changes.length-1].oldPosition)}`:"";return `<div class="assessment-print-row ${failedAt===index?"failed-threshold":""}"><b>${index+1}</b><span>${escapeHtml(position?positionTitle(position):`الموضع ${index+1}`)}${escapeHtml(changed)}</span><strong>${escapeHtml(errors)} · مجموع الخصم ${formatAssessmentNumber(result.totalDeduction)}</strong>${failedAt===index?`<small>هنا وصلت العلامة إلى حد الرسوب</small>`:note?`<small>${escapeHtml(note)}</small>`:""}</div>`}).join("");return `<section class="assessment-print-summary"><div class="assessment-print-title"><b>ملخص التقييم الإلكتروني</b>${resultCommitteeName(participant)?`<span>اللجنة: ${escapeHtml(resultCommitteeName(participant))}</span>`:""}</div>${rows}</section>`}
function showResult(draw){
  const participant=state.participants.find(p=>p.id===draw.participantId);
  const legacyPositions=draw.positions.some(position=>!Number.isFinite(position.startId)||![8,9].includes(Number(position.lineCount))||position.lineModel!=="occupied-v2");
  const eligiblePartNumbers=(draw.eligibleParts?.length?draw.eligibleParts:participant?.parts?.length?participant.parts:Array.from({length:draw.level},(_,index)=>index+1)).join("، ");
  const examDate=participant?.assessment?.startedAt||participant?.gradedAt||null;
  openModal(`<div class="result-modal"><div class="print-only print-letterhead"><div><b>جمعية المحافظة على القرآن الكريم</b><span>فرع الكورة</span></div><strong>بسم الله الرحمن الرحيم</strong></div><div class="result-hero"><div><small>جمعية المحافظة على القرآن الكريم | فرع الكورة</small><h2>ورقة مواضع الاختبار</h2><small>${escapeHtml(state.config.competitionName)}</small></div><div class="draw-code"><small>رقم السحب</small><b>${draw.sequence.toString().padStart(4,"0")}</b><small>${escapeHtml(draw.verification)}</small></div></div><div class="result-person"><div><span>اسم المتسابق</span><b>${escapeHtml(draw.name)}</b></div><div><span>رقم الجلوس</span><b>${escapeHtml(draw.seat||"-")}</b></div><div><span>المركز</span><b>${escapeHtml(draw.center)}</b></div><div><span>مستوى الحفظ</span><b>${draw.level} أجزاء</b></div><div><span>موعد الاختبار</span><b>${examDate?formatExamDate(examDate):"لم يبدأ الاختبار بعد"}</b></div><div><span>العمر</span><b>${draw.age||"-"}</b></div></div><div class="positions-list"><div class="positions-title"><span>الرقم</span><span>الموضع المختار</span><span>الصفحة</span></div>${draw.positions.map((p,i)=>positionHtml(p,i)).join("")}</div><div class="print-only print-signatures"><div><span>اسم الممتحن</span><b></b></div><div><span>التوقيع</span><b></b></div><div><span>العلامة النهائية</span><b> / 100</b></div></div><div class="print-only print-footer"><span>تصميم وتطوير م. مأمون محمود الفقيه</span><span>تحسين م. محمد عادل الفقيه</span></div><p class="result-warning">تم تثبيت هذه المواضع وإضافتها إلى قائمة المنع لهذه الدورة.</p><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button><button class="secondary-btn" data-reroll="${draw.id}"><i data-lucide="refresh-cw"></i> إعادة موضع بسبب</button><button class="primary-btn" onclick="window.print()"><i data-lucide="printer"></i> طباعة النتيجة</button></div></div>`,"result-modal");
  const printResultButton=$(".result-modal .modal-actions .primary-btn");printResultButton.insertAdjacentHTML("beforebegin",`${participant?`<button id="startAssessmentBtn" class="assessment-launch-btn"><i data-lucide="clipboard-pen-line"></i> ${participant.assessment?.status==="final"?"عرض التقييم الإلكتروني":participant.assessment?"متابعة التقييم الإلكتروني":"بدء التقييم الإلكتروني"}</button>`:""}<button id="saveResultPdf" class="secondary-btn"><i data-lucide="file-down"></i> حفظ PDF</button>`);if(participant)$("#startAssessmentBtn").onclick=()=>openElectronicAssessment(draw);$("#saveResultPdf").onclick=()=>saveResultAsPdf(draw);lucide.createIcons();
  if(participant?.assessment?.positions?.length)$(".positions-list").insertAdjacentHTML("afterend",compactAssessmentSummary(participant,draw));
  $(".print-footer").innerHTML=`<div class="developer-credit"><b>تصميم وتطوير</b><span>م. مأمون محمود الفقيه</span><span>م. محمد عادل الفقيه</span></div>`;
  $(`[data-reroll="${draw.id}"]`).onclick=()=>requestReroll(draw.id);
  $(".print-letterhead").insertAdjacentHTML("afterbegin",`<img class="print-logo" src="assets/association-logo.png" alt="شعار جمعية المحافظة على القرآن الكريم">`);
  $(".print-letterhead>strong")?.remove();
  $(".result-person").insertAdjacentHTML("beforeend",`<div><span>الجنس</span><b>${escapeHtml(participant?.gender||"غير محدد")}</b></div>${participant?.assessment?.incomplete?`<div class="print-outcome"><span>النتيجة النهائية</span><b class="incomplete-text">غير مكتمل</b></div>`:participant&&Number.isFinite(participant.score)?`<div class="print-outcome"><span>النتيجة النهائية</span><b class="${participant.score>=PASS_SCORE?"pass-text":"fail-text"}">${participant.score} / 100 · ${participant.score>=PASS_SCORE?"ناجح":"راسب"}</b></div>`:""}<div class="participant-parts"><span>أرقام الأجزاء المشاركة</span><b>${eligiblePartNumbers}</b></div>`);
  if(resultCommitteeName(participant))$(".result-person").insertAdjacentHTML("beforeend",`<div class="result-committee"><span>لجنة الاختبار</span><b>${escapeHtml(resultCommitteeName(participant))}</b></div>`);
  if(legacyPositions)$(".result-hero").insertAdjacentHTML("afterend",`<p class="legacy-warning"><b>هذه نتيجة قديمة</b><span>أُنشئت قبل اعتماد معيار 8 أسطر بالضبط والبدايات المنطقية. أعد السحب لتطبيق المعيار الجديد.</span></p>`);
  $(".print-signatures")?.remove();
}
async function saveResultAsPdf(draw){
  const button=$("#saveResultPdf"),originalHtml=button.innerHTML,source=$(".result-modal"),clone=source.cloneNode(true),safeName=String(draw.name||"متسابق").replace(/[\\/:*?"<>|]/g,"-");
  button.disabled=true;
  let progress=5;button.textContent=`جاري إنشاء PDF... ${progress}%`;
  const progressTimer=setInterval(()=>{progress=Math.min(92,progress+3+Math.random()*8);button.textContent=`جاري إنشاء PDF... ${Math.round(progress)}%`},200);
  preparePdfClone(clone,draw);clone.removeAttribute("id");clone.querySelectorAll("img").forEach(image=>image.remove());
  document.body.appendChild(clone);
  try{
    await ensurePdfLibraries();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const canvas=await window.html2canvas(clone,{scale:2,useCORS:false,allowTaint:false,backgroundColor:"#ffffff",logging:false,imageTimeout:0,scrollX:0,scrollY:0});
    if(!canvas.width||!canvas.height)throw new Error("تعذر تصوير ورقة المواضع");
    clearInterval(progressTimer);button.textContent="جاري إنشاء PDF... 100%";
    const {jsPDF}=window.jspdf,pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
    await addCanvasAsSinglePdfPage(pdf,canvas,"JPEG",.9);
    const blob=pdf.output("blob");if(!blob.size)throw new Error("تم إنشاء ملف PDF فارغ");
    const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`مواضع-${safeName}-${String(draw.sequence).padStart(4,"0")}.pdf`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
    toast("تم تنزيل ملف PDF بصفحة واحدة")
  }catch(error){console.error(error);toast(`تعذر إنشاء PDF: ${error?.message||"خطأ غير معروف"}`)}
  finally{clearInterval(progressTimer);clone.remove();button.disabled=false;button.innerHTML=originalHtml;lucide.createIcons()}
}

const ASSESSMENT_RULES={memorization:{label:"خطأ الحفظ",deduction:2},language:{label:"خطأ اللغة",deduction:2},tajweed:{label:"خطأ التجويد",deduction:1},hesitation:{label:"التردد",deduction:.2},positionChange:{label:"تغيير الموضع",deduction:10}};
// سقف ثابت لأخطاء التجويد (مجموع كل المواضع) لكل ممتحِن على حدة — بعده تُسجَّل ضمن التردد بدلاً.
const TAJWEED_ERROR_CAP=10;
function tajweedTotalOf(assessment){return (assessment?.positions||[]).reduce((sum,p)=>sum+Math.max(0,Number(p.tajweed)||0),0)}
function emptyPositionAssessment(position){return {positionId:position.id,memorization:0,language:0,tajweed:0,hesitation:0,positionChange:0,note:"",completed:false}}
function currentExaminerRole(){return window.CloudCompetition.context?.committee?.examiner_role||"chairman"}
function examinerDraftKey(participantId){return `${ASSESSMENT_DRAFT_PREFIX}${currentExaminerRole()}-${participantId}`}
function ensureAssessment(participant,draw){const stored=participant.assessment?.examinerDrafts?.[currentExaminerRole()]||participant.assessment,previous=stored?.drawId===draw.id?stored:null,byPosition=new Map((previous?.positions||[]).map(item=>[item.positionId,item]));const assessment=previous||{id:uid("ASSESS"),drawId:draw.id,status:"draft",startedAt:new Date().toISOString(),revisions:[]};assessment.positions=draw.positions.map(position=>({...emptyPositionAssessment(position),...(byPosition.get(position.id)||{})}));assessment.updatedAt=new Date().toISOString();assessment.examinerRole=currentExaminerRole();participant.assessment=assessment;saveState();return assessment}
function calculateAssessment(assessment,passScore=PASS_SCORE){const totals={memorization:0,language:0,tajweed:0,hesitation:0,positionChange:0};(assessment?.positions||[]).forEach(position=>Object.keys(totals).forEach(type=>totals[type]+=Math.max(0,Number(position[type])||0)));const deductions=Object.fromEntries(Object.entries(totals).map(([type,count])=>[type,Math.round(count*ASSESSMENT_RULES[type].deduction*100)/100])),totalDeduction=Math.round(Object.values(deductions).reduce((sum,value)=>sum+value,0)*100)/100,score=Math.max(0,Math.round((100-totalDeduction)*100)/100);return {totals,deductions,totalDeduction,score,passed:score>=passScore}}
function positionsDiffer(own,member){return Object.keys(ASSESSMENT_RULES).some(type=>(Number(own?.[type])||0)!==(Number(member?.[type])||0))}
function positionDeductionFor(position){if(!position?.adopted)return calculateAssessment({positions:[position]}).totalDeduction;let total=0;for(const type of Object.keys(ASSESSMENT_RULES)){const count=Number.isFinite(position.adopted[type])?position.adopted[type]:(Number(position[type])||0);total+=count*ASSESSMENT_RULES[type].deduction}return Math.round(total*100)/100}
function calculateFinalAssessment(assessment,passScore=PASS_SCORE){const raw=calculateAssessment(assessment,passScore),totalDeduction=Math.round((assessment?.positions||[]).reduce((sum,p)=>sum+positionDeductionFor(p),0)*100)/100,score=Math.max(0,Math.round((100-totalDeduction)*100)/100);return {...raw,totalDeduction,score,passed:score>=passScore}}
function loadLocalAssessmentDraft(participantId){try{return JSON.parse(localStorage.getItem(examinerDraftKey(participantId))||"null")}catch{return null}}
function saveAssessmentDraft(participant){participant.assessment.status="draft";participant.assessment.updatedAt=new Date().toISOString();participant.assessment.examinerRole=currentExaminerRole();safeSetItem(examinerDraftKey(participant.id),JSON.stringify(participant.assessment));saveState();if(activeCloudSession)window.CloudCompetition.queueSessionSave(activeCloudSession.id,participant.assessment,error=>toast(`تعذر حفظ المسودة: ${error.message}`))}
function assessmentActionHtml(position,index,type,locked=false,tajweedCapWarning=false){const rule=ASSESSMENT_RULES[type],count=Number(position[type])||0,total=Math.round(count*rule.deduction*100)/100,lockedMessage=typeof locked==="string"?locked:"بانتظار تغيير الرئيس لهذا الموضع";return `<div class="exam-action ${type}"><button type="button" class="exam-action-add" data-assess-index="${index}" data-assess-type="${type}" data-assess-delta="1"${locked?" disabled":""}><span>${rule.label}</span><small>${locked?lockedMessage:`الواحدة ${formatAssessmentNumber(rule.deduction)} · الخصم ${formatAssessmentNumber(total)}`}</small><strong data-assess-count="${index}-${type}">${count}</strong><i data-lucide="${type==="positionChange"?"refresh-cw":"plus"}"></i></button>${type==="positionChange"?"":`<button type="button" class="exam-action-minus" data-assess-index="${index}" data-assess-type="${type}" data-assess-delta="-1" aria-label="التراجع عن ${rule.label}">−</button>`}${type==="tajweed"&&tajweedCapWarning?`<small class="exam-action-cap-warning">تم الوصول للحد الأقصى من الخصم على التجويد، يرجى تسجيل أي أخطاء تجويد إضافية ضمن خانة التردد</small>`:""}</div>`}
function drawPositionSegments(drawPosition){if(drawPosition.lineSegments?.length)return drawPosition.lineSegments;if(!quranLines?.verses)return [];const start=quranLines.verses[drawPosition.startKey],finish=quranLines.verses[drawPosition.endKey];if(!start||!finish)return [];if(start.page===finish.page)return [{page:start.page,from:start.from,to:finish.to}];const segments=[{page:start.page,from:start.from,to:15}];for(let page=start.page+1;page<finish.page;page++)segments.push({page,from:1,to:15});segments.push({page:finish.page,from:1,to:finish.to});return segments}
// حالة عارض المصحف (تكبير + نمط العرض) على مستوى الوحدة كي تبقى عند إعادة رسم لوحة الموضع بعد كل ضغطة.
const QURAN_VIEW_PREF_KEY="competition-quran-view-pref";
let quranViewPref=(()=>{try{const v=JSON.parse(localStorage.getItem(QURAN_VIEW_PREF_KEY)||"null");return {zoom:Math.min(3,Math.max(1,Number(v?.zoom)||1)),mode:v?.mode==="crop"?"crop":"full"}}catch{return {zoom:1,mode:"full"}}})();
function saveQuranViewPref(){safeSetItem(QURAN_VIEW_PREF_KEY,JSON.stringify(quranViewPref))}
function applyQuranViewPref(viewer){if(!viewer)return;viewer.style.setProperty("--qz",quranViewPref.zoom);viewer.classList.toggle("is-crop",quranViewPref.mode==="crop");viewer.classList.toggle("is-zoomed",quranViewPref.zoom>1);const label=viewer.querySelector("[data-quran-zoom-label]");if(label)label.textContent=`${Math.round(quranViewPref.zoom*100)}%`;const modeBtn=viewer.querySelector("[data-quran-view-mode]");if(modeBtn)modeBtn.textContent=quranViewPref.mode==="crop"?"عرض الصفحة كاملة":"قص الأسطر فقط"}
if(typeof document.addEventListener==="function")document.addEventListener("click",event=>{const zoomBtn=event.target.closest("[data-quran-zoom]"),modeBtn=event.target.closest("[data-quran-view-mode]");if(!zoomBtn&&!modeBtn)return;const viewer=(zoomBtn||modeBtn).closest(".quran-split-viewer");if(zoomBtn){const d=zoomBtn.dataset.quranZoom;quranViewPref.zoom=d==="reset"?1:Math.min(3,Math.max(1,Math.round((quranViewPref.zoom+Number(d))*100)/100))}else quranViewPref.mode=quranViewPref.mode==="crop"?"full":"crop";saveQuranViewPref();applyQuranViewPref(viewer)});
// تحميل صورة الموضع التالي مسبقاً (الحالي والتالي فقط) لتجنّب التأخير عند الانتقال.
function preloadNextQuranImage(draw,index){const next=draw?.positions?.[index+1];if(!next)return;try{drawPositionSegments(next).forEach(segment=>{const img=new Image();img.src=`assets/quran-pages/page-${String(segment.page).padStart(3,"0")}.jpg`})}catch{}}
function quranSplitPageHtml(drawPosition,pageOffset=0){const segments=drawPositionSegments(drawPosition);if(!segments.length)return `<div class="quran-split-empty">تعذر تحميل صفحة المصحف لهذا الموضع</div>`;const pages=new Map();segments.forEach(segment=>{if(!pages.has(segment.page))pages.set(segment.page,[]);pages.get(segment.page).push(segment)});const pageEntries=[...pages.entries()];const offset=Math.min(Math.max(0,pageOffset),pageEntries.length-1);const [pageNumber,pageSegments]=pageEntries[offset];const page=String(pageNumber).padStart(3,"0"),minFrom=Math.min(...pageSegments.map(x=>x.from)),maxTo=Math.max(...pageSegments.map(x=>x.to)),cropTop=Math.max(0,9.8+(minFrom-1)*5.35-1.2),cropBottom=Math.min(100,9.8+maxTo*5.35+1.2),cropH=cropBottom-cropTop,cropStyle=`--crop-ar:${(750/(1075*cropH/100)).toFixed(4)};--crop-top:${(-cropTop/cropH*100).toFixed(3)}%`,highlights=pageSegments.map(segment=>{const top=9.8+(segment.from-1)*5.35,height=(segment.to-segment.from+1)*5.35;return `<span class="quran-line-highlight" style="--highlight-top:${top}%;--highlight-height:${height}%"></span>`}).join(""),ranges=pageSegments.map(segment=>segment.from===segment.to?segment.from:`${segment.from}-${segment.to}`).join("، ");return `<div class="quran-split-viewer ${quranViewPref.mode==="crop"?"is-crop":""} ${quranViewPref.zoom>1?"is-zoomed":""}" style="--qz:${quranViewPref.zoom};${cropStyle}"><div class="quran-zoom-scroll"><div class="quran-split-image"><img src="assets/quran-pages/page-${page}.jpg" alt="صفحة المصحف ${pageNumber}">${highlights}</div></div><div class="quran-split-toolbar"><button type="button" class="icon-btn" data-quran-zoom="-0.25" aria-label="تصغير">−</button><small data-quran-zoom-label>${Math.round(quranViewPref.zoom*100)}%</small><button type="button" class="icon-btn" data-quran-zoom="0.25" aria-label="تكبير">+</button><button type="button" class="compact-btn" data-quran-zoom="reset">إعادة</button><button type="button" class="compact-btn" data-quran-view-mode>${quranViewPref.mode==="crop"?"عرض الصفحة كاملة":"قص الأسطر فقط"}</button></div><div class="quran-split-caption"><span>صفحة ${pageNumber} · الأسطر ${ranges}</span>${pageEntries.length>1?`<div class="quran-split-pager"><button type="button" class="icon-btn" data-quran-page-nav="-1"${offset===0?" disabled":""} aria-label="الصفحة السابقة من الموضع"><i data-lucide="chevron-right"></i></button><small>صفحة ${offset+1} من ${pageEntries.length} لهذا الموضع</small><button type="button" class="icon-btn" data-quran-page-nav="1"${offset===pageEntries.length-1?" disabled":""} aria-label="الصفحة التالية من الموضع"><i data-lucide="chevron-left"></i></button></div>`:""}</div></div>`}
function assessmentPositionHtml(position,drawPosition,index,total,chairmanChangeCount,quranPageOffset=0,rerollsUsed=0,tajweedCapWarning=false){const positionDeduction=calculateAssessment({positions:[position]}).totalDeduction,isMember=currentExaminerRole()==="member",memberLocked=isMember&&(Number(chairmanChangeCount)||0)<=(Number(position.positionChange)||0),chairmanRerollLimitReached=!isMember&&(Number(rerollsUsed)||0)>=2,types=Object.keys(ASSESSMENT_RULES);return `<article class="exam-position-card exam-split"><div class="exam-split-quran">${quranSplitPageHtml(drawPosition,quranPageOffset)}</div><div class="exam-split-panel"><div class="exam-position-label"><span>الموضع ${index+1} من ${total}</span><b data-position-deduction="${index}">خصم الموضع: ${formatAssessmentNumber(positionDeduction)}</b></div><h2>${escapeHtml(positionTitle(drawPosition))}</h2><p>الجزء ${drawPosition.juz} · الصفحة ${drawPosition.page}</p><div class="exam-actions">${types.map(type=>assessmentActionHtml(position,index,type,type==="positionChange"?(isMember&&memberLocked||(chairmanRerollLimitReached&&"لا يمكنك تغيير الموضع إلا مرتين كحد أقصى")):false,type==="tajweed"&&tajweedCapWarning)).join("")}</div>${examTimerRowHtml()}<label class="exam-note">ملاحظات الموضع<textarea data-assess-note="${index}" rows="2" placeholder="ملاحظة اختيارية عن أداء المتسابق">${escapeHtml(position.note||"")}</textarea></label><button type="button" class="secondary-btn exam-position-complete ${position.completed?"is-done":""}" data-toggle-complete="${index}"><i data-lucide="${position.completed?"check-circle-2":"circle"}"></i> ${position.completed?"أُنهي هذا الموضع":"إنهاء هذا الموضع"}</button></div></article>`}
// مؤقت مساعد اختياري (20 ثانية) + جرس تنبيه — أداة وقتية بحتة، لا تُحفظ ولا تؤثر على العلامة. module-level لضمان عدم بقاء setInterval سابق يعمل بالخلفية.
let examTimerRemaining=20,examTimerIntervalId=null,examBellAudioCtx=null;
function stopExamTimerInterval(){if(examTimerIntervalId){clearInterval(examTimerIntervalId);examTimerIntervalId=null}}
function resetExamTimerState(){stopExamTimerInterval();examTimerRemaining=20}
function renderExamTimerValue(){const el=$("#examTimerValue");if(el)el.textContent=String(examTimerRemaining).padStart(2,"0")}
function playExamTimerBell(){
  try{
    const ctx=examBellAudioCtx||(examBellAudioCtx=new (window.AudioContext||window.webkitAudioContext)());
    // بعض المتصفحات تنشئ AudioContext معلَّقاً (suspended) — بلا استئناف صريح أول صوت يضيع بصمت.
    if(ctx.state!=="running")ctx.resume();
    const now=ctx.currentTime+.01,master=ctx.createGain();
    master.gain.value=.5;master.connect(ctx.destination);
    // عدة ترددات غير متناغمة بنفس اللحظة (لا نغمة واحدة) لصوت جرس معدني حقيقي بدل بيب إلكتروني.
    [{freq:1000,gain:1,decay:.5},{freq:1997,gain:.5,decay:.32},{freq:2761,gain:.32,decay:.24},{freq:4070,gain:.18,decay:.16}].forEach(p=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type="sine";osc.frequency.value=p.freq;
      gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(p.gain,now+.006);gain.gain.exponentialRampToValueAtTime(.0001,now+p.decay);
      osc.connect(gain);gain.connect(master);osc.start(now);osc.stop(now+p.decay+.05);
    });
  }catch(error){console.warn("تعذر تشغيل صوت الجرس",error)}
}
function tickExamTimer(){
  if(!$("#examTimerValue")){stopExamTimerInterval();return} // الشاشة تغيّرت/أُغلقت — يوقف نفسه تلقائياً
  examTimerRemaining=Math.max(0,examTimerRemaining-1);
  renderExamTimerValue();
  if(examTimerRemaining<=0){stopExamTimerInterval();playExamTimerBell()}
}
function startExamTimer(){stopExamTimerInterval();examTimerRemaining=20;renderExamTimerValue();examTimerIntervalId=setInterval(tickExamTimer,1000)}
function zeroExamTimer(){stopExamTimerInterval();examTimerRemaining=0;renderExamTimerValue();playExamTimerBell()}
function examTimerRowHtml(){return `<div class="exam-timer-row"><div class="exam-timer-display"><i data-lucide="timer"></i><b id="examTimerValue">${String(examTimerRemaining).padStart(2,"0")}</b><span>ثانية</span></div><div class="exam-timer-controls"><button type="button" class="compact-btn" data-exam-timer-action="start">تشغيل</button><button type="button" class="compact-btn" data-exam-timer-action="stop">إيقاف</button><button type="button" class="compact-btn" data-exam-timer-action="zero">تصفير</button></div><button type="button" class="icon-btn exam-bell-btn" data-exam-timer-action="bell" title="تنبيه صوتي فوري للطالب"><i data-lucide="bell"></i></button></div>`}
function openElectronicAssessment(draw,cloudSession=null,jumpToIndex=null){
  stopExamTimerInterval();
  activeCloudSession=cloudSession;
  const participant=state.participants.find(item=>item.id===draw.participantId);
  if(!participant)return toast("التقييم الإلكتروني متاح للمتسابقين المسجلين فقط");
  // طبقة دفاع ثانية ضد خلل "العلامة رجعت 100": هذه الدالة تُستدعى من مسارات لا تمرّ بمنطق
  // "أحدث مسودة" بـstartCommitteeExam، فنعيد نفس مقارنة الأحدث هون دائماً (بلا تأثير لو متوافق أصلاً).
  const cloudDraft=cloudSession?.assessment&&Object.keys(cloudSession.assessment).length?cloudSession.assessment:null;
  const localDraft=loadLocalAssessmentDraft(participant.id);
  const currentDraft=participant.assessment&&Object.keys(participant.assessment).length?participant.assessment:null;
  const draftCandidates=[currentDraft,cloudDraft,localDraft?.drawId===draw.id?localDraft:null].filter(Boolean);
  if(draftCandidates.length){
    const newestDraft=draftCandidates.reduce((best,item)=>new Date(item.updatedAt||0)>new Date(best.updatedAt||0)?item:best);
    if(newestDraft!==currentDraft){
      console.warn("[examTrace] openElectronicAssessment: تم استرجاع مسودة أحدث من التي كانت بـstate.participants",{studentId:participant.id,examId:draw.id,attemptId:cloudSession?.id||null,scoreBeforeRecover:currentDraft?calculateAssessment(currentDraft).score:null,scoreAfterRecover:calculateAssessment(newestDraft).score});
      participant.assessment=newestDraft;
    }
  }
  const assessment=ensureAssessment(participant,draw);assessment.actions=assessment.actions||[];
  console.log("[examTrace] openElectronicAssessment: فتح شاشة الاختبار",{studentId:participant.id,examId:draw.id,attemptId:cloudSession?.id||null,scoreOnOpen:calculateAssessment(assessment).score});
  let currentIndex=jumpToIndex!=null?Math.min(Math.max(0,jumpToIndex),draw.positions.length-1):Math.min(Math.max(0,Number(assessment.currentPosition)||0),draw.positions.length-1);
  let chairmanPositionChangeCounts=draw.positions.map(()=>0);
  let quranPageOffsets=draw.positions.map(()=>0);
  let tajweedCapWarningVisible=false,tajweedCapWarningTimer=null;
  let lastRenderedPositionIndex=null;
  openModal(`<div class="examiner-header"><button type="button" class="icon-btn" data-close title="حفظ وخروج"><i data-lucide="x"></i></button><div><span>اختبار ${escapeHtml(participant.name)}</span><small>${participant.level} أجزاء · السحب ${String(draw.sequence).padStart(4,"0")}</small></div><div class="examiner-score"><small>العلامة</small><b id="assessmentLiveScore">100</b></div></div><div id="assessmentExamScreen" class="examiner-screen"><nav id="positionStepper" class="position-stepper">${draw.positions.map((_,index)=>`<button type="button" class="${assessment.positions[index].completed?"is-done":""}" data-position-step="${index}">${index+1}</button>`).join("")}</nav><main id="activeAssessmentPosition"></main><div class="examiner-quickbar"><button type="button" id="undoAssessmentAction" class="secondary-btn"><i data-lucide="undo-2"></i> تراجع عن آخر تسجيل</button><div><span>إجمالي الخصم</span><b id="assessmentTotalDeduction">0</b></div></div><div class="examiner-navigation"><button type="button" id="previousAssessmentPosition" class="secondary-btn"><i data-lucide="arrow-right"></i> السابق</button><button type="button" id="reviewAssessmentBtn" class="primary-btn"><i data-lucide="clipboard-check"></i> مراجعة واعتماد</button><button type="button" id="nextAssessmentPosition" class="primary-btn">التالي <i data-lucide="arrow-left"></i></button></div><div id="assessmentSummaryRows" class="hidden"></div></div>`,"examiner-mode-modal");document.body.classList.add("exam-fullscreen");
  const renderPosition=()=>{assessment.currentPosition=currentIndex;saveState();
    // إعادة رسم لوحة الموضع تصفّر سكرول عمود الأزرار (عنصر DOM جديد) — نحافظ عليه طالما بنفس الموضع.
    const stayedOnSamePosition=lastRenderedPositionIndex===currentIndex,previousPanelScroll=stayedOnSamePosition?($(".exam-split-panel")?.scrollTop||0):0;
    if(!stayedOnSamePosition)resetExamTimerState(); // مؤقت الموضع أداة وقتية بحتة، يبلش 20 من جديد كل ما تنتقل لموضع (حتى لو نفس الموضع بترقيمه بعد استبدال) — لا يبقى شغالاً بالخلفية لموضع غادرته
    lastRenderedPositionIndex=currentIndex;
    $("#activeAssessmentPosition").innerHTML=assessmentPositionHtml(assessment.positions[currentIndex],draw.positions[currentIndex],currentIndex,draw.positions.length,chairmanPositionChangeCounts[currentIndex],quranPageOffsets[currentIndex],draw.rerolls?.length||0,tajweedCapWarningVisible);preloadNextQuranImage(draw,currentIndex);
    const panel=$(".exam-split-panel");if(panel)panel.scrollTop=previousPanelScroll;
    $$(`[data-position-step]`).forEach(button=>{const index=Number(button.dataset.positionStep);button.classList.toggle("active",index===currentIndex);button.classList.toggle("is-done",Boolean(assessment.positions[index].completed))});$("#previousAssessmentPosition").disabled=currentIndex===0;$("#nextAssessmentPosition").disabled=currentIndex===draw.positions.length-1;lucide.createIcons()};
  const refresh=()=>{renderPosition();updateAssessmentSummary(assessment);$("#undoAssessmentAction").disabled=!assessment.actions.length;const finish=$("#finishFailedAssessment");if(finish)finish.onclick=()=>endExamNow(draw,participant,assessment)};
  stopMemberPositionSync();
  if(currentExaminerRole()==="member"&&activeCloudSession){
    const syncChairmanChanges=async()=>{
      try{
        // getCommitteeSession تجلب هذه الجلسة بعينها فقط (لا كامل تاريخ listSessions كل 1.5 ثانية) — تتراجع تلقائياً للجلب الكامل لو غير مُطبَّقة بعد.
        const session=await window.CloudCompetition.getCommitteeSession(activeCloudSession.id);
        if(session?.status==="final"){
          stopMemberPositionSync();
          toast(`تم إنهاء الاختبار من قبل رئيس اللجنة${session.assessment?.incomplete?" · غير مكتمل":session.score!=null?` · العلامة ${formatAssessmentNumber(session.score)}`:""}`);
          closeModal();
          activeCloudSession=null;
          renderCommitteeWorkspace();
          return;
        }
        const chairmanPositions=session?.assessment?.examinerDrafts?.chairman?.positions;
        if(Array.isArray(chairmanPositions)){
          const nextCounts=draw.positions.map((_,i)=>Number(chairmanPositions[i]?.positionChange)||0);
          const changedIndex=nextCounts.findIndex((count,i)=>count>(chairmanPositionChangeCounts[i]||0));
          if(changedIndex>=0)toast(`⚠ رئيس اللجنة غيّر الموضع ${changedIndex+1} — يمكنك اعتماد التغيير الآن`);
          chairmanPositionChangeCounts=nextCounts;
          refresh();
        }
      }catch(error){console.warn("Member position sync failed",error)}
    };
    syncChairmanChanges();
    memberPositionSyncTimer=setInterval(syncChairmanChanges,1500);
  }
  $("#assessmentExamScreen").addEventListener("click",event=>{const timerButton=event.target.closest("[data-exam-timer-action]");if(timerButton){const action=timerButton.dataset.examTimerAction;if(action==="start")startExamTimer();else if(action==="stop")stopExamTimerInterval();else if(action==="zero")zeroExamTimer();else if(action==="bell")playExamTimerBell();return}const quranNavButton=event.target.closest("[data-quran-page-nav]");if(quranNavButton){if(quranNavButton.disabled)return;const delta=Number(quranNavButton.dataset.quranPageNav),pageCount=new Set(drawPositionSegments(draw.positions[currentIndex]).map(segment=>segment.page)).size;quranPageOffsets[currentIndex]=Math.min(Math.max(0,(quranPageOffsets[currentIndex]||0)+delta),Math.max(0,pageCount-1));return renderPosition()}const completeButton=event.target.closest("[data-toggle-complete]");if(completeButton){const index=Number(completeButton.dataset.toggleComplete),position=assessment.positions[index];position.completed=!position.completed;saveAssessmentDraft(participant);return refresh()}const actionButton=event.target.closest("[data-assess-delta]");if(actionButton){const index=Number(actionButton.dataset.assessIndex),type=actionButton.dataset.assessType,delta=Number(actionButton.dataset.assessDelta);if(type==="positionChange"&&delta>0){if(currentExaminerRole()==="chairman"){actionButton.disabled=true;replaceAssessmentPosition(draw,participant,assessment,index).then(()=>{currentIndex=index;refresh()}).catch(error=>toast(error.message)).finally(()=>actionButton.disabled=false)}else{const chairmanCount=chairmanPositionChangeCounts[index]||0,ownCount=Number(assessment.positions[index].positionChange)||0;if(chairmanCount<=ownCount)return;actionButton.disabled=true;adoptChairmanPositionChange(draw,participant,assessment,index).then(()=>{currentIndex=index;refresh()}).catch(error=>toast(error.message)).finally(()=>actionButton.disabled=false)}return}const position=assessment.positions[index],before=Number(position[type])||0,after=Math.max(0,before+delta);if(after===before)return;if(type==="tajweed"&&delta>0&&tajweedTotalOf(assessment)>=TAJWEED_ERROR_CAP){tajweedCapWarningVisible=true;clearTimeout(tajweedCapWarningTimer);tajweedCapWarningTimer=setTimeout(()=>{tajweedCapWarningVisible=false;renderPosition()},6000);return renderPosition()}position[type]=after;assessment.actions.push({positionId:position.positionId,type,delta:after-before,at:new Date().toISOString()});saveAssessmentDraft(participant);return refresh()}const step=event.target.closest("[data-position-step]");if(step){currentIndex=Number(step.dataset.positionStep);tajweedCapWarningVisible=false;clearTimeout(tajweedCapWarningTimer);return renderPosition()}});
  $("#assessmentExamScreen").addEventListener("input",event=>{const note=event.target.closest("[data-assess-note]");if(!note)return;assessment.positions[Number(note.dataset.assessNote)].note=note.value;saveAssessmentDraft(participant)});
  $("#previousAssessmentPosition").onclick=()=>{if(currentIndex>0){currentIndex--;tajweedCapWarningVisible=false;clearTimeout(tajweedCapWarningTimer);renderPosition()}};$("#nextAssessmentPosition").onclick=()=>{if(currentIndex<draw.positions.length-1){currentIndex++;tajweedCapWarningVisible=false;clearTimeout(tajweedCapWarningTimer);renderPosition()}};
  $("#undoAssessmentAction").onclick=()=>{const action=assessment.actions.pop();if(!action)return;const index=assessment.positions.findIndex(position=>position.positionId===action.positionId);if(index<0)return;const position=assessment.positions[index];position[action.type]=Math.max(0,(Number(position[action.type])||0)-action.delta);currentIndex=index;saveAssessmentDraft(participant);refresh();toast("تم التراجع عن آخر تسجيل")};
  $("#reviewAssessmentBtn").onclick=()=>openAssessmentReview(draw,participant);refresh()
}
function failurePositionIndex(assessment,passScore=PASS_SCORE){let deduction=0;for(let index=0;index<(assessment?.positions||[]).length;index++){deduction+=calculateAssessment({positions:[assessment.positions[index]]}).totalDeduction;if(100-deduction<passScore)return index}return -1}
function updateAssessmentSummary(assessment,passScore=PASS_SCORE){const result=calculateAssessment(assessment,passScore),failureIndex=failurePositionIndex(assessment,passScore);$("#assessmentLiveScore").textContent=formatAssessmentNumber(result.score);$("#assessmentLiveScore").className=result.passed?"pass-text":"fail-text";$("#assessmentTotalDeduction").textContent=formatAssessmentNumber(result.totalDeduction);$("#assessmentSummaryRows").innerHTML=Object.entries(ASSESSMENT_RULES).map(([type,rule])=>`<div><span>${rule.label} (${result.totals[type]})</span><b>−${formatAssessmentNumber(result.deductions[type])}</b></div>`).join("");const old=$("#assessmentFailureWarning");if(old)old.remove();if(failureIndex>=0){const chairman=currentExaminerRole()==="chairman";$("#activeAssessmentPosition").insertAdjacentHTML("afterend",`<div id="assessmentFailureWarning" class="assessment-failure-warning"><b>تجاوز المتسابق الحد الأعلى المسموح للنجاح</b><span>وصلت العلامة إلى أقل من ${passScore} عند الموضع ${failureIndex+1}. ${chairman?"يمكنكم إنهاء الاختبار الآن (تُسجَّل علامته «غير مكتمل» مباشرة) أو الاستمرار.":"بانتظار رئيس اللجنة لإنهاء الاختبار."}</span>${chairman?`<button type="button" id="finishFailedAssessment" class="danger-btn">إنهاء الاختبار الآن</button>`:""}</div>`)}}
async function replaceAssessmentPosition(draw,participant,assessment,index){if((draw.rerolls?.length||0)>=2)return toast("تم استخدام الحد الأقصى لتبديل الموضع (مرتان) لهذا المتسابق");if(!confirm("سيتم خصم 10 علامات واختيار موضع مختلف عشوائيًا من الجزء نفسه. هل تريد المتابعة؟"))return;const old=draw.positions[index],pool=availableForParts([old.juz],draw.level).filter(item=>item.id!==old.id&&!draw.positions.some(position=>position.id===item.id));if(!pool.length)throw new Error("لا يوجد موضع بديل متاح في الجزء نفسه");const replacement=pool[randomIndex(pool.length)],entry=assessment.positions[index];entry.positionChange=(Number(entry.positionChange)||0)+1;entry.changes=entry.changes||[];entry.changes.push({oldPosition:old,newPosition:replacement,committeeName:window.CloudCompetition.context?.committee?.name||"الإدارة",at:new Date().toISOString(),oldAssessmentSnapshot:{memorization:entry.memorization,language:entry.language,tajweed:entry.tajweed,hesitation:entry.hesitation,note:entry.note,completed:entry.completed}});
  // الموضع الجديد يبدأ تقييماً مستقلاً — الموضع القديم محفوظ بـoldAssessmentSnapshot (لا يُفقد).
  entry.memorization=0;entry.language=0;entry.tajweed=0;entry.hesitation=0;entry.note="";entry.completed=false;
  entry.positionId=replacement.id;draw.positions[index]=replacement;assessment.actions.push({positionId:replacement.id,type:"positionChange",delta:1,at:new Date().toISOString(),oldPositionId:old.id});assessment.updatedAt=new Date().toISOString();if(operationMode==="cloud"&&window.CloudCompetition.context?.kind==="committee")await window.CloudCompetition.replaceCommitteePosition(participant.id,draw.id,index,replacement,assessment);else saveState();draw.rerolls=draw.rerolls||[];draw.rerolls.push({positionIndex:index,at:new Date().toISOString()});saveAssessmentDraft(participant);toast(`تم تغيير الموضع ${index+1} بموضع آخر من الجزء ${old.juz}`)}
async function adoptChairmanPositionChange(draw,participant,assessment,index){
  const remote=await window.CloudCompetition.loadCompetitionState();
  const remoteDraw=(remote.payload?.draws||[]).find(item=>item.id===draw.id);
  const fresh=remoteDraw?.positions?.[index];
  if(!fresh)throw new Error("تعذر جلب الموضع الجديد من رئيس اللجنة، حاول مجددًا");
  const old=draw.positions[index],entry=assessment.positions[index];
  entry.positionChange=(Number(entry.positionChange)||0)+1;
  entry.changes=entry.changes||[];
  entry.changes.push({oldPosition:old,newPosition:fresh,committeeName:window.CloudCompetition.context?.committee?.name||"الإدارة",at:new Date().toISOString(),oldAssessmentSnapshot:{memorization:entry.memorization,language:entry.language,tajweed:entry.tajweed,hesitation:entry.hesitation,note:entry.note,completed:entry.completed}});
  entry.memorization=0;entry.language=0;entry.tajweed=0;entry.hesitation=0;entry.note="";entry.completed=false;
  entry.positionId=fresh.id;
  draw.positions[index]=fresh;
  assessment.actions.push({positionId:fresh.id,type:"positionChange",delta:1,at:new Date().toISOString()});
  assessment.updatedAt=new Date().toISOString();
  saveAssessmentDraft(participant);
  toast(`تم اعتماد الموضع الجديد للموضع ${index+1} كما اختاره رئيس اللجنة`);
}
async function endExamNow(draw,participant,assessment){
  if(currentExaminerRole()!=="chairman")return;
  if(!confirm("سيتم إنهاء الاختبار الآن دون إكمال باقي المواضع، وستُسجَّل علامة المتسابق «غير مكتمل» مباشرة بدل حساب علامة رقمية ودون حاجة لمراجعة أو اعتماد إضافي. هل تريد المتابعة؟"))return;
  stopMemberPositionSync();
  assessment.positions.forEach(position=>{if(!position.completed)position.completed=true});
  assessment.endedEarly=true;assessment.endedEarlyAt=new Date().toISOString();assessment.incomplete=true;
  saveAssessmentDraft(participant);
  window.CloudCompetition.cancelQueuedSessionSave?.();
  await finalizeElectronicAssessment(draw,participant,calculateFinalAssessment(assessment));
}
function openCompletedAssessment(draw,participant,session){const assessment=session.assessment||participant.assessment||{},result=assessment.result||calculateAssessment(assessment),incomplete=Boolean(assessment.incomplete),testedAt=session.finalized_at||assessment.finalizedAt||participant.gradedAt,canEdit=Boolean(window.CloudCompetition.context?.committee?.can_edit_final),canSeeScore=window.CloudCompetition.context?.committee?.show_score!==false;openModal(`<div class="modal-head"><div><span class="eyebrow">نتيجة معتمدة ${canEdit?"· صلاحية التعديل مفعلة":"للعرض فقط"}</span><h2>${escapeHtml(participant.name)}</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="assessment-review-score ${incomplete?"incomplete":result.passed?"passed":"failed"}"><span>العلامة النهائية</span><b>${incomplete?"غير مكتمل":canSeeScore?formatAssessmentNumber(result.score):"—"}</b><strong>${incomplete?"أُنهي الاختبار قبل اكتماله":canSeeScore?(result.passed?"ناجح":"راسب"):"العلامة غير ظاهرة لهذه اللجنة"}</strong></div>${canSeeScore?`<div class="assessment-review-grid">${Object.entries(ASSESSMENT_RULES).map(([type,rule])=>`<div><span>${rule.label}</span><b>${result.totals?.[type]||0}</b><small>خصم ${formatAssessmentNumber(result.deductions?.[type]||0)}</small></div>`).join("")}</div>`:""}<p class="assessment-review-note">لجنة الاختبار: <b>${escapeHtml(assessment.committeeName||window.CloudCompetition.context?.committee?.name||"-")}</b><br>موعد الاختبار: <b>${testedAt?formatExamDate(testedAt):"غير مسجل"}</b><br>${canEdit?"أي تعديل وإعادة اعتماد سيُسجلان في سجل النشاط.":"لا يمكن تعديل النتيجة دون منح الصلاحية من الإدارة."}</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button>${canEdit?`<button id="reopenFinalAssessmentBtn" class="primary-btn"><i data-lucide="file-pen-line"></i> تعديل النتيجة المعتمدة</button>`:""}</div>`,"assessment-review-modal");if(canEdit)$("#reopenFinalAssessmentBtn").onclick=()=>reopenFinalAssessment(draw,participant,session)}
async function reopenFinalAssessment(draw,participant,session){const button=$("#reopenFinalAssessmentBtn");button.disabled=true;button.textContent="جاري فتح التعديل...";try{const assessment=JSON.parse(JSON.stringify(session.assessment||participant.assessment||{}));assessment.status="draft";assessment.updatedAt=new Date().toISOString();assessment.revisions=assessment.revisions||[];assessment.revisions.push({type:"reopened-final",oldScore:session.score,at:assessment.updatedAt});const reopened=await window.CloudCompetition.saveSession(session.id,assessment,"in_progress",null);activeCloudSession=reopened;committeeSessions=committeeSessions.map(item=>item.id===reopened.id?reopened:item);participant.assessment=assessment;delete participant.score;delete participant.gradedAt;safeSetItem(examinerDraftKey(participant.id),JSON.stringify(assessment));openElectronicAssessment(draw,reopened);toast("تم فتح النتيجة للتعديل وسيُسجل التغيير في سجل النشاط")}catch(error){button.disabled=false;button.textContent="تعديل النتيجة المعتمدة";toast(error.message)}}
async function finalizeElectronicAssessment(draw,participant,result){const button=$("#finalizeAssessmentBtn");if(button?.disabled||participant.assessment?.status==="final")return toast("هذه النتيجة معتمدة مسبقاً");if(button){button.disabled=true;button.textContent="جاري اعتماد النتيجة..."}
  // يمنع مسودة تلقائية متأخرة (queueSessionSave) من الوصول بعد الاعتماد وإرجاع الجلسة لحالة "قيد الاختبار" بعلامة فارغة (خلل "العلامة رجعت 100").
  window.CloudCompetition.cancelQueuedSessionSave?.();
  console.log("[examTrace] finalizeElectronicAssessment: بدء الاعتماد",{studentId:participant.id,examId:draw.id,attemptId:activeCloudSession?.id||null,scoreBeforeCalc:participant.score,scoreAfterCalc:result.score});
  const assessment=participant.assessment,now=new Date().toISOString();assessment.status="final";assessment.finalizedAt=now;assessment.updatedAt=now;assessment.result=result;participant.score=result.score;participant.gradedAt=now;participant.scoreSource="electronic";
  // من امتحن الطالب فعلياً يبقى محسوباً على هذه اللجنة دائماً، حتى لو نُقل لاحقاً — يُقرأ بـcommitteeScopedState وتفصيل اللجان بالإحصائيات.
  const examiningCommittee=window.CloudCompetition.context?.committee;
  if(examiningCommittee?.id)assessment.committee={id:examiningCommittee.id,name:examiningCommittee.name};
  saveState();
  console.log("[examTrace] finalizeElectronicAssessment: قبل الحفظ بالسحابة",{studentId:participant.id,examId:draw.id,attemptId:activeCloudSession?.id||null,scoreBeforeSave:participant.score});
  if(activeCloudSession){try{activeCloudSession=await window.CloudCompetition.saveSession(activeCloudSession.id,assessment,"final",result.score);console.log("[examTrace] finalizeElectronicAssessment: بعد الحفظ بالسحابة",{studentId:participant.id,examId:draw.id,attemptId:activeCloudSession?.id||null,scoreAfterSave:activeCloudSession?.score,status:activeCloudSession?.status});await window.CloudCompetition.log("finalize","participant",participant.id,{score:result.score,drawId:draw.id});committeeSessions=committeeSessions.filter(item=>item.id!==activeCloudSession.id);committeeSessions.unshift(activeCloudSession)}catch(error){console.warn("[examTrace] finalizeElectronicAssessment: فشل الحفظ، رجوع للمسودة",{studentId:participant.id,examId:draw.id,error:error?.message});assessment.status="draft";delete participant.score;delete participant.gradedAt;delete participant.scoreSource;saveAssessmentDraft(participant);if(button){button.disabled=false;button.textContent="اعتماد النتيجة"}return toast(`لم تُعتمد النتيجة: ${error.message}`)}}localStorage.removeItem(examinerDraftKey(participant.id));renderAll();const canSeeScore=window.CloudCompetition.context?.committee?.show_score!==false,incomplete=Boolean(assessment.incomplete);openModal(`<div class="modal-head"><h2>${incomplete?"تم إنهاء الاختبار":"تم اعتماد النتيجة"}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="assessment-review-score ${incomplete?"incomplete":result.passed?"passed":"failed"}"><span>${escapeHtml(participant.name)}</span><b>${incomplete?"غير مكتمل":canSeeScore?formatAssessmentNumber(result.score):"—"}</b><strong>${incomplete?"أُنهي الاختبار قبل اكتماله":canSeeScore?(result.passed?"ناجح":"راسب"):"العلامة غير ظاهرة لهذه اللجنة"}</strong></div><p>${incomplete?"سُجِّلت علامة المتسابق «غير مكتمل» مع تفاصيل الأخطاء والترددات والملاحظات المسجَّلة حتى لحظة الإنهاء.":"حُفظت العلامة مع تفاصيل الأخطاء والترددات والملاحظات لكل موضع."}</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button>${activeCloudSession?`<button id="returnCommitteeWorkspace" class="primary-btn">العودة إلى قائمة اللجنة</button>`:`<button id="showResultAfterAssessment" class="primary-btn">العودة إلى النتيجة</button>`}</div>`);if(activeCloudSession)$("#returnCommitteeWorkspace").onclick=()=>{closeModal();activeCloudSession=null;renderCommitteeWorkspace()};else $("#showResultAfterAssessment").onclick=()=>showResult(draw)}
async function openAssessmentReview(draw,participant){
  stopMemberPositionSync();
  const assessment=participant.assessment,result=calculateAssessment(assessment),chairman=currentExaminerRole()==="chairman";
  const incompleteIndex=assessment.positions.findIndex(p=>!p.completed);
  if(incompleteIndex>=0){toast(`الرجاء وضع "إنهاء هذا الموضع" على الموضع ${incompleteIndex+1} قبل المراجعة والاعتماد`);return openElectronicAssessment(draw,activeCloudSession,incompleteIndex)}
  saveAssessmentDraft(participant);
  window.CloudCompetition.cancelQueuedSessionSave?.();
  if(activeCloudSession)try{activeCloudSession=await window.CloudCompetition.saveSession(activeCloudSession.id,assessment,"in_progress",null)}catch(error){return toast(`تعذر تثبيت الرصد: ${error.message}`)}
  if(!chairman){
    assessment.memberSubmittedAt=new Date().toISOString();saveAssessmentDraft(participant);
    openModal(`<div class="modal-head"><div><span class="eyebrow">رصد عضو اللجنة</span><h2>${escapeHtml(participant.name)}</h2><small>تم حفظ الرصد للرئيس</small></div><button class="icon-btn" id="backToAssessment"><i data-lucide="arrow-right"></i></button></div><div class="modal-body"><div class="assessment-review-score ${result.passed?"passed":"failed"}"><span>العلامة حسب رصدك</span><b>${formatAssessmentNumber(result.score)}</b><strong>مسودة غير معتمدة</strong></div><div class="assessment-review-grid">${Object.entries(ASSESSMENT_RULES).map(([type,rule])=>`<div><span>${rule.label}</span><b>${result.totals[type]}</b><small>خصم ${formatAssessmentNumber(result.deductions[type])}</small></div>`).join("")}</div><p class="assessment-review-note">وصل رصدك إلى رئيس اللجنة. اعتماد الأخطاء والنتيجة النهائية متاح للرئيس فقط.</p></div><div class="modal-actions"><button id="editAssessmentBtn" class="secondary-btn">الرجوع للرصد</button><button class="primary-btn" data-close>إنهاء والعودة للقائمة</button></div>`,`examiner-mode-modal assessment-review-modal`);document.body.classList.add("exam-fullscreen");
    $("#backToAssessment").onclick=$("#editAssessmentBtn").onclick=()=>openElectronicAssessment(draw,activeCloudSession);return;
  }
  let latest=activeCloudSession;
  try{const sessions=await window.CloudCompetition.listSessions();latest=sessions.find(item=>item.id===activeCloudSession?.id)||latest;if(latest)activeCloudSession=latest}catch(error){console.warn("Could not refresh examiner drafts",error)}
  const memberDraft=latest?.assessment?.examinerDrafts?.member||null;
  const finalResult=calculateFinalAssessment(assessment);
  const diffIndexes=memberDraft?.positions?.length?assessment.positions.map((own,index)=>positionsDiffer(own,memberDraft.positions[index])?index:-1).filter(index=>index>=0):[];
  const diffTable=!memberDraft?.positions?.length?`<p class="committee-alerts-empty">لم يصل رصد عضو اللجنة بعد. يمكن للرئيس الاعتماد الآن أو انتظار العضو.</p>`
    :!diffIndexes.length?`<p class="committee-alerts-empty">لا يوجد أي اختلاف بين رصد الرئيس ورصد العضو — كل المواضع متطابقة.</p>`
    :`<p class="field-help">${diffIndexes.length} من ${assessment.positions.length} مواضع فيها اختلاف بالرصد. أدخل عدد الأخطاء المعتمد لكل نوع مختلَف عليه فقط؛ والنظام يحسب الخصم تلقائيًا. أنواع الأخطاء غير الظاهرة هنا متطابقة أصلًا وتُحسب من رصدك مباشرة.</p>${diffIndexes.map(index=>{const own=assessment.positions[index],member=memberDraft.positions[index];const typeRows=Object.entries(ASSESSMENT_RULES).filter(([type])=>(Number(own[type])||0)!==(Number(member[type])||0)).map(([type,rule])=>{const ownCount=Number(own[type])||0,memberCount=Number(member[type])||0,adoptedVal=own.adopted&&Number.isFinite(own.adopted[type])?own.adopted[type]:"";return `<div class="examiner-diff-type-row"><span>${rule.label}</span><b>${ownCount}</b><b>${memberCount}</b><input type="number" min="0" step="1" data-adopted-count="${index}|${type}" value="${adoptedVal}" placeholder="العدد المعتمد"></div>`}).join("");return `<div class="examiner-diff-position"><div class="examiner-diff-position-head">الموضع ${index+1}</div><div class="examiner-diff-type-head"><span>نوع الخطأ</span><span>الرئيس</span><span>العضو</span><span>المعتمد</span></div>${typeRows}</div>`}).join("")}`;
  openModal(`<div class="modal-head"><div><span class="eyebrow">مراجعة رئيس اللجنة</span><h2>${escapeHtml(participant.name)}</h2><small>اختلافات الرصد واعتماد النتيجة</small></div><button class="icon-btn" id="backToAssessment"><i data-lucide="arrow-right"></i></button></div><div class="modal-body"><div class="assessment-review-score ${finalResult.passed?"passed":"failed"}"><span>العلامة النهائية</span><b id="reviewLiveScore">${formatAssessmentNumber(finalResult.score)}</b><strong id="reviewLiveOutcome">${finalResult.passed?"ناجح":"راسب"}</strong></div><section class="examiner-comparison"><h3>مواضع الاختلاف بين الرئيس والعضو</h3>${diffTable}</section><p class="assessment-review-note">المواضع غير المختلَف عليها تُحسب من رصد الرئيس مباشرة دون تدخل.</p></div><div class="modal-actions"><button id="editAssessmentBtn" class="secondary-btn">الرجوع للتعديل</button><button id="finalizeAssessmentBtn" class="primary-btn"><i data-lucide="badge-check"></i> اعتماد النتيجة كرئيس اللجنة</button></div>`,`examiner-mode-modal assessment-review-modal`);document.body.classList.add("exam-fullscreen");
  $("#backToAssessment").onclick=$("#editAssessmentBtn").onclick=()=>openElectronicAssessment(draw,latest);
  $$(`[data-adopted-count]`).forEach(input=>input.addEventListener("input",()=>{const [indexText,type]=input.dataset.adoptedCount.split("|"),index=Number(indexText),position=assessment.positions[index];position.adopted=position.adopted||{};position.adopted[type]=input.value===""?null:Math.max(0,Math.round(Number(input.value))||0);saveAssessmentDraft(participant);const live=calculateFinalAssessment(assessment);$("#reviewLiveScore").textContent=formatAssessmentNumber(live.score);$("#reviewLiveOutcome").textContent=live.passed?"ناجح":"راسب";$(".assessment-review-score").classList.toggle("passed",live.passed);$(".assessment-review-score").classList.toggle("failed",!live.passed)}));
  $("#finalizeAssessmentBtn").onclick=()=>finalizeElectronicAssessment(draw,participant,calculateFinalAssessment(assessment));
}

// ==========================================================================
// اختبارات ديوان الحفاظ من شاشة اللجنة — نفس محرك التقييم الإلكتروني بالضبط (calculateAssessment/
// ASSESSMENT_RULES/emptyPositionAssessment/examTimerRowHtml/assessmentPositionHtml/updateAssessmentSummary
// معاد استخدامها حرفياً بلا أي تعديل)، بس بعيداً كلياً عن state/committeeSessions السنوية —
// diwanCommitteeScopedState/diwanCommitteeSessions/activeDiwanCloudSession مستقلة تماماً، صفر
// خطر على تدفق اختبار السنوية الحالي. بلا تحديث حي تلقائي (تحديث يدوي فقط) وبلا تغيير موضع أثناء
// الاختبار (رصد أساسي فقط) — نسخة أولى مقصودة، تُوسَّع لاحقاً لو احتاج ديوان الحفاظ فعلياً.
function setCommitteeTrack(track){
  $$(`[data-committee-track]`).forEach(button=>button.classList.toggle("is-active",button.dataset.committeeTrack===track));
  $("#committeeAnnualPanel")?.classList.toggle("hidden",track!=="annual");
  $("#committeeDiwanPanel")?.classList.toggle("hidden",track!=="diwan");
  if(track==="diwan")renderDiwanCommitteeWorkspace();
}
// المشارك قد يملك جلسات/سحوباً سابقة من مراحل سابقة ناجحة — الحالة تُشتق من سحب مرحلته الحالية
// تحديداً (currentDiwanDraw) وجلسته (بمعرّف draw_id، لا participant_id، لنفس السبب).
function diwanCommitteeStatusOf(participant,draw,sessionByDrawId){
  if(participant.certified)return "certified";
  if(!draw)return "no_draw";
  return sessionByDrawId.get(draw.id)?.status||"pending";
}
// متسابقات ديوان الحفاظ (أنثى أو بلا جنس مسجَّل — بيانات قديمة) يظهرن لكل لجان الإناث بغض النظر عن مستويات اللجنة، وكل لجنة تختار من تمتحن؛ المنقولة يدوياً للجنة
// أخرى تبقى عندها فقط. الذكور ولجان الذكور على الفرز المعتاد (committeeScopedState). نفس القاعدة بـdiwan-female-committees-open.sql.
function diwanCommitteeScope(payload){
  const scoped=committeeScopedState(payload),committee=window.CloudCompetition.context?.committee;
  if(committee?.responsibleGender!=="أنثى")return scoped;
  const merged={...defaultState(),...payload},shownIds=new Set(scoped.participants.map(p=>p.id));
  const participants=merged.participants.filter(p=>shownIds.has(p.id)||(p.gender!=="ذكر"&&(!p.transferCommitteeId||p.transferCommitteeId===committee.id)));
  const participantIds=new Set(participants.map(p=>p.id));
  return {...merged,participants,draws:merged.draws.filter(draw=>participantIds.has(draw.participantId))};
}
// quiet: تحديث تلقائي صامت (بلا رسائل خطأ، ولا إعادة رسم إن لم يتغير شيء).
async function renderDiwanCommitteeWorkspace({quiet=false}={}){
  const committee=window.CloudCompetition.context?.committee;if(!committee)return false;
  try{
    const [remote,sessions,taken]=await Promise.all([window.DiwanCompetition.loadCommitteeState(),window.DiwanCompetition.listCommitteeSessions(),window.DiwanCompetition.listTakenDraws?.()||[]]);
    const signature=JSON.stringify([remote.payload?.participants?.length,remote.payload?.draws?.map(d=>d.id),remote.payload?.participants?.map(p=>[p.id,p.stage,p.transferCommitteeId||"",p.certified?1:0]),sessions.map(s=>[s.id,s.status,s.updated_at]),taken]);
    if(quiet&&signature===diwanCommitteeRefreshSignature)return true;
    diwanCommitteeRefreshSignature=signature;
    diwanCommitteeSessions=sessions;
    diwanCommitteeTakenDraws=new Map((taken||[]).map(item=>[item.draw_id,item]));
    diwanCommitteeScopedState=remote.payload?.config?diwanCommitteeScope(remote.payload):defaultDiwanState();
    renderDiwanCommitteeStudents();
    return true;
  }catch(error){if(!quiet)toast(`تعذر تحميل بيانات ديوان الحفاظ: ${error.message}`);return false}
}
// كل ٢٠ ثانية أثناء فتح تبويب ديوان الحفاظ بلا نافذة مفتوحة: يرى الجميع فوراً من امتُحنت عند لجنة أخرى.
let diwanCommitteeQuietBusy=false,diwanCommitteeQuietLast=0;
async function refreshDiwanCommitteeQuietly(){
  if(diwanCommitteeQuietBusy||document.hidden||Date.now()-diwanCommitteeQuietLast<20000)return;
  if(window.CloudCompetition.context?.kind!=="committee"||$("#committeeDiwanPanel")?.classList.contains("hidden")||!$("#modal")?.classList.contains("hidden"))return;
  diwanCommitteeQuietBusy=true;diwanCommitteeQuietLast=Date.now();
  try{await renderDiwanCommitteeWorkspace({quiet:true})}finally{diwanCommitteeQuietBusy=false}
}
function renderDiwanCommitteeStudents(){
  const committee=window.CloudCompetition.context?.committee;if(!committee)return;
  const chairman=committee.examiner_role!=="member";
  const query=$("#diwanCommitteeSearch").value.trim().toLowerCase();
  const filter=$("#diwanCommitteeStatusFilter").value;
  const sessionByDrawId=new Map(diwanCommitteeSessions.map(session=>[session.draw_id,session]));
  const activeSession=diwanCommitteeSessions.find(s=>s.status==="in_progress");
  const activeParticipant=activeSession?diwanCommitteeScopedState.participants.find(p=>p.id===activeSession.participant_id):null;
  const statusOrder={in_progress:0,pending:1,no_draw:2,final:3,certified:4,taken:5,withdrawn:6};
  const drawOf=participant=>currentDiwanDraw(participant,diwanCommitteeScopedState.draws);
  // «taken»: سحبها الحالي بدأته/اعتمدته لجنة أخرى — تظهر للعلم فقط بلا زر بدء.
  const statusOf=participant=>{if(participant.withdrawn)return "withdrawn";const draw=drawOf(participant),status=diwanCommitteeStatusOf(participant,draw,sessionByDrawId);return status==="pending"&&draw&&diwanCommitteeTakenDraws.has(draw.id)?"taken":status};
  const allEligible=diwanCommitteeScopedState.participants.filter(participant=>!participant.certified&&`${participant.name} ${participant.seat} ${participant.center}`.toLowerCase().includes(query));
  const eligible=allEligible.filter(participant=>filter==="all"||statusOf(participant)===filter).sort((a,b)=>(statusOrder[statusOf(a)]-statusOrder[statusOf(b)])||String(a.name).localeCompare(String(b.name),"ar"));
  $("#diwanCommitteePendingCount").textContent=formatNumber(allEligible.filter(participant=>["no_draw","pending"].includes(statusOf(participant))).length);
  $("#diwanCommitteeActiveCount").textContent=formatNumber(allEligible.filter(participant=>statusOf(participant)==="in_progress").length);
  $("#diwanCommitteeCompletedCount").textContent=formatNumber(allEligible.filter(participant=>statusOf(participant)==="final").length);
  const PAGE_SIZE=15;
  const pageSignature=JSON.stringify([query,filter]);
  if(pageSignature!==diwanCommitteeStudentsPageSignature){diwanCommitteeStudentsPage=1;diwanCommitteeStudentsPageSignature=pageSignature}
  const totalPages=Math.max(1,Math.ceil(eligible.length/PAGE_SIZE));
  diwanCommitteeStudentsPage=Math.min(Math.max(1,diwanCommitteeStudentsPage),totalPages);
  const eligiblePage=eligible.slice((diwanCommitteeStudentsPage-1)*PAGE_SIZE,diwanCommitteeStudentsPage*PAGE_SIZE);
  renderPagerTabs("diwanCommitteeStudentsPager",diwanCommitteeStudentsPage,totalPages,page=>{diwanCommitteeStudentsPage=page;renderDiwanCommitteeStudents()});
  $("#diwanCommitteeStudents").innerHTML=eligiblePage.length?eligiblePage.map(participant=>{
    const draw=drawOf(participant),session=draw?sessionByDrawId.get(draw.id):null,status=statusOf(participant);
    if(status==="withdrawn")return `<article class="committee-student final"><div><h3>${escapeHtml(participant.name)}</h3><p>${escapeHtml(participant.center)} · رقم الجلوس ${escapeHtml(participant.seat)}</p><div class="committee-student-meta"><span>${escapeHtml(DIWAN_STAGE_LABELS[participant.stage]||"")}</span><span class="state failed">منسحب · 0</span></div></div><button class="secondary-btn" disabled>منسحب</button></article>`;
    if(status==="taken"){const taken=diwanCommitteeTakenDraws.get(draw.id),where=escapeHtml(taken.committee_name||"لجنة أخرى");return `<article class="committee-student final"><div><h3>${escapeHtml(participant.name)}</h3><p>${escapeHtml(participant.center)} · رقم الجلوس ${escapeHtml(participant.seat)}</p><div class="committee-student-meta"><span>${escapeHtml(DIWAN_STAGE_LABELS[participant.stage]||"")}</span><span class="state completed">${taken.status==="final"?`امتُحنت عند ${where}`:`قيد الاختبار عند ${where}`}</span></div></div><button class="secondary-btn" disabled>امتُحنت عند لجنة أخرى</button></article>`}
    const canSeeScore=committee.show_score!==false;
    const statusText=status==="no_draw"?"بانتظار اختيار الإدارة للأجزاء":status==="final"?(session?.assessment?.incomplete?"مكتمل · غير مكتمل":canSeeScore?`مكتمل · ${session.score}`:"مكتمل · العلامة غير ظاهرة للجنة"):status==="in_progress"?"مسودة محفوظة":"جاهز للاختبار";
    const positions=draw?`<ol class="committee-position-preview">${draw.positions.map((position,index)=>`<li><b>${index+1}</b><span>${escapeHtml(positionTitle(position))}</span><small>الجزء ${position.juz} · صفحة ${position.page}</small></li>`).join("")}</ol>`:`<div class="committee-no-draw">بانتظار قيام الإدارة باختيار الأجزاء وإجراء السحب لهذا المتسابق</div>`;
    const blockedByActiveOther=Boolean(activeParticipant)&&activeParticipant.id!==participant.id;
    const startBlockedHtml=!chairman?`<button class="secondary-btn" disabled>بانتظار البدء من رئيس اللجنة</button>`:blockedByActiveOther?`<button class="secondary-btn" disabled title="أنهوا اختبار «${escapeAttr(activeParticipant.name)}» الجاري أولاً">لجنتكم تختبر متسابقًا آخر حالياً</button>`:null;
    const memberHasStarted=Boolean(session?.assessment?.examinerDrafts?.member&&Object.keys(session.assessment.examinerDrafts.member).length);
    const action=!draw?`<button class="secondary-btn" disabled>بانتظار سحب الإدارة</button>`:status==="pending"?(startBlockedHtml||`<button class="primary-btn" data-diwan-committee-confirm-start="${participant.id}">البدء بالاختبار الآن</button>`):status==="in_progress"?(chairman?`<div class="committee-action-group"><button class="primary-btn" data-diwan-committee-student="${participant.id}">متابعة الرصد</button><button type="button" class="compact-btn danger-compact" data-diwan-cancel-exam="${participant.id}"><i data-lucide="rotate-ccw"></i> إلغاء الاختبار</button></div>`:`<button class="primary-btn" data-diwan-committee-student="${participant.id}">${memberHasStarted?"متابعة الرصد":"ابدأ الاختبار الآن"}</button>`):`<button class="secondary-btn" data-diwan-committee-student="${participant.id}">عرض التقييم</button>`;
    return `<article class="committee-student ${status}"><div><h3>${escapeHtml(participant.name)}</h3><p>${escapeHtml(participant.center)} · رقم الجلوس ${escapeHtml(participant.seat)}</p><div class="committee-student-meta"><span>${escapeHtml(DIWAN_STAGE_LABELS[participant.stage]||"")}</span>${draw?`<span>${draw.positions.length} مواضع</span>`:""}<span class="state ${status==="final"?"completed":status==="in_progress"?"drawn":status==="no_draw"?"not-drawn":""}">${statusText}</span></div>${positions}</div>${action}</article>`;
  }).join(""):`<div class="committee-empty"><b>لا يوجد متسابقون بهذه الحالة</b><p>غيّر حالة الفرز أو عبارة البحث لعرض بقية الطلاب.</p></div>`;
  $$(`[data-diwan-committee-student]`).forEach(button=>button.onclick=()=>startDiwanCommitteeExam(button.dataset.diwanCommitteeStudent));
  $$(`[data-diwan-committee-confirm-start]`).forEach(button=>button.onclick=()=>openDiwanCommitteeStartConfirm(button.dataset.diwanCommitteeConfirmStart));
  $$(`[data-diwan-cancel-exam]`).forEach(button=>button.onclick=()=>cancelDiwanCommitteeExam(button.dataset.diwanCancelExam));
  lucide.createIcons();
}
function openDiwanCommitteeStartConfirm(participantId){
  const participant=diwanCommitteeScopedState.participants.find(p=>p.id===participantId);
  if(!participant)return toast("المتسابق غير موجود");
  const partsText=participant.parts?.length?participant.parts.join("، "):"غير مسجّلة";
  openModal(`<div class="modal-head"><h2>تأكيد بيانات المتسابق قبل البدء</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">يرجى التحقق من مطابقة البيانات أدناه مع بيانات الطالب الحاضر أمامكم قبل بدء الاختبار.</p><p class="field-help">الاسم: <b>${escapeHtml(participant.name)}</b></p><p class="field-help">الرقم التسلسلي: <b>${escapeHtml(diwanSerialOf(participant)||"—")}</b></p><p class="field-help">المركز: <b>${escapeHtml(participant.center||"—")}</b></p><p class="field-help">المرحلة: <b>${escapeHtml(DIWAN_STAGE_LABELS[participant.stage]||"")}</b></p><p class="field-help committee-confirm-parts">الأجزاء المشارك فيها: <b>${escapeHtml(partsText)}</b></p></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button type="button" class="primary-btn" id="diwanCommitteeConfirmStartBtn">تأكيد والبدء</button></div>`);
  $("#diwanCommitteeConfirmStartBtn").onclick=()=>{closeModal();startDiwanCommitteeExam(participantId)};
}
async function startDiwanCommitteeExam(participantId){
  const participant=diwanCommitteeScopedState.participants.find(item=>item.id===participantId);
  if(!participant)return toast("المتسابق غير موجود");
  const draw=currentDiwanDraw(participant,diwanCommitteeScopedState.draws);
  if(!draw)return toast("بانتظار قيام الإدارة باختيار الأجزاء وإجراء السحب لهذا المتسابق");
  let session=diwanCommitteeSessions.find(item=>item.draw_id===draw.id);
  if(!session&&!diwanSerialOf(participant))return toast("لم تُدخل الإدارة الرقم التسلسلي لهذا المتسابق بعد — يُرجى مراجعة الإدارة قبل بدء الاختبار");
  try{
    await ensureQuranReady();
    if(!session){session=await window.DiwanCompetition.claimStudent(participant.id,draw.id,draw.stage,participant.level,participant.levelName);diwanCommitteeSessions.unshift(session)}
    activeDiwanCloudSession=session;
    if(session.assessment&&Object.keys(session.assessment).length)participant.assessment=session.assessment;
    if(session.status==="final")return openDiwanCompletedAssessment(draw,participant,session);
    openDiwanElectronicAssessment(draw,session);
  }catch(error){
    if(String(error?.message||"").includes("تعذر تحميل بيانات")){
      openModal(`<div class="modal-head"><h2>تعذر تحميل بيانات القرآن</h2><button type="button" class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="form-error">${escapeHtml(error.message)}</p><p class="field-help">غالبًا بسبب ضعف أو انقطاع الاتصال بالإنترنت عند هذا الجهاز حاليًا.</p></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إغلاق</button><button type="button" id="retryStartDiwanExamBtn" class="primary-btn"><i data-lucide="refresh-cw"></i> إعادة المحاولة</button></div>`);
      $("#retryStartDiwanExamBtn").onclick=()=>{closeModal();startDiwanCommitteeExam(participantId)};
    }else toast(error.message);
  }
}
async function cancelDiwanCommitteeExam(participantId){
  const participant=diwanCommitteeScopedState.participants.find(item=>item.id===participantId);
  if(!participant)return toast("المتسابق غير موجود");
  const draw=currentDiwanDraw(participant,diwanCommitteeScopedState.draws);
  if(!draw)return toast("لا يوجد اختبار جارٍ لهذا المتسابق");
  if(!confirm(`إلغاء اختبار «${participant.name}» الجاري؟ سيُحذف كل ما سُجّل حتى الآن وتعود حالته إلى "جاهز للاختبار".`))return;
  try{
    await window.DiwanCompetition.cancelSession(draw.id);
    localStorage.removeItem(`${DIWAN_ASSESSMENT_DRAFT_PREFIX}chairman-${participantId}`);
    localStorage.removeItem(`${DIWAN_ASSESSMENT_DRAFT_PREFIX}member-${participantId}`);
    if(activeDiwanCloudSession?.draw_id===draw.id)activeDiwanCloudSession=null;
    delete participant.assessment;
    diwanCommitteeSessions=diwanCommitteeSessions.filter(session=>session.draw_id!==draw.id);
    renderDiwanCommitteeStudents();
    toast(`تم إلغاء اختبار ${participant.name}`);
  }catch(error){toast(error.message)}
}
function ensureDiwanAssessment(participant,draw){
  const stored=participant.assessment?.examinerDrafts?.[currentExaminerRole()]||participant.assessment,previous=stored?.drawId===draw.id?stored:null,byPosition=new Map((previous?.positions||[]).map(item=>[item.positionId,item]));
  const assessment=previous||{id:uid("ASSESS"),drawId:draw.id,status:"draft",startedAt:new Date().toISOString(),revisions:[]};
  assessment.positions=draw.positions.map(position=>({...emptyPositionAssessment(position),...(byPosition.get(position.id)||{})}));
  assessment.updatedAt=new Date().toISOString();assessment.examinerRole=currentExaminerRole();
  participant.assessment=assessment;
  return assessment;
}
function diwanExaminerDraftKey(participantId){return `${DIWAN_ASSESSMENT_DRAFT_PREFIX}${currentExaminerRole()}-${participantId}`}
function loadDiwanLocalAssessmentDraft(participantId){try{return JSON.parse(localStorage.getItem(diwanExaminerDraftKey(participantId))||"null")}catch{return null}}
// نسخة محلية إضافية (localStorage) فوق الحفظ السحابي كل 300ms — لو انسكر المتصفح فجأة أو انقطع
// الإنترنت لحظة إعادة فتح الطالب، يرجّع آخر رصد محلي بدل ما يبلّش من الصفر (نفس saveAssessmentDraft بالسنوية).
function saveDiwanAssessmentDraft(participant){
  participant.assessment.status="draft";participant.assessment.updatedAt=new Date().toISOString();participant.assessment.examinerRole=currentExaminerRole();
  safeSetItem(diwanExaminerDraftKey(participant.id),JSON.stringify(participant.assessment));
  if(activeDiwanCloudSession)window.DiwanCompetition.queueSessionSave(activeDiwanCloudSession.id,participant.assessment,error=>toast(`تعذر حفظ المسودة: ${error.message}`));
}
function openDiwanElectronicAssessment(draw,cloudSession=null,jumpToIndex=null){
  stopExamTimerInterval();
  activeDiwanCloudSession=cloudSession;
  const participant=diwanCommitteeScopedState.participants.find(item=>item.id===draw.participantId);
  if(!participant)return toast("التقييم الإلكتروني متاح للمتسابقين المسجلين فقط");
  const cloudDraft=cloudSession?.assessment&&Object.keys(cloudSession.assessment).length?cloudSession.assessment:null;
  const localDraft=loadDiwanLocalAssessmentDraft(participant.id);
  const currentDraft=participant.assessment&&Object.keys(participant.assessment).length?participant.assessment:null;
  const draftCandidates=[currentDraft,cloudDraft,localDraft?.drawId===draw.id?localDraft:null].filter(Boolean);
  if(draftCandidates.length){
    const newestDraft=draftCandidates.reduce((best,item)=>new Date(item.updatedAt||0)>new Date(best.updatedAt||0)?item:best);
    if(newestDraft!==currentDraft)participant.assessment=newestDraft;
  }
  const assessment=ensureDiwanAssessment(participant,draw);assessment.actions=assessment.actions||[];
  let currentIndex=jumpToIndex!=null?Math.min(Math.max(0,jumpToIndex),draw.positions.length-1):Math.min(Math.max(0,Number(assessment.currentPosition)||0),draw.positions.length-1);
  let chairmanPositionChangeCounts=draw.positions.map(()=>0);
  let quranPageOffsets=draw.positions.map(()=>0);
  let tajweedCapWarningVisible=false,tajweedCapWarningTimer=null;
  let lastRenderedPositionIndex=null;
  openModal(`<div class="examiner-header"><button type="button" class="icon-btn" data-close title="حفظ وخروج"><i data-lucide="x"></i></button><div><span>اختبار ${escapeHtml(participant.name)} · ديوان الحفاظ</span><small>${participant.level} أجزاء · السحب ${String(draw.sequence).padStart(4,"0")}</small></div><div class="examiner-score"><small>العلامة</small><b id="assessmentLiveScore">100</b></div></div><div id="assessmentExamScreen" class="examiner-screen"><nav id="positionStepper" class="position-stepper">${draw.positions.map((_,index)=>`<button type="button" class="${assessment.positions[index].completed?"is-done":""}" data-position-step="${index}">${index+1}</button>`).join("")}</nav><main id="activeAssessmentPosition"></main><div class="examiner-quickbar"><button type="button" id="undoAssessmentAction" class="secondary-btn"><i data-lucide="undo-2"></i> تراجع عن آخر تسجيل</button><div><span>إجمالي الخصم</span><b id="assessmentTotalDeduction">0</b></div></div><div class="examiner-navigation"><button type="button" id="previousAssessmentPosition" class="secondary-btn"><i data-lucide="arrow-right"></i> السابق</button><button type="button" id="reviewAssessmentBtn" class="primary-btn"><i data-lucide="clipboard-check"></i> مراجعة واعتماد</button><button type="button" id="nextAssessmentPosition" class="primary-btn">التالي <i data-lucide="arrow-left"></i></button></div><div id="assessmentSummaryRows" class="hidden"></div></div>`,"examiner-mode-modal");document.body.classList.add("exam-fullscreen");
  const renderPosition=()=>{assessment.currentPosition=currentIndex;
    const stayedOnSamePosition=lastRenderedPositionIndex===currentIndex,previousPanelScroll=stayedOnSamePosition?($(".exam-split-panel")?.scrollTop||0):0;
    if(!stayedOnSamePosition)resetExamTimerState();
    lastRenderedPositionIndex=currentIndex;
    $("#activeAssessmentPosition").innerHTML=assessmentPositionHtml(assessment.positions[currentIndex],draw.positions[currentIndex],currentIndex,draw.positions.length,chairmanPositionChangeCounts[currentIndex],quranPageOffsets[currentIndex],draw.rerolls?.length||0,tajweedCapWarningVisible);preloadNextQuranImage(draw,currentIndex);
    const panel=$(".exam-split-panel");if(panel)panel.scrollTop=previousPanelScroll;
    $$(`[data-position-step]`).forEach(button=>{const index=Number(button.dataset.positionStep);button.classList.toggle("active",index===currentIndex);button.classList.toggle("is-done",Boolean(assessment.positions[index].completed))});$("#previousAssessmentPosition").disabled=currentIndex===0;$("#nextAssessmentPosition").disabled=currentIndex===draw.positions.length-1;lucide.createIcons()};
  const refresh=()=>{renderPosition();updateAssessmentSummary(assessment,DIWAN_PASS_SCORE);$("#undoAssessmentAction").disabled=!assessment.actions.length;const finish=$("#finishFailedAssessment");if(finish)finish.onclick=()=>endDiwanExamNow(draw,participant,assessment)};
  stopMemberPositionSync();
  if(currentExaminerRole()==="member"&&activeDiwanCloudSession){
    const syncChairmanChanges=async()=>{
      try{
        const session=await window.DiwanCompetition.getSession(activeDiwanCloudSession.id);
        if(session?.status==="final"){
          stopMemberPositionSync();
          toast(`تم إنهاء الاختبار من قبل رئيس اللجنة${session.assessment?.incomplete?" · غير مكتمل":session.score!=null?` · العلامة ${formatAssessmentNumber(session.score)}`:""}`);
          closeModal();
          activeDiwanCloudSession=null;
          renderDiwanCommitteeWorkspace();
          return;
        }
        const chairmanPositions=session?.assessment?.examinerDrafts?.chairman?.positions;
        if(Array.isArray(chairmanPositions)){
          const nextCounts=draw.positions.map((_,i)=>Number(chairmanPositions[i]?.positionChange)||0);
          const changedIndex=nextCounts.findIndex((count,i)=>count>(chairmanPositionChangeCounts[i]||0));
          if(changedIndex>=0)toast(`⚠ رئيس اللجنة غيّر الموضع ${changedIndex+1} — يمكنك اعتماد التغيير الآن`);
          chairmanPositionChangeCounts=nextCounts;
          refresh();
        }
      }catch(error){console.warn("Diwan member position sync failed",error)}
    };
    syncChairmanChanges();
    memberPositionSyncTimer=setInterval(syncChairmanChanges,1500);
  }
  $("#assessmentExamScreen").addEventListener("click",event=>{
    const timerButton=event.target.closest("[data-exam-timer-action]");if(timerButton){const action=timerButton.dataset.examTimerAction;if(action==="start")startExamTimer();else if(action==="stop")stopExamTimerInterval();else if(action==="zero")zeroExamTimer();else if(action==="bell")playExamTimerBell();return}
    const quranNavButton=event.target.closest("[data-quran-page-nav]");if(quranNavButton){if(quranNavButton.disabled)return;const delta=Number(quranNavButton.dataset.quranPageNav),pageCount=new Set(drawPositionSegments(draw.positions[currentIndex]).map(segment=>segment.page)).size;quranPageOffsets[currentIndex]=Math.min(Math.max(0,(quranPageOffsets[currentIndex]||0)+delta),Math.max(0,pageCount-1));return renderPosition()}
    const completeButton=event.target.closest("[data-toggle-complete]");if(completeButton){const index=Number(completeButton.dataset.toggleComplete),position=assessment.positions[index];position.completed=!position.completed;saveDiwanAssessmentDraft(participant);return refresh()}
    const actionButton=event.target.closest("[data-assess-delta]");if(actionButton){
      const index=Number(actionButton.dataset.assessIndex),type=actionButton.dataset.assessType,delta=Number(actionButton.dataset.assessDelta);
      if(type==="positionChange"&&delta>0){
        if(currentExaminerRole()==="chairman"){actionButton.disabled=true;replaceDiwanAssessmentPosition(draw,participant,assessment,index).then(()=>{currentIndex=index;refresh()}).catch(error=>toast(error.message)).finally(()=>actionButton.disabled=false)}
        else{const chairmanCount=chairmanPositionChangeCounts[index]||0,ownCount=Number(assessment.positions[index].positionChange)||0;if(chairmanCount<=ownCount)return;actionButton.disabled=true;adoptDiwanChairmanPositionChange(draw,participant,assessment,index).then(()=>{currentIndex=index;refresh()}).catch(error=>toast(error.message)).finally(()=>actionButton.disabled=false)}
        return;
      }
      const position=assessment.positions[index],before=Number(position[type])||0,after=Math.max(0,before+delta);if(after===before)return;
      if(type==="tajweed"&&delta>0&&tajweedTotalOf(assessment)>=TAJWEED_ERROR_CAP){tajweedCapWarningVisible=true;clearTimeout(tajweedCapWarningTimer);tajweedCapWarningTimer=setTimeout(()=>{tajweedCapWarningVisible=false;renderPosition()},6000);return renderPosition()}
      position[type]=after;assessment.actions.push({positionId:position.positionId,type,delta:after-before,at:new Date().toISOString()});saveDiwanAssessmentDraft(participant);return refresh()
    }
    const step=event.target.closest("[data-position-step]");if(step){currentIndex=Number(step.dataset.positionStep);tajweedCapWarningVisible=false;clearTimeout(tajweedCapWarningTimer);return renderPosition()}
  });
  $("#assessmentExamScreen").addEventListener("input",event=>{const note=event.target.closest("[data-assess-note]");if(!note)return;assessment.positions[Number(note.dataset.assessNote)].note=note.value;saveDiwanAssessmentDraft(participant)});
  $("#previousAssessmentPosition").onclick=()=>{if(currentIndex>0){currentIndex--;tajweedCapWarningVisible=false;clearTimeout(tajweedCapWarningTimer);renderPosition()}};
  $("#nextAssessmentPosition").onclick=()=>{if(currentIndex<draw.positions.length-1){currentIndex++;tajweedCapWarningVisible=false;clearTimeout(tajweedCapWarningTimer);renderPosition()}};
  $("#undoAssessmentAction").onclick=()=>{const action=assessment.actions.pop();if(!action)return;const index=assessment.positions.findIndex(position=>position.positionId===action.positionId);if(index<0)return;const position=assessment.positions[index];position[action.type]=Math.max(0,(Number(position[action.type])||0)-action.delta);currentIndex=index;saveDiwanAssessmentDraft(participant);refresh();toast("تم التراجع عن آخر تسجيل")};
  $("#reviewAssessmentBtn").onclick=()=>openDiwanAssessmentReview(draw,participant);refresh();
}
async function replaceDiwanAssessmentPosition(draw,participant,assessment,index){
  if((draw.rerolls?.length||0)>=2)return toast("تم استخدام الحد الأقصى لتبديل الموضع (مرتان) لهذا المتسابق");
  if(!confirm("سيتم خصم 10 علامات واختيار موضع مختلف عشوائيًا من الجزء نفسه. هل تريد المتابعة؟"))return;
  const old=draw.positions[index],pool=diwanAvailableForParts([old.juz]).filter(item=>item.id!==old.id&&!draw.positions.some(position=>position.id===item.id));
  if(!pool.length)throw new Error("لا يوجد موضع بديل متاح في الجزء نفسه");
  const replacement=pool[randomIndex(pool.length)],entry=assessment.positions[index];
  entry.positionChange=(Number(entry.positionChange)||0)+1;
  entry.changes=entry.changes||[];
  entry.changes.push({oldPosition:old,newPosition:replacement,committeeName:window.CloudCompetition.context?.committee?.name||"الإدارة",at:new Date().toISOString(),oldAssessmentSnapshot:{memorization:entry.memorization,language:entry.language,tajweed:entry.tajweed,hesitation:entry.hesitation,note:entry.note,completed:entry.completed}});
  entry.memorization=0;entry.language=0;entry.tajweed=0;entry.hesitation=0;entry.note="";entry.completed=false;
  entry.positionId=replacement.id;draw.positions[index]=replacement;
  assessment.actions.push({positionId:replacement.id,type:"positionChange",delta:1,at:new Date().toISOString(),oldPositionId:old.id});
  assessment.updatedAt=new Date().toISOString();
  await window.DiwanCompetition.replacePosition(participant.id,draw.id,index,replacement,assessment);
  draw.rerolls=draw.rerolls||[];draw.rerolls.push({positionIndex:index,at:new Date().toISOString()});
  saveDiwanAssessmentDraft(participant);
  toast(`تم تغيير الموضع ${index+1} بموضع آخر من الجزء ${old.juz}`);
}
async function adoptDiwanChairmanPositionChange(draw,participant,assessment,index){
  const remote=await window.DiwanCompetition.loadCommitteeState();
  const remoteDraw=(remote.payload?.draws||[]).find(item=>item.id===draw.id);
  const fresh=remoteDraw?.positions?.[index];
  if(!fresh)throw new Error("تعذر جلب الموضع الجديد من رئيس اللجنة، حاول مجددًا");
  const old=draw.positions[index],entry=assessment.positions[index];
  entry.positionChange=(Number(entry.positionChange)||0)+1;
  entry.changes=entry.changes||[];
  entry.changes.push({oldPosition:old,newPosition:fresh,committeeName:window.CloudCompetition.context?.committee?.name||"الإدارة",at:new Date().toISOString(),oldAssessmentSnapshot:{memorization:entry.memorization,language:entry.language,tajweed:entry.tajweed,hesitation:entry.hesitation,note:entry.note,completed:entry.completed}});
  entry.memorization=0;entry.language=0;entry.tajweed=0;entry.hesitation=0;entry.note="";entry.completed=false;
  entry.positionId=fresh.id;
  draw.positions[index]=fresh;
  assessment.actions.push({positionId:fresh.id,type:"positionChange",delta:1,at:new Date().toISOString()});
  assessment.updatedAt=new Date().toISOString();
  saveDiwanAssessmentDraft(participant);
  toast(`تم اعتماد الموضع الجديد للموضع ${index+1} كما اختاره رئيس اللجنة`);
}
// محرّر توصية اللجنة: نقاط مرقّمة (ol)، كل نقطة حقل مستقل، وتُخزَّن كمصفوفة نصوص بـassessment.recommendation (نفس الصيغة التي يقرأها مستند التوصية).
function diwanRecommendationRowHtml(value=""){return `<li><input type="text" class="diwan-rec-input" maxlength="${DIWAN_RECOMMENDATION_MAX_CHARS}" value="${escapeAttr(value)}" placeholder="نقطة توصية"><button type="button" class="icon-btn diwan-rec-remove" title="حذف النقطة"><i data-lucide="x"></i></button></li>`}
function diwanRecommendationEditorHtml(lines){return `<ol id="diwanRecommendationList" class="diwan-rec-list">${(lines&&lines.length?lines:[""]).map(diwanRecommendationRowHtml).join("")}</ol><button type="button" id="diwanAddRecommendationBtn" class="secondary-btn"><i data-lucide="plus"></i> إضافة نقطة</button>`}
function bindDiwanRecommendationEditor(){
  const list=document.getElementById("diwanRecommendationList");if(!list)return;
  document.getElementById("diwanAddRecommendationBtn").onclick=()=>{if(list.children.length>=DIWAN_RECOMMENDATION_MAX_POINTS)return toast(`الحد الأقصى ${DIWAN_RECOMMENDATION_MAX_POINTS} نقاط (عدد أسطر مستند التوصية)`);list.insertAdjacentHTML("beforeend",diwanRecommendationRowHtml());lucide.createIcons();list.lastElementChild.querySelector("input").focus()};
  list.addEventListener("click",event=>{const remove=event.target.closest(".diwan-rec-remove");if(!remove)return;const item=remove.closest("li");if(list.children.length>1)item.remove();else item.querySelector("input").value=""});
}
function readDiwanRecommendationEditor(){return Array.from(document.querySelectorAll("#diwanRecommendationList .diwan-rec-input")).map(input=>input.value.trim()).filter(Boolean).slice(0,DIWAN_RECOMMENDATION_MAX_POINTS)}
async function endDiwanExamNow(draw,participant,assessment){
  if(currentExaminerRole()!=="chairman")return;
  if(!confirm("سيتم إنهاء الاختبار الآن دون إكمال باقي المواضع، وستُسجَّل علامة المتسابق «غير مكتمل» مباشرة بدل حساب علامة رقمية. هل تريد المتابعة؟"))return;
  stopMemberPositionSync();
  openModal(`<div class="modal-head"><div><span class="eyebrow">رئيس اللجنة · ديوان الحفاظ</span><h2>${escapeHtml(participant.name)}</h2><small>إنهاء الاختبار قبل اكتماله</small></div></div><div class="modal-body"><section class="examiner-comparison"><h3>توصية اللجنة</h3><p class="field-help">لا تصدر شهادة لهذه المحاولة. أضف توصية اللجنة كنقاط مرقّمة ثم أنهِ الاختبار.</p>${diwanRecommendationEditorHtml(Array.isArray(assessment.recommendation)?assessment.recommendation:[])}</section></div><div class="modal-actions"><button id="backFromEndDiwan" class="secondary-btn">الرجوع للاختبار</button><button id="confirmEndDiwan" class="primary-btn">إنهاء الاختبار وحفظ التوصية</button></div>`,"examiner-mode-modal assessment-review-modal");
  document.body.classList.add("exam-fullscreen");bindDiwanRecommendationEditor();lucide.createIcons();
  $("#backFromEndDiwan").onclick=()=>openDiwanElectronicAssessment(draw,activeDiwanCloudSession);
  $("#confirmEndDiwan").onclick=async()=>{
    $("#confirmEndDiwan").disabled=true;
    const recommendation=readDiwanRecommendationEditor();
    assessment.recommendation=recommendation.length?recommendation:null;
    assessment.positions.forEach(position=>{if(!position.completed)position.completed=true});
    assessment.endedEarly=true;assessment.endedEarlyAt=new Date().toISOString();assessment.incomplete=true;
    saveDiwanAssessmentDraft(participant);
    window.DiwanCompetition.cancelQueuedSessionSave?.();
    await finalizeDiwanElectronicAssessment(draw,participant,calculateFinalAssessment(assessment,DIWAN_PASS_SCORE));
  };
}
async function openDiwanAssessmentReview(draw,participant){
  stopMemberPositionSync();
  const assessment=participant.assessment,result=calculateAssessment(assessment,DIWAN_PASS_SCORE),chairman=currentExaminerRole()==="chairman";
  const incompleteIndex=assessment.positions.findIndex(p=>!p.completed);
  if(incompleteIndex>=0){toast(`الرجاء وضع "إنهاء هذا الموضع" على الموضع ${incompleteIndex+1} قبل المراجعة والاعتماد`);return openDiwanElectronicAssessment(draw,activeDiwanCloudSession,incompleteIndex)}
  saveDiwanAssessmentDraft(participant);
  window.DiwanCompetition.cancelQueuedSessionSave?.();
  if(activeDiwanCloudSession)try{activeDiwanCloudSession=await window.DiwanCompetition.saveSession(activeDiwanCloudSession.id,assessment,"in_progress",null)}catch(error){return toast(`تعذر تثبيت الرصد: ${error.message}`)}
  if(!chairman){
    assessment.memberSubmittedAt=new Date().toISOString();saveDiwanAssessmentDraft(participant);
    openModal(`<div class="modal-head"><div><span class="eyebrow">رصد عضو اللجنة · ديوان الحفاظ</span><h2>${escapeHtml(participant.name)}</h2><small>تم حفظ الرصد للرئيس</small></div><button class="icon-btn" id="backToAssessment"><i data-lucide="arrow-right"></i></button></div><div class="modal-body"><div class="assessment-review-score ${result.passed?"passed":"failed"}"><span>العلامة حسب رصدك</span><b>${formatAssessmentNumber(result.score)}</b><strong>مسودة غير معتمدة</strong></div><div class="assessment-review-grid">${Object.entries(ASSESSMENT_RULES).map(([type,rule])=>`<div><span>${rule.label}</span><b>${result.totals[type]}</b><small>خصم ${formatAssessmentNumber(result.deductions[type])}</small></div>`).join("")}</div><p class="assessment-review-note">وصل رصدك إلى رئيس اللجنة. اعتماد النتيجة النهائية متاح للرئيس فقط.</p></div><div class="modal-actions"><button id="editAssessmentBtn" class="secondary-btn">الرجوع للرصد</button><button class="primary-btn" data-close>إنهاء والعودة للقائمة</button></div>`,`examiner-mode-modal assessment-review-modal`);document.body.classList.add("exam-fullscreen");
    $("#backToAssessment").onclick=$("#editAssessmentBtn").onclick=()=>openDiwanElectronicAssessment(draw,activeDiwanCloudSession);return;
  }
  let latest=activeDiwanCloudSession;
  try{const sessions=await window.DiwanCompetition.listCommitteeSessions();latest=sessions.find(item=>item.id===activeDiwanCloudSession?.id)||latest;if(latest)activeDiwanCloudSession=latest}catch(error){console.warn("Could not refresh examiner drafts",error)}
  const memberDraft=latest?.assessment?.examinerDrafts?.member||null;
  const finalResult=calculateFinalAssessment(assessment,DIWAN_PASS_SCORE);
  const diffIndexes=memberDraft?.positions?.length?assessment.positions.map((own,index)=>positionsDiffer(own,memberDraft.positions[index])?index:-1).filter(index=>index>=0):[];
  const diffTable=!memberDraft?.positions?.length?`<p class="committee-alerts-empty">لم يصل رصد عضو اللجنة بعد. يمكن للرئيس الاعتماد الآن أو انتظار العضو.</p>`
    :!diffIndexes.length?`<p class="committee-alerts-empty">لا يوجد أي اختلاف بين رصد الرئيس ورصد العضو — كل المواضع متطابقة.</p>`
    :`<p class="field-help">${diffIndexes.length} من ${assessment.positions.length} مواضع فيها اختلاف بالرصد. أدخل عدد الأخطاء المعتمد لكل نوع مختلَف عليه فقط.</p>${diffIndexes.map(index=>{const own=assessment.positions[index],member=memberDraft.positions[index];const typeRows=Object.entries(ASSESSMENT_RULES).filter(([type])=>(Number(own[type])||0)!==(Number(member[type])||0)).map(([type,rule])=>{const ownCount=Number(own[type])||0,memberCount=Number(member[type])||0,adoptedVal=own.adopted&&Number.isFinite(own.adopted[type])?own.adopted[type]:"";return `<div class="examiner-diff-type-row"><span>${rule.label}</span><b>${ownCount}</b><b>${memberCount}</b><input type="number" min="0" step="1" data-adopted-count="${index}|${type}" value="${adoptedVal}" placeholder="العدد المعتمد"></div>`}).join("");return `<div class="examiner-diff-position"><div class="examiner-diff-position-head">الموضع ${index+1}</div><div class="examiner-diff-type-head"><span>نوع الخطأ</span><span>الرئيس</span><span>العضو</span><span>المعتمد</span></div>${typeRows}</div>`}).join("")}`;
  const recommendationHtml=`<section id="diwanRecommendationSection" class="examiner-comparison" ${finalResult.passed?"hidden":""}><h3>توصية اللجنة</h3><p class="field-help">تظهر للمتسابق غير الناجح كنقاط مرقّمة في مستند التوصية. أضف نقطة لكل ملاحظة (حتى ${DIWAN_RECOMMENDATION_MAX_POINTS} نقاط، كل نقطة سطر واحد).</p>${diwanRecommendationEditorHtml(Array.isArray(assessment.recommendation)?assessment.recommendation:[])}</section>`;
  openModal(`<div class="modal-head"><div><span class="eyebrow">مراجعة رئيس اللجنة · ديوان الحفاظ</span><h2>${escapeHtml(participant.name)}</h2><small>اختلافات الرصد واعتماد النتيجة</small></div><button class="icon-btn" id="backToAssessment"><i data-lucide="arrow-right"></i></button></div><div class="modal-body"><div class="assessment-review-score ${finalResult.passed?"passed":"failed"}"><span>العلامة النهائية</span><b id="reviewLiveScore">${formatAssessmentNumber(finalResult.score)}</b><strong id="reviewLiveOutcome">${finalResult.passed?"ناجح":"راسب"}</strong></div><section class="examiner-comparison"><h3>مواضع الاختلاف بين الرئيس والعضو</h3>${diffTable}</section>${recommendationHtml}<p class="assessment-review-note">المواضع غير المختلَف عليها تُحسب من رصد الرئيس مباشرة دون تدخل.</p></div><div class="modal-actions"><button id="editAssessmentBtn" class="secondary-btn">الرجوع للتعديل</button><button id="finalizeAssessmentBtn" class="primary-btn"><i data-lucide="badge-check"></i> اعتماد النتيجة كرئيس اللجنة</button></div>`,`examiner-mode-modal assessment-review-modal`);document.body.classList.add("exam-fullscreen");
  $("#backToAssessment").onclick=$("#editAssessmentBtn").onclick=()=>openDiwanElectronicAssessment(draw,latest);
  bindDiwanRecommendationEditor();
  $$(`[data-adopted-count]`).forEach(input=>input.addEventListener("input",()=>{const [indexText,type]=input.dataset.adoptedCount.split("|"),index=Number(indexText),position=assessment.positions[index];position.adopted=position.adopted||{};position.adopted[type]=input.value===""?null:Math.max(0,Math.round(Number(input.value))||0);saveDiwanAssessmentDraft(participant);const live=calculateFinalAssessment(assessment,DIWAN_PASS_SCORE);$("#reviewLiveScore").textContent=formatAssessmentNumber(live.score);$("#reviewLiveOutcome").textContent=live.passed?"ناجح":"راسب";$(".assessment-review-score").classList.toggle("passed",live.passed);$(".assessment-review-score").classList.toggle("failed",!live.passed);$("#diwanRecommendationSection")?.toggleAttribute("hidden",live.passed)}));
  $("#finalizeAssessmentBtn").onclick=()=>{
    const recommendation=readDiwanRecommendationEditor(),live=calculateFinalAssessment(assessment,DIWAN_PASS_SCORE);
    if(!live.passed&&!recommendation.length&&!confirm("لم تُدخل أي توصية للمتسابق غير الناجح. هل تريد الاعتماد بدون توصية؟"))return;
    assessment.recommendation=!live.passed&&recommendation.length?recommendation:null;
    finalizeDiwanElectronicAssessment(draw,participant,live);
  };
}
async function finalizeDiwanElectronicAssessment(draw,participant,result){
  const button=$("#finalizeAssessmentBtn");if(button?.disabled||participant.assessment?.status==="final")return toast("هذه النتيجة معتمدة مسبقاً");
  if(button){button.disabled=true;button.textContent="جاري اعتماد النتيجة..."}
  window.DiwanCompetition.cancelQueuedSessionSave?.();
  const assessment=participant.assessment,now=new Date().toISOString();assessment.status="final";assessment.finalizedAt=now;assessment.updatedAt=now;assessment.result=result;participant.score=result.score;participant.gradedAt=now;participant.scoreSource="electronic";
  const examiningCommittee=window.CloudCompetition.context?.committee;
  if(examiningCommittee?.id)assessment.committee={id:examiningCommittee.id,name:examiningCommittee.name};
  if(activeDiwanCloudSession){
    try{
      activeDiwanCloudSession=await window.DiwanCompetition.saveSession(activeDiwanCloudSession.id,assessment,"final",result.score);
      diwanCommitteeSessions=diwanCommitteeSessions.filter(item=>item.id!==activeDiwanCloudSession.id);diwanCommitteeSessions.unshift(activeDiwanCloudSession);
    }catch(error){assessment.status="draft";delete participant.score;delete participant.gradedAt;delete participant.scoreSource;saveDiwanAssessmentDraft(participant);if(button){button.disabled=false;button.textContent="اعتماد النتيجة"}return toast(`لم تُعتمد النتيجة: ${error.message}`)}
  }
  localStorage.removeItem(diwanExaminerDraftKey(participant.id));
  renderDiwanCommitteeStudents();
  const canSeeScore=window.CloudCompetition.context?.committee?.show_score!==false,incomplete=Boolean(assessment.incomplete);
  openModal(`<div class="modal-head"><h2>${incomplete?"تم إنهاء الاختبار":"تم اعتماد النتيجة"}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="assessment-review-score ${incomplete?"incomplete":result.passed?"passed":"failed"}"><span>${escapeHtml(participant.name)}</span><b>${incomplete?"غير مكتمل":canSeeScore?formatAssessmentNumber(result.score):"—"}</b><strong>${incomplete?"أُنهي الاختبار قبل اكتماله":canSeeScore?(result.passed?"ناجح":"راسب"):"العلامة غير ظاهرة لهذه اللجنة"}</strong></div><p>${incomplete?"سُجِّلت علامة المتسابق «غير مكتمل» مع تفاصيل الأخطاء والترددات والملاحظات المسجَّلة حتى لحظة الإنهاء.":"حُفظت العلامة مع تفاصيل الأخطاء والترددات والملاحظات لكل موضع."}</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button>${(incomplete||!result.passed)?`<button id="downloadDiwanRecommendationBtn" class="secondary-btn"><i data-lucide="file-down"></i> تنزيل التوصية PDF</button>`:""}<button id="returnDiwanCommitteeWorkspace" class="primary-btn">العودة إلى قائمة ديوان الحفاظ</button></div></div>`);
  const recommendationDocSession=activeDiwanCloudSession||{status:"final",score:result.score,finalized_at:now,assessment};
  $("#downloadDiwanRecommendationBtn")?.addEventListener("click",()=>downloadDiwanRecommendation(participant,draw,{...recommendationDocSession,status:"final",score:result.score,assessment:{...recommendationDocSession.assessment,...assessment}}));
  $("#returnDiwanCommitteeWorkspace").onclick=()=>{closeModal();activeDiwanCloudSession=null;renderDiwanCommitteeWorkspace()};
}
function openDiwanCompletedAssessment(draw,participant,session){
  const assessment=session.assessment||participant.assessment||{},result=assessment.result||calculateAssessment(assessment,DIWAN_PASS_SCORE),incomplete=Boolean(assessment.incomplete),testedAt=session.finalized_at||assessment.finalizedAt||participant.gradedAt,canEdit=Boolean(window.CloudCompetition.context?.committee?.can_edit_final),canSeeScore=window.CloudCompetition.context?.committee?.show_score!==false;
  const recommendationHtml=Array.isArray(assessment.recommendation)&&assessment.recommendation.length?`<div class="assessment-review-note"><b>توصية اللجنة:</b><ol>${assessment.recommendation.map(line=>`<li>${escapeHtml(line)}</li>`).join("")}</ol></div>`:"";
  openModal(`<div class="modal-head"><div><span class="eyebrow">نتيجة معتمدة · ديوان الحفاظ ${canEdit?"· صلاحية التعديل مفعلة":"للعرض فقط"}</span><h2>${escapeHtml(participant.name)}</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="assessment-review-score ${incomplete?"incomplete":result.passed?"passed":"failed"}"><span>العلامة النهائية</span><b>${incomplete?"غير مكتمل":canSeeScore?formatAssessmentNumber(result.score):"—"}</b><strong>${incomplete?"أُنهي الاختبار قبل اكتماله":canSeeScore?(result.passed?"ناجح":"راسب"):"العلامة غير ظاهرة لهذه اللجنة"}</strong></div>${canSeeScore?`<div class="assessment-review-grid">${Object.entries(ASSESSMENT_RULES).map(([type,rule])=>`<div><span>${rule.label}</span><b>${result.totals?.[type]||0}</b><small>خصم ${formatAssessmentNumber(result.deductions?.[type]||0)}</small></div>`).join("")}</div>`:""}<p class="assessment-review-note">لجنة الاختبار: <b>${escapeHtml(assessment.committeeName||window.CloudCompetition.context?.committee?.name||"-")}</b><br>موعد الاختبار: <b>${testedAt?formatExamDate(testedAt):"غير مسجل"}</b></p>${recommendationHtml}</div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button>${canEdit?`<button id="reopenDiwanFinalAssessmentBtn" class="primary-btn"><i data-lucide="file-pen-line"></i> تعديل النتيجة المعتمدة</button>`:""}</div>`,"assessment-review-modal");
  if(canEdit)$("#reopenDiwanFinalAssessmentBtn").onclick=()=>reopenDiwanFinalAssessment(draw,participant,session);
}
async function reopenDiwanFinalAssessment(draw,participant,session){
  const button=$("#reopenDiwanFinalAssessmentBtn");button.disabled=true;button.textContent="جاري فتح التعديل...";
  try{
    const assessment=JSON.parse(JSON.stringify(session.assessment||participant.assessment||{}));
    assessment.status="draft";assessment.updatedAt=new Date().toISOString();assessment.revisions=assessment.revisions||[];assessment.revisions.push({type:"reopened-final",oldScore:session.score,at:assessment.updatedAt});
    const reopened=await window.DiwanCompetition.saveSession(session.id,assessment,"in_progress",null);
    activeDiwanCloudSession=reopened;diwanCommitteeSessions=diwanCommitteeSessions.map(item=>item.id===reopened.id?reopened:item);
    participant.assessment=assessment;delete participant.score;delete participant.gradedAt;
    openDiwanElectronicAssessment(draw,reopened);
    toast("تم فتح النتيجة للتعديل");
  }catch(error){button.disabled=false;button.textContent="تعديل النتيجة المعتمدة";toast(error.message)}
}

function formatAssessmentNumber(value){return new Intl.NumberFormat("en-US",{maximumFractionDigits:2,useGrouping:false}).format(Number(value)||0)}
function openBulkDrawModal(){
  const completed=new Set(state.draws.map(d=>d.participantId).filter(Boolean));const allPending=state.participants.filter(p=>!completed.has(p.id)&&!p.withdrawn);
  if(!allPending.length)return toast(state.participants.length?"جميع المتسابقين لديهم سحب محفوظ":"أضف المتسابقين أو استورد ملف Excel أولاً");
  const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
  const missingParts=allPending.filter(p=>p.parts?.length!==p.level);
  const readyCount=allPending.length-missingParts.length;
  openModal(`<div class="modal-head"><h2>سحب لجميع المتسابقين</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سينفذ النظام سحباً مستقلاً لكل متسابق بانتظار الاختبار وله أجزاء مسجلة، حسب مستواه، ويحفظ جميع النتائج في السجل. حدد فلترة اختيارية لقصر السحب على فئة معينة، أو اتركها فارغة للسحب لجميع من ينتظرون.</p><div class="form-grid">${genderFieldHtml("bulkDraw")}</div><fieldset><legend>المركز (اختياري، يمكن اختيار أكثر من مركز — اتركه فارغًا ليشمل كل المراكز)</legend><div class="committee-level-options">${centerCheckboxesHtml("bulkDrawCenter",centers)}</div></fieldset><fieldset><legend>المستوى (اختياري، يمكن اختيار أكثر من مستوى — اتركه فارغاً ليشمل جميع المستويات)</legend><div class="committee-level-options">${levelCheckboxesHtml("bulkDrawLevel")}</div></fieldset><div class="bulk-summary"><div><b>${readyCount}</b><span>بانتظار السحب (قبل الفلترة)</span></div><div><b>${state.draws.length}</b><span>سحباً محفوظاً حالياً</span></div></div>${missingParts.length?`<p class="form-error">${missingParts.length} متسابقاً بلا أجزاء مسجلة سيُتخطَّون تلقائياً ويرد اسمهم في ملخص النتيجة ليُرجى تعبئتها لهم لاحقاً:</p><div class="missing-parts-list">${missingParts.map(p=>`<span>${escapeHtml(p.name)} · ${p.levelName||`${p.level} أجزاء`}</span>`).join("")}</div>`:""}<p class="form-error">بعد التنفيذ تصبح المواضع مثبتة. استخدم إعادة السحب من سجل المتسابق فقط عند وجود سبب.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="confirmBulkDraw" class="primary-btn" ${readyCount?"":"disabled"}><i data-lucide="layers"></i> تنفيذ السحب لمن أجزاؤه جاهزة</button></div>`);
  wireLevelSelectAll("bulkDrawCenter");wireLevelSelectAll("bulkDrawLevel");
  $("#confirmBulkDraw").onclick=()=>{
    const gender=$("#bulkDrawGender").value,centersSelected=checkedValuesOf("bulkDrawCenter"),levels=$$(`[name="bulkDrawLevel"]`).filter(i=>i.checked).map(i=>i.value);
    const filtered=allPending.filter(p=>(gender==="all"||p.gender===gender)&&(!centersSelected.length||centersSelected.includes(p.center))&&(!levels.length||levels.includes(p.levelName||`${p.level} أجزاء`)));
    if(!filtered.length)return toast("لا يوجد متسابقون مطابقون للفلتر بانتظار السحب");
    runBulkDraw(filtered);
  };
}
async function runBulkDraw(participants){
  const button=$("#confirmBulkDraw");button.disabled=true;button.textContent="جاري تجهيز بيانات القرآن...";try{await ensureQuranReady()}catch(error){button.disabled=false;button.textContent="تنفيذ السحب لمن أجزاؤه جاهزة";return toast(`تعذر تجهيز بيانات القرآن: ${error.message}`)}let completed=0,missingPartsNames=[],noPositionsNames=[];
  for(const p of participants){
    button.textContent=`جاري السحب ${completed+1} من ${participants.length}`;
    if(p.parts?.length!==p.level){missingPartsNames.push(p.name);continue}const parts=p.parts;const questionCount=Math.min(LEVEL_QUESTIONS[p.level]||3,parts.length);const pools=new Map(parts.map(j=>[j,availableForParts([j],p.level)]));const eligibleParts=parts.filter(j=>pools.get(j).length);
    if(eligibleParts.length<questionCount){noPositionsNames.push(p.name);continue}
    const drawnParts=secureShuffle(eligibleParts).slice(0,questionCount);const positions=drawnParts.map(j=>pools.get(j)[randomIndex(pools.get(j).length)]).sort((a,b)=>a.juz-b.juz);const draw={id:uid("DRAW"),sequence:nextDrawSequence(),participantId:p.id,name:p.name,seat:p.seat,center:p.center,age:p.age,level:p.level,eligibleParts:parts,positions,createdAt:new Date().toISOString(),rerolls:[],verification:""};draw.verification=await createVerification(draw);state.draws.push(draw);saveState();completed++;
  }
  renderAll();openModal(`<div class="modal-head"><h2>اكتمل السحب الجماعي</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="bulk-summary"><div><b>${completed}</b><span>نتيجة تم حفظها</span></div><div><b>${missingPartsNames.length+noPositionsNames.length}</b><span>لم يتم سحبه</span></div></div>${missingPartsNames.length?`<p class="form-error"><b>لم تُسجل أجزاؤهم، يُرجى تعبئتها ثم إعادة السحب لهم:</b> ${missingPartsNames.map(escapeHtml).join("، ")}</p>`:""}${noPositionsNames.length?`<p class="form-error"><b>تعذر توفير مواضع غير متداخلة لهم:</b> ${noPositionsNames.map(escapeHtml).join("، ")}</p>`:""}${!missingPartsNames.length&&!noPositionsNames.length?"<p>جميع النتائج جاهزة في سجل السحوبات ويمكن فتح كل نتيجة وطباعتها.</p>":""}</div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button><button id="goHistoryAfterBulk" class="primary-btn">عرض سجل السحوبات</button></div>`);$("#goHistoryAfterBulk").onclick=()=>{closeModal();navigate("history")};
}
function positionTitle(p){return p.endChapter&&p.endChapter!==p.chapter?`${p.chapterName} (${p.startAyah}) إلى ${p.endChapterName} (${p.endAyah})`:`${p.chapterName} (${p.startAyah}${p.endAyah!==p.startAyah?` - ${p.endAyah}`:""})`}
function positionHtml(p,i){return `<article class="position-card"><span class="position-number">${i+1}</span><div><h3>${escapeHtml(positionTitle(p))}</h3><p>الجزء ${p.juz} · ${p.lineCount?`${p.lineCount} أسطر · `:""}${p.words} كلمة · ${p.startKey} إلى ${p.endKey}</p></div><div class="page-number"><span>الصفحة</span><b>${p.page}</b></div></article>`}
function requestReroll(drawId){const draw=state.draws.find(d=>d.id===drawId);openModal(`<form id="rerollForm"><div class="modal-head"><h2>إعادة سحب موضع</h2><button class="icon-btn" type="button" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><label>الموضع المطلوب تغييره<select id="rerollIndex">${draw.positions.map((p,i)=>`<option value="${i}">${i+1}. ${escapeHtml(positionTitle(p))}</option>`).join("")}</select></label><label>سبب إعادة السحب<textarea id="rerollReason" required rows="3" placeholder="يُحفظ السبب في سجل الدورة"></textarea></label></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button class="primary-btn">تأكيد وإعادة السحب</button></div></form>`);$("#rerollForm").onsubmit=e=>{e.preventDefault();const index=Number($("#rerollIndex").value),old=draw.positions[index],everHeld=new Set([...draw.positions.map(p=>p.id),...(draw.rerolls||[]).map(r=>r.old.id)]),pool=availableForParts([old.juz],draw.level).filter(c=>!everHeld.has(c.id));if(!pool.length)return toast("لا يوجد بديل آخر في هذا الجزء لم يسبق أن أُعطي لهذا المتسابق");const replacement=pool[randomIndex(pool.length)];draw.rerolls.push({old,reason:$("#rerollReason").value.trim(),at:new Date().toISOString()});draw.positions[index]=replacement;const participant=state.participants.find(item=>item.id===draw.participantId);if(participant?.assessment?.drawId===draw.id){participant.assessment.status="draft";delete participant.assessment.result;if(participant.scoreSource==="electronic"){delete participant.score;delete participant.gradedAt;delete participant.scoreSource}}saveState();renderAll();showResult(draw);toast("تم تغيير الموضع وإعادة التقييم الإلكتروني إلى مسودة")}}

function renderHistory(){const query=$("#historySearch").value.trim().toLowerCase();const list=[...state.draws].reverse().filter(d=>`${d.name} ${d.sequence} ${d.verification}`.toLowerCase().includes(query));$("#historyTable").closest(".table-wrap").classList.toggle("is-empty",!list.length);$("#historyTable").innerHTML=list.length?list.map(d=>`<tr><td><strong>${d.sequence.toString().padStart(4,"0")}</strong><small>${d.verification}</small></td><td><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.center)}</small></td><td>${d.level} أجزاء</td><td>${d.positions.map(p=>`ج${p.juz}: ${escapeHtml(positionTitle(p))}`).join("<br>")}</td><td>${formatDate(d.createdAt)}</td><td><div class="row-actions"><button class="compact-btn" data-result="${d.id}"><i data-lucide="eye"></i> عرض</button><button class="icon-btn delete-icon" data-delete-draw="${d.id}" title="حذف السحب"><i data-lucide="trash-2"></i></button></div></td></tr>`).join(""):`<tr><td class="table-empty" colspan="6">لا توجد سحوبات مسجلة</td></tr>`;$$(`[data-result]`).forEach(b=>b.onclick=()=>showResult(state.draws.find(d=>d.id===b.dataset.result)));$$(`[data-delete-draw]`).forEach(b=>b.onclick=()=>confirmDeleteDraw(b.dataset.deleteDraw));lucide.createIcons()}
function confirmDeleteDraw(drawId){const draw=state.draws.find(d=>d.id===drawId);if(!draw)return;openModal(`<div class="modal-head"><h2>حذف السحب</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>هل تريد حذف سحب <b>${escapeHtml(draw.name)}</b> رقم ${draw.sequence.toString().padStart(4,"0")}؟</p><p class="form-error">ستصبح مواضع هذا السحب متاحة من جديد. وإذا كانت لهذا المتسابق علامة أو تقييم فسيُحذف ويعود إلى حالة بانتظار السحب.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="deleteDrawNow" class="danger-btn"><i data-lucide="trash-2"></i> حذف السحب</button></div>`);$("#deleteDrawNow").onclick=()=>{state.deletions=state.deletions||[];state.deletions.push({type:"draw",drawId:draw.id,sequence:draw.sequence,name:draw.name,at:new Date().toISOString()});state.draws=state.draws.filter(d=>d.id!==drawId);const participant=state.participants.find(p=>p.id===draw.participantId);if(participant&&!state.draws.some(d=>d.participantId===participant.id)){delete participant.score;delete participant.gradedAt;delete participant.scoreSource;delete participant.assessment}saveState();closeModal();renderAll();toast("تم حذف السحب وتقييمه وتحرير مواضعه")}}
function confirmDeleteAllDraws(){if(!state.draws.length)return toast("لا توجد سحوبات لحذفها");openModal(`<div class="modal-head"><h2>حذف جميع السحوبات</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سيتم حذف <b>${state.draws.length} سحباً</b> وإتاحة جميع مواضعها من جديد.</p><p class="form-error">ستُحذف العلامات والتقييمات الإلكترونية ويعود الجميع إلى حالة بانتظار السحب. لن تُحذف أسماء المتسابقين.</p><label>اكتب <b>حذف السحوبات</b> للتأكيد<input id="deleteAllDrawsConfirm" autocomplete="off"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="deleteAllDrawsNow" class="danger-btn"><i data-lucide="trash-2"></i> حذف الجميع</button></div>`);$("#deleteAllDrawsNow").onclick=()=>{if($("#deleteAllDrawsConfirm").value.trim()!=="حذف السحوبات")return toast("اكتب عبارة التأكيد كما تظهر");state.deletions=state.deletions||[];state.deletions.push({type:"all-draws",count:state.draws.length,drawIds:state.draws.map(draw=>draw.id),at:new Date().toISOString()});state.draws=[];state.participants.forEach(participant=>{delete participant.score;delete participant.gradedAt;delete participant.scoreSource;delete participant.assessment});saveState();closeModal();renderAll();toast("تم حذف جميع السحوبات والتقييمات وإعادة المتسابقين للانتظار")}}
async function exportHistory(){if(!state.draws.length)return toast("لا توجد سحوبات لتصديرها");try{await ensureXlsx()}catch(error){return toast(error.message)}const rows=state.draws.map(d=>({"رقم السحب":String(d.sequence).padStart(4,"0"),"اسم المتسابق":d.name,"رقم الجلوس":d.seat||"","المركز":d.center,"المستوى":`${d.level} أجزاء`,"أرقام الأجزاء المشاركة":(d.eligibleParts||[]).join("، "),"المواضع المختارة":d.positions.map((p,index)=>`${index+1}. الجزء ${p.juz} - ${positionTitle(p)} - صفحة ${p.page}`).join(" | "),"عدد المواضع":d.positions.length,"التاريخ والوقت":formatDate(d.createdAt),"عدد إعادات السحب":d.rerolls?.length||0,"بصمة التحقق":d.verification}));const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(rows);sheet["!cols"]=[{wch:12},{wch:32},{wch:14},{wch:25},{wch:14},{wch:28},{wch:95},{wch:14},{wch:23},{wch:18},{wch:20}];sheet["!views"]=[{rightToLeft:true}];workbook.Workbook={Views:[{RTL:true}]};XLSX.utils.book_append_sheet(workbook,sheet,"جميع السحوبات");XLSX.writeFile(workbook,`سجل-السحوبات-للجميع-${dateStamp()}.xlsx`);toast("تم تنزيل سجل السحوبات بصيغة Excel")}

function formatDuration(ms){
  if(!Number.isFinite(ms)||ms<0)return "—";
  const totalSeconds=Math.round(ms/1000);
  const h=Math.floor(totalSeconds/3600),m=Math.floor((totalSeconds%3600)/60),s=totalSeconds%60;
  return h>0?`${h} س ${String(m).padStart(2,"0")} د ${String(s).padStart(2,"0")} ث`:`${m} د ${String(s).padStart(2,"0")} ث`;
}
function examDurationRows(){
  const committeeById=new Map(cloudCommittees.map(c=>[c.id,c.name]));
  const participantById=new Map(state.participants.map(p=>[p.id,p]));
  return committeeSessions.map(session=>{
    const participant=participantById.get(session.participant_id);
    if(!participant)return null;
    const start=session.started_at?new Date(session.started_at):null;
    const end=session.finalized_at?new Date(session.finalized_at):null;
    const ms=start&&end?end-start:null;
    return {name:participant.name,level:participant.levelName||`${participant.level} أجزاء`,committeeId:session.committee_id||null,committee:committeeById.get(session.committee_id)||"—",ms,statusLabel:ms!=null?formatDuration(ms):start?"قيد الاختبار":"لم يبدأ بعد"};
  }).filter(Boolean);
}
function populateExamDurationCommitteeFilter(rows){
  const select=$("#examDurationCommitteeFilter");if(!select)return;
  const current=select.value;
  const committeeIdsWithRows=new Map(rows.filter(r=>r.committeeId).map(r=>[r.committeeId,r.committee]));
  const availableCommittees=[...committeeIdsWithRows.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]),"ar"));
  select.innerHTML=`<option value="all">اللجنة: الكل</option>`+availableCommittees.map(([id,name])=>`<option value="${id}">${escapeHtml(name)}</option>`).join("");
  select.value=committeeIdsWithRows.has(current)?current:"all";
}
function renderExamDurations(){
  const query=$("#examDurationSearch").value.trim().toLowerCase();
  const allRows=examDurationRows();
  populateExamDurationCommitteeFilter(allRows);
  const committeeFilter=$("#examDurationCommitteeFilter")?.value||"all";
  const rows=allRows.filter(r=>r.name.toLowerCase().includes(query)&&(committeeFilter==="all"||r.committeeId===committeeFilter)).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ar"));
  $("#examDurationTable").closest(".table-wrap").classList.toggle("is-empty",!rows.length);
  $("#examDurationTable").innerHTML=rows.length?rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.level)}</td><td>${escapeHtml(r.committee)}</td><td>${escapeHtml(r.statusLabel)}</td></tr>`).join(""):`<tr><td class="table-empty" colspan="4">لا توجد بيانات اختبار مسجلة عند أي لجنة بعد</td></tr>`;
}
async function exportExamDurations(){
  const rows=examDurationRows();
  if(!rows.length)return toast("لا توجد بيانات اختبار لتصديرها");
  try{await ensureXlsx()}catch(error){return toast(error.message)}
  const data=rows.map(r=>({"الطالب":r.name,"المستوى":r.level,"اللجنة":r.committee,"المدة":r.ms!=null?formatDuration(r.ms):r.statusLabel}));
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(data);sheet["!cols"]=[{wch:32},{wch:26},{wch:24},{wch:16}];sheet["!views"]=[{rightToLeft:true}];workbook.Workbook={Views:[{RTL:true}]};
  XLSX.utils.book_append_sheet(workbook,sheet,"مدة الاختبار");
  XLSX.writeFile(workbook,`مدة-اختبار-المتسابقين-${dateStamp()}.xlsx`);
  toast("تم تنزيل ملف مدة الاختبار");
}

function partUsage(){const counts=Array(30).fill(0);state.draws.forEach(d=>d.positions.forEach(p=>counts[p.juz-1]++));return counts}
function renderAnalytics(){const counts=partUsage(),max=Math.max(1,...counts);$("#distributionChart").innerHTML=counts.map((count,i)=>`<div class="chart-column ${count?"used":""}" style="height:${Math.max(2,count/max*100)}%"><b>${count||""}</b><span>${i+1}</span></div>`).join("");const active=counts.filter(Boolean);if(active.length>1){const avg=active.reduce((a,b)=>a+b,0)/active.length;const spread=Math.max(...active)-Math.min(...active);$("#fairnessLabel").textContent=spread<=Math.max(1,avg*.5)?"توزيع متوازن":"قيد التكوّن"}else $("#fairnessLabel").textContent="لا توجد بيانات كافية"}

let committeeBreakdownCommittees=[],committeeBreakdownGender=null,committeeBreakdownCenters=new Set(),committeeBreakdownCentersSignature=null;
async function renderCommitteeBreakdown(){
  const panel=$("#committeeBreakdownPanel");if(!panel)return;
  const kind=window.CloudCompetition?.context?.kind;
  if(operationMode!=="cloud"||!["admin","supervisor","subAdmin"].includes(kind)){panel.classList.add("hidden");return}
  try{
    if(kind==="subAdmin")committeeBreakdownCommittees=subAdminCommittees.filter(c=>c.active!==false);
    else{cloudCommittees=await window.CloudCompetition.listCommittees();committeeBreakdownCommittees=cloudCommittees.filter(c=>c.active!==false)}
  }catch(error){console.warn("تعذر تحميل بيانات اللجان للتوزيع",error);panel.classList.add("hidden");return}
  if(!committeeBreakdownCommittees.length){panel.classList.add("hidden");return}
  panel.classList.remove("hidden");
  renderCommitteeBreakdownBody();
}
function renderCommitteeBreakdownBody(){
  if(!$("#committeeBreakdownPanel")||$("#committeeBreakdownPanel").classList.contains("hidden"))return;
  const genders=[...new Set(committeeBreakdownCommittees.map(c=>c.responsible_gender).filter(Boolean))].sort((a,b)=>a==="ذكر"?-1:1);
  const genderLabel=$("#committeeBreakdownGenderLabel"),genderSelect=$("#committeeBreakdownGender");
  if(genders.length<2){genderLabel?.classList.add("hidden");committeeBreakdownGender=genders[0]||null}
  else{
    genderLabel?.classList.remove("hidden");
    if(!genders.includes(committeeBreakdownGender))committeeBreakdownGender=genders[0];
    const optionsHtml=genders.map(g=>`<option value="${escapeAttr(g)}" ${g===committeeBreakdownGender?"selected":""}>${g==="أنثى"?"لجان إناث":"لجان ذكور"}</option>`).join("");
    if(genderSelect.innerHTML!==optionsHtml)genderSelect.innerHTML=optionsHtml;
  }
  const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  renderCommitteeBreakdownCenterOptions(centers);
  const committees=committeeBreakdownCommittees.filter(c=>!committeeBreakdownGender||c.responsible_gender===committeeBreakdownGender).sort((a,b)=>a.name.localeCompare(b.name,"ar"));
  const list=$("#committeeBreakdownList");
  if(!committees.length){list.innerHTML=`<p class="committee-alerts-empty">لا توجد لجان مسجّلة لهذا الجنس بعد.</p>`;return}
  const centerFilterActive=committeeBreakdownCenters.size>0;
  const membersByCommittee=new Map();
  state.participants.forEach(p=>{
    if(centerFilterActive&&!committeeBreakdownCenters.has(p.center))return;
    // متسابق امتحنته لجنة فعلياً يُحسب دائماً عليها، حتى لو تغيّرت مستويات اللجان بعدين.
    const historicalCommitteeId=p.assessment?.committee?.id||null;
    const committee=historicalCommitteeId?committeeBreakdownCommittees.find(c=>c.id===historicalCommitteeId):resolveParticipantCommittee(p,committeeBreakdownCommittees).currentCommittee;
    if(!committee)return;
    if(!membersByCommittee.has(committee.id))membersByCommittee.set(committee.id,[]);
    membersByCommittee.get(committee.id).push(p);
  });
  list.innerHTML=committees.map(c=>{
    const members=membersByCommittee.get(c.id)||[];
    const withdrawn=members.filter(p=>p.withdrawn);
    const examined=members.filter(isRealExam);
    const passed=examined.filter(p=>p.score>=PASS_SCORE);
    const failed=examined.filter(p=>p.score<PASS_SCORE);
    const pending=members.length-examined.length-withdrawn.length;
    const rate=passRateOf(members);
    const roles=[c.chairman_name,c.member_name].filter(Boolean).join(" - ");
    const extraRows=(pending>0?`<div class="level-card-row"><span>بانتظار العلامة</span><b>${formatNumber(pending)}</b></div>`:"")+(withdrawn.length>0?`<div class="level-card-row"><span>منسحبون</span><b>${formatNumber(withdrawn.length)}</b></div>`:"");
    return `<details class="committee-breakdown-card"><summary><div class="committee-breakdown-card-name"><b>${escapeHtml(c.name)}</b>${roles?`<small>${escapeHtml(roles)}</small>`:""}</div><div class="committee-breakdown-card-summary"><span>${formatNumber(members.length)} طالب</span><b>${formatPct(rate)}</b></div></summary><div class="committee-breakdown-card-body"><div class="level-card-row"><span>عدد الطلاب</span><b>${formatNumber(members.length)}</b></div><div class="level-card-row"><span>عدد الناجحين</span><b>${formatNumber(passed.length)}</b></div><div class="level-card-row"><span>عدد الراسبين</span><b>${formatNumber(failed.length)}</b></div>${extraRows}<div class="level-card-row"><span>نسبة النجاح</span><b>${formatPct(rate)}</b></div></div><p class="committee-breakdown-note">النسبة والناجحون والراسبون تُحسب فقط من الطلاب الذين أُدخلت علاماتهم حتى الآن (${formatNumber(examined.length)} من ${formatNumber(members.length)}).</p></details>`;
  }).join("");
}
function renderCommitteeBreakdownCenterOptions(centers){
  const list=$("#committeeBreakdownCentersList");if(!list)return;
  const signature=centers.join("|");
  if(signature!==committeeBreakdownCentersSignature){
    committeeBreakdownCentersSignature=signature;
    committeeBreakdownCenters=new Set([...committeeBreakdownCenters].filter(c=>centers.includes(c)));
    list.innerHTML=(centers.length?`<button type="button" class="committee-breakdown-centers-reset">مسح التحديد (عرض الكل)</button>`:"")+
      (centers.length?centers.map(c=>`<label><input type="checkbox" data-breakdown-center="${escapeAttr(c)}" ${committeeBreakdownCenters.has(c)?"checked":""}> ${escapeHtml(c)}</label>`).join(""):`<p class="committee-alerts-empty">لا توجد مراكز مسجّلة بعد.</p>`);
    $$(`[data-breakdown-center]`,list).forEach(input=>input.onchange=()=>{
      if(input.checked)committeeBreakdownCenters.add(input.dataset.breakdownCenter);else committeeBreakdownCenters.delete(input.dataset.breakdownCenter);
      renderCommitteeBreakdownBody();
    });
    const resetBtn=list.querySelector(".committee-breakdown-centers-reset");
    if(resetBtn)resetBtn.onclick=()=>{committeeBreakdownCenters.clear();renderCommitteeBreakdownBody()};
  }
  const summary=$("#committeeBreakdownCentersSummary");
  if(summary){
    const n=committeeBreakdownCenters.size;
    summary.textContent=n===0?"المركز: الكل":n===1?`المركز: ${[...committeeBreakdownCenters][0]}`:`المركز: ${n} مراكز محددة`;
  }
}
function runAudit(){const button=$("#runAuditBtn");button.disabled=true;button.textContent="جاري تنفيذ 100,000 سحب...";setTimeout(()=>{const counts=Array(30).fill(0);for(let i=0;i<100000;i++)counts[randomIndex(30)]++;const expected=100000/30;const maxDeviation=Math.max(...counts.map(n=>Math.abs(n-expected)/expected*100));const score=Math.max(0,100-maxDeviation).toFixed(1);$("#auditScore").textContent=`${score}%`;$("#auditDetail").textContent=`أقصى انحراف عن المتوسط ${maxDeviation.toFixed(2)}%`;button.disabled=false;button.innerHTML=`<i data-lucide="activity"></i> إعادة الفحص`;lucide.createIcons();toast("اكتمل اختبار العشوائية")},50)}

function hydrateSettings(){$("#settingsCompetitionName").value=state.config.competitionName;$("#settingsShowFullQuran").checked=Boolean(state.config.showFullQuranStats);$("#settingsShowDraws").checked=state.config.showDrawsToCommittees!==false;if($("#settingsLiveAutoRefresh"))$("#settingsLiveAutoRefresh").checked=liveAutoRefreshEnabled();renderManagedCenters()}
// قائمة المراكز: DEFAULT_CENTERS ("مجتمع محلي") استثناء وحيد متاح دائماً، زائد المراكز المُدارة من
// الإعدادات (state.config.managedCenters — يمكن إضافتها مسبقاً قبل أي متسابق)، زائد المراكز
// المشتقة فعلياً من بيانات المتسابقين الحاليين (للتوافق مع مراكز قديمة لم تُضَف كمُدارة).
const DEFAULT_CENTERS=["مجتمع محلي"];
function centerOptionsList(){const fromParticipants=state.participants.map(p=>p.center).filter(Boolean);const managed=state.config?.managedCenters||[];return [...new Set([...DEFAULT_CENTERS,...managed,...fromParticipants])].sort((a,b)=>String(a).localeCompare(String(b),"ar"))}
function centerSelectOptions(selectedValue){const list=centerOptionsList();const withCurrent=selectedValue&&!list.includes(selectedValue)?[...list,selectedValue].sort((a,b)=>String(a).localeCompare(String(b),"ar")):list;return `<option value="">اختر مركزاً</option>`+withCurrent.map(c=>`<option value="${escapeAttr(c)}" ${c===selectedValue?"selected":""}>${escapeHtml(c)}</option>`).join("")}
// نفس مصدر مراكز السنوية بالضبط (state.config.managedCenters مشترك بين النموذجين) زائد مراكز
// متسابقي ديوان الحفاظ الحاليين — مركز واحد يُضاف بالإعدادات يظهر بالقائمتين معاً.
function diwanCenterOptionsList(){const fromParticipants=diwanState.participants.map(p=>p.center).filter(Boolean);const managed=state.config?.managedCenters||[];return [...new Set([...DEFAULT_CENTERS,...managed,...fromParticipants])].sort((a,b)=>String(a).localeCompare(String(b),"ar"))}
function diwanCenterSelectOptions(selectedValue){const list=diwanCenterOptionsList();const withCurrent=selectedValue&&!list.includes(selectedValue)?[...list,selectedValue].sort((a,b)=>String(a).localeCompare(String(b),"ar")):list;return `<option value="">اختر مركزاً</option>`+withCurrent.map(c=>`<option value="${escapeAttr(c)}" ${c===selectedValue?"selected":""}>${escapeHtml(c)}</option>`).join("")}
function renderManagedCenters(){
  const list=$("#managedCentersList");if(!list)return;
  const centers=state.config?.managedCenters||[];
  list.innerHTML=centers.length?centers.map(c=>`<div class="committee-row"><span>${escapeHtml(c)}</span><button type="button" class="icon-btn" data-delete-center="${escapeAttr(c)}" title="حذف"><i data-lucide="trash-2"></i></button></div>`).join(""):`<p class="committee-alerts-empty">لا توجد مراكز مُدارة بعد — المراكز المضافة من متسابقين حاليين تظهر بالقائمة تلقائياً دون حاجة لإضافتها هنا.</p>`;
  $$(`[data-delete-center]`).forEach(button=>button.onclick=()=>removeManagedCenter(button.dataset.deleteCenter));
  lucide.createIcons();
}
function addManagedCenter(name){
  const value=String(name||"").trim();if(!value)return toast("اكتب اسم المركز");
  state.config.managedCenters=state.config.managedCenters||[];
  if(state.config.managedCenters.includes(value))return toast("هذا المركز مُضاف مسبقاً");
  state.config.managedCenters.push(value);saveState();renderManagedCenters();toast("تمت إضافة المركز");
}
function removeManagedCenter(name){
  if(!confirm(`حذف مركز "${name}" من القائمة المُدارة؟ يبقى ظاهراً بالقائمة إن كان مستخدَماً حالياً من متسابقين.`))return;
  state.config.managedCenters=(state.config.managedCenters||[]).filter(c=>c!==name);
  saveState();renderManagedCenters();toast("تم حذف المركز من القائمة المُدارة");
}
async function saveSettings(event){event.preventDefault();state.config.competitionName=$("#settingsCompetitionName").value.trim();state.config.showFullQuranStats=$("#settingsShowFullQuran").checked;state.config.showDrawsToCommittees=$("#settingsShowDraws").checked;saveState();$("#topCompetitionName").textContent=state.config.competitionName;renderDashboard();toast("تم حفظ الإعدادات")}
function downloadBackup(){downloadFile(`نسخة-المسابقة-${dateStamp()}.json`,JSON.stringify({schema:2,exportedAt:new Date().toISOString(),data:state},null,2),"application/json")}
async function restoreBackup(event){try{const parsed=JSON.parse(await event.target.files[0].text());if(!parsed.data?.config||!Array.isArray(parsed.data.draws))throw new Error();state=parsed.data;saveState();renderAll();hydrateSettings();toast("تمت استعادة النسخة الاحتياطية")}catch{toast("ملف النسخة الاحتياطية غير صالح")}event.target.value=""}
function confirmNewCycle(){openModal(`<div class="modal-head"><h2>بدء دورة مسابقة جديدة</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سيتم مسح المتسابقين وسجل السحوبات من الجهاز، وستبقى إعدادات الدخول. نزّل نسخة احتياطية أولاً للاحتفاظ بسجل الدورة الحالية.</p><label>اكتب كلمة <b>دورة جديدة</b> للتأكيد<input id="cycleConfirm" autocomplete="off"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="confirmCycleBtn" class="danger-btn">بدء الدورة الجديدة</button></div>`);$("#confirmCycleBtn").onclick=()=>{if($("#cycleConfirm").value.trim()!=="دورة جديدة")return toast("اكتب عبارة التأكيد كما تظهر");state.participants=[];state.draws=[];state.resets.push({at:new Date().toISOString(),by:state.config.adminName});saveState();closeModal();renderAll();navigate("dashboard");toast("بدأت دورة جديدة")}}

function openModal(html,extra=""){document.body.classList.remove("exam-fullscreen");$$("details.row-actions-more[open]").forEach(d=>d.removeAttribute("open"));const wasHidden=$("#modal").classList.contains("hidden");$("#modalContent").className=`modal-card ${extra}`;$("#modalContent").innerHTML=html;$("#modal").classList.remove("hidden");if(wasHidden&&!applyingBrowserHistory&&history.state?.marker===HISTORY_MARKER){const entry={...history.state,modal:true,ui:currentListUi()};history.pushState(entry,"",location.href)}$$(`[data-close]`,$("#modalContent")).forEach(b=>b.onclick=closeModal);lucide.createIcons()}
function closeModal(){stopMemberPositionSync();document.body.classList.remove("exam-fullscreen");$("#modal").classList.add("hidden");$("#modalContent").innerHTML="";if(!applyingBrowserHistory&&history.state?.marker===HISTORY_MARKER&&history.state.modal){const entry={...history.state};delete entry.modal;history.replaceState(entry,"",location.href)}}
function toast(message,duration=2600){const el=$("#toast");el.textContent=message;el.classList.remove("hidden");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add("hidden"),duration)}
function downloadFile(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function csvCell(value){return `"${String(value??"").replaceAll('"','""')}"`}
function dateStamp(){return new Date().toISOString().slice(0,10)}
function formatDate(value){return new Intl.DateTimeFormat("ar-JO",{dateStyle:"medium",timeStyle:"short",numberingSystem:"latn"}).format(new Date(value))}
function formatExamDate(value){return new Intl.DateTimeFormat("ar-JO",{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",numberingSystem:"latn"}).format(new Date(value))}
function formatNumber(value){return new Intl.NumberFormat("ar-JO",{numberingSystem:"latn"}).format(value)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function escapeAttr(value){return escapeHtml(value)}

// ==========================================================================
// اختبار تجريبي — قسم مستقل بالكامل عن السنوية وديوان الحفاظ. بيانات لحظية غير مرتبطة بأي دورة:
// localStorage فقط بلا أي جدول/مزامنة سحابية، حساب دخول مشترك واحد (رمز PIN يضبطه أول من يدخل)
// بدل تسجيل دخول مستقل، وبلا أي منع تكرار مواضع بين متسابقين تجريبيين (غير تنافسي، يُحذف لاحقاً).
// يعيد استخدام محرك التقييم نفسه (calculateAssessment/ASSESSMENT_RULES/emptyPositionAssessment/
// assessmentPositionHtml/updateAssessmentSummary/examTimerRowHtml) حرفياً بلا أي تعديل — تماماً كما
// فعل قسم لجان ديوان الحفاظ أعلاه. عند اعتماد العلامة يُحذف تفصيل السحب والتقييم بالكامل، ويبقى
// فقط {name, level, finalGrade} — طلب صريح: "خلي بس الاسم والمستوى والعلامة".
const TRIAL_COMMITTEE_NAME = "لجنة اختبار مؤقتة";
function defaultTrialState(){return {config:{accessPinHash:null},participants:[],withdrawals:[]}}
function loadTrialState(){try{return {...defaultTrialState(),...JSON.parse(localStorage.getItem(TRIAL_STORAGE_KEY)||"null")}}catch{return defaultTrialState()}}
function saveTrialState(){safeSetItem(TRIAL_STORAGE_KEY,JSON.stringify(trialState))}
function trialAccessGranted(){return sessionStorage.getItem(TRIAL_ACCESS_KEY)==="granted"}
// الرمز اختياري: بلا رمز يُفتح القسم مباشرة، ومن يضع رمزاً يُطلب منه عند كل جلسة. الرمز والبيانات محليان
// (localStorage) لكل جهاز/متصفح على حدة، ولا شيء منها يُرسل لأي خادم ولا يُشارك مع غيره.
function ensureTrialAccessThenRender(){
  if(!trialState.config.accessPinHash)return renderTrialParticipants();
  if(trialAccessGranted())return renderTrialParticipants();
  openTrialUnlockModal();
}
// شاشة مستقلة تماماً عن كل مسارات تسجيل الدخول (لا حساب إدارة ولا وضع محلي) — تُفتح من بوابة
// الدخول الأولى مباشرة، لمشاركة رابط الاختبار التجريبي مع آخرين بلا إعطائهم حساب الإدارة.
function openTrialScreen(){
  ["gatewayScreen","setupScreen","loginScreen","cloudLoginScreen","loadingScreen"].forEach(id=>$("#"+id).classList.add("hidden"));
  $("#committeeApp").classList.add("hidden");
  $("#trialStandaloneScreen").classList.remove("hidden");
  ensureTrialAccessThenRender();
  lucide.createIcons();
}
function closeTrialScreen(){
  closeTrialAssessmentIfOpen();
  $("#trialStandaloneScreen").classList.add("hidden");
  $("#gatewayScreen").classList.remove("hidden");
}
function openTrialSetPinModal(){
  const hasPin=Boolean(trialState.config.accessPinHash);
  openModal(`<div class="modal-head"><h2>${hasPin?"تغيير رمز الدخول":"وضع رمز دخول (اختياري)"}</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">هذا القسم للاختبار التجريبي فقط، ونتائجه لا تُحتسب بأي دورة. ${hasPin?"يمكنك تغيير رمزك، أو ترك الخانة فارغة لإلغاء الرمز فيُفتح القسم بدونه.":"القسم يعمل بدون رمز. إن أردت حمايته، ضع رمز PIN خاصاً بك؛ يُحفظ على هذا الجهاز وهذا المتصفح فقط، فلكل شخص أو جهاز رمزه وبياناته الخاصة."}</p><label>رمز PIN (٤ خانات أو أكثر${hasPin?" — فارغ لإلغاء الرمز":""})<input id="trialSetPin" type="password" inputmode="numeric" minlength="4" autocomplete="off"></label></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button id="trialSetPinBtn" class="primary-btn">حفظ</button></div>`);
  $("#trialSetPinBtn").onclick=async()=>{
    const pin=$("#trialSetPin").value.trim();
    if(!pin){
      if(!hasPin)return closeModal();
      trialState.config.accessPinHash=null;saveTrialState();
      closeModal();toast("تم إلغاء الرمز — يفتح القسم التجريبي بدونه");return;
    }
    if(pin.length<4)return toast("الرمز يجب أن يكون ٤ خانات على الأقل");
    trialState.config.accessPinHash=await hashText(pin);saveTrialState();
    sessionStorage.setItem(TRIAL_ACCESS_KEY,"granted");
    closeModal();toast(hasPin?"تم تغيير رمز الدخول":"تم وضع رمز الدخول — سيُطلب عند فتح القسم لاحقاً");
  };
}
function openTrialUnlockModal(){
  openModal(`<div class="modal-head"><h2>الدخول للقسم التجريبي</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><label>رمز الدخول (PIN)<input id="trialUnlockPin" type="password" inputmode="numeric" autocomplete="off"></label><p id="trialUnlockError" class="form-error hidden">رمز غير صحيح</p></div><div class="modal-actions"><button type="button" id="trialForgotPinBtn" class="secondary-btn">نسيت الرمز؟</button><button type="button" class="secondary-btn" data-close>إلغاء</button><button id="trialUnlockBtn" class="primary-btn">دخول</button></div>`);
  const submit=async()=>{
    const ok=await hashText($("#trialUnlockPin").value)===trialState.config.accessPinHash;
    if(!ok){$("#trialUnlockError").classList.remove("hidden");return}
    sessionStorage.setItem(TRIAL_ACCESS_KEY,"granted");
    closeModal();renderTrialParticipants();
  };
  $("#trialUnlockBtn").onclick=submit;
  // الرمز محلي ومشفّر ولا يمكن استرجاعه: النسيان = إعادة ضبط القسم التجريبي على هذا الجهاز فقط (بيانات تجريبية مؤقتة أصلاً).
  $("#trialForgotPinBtn").onclick=()=>{
    if(!confirm("سيتم مسح بيانات القسم التجريبي على هذا الجهاز فقط (المتسابقون التجريبيون والرمز) لتعيين رمز جديد. بيانات المسابقة الحقيقية لا تتأثر. هل تريد المتابعة؟"))return;
    trialState=defaultTrialState();saveTrialState();sessionStorage.removeItem(TRIAL_ACCESS_KEY);
    closeModal();ensureTrialAccessThenRender();
  };
  $("#trialUnlockPin").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();submit()}});
}
function nextTrialSeat(){return String(trialState.participants.length+1).padStart(3,"0")}
function openTrialParticipantModal(){
  openModal(`<form id="trialParticipantForm"><div class="modal-head"><h2>إضافة متسابق تجريبي</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid"><label>اسم المتسابق<input id="tpName" required></label><label>رقم الجلوس<input id="tpSeat" required value="${escapeAttr(nextTrialSeat())}"></label><label>المستوى<input id="tpLevel" required placeholder="مثال: ١٠ أجزاء"></label></div></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button class="primary-btn" type="submit">حفظ المتسابق</button></div></form>`);
  $("#trialParticipantForm").addEventListener("submit",event=>{
    event.preventDefault();
    const seat=$("#tpSeat").value.trim();
    if(seat&&trialState.participants.some(p=>String(p.seat).trim()===seat))return toast(`رقم الجلوس ${seat} مسجَّل مسبقًا لمتسابق تجريبي آخر`);
    const item={id:uid("TP"),seat,name:$("#tpName").value.trim(),level:$("#tpLevel").value.trim(),committeeName:TRIAL_COMMITTEE_NAME,juzConfig:[],status:"pending",createdAt:new Date().toISOString()};
    trialState.participants.push(item);saveTrialState();closeModal();renderTrialParticipants();
    toast(`تمت إضافة ${item.name} إلى "${TRIAL_COMMITTEE_NAME}"`);
  });
}
function withdrawTrialParticipant(id){
  const index=trialState.participants.findIndex(p=>p.id===id);if(index<0)return;
  const participant=trialState.participants[index];
  if(!confirm(`سحب "${participant.name}" من الاختبار التجريبي؟ سيُحذف بكل تفاصيله فوراً.`))return;
  if(trialExamOpenFor===id){trialWorkingAssessment=null;trialExamOpenFor=null}
  trialState.participants.splice(index,1);
  trialState.withdrawals.push({participantId:participant.id,name:participant.name,at:new Date().toISOString()});
  saveTrialState();renderTrialParticipants();toast("تم سحب المتسابق");
}
// مواضع القرآن (candidates) نفس المخزون العالمي بلا أي استثناء لمواضع مسحوبة لمتسابقين تجريبيين
// آخرين — مقبول لأن البيانات تجريبية وغير تنافسية وتُحذف تفصيلها بعد الاعتماد على أي حال.
function trialAvailableForParts(parts){return candidates.filter(c=>parts.includes(c.juz))}
function drawTrialPositions(juzConfig){
  const positions=[];
  juzConfig.forEach(({juz,positionCount})=>{
    const pool=secureShuffle(trialAvailableForParts([juz]));
    const take=Math.min(positionCount,pool.length);
    if(take<positionCount)toast(`الجزء ${juz}: تتوفر ${take} مواضع فقط، تم سحبها كاملة`);
    positions.push(...pool.slice(0,take));
  });
  return positions.sort((a,b)=>a.juz-b.juz);
}
// إعداد السحب: اختيار أي عدد من الأجزاء، وعدد مواضع حر (بلا حد أقصى) لكل جزء على حدة — مختلف عن
// drawOnePositionPerJuz (موضع واحد ثابت لكل جزء) المستخدمة بديوان الحفاظ والسنوية.
function openTrialDrawConfigurator(participant){
  const config=new Map((participant.juzConfig||[]).map(c=>[c.juz,c.positionCount]));
  const rows=[[1,2,3,4,5,6,7,8,9,10],[11,12,13,14,15,16,17,18,19,20],[21,22,23,24,25,26,27,28,29,30]];
  const cellHtml=j=>{const count=config.get(j)||0;return `<div class="trial-juz-cell ${count>0?"is-selected":""}"><button type="button" class="trial-juz-toggle" data-juz-toggle="${j}">${j}</button>${count>0?`<div class="trial-juz-stepper"><button type="button" data-juz-dec="${j}" aria-label="إنقاص عدد مواضع الجزء ${j}">−</button><b data-juz-count="${j}">${count}</b><button type="button" data-juz-inc="${j}" aria-label="زيادة عدد مواضع الجزء ${j}">+</button></div>`:""}</div>`};
  const render=()=>{
    $("#trialJuzGrid").innerHTML=rows.map(row=>`<div class="diwan-juz-row">${row.map(cellHtml).join("")}</div>`).join("");
    const totalPositions=[...config.values()].reduce((sum,n)=>sum+n,0);
    $("#trialJuzSummary").textContent=`${config.size} جزء مختار · ${totalPositions} موضعاً بالمجموع`;
    wire();lucide.createIcons();
  };
  const wire=()=>{
    $$(`[data-juz-toggle]`).forEach(button=>button.onclick=()=>{const juz=Number(button.dataset.juzToggle);if(config.has(juz))config.delete(juz);else config.set(juz,1);render()});
    $$(`[data-juz-inc]`).forEach(button=>button.onclick=()=>{const juz=Number(button.dataset.juzInc);config.set(juz,(config.get(juz)||0)+1);render()});
    $$(`[data-juz-dec]`).forEach(button=>button.onclick=()=>{const juz=Number(button.dataset.juzDec);const next=(config.get(juz)||0)-1;if(next<=0)config.delete(juz);else config.set(juz,next);render()});
  };
  openModal(`<div class="modal-head"><h2>إعداد سحب تجريبي — ${escapeHtml(participant.name)}</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">اختر الأجزاء المطلوبة، وحدّد عدد المواضع داخل كل جزء (بلا حد أقصى) — يمكن اختيار أكثر من موضع بنفس الجزء.</p><div id="trialJuzGrid" class="diwan-juz-grid"></div><div class="trial-unify-row"><label for="trialUnifyCount">توحيد عدد المواضع لكل الأجزاء المختارة</label><input id="trialUnifyCount" type="number" inputmode="numeric" min="1" step="1" placeholder="مثال: 3"><button type="button" id="trialUnifyApply" class="secondary-btn">تطبيق</button></div><p id="trialJuzSummary" class="field-help"></p><p id="trialJuzError" class="form-error hidden"></p></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button id="confirmTrialDraw" class="primary-btn"><i data-lucide="sparkles"></i> تنفيذ السحب</button></div>`);
  render();
  const applyUnify=()=>{
    const error=$("#trialJuzError"),count=Math.floor(Number($("#trialUnifyCount").value));
    if(!config.size){error.textContent="اختر الأجزاء أولاً ثم طبّق العدد الموحّد";return error.classList.remove("hidden")}
    if(!Number.isFinite(count)||count<1){error.textContent="اكتب عدد مواضع صحيحاً (١ فأكثر)";return error.classList.remove("hidden")}
    error.classList.add("hidden");
    [...config.keys()].forEach(juz=>config.set(juz,count));render();
  };
  $("#trialUnifyApply").onclick=applyUnify;
  $("#trialUnifyCount").onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();applyUnify()}};
  $("#confirmTrialDraw").onclick=async()=>{
    const button=$("#confirmTrialDraw"),error=$("#trialJuzError");
    if(!config.size){error.textContent="اختر جزءاً واحداً على الأقل";return error.classList.remove("hidden")}
    button.disabled=true;button.textContent="جارٍ السحب...";
    try{
      await ensureQuranReady();
      const juzConfig=[...config.entries()].map(([juz,positionCount])=>({juz,positionCount})).sort((a,b)=>a.juz-b.juz);
      const positions=drawTrialPositions(juzConfig);
      if(!positions.length)throw new Error("لا توجد مواضع متاحة ضمن الأجزاء المختارة");
      participant.juzConfig=juzConfig;
      participant.draw={positions,createdAt:new Date().toISOString()};
      participant.status="drawn";
      delete participant.assessment;
      saveTrialState();closeModal();renderTrialParticipants();
      openTrialElectronicAssessment(participant);
    }catch(drawError){button.disabled=false;button.textContent="تنفيذ السحب";error.textContent=drawError.message;error.classList.remove("hidden")}
  };
  lucide.createIcons();
}
async function trialReplacePosition(participant,index){
  const draw=participant.draw,old=draw.positions[index];
  const used=new Set(draw.positions.map(p=>p.id));
  const pool=trialAvailableForParts([old.juz]).filter(p=>!used.has(p.id));
  if(!pool.length)return toast("لا يوجد موضع بديل متاح ضمن نفس الجزء");
  const replacement=pool[randomIndex(pool.length)];
  draw.positions[index]=replacement;
  const entry=trialWorkingAssessment.positions[index];
  entry.positionId=replacement.id;entry.memorization=0;entry.language=0;entry.tajweed=0;entry.hesitation=0;
  entry.positionChange=(Number(entry.positionChange)||0)+1;entry.note="";entry.completed=false;
}
// نسخة مبسّطة من openElectronicAssessment: بلا رئيس/عضو، بلا جلسة سحابية، بلا حفظ تلقائي — تُكتب
// بالذاكرة فقط عبر trialWorkingAssessment، ولا تُحفظ إلى trialState/localStorage إلا عند الاعتماد
// (أو تُهمَل بالكامل عند المغادرة لقسم آخر، راجع closeTrialAssessmentIfOpen بـnavigate()).
async function openTrialElectronicAssessment(participant){
  stopExamTimerInterval();
  const draw=participant.draw;if(!draw)return toast("لم يتم تنفيذ السحب لهذا المتسابق بعد");
  await ensureQuranReady();
  trialExamOpenFor=participant.id;
  trialWorkingAssessment=(participant.assessment&&participant.assessment.drawCreatedAt===draw.createdAt)?participant.assessment:{positions:draw.positions.map(emptyPositionAssessment),drawCreatedAt:draw.createdAt};
  participant.assessment=trialWorkingAssessment;
  let currentIndex=0,quranPageOffsets=draw.positions.map(()=>0);
  openModal(`<div class="examiner-header"><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button><div><span>اختبار تجريبي — ${escapeHtml(participant.name)}</span><small>${escapeHtml(participant.level||"")} · ${escapeHtml(TRIAL_COMMITTEE_NAME)}</small></div><div class="examiner-score"><small>العلامة</small><b id="assessmentLiveScore">100</b></div></div><div id="assessmentExamScreen" class="examiner-screen"><nav id="positionStepper" class="position-stepper">${draw.positions.map((_,index)=>`<button type="button" data-position-step="${index}">${index+1}</button>`).join("")}</nav><main id="activeAssessmentPosition"></main><div class="examiner-quickbar"><div><span>إجمالي الخصم</span><b id="assessmentTotalDeduction">0</b></div></div><div class="examiner-navigation"><button type="button" id="previousAssessmentPosition" class="secondary-btn"><i data-lucide="arrow-right"></i> السابق</button><button type="button" id="finishTrialAssessmentBtn" class="primary-btn"><i data-lucide="badge-check"></i> اعتماد العلامة النهائية</button><button type="button" id="nextAssessmentPosition" class="primary-btn">التالي <i data-lucide="arrow-left"></i></button></div><div id="assessmentSummaryRows" class="hidden"></div></div>`,"examiner-mode-modal");
  document.body.classList.add("exam-fullscreen");
  const renderPosition=()=>{
    resetExamTimerState();
    $("#activeAssessmentPosition").innerHTML=assessmentPositionHtml(trialWorkingAssessment.positions[currentIndex],draw.positions[currentIndex],currentIndex,draw.positions.length,0,quranPageOffsets[currentIndex],0,false);preloadNextQuranImage(draw,currentIndex);
    $$(`[data-position-step]`).forEach(button=>{const index=Number(button.dataset.positionStep);button.classList.toggle("active",index===currentIndex);button.classList.toggle("is-done",Boolean(trialWorkingAssessment.positions[index].completed))});
    $("#previousAssessmentPosition").disabled=currentIndex===0;$("#nextAssessmentPosition").disabled=currentIndex===draw.positions.length-1;
    lucide.createIcons();
  };
  const refresh=()=>{renderPosition();updateAssessmentSummary(trialWorkingAssessment);const finish=$("#finishFailedAssessment");if(finish)finish.onclick=()=>finalizeTrialAssessment(participant)};
  $("#assessmentExamScreen").addEventListener("click",event=>{
    const timerButton=event.target.closest("[data-exam-timer-action]");
    if(timerButton){const action=timerButton.dataset.examTimerAction;if(action==="start")startExamTimer();else if(action==="stop")stopExamTimerInterval();else if(action==="zero")zeroExamTimer();else if(action==="bell")playExamTimerBell();return}
    const quranNavButton=event.target.closest("[data-quran-page-nav]");
    if(quranNavButton){if(quranNavButton.disabled)return;const delta=Number(quranNavButton.dataset.quranPageNav),pageCount=new Set(drawPositionSegments(draw.positions[currentIndex]).map(segment=>segment.page)).size;quranPageOffsets[currentIndex]=Math.min(Math.max(0,(quranPageOffsets[currentIndex]||0)+delta),Math.max(0,pageCount-1));return renderPosition()}
    const completeButton=event.target.closest("[data-toggle-complete]");
    if(completeButton){const index=Number(completeButton.dataset.toggleComplete);trialWorkingAssessment.positions[index].completed=!trialWorkingAssessment.positions[index].completed;return refresh()}
    const actionButton=event.target.closest("[data-assess-delta]");
    if(actionButton){
      const index=Number(actionButton.dataset.assessIndex),type=actionButton.dataset.assessType,delta=Number(actionButton.dataset.assessDelta);
      if(type==="positionChange"&&delta>0){actionButton.disabled=true;trialReplacePosition(participant,index).then(()=>{currentIndex=index;refresh()}).finally(()=>{if(actionButton)actionButton.disabled=false});return}
      const position=trialWorkingAssessment.positions[index],before=Number(position[type])||0,after=Math.max(0,before+delta);
      if(after===before)return;
      if(type==="tajweed"&&delta>0&&tajweedTotalOf(trialWorkingAssessment)>=TAJWEED_ERROR_CAP){toast("تم بلوغ الحد الأقصى لخصم التجويد — سجّل الباقي ضمن التردد");return}
      position[type]=after;return refresh();
    }
    const step=event.target.closest("[data-position-step]");
    if(step){currentIndex=Number(step.dataset.positionStep);return renderPosition()}
  });
  $("#assessmentExamScreen").addEventListener("input",event=>{const note=event.target.closest("[data-assess-note]");if(!note)return;trialWorkingAssessment.positions[Number(note.dataset.assessNote)].note=note.value});
  $("#previousAssessmentPosition").onclick=()=>{if(currentIndex>0){currentIndex--;renderPosition()}};
  $("#nextAssessmentPosition").onclick=()=>{if(currentIndex<draw.positions.length-1){currentIndex++;renderPosition()}};
  $("#finishTrialAssessmentBtn").onclick=()=>finalizeTrialAssessment(participant);
  refresh();
}
// اعتماد العلامة: يحسب النتيجة النهائية ثم يحذف فوراً كل تفصيل السحب/التقييم (أي موضع طُرح، أين
// أخطأ) ولا يُبقي إلا {name, level, finalGrade} — تنفيذ حرفي لطلب "خلي بس الاسم والمستوى والعلامة".
function finalizeTrialAssessment(participant){
  const result=calculateAssessment(trialWorkingAssessment);
  if(!confirm(`اعتماد العلامة النهائية (${formatAssessmentNumber(result.score)}) لـ${participant.name}؟ سيُحذف تفصيل الأخطاء والمواضع فور الاعتماد، ويبقى الاسم والمستوى والعلامة فقط.`))return;
  participant.finalGrade=result.score;
  participant.gradedAt=new Date().toISOString();
  participant.status="graded";
  delete participant.draw;delete participant.assessment;delete participant.juzConfig;
  trialWorkingAssessment=null;trialExamOpenFor=null;
  saveTrialState();closeModal();renderTrialParticipants();
  toast(`تم اعتماد علامة ${participant.name}: ${formatAssessmentNumber(result.score)}`);
}
// يُستدعى من navigate() عند مغادرة القسم التجريبي لأي شاشة أخرى — يُهمَل التقييم غير المعتمد بلا أي
// تأكيد (بيانات لحظية بالتصميم، خلافاً للاختبار الحقيقي الذي يُبقي مسودته تلقائياً دوماً).
function closeTrialAssessmentIfOpen(){
  if(!trialExamOpenFor)return;
  const participant=trialState.participants.find(p=>p.id===trialExamOpenFor);
  if(participant&&participant.status==="drawn")delete participant.assessment;
  trialWorkingAssessment=null;trialExamOpenFor=null;
  closeModal();
}
function trialParticipantStatusLabel(status){return {pending:"بانتظار السحب",drawn:"تم السحب — قيد الاختبار",graded:"معتمدة"}[status]||status}
function renderTrialParticipants(){
  if(!$("#trialParticipantsTable"))return;
  const query=($("#trialParticipantSearch")?.value||"").trim().toLowerCase();
  const list=trialState.participants.filter(p=>`${p.name} ${p.seat}`.toLowerCase().includes(query));
  if($("#trialParticipantCount"))$("#trialParticipantCount").textContent=`${formatNumber(list.length)} متسابق`;
  $("#trialParticipantsTable").innerHTML=list.length?list.map(participant=>{
    const grade=participant.status==="graded"?formatAssessmentNumber(participant.finalGrade):"—";
    const actions=participant.status==="graded"
      ?`<button type="button" class="icon-btn" data-trial-withdraw="${participant.id}" title="حذف السجل"><i data-lucide="trash-2"></i></button>`
      :participant.status==="pending"
      ?`<button type="button" class="secondary-btn" data-trial-draw="${participant.id}">سحب الأجزاء والمواضع</button><button type="button" class="icon-btn" data-trial-withdraw="${participant.id}" title="سحب المتسابق"><i data-lucide="user-minus"></i></button>`
      :`<button type="button" class="secondary-btn" data-trial-continue="${participant.id}">متابعة/إنهاء الاختبار</button><button type="button" class="icon-btn" data-trial-withdraw="${participant.id}" title="سحب المتسابق"><i data-lucide="user-minus"></i></button>`;
    return `<tr><td>${escapeHtml(participant.seat)}</td><td>${escapeHtml(participant.name)}</td><td>${escapeHtml(participant.level||"-")}</td><td>${escapeHtml(TRIAL_COMMITTEE_NAME)}</td><td><span class="state">${trialParticipantStatusLabel(participant.status)}</span></td><td>${grade}</td><td class="table-actions">${actions}</td></tr>`;
  }).join(""):`<tr><td colspan="7" class="table-empty">لا يوجد متسابقون بعد — أضف متسابقاً تجريبياً للبدء</td></tr>`;
  $$(`[data-trial-draw]`).forEach(button=>button.onclick=()=>{const p=trialState.participants.find(x=>x.id===button.dataset.trialDraw);if(p)openTrialDrawConfigurator(p)});
  $$(`[data-trial-continue]`).forEach(button=>button.onclick=()=>{const p=trialState.participants.find(x=>x.id===button.dataset.trialContinue);if(p)openTrialElectronicAssessment(p)});
  $$(`[data-trial-withdraw]`).forEach(button=>button.onclick=()=>withdrawTrialParticipant(button.dataset.trialWithdraw));
  lucide.createIcons();
}
