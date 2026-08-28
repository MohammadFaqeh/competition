"use strict";

const CLOUD_STORAGE_KEY = "annualQuranCompetition.v2";
const LOCAL_STORAGE_KEY = "quranCompetition.localBranch.v1";
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
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];

let operationMode="gateway",cloudStartup=null,cloudStartupPromise=null;
let state = loadState();
const OTHER_POOL_KEY = "quranCompetition.otherPool.v1";
let otherState = loadOtherState();
let candidates = [];
let integrity = {valid:false, errors:[], verseCount:0};
let cloudEnabled=false;
let committeeSessions=[];
let activeCloudSession=null;
let committeeAutoRefreshTimer=null,committeeRefreshBusy=false;
let adminAutoRefreshTimer=null,adminRefreshBusy=false;
let memberPositionSyncTimer=null;
function stopMemberPositionSync(){if(memberPositionSyncTimer)clearInterval(memberPositionSyncTimer);memberPositionSyncTimer=null}
let idleLogoutTimer=null;
let clockTimer=null;
function updateClock(){const el=$("#todayTime");if(el)el.textContent=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})}
const LAST_ADMIN_VIEW_KEY="competition-last-admin-view";
const ACTIVE_MODE_KEY="competition-active-mode";
const LOCAL_ACCESS_KEY="competition-local-access";
const COMMITTEE_ALERTS_KEY="competition-committee-alerts";
const ASSESSMENT_DRAFT_PREFIX="competition-assessment-draft-";
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
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
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
function ensureQuranReady(){
  if(integrity.valid&&candidates.length)return Promise.resolve(candidates);
  if(quranReadyPromise)return quranReadyPromise;
  quranReadyPromise=(async()=>{
    const [quranData,loadedLines]=await Promise.all([
      loadQuranDataResilient(),
      fetchJsonWithDeviceCache("data/quran-lines.json",value=>Boolean(value?.verses)&&Object.keys(value.verses).length===6236,"تعذر تحميل بيانات أسطر المصحف")
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
function prewarmQuranData(){if(integrity.valid&&candidates.length)return;setTimeout(()=>ensureQuranReady().catch(error=>console.warn("Quran data preloading will be retried when needed",error)),0)}

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
      if(operationMode==="gateway")showScreen("gatewayScreen");
    }
  }catch(error){
    $("#loadingScreen").classList.remove("hidden");
    $("#loadingScreen").innerHTML = `<div class="brand-mark"><span>تنبيه</span></div><strong>تعذر تشغيل المنصة</strong><p>${escapeHtml(error.message)}</p>`;
  }
}

function defaultState(){return {config:null,participants:[],draws:[],resets:[],deletions:[]}}
function activeStorageKey(){return operationMode==="local"?LOCAL_STORAGE_KEY:CLOUD_STORAGE_KEY}
function loadState(key=activeStorageKey()){try{return {...defaultState(),...JSON.parse(localStorage.getItem(key)||"null")}}catch{return defaultState()}}
function saveState(){localStorage.setItem(activeStorageKey(),JSON.stringify(state));if(operationMode==="cloud"&&cloudEnabled){const kind=window.CloudCompetition.context?.kind;if(kind==="subAdmin")window.CloudCompetition.queueSubAdminParticipantsSave(state.participants,error=>toast(`تعذر مزامنة البيانات: ${error.message}`));else if(kind==="supervisor")window.CloudCompetition.queueSupervisorSave(state,error=>toast(`تعذر مزامنة البيانات: ${error.message}`));else window.CloudCompetition.queueStateSave(state,error=>toast(`تعذر مزامنة بيانات الإدارة: ${error.message}`))}}
function defaultOtherState(){return {participants:[],draws:[]}}
function loadOtherState(){try{return {...defaultOtherState(),...JSON.parse(localStorage.getItem(OTHER_POOL_KEY)||"null")}}catch{return defaultOtherState()}}
function saveOtherState(){localStorage.setItem(OTHER_POOL_KEY,JSON.stringify(otherState))}
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
    for(let i=0;i<verses.length;i++){
      const start=verses[i];
      const [chapter,startAyah]=start.verse_key.split(":").map(Number);
      const shortSurah=juz===30&&chapter>=93&&chapterCounts.get(chapter)<=20;
      if(startAyah>1&&startAyah<=5)continue;
      if(shortSurah&&startAyah!==1)continue;
      let bestCandidate=null;
      const occupiedLines=new Map();
      let words=0;
      for(let end=i;end<verses.length;end++){
        const finish=verses[end],[endChapter,endAyah]=finish.verse_key.split(":").map(Number);
        addVerseLines(occupiedLines,finish);
        words+=wordCount(finish.text_uthmani);
        const lineCount=countOccupiedLines(occupiedLines);
        if(lineCount>8)break;
        if(shortSurah&&endAyah!==chapterCounts.get(endChapter))continue;
        if(lineCount<8)continue;
        const segments=occupiedLineSegments(occupiedLines);
        bestCandidate={id:`${juz}-${start.verse_key}-${finish.verse_key}`,juz,chapter,chapterName:chapterMap.get(chapter),endChapter,endChapterName:chapterMap.get(endChapter),startAyah,endAyah,startId:start.id,endId:finish.id,page:start.layoutPage,endPage:finish.layoutPage,words,lineCount,lineModel:"occupied-v2",lineSegments:segments,startKey:start.verse_key,endKey:finish.verse_key};
      }
      if(bestCandidate)result.push(bestCandidate);
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
  $("#deleteAllParticipantsBtn").addEventListener("click",confirmDeleteAllParticipants);
  $("#exportResultsBtn").addEventListener("click",exportFinalResults);
  $("#exportUnifiedResultsBtn")?.addEventListener("click",exportUnifiedResults);
  $("#bulkPdfBtn")?.addEventListener("click",openBulkPdfDialog);
  $("#bulkDrawPdfBtn")?.addEventListener("click",openBulkDrawPdfDialog);
  $("#associationCardBtn")?.addEventListener("click",openAssociationCardDialog);
  $("#participantSearch").addEventListener("input",renderParticipants);
  $("#participantFilter").addEventListener("change",renderParticipants);
  $("#participantGenderFilter").addEventListener("change",renderParticipants);
  $("#participantCenterFilter").addEventListener("change",renderParticipants);
  $("#participantLevelFilter").addEventListener("change",renderParticipants);
  $("#csvInput").addEventListener("change",importCsv);
  $("#addOtherParticipantBtn").addEventListener("click",()=>openOtherParticipantModal());
  $("#otherParticipantSearch").addEventListener("input",renderOtherParticipants);
  $("#drawParticipant").addEventListener("change",loadParticipantIntoDraw);
  $("#drawLevel").addEventListener("change",levelChanged);
  $("#drawQuestionCount").addEventListener("input",updateAvailability);
  $("#drawForm").addEventListener("submit",performDraw);
  $("#drawPartsEditBtn").addEventListener("click",openDrawPartsEditor);
  $("#drawPartsSaveBtn").addEventListener("click",saveDrawParticipantParts);
  $("#drawPartsCancelBtn").addEventListener("click",closeDrawPartsEditor);
  $("#historySearch").addEventListener("input",renderHistory);
  $("#exportHistoryBtn").addEventListener("click",exportHistory);
  $("#examDurationSearch").addEventListener("input",renderExamDurations);
  $("#exportExamDurationsBtn").addEventListener("click",exportExamDurations);
  $("#deleteAllDrawsBtn").addEventListener("click",confirmDeleteAllDraws);
  $("#runAuditBtn").addEventListener("click",runAudit);
  $("#settingsForm").addEventListener("submit",saveSettings);
  $("#renameCenterForm").addEventListener("submit",renameCenter);
  $("#newCenterForm")?.addEventListener("submit",addManagedCenter);
  $("#fixLegacyLevelsBtn").addEventListener("click",fixLegacyLevelNames);
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
  $("#refreshCommitteeBtn").addEventListener("click",renderCommitteeWorkspace);
  $("#committeeSearch").addEventListener("input",renderCommitteeStudents);
  $("#committeeStatusFilter").addEventListener("change",renderCommitteeStudents);
  $("#committeeCenterFilter").addEventListener("change",renderCommitteeStudents);
  $("#clearCommitteeAlertsBtn").addEventListener("click",clearCommitteeAlerts);
  $("#committeeAccountForm").addEventListener("submit",linkCommitteeAccount);
  $("#cancelCommitteeEdit").addEventListener("click",resetCommitteeForm);
  $("#subAdminAccountForm").addEventListener("submit",saveSubAdminAccount);
  $("#cancelSubAdminEdit").addEventListener("click",resetSubAdminForm);
  $("#supervisorAccountForm").addEventListener("submit",saveSupervisorAccount);
  $("#cancelSupervisorEdit").addEventListener("click",resetSupervisorForm);
  $("#syncCloudBtn").addEventListener("click",refreshAdminCloudResults);
  $("#refreshFinalEditAuditBtn").addEventListener("click",renderFinalEditAudit);
  $("#refreshActivityLogBtn").addEventListener("click",renderActivityLog);
  $("#activityLogFilter").addEventListener("change",renderActivityLogList);
  $("#saveAutoBackupBtn").addEventListener("click",saveAutoBackupSettings);
  $("#approveAllDrBtn").addEventListener("click",approveAllDrRequests);
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
  localStorage.setItem(COLOR_MODE_KEY,mode);
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
function toggleSidebar(){if(window.innerWidth<=MOBILE_BREAKPOINT){$(".sidebar").classList.toggle("open");return}const collapsed=$("#app").classList.toggle("sidebar-collapsed");localStorage.setItem(SIDEBAR_COLLAPSED_KEY,collapsed?"1":"0")}
function restoreSidebarState(){if(window.innerWidth<=MOBILE_BREAKPOINT)return;$("#app").classList.toggle("sidebar-collapsed",localStorage.getItem(SIDEBAR_COLLAPSED_KEY)==="1")}
function applyModeBranding(){const local=operationMode==="local";$("#setupBrandLine").textContent=local?"استخدام محلي مستقل · بياناتك تبقى على هذا الجهاز":"جمعية المحافظة على القرآن الكريم | فرع الكورة";$("#localLoginBrandLine").textContent=local?"استخدام محلي مستقل · لا يتم إرسال البيانات":"جمعية المحافظة على القرآن الكريم | فرع الكورة";$("#sidebarBrandTitle").textContent=local?"منصة إدارة المسابقات القرآنية":"جمعية المحافظة على القرآن الكريم";$("#sidebarBrandSubtitle").textContent=local?"وضع محلي مستقل":"فرع الكورة | المسابقة السنوية"}
function initializeCloud(){if(cloudStartup)return Promise.resolve(cloudStartup);if(cloudStartupPromise)return cloudStartupPromise;cloudStartupPromise=window.CloudCompetition.init().then(status=>{cloudEnabled=status.enabled;cloudStartup=status;return status}).catch(error=>{console.warn("Cloud initialization failed",error);cloudStartup={enabled:false,context:null,error};return cloudStartup});return cloudStartupPromise}
function returnToGateway(){sessionStorage.removeItem(ACTIVE_MODE_KEY);sessionStorage.removeItem(LOCAL_ACCESS_KEY);operationMode="gateway";$("#app").classList.add("hidden");showScreen("gatewayScreen");recordBrowserRoute({surface:"gateway"})}
async function openKouraMode(){operationMode="cloud";sessionStorage.setItem(ACTIVE_MODE_KEY,"cloud");state=loadState(CLOUD_STORAGE_KEY);applyModeBranding();$("#app").classList.remove("local-branch-app");const startup=await initializeCloud();if(!startup?.enabled){sessionStorage.removeItem(ACTIVE_MODE_KEY);return toast("تعذر الاتصال بنظام فرع الكورة حالياً")}cloudEnabled=true;if(startup.context)return enterCloudContext(startup.context);showScreen("cloudLoginScreen")}
function openLocalMode(){operationMode="local";sessionStorage.setItem(ACTIVE_MODE_KEY,"local");sessionStorage.removeItem(LOCAL_ACCESS_KEY);state=loadState(LOCAL_STORAGE_KEY);applyModeBranding();$("#app").classList.add("local-branch-app");if(!state.config){$("#setupCompetitionName").value="مسابقة تحفيظ القرآن الكريم";$("#setupAdminName").value="";showScreen("setupScreen")}else{$("#loginCompetitionName").textContent=state.config.competitionName;showScreen("loginScreen")}}
function logout(){if(operationMode==="cloud")return cloudLogout();sessionStorage.removeItem(ACTIVE_MODE_KEY);sessionStorage.removeItem(LOCAL_ACCESS_KEY);$("#app").classList.add("hidden");showScreen("gatewayScreen")}
function showScreen(id){["gatewayScreen","setupScreen","loginScreen","cloudLoginScreen"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));$("#committeeApp").classList.toggle("hidden",id!=="committeeApp");if(id)dockColorModeToggle(false);if(id&&!applyingBrowserHistory)recordBrowserRoute({surface:id==="committeeApp"?"committee":"screen",screen:id})}
function currentViewKey(){return operationMode==="local"?`${LAST_ADMIN_VIEW_KEY}.local`:`${LAST_ADMIN_VIEW_KEY}.cloud`}
function currentListUi(){return {participantSearch:$("#participantSearch")?.value||"",participantFilter:$("#participantFilter")?.value||"all",participantGenderFilter:$("#participantGenderFilter")?.value||"all",historySearch:$("#historySearch")?.value||"",committeeSearch:$("#committeeSearch")?.value||"",committeeStatusFilter:$("#committeeStatusFilter")?.value||"all",scrollY:Math.max(0,window.scrollY||0)}}
function restoreListControls(ui={}){for(const [id,value] of Object.entries(ui)){const element=$("#"+id);if(element&&id!=="scrollY")element.value=value}}
function recordBrowserRoute(route,{replace=false}={}){if(applyingBrowserHistory)return;const current=history.state,same=current?.marker===HISTORY_MARKER&&current.surface===route.surface&&current.view===(route.view||current.view)&&current.screen===(route.screen||current.screen);const entry={marker:HISTORY_MARKER,mode:operationMode,...route,ui:currentListUi()};const url=new URL(location.href);url.hash=route.surface==="admin"?`admin/${route.view||"dashboard"}`:route.surface==="committee"?"committee":route.surface==="gateway"?"gateway":route.screen||"gateway";((replace||same)?history.replaceState:history.pushState).call(history,entry,"",url)}
function hasUnfinishedAssessment(){if(!activeCloudSession)return false;const participant=state.participants.find(item=>item.id===activeCloudSession.participant_id);return Boolean(participant?.assessment&&participant.assessment.status!=="final")}
function initializeBrowserNavigation(){if(history.state?.marker!==HISTORY_MARKER)recordBrowserRoute({surface:"gateway"},{replace:true});window.addEventListener("popstate",event=>{const target=event.state;if(!target||target.marker!==HISTORY_MARKER){history.forward();return}if(hasUnfinishedAssessment()&&!confirm("التقييم الحالي غير معتمد بعد، لكنه محفوظ كمسودة. هل تريد مغادرة شاشة التقييم؟")){history.forward();return}applyingBrowserHistory=true;try{closeModal();restoreListControls(target.ui);operationMode=target.mode||operationMode;if(target.surface==="admin"){showScreen("");$("#app").classList.remove("hidden");dockColorModeToggle(true);navigate(target.view||"dashboard",{historyMode:"none",ui:target.ui})}else if(target.surface==="committee"){$("#app").classList.add("hidden");showScreen("committeeApp");renderCommitteeStudents();requestAnimationFrame(()=>window.scrollTo(0,target.ui?.scrollY||0))}else{$("#app").classList.add("hidden");showScreen(target.surface==="gateway"?"gatewayScreen":target.screen||"gatewayScreen");requestAnimationFrame(()=>window.scrollTo(0,target.ui?.scrollY||0))}}finally{applyingBrowserHistory=false}});let routeTimer;document.addEventListener("input",event=>{if(!["participantSearch","historySearch","committeeSearch"].includes(event.target.id))return;clearTimeout(routeTimer);routeTimer=setTimeout(()=>{if(history.state?.marker===HISTORY_MARKER)recordBrowserRoute(history.state,{replace:true})},150)});document.addEventListener("change",event=>{if(!["participantFilter","committeeStatusFilter"].includes(event.target.id))return;if(history.state?.marker===HISTORY_MARKER)recordBrowserRoute(history.state,{replace:true})})}
function showApp(){showScreen("");$("#app").classList.remove("hidden");dockColorModeToggle(true);restoreSidebarState();$("#app").classList.toggle("local-branch-app",operationMode==="local");$("#localModeNotice").classList.toggle("hidden",operationMode!=="local");$("#topCompetitionName").textContent=state.config.competitionName;$("#todayText").textContent=new Intl.DateTimeFormat("ar-JO",{weekday:"long",day:"numeric",month:"long",year:"numeric",numberingSystem:"latn"}).format(new Date());updateClock();if(!clockTimer)clockTimer=setInterval(updateClock,1000);hydrateSettings();restoreListControls();renderAll();const savedRoute=history.state?.marker===HISTORY_MARKER&&history.state.surface==="admin"?history.state:null;navigate(savedRoute?.view||localStorage.getItem(currentViewKey())||"dashboard",{historyMode:savedRoute?"replace":"push",ui:savedRoute?.ui});if(operationMode==="cloud"&&cloudEnabled&&["admin","supervisor"].includes(window.CloudCompetition.context?.profile.role)){setupCloudAdminPanel();startAdminAutoRefresh()}else stopAdminAutoRefresh();prewarmQuranData()}
async function cloudLogin(event){event.preventDefault();const button=event.submitter,errorBox=$("#cloudLoginError");button.disabled=true;errorBox.classList.add("hidden");try{const context=await window.CloudCompetition.signInAdmin($("#cloudLoginEmail").value.trim(),$("#cloudLoginPassword").value);$("#cloudLoginPassword").value="";await enterCloudContext(context)}catch(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden")}finally{button.disabled=false}}
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
async function committeeLogin(event){event.preventDefault();const button=event.submitter,errorBox=$("#committeeLoginError");button.disabled=true;errorBox.classList.add("hidden");try{const context=await window.CloudCompetition.signInCommittee($("#committeeLoginCode").value.trim(),$("#committeeLoginPin").value);$("#committeeLoginPin").value="";await enterCloudContext(context)}catch(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden")}finally{button.disabled=false}}
function showCloudLoginMode(mode){const committee=mode==="committee",admin=mode==="admin",subAdmin=mode==="subAdmin";$("#committeeLoginForm").classList.toggle("hidden",!committee);$(".login-mode-links").classList.toggle("hidden",!committee);$("#cloudLoginForm").classList.toggle("hidden",!admin);$("#subAdminLoginForm").classList.toggle("hidden",!subAdmin);$("#cloudLoginTitle").textContent=admin?"دخول إدارة المسابقة":subAdmin?"دخول مسؤول فرعي":"دخول لجنة الاختبار";$(admin?"#cloudLoginEmail":subAdmin?"#subAdminLoginCode":"#committeeLoginCode").focus()}
async function subAdminLogin(event){event.preventDefault();const button=event.submitter,errorBox=$("#subAdminLoginError");button.disabled=true;errorBox.classList.add("hidden");try{const context=await window.CloudCompetition.signInSubAdmin($("#subAdminLoginCode").value.trim(),$("#subAdminLoginPin").value);$("#subAdminLoginPin").value="";await enterCloudContext(context)}catch(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden")}finally{button.disabled=false}}
async function cloudLogout(){stopCommitteeAutoRefresh();stopAdminAutoRefresh();stopMonitorPoll();clearTimeout(idleLogoutTimer);sessionStorage.removeItem(ACTIVE_MODE_KEY);try{await window.CloudCompetition.signOut()}catch(error){console.warn("Sign out failed",error)}activeCloudSession=null;committeeSessions=[];cloudStartup={enabled:cloudEnabled,context:null};resetSubAdminRestrictions();setAdminTheme("green");$("#app").classList.add("hidden");showScreen("gatewayScreen")}
function setupIdleLogout(){const reset=()=>{clearTimeout(idleLogoutTimer);if(!window.CloudCompetition?.context)return;idleLogoutTimer=setTimeout(async()=>{await cloudLogout();toast("تم تسجيل الخروج بعد 30 دقيقة دون نشاط")},IDLE_LOGOUT_MS)};["pointerdown","keydown","touchstart","scroll"].forEach(type=>document.addEventListener(type,reset,{passive:true}));document.addEventListener("visibilitychange",()=>{if(!document.hidden)reset()});setInterval(()=>{if(window.CloudCompetition?.context&&!idleLogoutTimer)reset()},60000)}
function toggleCommitteeMemberFields(){const enabled=$("#enableCommitteeMember")?.checked,fields=$("#committeeMemberFields");if(!fields)return;fields.classList.toggle("hidden",!enabled);$("#newCommitteeMemberName").required=Boolean(enabled);$("#newCommitteeMemberCode").required=Boolean(enabled);$("#newCommitteeMemberPin").required=Boolean(enabled&&!$("#newCommitteeMemberCode").dataset.existing)}
function ensureCommitteeMemberFields(){if($("#newCommitteeMemberCode"))return;const chairmanPin=$("#newCommitteePin")?.closest("label");if(!chairmanPin)return;chairmanPin.insertAdjacentHTML("afterend",`<label class="committee-member-toggle"><input id="enableCommitteeMember" type="checkbox"> تفعيل حساب عضو اللجنة ورصده المستقل</label><div id="committeeMemberFields" class="committee-member-fields hidden"><label>اسم عضو اللجنة<input id="newCommitteeMemberName" placeholder="الاسم الثلاثي"></label><label>رمز عضو اللجنة<input id="newCommitteeMemberCode" maxlength="20" placeholder="مثال: L01-M"></label><label>PIN عضو اللجنة<input id="newCommitteeMemberPin" type="password" inputmode="numeric" minlength="4" placeholder="4 خانات أو أكثر"></label></div>`);$("#enableCommitteeMember").addEventListener("change",toggleCommitteeMemberFields);toggleCommitteeMemberFields()}
function renderCommitteeLevelOptions(){const box=$("#committeeLevelOptions");if(!box||box.children.length)return;box.innerHTML=LEVEL_CATALOG.map(l=>`<label><input type="checkbox" name="committeeLevel" value="${l.id}"> ${escapeHtml(l.label)}</label>`).join("")}
async function setupCloudAdminPanel(){ensureCommitteeMemberFields();renderCommitteeLevelOptions();const isMainAdmin=window.CloudCompetition.context?.profile.role==="admin";$("#cloudCommitteesPanel").classList.remove("hidden");$("#subAdminsPanel").classList.remove("hidden");$("#drRequestsPanel").classList.remove("hidden");$("#activityLogPanel").classList.toggle("hidden",!isMainAdmin);$("#autoBackupPanel")?.classList.toggle("hidden",!isMainAdmin);$("#syncCloudBtn").classList.remove("hidden");$("#supervisorsPanel").classList.toggle("hidden",!isMainAdmin);renderDrRequests();const tasks=[renderCloudCommittees(),renderFinalEditAudit(),renderSubAdmins()];if(isMainAdmin){tasks.push(renderSupervisors());tasks.push(renderActivityLog());tasks.push(renderAutoBackupSettings())}await Promise.all(tasks)}
async function refreshAdminCloudResults(){const button=$("#syncCloudBtn");button.disabled=true;try{await syncFinalSessionsIntoState();renderAll();toast("تم تحديث نتائج جميع اللجان")}catch(error){toast(`تعذر تحديث النتائج: ${error.message}`)}finally{button.disabled=false}}
let cloudCommittees=[];
function renderPagerTabs(containerId,currentPage,totalPages,onSelect){const el=$(`#${containerId}`);if(!el)return;if(totalPages<=1){el.innerHTML="";return}const pages=Array.from({length:totalPages},(_,i)=>i+1);el.innerHTML=pages.map(n=>`<button type="button" class="${n===currentPage?"active":""}" data-pager-page="${n}">${formatNumber(n)}</button>`).join("");$$(`#${containerId} [data-pager-page]`).forEach(button=>button.onclick=()=>onSelect(Number(button.dataset.pagerPage)))}
let committeeStudentsPage=1,committeeStudentsPageSignature="";
let participantsPage=1,participantsPageSignature="";
let subAdminCommittees=[];
let monitorPollTimer=null,monitorSessions=[],monitorSelectedCommitteeId=null,monitorSelectedSessionId=null,monitorSelectedRole="chairman";
function stopMonitorPoll(){if(monitorPollTimer)clearInterval(monitorPollTimer);monitorPollTimer=null}
async function renderMonitorView(){
  if(!(operationMode==="cloud"&&["admin","supervisor"].includes(window.CloudCompetition.context?.kind))){$("#monitorDetailPanel").innerHTML=`<div class="monitor-empty">المراقبة الحية متاحة فقط لحساب الإدارة الرئيسي أو مشرف المسابقة في وضع فرع الكورة.</div>`;$("#monitorCommitteeList").innerHTML="";return}
  stopMonitorPoll();
  await renderMonitorCommittees();
  monitorPollTimer=setInterval(renderMonitorCommittees,4000);
}
async function renderMonitorCommittees(){
  try{
    const [sessions]=await Promise.all([window.CloudCompetition.listSessions(),cloudCommittees.length?null:window.CloudCompetition.listCommittees().then(list=>{cloudCommittees=list})]);
    monitorSessions=sessions;
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
  const participant=state.participants.find(p=>p.id===session.participant_id);
  const draw=state.draws.find(d=>d.participantId===session.participant_id);
  if(!participant||!draw){panel.innerHTML=`<div class="monitor-empty">تعذر إيجاد بيانات هذا الاختبار — قد تكون بيانات المتسابقين قيد التحديث، حاول لاحقًا.</div>`;return}
  const hasMember=Boolean(committee?.member_name);
  if(!hasMember)monitorSelectedRole="chairman";
  const draft=session.assessment?.examinerDrafts?.[monitorSelectedRole]||null;
  const positions=draw.positions.map((drawPosition,index)=>({...emptyPositionAssessment(drawPosition),...(draft?.positions?.[index]||{})}));
  const result=calculateAssessment({positions});
  const currentIndex=Number(draft?.currentPosition)||0;
  panel.innerHTML=`<div class="monitor-detail-head">${activeSessions.length>1?`<div class="monitor-session-tabs">${activeSessions.map(s=>{const p=state.participants.find(x=>x.id===s.participant_id);return `<button type="button" class="compact-btn ${s.id===session.id?"is-active":""}" data-monitor-session="${s.id}">${escapeHtml(p?.name||"—")}</button>`}).join("")}</div>`:""}<div class="monitor-participant"><h3>${escapeHtml(participant.name)}</h3><span>${escapeHtml(participant.center)} · ${participant.level} أجزاء · رقم الجلوس ${escapeHtml(participant.seat)}</span></div>${hasMember?`<div class="monitor-role-tabs"><button type="button" class="compact-btn ${monitorSelectedRole==="chairman"?"is-active":""}" data-monitor-role="chairman">رصد الرئيس</button><button type="button" class="compact-btn ${monitorSelectedRole==="member"?"is-active":""}" data-monitor-role="member">رصد العضو</button></div>`:""}<div class="monitor-live-score ${result.passed?"pass-text":"fail-text"}">العلامة الحالية: ${formatAssessmentNumber(result.score)}</div></div><div class="monitor-positions">${draft?positions.map((position,index)=>monitorPositionHtml(position,draw.positions[index],index,index===currentIndex)).join(""):`<p class="committee-alerts-empty">لم يبدأ ${monitorSelectedRole==="chairman"?"الرئيس":"العضو"} برصد هذا المتسابق بعد.</p>`}</div>`;
  $$(`[data-monitor-session]`).forEach(btn=>btn.onclick=()=>{monitorSelectedSessionId=btn.dataset.monitorSession;renderMonitorDetail()});
  $$(`[data-monitor-role]`).forEach(btn=>btn.onclick=()=>{monitorSelectedRole=btn.dataset.monitorRole;renderMonitorDetail()});
  lucide.createIcons();
}
function monitorPositionHtml(position,drawPosition,index,isCurrent){
  const deduction=calculateAssessment({positions:[position]}).totalDeduction;
  const typeBadges=Object.entries(ASSESSMENT_RULES).filter(([type])=>Number(position[type])>0).map(([type,rule])=>`<span>${rule.label}: ${formatAssessmentNumber(position[type])}</span>`).join("");
  return `<article class="monitor-position-card ${isCurrent?"is-current":""} ${position.completed?"is-done":""}"><div class="monitor-position-head"><span>الموضع ${index+1}${isCurrent?" · الحالي الآن":""}${position.completed?" · مُنهى":""}</span><b>خصم: ${formatAssessmentNumber(deduction)}</b></div><p>${escapeHtml(positionTitle(drawPosition))} · الجزء ${drawPosition.juz} · الصفحة ${drawPosition.page}</p>${typeBadges?`<div class="monitor-position-badges">${typeBadges}</div>`:`<div class="monitor-position-badges empty">لا أخطاء مسجّلة بعد</div>`}</article>`;
}
async function renderCloudCommittees(){try{const canDeleteCommittee=window.CloudCompetition.context?.profile.role==="admin";cloudCommittees=await window.CloudCompetition.listCommittees();$("#committeesList").innerHTML=cloudCommittees.length?cloudCommittees.map(committee=>`<div class="committee-row ${committee.active?"":"inactive"}"><div class="committee-row-head"><div><b>${escapeHtml(committee.name)}</b><small>${committee.responsible_gender==="أنثى"?"إناث":"ذكور"}</small><small>الرئيس: ${escapeHtml(committee.chairman_name||"—")} · رمز الدخول: ${escapeHtml(committee.login_code||"—")}</small>${committee.member_name?`<small>العضو: ${escapeHtml(committee.member_name)} · رمز الدخول: ${escapeHtml(committee.member_login_code||"—")}</small>`:""}${committee.can_edit_final?`<small class="permission-on">صلاحية تعديل النتائج المعتمدة مفعلة</small>`:""}${committee.can_self_draw?`<small class="permission-on">صلاحية السحب للمتسابقين غير المسجَّلين مفعلة</small>`:""}${committee.show_score===false?`<small class="permission-off">العلامة مخفية عن اللجنة بعد الاعتماد</small>`:""}</div><div class="row-actions"><button class="compact-btn" data-edit-committee="${committee.id}">تعديل</button><button class="compact-btn ${committee.can_edit_final?"danger-compact":""}" data-final-edit="${committee.id}" data-enabled="${Boolean(committee.can_edit_final)}">${committee.can_edit_final?"سحب صلاحية تعديل النتائج":"منح صلاحية تعديل النتائج"}</button><button class="compact-btn ${committee.can_self_draw?"danger-compact":""}" data-self-draw-permission="${committee.id}" data-enabled="${Boolean(committee.can_self_draw)}">${committee.can_self_draw?"سحب صلاحية السحب":"منح صلاحية السحب"}</button><button class="compact-btn ${committee.show_score===false?"danger-compact":""}" data-show-score="${committee.id}" data-enabled="${committee.show_score!==false}">${committee.show_score===false?"إظهار العلامة للجنة":"إخفاء العلامة عن اللجنة"}</button><button class="compact-btn ${committee.active?"danger-compact":""}" data-toggle-committee="${committee.id}" data-active="${committee.active}">${committee.active?"تعطيل":"تفعيل"}</button>${canDeleteCommittee?`<button class="compact-btn danger-compact" data-delete-committee="${committee.id}" data-committee-name="${escapeAttr(committee.name)}"><i data-lucide="trash-2"></i> حذف</button>`:""}</div></div><div class="committee-levels-badges">${(committee.level_names||[]).length?committee.level_names.map(name=>`<span>${escapeHtml(name)}</span>`).join(""):`<span>${(committee.levels||[]).sort((a,b)=>a-b).join("، ")} أجزاء</span>`}</div></div>`).join(""):`<div class="committee-empty">لا توجد لجان بعد. أضفها عندما يتحدد توزيع يوم المسابقة.</div>`;$$(`[data-edit-committee]`).forEach(button=>button.onclick=()=>editCommittee(button.dataset.editCommittee));$$(`[data-final-edit]`).forEach(button=>button.onclick=async()=>{const enabled=button.dataset.enabled==="true";button.disabled=true;try{await window.CloudCompetition.setCommitteeFinalEdit(button.dataset.finalEdit,!enabled);await renderCloudCommittees();toast(enabled?"تم سحب صلاحية تعديل النتائج المعتمدة":"تم منح صلاحية تعديل النتائج المعتمدة") }catch(error){toast(error.message);button.disabled=false}});$$(`[data-self-draw-permission]`).forEach(button=>button.onclick=async()=>{const enabled=button.dataset.enabled==="true";button.disabled=true;try{await window.CloudCompetition.setCommitteeSelfDraw(button.dataset.selfDrawPermission,!enabled);await renderCloudCommittees();toast(enabled?"تم سحب صلاحية السحب من اللجنة":"تم منح اللجنة صلاحية السحب للمتسابقين غير المسجَّلين")}catch(error){toast(error.message);button.disabled=false}});$$(`[data-show-score]`).forEach(button=>button.onclick=async()=>{const enabled=button.dataset.enabled==="true";button.disabled=true;try{await window.CloudCompetition.setCommitteeShowScore(button.dataset.showScore,!enabled);await renderCloudCommittees();toast(enabled?"تم إخفاء العلامة عن اللجنة بعد الاعتماد":"تم إظهار العلامة للجنة بعد الاعتماد")}catch(error){toast(error.message);button.disabled=false}});$$(`[data-toggle-committee]`).forEach(button=>button.onclick=async()=>{button.disabled=true;try{await window.CloudCompetition.setCommitteeActive(button.dataset.toggleCommittee,button.dataset.active!=="true");await renderCloudCommittees()}catch(error){toast(error.message)}});$$(`[data-delete-committee]`).forEach(button=>button.onclick=async()=>{const id=button.dataset.deleteCommittee,name=button.dataset.committeeName;if(!confirm(`حذف لجنة «${name}» نهائياً؟`))return;button.disabled=true;try{await window.CloudCompetition.deleteCommittee(id);await Promise.all([renderCloudCommittees(),renderFinalEditAudit(),renderActivityLog()]);toast(`تم حذف لجنة ${name}`)}catch(error){if(error.message.includes("اختبارات مسجلة")&&confirm(`لجنة «${name}» لديها اختبارات/نتائج مسجلة (على الأرجح بيانات تجريبية). المتابعة ستحذف اللجنة نهائيًا مع كل اختباراتها وسجل نشاطها بشكل لا رجعة فيه. متابعة؟`)){try{await window.CloudCompetition.deleteCommittee(id,true);await Promise.all([renderCloudCommittees(),renderFinalEditAudit(),renderActivityLog()]);toast(`تم حذف لجنة ${name} وكل اختباراتها وسجل نشاطها نهائيًا`)}catch(innerError){toast(innerError.message);button.disabled=false}}else{toast(error.message);button.disabled=false}}});lucide.createIcons()}catch(error){toast(`تعذر تحميل اللجان: ${error.message}`)}}
async function renderFinalEditAudit(){try{const entries=await window.CloudCompetition.listFinalEditAudit(),labels={grant_final_edit:"منح صلاحية تعديل النتائج",revoke_final_edit:"سحب صلاحية تعديل النتائج",reopen_final_result:"فتح نتيجة معتمدة للتعديل",revise_final_result:"إعادة اعتماد نتيجة معدلة"};$("#finalEditAuditList").innerHTML=entries.length?entries.map(entry=>{const details=entry.details||{},participant=entry.entity_type==="participant"?state.participants.find(item=>item.id===entry.entity_id):null,score=entry.action==="reopen_final_result"&&details.old_score!=null?` · العلامة السابقة ${details.old_score}`:entry.action==="revise_final_result"&&details.new_score!=null?` · العلامة الجديدة ${details.new_score}`:"",subject=participant?` · ${participant.name}`:"";return `<article><div><b>${labels[entry.action]||entry.action}${escapeHtml(subject)}</b><span>${escapeHtml(details.committee_name||"الإدارة")}${score}</span></div><small>${formatDate(entry.created_at)}</small></article>`}).join(""):`<p class="committee-alerts-empty">لا يوجد نشاط مسجل بعد.</p>`}catch(error){$("#finalEditAuditList").innerHTML=`<p class="form-error">تعذر تحميل سجل النشاط: ${escapeHtml(error.message)}</p>`}}
function resetCommitteeForm(){$("#committeeAccountForm").reset();$("#editingCommitteeId").value="";$("#newCommitteePin").required=true;if($("#newCommitteeMemberCode"))delete $("#newCommitteeMemberCode").dataset.existing;toggleCommitteeMemberFields();$("#committeeSubmitLabel").textContent="إضافة اللجنة";$("#cancelCommitteeEdit").classList.add("hidden")}
let cloudSubAdmins=[];
async function renderSubAdmins(){try{cloudSubAdmins=await window.CloudCompetition.listSubAdmins();$("#subAdminsList").innerHTML=cloudSubAdmins.length?cloudSubAdmins.map(admin=>`<div class="committee-row ${admin.active?"":"inactive"}"><div><b>${escapeHtml(admin.name)}</b><small>${admin.gender==="أنثى"?"إناث":"ذكور"} · رمز الدخول: ${escapeHtml(admin.login_code||"—")}</small></div><span></span><div class="row-actions"><button class="compact-btn" data-edit-sub-admin="${admin.id}">تعديل</button><button class="compact-btn ${admin.active?"danger-compact":""}" data-toggle-sub-admin="${admin.id}" data-active="${admin.active}">${admin.active?"تعطيل":"تفعيل"}</button><button class="compact-btn danger-compact" data-delete-sub-admin="${admin.id}" data-sub-admin-name="${escapeAttr(admin.name)}"><i data-lucide="trash-2"></i> حذف</button></div></div>`).join(""):`<div class="committee-empty">لا توجد حسابات مسؤول فرعي بعد.</div>`;$$(`[data-edit-sub-admin]`).forEach(button=>button.onclick=()=>editSubAdmin(button.dataset.editSubAdmin));$$(`[data-toggle-sub-admin]`).forEach(button=>button.onclick=async()=>{button.disabled=true;try{const admin=cloudSubAdmins.find(item=>item.id===button.dataset.toggleSubAdmin);await window.CloudCompetition.saveSubAdmin({id:admin.id,name:admin.name,code:admin.login_code,gender:admin.gender,active:button.dataset.active!=="true"});await renderSubAdmins()}catch(error){toast(error.message)}});$$(`[data-delete-sub-admin]`).forEach(button=>button.onclick=async()=>{const name=button.dataset.subAdminName;if(!confirm(`حذف حساب «${name}» نهائياً؟`))return;button.disabled=true;try{await window.CloudCompetition.deleteSubAdmin(button.dataset.deleteSubAdmin);await renderSubAdmins();toast(`تم حذف حساب ${name}`)}catch(error){toast(error.message);button.disabled=false}});lucide.createIcons()}catch(error){toast(`تعذر تحميل حسابات المسؤول الفرعي: ${error.message}`)}}
function resetSubAdminForm(){$("#subAdminAccountForm").reset();$("#editingSubAdminId").value="";$("#newSubAdminPin").required=true;$("#subAdminSubmitLabel").textContent="إضافة الحساب";$("#cancelSubAdminEdit").classList.add("hidden")}
function editSubAdmin(id){const admin=cloudSubAdmins.find(item=>item.id===id);if(!admin)return;$("#editingSubAdminId").value=admin.id;$("#newSubAdminName").value=admin.name;$("#newSubAdminGender").value=admin.gender;$("#newSubAdminCode").value=admin.login_code||"";$("#newSubAdminPin").value="";$("#newSubAdminPin").required=false;$("#subAdminSubmitLabel").textContent="حفظ التعديل";$("#cancelSubAdminEdit").classList.remove("hidden");$("#newSubAdminName").focus()}
let cloudSupervisors=[];
async function renderSupervisors(){try{cloudSupervisors=await window.CloudCompetition.listSupervisors();$("#supervisorsList").innerHTML=cloudSupervisors.length?cloudSupervisors.map(supervisor=>`<div class="committee-row"><div><b>${escapeHtml(supervisor.display_name)}</b><small>UID: ${escapeHtml(supervisor.id)}</small>${supervisor.can_edit_final?`<small class="permission-on">يقدر يعدّل نتائج معتمدة</small>`:""}${supervisor.can_delete_data?`<small class="permission-on">يقدر يحذف متسابقين/سحوبات</small>`:""}</div><span></span><div class="row-actions"><button class="compact-btn" data-edit-supervisor="${supervisor.id}">تعديل</button><button class="compact-btn danger-compact" data-delete-supervisor="${supervisor.id}" data-supervisor-name="${escapeAttr(supervisor.display_name)}"><i data-lucide="trash-2"></i> إلغاء الربط</button></div></div>`).join(""):`<div class="committee-empty">لا توجد حسابات مشرفين بعد.</div>`;$$(`[data-edit-supervisor]`).forEach(button=>button.onclick=()=>editSupervisor(button.dataset.editSupervisor));$$(`[data-delete-supervisor]`).forEach(button=>button.onclick=async()=>{const name=button.dataset.supervisorName;if(!confirm(`إلغاء ربط حساب «${name}» كمشرف مسابقة؟ يقدر يُربط من جديد لاحقًا بنفس الـ UID.`))return;button.disabled=true;try{await window.CloudCompetition.unlinkSupervisor(button.dataset.deleteSupervisor);await renderSupervisors();toast(`تم إلغاء ربط ${name}`)}catch(error){toast(error.message);button.disabled=false}});lucide.createIcons()}catch(error){toast(`تعذر تحميل حسابات المشرفين: ${error.message}`)}}
function resetSupervisorForm(){$("#supervisorAccountForm").reset();$("#editingSupervisorId").value="";$("#newSupervisorUid").disabled=false;$("#supervisorSubmitLabel").textContent="ربط الحساب";$("#cancelSupervisorEdit").classList.add("hidden")}
function editSupervisor(id){const supervisor=cloudSupervisors.find(item=>item.id===id);if(!supervisor)return;$("#editingSupervisorId").value=supervisor.id;$("#newSupervisorUid").value=supervisor.id;$("#newSupervisorUid").disabled=true;$("#newSupervisorName").value=supervisor.display_name;$("#newSupervisorCanEditFinal").checked=Boolean(supervisor.can_edit_final);$("#newSupervisorCanDeleteData").checked=Boolean(supervisor.can_delete_data);$("#supervisorSubmitLabel").textContent="حفظ التعديل";$("#cancelSupervisorEdit").classList.remove("hidden");$("#newSupervisorName").focus()}
async function saveSupervisorAccount(event){event.preventDefault();const id=$("#editingSupervisorId").value||null,userId=id||$("#newSupervisorUid").value.trim(),name=$("#newSupervisorName").value.trim(),canEditFinal=$("#newSupervisorCanEditFinal").checked,canDeleteData=$("#newSupervisorCanDeleteData").checked,button=event.submitter;if(!userId)return toast("أدخل معرّف المستخدم (UID) من لوحة Supabase");if(!name)return toast("أدخل اسم المشرف");button.disabled=true;try{await window.CloudCompetition.linkSupervisor({userId,name,canEditFinal,canDeleteData});resetSupervisorForm();await renderSupervisors();toast("تم حفظ حساب مشرف المسابقة")}catch(error){toast(`تعذر حفظ الحساب: ${error.message}`)}finally{button.disabled=false}}
let activityLogEntries=[];
function activityLogActorOf(entry){const details=entry.details||{};return details.supervisor_name?`مشرف المسابقة: ${details.supervisor_name}`:details.sub_admin_name?`مسؤول فرعي: ${details.sub_admin_name}`:details.committee_name?`لجنة: ${details.committee_name}`:"الإدارة"}
async function renderActivityLog(){
  try{
    activityLogEntries=await window.CloudCompetition.listActivityLog(150);
    const filterSelect=$("#activityLogFilter"),previousChoice=filterSelect?.value||"all";
    const actors=[...new Set(activityLogEntries.map(activityLogActorOf))].sort((a,b)=>a.localeCompare(b,"ar"));
    if(filterSelect){filterSelect.innerHTML=`<option value="all">الكل</option>${actors.map(actor=>`<option value="${escapeAttr(actor)}">${escapeHtml(actor)}</option>`).join("")}`;filterSelect.value=actors.includes(previousChoice)?previousChoice:"all"}
    renderActivityLogList()
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
async function renderAutoBackupSettings(){
  try{
    const settings=await window.CloudCompetition.getBackupSettings();
    $("#autoBackupEnabled").checked=Boolean(settings.enabled);
    $("#autoBackupInterval").value=settings.interval_minutes;
    $("#autoBackupEmail").value=settings.notify_email||"";
    const lines=[];
    lines.push(settings.enabled?"مفعّل حالياً.":"معطّل حالياً.");
    lines.push(settings.last_success_at?`آخر نسخة أُرسلت بنجاح: ${formatDate(settings.last_success_at)}`:"لم تُرسل أي نسخة بعد.");
    if(settings.last_error)lines.push(`آخر خطأ: ${settings.last_error}`);
    $("#autoBackupStatus").innerHTML=lines.map(escapeHtml).join("<br>");
  }catch(error){$("#autoBackupStatus").innerHTML=`<span class="form-error">تعذر تحميل حالة النسخ الاحتياطي: ${escapeHtml(error.message)}</span>`}
}
async function saveAutoBackupSettings(){
  const button=$("#saveAutoBackupBtn"),enabled=$("#autoBackupEnabled").checked,interval=Number($("#autoBackupInterval").value),email=$("#autoBackupEmail").value.trim();
  if(!Number.isFinite(interval)||interval<5)return toast("أدخل فاصلاً زمنياً 5 دقائق على الأقل");
  if(!email||!email.includes("@"))return toast("أدخل إيميلاً صحيحاً");
  button.disabled=true;
  try{await window.CloudCompetition.setBackupSettings({enabled,intervalMinutes:interval,notifyEmail:email});await renderAutoBackupSettings();toast("تم حفظ إعداد النسخ الاحتياطي التلقائي")}
  catch(error){toast(`تعذر حفظ الإعداد: ${error.message}`)}
  finally{button.disabled=false}
}
async function saveSubAdminAccount(event){event.preventDefault();const id=$("#editingSubAdminId").value||null,name=$("#newSubAdminName").value.trim(),gender=$("#newSubAdminGender").value,code=$("#newSubAdminCode").value.trim(),pin=$("#newSubAdminPin").value,button=event.submitter;if(!gender)return toast("اختر جنس الحساب");if(!id&&pin.length<4)return toast("أدخل PIN من 4 خانات على الأقل");button.disabled=true;try{await window.CloudCompetition.saveSubAdmin({id,name,code,pin,gender});resetSubAdminForm();await renderSubAdmins();toast("تم حفظ حساب المسؤول الفرعي")}catch(error){toast(`تعذر حفظ الحساب: ${error.message}`)}finally{button.disabled=false}}
function editCommittee(id){const committee=cloudCommittees.find(item=>item.id===id);if(!committee)return;ensureCommitteeMemberFields();renderCommitteeLevelOptions();$("#editingCommitteeId").value=committee.id;$("#newCommitteeName").value=committee.name;$("#newCommitteeGender").value=committee.responsible_gender||"";$("#newCommitteeChairmanName").value=committee.chairman_name||"";$("#newCommitteeCode").value=committee.login_code||"";$("#newCommitteePin").value="";$("#newCommitteePin").required=false;$("#enableCommitteeMember").checked=Boolean(committee.member_login_code);$("#newCommitteeMemberName").value=committee.member_name||"";$("#newCommitteeMemberCode").value=committee.member_login_code||`${committee.login_code||"L"}-M`;$("#newCommitteeMemberCode").dataset.existing=committee.member_login_code||"";$("#newCommitteeMemberPin").value="";const hasLevelNames=(committee.level_names||[]).length>0;$$(`[name="committeeLevel"]`).forEach(input=>{const entry=levelCatalogById(input.value);input.checked=hasLevelNames?(committee.level_names||[]).includes(entry?.label):(committee.levels||[]).includes(entry?.parts)});if(!hasLevelNames&&(committee.levels||[]).length)toast("هذه لجنة قديمة بلا أسماء مستويات محددة؛ راجع الاختيار أدناه ثم احفظ لتحديثها للنظام الجديد");toggleCommitteeMemberFields();$("#committeeSubmitLabel").textContent="حفظ التعديل";$("#cancelCommitteeEdit").classList.remove("hidden");$("#newCommitteeName").focus()}
async function linkCommitteeAccount(event){event.preventDefault();ensureCommitteeMemberFields();const levelNames=$$(`[name="committeeLevel"]`).filter(input=>input.checked).map(input=>levelCatalogById(input.value)?.label).filter(Boolean),id=$("#editingCommitteeId").value||null,name=$("#newCommitteeName").value.trim(),responsibleGender=$("#newCommitteeGender").value,chairmanName=$("#newCommitteeChairmanName").value.trim(),code=$("#newCommitteeCode").value.trim(),pin=$("#newCommitteePin").value,memberEnabled=$("#enableCommitteeMember").checked,memberName=memberEnabled?$("#newCommitteeMemberName").value.trim():"",memberCode=memberEnabled?$("#newCommitteeMemberCode").value.trim():"",memberPin=memberEnabled?$("#newCommitteeMemberPin").value:"",button=event.submitter;if(!responsibleGender)return toast("اختر الجنس الذي تُشرف عليه اللجنة");if(!chairmanName)return toast("أدخل اسم رئيس اللجنة");if(!levelNames.length)return toast("اختر مستوى واحداً على الأقل");if(!id&&pin.length<4)return toast("أدخل PIN للرئيس من 4 خانات على الأقل");if(memberEnabled&&!memberName)return toast("أدخل اسم عضو اللجنة");if(memberEnabled&&!id&&memberPin.length<4)return toast("أدخل PIN للعضو من 4 خانات على الأقل");if(memberEnabled&&code.toLowerCase()===memberCode.toLowerCase())return toast("يجب أن يختلف رمز الرئيس عن رمز العضو");button.disabled=true;try{await window.CloudCompetition.saveCommittee({id,name,chairmanName,code,pin,memberName,memberCode,memberPin,responsibleGender,levelNames});resetCommitteeForm();await renderCloudCommittees();toast(memberEnabled?"تم حفظ حسابي الرئيس والعضو":"تم حفظ اللجنة بحساب الرئيس فقط") }catch(error){toast(`تعذر حفظ اللجنة: ${error.message}`)}finally{button.disabled=false}}
function applySubAdminRestrictions(){$("#deleteAllParticipantsBtn")?.classList.add("hidden");$(`[data-view="settings"]`)?.classList.add("hidden");$(`[data-view="examDuration"]`)?.classList.add("hidden");$(`[data-view="monitor"]`)?.classList.add("hidden");$("#importParticipantsBtn")?.classList.add("hidden")}
function applySupervisorRestrictions(){$("#deleteAllParticipantsBtn")?.classList.add("hidden");$("#rootOnlySettingsGrid")?.classList.add("hidden")}
function resetSubAdminRestrictions(){$("#deleteAllParticipantsBtn")?.classList.remove("hidden");$(`[data-view="settings"]`)?.classList.remove("hidden");$(`[data-view="examDuration"]`)?.classList.remove("hidden");$(`[data-view="monitor"]`)?.classList.remove("hidden");$("#importParticipantsBtn")?.classList.remove("hidden");$("#rootOnlySettingsGrid")?.classList.remove("hidden")}
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
  if(!["admin","supervisor"].includes(context.profile.role)){setAdminTheme(context.committee?.responsibleGender==="أنثى"?"rose":"green");$("#app").classList.add("hidden");showScreen("committeeApp");await renderCommitteeWorkspace();startCommitteeAutoRefresh();return}
  const isSupervisor=context.profile.role==="supervisor";
  setAdminTheme("green");
  const [remote,sessions,committees]=await Promise.all([window.CloudCompetition.loadCompetitionState(),window.CloudCompetition.listSessions(),window.CloudCompetition.listCommittees()]);
  if(remote.payload?.config){state={...defaultState(),...remote.payload};if(!isSupervisor)localStorage.setItem(CLOUD_STORAGE_KEY,JSON.stringify(state))}
  else if(!isSupervisor&&state.config){await window.CloudCompetition.saveCompetitionState(state)}
  if(!isSupervisor&&!state.config){showScreen("setupScreen");return}
  if(isSupervisor){window.CloudCompetition.markSupervisorKnownIds(state.participants,state.draws);applySupervisorRestrictions()}
  else window.CloudCompetition.markAdminKnownIds(state.participants,state.draws);
  mergeFinalSessionsIntoState(sessions,committees);
  const greeting=$("#topAdminGreeting");if(greeting)greeting.textContent=context.profile.display_name?`أهلاً، ${context.profile.display_name}`:"الدورة الحالية";
  showApp()}catch(error){toast(`تعذر فتح البيانات المشتركة: ${error.message}`);showScreen("cloudLoginScreen")}}
function mergeFinalSessionsIntoState(sessions,committees){committeeSessions=sessions;const committeeById=new Map(committees.map(item=>[item.id,item]));let changed=false;committeeSessions.filter(session=>session.status==="final").forEach(session=>{const participant=state.participants.find(item=>item.id===session.participant_id);if(!participant)return;const assessment={...(session.assessment||{})};const committee=committeeById.get(session.committee_id);if(committee){if(!assessment.committeeName)assessment.committeeName=committee.name;if(!assessment.committeeChairmanName&&committee.chairman_name)assessment.committeeChairmanName=committee.chairman_name;if(!assessment.committeeMemberName&&committee.member_name)assessment.committeeMemberName=committee.member_name}if(participant.score!==Number(session.score)||participant.assessment?.updatedAt!==assessment.updatedAt||participant.assessment?.committeeName!==assessment.committeeName||participant.assessment?.committeeChairmanName!==assessment.committeeChairmanName||participant.assessment?.committeeMemberName!==assessment.committeeMemberName){participant.score=Number(session.score);participant.gradedAt=session.finalized_at;participant.scoreSource="electronic";participant.assessment=assessment;changed=true}});if(changed)saveState();return changed}
async function syncFinalSessionsIntoState(){const [sessions,committees]=await Promise.all([window.CloudCompetition.listSessions(),window.CloudCompetition.listCommittees()]);return mergeFinalSessionsIntoState(sessions,committees)}
async function renderCommitteeWorkspace(){let context=window.CloudCompetition.context;if(!context?.committee)return;try{await window.CloudCompetition.refreshCommitteeAccess(true);context=window.CloudCompetition.context;const examinerName=context.committee.examiner_role==="member"?context.committee.memberName:context.committee.chairmanName;$("#committeeExaminerGreeting").textContent=examinerName?`أهلاً، ${examinerName}`:context.committee.name;$("#committeeName").textContent=`لجنة: ${context.committee.name}`;const levelNamesLabel=(context.committee.levelNames||[]).join("، ")||`${(context.committee.levels||[]).sort((a,b)=>a-b).join("، ")} أجزاء`,genderLabel=context.committee.responsibleGender==="أنثى"?"إناث":context.committee.responsibleGender==="ذكر"?"ذكور":"";$("#committeeLevels").textContent=`${genderLabel?genderLabel+" · ":""}${levelNamesLabel}`;const [remote,sessions]=await Promise.all([window.CloudCompetition.loadCompetitionState(),window.CloudCompetition.listSessions()]);if(remote.payload?.config){const previous=loadCommitteeSnapshot(),next=committeeScopedState(remote.payload),previousById=new Map(previous.participants.map(item=>[item.id,item])),nextById=new Map(next.participants.map(item=>[item.id,item])),previousDraws=new Map(previous.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw])),nextDraws=new Map(next.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw]));if(previous.config){const updates=[];for(const participant of next.participants){const old=previousById.get(participant.id);if(!old||participantCloudSignature(old,previousDraws.get(participant.id))!==participantCloudSignature(participant,nextDraws.get(participant.id)))updates.push({text:describeCommitteeChange(participant,old),participantId:participant.id})}for(const old of previous.participants)if(!nextById.has(old.id))updates.push({text:describeCommitteeChange(null,old),participantId:old.id});if(updates.length)addCommitteeAlerts(updates)}state=next;saveCommitteeSnapshot(state)}committeeSessions=sessions;await syncServerCommitteeNotifications();renderCommitteeAlerts();renderCommitteeStudents();lucide.createIcons();prewarmQuranData()}catch(error){toast(`تعذر تحديث قائمة اللجنة: ${error.message}`)}}
function stopCommitteeAutoRefresh(){if(committeeAutoRefreshTimer)clearInterval(committeeAutoRefreshTimer);committeeAutoRefreshTimer=null;committeeRefreshBusy=false}
function startCommitteeAutoRefresh(){stopAdminAutoRefresh();stopCommitteeAutoRefresh();committeeAutoRefreshTimer=setInterval(refreshCommitteeChanges,5000)}
function stopAdminAutoRefresh(){if(adminAutoRefreshTimer)clearInterval(adminAutoRefreshTimer);adminAutoRefreshTimer=null;adminRefreshBusy=false}
function startAdminAutoRefresh(){stopAdminAutoRefresh();adminAutoRefreshTimer=setInterval(refreshAdminChanges,5000)}
async function refreshAdminChanges(){const kind=window.CloudCompetition.context?.kind;if(adminRefreshBusy||!["admin","supervisor"].includes(kind)||!$("#modal")?.classList.contains("hidden"))return;adminRefreshBusy=true;try{const [remote,sessions,committees]=await Promise.all([window.CloudCompetition.loadCompetitionState(),window.CloudCompetition.listSessions(),window.CloudCompetition.listCommittees()]);if(remote.payload?.config){const previous=JSON.stringify({participants:state.participants,draws:state.draws});if(kind==="supervisor"){state={...defaultState(),config:remote.payload.config?.competitionName?{competitionName:remote.payload.config.competitionName,adminName:state.config?.adminName}:state.config,participants:remote.payload.participants||[],draws:remote.payload.draws||[]};window.CloudCompetition.markSupervisorKnownIds(state.participants,state.draws)}else{state={...defaultState(),...remote.payload};window.CloudCompetition.markAdminKnownIds(state.participants,state.draws);localStorage.setItem(CLOUD_STORAGE_KEY,JSON.stringify(state))}mergeFinalSessionsIntoState(sessions,committees);if(previous!==JSON.stringify({participants:state.participants,draws:state.draws}))renderAll()}}catch(error){console.warn("Admin auto refresh failed",error)}finally{adminRefreshBusy=false}}
function participantCloudSignature(participant,draw){return JSON.stringify({level:Number(participant?.level)||0,parts:(participant?.parts||[]).map(Number).sort((a,b)=>a-b),drawId:draw?.id||null,eligibleParts:(draw?.eligibleParts||[]).map(Number).sort((a,b)=>a-b),positions:(draw?.positions||[]).map(item=>item.id)})}
function committeeScopedState(payload){
  const merged={...defaultState(),...payload};
  const committee=window.CloudCompetition.context?.committee;
  if(!committee)return merged;
  const levelNames=committee.levelNames||[],levels=(committee.levels||[]).map(Number);
  const participants=merged.participants.filter(participant=>{
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
function saveCommitteeSnapshot(value){localStorage.setItem(committeeStateKey(),JSON.stringify(value))}
function describeCommitteeChange(current,previous){if(current&&previous&&Number(current.level)!==Number(previous.level))return `تم تغيير مستوى المتسابق ${current.name}: من ${previous.level} إلى ${current.level} أجزاء`;if(current&&!previous)return `تمت إضافة المتسابق إلى لجنتكم: ${current.name} (${current.level} أجزاء)`;if(!current&&previous)return `لم يعد المتسابق ${previous.name} ضمن لجنتكم (نُقل إلى لجنة أخرى أو تغيّر مستواه)`;return `تم تحديث بيانات المتسابق: ${current?.name||previous?.name}`}
async function refreshCommitteeChanges(){if(committeeRefreshBusy||window.CloudCompetition.context?.kind!=="committee")return;committeeRefreshBusy=true;try{await window.CloudCompetition.refreshCommitteeAccess();const committee=window.CloudCompetition.context?.committee,remote=await window.CloudCompetition.loadCompetitionState();if(!remote.payload?.config||!committee)return;const previousState=state,nextState=committeeScopedState(remote.payload,committee),previousById=new Map(previousState.participants.map(item=>[item.id,item])),nextById=new Map(nextState.participants.map(item=>[item.id,item])),previousDraws=new Map(previousState.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw])),nextDraws=new Map(nextState.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw])),changed=nextState.participants.filter(participant=>{const previous=previousById.get(participant.id);return !previous||participantCloudSignature(previous,previousDraws.get(participant.id))!==participantCloudSignature(participant,nextDraws.get(participant.id))}),removed=previousState.participants.filter(previous=>!nextById.has(previous.id));if(!changed.length&&!removed.length)return;state=nextState;saveCommitteeSnapshot(state);committeeSessions=await window.CloudCompetition.listSessions();const activeParticipantId=activeCloudSession?.participant_id;if(activeParticipantId&&!nextDraws.has(activeParticipantId)){closeModal();activeCloudSession=null}const updates=changed.map(item=>{const previous=previousById.get(item.id);return {text:describeCommitteeChange(item,previous),participantId:item.id}}).concat(removed.map(item=>({text:describeCommitteeChange(null,item),participantId:item.id})));addCommitteeAlerts(updates);renderCommitteeStudents();const names=[...changed,...removed].map(item=>item.name).filter(Boolean);toast(names.length===1?updates[0].text:`تم تحديث بيانات ${names.length} طلاب تخص لجنتكم`)}catch(error){console.warn("Committee auto refresh failed",error)}finally{committeeRefreshBusy=false}}

function committeeAlertsKey(){return `${COMMITTEE_ALERTS_KEY}.${window.CloudCompetition.context?.committee?.id||"unknown"}`}
function committeeAlerts(){try{return JSON.parse(localStorage.getItem(committeeAlertsKey())||"[]")}catch{return []}}
function addCommitteeAlerts(items){const now=new Date().toISOString(),alerts=[...items.map((item,index)=>({id:`${Date.now()}-${index}`,text:item.text,participantId:item.participantId||null,at:now,read:false})),...committeeAlerts()].slice(0,50);localStorage.setItem(committeeAlertsKey(),JSON.stringify(alerts));renderCommitteeAlerts()}
async function syncServerCommitteeNotifications(){try{const items=await window.CloudCompetition.listCommitteeNotifications();mergeServerCommitteeNotifications(items)}catch(error){console.warn("تعذر جلب تنبيهات اللجنة من الخادم",error)}}
function mergeServerCommitteeNotifications(items){
  if(!items?.length)return;
  const existing=committeeAlerts(),knownServerIds=new Set(existing.filter(a=>a.serverId!=null).map(a=>a.serverId)),fresh=items.filter(item=>!knownServerIds.has(item.id));
  if(!fresh.length)return;
  const merged=[...fresh.map(item=>({id:`srv-${item.id}`,serverId:item.id,text:item.message,participantId:item.participant_id||null,at:item.created_at,read:false})),...existing]
    .sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,50);
  localStorage.setItem(committeeAlertsKey(),JSON.stringify(merged));
}
function renderCommitteeAlerts(){const alerts=committeeAlerts(),panel=$(".committee-alerts");panel.classList.toggle("is-empty",!alerts.length);$("#committeeAlertsList").innerHTML=alerts.length?alerts.map(alert=>`<article class="committee-alert ${alert.read?"read":"unread"}"><i data-lucide="bell-ring"></i><div><b>${escapeHtml(alert.text)}</b><small>${formatDate(alert.at)}</small></div>${alert.read?"":`<span>جديد</span>`}</article>`).join(""):`<p class="committee-alerts-empty">لا توجد تنبيهات جديدة.</p>`;lucide.createIcons()}
function clearCommitteeAlerts(){const alerts=committeeAlerts().map(alert=>({...alert,read:true}));localStorage.setItem(committeeAlertsKey(),JSON.stringify(alerts));renderCommitteeAlerts();toast("تم تحديد التنبيهات كمقروءة")}
function populateCommitteeCenterOptions(){
  const centerSelect=$("#committeeCenterFilter");if(!centerSelect)return;
  const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  const current=centerSelect.value;
  centerSelect.innerHTML=`<option value="all">المركز: الكل</option>`+centers.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  centerSelect.value=centers.includes(current)?current:"all";
}
function renderCommitteeStudents(){
  const committee=window.CloudCompetition.context?.committee;
  if(!committee)return;
  const chairman=committee.examiner_role!=="member";
  if($("#committeeRoleLabel"))$("#committeeRoleLabel").textContent=chairman?"رئيس لجنة الاختبار":"عضو لجنة الاختبار";
  const query=$("#committeeSearch").value.trim().toLowerCase();
  const filter=$("#committeeStatusFilter").value;
  populateCommitteeCenterOptions();
  const centerFilter=$("#committeeCenterFilter").value;
  const drawByParticipant=new Map(state.draws.filter(draw=>draw.participantId).map(draw=>[draw.participantId,draw]));
  const sessionByParticipant=new Map(committeeSessions.map(session=>[session.participant_id,session]));
  const statusOrder={in_progress:0,pending:1,no_draw:2,final:3,manual_dr:4};
  const statusOf=participant=>participant.scoreSource==="manual"&&participant.manualEntryBy?"manual_dr":!drawByParticipant.has(participant.id)?"no_draw":sessionByParticipant.get(participant.id)?.status||"pending";
  const allEligible=state.participants.filter(participant=>`${participant.name} ${participant.seat} ${participant.center}`.toLowerCase().includes(query)).filter(participant=>centerFilter==="all"||participant.center===centerFilter);
  const eligible=allEligible.filter(participant=>filter==="all"||statusOf(participant)===filter).sort((a,b)=>(statusOrder[statusOf(a)]-statusOrder[statusOf(b)])||String(a.name).localeCompare(String(b.name),"ar"));
  $("#committeePendingCount").textContent=formatNumber(allEligible.filter(participant=>["no_draw","pending"].includes(statusOf(participant))).length);
  $("#committeeActiveCount").textContent=formatNumber(allEligible.filter(participant=>statusOf(participant)==="in_progress").length);
  $("#committeeCompletedCount").textContent=formatNumber(allEligible.filter(participant=>["final","manual_dr"].includes(statusOf(participant))).length);
  const COMMITTEE_STUDENTS_PAGE_SIZE=15;
  const committeePageSignature=JSON.stringify([query,filter,centerFilter]);
  if(committeePageSignature!==committeeStudentsPageSignature){committeeStudentsPage=1;committeeStudentsPageSignature=committeePageSignature}
  const committeeTotalPages=Math.max(1,Math.ceil(eligible.length/COMMITTEE_STUDENTS_PAGE_SIZE));
  committeeStudentsPage=Math.min(Math.max(1,committeeStudentsPage),committeeTotalPages);
  const eligiblePage=eligible.slice((committeeStudentsPage-1)*COMMITTEE_STUDENTS_PAGE_SIZE,committeeStudentsPage*COMMITTEE_STUDENTS_PAGE_SIZE);
  renderPagerTabs("committeeStudentsPager",committeeStudentsPage,committeeTotalPages,page=>{committeeStudentsPage=page;renderCommitteeStudents()});
  $("#committeeStudents").innerHTML=eligiblePage.length?eligiblePage.map(participant=>{
    const draw=drawByParticipant.get(participant.id),session=sessionByParticipant.get(participant.id),status=statusOf(participant);
    const canSeeScore=committee.show_score!==false;
    const statusText=status==="manual_dr"?(canSeeScore?`مسجّلة يدويًا من الإدارة · ${participant.score}`:"مسجّلة يدويًا من الإدارة"):status==="no_draw"?"لم يتم السحب بعد":status==="final"?(canSeeScore?`مكتمل · ${session.score}`:"مكتمل · العلامة غير ظاهرة للجنة"):status==="in_progress"?"مسودة محفوظة":"جاهز للاختبار";
    const canSelfDrawThis=Boolean(committee?.can_self_draw)&&!draw&&!(participant.parts?.length);
    const positions=draw?`<ol class="committee-position-preview">${draw.positions.map((position,index)=>`<li><b>${index+1}</b><span>${escapeHtml(positionTitle(position))}</span><small>الجزء ${position.juz} · صفحة ${position.page}</small></li>`).join("")}</ol>`:canSelfDrawThis?`<div class="committee-no-draw">لم تُسجَّل أجزاء هذا المتسابق بعد — يمكنكم تسجيلها وتنفيذ السحب مباشرة</div>`:`<div class="committee-no-draw">بانتظار قيام الإدارة بإجراء السحب لهذا المتسابق</div>`;
    const action=status==="manual_dr"?`<button class="secondary-btn" disabled>سُجلت العلامة يدويًا من الإدارة</button>`:canSelfDrawThis?`<button class="primary-btn" data-self-draw="${participant.id}">تسجيل الأجزاء وتنفيذ السحب</button>`:!draw?`<button class="secondary-btn" disabled>بانتظار سحب الإدارة</button>`:`<button class="${status==="final"?"secondary-btn":"primary-btn"}" data-committee-student="${participant.id}">${status==="final"?"عرض التقييم":status==="in_progress"?"متابعة الرصد":"بدء تسجيل الأخطاء"}</button>`;
    return `<article class="committee-student ${status}"><div><h3>${escapeHtml(participant.name)}</h3><p>${escapeHtml(participant.center)} · رقم الجلوس ${escapeHtml(participant.seat)}</p><div class="committee-student-meta"><span>${participant.level} أجزاء</span>${draw?`<span>${draw.positions.length} مواضع</span>`:""}<span class="state ${status==="final"||status==="manual_dr"?"completed":status==="in_progress"?"drawn":status==="no_draw"?"not-drawn":""}">${statusText}</span></div>${positions}</div>${action}</article>`;
  }).join(""):`<div class="committee-empty"><b>لا يوجد متسابقون بهذه الحالة</b><p>غيّر حالة الفرز أو عبارة البحث لعرض بقية الطلاب.</p></div>`;
  $$(`[data-committee-student]`).forEach(button=>button.onclick=()=>startCommitteeExam(button.dataset.committeeStudent));
  $$(`[data-self-draw]`).forEach(button=>button.onclick=()=>openCommitteeSelfDrawModal(button.dataset.selfDraw));
  lucide.createIcons();
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
      const usedIds=new Set(await window.CloudCompetition.listCommitteeUsedPositionIds());
      const committeeAvailableForParts=juzList=>{const pool=candidates.filter(c=>juzList.includes(c.juz));const unused=pool.filter(c=>!usedIds.has(c.id));return unused.length?unused:pool};
      const pools=new Map(parts.map(j=>[j,committeeAvailableForParts([j])]));
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
async function startCommitteeExam(participantId){const participant=state.participants.find(item=>item.id===participantId);let draw=state.draws.find(item=>item.participantId===participantId);if(!participant)return toast("المتسابق غير موجود");if(participant.scoreSource==="manual"&&participant.manualEntryBy)return toast("عُلامة هذا المتسابق مسجّلة يدويًا من الإدارة؛ لا يمكن فتح تقييم إلكتروني له إلا بعد إلغاء التسجيل اليدوي من الإدارة");const role=currentExaminerRole();const unfinished=state.participants.find(p=>p.id!==participantId&&p.assessment?.examinerRole===role&&p.assessment?.status==="draft"&&!(role==="member"&&p.assessment?.memberSubmittedAt));if(unfinished)return toast(`أنهِ اختبار «${unfinished.name}» أولاً (لا يزال قيد الاختبار) قبل بدء اختبار متسابق آخر`);if(!draw)return toast("بانتظار قيام الإدارة بإجراء السحب لهذا المتسابق");let session=committeeSessions.find(item=>item.participant_id===participantId);try{await ensureQuranReady();if(!session){session=await window.CloudCompetition.claimStudent(participant.id,draw.id,participant.level);committeeSessions.unshift(session);await window.CloudCompetition.log("claim","participant",participant.id,{drawId:draw.id,level:participant.level})}activeCloudSession=session;const cloudDraft=session.assessment&&Object.keys(session.assessment).length?session.assessment:null,localDraft=loadLocalAssessmentDraft(participant.id),newestDraft=localDraft?.drawId===draw.id&&new Date(localDraft.updatedAt||0)>new Date(cloudDraft?.updatedAt||0)?localDraft:cloudDraft;if(newestDraft)participant.assessment=newestDraft;if(session.status==="final"){localStorage.removeItem(ASSESSMENT_DRAFT_PREFIX+participant.id);return openCompletedAssessment(draw,participant,session)}openElectronicAssessment(draw,session)}catch(error){toast(error.message);await renderCommitteeWorkspace()}}
function navigate(view,{historyMode="push",ui=null}={}){if(!$("#"+view+"View"))view="dashboard";localStorage.setItem(currentViewKey(),view);if(ui)restoreListControls(ui);$$(`.view`).forEach(v=>v.classList.toggle("active-view",v.id===`${view}View`));$$(`[data-view]`).forEach(b=>b.classList.toggle("active",b.dataset.view===view));$(".sidebar").classList.remove("open");if(view!=="monitor")stopMonitorPoll();if(view==="draw"){refreshDrawParticipants();const count=$("#availableCount");if(count&&!integrity.valid)count.textContent="تُجهّز بيانات القرآن عند السحب"}if(view==="participants")renderParticipants();if(view==="history")renderHistory();if(view==="examDuration")renderExamDurations();if(view==="analytics")renderAnalytics();if(view==="settings")populateRenameCenterOptions();if(view==="other")renderOtherParticipants();if(view==="monitor")renderMonitorView();if(historyMode!=="none")recordBrowserRoute({surface:"admin",view},{replace:historyMode==="replace"});requestAnimationFrame(()=>window.scrollTo(0,ui?.scrollY||0));lucide.createIcons()}
function renderAll(){renderDashboard();renderParticipants();renderHistory();refreshDrawParticipants();renderAnalytics();lucide.createIcons()}

function passRateOf(list){const examined=list.filter(p=>Number.isFinite(p.score));return examined.length?examined.filter(p=>p.score>=PASS_SCORE).length/examined.length*100:null}
function formatPct(n){return n==null?"—":`${new Intl.NumberFormat("ar-JO",{maximumFractionDigits:1,numberingSystem:"latn"}).format(n)}%`}
function renderPassRateRing(ringId,valueId,pct){const ring=$(`#${ringId}`),value=$(`#${valueId}`);if(!ring||!value)return;const empty=pct==null;ring.classList.toggle("is-empty",empty);ring.style.setProperty("--pct",empty?0:Math.max(0,Math.min(100,pct)));value.textContent=empty?"لا يوجد بيانات":formatPct(pct)}
function renderDashboard(){
  const byGender=(list,g)=>list.filter(p=>p.gender===g);
  const total=state.participants;
  const examined=total.filter(p=>Number.isFinite(p.score));
  const passed=examined.filter(p=>p.score>=PASS_SCORE);
  const failed=examined.filter(p=>p.score<PASS_SCORE);
  $("#statTotal").textContent=formatNumber(total.length);
  $("#statTotalM").textContent=formatNumber(byGender(total,"ذكر").length);
  $("#statTotalF").textContent=formatNumber(byGender(total,"أنثى").length);
  $("#statExamined").textContent=formatNumber(examined.length);
  $("#statExaminedM").textContent=formatNumber(byGender(examined,"ذكر").length);
  $("#statExaminedF").textContent=formatNumber(byGender(examined,"أنثى").length);
  $("#statPassed").textContent=formatNumber(passed.length);
  $("#statPassedM").textContent=formatNumber(byGender(passed,"ذكر").length);
  $("#statPassedF").textContent=formatNumber(byGender(passed,"أنثى").length);
  $("#statFailed").textContent=formatNumber(failed.length);
  $("#statFailedM").textContent=formatNumber(byGender(failed,"ذكر").length);
  $("#statFailedF").textContent=formatNumber(byGender(failed,"أنثى").length);
  renderPassRateRing("passRateAllRing","passRateAll",passRateOf(total));
  renderPassRateRing("passRateMRing","passRateM",passRateOf(byGender(total,"ذكر")));
  renderPassRateRing("passRateFRing","passRateF",passRateOf(byGender(total,"أنثى")));
  renderLevelBreakdown(total);
}
function renderLevelBreakdown(total){
  const UNRESOLVED="__unresolved__";
  // على لوحة التحكم فقط (وليس بقية الموقع): مستويات السادس (10 أجزاء) والسابع (5 أجزاء) تُدمج بغض النظر
  // عن الفئة العمرية أ/ب، لأن التقسيم الدقيق غير مفيد هنا ولأن أغلب المتسابقين القدامى بلا عمر مسجَّل أصلاً.
  const dashboardGroupKey=p=>{const parts=Number(p.level);if(parts===10)return "merged-10";if(parts===5)return "merged-5";return resolveParticipantLevelId(p)||UNRESOLVED};
  const groups=new Map();
  for(const p of total){const key=dashboardGroupKey(p);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p)}
  const showFull=Boolean(state.config?.showFullQuranStats);
  const labelFor=key=>key==="merged-10"?"المستوى السادس (حفظ 10 أجزاء)":key==="merged-5"?"المستوى السابع (حفظ 5 أجزاء)":key===UNRESOLVED?"مستوى غير محدد (يحتاج تصحيح)":(levelCatalogById(key)?.label||key);
  const partsFor=key=>key==="merged-10"?10:key==="merged-5"?5:key===UNRESOLVED?0:(levelCatalogById(key)?.parts??0);
  // بطاقة "غير محدد" لا تظهر هنا عمداً بناءً على طلب صريح — لا تفيد بشكل تلخيصي، وتصحيح هؤلاء المتسابقين
  // يبقى متاحاً من زر "إصلاح تسميات المستويات القديمة" بالإعدادات، أو تعديل كل واحد يدوياً.
  const orderedKeys=[...groups.keys()].filter(key=>key!==UNRESOLVED&&(showFull||partsFor(key)<30)).sort((a,b)=>partsFor(a)-partsFor(b)||labelFor(a).localeCompare(labelFor(b),"ar"));
  const cards=orderedKeys.map(key=>{
    const list=groups.get(key),m=byGenderList(list,"ذكر"),f=byGenderList(list,"أنثى");
    return `<article class="level-card${key===UNRESOLVED?" level-card-unresolved":""}"><h4>${escapeHtml(labelFor(key))}</h4><div class="level-card-row"><span>عدد الطلاب</span><b>${formatNumber(list.length)}</b></div><div class="stat-split"><span class="split-m">ذكور <b>${formatNumber(m.length)}</b></span><span class="split-f">إناث <b>${formatNumber(f.length)}</b></span></div><div class="level-card-row"><span>نسبة النجاح</span><b>${formatPct(passRateOf(list))}</b></div><div class="stat-split"><span class="split-m">ذكور <b>${formatPct(passRateOf(m))}</b></span><span class="split-f">إناث <b>${formatPct(passRateOf(f))}</b></span></div></article>`;
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
      const item={id:participant?.id||uid("P"),name:$("#pName").value.trim(),seat:$("#pSeat").value.trim(),gender:$("#pGender").value,center:$("#pCenter").value.trim(),branch:BRANCH_NAME,phone:$("#pPhone").value.trim()||null,age:Number($("#pAge").value)||null,level,levelName,parts,createdAt:participant?.createdAt||new Date().toISOString()};
      if(!resetRequired){item.score=participant?.score;item.gradedAt=participant?.gradedAt;item.scoreSource=participant?.scoreSource;item.assessment=participant?.assessment}
      if(resetRequired&&oldDraw){state.deletions=state.deletions||[];state.deletions.push({type:"draw-parts-changed",drawId:oldDraw.id,participantId:participant.id,name:participant.name,oldParts:drawParts.length?drawParts:oldParts,newParts:parts,at:new Date().toISOString()});state.draws=state.draws.filter(draw=>draw.participantId!==participant.id);committeeSessions=committeeSessions.filter(session=>session.participant_id!==participant.id)}
      const index=state.participants.findIndex(p=>p.id===item.id);if(index>=0)state.participants[index]=item;else state.participants.push(item);
      saveState();if(resetRequired&&oldDraw&&cloudEnabled){if(window.CloudCompetition.context?.kind==="supervisor")await window.CloudCompetition.saveSupervisorState(state);else await window.CloudCompetition.saveCompetitionState(state);await window.CloudCompetition.deleteParticipantSession(participant.id)}closeModal();renderAll();toast(resetRequired&&oldDraw?"تم تصحيح الأجزاء وإلغاء السحب والتقييم القديم وإعادة المتسابق لانتظار السحب":"تم حفظ بيانات المتسابق");
    }catch(error){state=stateBeforeEdit;localStorage.setItem(activeStorageKey(),JSON.stringify(state));renderAll();toast(`تعذر تعديل أجزاء المتسابق: ${error.message}`);button.disabled=false}
  });
}
function nextSeat(){return String(state.participants.length+1).padStart(3,"0")}
function nextDrawSequence(){return Math.max(0,...state.draws.map(draw=>Number(draw.sequence)||0))+1}
function populateParticipantFilterOptions(){
  const centerSelect=$("#participantCenterFilter"),levelSelect=$("#participantLevelFilter");
  const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  const currentCenter=centerSelect.value,currentLevel=levelSelect.value;
  centerSelect.innerHTML=`<option value="all">المركز: الكل</option>`+centers.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  // قائمة ثابتة من LEVEL_CATALOG دائماً — لا تُشتق من بيانات المتسابقين، حتى لا تظهر مسميات قديمة أو أرقام أجزاء خام.
  levelSelect.innerHTML=`<option value="all">المستوى: الكل</option>`+LEVEL_CATALOG.map(l=>`<option value="${l.id}">${escapeHtml(l.label)}</option>`).join("");
  centerSelect.value=centers.includes(currentCenter)?currentCenter:"all";
  levelSelect.value=LEVEL_CATALOG.some(l=>l.id===currentLevel)?currentLevel:"all";
}
function renderParticipants(){
  populateParticipantFilterOptions();
  const query=$("#participantSearch").value.trim().toLowerCase(),filter=$("#participantFilter").value,genderFilter=$("#participantGenderFilter").value,centerFilter=$("#participantCenterFilter").value,levelFilter=$("#participantLevelFilter").value,drawByParticipant=new Map(state.draws.filter(d=>d.participantId).map(d=>[d.participantId,d]));
  const statusOf=p=>Number.isFinite(p.score)?"completed":drawByParticipant.has(p.id)?"drawn":"pending";
  const list=state.participants.filter(p=>[p.name,p.seat,p.center].some(x=>String(x).toLowerCase().includes(query))).filter(p=>filter==="all"||statusOf(p)===filter).filter(p=>genderFilter==="all"||p.gender===genderFilter).filter(p=>centerFilter==="all"||p.center===centerFilter).filter(p=>levelFilter==="all"||resolveParticipantLevelId(p)===levelFilter);
  $("#participantFilterCount").textContent=list.length===state.participants.length?`${formatNumber(list.length)} متسابق`:`${formatNumber(list.length)} من ${formatNumber(state.participants.length)} متسابق`;
  const isSubAdmin=window.CloudCompetition?.context?.kind==="subAdmin",isSupervisor=window.CloudCompetition?.context?.kind==="supervisor",isMainAdmin=operationMode==="cloud"?window.CloudCompetition?.context?.kind==="admin":true;
  $("#participantsTable").closest(".table-wrap").classList.toggle("is-empty",!list.length);
  const PARTICIPANTS_PAGE_SIZE=50;
  const pageSignature=JSON.stringify([query,filter,genderFilter,centerFilter,levelFilter]);
  if(pageSignature!==participantsPageSignature){participantsPage=1;participantsPageSignature=pageSignature}
  const participantsTotalPages=Math.max(1,Math.ceil(list.length/PARTICIPANTS_PAGE_SIZE));
  participantsPage=Math.min(Math.max(1,participantsPage),participantsTotalPages);
  const listPage=list.slice((participantsPage-1)*PARTICIPANTS_PAGE_SIZE,participantsPage*PARTICIPANTS_PAGE_SIZE);
  renderPagerTabs("participantsPager",participantsPage,participantsTotalPages,page=>{participantsPage=page;renderParticipants()});
  $("#participantsTable").innerHTML=listPage.length?listPage.map(p=>{const status=statusOf(p),hasDraw=drawByParticipant.has(p.id),passed=Number.isFinite(p.score)&&p.score>=PASS_SCORE,isManualDr=p.scoreSource==="manual"&&Boolean(p.manualEntryBy),hasPendingDr=p.drRequest?.status==="pending";let scoreCell;if(isManualDr){scoreCell=`<div class="dr-score-cell"><b>${p.score}</b><small class="manual-dr-tag">مسجّلة يدويًا${p.manualEntryBy?` · ${escapeHtml(p.manualEntryBy)}`:""}</small>${(isMainAdmin||isSupervisor)?`<button class="compact-btn danger-compact" data-cancel-dr="${p.id}">إلغاء التسجيل اليدوي</button>`:""}</div>`}else if(hasPendingDr){scoreCell=`<span class="score-help">طلب DR بانتظار الموافقة (${formatAssessmentNumber(p.drRequest.score)})</span>`}else if(!hasDraw){scoreCell=`<span class="score-help">تُدخل بعد إجراء السحب</span>`}else if(isSubAdmin){scoreCell=`<button class="compact-btn" data-request-dr="${p.id}"><i data-lucide="file-edit"></i> طلب DR</button>`}else if(!canEditParticipantScore(p)){scoreCell=`<span class="score-help">نتيجة معتمدة إلكترونيًا · ${formatAssessmentNumber(p.score)} (تعديلها يتطلب صلاحية خاصة)</span>`}else{scoreCell=`<input class="score-input ${Number.isFinite(p.score)?"score-saved":""}" data-score="${p.id}" type="number" min="0" max="100" step="0.01" value="${Number.isFinite(p.score)?p.score:""}" placeholder="أدخل العلامة">`}return `<tr><td><strong>${escapeHtml(p.seat)}</strong></td><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.gender||"غير محدد")}</td><td>${p.center?escapeHtml(p.center):`<span class="missing-center-tag">⚠ بلا مركز</span>`}</td><td>${escapeHtml(p.levelName||`${p.level} أجزاء`)}</td><td>${status==="completed"?`<span class="state completed">مكتمل</span><span class="outcome ${passed?"pass":"fail"}">${passed?"ناجح":"راسب"}</span>${p.scoreSource==="electronic"?`<small class="electronic-score-tag">تقييم إلكتروني</small>`:""}`:`<span class="state ${status}">${status==="drawn"?"تم السحب · أدخل العلامة":"لم يُسحب بعد"}</span>`}</td><td>${scoreCell}</td><td><div class="row-actions">${hasDraw?`<button class="compact-btn" data-result-participant="${p.id}"><i data-lucide="eye"></i> النتيجة</button>`:`<button class="compact-btn" data-draw="${p.id}"><i data-lucide="sparkles"></i> إجراء السحب</button>`}<details class="dropdown-menu row-actions-more"><summary class="icon-btn" title="المزيد من الإجراءات"><i data-lucide="more-vertical"></i></summary><div class="row-actions-more-list"><button class="compact-btn" data-edit="${p.id}"><i data-lucide="pencil"></i> تعديل</button>${operationMode==="cloud"?`<button class="compact-btn" data-assign-committee="${p.id}"><i data-lucide="shuffle"></i> نقل</button>`:""}${isSubAdmin?"":`<button class="compact-btn danger-compact" data-delete-participant="${p.id}"><i data-lucide="trash-2"></i> حذف</button>`}</div></details></div></td></tr>`}).join(""):`<tr><td class="table-empty" colspan="8">لا توجد أسماء مطابقة</td></tr>`;
  $$(`[data-edit]`).forEach(b=>b.onclick=()=>openParticipantModal(state.participants.find(p=>p.id===b.dataset.edit)));
  $$(`[data-assign-committee]`).forEach(b=>b.onclick=()=>openAssignCommitteeModal(b.dataset.assignCommittee));
  $$(`[data-draw]`).forEach(b=>b.onclick=()=>{navigate("draw");$("#drawParticipant").value=b.dataset.draw;loadParticipantIntoDraw()});lucide.createIcons();
  $$(`[data-result-participant]`).forEach(button=>button.onclick=()=>showResult(drawByParticipant.get(button.dataset.resultParticipant)));
  $$(`[data-delete-participant]`).forEach(button=>button.onclick=()=>confirmDeleteParticipant(button.dataset.deleteParticipant));
  $$(`[data-score]`).forEach(input=>input.onchange=()=>saveParticipantScore(input));
  $$(`[data-request-dr]`).forEach(button=>button.onclick=()=>openRequestDrModal(button.dataset.requestDr));
  $$(`[data-cancel-dr]`).forEach(button=>button.onclick=()=>cancelManualDrScore(button.dataset.cancelDr));
}
function openRequestDrModal(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;openModal(`<div class="modal-head"><h2>طلب تسجيل يدوي (DR)</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help"><b>${escapeHtml(participant.name)}</b> — يُستخدم فقط عند تعطل النظام وتحويل الاختبار لورقي. يُرسل الطلب للإدارة الرئيسية للموافقة قبل تسجيل العلامة فعليًا.</p><label>العلامة من 100<input id="drRequestScore" type="number" min="0" max="100" step="0.01" placeholder="مثال: 88"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="submitDrRequest" class="primary-btn">إرسال الطلب للإدارة</button></div>`);$("#submitDrRequest").onclick=()=>{const score=Number($("#drRequestScore").value);if(!Number.isFinite(score)||score<0||score>100)return toast("أدخل علامة صحيحة بين 0 و100");participant.drRequest={status:"pending",score:Math.round(score*100)/100,requestedBy:currentActorLabel(),requestedAt:new Date().toISOString()};saveState();closeModal();renderParticipants();toast("تم إرسال الطلب للإدارة، بانتظار الموافقة")}}
function cancelManualDrScore(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;if(!confirm(`إلغاء التسجيل اليدوي لـ ${participant.name}؟ سيعود المتسابق لحالة بانتظار العلامة ويمكن فتح تقييم إلكتروني جديد له.`))return;delete participant.score;delete participant.gradedAt;delete participant.scoreSource;delete participant.manualEntryBy;participant.assessment=null;saveState();renderAll();toast("تم إلغاء التسجيل اليدوي، المتسابق بانتظار العلامة من جديد")}
function renderDrRequests(){const pending=state.participants.filter(p=>p.drRequest?.status==="pending");$("#drRequestsList").innerHTML=pending.length?pending.map(p=>`<div class="committee-row"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.drRequest.requestedBy||"")} · العلامة المطلوبة ${formatAssessmentNumber(p.drRequest.score)} · ${formatDate(p.drRequest.requestedAt)}</small></div><span>${escapeHtml(p.gender||"")}</span><div class="row-actions"><button class="compact-btn" data-approve-dr="${p.id}">موافقة</button><button class="compact-btn danger-compact" data-reject-dr="${p.id}">رفض</button></div></div>`).join(""):`<p class="committee-alerts-empty">لا توجد طلبات حاليًا.</p>`;$$(`[data-approve-dr]`).forEach(button=>button.onclick=()=>{approveDrRequest(button.dataset.approveDr);renderDrRequests();renderParticipants()});$$(`[data-reject-dr]`).forEach(button=>button.onclick=()=>{rejectDrRequest(button.dataset.rejectDr);renderDrRequests();renderParticipants()})}
function approveDrRequest(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant?.drRequest)return;participant.score=participant.drRequest.score;participant.gradedAt=new Date().toISOString();participant.scoreSource="manual";participant.manualEntryBy=participant.drRequest.requestedBy;participant.assessment=null;delete participant.drRequest;saveState();toast(`تم اعتماد علامة ${participant.name} يدويًا`)}
function rejectDrRequest(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant?.drRequest)return;delete participant.drRequest;saveState();toast(`تم رفض طلب ${participant.name}`)}
function approveAllDrRequests(){const pending=state.participants.filter(p=>p.drRequest?.status==="pending");if(!pending.length)return toast("لا توجد طلبات بانتظار الموافقة");pending.forEach(p=>approveDrRequest(p.id));renderDrRequests();renderParticipants();toast(`تمت الموافقة على ${pending.length} طلباً`)}
function currentActorLabel(){const kind=window.CloudCompetition?.context?.kind;if(kind==="subAdmin")return `مسؤول فرعي: ${window.CloudCompetition.context.subAdmin.name}`;if(kind==="supervisor")return `مشرف المسابقة: ${window.CloudCompetition.context.profile.display_name}`;if(kind==="admin")return "الإدارة";return state.config?.adminName||"الإدارة"}
function canEditParticipantScore(participant){const kind=window.CloudCompetition?.context?.kind;if(kind==="subAdmin")return false;if(kind==="supervisor"&&participant?.scoreSource==="electronic"&&!window.CloudCompetition.context?.profile?.can_edit_final)return false;return true}
function saveParticipantScore(input){const participant=state.participants.find(p=>p.id===input.dataset.score);if(!participant)return;const score=Number(input.value);if(input.value===""){delete participant.score;delete participant.gradedAt;delete participant.scoreSource;delete participant.manualEntryBy;participant.assessment=null}else if(!Number.isFinite(score)||score<0||score>100){toast("العلامة يجب أن تكون بين 0 و100");input.value=Number.isFinite(participant.score)?participant.score:"";return}else{participant.score=Math.round(score*100)/100;participant.gradedAt=new Date().toISOString();participant.scoreSource="manual";participant.manualEntryBy=currentActorLabel();participant.assessment=null;delete participant.drRequest}saveState();renderDashboard();renderParticipants();toast(Number.isFinite(participant.score)?"تم حفظ العلامة اليدوية، وأُلغيت أي خطوات تقييم إلكتروني سابقة لهذا المتسابق":"تم حذف العلامة وإعادة الحالة إلى بانتظار العلامة")}
function openAssignCommitteeModal(participantId){
  const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;
  const isSubAdmin=window.CloudCompetition.context?.kind==="subAdmin",allCommittees=isSubAdmin?subAdminCommittees:cloudCommittees;
  const committees=allCommittees.filter(c=>c.active!==false&&(!c.responsible_gender||c.responsible_gender===participant.gender));
  const committeeLabel=c=>{const names=[c.chairman_name,c.member_name].filter(Boolean).join(" - ");return names?`${c.name} (${names})`:c.name};
  const matchesNaturally=c=>participant.levelName?(c.level_names||[]).includes(participant.levelName):(c.levels||[]).map(Number).includes(Number(participant.level));
  const pinnedId=participant.transferCommitteeId||null;
  const naturalCommittee=pinnedId?null:committees.find(matchesNaturally);
  const currentId=pinnedId||naturalCommittee?.id||null,currentCommittee=currentId?committees.find(c=>c.id===currentId):null;
  const options=committees.filter(c=>c.id!==currentId);
  const rows=options.length?options.map(c=>`<label class="committee-member-toggle"><input type="radio" name="transferTarget" data-transfer-target="${c.id}"> ${escapeHtml(committeeLabel(c))}</label>`).join(""):`<p>لا توجد لجان أخرى متاحة.</p>`;
  const currentInfo=pinnedId?`اللجنة الحالية (نُقل يدويًا): <b>${escapeHtml(currentCommittee?committeeLabel(currentCommittee):"—")}</b>`:currentCommittee?`اللجنة الحالية (حسب مستواه الطبيعي): <b>${escapeHtml(committeeLabel(currentCommittee))}</b>`:"لم يُنقل يدويًا ولا توجد لجنة مطابقة لمستواه حاليًا.";
  openModal(`<div class="modal-head"><h2>نقل ${escapeHtml(participant.name)}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">${currentInfo} اختيار لجنة أخرى ينقل المتسابق إليها فورًا ويُخفيه عن لجنته الحالية.</p><div class="committee-member-fields">${rows}</div>${pinnedId?`<button type="button" id="cancelTransferBtn" class="secondary-btn">إلغاء النقل (إعادة لمستواه الأصلي)</button>`:""}</div><div class="modal-actions"><button class="primary-btn" type="button" data-close>تم</button></div>`);
  const doTransfer=async(committeeId,confirmMessage)=>{if(confirmMessage&&!confirm(confirmMessage))return openAssignCommitteeModal(participantId);try{await window.CloudCompetition.transferParticipant(participantId,committeeId);participant.transferCommitteeId=committeeId||undefined;toast(committeeId?"تم نقل المتسابق":"تم إلغاء النقل")}catch(error){toast(error.message)}openAssignCommitteeModal(participantId)};
  $$(`[data-transfer-target]`).forEach(input=>input.onchange=()=>{const targetId=input.dataset.transferTarget,target=committees.find(c=>c.id===targetId);doTransfer(targetId,`نقل ${participant.name} إلى ${target?committeeLabel(target):"اللجنة المختارة"}؟ سيختفي فورًا من لجنته الحالية.`)});
  if($("#cancelTransferBtn"))$("#cancelTransferBtn").onclick=()=>doTransfer(null,"إلغاء نقل المتسابق وإعادته لمستواه الأصلي؟");
}
function confirmDeleteParticipant(participantId){const participant=state.participants.find(p=>p.id===participantId);if(!participant)return;const draws=state.draws.filter(d=>d.participantId===participantId);openModal(`<div class="modal-head"><h2>حذف المتسابق</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>هل تريد حذف <b>${escapeHtml(participant.name)}</b>؟</p>${draws.length?`<p class="form-error">للمتسابق ${draws.length} سحب محفوظ. سيُحذف معه وتصبح مواضعه متاحة من جديد.</p>`:"<p>لا يوجد لهذا المتسابق سحب محفوظ.</p>"}</div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="deleteParticipantNow" class="danger-btn"><i data-lucide="trash-2"></i> حذف نهائي</button></div>`);$("#deleteParticipantNow").onclick=()=>{state.deletions=state.deletions||[];state.deletions.push({type:"participant",participant:{id:participant.id,name:participant.name,seat:participant.seat},drawIds:draws.map(d=>d.id),at:new Date().toISOString()});state.participants=state.participants.filter(p=>p.id!==participantId);state.draws=state.draws.filter(d=>d.participantId!==participantId);saveState();closeModal();renderAll();toast("تم حذف المتسابق وسحوباته")}}
function confirmDeleteAllParticipants(){if(!state.participants.length)return toast("لا يوجد متسابقون لحذفهم");openModal(`<div class="modal-head"><h2>حذف جميع المتسابقين</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سيتم حذف <b>${state.participants.length} متسابقاً</b> من الدورة.</p><p class="form-error">سيتم أيضاً حذف جميع السحوبات والعلامات، وتصبح المواضع متاحة من جديد. إعدادات المسابقة لن تتغير.</p><label>اكتب <b>حذف المتسابقين</b> للتأكيد<input id="deleteAllParticipantsConfirm" autocomplete="off"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="deleteAllParticipantsNow" class="danger-btn"><i data-lucide="trash-2"></i> حذف الجميع</button></div>`);$("#deleteAllParticipantsNow").onclick=()=>{if($("#deleteAllParticipantsConfirm").value.trim()!=="حذف المتسابقين")return toast("اكتب عبارة التأكيد كما تظهر");state.deletions=state.deletions||[];state.deletions.push({type:"all-participants",participantCount:state.participants.length,drawCount:state.draws.length,at:new Date().toISOString()});state.participants=[];state.draws=[];saveState();closeModal();renderAll();toast("تم حذف جميع المتسابقين والسحوبات")}}

function nextOtherSeat(){return String(otherState.participants.length+1).padStart(3,"0")}
function openOtherParticipantModal(participant=null){
  const resolvedLevelId=resolveParticipantLevelId(participant);
  openModal(`<form id="otherParticipantForm"><div class="modal-head"><h2>${participant?"تعديل بيانات المتسابق":"إضافة متسابق"}</h2><button type="button" class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p class="field-help">سحب منفصل تماماً عن المسابقة السنوية، بنفس قواعد السحب والمستويات، ولا يدخل في إحصائياتها. محفوظ على هذا الجهاز فقط.</p><div class="form-grid"><label>اسم المتسابق<input id="opName" required value="${escapeAttr(participant?.name||"")}"></label><label>رقم الجلوس<input id="opSeat" required value="${escapeAttr(participant?.seat||nextOtherSeat())}"></label><label>الجنس<select id="opGender" required><option value="">اختر</option><option value="ذكر" ${participant?.gender==="ذكر"?"selected":""}>ذكر</option><option value="أنثى" ${participant?.gender==="أنثى"?"selected":""}>أنثى</option></select></label><label>المركز<input id="opCenter" required value="${escapeAttr(participant?.center||"")}"></label><label>العمر<input id="opAge" type="number" min="4" max="100" value="${participant?.age||""}" placeholder="اختياري"></label><label>المستوى<select id="opLevel" required><option value="">اختر المستوى</option>${LEVEL_CATALOG.map(l=>`<option value="${l.id}" ${l.id===resolvedLevelId?"selected":""}>${escapeHtml(l.label)}</option>`).join("")}</select></label></div></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button class="primary-btn" type="submit">حفظ المتسابق</button></div></form>`);
  $("#otherParticipantForm").addEventListener("submit",event=>{
    event.preventDefault();
    const catalogEntry=levelCatalogById($("#opLevel").value);
    if(!catalogEntry)return toast("اختر المستوى من القائمة");
    const newOpSeat=$("#opSeat").value.trim();
    if(newOpSeat&&otherState.participants.some(p=>p.id!==(participant?.id||null)&&String(p.seat).trim()===newOpSeat))return toast(`رقم الجلوس ${newOpSeat} مسجَّل مسبقًا لمتسابق آخر — استخدم رقمًا مختلفًا`);
    const level=catalogEntry.parts,levelDiffers=Boolean(participant)&&Number(participant.level)!==level,item={id:participant?.id||uid("OP"),name:$("#opName").value.trim(),seat:$("#opSeat").value.trim(),gender:$("#opGender").value,center:$("#opCenter").value.trim(),age:Number($("#opAge").value)||null,level,levelName:catalogEntry.label,parts:levelDiffers?[]:(participant?.parts||[]),createdAt:participant?.createdAt||new Date().toISOString()};
    if(levelDiffers&&participant){otherState.draws=otherState.draws.filter(draw=>draw.participantId!==participant.id)}
    const index=otherState.participants.findIndex(p=>p.id===item.id);if(index>=0)otherState.participants[index]=item;else otherState.participants.push(item);
    saveOtherState();closeModal();renderOtherParticipants();toast(levelDiffers&&participant?"تم حفظ البيانات وإلغاء السحب السابق بسبب تغيير المستوى":"تم حفظ بيانات المتسابق");
  });
}
function otherUsedCandidateIds(){return new Set(otherState.draws.flatMap(d=>d.positions.map(p=>p.id)))}
function otherLeastRepeatedCandidates(pool){if(!pool.length)return [];const counts=new Map();otherState.draws.forEach(draw=>draw.positions.forEach(position=>counts.set(position.id,(counts.get(position.id)||0)+1)));const minimum=Math.min(...pool.map(candidate=>counts.get(candidate.id)||0));return pool.filter(candidate=>(counts.get(candidate.id)||0)===minimum)}
function otherAvailableForParts(parts){const pool=candidates.filter(c=>parts.includes(c.juz)),used=otherUsedCandidateIds(),unused=pool.filter(c=>!used.has(c.id));return unused.length?unused:otherLeastRepeatedCandidates(pool)}
function nextOtherDrawSequence(){return Math.max(0,...otherState.draws.map(draw=>Number(draw.sequence)||0))+1}
async function makeOtherDraw(participant,parts){
  await ensureQuranReady();
  const count=LEVEL_QUESTIONS[Number(participant.level)]||3,pools=new Map(parts.map(juz=>[juz,otherAvailableForParts([juz])]));
  const eligible=parts.filter(juz=>pools.get(juz)?.length);
  if(eligible.length<count)throw new Error("لا توجد مواضع كافية ضمن أجزاء المتسابق");
  const positions=secureShuffle(eligible).slice(0,count).map(juz=>pools.get(juz)[randomIndex(pools.get(juz).length)]).sort((a,b)=>a.juz-b.juz);
  const draw={id:uid("ODRAW"),sequence:nextOtherDrawSequence(),participantId:participant.id,name:participant.name,seat:participant.seat,center:participant.center,age:participant.age||null,level:Number(participant.level),eligibleParts:[...parts],positions,createdAt:new Date().toISOString(),rerolls:[],verification:""};
  draw.verification=await createVerification(draw);
  return draw;
}
function openOtherPreDraw(participant){
  const original=participant.parts?.length===participant.level?participant.parts:[];
  openModal(`<div class="modal-head"><div><span class="eyebrow">سحب مستقل عن المسابقة السنوية</span><h2>${escapeHtml(participant.name)}</h2></div><button class="icon-btn" data-close title="إغلاق"><i data-lucide="x"></i></button></div><div class="modal-body"><p>حدد الأجزاء المشاركة ثم نفّذ السحب.</p><label>الأجزاء المشاركة (عددها ${participant.level})<input id="otherDrawParts" value="${escapeAttr(original.join(", "))}" placeholder="مثال: 1-10"></label><p id="otherDrawError" class="form-error hidden"></p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="confirmOtherDraw" class="primary-btn"><i data-lucide="sparkles"></i> تنفيذ السحب</button></div>`,"other-predraw-modal");
  $("#confirmOtherDraw").onclick=async()=>{
    const button=$("#confirmOtherDraw"),parts=parsePartSpec($("#otherDrawParts").value),error=$("#otherDrawError");
    if(parts.length!==participant.level){error.textContent=`يجب إدخال ${participant.level} جزءًا بالضبط`;return error.classList.remove("hidden")}
    button.disabled=true;button.textContent="جاري السحب...";
    try{
      const draw=await makeOtherDraw(participant,parts);
      participant.parts=parts;otherState.draws.push(draw);saveOtherState();
      closeModal();renderOtherParticipants();showOtherResult(draw);
    }catch(drawError){button.disabled=false;button.textContent="تنفيذ السحب";error.textContent=drawError.message;error.classList.remove("hidden")}
  };
  lucide.createIcons();
}
function showOtherResult(draw){
  openModal(`<div class="result-modal"><div class="print-only print-letterhead"><div><b>جمعية المحافظة على القرآن الكريم</b><span>فرع الكورة</span></div><strong>بسم الله الرحمن الرحيم</strong></div><div class="result-hero"><div><small>جمعية المحافظة على القرآن الكريم | فرع الكورة</small><h2>ورقة مواضع الاختبار</h2><small>سحب مستقل — لا يدخل في إحصائيات المسابقة السنوية</small></div><div class="draw-code"><small>رقم السحب</small><b>${draw.sequence.toString().padStart(4,"0")}</b><small>${escapeHtml(draw.verification)}</small></div></div><div class="result-person"><div><span>اسم المتسابق</span><b>${escapeHtml(draw.name)}</b></div><div><span>رقم الجلوس</span><b>${escapeHtml(draw.seat||"-")}</b></div><div><span>المركز</span><b>${escapeHtml(draw.center)}</b></div><div><span>مستوى الحفظ</span><b>${draw.level} أجزاء</b></div><div><span>العمر</span><b>${draw.age||"-"}</b></div></div><div class="positions-list"><div class="positions-title"><span>الرقم</span><span>الموضع المختار</span><span>الصفحة</span></div>${draw.positions.map((p,i)=>positionHtml(p,i)).join("")}</div><div class="print-only print-footer"><span>تصميم وتطوير م. مأمون محمود الفقيه</span><span>تحسين م. محمد عادل الفقيه</span></div><p class="result-warning">تم تثبيت هذه المواضع وإضافتها إلى قائمة المنع لهذا السحب المستقل.</p><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button><button class="primary-btn" onclick="window.print()"><i data-lucide="printer"></i> طباعة النتيجة</button></div></div>`,"result-modal");
  $(".result-modal .modal-actions .primary-btn").insertAdjacentHTML("beforebegin",`<button id="saveResultPdf" class="secondary-btn"><i data-lucide="file-down"></i> حفظ PDF</button>`);
  $("#saveResultPdf").onclick=()=>saveResultAsPdf(draw);
  lucide.createIcons();
  $(".print-letterhead").insertAdjacentHTML("afterbegin",`<img class="print-logo" src="assets/association-logo.png" alt="شعار جمعية المحافظة على القرآن الكريم">`);
  $(".print-letterhead>strong")?.remove();
  $(".print-footer").innerHTML=`<div class="developer-credit"><b>تصميم وتطوير</b><span>م. مأمون محمود الفقيه</span><span>م. محمد عادل الفقيه</span></div>`;
}
function confirmDeleteOtherParticipant(participantId){const participant=otherState.participants.find(p=>p.id===participantId);if(!participant)return;if(!confirm(`حذف ${participant.name} وأي سحب محفوظ له؟`))return;otherState.participants=otherState.participants.filter(p=>p.id!==participantId);otherState.draws=otherState.draws.filter(d=>d.participantId!==participantId);saveOtherState();renderOtherParticipants();toast("تم الحذف")}
function renderOtherParticipants(){
  const query=$("#otherParticipantSearch")?.value.trim().toLowerCase()||"";
  const drawByParticipant=new Map(otherState.draws.filter(d=>d.participantId).map(d=>[d.participantId,d]));
  const list=otherState.participants.filter(p=>[p.name,p.seat,p.center].some(x=>String(x).toLowerCase().includes(query)));
  $("#otherParticipantCount").textContent=`${formatNumber(list.length)} متسابق`;
  $("#otherParticipantsTable").closest(".table-wrap").classList.toggle("is-empty",!list.length);
  $("#otherParticipantsTable").innerHTML=list.length?list.map(p=>{const draw=drawByParticipant.get(p.id);return `<tr><td><strong>${escapeHtml(p.seat)}</strong></td><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.gender||"غير محدد")}</td><td>${p.center?escapeHtml(p.center):`<span class="missing-center-tag">⚠ بلا مركز</span>`}</td><td>${escapeHtml(p.levelName||`${p.level} أجزاء`)}</td><td><span class="state ${draw?"drawn":"pending"}">${draw?"تم السحب":"لم يُسحب بعد"}</span></td><td><div class="row-actions">${draw?`<button class="compact-btn" data-other-result="${p.id}"><i data-lucide="eye"></i> النتيجة</button>`:`<button class="compact-btn" data-other-draw="${p.id}"><i data-lucide="sparkles"></i> السحب</button>`}<button class="compact-btn" data-other-edit="${p.id}"><i data-lucide="pencil"></i> تعديل</button><button class="compact-btn danger-compact" data-other-delete="${p.id}"><i data-lucide="trash-2"></i> حذف</button></div></td></tr>`}).join(""):`<tr><td class="table-empty" colspan="7">لا يوجد متسابقون بعد</td></tr>`;
  $$(`[data-other-draw]`).forEach(b=>b.onclick=()=>openOtherPreDraw(otherState.participants.find(p=>p.id===b.dataset.otherDraw)));
  $$(`[data-other-result]`).forEach(b=>b.onclick=()=>showOtherResult(drawByParticipant.get(b.dataset.otherResult)));
  $$(`[data-other-edit]`).forEach(b=>b.onclick=()=>openOtherParticipantModal(otherState.participants.find(p=>p.id===b.dataset.otherEdit)));
  $$(`[data-other-delete]`).forEach(b=>b.onclick=()=>confirmDeleteOtherParticipant(b.dataset.otherDelete));
  lucide.createIcons();
}
function resultsExportRow(p){
  const hasScore=Number.isFinite(p.score);
  return {"المسابقة":state.config?.competitionName||"","المشارك":p.name,"الجنس":p.gender||"غير محدد","رقم المتسابق":p.seat,"الهاتف":p.phone||"","الفرع":p.branch||"","المركز":p.center||"","الأجزاء المشارك فيها":(p.parts||[]).join("،"),"المستوى":p.levelName||`${p.level} أجزاء`,"الروايات":p.recitation||"","علامة التصفية 1":hasScore?p.score:"","علامة التصفية 2":"","النتيجة":hasScore?(p.score>=PASS_SCORE?"ناجح":"راسب"):"غير مكتمل","الحالة":""};
}
function filterParticipantsFor(filters){return state.participants.filter(p=>(filters.gender==="all"||p.gender===filters.gender)&&(filters.center==="all"||p.center===filters.center)&&(filters.level==="all"||(p.levelName||`${p.level} أجزاء`)===filters.level))}
function openResultsFilterModal(title,onConfirm){
  const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
  openModal(`<div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid"><label>الجنس<select id="resultsFilterGender"><option value="all">الكل</option><option value="ذكر">ذكور</option><option value="أنثى">إناث</option></select></label><label>المركز<select id="resultsFilterCenter"><option value="all">الكل</option>${centers.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("")}</select></label><label>المستوى<select id="resultsFilterLevel"><option value="all">الكل</option>${LEVEL_CATALOG.map(l=>`<option value="${escapeAttr(l.label)}">${escapeHtml(l.label)}</option>`).join("")}</select></label></div></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="resultsFilterConfirm" class="primary-btn">تنزيل</button></div>`);
  $("#resultsFilterConfirm").onclick=()=>{const filters={gender:$("#resultsFilterGender").value,center:$("#resultsFilterCenter").value,level:$("#resultsFilterLevel").value};closeModal();onConfirm(filters)};
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
function genderCenterFieldsHtml(idPrefix,centers){return `<label>الجنس<select id="${idPrefix}Gender"><option value="all">الكل</option><option value="ذكر">ذكور</option><option value="أنثى">إناث</option></select></label><label>المركز<select id="${idPrefix}Center"><option value="all">الكل</option>${centers.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("")}</select></label>`}
async function openBulkPdfDialog(){let committees=[...new Set(state.participants.map(resultCommitteeName).filter(Boolean))];if(operationMode==="cloud"&&["admin","supervisor"].includes(window.CloudCompetition.context?.profile?.role))try{cloudCommittees=await window.CloudCompetition.listCommittees();committees=cloudCommittees.map(item=>item.name)}catch(error){toast(`تعذر تحديث قائمة اللجان: ${error.message}`)}committees=[...new Set(committees)].sort((a,b)=>a.localeCompare(b,"ar"));const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));openModal(`<div class="modal-head"><div><span class="eyebrow">ملف واحد للطباعة</span><h2>تجميع ملفات الطلاب PDF</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid"><label>الحالة<select id="bulkPdfStatus"><option value="all">كل من تم سحبهم</option><option value="completed">المكتملون فقط</option></select></label>${genderCenterFieldsHtml("bulkPdf",centers)}<label>اللجنة<select id="bulkPdfCommittee"><option value="all">كل اللجان</option>${committees.map(name=>`<option>${escapeHtml(name)}</option>`).join("")}</select></label></div><fieldset><legend>المستوى (اختياري، يمكن اختيار أكثر من مستوى)</legend><div class="committee-level-options">${levelCheckboxesHtml("bulkPdfLevel")}</div></fieldset><p>تُحدّث قائمة اللجان مباشرة من الإعدادات. لكل متسابق صفحة واحدة، ويظهر معه المواضع واللجنة والعلامة وملخص التقييم.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="createBulkPdf" class="primary-btn"><i data-lucide="files"></i> إنشاء الملف</button></div>`,"bulk-pdf-modal");$("#createBulkPdf").onclick=()=>createBulkResultsPdf({status:$("#bulkPdfStatus").value,gender:$("#bulkPdfGender").value,center:$("#bulkPdfCenter").value,committee:$("#bulkPdfCommittee").value,levels:$$(`[name="bulkPdfLevel"]`).filter(i=>i.checked).map(i=>i.value)},{buttonId:"createBulkPdf",filenamePrefix:"ملفات-طلاب-المسابقة"});wireLevelSelectAll("bulkPdfLevel");lucide.createIcons()}
async function openBulkDrawPdfDialog(){const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));openModal(`<div class="modal-head"><div><span class="eyebrow">قبل الاختبار — بدون علامات</span><h2>حفظ السحب للطلاب PDF</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid">${genderCenterFieldsHtml("bulkDrawPdf",centers)}</div><fieldset><legend>المستوى (اختياري، يمكن اختيار أكثر من مستوى)</legend><div class="committee-level-options">${levelCheckboxesHtml("bulkDrawPdfLevel")}</div></fieldset><p>ملف واحد يجمع مواضع كل من تم سحبهم (بدون علامات)، حسب الفلترة المختارة.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="createBulkDrawPdf" class="primary-btn"><i data-lucide="file-stack"></i> إنشاء الملف</button></div>`,"bulk-pdf-modal");$("#createBulkDrawPdf").onclick=()=>createBulkResultsPdf({status:"all",gender:$("#bulkDrawPdfGender").value,center:$("#bulkDrawPdfCenter").value,committee:"all",levels:$$(`[name="bulkDrawPdfLevel"]`).filter(i=>i.checked).map(i=>i.value)},{buttonId:"createBulkDrawPdf",filenamePrefix:"سحب-الطلاب"});wireLevelSelectAll("bulkDrawPdfLevel");lucide.createIcons()}
async function createBulkResultsPdf(filters,options){
  const button=$(`#${options.buttonId}`);
  let draws=state.draws.filter(draw=>draw.participantId).filter(draw=>{
    const participant=state.participants.find(item=>item.id===draw.participantId);
    if(!participant)return false;
    if(filters.status==="completed"&&!Number.isFinite(participant.score))return false;
    if(filters.gender&&filters.gender!=="all"&&participant.gender!==filters.gender)return false;
    if(filters.center&&filters.center!=="all"&&participant.center!==filters.center)return false;
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
      showResult(draw);const source=$(".result-modal"),clone=source.cloneNode(true);preparePdfClone(clone,draw);clone.querySelectorAll(".modal-actions,.result-score-editor,.result-warning,img").forEach(item=>item.remove());document.body.appendChild(clone);
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
function preparePdfClone(clone,draw){clone.classList.add("pdf-export-sheet");if(draw.positions.length>=8)clone.classList.add("pdf-dense");if(draw.positions.length>=11)clone.classList.add("pdf-ultra-dense")}
function canvasToDataUrlAsync(canvas,format,quality){return new Promise((resolve,reject)=>{if(!canvas.toBlob)return resolve(canvas.toDataURL(`image/${format.toLowerCase()}`,quality));canvas.toBlob(blob=>{if(!blob)return reject(new Error("تعذر إنشاء صورة الصفحة"));const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("تعذر قراءة صورة الصفحة"));reader.readAsDataURL(blob)},`image/${format.toLowerCase()}`,quality)})}
async function addCanvasAsSinglePdfPage(pdf,canvas,format="JPEG",quality=.88){const margin=7,pageWidth=pdf.internal.pageSize.getWidth(),pageHeight=pdf.internal.pageSize.getHeight(),availableWidth=pageWidth-margin*2,availableHeight=pageHeight-margin*2,scale=Math.min(availableWidth/canvas.width,availableHeight/canvas.height),width=canvas.width*scale,height=canvas.height*scale,x=(pageWidth-width)/2,y=margin;const dataUrl=await canvasToDataUrlAsync(canvas,format,quality);pdf.addImage(dataUrl,format,x,y,width,height,undefined,"FAST")}
function openAssociationCardDialog(){const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));openModal(`<div class="modal-head"><div><span class="eyebrow">نموذج جمعية المحافظة على القرآن الكريم</span><h2>حفظ بطاقات الاختبار للجمعية</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-grid"><label>الحالة<select id="assocCardStatus"><option value="all">الكل</option><option value="drawn">تم السحب فقط ولم يُختبر بعد</option><option value="completed">المكتملون فقط (تم اختبارهم)</option></select></label>${genderCenterFieldsHtml("assocCard",centers)}</div><fieldset><legend>المستوى (اختياري، يمكن اختيار أكثر من مستوى)</legend><div class="committee-level-options">${levelCheckboxesHtml("assocCardLevel")}</div></fieldset><p>ملف واحد يجمع بطاقة اختبار بصيغة الجمعية لكل متسابق مطابق للفلترة، بصفحة مستقلة لكل متسابق.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="createAssociationCards" class="primary-btn"><i data-lucide="badge-check"></i> إنشاء الملف</button></div>`,"bulk-pdf-modal");$("#createAssociationCards").onclick=()=>createAssociationCardsPdf({status:$("#assocCardStatus").value,gender:$("#assocCardGender").value,center:$("#assocCardCenter").value,levels:$$(`[name="assocCardLevel"]`).filter(i=>i.checked).map(i=>i.value)},{buttonId:"createAssociationCards",filenamePrefix:"بطاقات-الجمعية"});wireLevelSelectAll("assocCardLevel");lucide.createIcons()}
async function createAssociationCardsPdf(filters,options){
  const button=$(`#${options.buttonId}`);
  const list=state.participants.filter(participant=>{
    const hasDraw=state.draws.some(draw=>draw.participantId===participant.id),hasScore=Number.isFinite(participant.score);
    if(filters.status==="drawn"&&!(hasDraw&&!hasScore))return false;
    if(filters.status==="completed"&&!hasScore)return false;
    if(filters.gender&&filters.gender!=="all"&&participant.gender!==filters.gender)return false;
    if(filters.center&&filters.center!=="all"&&participant.center!==filters.center)return false;
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
  const score=Number.isFinite(participant?.score)?participant.score:(final?final.score:null);
  const hasScore=Number.isFinite(score),passed=hasScore&&score>=PASS_SCORE;
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
      <tr><td rowspan="2" class="assoc-score-label">العلامة ( بعد طرح مجموع الأخطاء من 100 )<br>علامة النجاح (75%)</td><td>رقماً</td><td>${hasScore?score:"-"}</td></tr>
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
    let added=0,updated=0,empty=0,invalidLevel=0,awaitingParts=0,excludedSpecial=0,ignoredSheets=0,missingCenter=0,duplicateSeat=0;const importedCenters=new Set(),rejectedNames=[],levelKeptNames=[];
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
        const parsedParts=parsePartSpec(pickColumn(row,["الاجزاءالمشاركة","الأجزاءالمشاركة","ارقامالاجزاء","أرقامالأجزاء","الاجزاء","الأجزاء","parts"]));
        const parts=parsedParts.length===level?parsedParts:[];
        if(!parts.length)awaitingParts++;
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
          updated++;if(center)importedCenters.add(center)
        }else{
          state.participants.push({id:uid("P"),name:String(name).trim(),seat:seat||nextSeat(),gender,center,phone:phone||null,branch:BRANCH_NAME,age,level,levelName,parts,recitation:recitation||"حفص عن عاصم",createdAt:new Date().toISOString()});
          added++;if(center)importedCenters.add(center)
        }
      }
    }
    if(importedCenters.size){state.config.centers=state.config.centers||[];importedCenters.forEach(c=>{if(!state.config.centers.includes(c))state.config.centers.push(c)})}
    if(!added&&!updated)throw new Error(invalidLevel?"لم أتمكن من تحديد مستوى أي متسابق. تحقق من عمود المستوى ومطابقته لأسماء المستويات المعتمدة.":"لم أجد شيتاً يحتوي على عمود لأسماء المتسابقين.");
    saveState();renderAll();openModal(`<div class="modal-head"><h2>اكتمل استيراد ملف Excel</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="bulk-summary"><div><b>${added}</b><span>متسابقاً تمت إضافتهم</span></div><div><b>${updated}</b><span>تم تحديث بياناتهم من الملف</span></div><div><b>${importedCenters.size}</b><span>مركزاً</span></div></div>${missingCenter?`<p class="form-error"><b>${missingCenter} متسابقاً بلا مركز محدد</b> — لم يُعثر على عمود المركز أو كان فارغاً لهذه الصفوف، لم يُخمَّن أي اسم مركز. عدّل مركزهم يدوياً من قائمة المتسابقين.</p>`:""}${levelKeptNames.length?`<p class="form-error"><b>${levelKeptNames.length} متسابقاً</b> — مستواهم بالملف يختلف عمّا هو محفوظ، لكن تُرك كما هو لأن لديهم سحباً قائماً بالفعل (لتجنّب إلغاء مواضعه). لتغيير المستوى فعلياً، عدّله يدوياً من زر «تعديل» بعد مراجعة السحب: ${levelKeptNames.map(escapeHtml).join("، ")}</p>`:""}${awaitingParts?`<p>${awaitingParts} من المتسابقين المضافين بانتظار إدخال أرقام أجزائهم يدوياً قبل إمكانية سحبهم.</p>`:""}${excludedSpecial?`<p>استُبعد ${excludedSpecial} من كامل القرآن أو الروايات الأخرى حسب اختيارك.</p>`:""}${invalidLevel?`<p class="form-error">تم تجاوز ${invalidLevel} صفاً لأن المستوى غير معروف أو غير مطابق لأسماء المستويات المعتمدة.</p>`:""}${duplicateSeat?`<p class="form-error"><b>${duplicateSeat} متسابقاً لم يُسجَّلوا</b> — رقم جلوسهم مكرر مع متسابق آخر مختلف الاسم مسجَّل مسبقًا. يكفي تسجيل واحد فقط لكل رقم جلوس؛ راجع القائمة أدناه وصحّح رقم الجلوس ثم أعد الاستيراد.</p>`:""}${rejectedNames.length?`<details><summary>عرض الأسماء المستبعدة وأسبابها</summary><p>${rejectedNames.map(escapeHtml).join("<br>")}</p></details>`:""}${ignoredSheets?`<p class="form-error">تم تجاهل ${ignoredSheets} شيت لعدم العثور على عمود الاسم.</p>`:""}${empty?`<p>تم تجاوز ${empty} صفوف فارغة.</p>`:""}</div><div class="modal-actions"><button class="primary-btn" data-close>حسناً</button></div>`);
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
function parsePartSpec(value){const text=normalizeDigits(value);const parts=new Set();for(const token of text.split(/[,،;\s]+/).filter(Boolean)){const range=token.match(/^(\d+)\s*-\s*(\d+)$/);if(range){const a=Number(range[1]),b=Number(range[2]);for(let n=Math.min(a,b);n<=Math.max(a,b);n++)if(n>=1&&n<=30)parts.add(n)}else{const n=Number(token);if(n>=1&&n<=30)parts.add(n)}}return [...parts].sort((a,b)=>a-b)}
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
function usedCandidateIds(){return new Set(state.draws.flatMap(d=>d.positions.map(p=>p.id)))}
function availableForParts(parts){const pool=candidates.filter(c=>parts.includes(c.juz)),used=usedCandidateIds(),unused=pool.filter(c=>!used.has(c.id));return unused.length?unused:leastRepeatedCandidates(pool)}
function leastRepeatedCandidates(pool){if(!pool.length)return [];const counts=new Map();state.draws.forEach(draw=>draw.positions.forEach(position=>counts.set(position.id,(counts.get(position.id)||0)+1)));const minimum=Math.min(...pool.map(candidate=>counts.get(candidate.id)||0));return pool.filter(candidate=>(counts.get(candidate.id)||0)===minimum)}
function updateAvailability(){const parts=selectedParts(),available=availableForParts(parts);$("#availableCount").textContent=parts.length?`${formatNumber(available.length)} موضعاً`:"اختر متسابقًا بأجزاء مكتملة"}

async function performDraw(event){
  event.preventDefault();const error=$("#drawError");error.classList.add("hidden");const submit=event.submitter;let submitOriginalHtml=null;if(submit){submitOriginalHtml=submit.innerHTML;submit.disabled=true;submit.textContent="جاري تجهيز بيانات القرآن..."}try{await ensureQuranReady()}catch(loadError){if(submit){submit.disabled=false;submit.innerHTML=submitOriginalHtml??"إجراء السحب"}return showDrawError(`تعذر تجهيز بيانات القرآن: ${loadError.message}`)}if(submit){submit.disabled=false;submit.innerHTML=submitOriginalHtml??"إجراء السحب"}const level=Number($("#drawLevel").value),parts=selectedParts(),questionCount=Number($("#drawQuestionCount").value);
  const registeredParticipant=state.participants.find(item=>item.id===$("#drawParticipant").value);
  if(!registeredParticipant)return showDrawError("اختر متسابقًا مسجلًا؛ الأجزاء تُعتمد من بيانات المتسابق فقط");
  if(registeredParticipant&&registeredParticipant.parts?.length!==registeredParticipant.level)return showDrawError("الرجاء إدخال الأجزاء المشاركة فيها للمتسابق من زر تعديل قبل إجراء السحب");
  if(!level||parts.length!==level)return showDrawError(`يجب اختيار ${level||"عدد المستوى"} أجزاء بالضبط`);
  if(questionCount<1||questionCount>Math.min(15,parts.length))return showDrawError("عدد الأسئلة يجب ألا يتجاوز عدد الأجزاء المختارة أو 15 سؤالاً");
  const pools=new Map(parts.map(j=>[j,availableForParts([j])]));const eligibleParts=parts.filter(j=>pools.get(j).length);
  if(eligibleParts.length<questionCount)return showDrawError("لا توجد مواضع كافية ضمن الأجزاء المختارة.");
  const drawnParts=secureShuffle(eligibleParts).slice(0,questionCount);const positions=drawnParts.map(j=>pools.get(j)[randomIndex(pools.get(j).length)]).sort((a,b)=>a.juz-b.juz);
  const draw={id:uid("DRAW"),sequence:nextDrawSequence(),participantId:$("#drawParticipant").value||null,name:$("#drawName").value.trim(),seat:$("#drawSeat").value.trim(),center:$("#drawCenter").value.trim(),age:Number($("#drawAge").value)||null,level,eligibleParts:parts,positions,createdAt:new Date().toISOString(),rerolls:[],verification:""};
  try{draw.verification=await createVerification(draw);if(operationMode==="cloud"&&cloudEnabled&&window.CloudCompetition.context?.kind==="admin")Object.assign(draw,await window.CloudCompetition.createAdminDraw(draw));else if(operationMode==="cloud"&&cloudEnabled&&window.CloudCompetition.context?.kind==="subAdmin")Object.assign(draw,await window.CloudCompetition.createSubAdminDraw(draw));else if(operationMode==="cloud"&&cloudEnabled&&window.CloudCompetition.context?.kind==="supervisor")Object.assign(draw,await window.CloudCompetition.createSupervisorDraw(draw));state.draws.push(draw);if(operationMode!=="cloud")saveState();renderAll();await playIndividualReveal(draw);showResult(draw);$("#drawForm").reset();$("#drawLevel").disabled=false;$("#drawPartsSummary").textContent="اختر متسابقًا مسجلًا";updateAvailability()}catch(drawError){showDrawError(drawError.message)}
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
  const legacyPositions=draw.positions.some(position=>!Number.isFinite(position.startId)||Number(position.lineCount)!==8||position.lineModel!=="occupied-v2");
  const eligiblePartNumbers=(draw.eligibleParts?.length?draw.eligibleParts:participant?.parts?.length?participant.parts:Array.from({length:draw.level},(_,index)=>index+1)).join("، ");
  const examDate=participant?.assessment?.startedAt||participant?.gradedAt||null;
  openModal(`<div class="result-modal"><div class="print-only print-letterhead"><div><b>جمعية المحافظة على القرآن الكريم</b><span>فرع الكورة</span></div><strong>بسم الله الرحمن الرحيم</strong></div><div class="result-hero"><div><small>جمعية المحافظة على القرآن الكريم | فرع الكورة</small><h2>ورقة مواضع الاختبار</h2><small>${escapeHtml(state.config.competitionName)}</small></div><div class="draw-code"><small>رقم السحب</small><b>${draw.sequence.toString().padStart(4,"0")}</b><small>${escapeHtml(draw.verification)}</small></div></div><div class="result-person"><div><span>اسم المتسابق</span><b>${escapeHtml(draw.name)}</b></div><div><span>رقم الجلوس</span><b>${escapeHtml(draw.seat||"-")}</b></div><div><span>المركز</span><b>${escapeHtml(draw.center)}</b></div><div><span>مستوى الحفظ</span><b>${draw.level} أجزاء</b></div><div><span>موعد الاختبار</span><b>${examDate?formatExamDate(examDate):"لم يبدأ الاختبار بعد"}</b></div><div><span>العمر</span><b>${draw.age||"-"}</b></div></div><div class="positions-list"><div class="positions-title"><span>الرقم</span><span>الموضع المختار</span><span>الصفحة</span></div>${draw.positions.map((p,i)=>positionHtml(p,i)).join("")}</div><div class="print-only print-signatures"><div><span>اسم الممتحن</span><b></b></div><div><span>التوقيع</span><b></b></div><div><span>العلامة النهائية</span><b> / 100</b></div></div><div class="print-only print-footer"><span>تصميم وتطوير م. مأمون محمود الفقيه</span><span>تحسين م. محمد عادل الفقيه</span></div><p class="result-warning">تم تثبيت هذه المواضع وإضافتها إلى قائمة المنع لهذه الدورة.</p>${participant&&canEditParticipantScore(participant)?`<div class="result-score-editor"><div><span>العلامة النهائية</span><small>عند حفظها تتغير الحالة إلى تم الاختبار</small></div><input id="resultScore" type="number" min="0" max="100" step="0.01" value="${Number.isFinite(participant.score)?participant.score:""}" placeholder="من 100"><button id="saveResultScore" class="primary-btn">حفظ العلامة</button></div>`:""}<div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button><button class="secondary-btn" data-reroll="${draw.id}"><i data-lucide="refresh-cw"></i> إعادة موضع بسبب</button><button class="primary-btn" onclick="window.print()"><i data-lucide="printer"></i> طباعة النتيجة</button></div></div>`,"result-modal");
  const printResultButton=$(".result-modal .modal-actions .primary-btn");printResultButton.insertAdjacentHTML("beforebegin",`${participant?`<button id="startAssessmentBtn" class="assessment-launch-btn"><i data-lucide="clipboard-pen-line"></i> ${participant.assessment?.status==="final"?"عرض التقييم الإلكتروني":participant.assessment?"متابعة التقييم الإلكتروني":"بدء التقييم الإلكتروني"}</button>`:""}<button id="saveResultPdf" class="secondary-btn"><i data-lucide="file-down"></i> حفظ PDF</button>`);if(participant)$("#startAssessmentBtn").onclick=()=>openElectronicAssessment(draw);$("#saveResultPdf").onclick=()=>saveResultAsPdf(draw);lucide.createIcons();
  if(participant?.assessment?.positions?.length)$(".positions-list").insertAdjacentHTML("afterend",compactAssessmentSummary(participant,draw));
  $(".print-footer").innerHTML=`<div class="developer-credit"><b>تصميم وتطوير</b><span>م. مأمون محمود الفقيه</span><span>م. محمد عادل الفقيه</span></div>`;
  $(`[data-reroll="${draw.id}"]`).onclick=()=>requestReroll(draw.id);
  $(".print-letterhead").insertAdjacentHTML("afterbegin",`<img class="print-logo" src="assets/association-logo.png" alt="شعار جمعية المحافظة على القرآن الكريم">`);
  $(".print-letterhead>strong")?.remove();
  $(".result-person").insertAdjacentHTML("beforeend",`<div><span>الجنس</span><b>${escapeHtml(participant?.gender||"غير محدد")}</b></div>${participant&&Number.isFinite(participant.score)?`<div class="print-outcome"><span>النتيجة النهائية</span><b class="${participant.score>=PASS_SCORE?"pass-text":"fail-text"}">${participant.score} / 100 · ${participant.score>=PASS_SCORE?"ناجح":"راسب"}</b></div>`:""}<div class="participant-parts"><span>أرقام الأجزاء المشاركة</span><b>${eligiblePartNumbers}</b></div>`);
  if(resultCommitteeName(participant))$(".result-person").insertAdjacentHTML("beforeend",`<div class="result-committee"><span>لجنة الاختبار</span><b>${escapeHtml(resultCommitteeName(participant))}</b></div>`);
  if(legacyPositions)$(".result-hero").insertAdjacentHTML("afterend",`<p class="legacy-warning"><b>هذه نتيجة قديمة</b><span>أُنشئت قبل اعتماد معيار 8 أسطر بالضبط والبدايات المنطقية. أعد السحب لتطبيق المعيار الجديد.</span></p>`);
  $(".print-signatures")?.remove();
  if(participant&&canEditParticipantScore(participant))$("#saveResultScore").onclick=()=>{const input=$("#resultScore"),score=Number(input.value);if(input.value===""||!Number.isFinite(score)||score<0||score>100)return toast("أدخل علامة صحيحة بين 0 و100");participant.score=Math.round(score*100)/100;participant.gradedAt=new Date().toISOString();participant.scoreSource="manual";saveState();renderAll();closeModal();toast("تم حفظ العلامة اليدوية")};
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
function emptyPositionAssessment(position){return {positionId:position.id,memorization:0,language:0,tajweed:0,hesitation:0,positionChange:0,note:"",completed:false}}
function currentExaminerRole(){return window.CloudCompetition.context?.committee?.examiner_role||"chairman"}
function examinerDraftKey(participantId){return `${ASSESSMENT_DRAFT_PREFIX}${currentExaminerRole()}-${participantId}`}
function ensureAssessment(participant,draw){const stored=participant.assessment?.examinerDrafts?.[currentExaminerRole()]||participant.assessment,previous=stored?.drawId===draw.id?stored:null,byPosition=new Map((previous?.positions||[]).map(item=>[item.positionId,item]));const assessment=previous||{id:uid("ASSESS"),drawId:draw.id,status:"draft",startedAt:new Date().toISOString(),revisions:[]};assessment.positions=draw.positions.map(position=>({...emptyPositionAssessment(position),...(byPosition.get(position.id)||{})}));assessment.updatedAt=new Date().toISOString();assessment.examinerRole=currentExaminerRole();participant.assessment=assessment;saveState();return assessment}
function calculateAssessment(assessment){const totals={memorization:0,language:0,tajweed:0,hesitation:0,positionChange:0};(assessment?.positions||[]).forEach(position=>Object.keys(totals).forEach(type=>totals[type]+=Math.max(0,Number(position[type])||0)));const deductions=Object.fromEntries(Object.entries(totals).map(([type,count])=>[type,Math.round(count*ASSESSMENT_RULES[type].deduction*100)/100])),totalDeduction=Math.round(Object.values(deductions).reduce((sum,value)=>sum+value,0)*100)/100,score=Math.max(0,Math.round((100-totalDeduction)*100)/100);return {totals,deductions,totalDeduction,score,passed:score>=PASS_SCORE}}
function positionsDiffer(own,member){return Object.keys(ASSESSMENT_RULES).some(type=>(Number(own?.[type])||0)!==(Number(member?.[type])||0))}
function positionDeductionFor(position){if(!position?.adopted)return calculateAssessment({positions:[position]}).totalDeduction;let total=0;for(const type of Object.keys(ASSESSMENT_RULES)){const count=Number.isFinite(position.adopted[type])?position.adopted[type]:(Number(position[type])||0);total+=count*ASSESSMENT_RULES[type].deduction}return Math.round(total*100)/100}
function calculateFinalAssessment(assessment){const raw=calculateAssessment(assessment),totalDeduction=Math.round((assessment?.positions||[]).reduce((sum,p)=>sum+positionDeductionFor(p),0)*100)/100,score=Math.max(0,Math.round((100-totalDeduction)*100)/100);return {...raw,totalDeduction,score,passed:score>=PASS_SCORE}}
function loadLocalAssessmentDraft(participantId){try{return JSON.parse(localStorage.getItem(examinerDraftKey(participantId))||"null")}catch{return null}}
function saveAssessmentDraft(participant){participant.assessment.status="draft";participant.assessment.updatedAt=new Date().toISOString();participant.assessment.examinerRole=currentExaminerRole();localStorage.setItem(examinerDraftKey(participant.id),JSON.stringify(participant.assessment));saveState();if(activeCloudSession)window.CloudCompetition.queueSessionSave(activeCloudSession.id,participant.assessment,error=>toast(`تعذر حفظ المسودة: ${error.message}`))}
function assessmentActionHtml(position,index,type,locked=false){const rule=ASSESSMENT_RULES[type],count=Number(position[type])||0,total=Math.round(count*rule.deduction*100)/100;return `<div class="exam-action ${type}"><button type="button" class="exam-action-add" data-assess-index="${index}" data-assess-type="${type}" data-assess-delta="1"${locked?" disabled":""}><span>${rule.label}</span><small>${locked?"بانتظار تغيير الرئيس لهذا الموضع":`الواحدة ${formatAssessmentNumber(rule.deduction)} · الخصم ${formatAssessmentNumber(total)}`}</small><strong data-assess-count="${index}-${type}">${count}</strong><i data-lucide="${type==="positionChange"?"refresh-cw":"plus"}"></i></button>${type==="positionChange"?"":`<button type="button" class="exam-action-minus" data-assess-index="${index}" data-assess-type="${type}" data-assess-delta="-1" aria-label="التراجع عن ${rule.label}">−</button>`}</div>`}
function drawPositionSegments(drawPosition){if(drawPosition.lineSegments?.length)return drawPosition.lineSegments;if(!quranLines?.verses)return [];const start=quranLines.verses[drawPosition.startKey],finish=quranLines.verses[drawPosition.endKey];if(!start||!finish)return [];if(start.page===finish.page)return [{page:start.page,from:start.from,to:finish.to}];const segments=[{page:start.page,from:start.from,to:15}];for(let page=start.page+1;page<finish.page;page++)segments.push({page,from:1,to:15});segments.push({page:finish.page,from:1,to:finish.to});return segments}
function quranSplitPageHtml(drawPosition,pageOffset=0){const segments=drawPositionSegments(drawPosition);if(!segments.length)return `<div class="quran-split-empty">تعذر تحميل صفحة المصحف لهذا الموضع</div>`;const pages=new Map();segments.forEach(segment=>{if(!pages.has(segment.page))pages.set(segment.page,[]);pages.get(segment.page).push(segment)});const pageEntries=[...pages.entries()];const offset=Math.min(Math.max(0,pageOffset),pageEntries.length-1);const [pageNumber,pageSegments]=pageEntries[offset];const page=String(pageNumber).padStart(3,"0"),highlights=pageSegments.map(segment=>{const top=9.8+(segment.from-1)*5.35,height=(segment.to-segment.from+1)*5.35;return `<span class="quran-line-highlight" style="--highlight-top:${top}%;--highlight-height:${height}%"></span>`}).join(""),ranges=pageSegments.map(segment=>segment.from===segment.to?segment.from:`${segment.from}-${segment.to}`).join("، ");return `<div class="quran-split-viewer"><div class="quran-split-image"><img loading="lazy" src="assets/quran-pages/page-${page}.jpg" alt="صفحة المصحف ${pageNumber}">${highlights}</div><div class="quran-split-caption"><span>صفحة ${pageNumber} · الأسطر ${ranges}</span>${pageEntries.length>1?`<div class="quran-split-pager"><button type="button" class="icon-btn" data-quran-page-nav="-1"${offset===0?" disabled":""} aria-label="الصفحة السابقة من الموضع"><i data-lucide="chevron-right"></i></button><small>صفحة ${offset+1} من ${pageEntries.length} لهذا الموضع</small><button type="button" class="icon-btn" data-quran-page-nav="1"${offset===pageEntries.length-1?" disabled":""} aria-label="الصفحة التالية من الموضع"><i data-lucide="chevron-left"></i></button></div>`:""}</div></div>`}
function assessmentPositionHtml(position,drawPosition,index,total,chairmanChangeCount,quranPageOffset=0){const positionDeduction=calculateAssessment({positions:[position]}).totalDeduction,isMember=currentExaminerRole()==="member",memberLocked=isMember&&(Number(chairmanChangeCount)||0)<=(Number(position.positionChange)||0),types=Object.keys(ASSESSMENT_RULES);return `<article class="exam-position-card exam-split"><div class="exam-split-quran">${quranSplitPageHtml(drawPosition,quranPageOffset)}</div><div class="exam-split-panel"><div class="exam-position-label"><span>الموضع ${index+1} من ${total}</span><b data-position-deduction="${index}">خصم الموضع: ${formatAssessmentNumber(positionDeduction)}</b></div><h2>${escapeHtml(positionTitle(drawPosition))}</h2><p>الجزء ${drawPosition.juz} · الصفحة ${drawPosition.page}</p><div class="exam-actions">${types.map(type=>assessmentActionHtml(position,index,type,type==="positionChange"&&isMember&&memberLocked)).join("")}</div><label class="exam-note">ملاحظات الموضع<textarea data-assess-note="${index}" rows="2" placeholder="ملاحظة اختيارية عن أداء المتسابق">${escapeHtml(position.note||"")}</textarea></label><button type="button" class="secondary-btn exam-position-complete ${position.completed?"is-done":""}" data-toggle-complete="${index}"><i data-lucide="${position.completed?"check-circle-2":"circle"}"></i> ${position.completed?"أُنهي هذا الموضع":"إنهاء هذا الموضع"}</button></div></article>`}
function openElectronicAssessment(draw,cloudSession=null,jumpToIndex=null){
  activeCloudSession=cloudSession;
  const participant=state.participants.find(item=>item.id===draw.participantId);
  if(!participant)return toast("التقييم الإلكتروني متاح للمتسابقين المسجلين فقط");
  const assessment=ensureAssessment(participant,draw);assessment.actions=assessment.actions||[];
  let currentIndex=jumpToIndex!=null?Math.min(Math.max(0,jumpToIndex),draw.positions.length-1):Math.min(Math.max(0,Number(assessment.currentPosition)||0),draw.positions.length-1);
  let chairmanPositionChangeCounts=draw.positions.map(()=>0);
  let quranPageOffsets=draw.positions.map(()=>0);
  openModal(`<div class="examiner-header"><button type="button" class="icon-btn" data-close title="حفظ وخروج"><i data-lucide="x"></i></button><div><span>اختبار ${escapeHtml(participant.name)}</span><small>${participant.level} أجزاء · السحب ${String(draw.sequence).padStart(4,"0")}</small></div><div class="examiner-score"><small>العلامة</small><b id="assessmentLiveScore">100</b></div></div><div id="assessmentExamScreen" class="examiner-screen"><nav id="positionStepper" class="position-stepper">${draw.positions.map((_,index)=>`<button type="button" class="${assessment.positions[index].completed?"is-done":""}" data-position-step="${index}">${index+1}</button>`).join("")}</nav><main id="activeAssessmentPosition"></main><div class="examiner-quickbar"><button type="button" id="undoAssessmentAction" class="secondary-btn"><i data-lucide="undo-2"></i> تراجع عن آخر تسجيل</button><div><span>إجمالي الخصم</span><b id="assessmentTotalDeduction">0</b></div></div><div class="examiner-navigation"><button type="button" id="previousAssessmentPosition" class="secondary-btn"><i data-lucide="arrow-right"></i> السابق</button><button type="button" id="reviewAssessmentBtn" class="primary-btn"><i data-lucide="clipboard-check"></i> مراجعة واعتماد</button><button type="button" id="nextAssessmentPosition" class="primary-btn">التالي <i data-lucide="arrow-left"></i></button></div><div id="assessmentSummaryRows" class="hidden"></div></div>`,"examiner-mode-modal");document.body.classList.add("exam-fullscreen");
  const renderPosition=()=>{assessment.currentPosition=currentIndex;saveState();$("#activeAssessmentPosition").innerHTML=assessmentPositionHtml(assessment.positions[currentIndex],draw.positions[currentIndex],currentIndex,draw.positions.length,chairmanPositionChangeCounts[currentIndex],quranPageOffsets[currentIndex]);$$(`[data-position-step]`).forEach(button=>{const index=Number(button.dataset.positionStep);button.classList.toggle("active",index===currentIndex);button.classList.toggle("is-done",Boolean(assessment.positions[index].completed))});$("#previousAssessmentPosition").disabled=currentIndex===0;$("#nextAssessmentPosition").disabled=currentIndex===draw.positions.length-1;lucide.createIcons()};
  const refresh=()=>{renderPosition();updateAssessmentSummary(assessment);$("#undoAssessmentAction").disabled=!assessment.actions.length;const finish=$("#finishFailedAssessment");if(finish)finish.onclick=()=>endExamNow(draw,participant,assessment)};
  stopMemberPositionSync();
  if(currentExaminerRole()==="member"&&activeCloudSession){
    const syncChairmanChanges=async()=>{
      try{
        const sessions=await window.CloudCompetition.listSessions();
        const session=sessions.find(item=>item.id===activeCloudSession.id)||sessions.find(item=>item.participant_id===participant.id);
        if(session?.status==="final"){
          stopMemberPositionSync();
          toast(`تم إنهاء الاختبار من قبل رئيس اللجنة${session.score!=null?` · العلامة ${formatAssessmentNumber(session.score)}`:""}`);
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
  $("#assessmentExamScreen").addEventListener("click",event=>{const quranNavButton=event.target.closest("[data-quran-page-nav]");if(quranNavButton){if(quranNavButton.disabled)return;const delta=Number(quranNavButton.dataset.quranPageNav),pageCount=new Set(drawPositionSegments(draw.positions[currentIndex]).map(segment=>segment.page)).size;quranPageOffsets[currentIndex]=Math.min(Math.max(0,(quranPageOffsets[currentIndex]||0)+delta),Math.max(0,pageCount-1));return renderPosition()}const completeButton=event.target.closest("[data-toggle-complete]");if(completeButton){const index=Number(completeButton.dataset.toggleComplete),position=assessment.positions[index];position.completed=!position.completed;saveAssessmentDraft(participant);return refresh()}const actionButton=event.target.closest("[data-assess-delta]");if(actionButton){const index=Number(actionButton.dataset.assessIndex),type=actionButton.dataset.assessType,delta=Number(actionButton.dataset.assessDelta);if(type==="positionChange"&&delta>0){if(currentExaminerRole()==="chairman"){actionButton.disabled=true;replaceAssessmentPosition(draw,participant,assessment,index).then(()=>{currentIndex=index;refresh()}).catch(error=>toast(error.message)).finally(()=>actionButton.disabled=false)}else{const chairmanCount=chairmanPositionChangeCounts[index]||0,ownCount=Number(assessment.positions[index].positionChange)||0;if(chairmanCount<=ownCount)return;actionButton.disabled=true;adoptChairmanPositionChange(draw,participant,assessment,index).then(()=>{currentIndex=index;refresh()}).catch(error=>toast(error.message)).finally(()=>actionButton.disabled=false)}return}const position=assessment.positions[index],before=Number(position[type])||0,after=Math.max(0,before+delta);if(after===before)return;position[type]=after;assessment.actions.push({positionId:position.positionId,type,delta:after-before,at:new Date().toISOString()});saveAssessmentDraft(participant);return refresh()}const step=event.target.closest("[data-position-step]");if(step){currentIndex=Number(step.dataset.positionStep);return renderPosition()}});
  $("#assessmentExamScreen").addEventListener("input",event=>{const note=event.target.closest("[data-assess-note]");if(!note)return;assessment.positions[Number(note.dataset.assessNote)].note=note.value;saveAssessmentDraft(participant)});
  $("#previousAssessmentPosition").onclick=()=>{if(currentIndex>0){currentIndex--;renderPosition()}};$("#nextAssessmentPosition").onclick=()=>{if(currentIndex<draw.positions.length-1){currentIndex++;renderPosition()}};
  $("#undoAssessmentAction").onclick=()=>{const action=assessment.actions.pop();if(!action)return;const index=assessment.positions.findIndex(position=>position.positionId===action.positionId);if(index<0)return;const position=assessment.positions[index];position[action.type]=Math.max(0,(Number(position[action.type])||0)-action.delta);currentIndex=index;saveAssessmentDraft(participant);refresh();toast("تم التراجع عن آخر تسجيل")};
  $("#reviewAssessmentBtn").onclick=()=>openAssessmentReview(draw,participant);refresh()
}
function failurePositionIndex(assessment){let deduction=0;for(let index=0;index<(assessment?.positions||[]).length;index++){deduction+=calculateAssessment({positions:[assessment.positions[index]]}).totalDeduction;if(100-deduction<75)return index}return -1}
function updateAssessmentSummary(assessment){const result=calculateAssessment(assessment),failureIndex=failurePositionIndex(assessment);$("#assessmentLiveScore").textContent=formatAssessmentNumber(result.score);$("#assessmentLiveScore").className=result.passed?"pass-text":"fail-text";$("#assessmentTotalDeduction").textContent=formatAssessmentNumber(result.totalDeduction);$("#assessmentSummaryRows").innerHTML=Object.entries(ASSESSMENT_RULES).map(([type,rule])=>`<div><span>${rule.label} (${result.totals[type]})</span><b>−${formatAssessmentNumber(result.deductions[type])}</b></div>`).join("");const old=$("#assessmentFailureWarning");if(old)old.remove();if(failureIndex>=0){const chairman=currentExaminerRole()==="chairman";$("#activeAssessmentPosition").insertAdjacentHTML("afterend",`<div id="assessmentFailureWarning" class="assessment-failure-warning"><b>تجاوز المتسابق الحد الأعلى المسموح للنجاح</b><span>وصلت العلامة إلى أقل من 75 عند الموضع ${failureIndex+1}. ${chairman?"يمكنكم إنهاء الاختبار أو الاستمرار.":"بانتظار رئيس اللجنة لإنهاء الاختبار."}</span>${chairman?`<button type="button" id="finishFailedAssessment" class="danger-btn">إنهاء الاختبار الآن</button>`:""}</div>`)}}
async function replaceAssessmentPosition(draw,participant,assessment,index){if(!confirm("سيتم خصم 10 علامات واختيار موضع مختلف عشوائيًا من الجزء نفسه. هل تريد المتابعة؟"))return;const old=draw.positions[index],pool=availableForParts([old.juz]).filter(item=>item.id!==old.id&&!draw.positions.some(position=>position.id===item.id));if(!pool.length)throw new Error("لا يوجد موضع بديل متاح في الجزء نفسه");const replacement=pool[randomIndex(pool.length)],entry=assessment.positions[index];entry.positionChange=(Number(entry.positionChange)||0)+1;entry.changes=entry.changes||[];entry.changes.push({oldPosition:old,newPosition:replacement,committeeName:window.CloudCompetition.context?.committee?.name||"الإدارة",at:new Date().toISOString()});entry.positionId=replacement.id;draw.positions[index]=replacement;assessment.actions.push({positionId:replacement.id,type:"positionChange",delta:1,at:new Date().toISOString(),oldPositionId:old.id});assessment.updatedAt=new Date().toISOString();if(operationMode==="cloud"&&window.CloudCompetition.context?.kind==="committee")await window.CloudCompetition.replaceCommitteePosition(participant.id,draw.id,index,replacement,assessment);else saveState();saveAssessmentDraft(participant);toast(`تم تغيير الموضع ${index+1} بموضع آخر من الجزء ${old.juz}`)}
async function adoptChairmanPositionChange(draw,participant,assessment,index){
  const remote=await window.CloudCompetition.loadCompetitionState();
  const remoteDraw=(remote.payload?.draws||[]).find(item=>item.id===draw.id);
  const fresh=remoteDraw?.positions?.[index];
  if(!fresh)throw new Error("تعذر جلب الموضع الجديد من رئيس اللجنة، حاول مجددًا");
  const entry=assessment.positions[index];
  entry.positionChange=(Number(entry.positionChange)||0)+1;
  entry.positionId=fresh.id;
  draw.positions[index]=fresh;
  assessment.actions.push({positionId:fresh.id,type:"positionChange",delta:1,at:new Date().toISOString()});
  assessment.updatedAt=new Date().toISOString();
  saveAssessmentDraft(participant);
  toast(`تم اعتماد الموضع الجديد للموضع ${index+1} كما اختاره رئيس اللجنة`);
}
async function endExamNow(draw,participant,assessment){
  if(currentExaminerRole()!=="chairman")return;
  if(!confirm("سيتم إنهاء الاختبار الآن دون الحاجة لإكمال باقي المواضع لأن المتسابق تجاوز حد الرسوب. هل تريد المتابعة؟"))return;
  assessment.positions.forEach(position=>{if(!position.completed)position.completed=true});
  assessment.endedEarly=true;assessment.endedEarlyAt=new Date().toISOString();
  saveAssessmentDraft(participant);
  openAssessmentReview(draw,participant);
}
function openCompletedAssessment(draw,participant,session){const assessment=session.assessment||participant.assessment||{},result=assessment.result||calculateAssessment(assessment),testedAt=session.finalized_at||assessment.finalizedAt||participant.gradedAt,canEdit=Boolean(window.CloudCompetition.context?.committee?.can_edit_final),canSeeScore=window.CloudCompetition.context?.committee?.show_score!==false;openModal(`<div class="modal-head"><div><span class="eyebrow">نتيجة معتمدة ${canEdit?"· صلاحية التعديل مفعلة":"للعرض فقط"}</span><h2>${escapeHtml(participant.name)}</h2></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="assessment-review-score ${result.passed?"passed":"failed"}"><span>العلامة النهائية</span><b>${canSeeScore?formatAssessmentNumber(result.score):"—"}</b><strong>${canSeeScore?(result.passed?"ناجح":"راسب"):"العلامة غير ظاهرة لهذه اللجنة"}</strong></div>${canSeeScore?`<div class="assessment-review-grid">${Object.entries(ASSESSMENT_RULES).map(([type,rule])=>`<div><span>${rule.label}</span><b>${result.totals?.[type]||0}</b><small>خصم ${formatAssessmentNumber(result.deductions?.[type]||0)}</small></div>`).join("")}</div>`:""}<p class="assessment-review-note">لجنة الاختبار: <b>${escapeHtml(assessment.committeeName||window.CloudCompetition.context?.committee?.name||"-")}</b><br>موعد الاختبار: <b>${testedAt?formatExamDate(testedAt):"غير مسجل"}</b><br>${canEdit?"أي تعديل وإعادة اعتماد سيُسجلان في سجل النشاط.":"لا يمكن تعديل النتيجة دون منح الصلاحية من الإدارة."}</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button>${canEdit?`<button id="reopenFinalAssessmentBtn" class="primary-btn"><i data-lucide="file-pen-line"></i> تعديل النتيجة المعتمدة</button>`:""}</div>`,"assessment-review-modal");if(canEdit)$("#reopenFinalAssessmentBtn").onclick=()=>reopenFinalAssessment(draw,participant,session)}
async function reopenFinalAssessment(draw,participant,session){const button=$("#reopenFinalAssessmentBtn");button.disabled=true;button.textContent="جاري فتح التعديل...";try{const assessment=JSON.parse(JSON.stringify(session.assessment||participant.assessment||{}));assessment.status="draft";assessment.updatedAt=new Date().toISOString();assessment.revisions=assessment.revisions||[];assessment.revisions.push({type:"reopened-final",oldScore:session.score,at:assessment.updatedAt});const reopened=await window.CloudCompetition.saveSession(session.id,assessment,"in_progress",null);activeCloudSession=reopened;committeeSessions=committeeSessions.map(item=>item.id===reopened.id?reopened:item);participant.assessment=assessment;delete participant.score;delete participant.gradedAt;localStorage.setItem(ASSESSMENT_DRAFT_PREFIX+participant.id,JSON.stringify(assessment));openElectronicAssessment(draw,reopened);toast("تم فتح النتيجة للتعديل وسيُسجل التغيير في سجل النشاط")}catch(error){button.disabled=false;button.textContent="تعديل النتيجة المعتمدة";toast(error.message)}}
async function finalizeElectronicAssessment(draw,participant,result){const button=$("#finalizeAssessmentBtn");if(button?.disabled||participant.assessment?.status==="final")return toast("هذه النتيجة معتمدة مسبقاً");if(button){button.disabled=true;button.textContent="جاري اعتماد النتيجة..."}const assessment=participant.assessment,now=new Date().toISOString();assessment.status="final";assessment.finalizedAt=now;assessment.updatedAt=now;assessment.result=result;participant.score=result.score;participant.gradedAt=now;participant.scoreSource="electronic";saveState();if(activeCloudSession){try{activeCloudSession=await window.CloudCompetition.saveSession(activeCloudSession.id,assessment,"final",result.score);await window.CloudCompetition.log("finalize","participant",participant.id,{score:result.score,drawId:draw.id});committeeSessions=committeeSessions.filter(item=>item.id!==activeCloudSession.id);committeeSessions.unshift(activeCloudSession)}catch(error){assessment.status="draft";delete participant.score;delete participant.gradedAt;delete participant.scoreSource;saveAssessmentDraft(participant);if(button){button.disabled=false;button.textContent="اعتماد النتيجة"}return toast(`لم تُعتمد النتيجة: ${error.message}`)}}localStorage.removeItem(ASSESSMENT_DRAFT_PREFIX+participant.id);renderAll();const canSeeScore=window.CloudCompetition.context?.committee?.show_score!==false;openModal(`<div class="modal-head"><h2>تم اعتماد النتيجة</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="assessment-review-score ${result.passed?"passed":"failed"}"><span>${escapeHtml(participant.name)}</span><b>${canSeeScore?formatAssessmentNumber(result.score):"—"}</b><strong>${canSeeScore?(result.passed?"ناجح":"راسب"):"العلامة غير ظاهرة لهذه اللجنة"}</strong></div><p>حُفظت العلامة مع تفاصيل الأخطاء والترددات والملاحظات لكل موضع.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button>${activeCloudSession?`<button id="returnCommitteeWorkspace" class="primary-btn">العودة إلى قائمة اللجنة</button>`:`<button id="showResultAfterAssessment" class="primary-btn">العودة إلى النتيجة</button>`}</div>`);if(activeCloudSession)$("#returnCommitteeWorkspace").onclick=()=>{closeModal();activeCloudSession=null;renderCommitteeWorkspace()};else $("#showResultAfterAssessment").onclick=()=>showResult(draw)}
async function openAssessmentReview(draw,participant){
  stopMemberPositionSync();
  const assessment=participant.assessment,result=calculateAssessment(assessment),chairman=currentExaminerRole()==="chairman";
  const incompleteIndex=assessment.positions.findIndex(p=>!p.completed);
  if(incompleteIndex>=0){toast(`الرجاء وضع "إنهاء هذا الموضع" على الموضع ${incompleteIndex+1} قبل المراجعة والاعتماد`);return openElectronicAssessment(draw,activeCloudSession,incompleteIndex)}
  saveAssessmentDraft(participant);
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

function formatAssessmentNumber(value){return new Intl.NumberFormat("en-US",{maximumFractionDigits:2,useGrouping:false}).format(Number(value)||0)}
function openBulkDrawModal(){
  const completed=new Set(state.draws.map(d=>d.participantId).filter(Boolean));const allPending=state.participants.filter(p=>!completed.has(p.id));
  if(!allPending.length)return toast(state.participants.length?"جميع المتسابقين لديهم سحب محفوظ":"أضف المتسابقين أو استورد ملف Excel أولاً");
  const centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
  const missingParts=allPending.filter(p=>p.parts?.length!==p.level);
  const readyCount=allPending.length-missingParts.length;
  openModal(`<div class="modal-head"><h2>سحب لجميع المتسابقين</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سينفذ النظام سحباً مستقلاً لكل متسابق بانتظار الاختبار وله أجزاء مسجلة، حسب مستواه، ويحفظ جميع النتائج في السجل. حدد فلترة اختيارية لقصر السحب على فئة معينة، أو اتركها على "الكل" للسحب لجميع من ينتظرون.</p><div class="form-grid">${genderCenterFieldsHtml("bulkDraw",centers)}</div><fieldset><legend>المستوى (اختياري، يمكن اختيار أكثر من مستوى — اتركه فارغاً ليشمل جميع المستويات)</legend><div class="committee-level-options">${levelCheckboxesHtml("bulkDrawLevel")}</div></fieldset><div class="bulk-summary"><div><b>${readyCount}</b><span>بانتظار السحب (قبل الفلترة)</span></div><div><b>${state.draws.length}</b><span>سحباً محفوظاً حالياً</span></div></div>${missingParts.length?`<p class="form-error">${missingParts.length} متسابقاً بلا أجزاء مسجلة سيُتخطَّون تلقائياً ويرد اسمهم في ملخص النتيجة ليُرجى تعبئتها لهم لاحقاً:</p><div class="missing-parts-list">${missingParts.map(p=>`<span>${escapeHtml(p.name)} · ${p.levelName||`${p.level} أجزاء`}</span>`).join("")}</div>`:""}<p class="form-error">بعد التنفيذ تصبح المواضع مثبتة. استخدم إعادة السحب من سجل المتسابق فقط عند وجود سبب.</p></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="confirmBulkDraw" class="primary-btn" ${readyCount?"":"disabled"}><i data-lucide="layers"></i> تنفيذ السحب لمن أجزاؤه جاهزة</button></div>`);
  wireLevelSelectAll("bulkDrawLevel");
  $("#confirmBulkDraw").onclick=()=>{
    const gender=$("#bulkDrawGender").value,center=$("#bulkDrawCenter").value,levels=$$(`[name="bulkDrawLevel"]`).filter(i=>i.checked).map(i=>i.value);
    const filtered=allPending.filter(p=>(gender==="all"||p.gender===gender)&&(center==="all"||p.center===center)&&(!levels.length||levels.includes(p.levelName||`${p.level} أجزاء`)));
    if(!filtered.length)return toast("لا يوجد متسابقون مطابقون للفلتر بانتظار السحب");
    runBulkDraw(filtered);
  };
}
async function runBulkDraw(participants){
  const button=$("#confirmBulkDraw");button.disabled=true;button.textContent="جاري تجهيز بيانات القرآن...";try{await ensureQuranReady()}catch(error){button.disabled=false;button.textContent="تنفيذ السحب لمن أجزاؤه جاهزة";return toast(`تعذر تجهيز بيانات القرآن: ${error.message}`)}let completed=0,missingPartsNames=[],noPositionsNames=[];
  for(const p of participants){
    button.textContent=`جاري السحب ${completed+1} من ${participants.length}`;
    if(p.parts?.length!==p.level){missingPartsNames.push(p.name);continue}const parts=p.parts;const questionCount=Math.min(LEVEL_QUESTIONS[p.level]||3,parts.length);const pools=new Map(parts.map(j=>[j,availableForParts([j])]));const eligibleParts=parts.filter(j=>pools.get(j).length);
    if(eligibleParts.length<questionCount){noPositionsNames.push(p.name);continue}
    const drawnParts=secureShuffle(eligibleParts).slice(0,questionCount);const positions=drawnParts.map(j=>pools.get(j)[randomIndex(pools.get(j).length)]).sort((a,b)=>a.juz-b.juz);const draw={id:uid("DRAW"),sequence:nextDrawSequence(),participantId:p.id,name:p.name,seat:p.seat,center:p.center,age:p.age,level:p.level,eligibleParts:parts,positions,createdAt:new Date().toISOString(),rerolls:[],verification:""};draw.verification=await createVerification(draw);state.draws.push(draw);saveState();completed++;
  }
  renderAll();openModal(`<div class="modal-head"><h2>اكتمل السحب الجماعي</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><div class="bulk-summary"><div><b>${completed}</b><span>نتيجة تم حفظها</span></div><div><b>${missingPartsNames.length+noPositionsNames.length}</b><span>لم يتم سحبه</span></div></div>${missingPartsNames.length?`<p class="form-error"><b>لم تُسجل أجزاؤهم، يُرجى تعبئتها ثم إعادة السحب لهم:</b> ${missingPartsNames.map(escapeHtml).join("، ")}</p>`:""}${noPositionsNames.length?`<p class="form-error"><b>تعذر توفير مواضع غير متداخلة لهم:</b> ${noPositionsNames.map(escapeHtml).join("، ")}</p>`:""}${!missingPartsNames.length&&!noPositionsNames.length?"<p>جميع النتائج جاهزة في سجل السحوبات ويمكن فتح كل نتيجة وطباعتها.</p>":""}</div><div class="modal-actions"><button class="secondary-btn" data-close>إغلاق</button><button id="goHistoryAfterBulk" class="primary-btn">عرض سجل السحوبات</button></div>`);$("#goHistoryAfterBulk").onclick=()=>{closeModal();navigate("history")};
}
function positionTitle(p){return p.endChapter&&p.endChapter!==p.chapter?`${p.chapterName} (${p.startAyah}) إلى ${p.endChapterName} (${p.endAyah})`:`${p.chapterName} (${p.startAyah}${p.endAyah!==p.startAyah?` - ${p.endAyah}`:""})`}
function positionHtml(p,i){return `<article class="position-card"><span class="position-number">${i+1}</span><div><h3>${escapeHtml(positionTitle(p))}</h3><p>الجزء ${p.juz} · ${p.lineCount?`${p.lineCount} أسطر · `:""}${p.words} كلمة · ${p.startKey} إلى ${p.endKey}</p></div><div class="page-number"><span>الصفحة</span><b>${p.page}</b></div></article>`}
function requestReroll(drawId){const draw=state.draws.find(d=>d.id===drawId);openModal(`<form id="rerollForm"><div class="modal-head"><h2>إعادة سحب موضع</h2><button class="icon-btn" type="button" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><label>الموضع المطلوب تغييره<select id="rerollIndex">${draw.positions.map((p,i)=>`<option value="${i}">${i+1}. ${escapeHtml(positionTitle(p))}</option>`).join("")}</select></label><label>سبب إعادة السحب<textarea id="rerollReason" required rows="3" placeholder="يُحفظ السبب في سجل الدورة"></textarea></label></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close>إلغاء</button><button class="primary-btn">تأكيد وإعادة السحب</button></div></form>`);$("#rerollForm").onsubmit=e=>{e.preventDefault();const index=Number($("#rerollIndex").value),old=draw.positions[index],everHeld=new Set([...draw.positions.map(p=>p.id),...(draw.rerolls||[]).map(r=>r.old.id)]),pool=availableForParts([old.juz]).filter(c=>!everHeld.has(c.id));if(!pool.length)return toast("لا يوجد بديل آخر في هذا الجزء لم يسبق أن أُعطي لهذا المتسابق");const replacement=pool[randomIndex(pool.length)];draw.rerolls.push({old,reason:$("#rerollReason").value.trim(),at:new Date().toISOString()});draw.positions[index]=replacement;const participant=state.participants.find(item=>item.id===draw.participantId);if(participant?.assessment?.drawId===draw.id){participant.assessment.status="draft";delete participant.assessment.result;if(participant.scoreSource==="electronic"){delete participant.score;delete participant.gradedAt;delete participant.scoreSource}}saveState();renderAll();showResult(draw);toast("تم تغيير الموضع وإعادة التقييم الإلكتروني إلى مسودة")}}

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
    return {name:participant.name,level:participant.levelName||`${participant.level} أجزاء`,committee:committeeById.get(session.committee_id)||"—",ms,statusLabel:ms!=null?formatDuration(ms):start?"قيد الاختبار":"لم يبدأ بعد"};
  }).filter(Boolean);
}
function renderExamDurations(){
  const query=$("#examDurationSearch").value.trim().toLowerCase();
  const rows=examDurationRows().filter(r=>r.name.toLowerCase().includes(query)).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ar"));
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
function runAudit(){const button=$("#runAuditBtn");button.disabled=true;button.textContent="جاري تنفيذ 100,000 سحب...";setTimeout(()=>{const counts=Array(30).fill(0);for(let i=0;i<100000;i++)counts[randomIndex(30)]++;const expected=100000/30;const maxDeviation=Math.max(...counts.map(n=>Math.abs(n-expected)/expected*100));const score=Math.max(0,100-maxDeviation).toFixed(1);$("#auditScore").textContent=`${score}%`;$("#auditDetail").textContent=`أقصى انحراف عن المتوسط ${maxDeviation.toFixed(2)}%`;button.disabled=false;button.innerHTML=`<i data-lucide="activity"></i> إعادة الفحص`;lucide.createIcons();toast("اكتمل اختبار العشوائية")},50)}

function hydrateSettings(){$("#settingsCompetitionName").value=state.config.competitionName;$("#settingsAdminName").value=state.config.adminName;$("#settingsShowFullQuran").checked=Boolean(state.config.showFullQuranStats);populateRenameCenterOptions();renderManagedCenters()}
function populateRenameCenterOptions(){const select=$("#renameCenterFrom");if(!select)return;const current=select.value,centers=[...new Set(state.participants.map(p=>p.center).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ar"));select.innerHTML=`<option value="">اختر مركزاً</option>`+centers.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)} (${state.participants.filter(p=>p.center===c).length})</option>`).join("");if(centers.includes(current))select.value=current}
// قائمة المراكز المعتمدة للاختيار عند إضافة متسابق: اتحاد المراكز المضافة يدوياً من الإعدادات
// مع أي مركز موجود فعلاً عند متسابقين حاليين (حتى لا تفرغ القائمة عند أول استخدام).
function centerOptionsList(){const configured=state.config?.centers||[],fromParticipants=state.participants.map(p=>p.center).filter(Boolean);return [...new Set([...configured,...fromParticipants])].sort((a,b)=>String(a).localeCompare(String(b),"ar"))}
function centerSelectOptions(selectedValue){const list=centerOptionsList();const withCurrent=selectedValue&&!list.includes(selectedValue)?[...list,selectedValue].sort((a,b)=>String(a).localeCompare(String(b),"ar")):list;return `<option value="">اختر مركزاً</option>`+withCurrent.map(c=>`<option value="${escapeAttr(c)}" ${c===selectedValue?"selected":""}>${escapeHtml(c)}</option>`).join("")}
function renderManagedCenters(){const list=$("#managedCentersList");if(!list)return;const centers=[...new Set(state.config?.centers||[])].sort((a,b)=>String(a).localeCompare(String(b),"ar"));list.innerHTML=centers.length?centers.map(c=>`<span class="managed-center-tag">${escapeHtml(c)}<button type="button" data-remove-center="${escapeAttr(c)}" title="إزالة"><i data-lucide="x"></i></button></span>`).join(""):`<p class="field-help">لا توجد مراكز مضافة بعد — أضف المراكز المعتمدة هنا لتظهر عند تسجيل متسابق جديد.</p>`;$$(`[data-remove-center]`).forEach(button=>button.onclick=()=>{state.config.centers=(state.config.centers||[]).filter(c=>c!==button.dataset.removeCenter);saveState();renderManagedCenters();toast("تمت إزالة المركز من القائمة")});lucide.createIcons()}
function addManagedCenter(event){event.preventDefault();const input=$("#newCenterName"),name=input.value.trim();if(!name)return toast("اكتب اسم المركز");state.config.centers=state.config.centers||[];if(state.config.centers.includes(name))return toast("هذا المركز مضاف مسبقاً");state.config.centers.push(name);saveState();input.value="";renderManagedCenters();toast(`تمت إضافة مركز «${name}»`)}
function fixLegacyLevelNames(){
  const button=$("#fixLegacyLevelsBtn"),result=$("#fixLegacyLevelsResult");
  const needsFix=state.participants.filter(p=>!LEVEL_CATALOG.some(l=>l.label===p.levelName));
  if(!needsFix.length){result.textContent="كل المتسابقين لديهم اسم مستوى معتمد بالفعل.";return}
  let fixed=0;const stillAmbiguous=[];
  needsFix.forEach(p=>{
    const id=resolveParticipantLevelId(p),catalogEntry=id&&levelCatalogById(id);
    if(catalogEntry){p.levelName=catalogEntry.label;fixed++}
    else stillAmbiguous.push(p.name)
  });
  saveState();renderAll();
  result.innerHTML=`تم إصلاح <b>${fixed}</b> متسابقاً تلقائياً.${stillAmbiguous.length?` <b>${stillAmbiguous.length}</b> يحتاجون تحديد المستوى يدوياً من زر «تعديل» لأن عدد أجزائهم مشترك بين أكثر من مستوى ولا يوجد عمر أو رواية مسجَّلة لديهم للتمييز: ${escapeHtml(stillAmbiguous.join("، "))}`:""}`;
  toast(fixed?`تم إصلاح تسمية المستوى لـ ${fixed} متسابقاً`:"لم يتم إصلاح أي متسابق تلقائياً، راجع القائمة أدناه")
}
function renameCenter(event){event.preventDefault();const from=$("#renameCenterFrom").value,to=$("#renameCenterTo").value.trim();if(!from)return toast("اختر المركز المطلوب تصحيحه");if(!to)return toast("اكتب الاسم الجديد");const affected=state.participants.filter(p=>p.center===from);if(!affected.length)return toast("لا يوجد متسابقون بهذا المركز");affected.forEach(p=>p.center=to);saveState();renderAll();populateRenameCenterOptions();$("#renameCenterTo").value="";toast(`تم تحديث مركز ${affected.length} متسابقاً إلى «${to}»`)}
async function saveSettings(event){event.preventDefault();state.config.competitionName=$("#settingsCompetitionName").value.trim();state.config.adminName=$("#settingsAdminName").value.trim();state.config.showFullQuranStats=$("#settingsShowFullQuran").checked;if($("#settingsPin").value)state.config.pinHash=await hashText($("#settingsPin").value);$("#settingsPin").value="";saveState();$("#topCompetitionName").textContent=state.config.competitionName;renderDashboard();toast("تم حفظ الإعدادات")}
function downloadBackup(){downloadFile(`نسخة-المسابقة-${dateStamp()}.json`,JSON.stringify({schema:2,exportedAt:new Date().toISOString(),data:state},null,2),"application/json")}
async function restoreBackup(event){try{const parsed=JSON.parse(await event.target.files[0].text());if(!parsed.data?.config||!Array.isArray(parsed.data.draws))throw new Error();state=parsed.data;saveState();renderAll();hydrateSettings();toast("تمت استعادة النسخة الاحتياطية")}catch{toast("ملف النسخة الاحتياطية غير صالح")}event.target.value=""}
function confirmNewCycle(){openModal(`<div class="modal-head"><h2>بدء دورة مسابقة جديدة</h2><button class="icon-btn" data-close><i data-lucide="x"></i></button></div><div class="modal-body"><p>سيتم مسح المتسابقين وسجل السحوبات من الجهاز، وستبقى إعدادات الدخول. نزّل نسخة احتياطية أولاً للاحتفاظ بسجل الدورة الحالية.</p><label>اكتب كلمة <b>دورة جديدة</b> للتأكيد<input id="cycleConfirm" autocomplete="off"></label></div><div class="modal-actions"><button class="secondary-btn" data-close>إلغاء</button><button id="confirmCycleBtn" class="danger-btn">بدء الدورة الجديدة</button></div>`);$("#confirmCycleBtn").onclick=()=>{if($("#cycleConfirm").value.trim()!=="دورة جديدة")return toast("اكتب عبارة التأكيد كما تظهر");state.participants=[];state.draws=[];state.resets.push({at:new Date().toISOString(),by:state.config.adminName});saveState();closeModal();renderAll();navigate("dashboard");toast("بدأت دورة جديدة")}}

function openModal(html,extra=""){document.body.classList.remove("exam-fullscreen");const wasHidden=$("#modal").classList.contains("hidden");$("#modalContent").className=`modal-card ${extra}`;$("#modalContent").innerHTML=html;$("#modal").classList.remove("hidden");if(wasHidden&&!applyingBrowserHistory&&history.state?.marker===HISTORY_MARKER){const entry={...history.state,modal:true,ui:currentListUi()};history.pushState(entry,"",location.href)}$$(`[data-close]`,$("#modalContent")).forEach(b=>b.onclick=closeModal);lucide.createIcons()}
function closeModal(){stopMemberPositionSync();document.body.classList.remove("exam-fullscreen");$("#modal").classList.add("hidden");$("#modalContent").innerHTML="";if(!applyingBrowserHistory&&history.state?.marker===HISTORY_MARKER&&history.state.modal){const entry={...history.state};delete entry.modal;history.replaceState(entry,"",location.href)}}
function toast(message){const el=$("#toast");el.textContent=message;el.classList.remove("hidden");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add("hidden"),2600)}
function downloadFile(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function csvCell(value){return `"${String(value??"").replaceAll('"','""')}"`}
function dateStamp(){return new Date().toISOString().slice(0,10)}
function formatDate(value){return new Intl.DateTimeFormat("ar-JO",{dateStyle:"medium",timeStyle:"short",numberingSystem:"latn"}).format(new Date(value))}
function formatExamDate(value){return new Intl.DateTimeFormat("ar-JO",{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",numberingSystem:"latn"}).format(new Date(value))}
function formatNumber(value){return new Intl.NumberFormat("ar-JO",{numberingSystem:"latn"}).format(value)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function escapeAttr(value){return escapeHtml(value)}
