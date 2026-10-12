"use strict";
// صفحة «تجربة عملية» (مخفية): عرض توضيحي لغرفة المراقبة ببيانات وهمية بالكامل، مخصّص لتصوير فيديو يُعرض على الإدارة.
// لا تقرأ ولا تكتب أي بيانات حقيقية: لا Supabase ولا localStorage ولا state — كل شيء بذاكرة الصفحة
// ويُولَّد من جديد عند إعادة التحميل. تعيد استخدام قواعد الخصم الحقيقية (calculateAssessment) ومواضع
// المصحف الحقيقية (ensureQuranReady) حتى تبدو الأرقام والمواضع واقعية.
(function(){
  const TICK_MS=1000,SIM_SECONDS_PER_TICK=12,TOTAL_REGISTERED=214,SEED_RESULTS=46;
  const FIRST_M=["محمد","أحمد","عبدالله","عمر","يوسف","إبراهيم","خالد","حمزة","أنس","معاذ","بلال","زيد","عبدالرحمن","مصطفى","سلمان","طارق","ياسين","إياد","مالك","سيف"];
  const FIRST_F=["مريم","فاطمة","عائشة","خديجة","سارة","آمنة","رقية","هبة","نور","حلا","ليان","جنى","بيان","رهف","سلمى","تسنيم","دعاء","إسراء","آلاء","ريم"];
  const FAMILY=["العمري","الزعبي","الخطيب","الشرع","المومني","البطاينة","العزام","الربابعة","الحوراني","القضاة","الشياب","بني هاني","الجراح","العتوم","الغزاوي","الصمادي","الرشدان","الطعاني","الخصاونة","الدرابسة"];
  const CENTERS=["مركز النور","مركز الفرقان","مركز الهدى","مركز التقوى","مركز الإحسان","مركز الأرقم","مركز البيان"];
  const LEVEL_POOL=[3,3,3,5,5,5,5,7,7,7,10,10,10,15,15,20,20,25,30];
  // bias يضخّم/يقلّل الأخطاء المرصودة: اللجنة الثالثة متساهلة والسابعة متشددة عمداً حتى تظهر بمقارنة الأداء.
  const COMMITTEES=[
    {id:"c1",name:"اللجنة الأولى",gender:"ذكور",bias:1},
    {id:"c2",name:"اللجنة الثانية",gender:"ذكور",bias:1.05},
    {id:"c3",name:"اللجنة الثالثة",gender:"ذكور",bias:.5},
    {id:"c4",name:"اللجنة الرابعة",gender:"ذكور",bias:.95},
    {id:"c5",name:"اللجنة الخامسة",gender:"ذكور",bias:1.1},
    {id:"c6",name:"اللجنة السادسة",gender:"إناث",bias:1},
    {id:"c7",name:"اللجنة السابعة",gender:"إناث",bias:1.4},
    {id:"c8",name:"اللجنة الثامنة",gender:"إناث",bias:.95}
  ];
  const ERROR_TYPES=[["memorization",.10],["tajweed",.13],["language",.04],["hesitation",.2]];
  const MARK_TYPES=["memorization","language","tajweed","hesitation","positionChange"];
  const TYPE_SHORT={memorization:"حفظ",language:"لغة",tajweed:"تجويد",hesitation:"تردد",positionChange:"تغيير موضع"};
  const STATE_LABEL={idle:"بانتظار المتسابق التالي",drawing:"سحب المواضع…",exam:"قيد الاختبار",review:"مراجعة الرصدين"};
  // شرائح العرض: كل شريحة تُظهر قسماً واحداً بملء الشاشة. show = العناصر الظاهرة، spot = إطار مضيء داخلها.
  const SLIDES=[
    {show:["#demoFlowPanel"],sec:13,kicker:"الصورة الكاملة",title:"رحلة المتسابق من التسجيل إلى النتيجة",text:"كل مرحلة، من تسجيل المتسابق حتى اعتماد نتيجته، تتم داخل نظام واحد وتحت نظر الإدارة."},
    {show:["#demoKpis","#demoGridPanel"],sec:14,kicker:"غرفة المراقبة",title:"كل اللجان والأرقام على شاشة واحدة",text:"من يُختبر الآن في كل لجنة، وأي موضع وصل، وعلامة الرئيس والعضو — مع أرقام اليوم، وكلها تتحدث تلقائياً."},
    {show:["#demoDrawPanel"],sec:15,draw:true,kicker:"العدالة قبل الاختبار",title:"سحب عشوائي عادل وآمن",text:"لا أحد يختار الأسئلة: النظام يسحب أجزاءً مختلفة من محفوظ المتسابق، وموضعاً عشوائياً من كل جزء."},
    {show:["#demoDetailPanel"],sec:16,select:true,kicker:"داخل اللجنة",title:"نرى كل خطأ لحظة تسجيله",text:"ندخل أي لجنة دون إشعارها: كل خطأ في كل موضع مع صفحة المصحف، ورصد الرئيس والعضو مستقلان جنباً إلى جنب."},
    {show:["#demoAlertsPanel","#demoLogPanel"],sec:13,kicker:"إنذار وشفافية",title:"تنبيهات فورية وسجل لكل إجراء",text:"أي اختلاف بين الممتحنَين أو تغيير موضع أو تأخير يصل للإدارة فوراً، وكل إجراء مسجَّل بوقته."},
    {show:["#demoResultsPanel"],sec:11,kicker:"النزاهة",title:"نتائج معتمدة ومقفلة",text:"النتيجة لا تظهر إلا بعد اعتمادها من رئيس اللجنة، وتُقفل فلا تُعدَّل إلا بصلاحية خاصة تمنحها الإدارة."},
    {show:["#demoPerfPanel"],sec:13,kicker:"عدالة التقييم",title:"مقارنة أداء اللجان",text:"متوسط العلامات ونسبة النجاح والمدة لكل لجنة — فتظهر فوراً أي لجنة متساهلة أو متشددة."},
    {show:["#demoReportsPanel"],sec:13,kicker:"المخرجات",title:"تقارير ونتائج بضغطة زر",text:"النتائج إلى Excel مرتبة حسب المستوى، وأوراق النتائج وبطاقات الجمعية PDF، دون أي عمل يدوي."},
    {show:["#demoSecurityPanel"],sec:12,kicker:"الحماية",title:"أمان على مستوى الخادم",text:"كل مستخدم يرى ما يخصه فقط، والحماية مفروضة في قاعدة البيانات نفسها لا في الواجهة."}
  ];
  const FLOW_STEPS=[["user-plus","تسجيل المتسابقين","يدوياً أو باستيراد Excel، بالمستوى والمركز"],["shuffle","سحب عادل","مواضع عشوائية من محفوظ كل متسابق"],["book-open","اختبار إلكتروني","رئيس وعضو يرصدان الأخطاء كلٌّ على جهازه"],["scale","مراجعة الاختلاف","الرئيس يحسم مواضع الاختلاف فقط"],["lock","اعتماد وقفل","العلامة تُحسب تلقائياً وتُقفل"],["award","تقارير ونتائج","Excel وPDF وبطاقات الجمعية"]];
  const DRAW_FACTS=["مولّد عشوائي آمن (Web Crypto) وليس Math.random","أجزاء مختلفة من محفوظ المتسابق نفسه، بعدد أسئلة مستواه","كل موضع 8 أسطر من المصحف، يبدأ وينتهي عند حدود الآيات","السحب عملية واحدة على الخادم، فلا يُسحب للمتسابق مرتين","رمز تحقق لكل سحب"];
  const REPORT_ITEMS=[["file-spreadsheet","نتائج وترتيب Excel","شيت لكل مستوى، مع فلترة بالجنس والمراكز والمستويات قبل التنزيل"],["file-text","ورقة نتيجة PDF","لكل متسابق، جاهزة للطباعة"],["award","بطاقات «حفظ للجمعية»","بنموذج الجمعية، مع شبكة الأجزاء المظلَّلة وتفقيط العلامة بالعربية"],["timer","سجل السحوبات ومدة الاختبار","قابلة للبحث والتصدير إلى Excel"],["database-backup","نسخ احتياطي تلقائي","دوري من الخادم حتى مع إغلاق المتصفح"]];
  const SECURITY_ITEMS=[["users","صلاحيات حسب الدور","مدير، مشرف، مسؤول فرعي، رئيس لجنة، عضو — كلٌّ يرى ما يخصه فقط"],["server","حماية داخل قاعدة البيانات","قواعد الوصول مفروضة على الخادم نفسه، لا في الواجهة"],["key-round","رموز دخول مشفّرة","وقفل الحساب 15 دقيقة بعد 5 محاولات دخول خاطئة"],["log-out","جلسات محمية","جلسة واحدة لكل حساب، وخروج تلقائي بعد 30 دقيقة خمول"],["shield-check","فصل بيانات الذكور والإناث","تُفلتر على الخادم حسب جنس اللجنة"],["lock","منع التضارب","لا يُختبر متسابق في لجنتين، ولا يبدأ اختباران معاً في اللجنة نفسها"],["wifi-off","يعمل بلا إنترنت","وضع محلي كامل على جهاز واحد عند الحاجة"]];

  let sim=null,timer=null,speed=1,paused=false,selectedId=null,quranPool=null,quranLoading=null,mushafKey="",deck=null,deckAuto=true,idleTimer=null,drawState=null,drawTimers=[];
  const NUMBER_FORMAT=new Intl.NumberFormat("ar-JO",{numberingSystem:"latn"}),SCORE_FORMAT=new Intl.NumberFormat("en-US",{maximumFractionDigits:2,useGrouping:false});
  const formatNumber=value=>NUMBER_FORMAT.format(value),formatAssessmentNumber=value=>SCORE_FORMAT.format(Number(value)||0);
  const rnd=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
  const pick=list=>list[Math.floor(Math.random()*list.length)];
  const view=()=>$("#demoView");
  const isVisible=()=>Boolean(view()?.classList.contains("active-view"))&&!$("#app")?.classList.contains("hidden");
  const clock=new Intl.DateTimeFormat("ar-JO",{hour:"2-digit",minute:"2-digit",second:"2-digit",numberingSystem:"latn"});
  const formatTime=ms=>clock.format(new Date(ms));
  const formatDuration=seconds=>`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(Math.floor(seconds%60)).padStart(2,"0")}`;
  function timeAgo(ms){const s=Math.max(0,Math.round((Date.now()-ms)/1000));if(s<60)return `منذ ${formatNumber(s)} ث`;const m=Math.round(s/60);return m<60?`منذ ${formatNumber(m)} د`:`منذ ${formatNumber(Math.round(m/60))} س`}

  function loadPool(){
    if(quranLoading)return quranLoading;
    quranLoading=Promise.resolve().then(()=>ensureQuranReady()).then(list=>{
      const byJuz=new Map();
      list.forEach(c=>{if(!byJuz.has(c.juz))byJuz.set(c.juz,[]);byJuz.get(c.juz).push(c)});
      quranPool=byJuz;
    }).catch(error=>{console.warn("Demo: Quran data unavailable, using page estimates",error);quranPool=new Map()});
    return quranLoading;
  }
  function positionFor(juz){
    const list=quranPool?.get(juz);
    if(list?.length)return list[randomIndex(list.length)];
    return {juz,page:Math.min(604,2+(juz-1)*20+rnd(0,19))};
  }
  const positionLabel=p=>p.chapterName?positionTitle(p):`الجزء ${p.juz}`;
  // نفس فكرة السحب الحقيقي: أجزاء مختلفة عشوائياً من أجزاء المتسابق، وموضع عشوائي داخل كل جزء.
  function drawPositions(level){
    const count=Math.min(LEVEL_QUESTIONS[level]||3,level);
    const parts=Array.from({length:level},(_,i)=>30-i);
    return secureShuffle(parts).slice(0,count).map(positionFor);
  }
  const emptyMarks=()=>({memorization:0,language:0,tajweed:0,hesitation:0,positionChange:0,completed:false});
  const scoreOf=marks=>calculateAssessment({positions:marks});
  function addMark(marks,index,type){
    if(type==="tajweed"&&marks.reduce((sum,m)=>sum+m.tajweed,0)>=TAJWEED_ERROR_CAP)type="hesitation";
    marks[index][type]++;
  }
  const positionDiffers=(a,b)=>MARK_TYPES.some(t=>a[t]!==b[t]);

  function log(text,kind="info"){if(sim.quiet)return;sim.log.unshift({id:++sim.seq,text,kind,at:Date.now()});sim.log.length=Math.min(sim.log.length,60)}
  function raise(level,text){if(sim.quiet)return;sim.alerts.unshift({id:++sim.seq,level,text,at:Date.now()});sim.alerts.length=Math.min(sim.alerts.length,30)}

  function newSession(committee){
    const female=committee.gender==="إناث";
    const participant={name:`${pick(female?FIRST_F:FIRST_M)} ${pick(FIRST_M)} ${pick(FAMILY)}`,seat:sim.nextSeat++,level:pick(LEVEL_POOL),center:pick(CENTERS)};
    const positions=drawPositions(participant.level);
    const slow=Math.random()<.15;
    return {participant,positions,chair:positions.map(emptyMarks),member:positions.map(emptyMarks),current:0,slow,posTicks:rnd(3,6)+(slow?3:0),ticks:0,changes:0,skill:(.3+Math.random()*.95)*committee.bias,overtime:false,diffCount:0};
  }
  function stepCommittee(c){
    const s=c.session;
    if(c.state==="idle"){if(--c.wait>0)return;c.session=newSession(c);c.state="drawing";c.wait=1;const p=c.session.participant;log(`سحب عشوائي آمن (Web Crypto) لـ ${formatNumber(c.session.positions.length)} مواضع من أجزاء ${p.name} (${p.level} أجزاء) — ${c.name}`,"draw")}
    else if(c.state==="drawing"){if(--c.wait>0)return;c.state="exam";log(`بدأت ${c.name} اختبار ${s.participant.name} · رقم الجلوس ${s.participant.seat}`,"start")}
    else if(c.state==="exam")examTick(c);
    else if(c.state==="review"){if(--c.wait>0)return;approve(c)}
    c.lastActivity=Date.now();
  }
  function examTick(c){
    const s=c.session,i=s.current,name=s.participant.name;
    s.ticks++;
    for(const [type,p] of ERROR_TYPES){
      if(Math.random()<p*s.skill){addMark(s.chair,i,type);if(Math.random()<.86)addMark(s.member,i,type)}
      else if(Math.random()<.02*s.skill)addMark(s.member,i,type);
    }
    if(!s.overtime&&s.ticks*SIM_SECONDS_PER_TICK>s.positions.length*60*1.3){s.overtime=true;raise("warn",`${c.name}: اختبار ${name} تجاوز المدة المتوقعة (${formatDuration(s.ticks*SIM_SECONDS_PER_TICK)} دقيقة حتى الآن)`)}
    if(--s.posTicks>0)return;
    s.chair[i].completed=s.member[i].completed=true;
    s.current++;
    if(s.current>=s.positions.length){
      c.state="review";c.wait=3;
      s.diffCount=s.chair.filter((m,k)=>positionDiffers(m,s.member[k])).length;
      log(`أنهت ${c.name} اختبار ${name} — مقارنة رصد الرئيس برصد العضو`,"review");
      if(s.diffCount)raise("warn",`${c.name}: اختلاف بين رصد الرئيس والعضو في ${formatNumber(s.diffCount)} ${s.diffCount===1?"موضع":"مواضع"} للمتسابق ${name} — يراجعه الرئيس قبل الاعتماد`);
      return;
    }
    s.posTicks=rnd(3,6)+(s.slow?3:0);
    if(s.changes<2&&Math.random()<.04){
      s.changes++;
      const old=s.positions[s.current];
      s.positions[s.current]=positionFor(old.juz);
      s.chair[s.current].positionChange++;s.member[s.current].positionChange++;
      log(`${c.name}: غيّر الرئيس الموضع ${formatNumber(s.current+1)} للمتسابق ${name} — اعتمده العضو وخُصمت 10 علامات`,"change");
      raise("info",`${c.name}: تغيير موضع للمتسابق ${name} (الموضع ${formatNumber(s.current+1)} من الجزء ${old.juz}) — سُجّل بالخصم المقرر`);
    }
  }
  function approve(c){
    const s=c.session,p=s.participant;
    // الرئيس يُدخل «عدد الأخطاء المعتمد» لكل نوع مختلَف عليه — هنا يأخذ رصده غالباً ورصد العضو أحياناً.
    const final=s.chair.map((m,i)=>{const o={...m};MARK_TYPES.forEach(t=>{if(m[t]!==s.member[i][t]&&Math.random()<.35)o[t]=s.member[i][t]});return o});
    const r=scoreOf(final);
    const result={id:++sim.seq,name:p.name,level:p.level,center:p.center,seat:p.seat,committee:c.name,committeeId:c.id,chairScore:scoreOf(s.chair).score,memberScore:scoreOf(s.member).score,score:r.score,passed:r.passed,duration:s.ticks*SIM_SECONDS_PER_TICK,approvedAt:Date.now(),diffs:s.diffCount};
    sim.results.unshift(result);
    c.lastResult=result;c.session=null;c.state="idle";c.wait=rnd(2,4);
    log(`اعتمد رئيس ${c.name} نتيجة ${p.name}: ${formatAssessmentNumber(r.score)} — ${r.passed?"ناجح":"راسب"} · قُفلت النتيجة`,"approve");
    sim.flash=result.id;
  }

  function buildSim(){
    const staffName=gender=>`${gender==="إناث"?"أ.":"الشيخ"} ${pick(gender==="إناث"?FIRST_F:FIRST_M)} ${pick(FAMILY)}`;
    sim={quiet:true,seq:0,nextSeat:1001,results:[],log:[],alerts:[],flash:null,
      committees:COMMITTEES.map(c=>({...c,chairName:staffName(c.gender),memberName:staffName(c.gender),state:"idle",wait:rnd(1,6),session:null,lastResult:null,lastActivity:Date.now()}))};
    // تشغيل سريع صامت حتى يكون في نتائج سابقة من «صباح اليوم» واللجان بمراحل مختلفة لحظة فتح الصفحة.
    for(let guard=0;sim.results.length<SEED_RESULTS&&guard<5000;guard++)sim.committees.forEach(stepCommittee);
    let at=Date.now()-rnd(40,90)*1000;
    sim.results.forEach(r=>{r.approvedAt=at;at-=rnd(140,320)*1000});
    sim.committees.forEach(c=>{if(c.lastResult)c.lastActivity=c.lastResult.approvedAt});
    sim.quiet=false;sim.flash=null;
    sim.results.slice(0,7).reverse().forEach(r=>sim.log.unshift({id:++sim.seq,text:`اعتمد رئيس ${r.committee} نتيجة ${r.name}: ${formatAssessmentNumber(r.score)} — ${r.passed?"ناجح":"راسب"} · قُفلت النتيجة`,kind:"approve",at:r.approvedAt}));
    sim.log.unshift({id:++sim.seq,text:"الإدارة: فتح غرفة المراقبة المركزية",kind:"info",at:Date.now()});
    const lenient=sim.results.find(r=>r.committeeId==="c3");
    if(lenient)sim.alerts.push({id:++sim.seq,level:"info",text:`اللجنة الثالثة: متوسط علاماتها أعلى من المعدل العام بوضوح — يُنصح بمراجعة رصدها`,at:Date.now()-rnd(300,600)*1000});
    selectedId=null;mushafKey="";
  }

  function skeleton(){
    view().innerHTML=`
      <div class="page-head"><div><span class="eyebrow">تجربة عملية · بيانات وهمية بالكامل لأغراض الشرح</span><h1>غرفة المراقبة المركزية</h1><p>محاكاة حيّة لطريقة متابعة الإدارة لكل لجان الاختبار في الوقت نفسه: الرصد، المقارنة، الاعتماد، والتنبيهات.</p></div>
        <div class="page-actions demo-actions">
          <button id="demoTourBtn" class="primary-btn" type="button"><i data-lucide="clapperboard"></i> <span>تشغيل العرض التلقائي</span></button>
          <button id="demoPauseBtn" class="secondary-btn" type="button"><i data-lucide="pause"></i> <span>إيقاف مؤقت</span></button>
          <div class="demo-speed" role="group" aria-label="سرعة المحاكاة">${[1,2,4].map(v=>`<button type="button" class="compact-btn ${v===speed?"is-active":""}" data-demo-speed="${v}">×${v}</button>`).join("")}</div>
          <button id="demoResetBtn" class="secondary-btn" type="button" title="توليد بيانات جديدة"><i data-lucide="rotate-ccw"></i> <span>بيانات جديدة</span></button>
        </div></div>
      <div class="demo-live-bar"><span class="demo-live-dot"></span><b>مباشر</b><span>آخر تحديث <b id="demoClock"></b></span><span class="demo-sim-chip"><i data-lucide="flask-conical"></i> محاكاة — لا يوجد متسابقون حقيقيون</span></div>
      <div class="demo-stage-head"><div><span id="demoStageKicker" class="eyebrow"></span><h2 id="demoStageTitle"></h2><p id="demoStageText"></p></div><span id="demoStageCount" class="demo-stage-count"></span></div>
      <div id="demoKpis" class="stats-grid demo-kpis">
        ${kpiCard("users","green","المسجَّلون اليوم","demoKpiTotal","demoKpiTotalSub")}
        ${kpiCard("radio","red","قيد الاختبار الآن","demoKpiLive","demoKpiLiveSub")}
        ${kpiCard("badge-check","blue","نتائج معتمدة","demoKpiDone","demoKpiDoneSub")}
        ${kpiCard("hourglass","slate","المتبقون","demoKpiLeft","demoKpiLeftSub")}
        ${kpiCard("trending-up","gold","نسبة النجاح","demoKpiPass","demoKpiPassSub")}
        ${kpiCard("timer","green","متوسط مدة الاختبار","demoKpiDur","demoKpiDurSub")}
      </div>
      <section id="demoFlowPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">من التسجيل إلى النتيجة</span><h3>سير العمل في النظام</h3></div><i data-lucide="workflow"></i></div>
        <ol class="demo-flow">${FLOW_STEPS.map(([icon,title,desc],i)=>`<li style="--i:${i}"><span class="demo-flow-num">${formatNumber(i+1)}</span><i data-lucide="${icon}"></i><b>${title}</b><small>${desc}</small></li>`).join("")}</ol>
        <p class="demo-flow-note"><i data-lucide="eye"></i> الإدارة تتابع كل مرحلة مباشرة ومن أي جهاز</p></section>
      <section id="demoDrawPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">قبل دخول المتسابق للجنة</span><h3>السحب العشوائي العادل</h3></div><button id="demoDrawBtn" class="compact-btn" type="button"><i data-lucide="shuffle"></i> سحب جديد</button></div>
        <div class="demo-draw-layout"><div id="demoDrawMain"></div>
          <aside class="demo-draw-facts"><h4>ضمانات العدالة</h4><ul>${DRAW_FACTS.map(f=>`<li><i data-lucide="shield-check"></i>${f}</li>`).join("")}</ul>
            <div class="demo-fair"><b id="demoFairTitle"></b><div id="demoFairBars" class="demo-fair-bars"></div><small id="demoFairNote"></small></div></aside></div></section>
      <section id="demoGridPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">كل اللجان على شاشة واحدة</span><h3>اللجان الآن</h3></div><span id="demoGridSummary" class="status-pill"></span></div><div id="demoGrid" class="demo-grid"></div></section>
      <section id="demoDetailPanel" class="panel demo-section"><div class="demo-detail-layout"><div id="demoDetailMain"></div><figure id="demoMushaf" class="demo-mushaf"></figure></div></section>
      <div class="demo-columns">
        <section id="demoAlertsPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">تصل للإدارة مباشرة</span><h3>التنبيهات</h3></div><i data-lucide="bell-ring"></i></div><div id="demoAlerts" class="demo-feed"></div></section>
        <section id="demoLogPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">كل إجراء بوقته ومنفّذه</span><h3>سجل التدقيق</h3></div><i data-lucide="scroll-text"></i></div><div id="demoLog" class="demo-log"></div></section>
      </div>
      <div class="demo-columns">
        <section id="demoResultsPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">تظهر فقط بعد اعتماد رئيس اللجنة</span><h3>آخر النتائج المعتمدة</h3></div><i data-lucide="lock"></i></div><div class="table-wrap"><table class="demo-results-table"><thead><tr><th>المتسابق</th><th>اللجنة</th><th>الرئيس</th><th>العضو</th><th>المعتمدة</th><th>النتيجة</th><th>وقت الاعتماد</th></tr></thead><tbody id="demoResults"></tbody></table></div></section>
        <section id="demoPerfPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">عدالة التقييم بين اللجان</span><h3>مقارنة أداء اللجان</h3></div><i data-lucide="scale"></i></div><div id="demoPerf" class="demo-perf"></div></section>
      </div>
      <div class="demo-columns">
        <section id="demoReportsPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">بضغطة زر، دون عمل يدوي</span><h3>التقارير والنتائج</h3></div><i data-lucide="file-spreadsheet"></i></div>
          <div class="demo-cards">${featureCards(REPORT_ITEMS)}</div>
          <h4 class="demo-subhead">ملخص نتائج اليوم حسب المستوى (يتحدث تلقائياً)</h4><div class="table-wrap"><table class="demo-results-table demo-compact"><thead><tr><th>المستوى</th><th>عدد المعتمَدين</th><th>نسبة النجاح</th><th>متوسط العلامة</th><th>أعلى علامة</th></tr></thead><tbody id="demoLevelSummary"></tbody></table></div></section>
        <section id="demoSecurityPanel" class="panel demo-section"><div class="panel-head"><div><span class="eyebrow">الحماية مفروضة على الخادم</span><h3>الأمان والصلاحيات</h3></div><i data-lucide="fingerprint"></i></div>
          <div class="demo-cards">${featureCards(SECURITY_ITEMS)}</div></section>
      </div>
      <div id="demoControls" class="demo-controls">
        <button type="button" class="compact-btn" data-deck="prev"><i data-lucide="chevron-right"></i> السابق</button>
        <button type="button" class="compact-btn" data-deck="pause" id="demoDeckPause"></button>
        <button type="button" class="compact-btn" data-deck="next">التالي <i data-lucide="chevron-left"></i></button>
        <span class="demo-controls-label">التنقل</span>
        <div class="demo-speed"><button type="button" class="compact-btn" data-deck-mode="auto">تلقائي</button><button type="button" class="compact-btn" data-deck-mode="manual">يدوي</button></div>
        <button type="button" class="compact-btn" data-deck="exit"><i data-lucide="x"></i> خروج</button>
        <div class="demo-deck-progress"><span id="demoDeckBar"></span></div>
      </div>`;
    $("#demoTourBtn").onclick=()=>deck?endDeck():startDeck();
    $("#demoDrawBtn").onclick=runDraw;
    $("#demoControls").onclick=event=>{const btn=event.target.closest("button");if(!btn||!deck)return;wakeControls();
      if(btn.dataset.deckMode){deckAuto=btn.dataset.deckMode==="auto";deck.paused=false;scheduleNext();syncControls();return}
      const action=btn.dataset.deck;if(action==="prev")goSlide(deck.index-1);else if(action==="next")goSlide(deck.index+1);else if(action==="pause"){deck.paused=!deck.paused;scheduleNext();syncControls()}else if(action==="exit")endDeck()};
    $("#demoPauseBtn").onclick=()=>{paused=!paused;syncControls()};
    $("#demoResetBtn").onclick=()=>{buildSim();render();runDraw()};
    view().querySelectorAll("[data-demo-speed]").forEach(btn=>btn.onclick=()=>setSpeed(Number(btn.dataset.demoSpeed)));
    $("#demoGrid").onclick=event=>{const card=event.target.closest("[data-demo-committee]");if(!card)return;selectedId=card.dataset.demoCommittee;mushafKey="";render();if(!deck)$("#demoDetailPanel").scrollIntoView({behavior:"smooth",block:"start"})};
    renderFairness();runDraw();
    lucide.createIcons();
  }
  const featureCards=items=>items.map(([icon,title,desc])=>`<article class="demo-feature"><i data-lucide="${icon}"></i><div><b>${title}</b><small>${desc}</small></div></article>`).join("");
  function kpiCard(icon,tone,label,valueId,subId){return `<article class="stat"><div class="stat-icon ${tone}"><i data-lucide="${icon}"></i></div><div><span>${label}</span><b id="${valueId}">0</b><small id="${subId}" class="demo-kpi-sub"></small></div></article>`}
  function syncControls(){
    const pause=$("#demoPauseBtn");if(pause)pause.innerHTML=paused?`<i data-lucide="play"></i> <span>متابعة</span>`:`<i data-lucide="pause"></i> <span>إيقاف مؤقت</span>`;
    const deckPause=$("#demoDeckPause");if(deckPause)deckPause.innerHTML=deck?.paused?`<i data-lucide="play"></i> متابعة`:`<i data-lucide="pause"></i> إيقاف`;
    view()?.querySelectorAll("[data-deck-mode]").forEach(btn=>btn.classList.toggle("is-active",(btn.dataset.deckMode==="auto")===deckAuto));
    view()?.querySelectorAll("[data-demo-speed]").forEach(btn=>btn.classList.toggle("is-active",Number(btn.dataset.demoSpeed)===speed));
    lucide.createIcons();
  }
  function setSpeed(value){speed=value;if(timer){clearInterval(timer);timer=setInterval(tick,TICK_MS/speed)}syncControls()}

  function render(){
    if(!sim||!view())return;
    $("#demoClock").textContent=formatTime(Date.now());
    // بوضع الشرائح نرسم القسم الظاهر فقط — رسم كل الأقسام كل ثانية كان يثقل الأجهزة الضعيفة.
    const shown=deck?SLIDES[deck.index]?.show||[]:null;
    [["#demoKpis",renderKpis],["#demoGridPanel",renderGrid],["#demoDetailPanel",renderDetail],["#demoAlertsPanel",renderAlerts],["#demoResultsPanel",renderResults],["#demoLogPanel",renderLog],["#demoPerfPanel",renderPerf],["#demoReportsPanel",renderLevelSummary]]
      .forEach(([sel,fn])=>{if(!shown||shown.includes(sel))fn()});
    if(deck)fitSlide();
    sim.flash=null;
  }
  // أيقونات الأجزاء التي تُرسم كل ثانية تُبنى مرة واحدة وتُحفظ كنص SVG — تشغيل lucide.createIcons كل ثانية
  // كان أثقل عمل بالصفحة ويسبب تقطّعاً واضحاً على الأجهزة الضعيفة.
  const iconCache=new Map();
  function svg(name){
    if(!iconCache.has(name)){const box=document.createElement("span");box.hidden=true;box.innerHTML=`<i data-lucide="${name}"></i>`;document.body.appendChild(box);lucide.createIcons();iconCache.set(name,box.innerHTML);box.remove()}
    return iconCache.get(name);
  }
  function renderKpis(){
    const results=sim.results,done=results.length,live=sim.committees.filter(c=>c.state==="exam"||c.state==="review").length;
    const passed=results.filter(r=>r.passed).length,avg=done?results.reduce((s,r)=>s+r.score,0)/done:0,avgDur=done?results.reduce((s,r)=>s+r.duration,0)/done:0;
    const set=(id,v)=>{const el=$("#"+id);if(el&&el.textContent!==String(v)){el.textContent=v;el.classList.remove("demo-bump");void el.offsetWidth;el.classList.add("demo-bump")}};
    set("demoKpiTotal",formatNumber(TOTAL_REGISTERED));$("#demoKpiTotalSub").textContent=`على ${formatNumber(sim.committees.length)} لجان اختبار`;
    set("demoKpiLive",formatNumber(live));$("#demoKpiLiveSub").textContent=`${formatNumber(sim.committees.filter(c=>c.state!=="idle").length)} لجان نشطة من ${formatNumber(sim.committees.length)}`;
    set("demoKpiDone",formatNumber(done));$("#demoKpiDoneSub").textContent="مقفلة ولا تُعدَّل";
    set("demoKpiLeft",formatNumber(Math.max(0,TOTAL_REGISTERED-done-live)));$("#demoKpiLeftSub").textContent=`${formatNumber(Math.round(done/TOTAL_REGISTERED*100))}% من اليوم أُنجز`;
    set("demoKpiPass",`${formatNumber(done?Math.round(passed/done*100):0)}%`);$("#demoKpiPassSub").textContent=`متوسط العلامة ${formatAssessmentNumber(Math.round(avg*10)/10)}`;
    set("demoKpiDur",formatDuration(avgDur));$("#demoKpiDurSub").textContent="دقيقة لكل متسابق";
  }
  function renderGrid(){
    const active=sim.committees.filter(c=>c.state!=="idle").length;
    $("#demoGridSummary").textContent=`${formatNumber(active)} من ${formatNumber(sim.committees.length)} لجان تعمل الآن`;
    $("#demoGrid").innerHTML=sim.committees.map(c=>{
      const s=c.session,p=s?.participant;
      let body;
      if(c.state==="idle")body=`<p class="demo-card-wait">${c.lastResult?`آخر نتيجة: ${escapeHtml(c.lastResult.name)} · <b>${formatAssessmentNumber(c.lastResult.score)}</b>`:"بانتظار أول متسابق"}</p>`;
      else{
        const done=Math.min(s.current,s.positions.length),total=s.positions.length;
        body=`<p class="demo-card-name"><b>${escapeHtml(p.name)}</b><span>${p.level} أجزاء · ${escapeHtml(p.center)}</span></p>
          <div class="demo-progress" title="المواضع المنجزة"><span style="width:${Math.round(done/total*100)}%"></span></div>
          <div class="demo-card-meta"><span>الموضع ${formatNumber(Math.min(done+1,total))} من ${formatNumber(total)}</span><span>${formatDuration(s.ticks*SIM_SECONDS_PER_TICK)}</span></div>
          <div class="demo-card-scores"><span>الرئيس <b class="${scoreTone(scoreOf(s.chair))}">${formatAssessmentNumber(scoreOf(s.chair).score)}</b></span><span>العضو <b class="${scoreTone(scoreOf(s.member))}">${formatAssessmentNumber(scoreOf(s.member).score)}</b></span></div>`;
      }
      return `<button type="button" class="demo-card is-${c.state} ${c.id===selectedId?"is-selected":""}" data-demo-committee="${c.id}">
        <div class="demo-card-head"><div><b>${escapeHtml(c.name)}</b><small>${c.gender}</small></div><span class="demo-state">${STATE_LABEL[c.state]}</span></div>${body}</button>`;
    }).join("");
  }
  const scoreTone=r=>r.passed?"demo-pass":"demo-fail";
  function marksBadges(m,started){
    if(!started)return `<span class="demo-badge muted">لم يبدأ</span>`;
    const parts=MARK_TYPES.filter(t=>m[t]).map(t=>`<span class="demo-badge">${TYPE_SHORT[t]} ×${formatNumber(m[t])}</span>`);
    return parts.length?parts.join(""):`<span class="demo-badge clean">بلا أخطاء</span>`;
  }
  function renderDetail(){
    if(!selectedId||!sim.committees.some(c=>c.id===selectedId))selectedId=(sim.committees.find(c=>c.state==="exam")||sim.committees[0]).id;
    const c=sim.committees.find(x=>x.id===selectedId),s=c.session,main=$("#demoDetailMain");
    if(!s){
      const r=c.lastResult;
      main.innerHTML=`<div class="demo-detail-head"><div><span class="eyebrow">${escapeHtml(c.name)} · ${c.gender} · مراقبة دون إشعار اللجنة</span><h3>${STATE_LABEL.idle}</h3><small>الرئيس: ${escapeHtml(c.chairName)} · العضو: ${escapeHtml(c.memberName)}</small></div></div>${r?`<div class="demo-idle-result"><span>آخر نتيجة معتمدة لهذه اللجنة</span><b>${escapeHtml(r.name)}</b><div><span class="outcome ${r.passed?"pass":"fail"}">${r.passed?"ناجح":"راسب"}</span> العلامة المعتمدة <b>${formatAssessmentNumber(r.score)}</b> · المدة ${formatDuration(r.duration)} · ${svg("lock")} مقفلة</div></div>`:""}<p class="demo-muted">يبدأ المتسابق التالي خلال لحظات — اختر لجنة أخرى من البطاقات أعلاه.</p>`;
      setMushaf(null);return;
    }
    const p=s.participant,chair=scoreOf(s.chair),member=scoreOf(s.member),gap=Math.abs(chair.score-member.score);
    const current=Math.min(s.current,s.positions.length-1);
    const reviewing=c.state==="review",drawing=c.state==="drawing";
    main.innerHTML=`<div class="demo-detail-head"><div><span class="eyebrow">${escapeHtml(c.name)} · ${c.gender} · مراقبة دون إشعار اللجنة</span><h3>${escapeHtml(p.name)}</h3><small>${p.level} أجزاء · ${escapeHtml(p.center)} · رقم الجلوس ${p.seat}</small></div>
        <div class="demo-detail-meta"><span class="status-pill ${c.state==="exam"?"is-live":""}">${STATE_LABEL[c.state]}</span><span class="demo-timer">${svg("timer")} ${formatDuration(s.ticks*SIM_SECONDS_PER_TICK)}</span></div></div>
      ${reviewing?`<div class="demo-review-note">${svg("scale")} انتهى الاختبار — الرئيس يراجع ${s.diffCount?`${formatNumber(s.diffCount)} ${s.diffCount===1?"موضع اختلاف":"مواضع اختلاف"}`:"الرصدين (متطابقان)"} قبل اعتماد النتيجة النهائية.</div>`:""}
      ${drawing?`<div class="demo-review-note">${svg("shield-check")} يُجرى الآن سحب عشوائي آمن لمواضع المتسابق من أجزائه المسجّلة.</div>`:""}
      <div id="demoExaminers" class="demo-examiners">
        <div class="demo-examiner"><span>رصد الرئيس · ${escapeHtml(c.chairName)}</span><b class="${scoreTone(chair)}">${formatAssessmentNumber(chair.score)}</b><small>الخصم ${formatAssessmentNumber(chair.totalDeduction)}</small></div>
        <div class="demo-examiner"><span>رصد العضو · ${escapeHtml(c.memberName)}</span><b class="${scoreTone(member)}">${formatAssessmentNumber(member.score)}</b><small>الخصم ${formatAssessmentNumber(member.totalDeduction)}</small></div>
        <div class="demo-examiner ${gap>=3?"is-gap":""}"><span>الفرق بين الرصدين</span><b>${formatAssessmentNumber(Math.round(gap*100)/100)}</b><small>${gap>=3?"اختلاف يستدعي المراجعة":"ضمن الطبيعي"}</small></div>
      </div>
      <div class="demo-positions">${s.positions.map((pos,i)=>{
        const started=i<s.current||(i===s.current&&c.state==="exam"),isCurrent=i===s.current&&c.state==="exam",diff=started&&positionDiffers(s.chair[i],s.member[i]);
        return `<article class="demo-pos ${isCurrent?"is-current":""} ${i<s.current?"is-done":""} ${diff?"has-diff":""}">
          <div class="demo-pos-title"><b>الموضع ${formatNumber(i+1)}${isCurrent?" · يُقرأ الآن":""}</b><span>${escapeHtml(positionLabel(pos))} · الجزء ${pos.juz} · الصفحة ${pos.page}</span></div>
          <div class="demo-pos-marks"><small>الرئيس</small>${marksBadges(s.chair[i],started)}</div>
          <div class="demo-pos-marks"><small>العضو</small>${marksBadges(s.member[i],started)}</div>
          <span class="demo-pos-flag">${!started?"":diff?"اختلاف":"متطابق"}</span></article>`}).join("")}</div>`;
    setMushaf(c.state==="exam"?s.positions[current]:null);
  }
  function setMushaf(position){
    const key=position?`${selectedId}-${position.page}`:"none";
    if(key===mushafKey)return;mushafKey=key;
    const fig=$("#demoMushaf");
    fig.innerHTML=position?`<img src="assets/quran-pages/page-${String(position.page).padStart(3,"0")}.jpg" alt="صفحة المصحف ${position.page}"><figcaption>الموضع الحالي · الصفحة ${position.page}</figcaption>`:`<div class="demo-mushaf-empty">${svg("eye")}<span>تظهر هنا صفحة المصحف للموضع الذي يُقرأ الآن</span></div>`;
  }
  function renderAlerts(){
    const list=sim.alerts.slice(0,7);
    $("#demoAlerts").innerHTML=list.length?list.map(a=>`<article class="demo-alert is-${a.level}">${svg(a.level==="warn"?"triangle-alert":"bell-ring")}<div><b>${escapeHtml(a.text)}</b><small>${timeAgo(a.at)}</small></div></article>`).join(""):`<p class="demo-muted">لا توجد تنبيهات حالياً.</p>`;
  }
  function renderResults(){
    $("#demoResults").innerHTML=sim.results.slice(0,8).map(r=>`<tr class="${r.id===sim.flash?"demo-flash":""}"><td><b>${escapeHtml(r.name)}</b><small class="demo-cell-sub">${r.level} أجزاء · ${escapeHtml(r.center)}</small></td><td>${escapeHtml(r.committee)}</td><td>${formatAssessmentNumber(r.chairScore)}</td><td>${formatAssessmentNumber(r.memberScore)}</td><td><b>${formatAssessmentNumber(r.score)}</b></td><td><span class="outcome ${r.passed?"pass":"fail"}">${r.passed?"ناجح":"راسب"}</span></td><td class="demo-cell-time">${svg("lock")} ${formatTime(r.approvedAt)}</td></tr>`).join("");
  }
  function renderLog(){
    $("#demoLog").innerHTML=sim.log.slice(0,14).map(e=>`<div class="demo-log-row is-${e.kind}"><time>${formatTime(e.at)}</time><span>${escapeHtml(e.text)}</span></div>`).join("");
  }
  function renderPerf(){
    const all=sim.results,overall=all.length?all.reduce((s,r)=>s+r.score,0)/all.length:0;
    $("#demoPerf").innerHTML=`<div class="demo-perf-head"><span>اللجنة</span><span>متوسط العلامة</span><span>أُنجز</span><span>النجاح</span><span>المدة</span></div>`+sim.committees.map(c=>{
      const rs=all.filter(r=>r.committeeId===c.id),n=rs.length;
      const avg=n?rs.reduce((s,r)=>s+r.score,0)/n:0,pass=n?Math.round(rs.filter(r=>r.passed).length/n*100):0,dur=n?rs.reduce((s,r)=>s+r.duration,0)/n:0;
      const delta=n>=2?avg-overall:0,flag=delta>=5?`<em class="demo-flag up">أعلى من المعدل +${formatAssessmentNumber(Math.round(delta*10)/10)}</em>`:delta<=-5?`<em class="demo-flag down">أقل من المعدل ${formatAssessmentNumber(Math.round(delta*10)/10)}</em>`:"";
      return `<div class="demo-perf-row"><span><b>${escapeHtml(c.name)}</b>${flag}</span><span class="demo-perf-bar"><i style="width:${Math.max(0,Math.min(100,(avg-50)*2))}%"></i><b>${n?formatAssessmentNumber(Math.round(avg*10)/10):"—"}</b></span><span>${formatNumber(n)}</span><span>${n?`${formatNumber(pass)}%`:"—"}</span><span>${n?formatDuration(dur):"—"}</span></div>`;
    }).join("")+`<p class="demo-muted">المعدل العام لكل اللجان: <b>${formatAssessmentNumber(Math.round(overall*10)/10)}</b> — تُبرز أي لجنة يبتعد متوسطها عنه بـ 5 علامات أو أكثر.</p>`;
  }

  function renderLevelSummary(){
    const levels=[...new Set(sim.results.map(r=>r.level))].sort((a,b)=>a-b);
    $("#demoLevelSummary").innerHTML=levels.map(level=>{const rs=sim.results.filter(r=>r.level===level),n=rs.length;
      return `<tr><td><b>${level} أجزاء</b></td><td>${formatNumber(n)}</td><td>${formatNumber(Math.round(rs.filter(r=>r.passed).length/n*100))}%</td><td>${formatAssessmentNumber(Math.round(rs.reduce((s,r)=>s+r.score,0)/n*10)/10)}</td><td>${formatAssessmentNumber(Math.max(...rs.map(r=>r.score)))}</td></tr>`}).join("");
  }
  // فحص عشوائية حقيقي بالمتصفح: 100,000 سحب بنفس المولّد الآمن الذي يستخدمه السحب الفعلي.
  function renderFairness(){
    // نفس خوارزمية randomIndex (crypto + rejection sampling) لكن بدفعات من 16384 رقماً (حد getRandomValues هو 65536 بايت) بدل طلب لكل رقم —
    // الطلب المنفرد 100,000 مرة كان يجمّد الصفحة ~1.4 ث (وأكثر بكثير على الأجهزة الضعيفة).
    const counts=new Array(30).fill(0),total=100000,limit=0x100000000-(0x100000000%30),buf=new Uint32Array(16384);
    for(let n=0;n<total;){crypto.getRandomValues(buf);for(let i=0;i<buf.length&&n<total;i++)if(buf[i]<limit){counts[buf[i]%30]++;n++}}
    const mean=total/30,max=Math.max(...counts),dev=Math.max(...counts.map(c=>Math.abs(c-mean)))/mean*100;
    $("#demoFairTitle").textContent=`فحص العشوائية: ${formatNumber(total)} سحب تجريبي على الأجزاء الثلاثين`;
    $("#demoFairBars").innerHTML=counts.map((c,i)=>`<span title="الجزء ${i+1}: ${formatNumber(c)}" style="height:${Math.round(c/max*100)}%"></span>`).join("");
    $("#demoFairNote").textContent=`أقصى انحراف عن التوزيع المتساوي ${dev.toFixed(1)}% فقط — لا أفضلية لأي جزء`;
  }
  function clearDrawTimers(){drawTimers.forEach(t=>clearTimeout(t));drawTimers=[]}
  function runDraw(){
    if(!$("#demoDrawMain"))return;
    clearDrawTimers();
    const level=pick([10,15,20]),female=Math.random()<.4,count=Math.min(LEVEL_QUESTIONS[level]||3,level);
    const parts=Array.from({length:level},(_,i)=>31-level+i);
    drawState={name:`${pick(female?FIRST_F:FIRST_M)} ${pick(FIRST_M)} ${pick(FAMILY)}`,level,center:pick(CENTERS),seat:rnd(1100,1300),parts,count,phase:"spin",flicker:new Set(),positions:[],code:""};
    renderDraw();
    const spin=setInterval(()=>{drawState.flicker=new Set(secureShuffle(parts).slice(0,count));renderDraw()},110);
    drawTimers.push(spin);
    drawTimers.push(setTimeout(()=>{
      clearInterval(spin);
      drawState.positions=drawPositions(level);drawState.flicker=new Set();drawState.phase="done";
      drawState.code=Array.from({length:2},()=>randomIndex(0x10000).toString(16).toUpperCase().padStart(4,"0")).join("-");
      renderDraw();
      if(deck&&SLIDES[deck.index]?.draw)drawTimers.push(setTimeout(runDraw,9000));
    },2600));
  }
  function renderDraw(){
    const d=drawState,main=$("#demoDrawMain");if(!d||!main)return;
    const chosen=new Set(d.positions.map(p=>p.juz));
    main.innerHTML=`<div class="demo-draw-who"><div><span class="eyebrow">المتسابق</span><h4>${escapeHtml(d.name)}</h4><small>${d.level} أجزاء · ${escapeHtml(d.center)} · رقم الجلوس ${d.seat} · ${formatNumber(d.count)} أسئلة</small></div>
        <span class="status-pill ${d.phase==="spin"?"is-live":""}">${d.phase==="spin"?"جارٍ السحب…":`${svg("shield-check")} رمز التحقق ${d.code}`}</span></div>
      <p class="demo-draw-label">أجزاء المتسابق المسجّلة (${formatNumber(d.level)})</p>
      <div class="demo-juz-grid">${d.parts.map(j=>`<span class="${d.flicker.has(j)?"is-flicker":""} ${chosen.has(j)?"is-chosen":""}">${j}</span>`).join("")}</div>
      ${d.phase==="done"?`<p class="demo-draw-label">المواضع المسحوبة</p><ol class="demo-draw-list">${d.positions.slice().sort((a,b)=>a.juz-b.juz).map(p=>`<li><b>الجزء ${p.juz}</b><span>${escapeHtml(positionLabel(p))}</span><small>الصفحة ${p.page}</small></li>`).join("")}</ol>`:`<p class="demo-muted">يختار المولّد الآمن ${formatNumber(d.count)} أجزاء مختلفة، ثم موضعاً عشوائياً من كل جزء…</p>`}`;
    if(deck&&d.phase==="done")fitSlide();
  }

  function chooseShowcaseCommittee(){
    const exams=sim.committees.filter(c=>c.state==="exam"),left=c=>c.session.positions.length-c.session.current;
    const best=exams.filter(c=>c.session.positions.length<=8&&c.session.current>=2&&left(c)>=1).sort((a,b)=>b.session.current-a.session.current)[0]||exams.filter(c=>c.session.current>=2&&left(c)>=1)[0]||exams[0];
    if(best){selectedId=best.id;mushafKey=""}
  }
  function startDeck(){
    deck={index:-1,timer:null,paused:false};
    paused=false;if(speed<2)setSpeed(2);
    document.documentElement.classList.add("demo-presenting");view().classList.add("demo-present");
    document.documentElement.requestFullscreen?.().catch(()=>{});
    document.addEventListener("keydown",deckKeys);document.addEventListener("mousemove",wakeControls);
    window.addEventListener("resize",fitSlide);
    wakeControls();goSlide(0);
  }
  function goSlide(index){
    if(!deck)return;
    deck.index=Math.max(0,Math.min(SLIDES.length-1,index));
    const slide=SLIDES[deck.index];
    if(slide.select)chooseShowcaseCommittee();
    view().querySelectorAll(".demo-shown,.demo-spotlight").forEach(el=>el.classList.remove("demo-shown","demo-spotlight"));
    clearZoom();window.scrollTo({top:0});
    render();
    slide.show.forEach(sel=>$(sel)?.classList.add("demo-shown"));
    if(slide.draw)runDraw();
    $("#demoStageKicker").textContent=slide.kicker;$("#demoStageTitle").textContent=slide.title;
    $("#demoStageCount").textContent=`${formatNumber(deck.index+1)} من ${formatNumber(SLIDES.length)}`;$("#demoStageText").textContent=slide.text;
    const head=view().querySelector(".demo-stage-head");
    [head,...slide.show.map(sel=>$(sel))].forEach(el=>{if(!el)return;el.classList.remove("demo-slide-in");void el.offsetWidth;el.classList.add("demo-slide-in")});
    fitSlide();
    scheduleNext();syncControls();
  }
  // كل شريحة تُصغَّر عند الحاجة لتتسع كاملة بالشاشة، فلا تمرير ولا حركة مربكة للناظر. التكبير يعود
  // فقط عند فرق ملحوظ (5%) حتى لا يرتجف المحتوى مع كل تحديث.
  function fitSlide(){
    if(!deck)return;
    const els=SLIDES[deck.index].show.map(sel=>$(sel)).filter(el=>el&&el.offsetParent!==null);
    if(!els.length)return;
    const prev=Number(els[0].style.zoom)||1;
    els.forEach(el=>el.style.zoom="");
    const rects=els.map(el=>el.getBoundingClientRect()),top=Math.min(...rects.map(r=>r.top)),height=Math.max(...rects.map(r=>r.bottom))-top;
    let scale=Math.max(.5,Math.min(1,(window.innerHeight-top-96)/height));
    if(scale>prev&&scale-prev<.05)scale=prev;
    els.forEach(el=>el.style.zoom=scale<1?String(Math.round(scale*100)/100):"");
  }
  function clearZoom(){view()?.querySelectorAll(".demo-section,#demoKpis").forEach(el=>el.style.zoom="")}
  function scheduleNext(){
    if(!deck)return;
    clearTimeout(deck.timer);
    const bar=$("#demoDeckBar"),last=deck.index>=SLIDES.length-1;
    bar.style.animation="none";void bar.offsetWidth;
    if(!deckAuto||deck.paused||last){bar.style.width=last?"100%":"0";return}
    const seconds=SLIDES[deck.index].sec||12;
    bar.style.width="";bar.style.animation=`demoDeckBar ${seconds}s linear forwards`;
    deck.timer=setTimeout(()=>goSlide(deck.index+1),seconds*1000);
  }
  function deckKeys(event){
    if(!deck)return;
    const key=event.key;
    if(["ArrowLeft","PageDown","Enter"].includes(key)){event.preventDefault();goSlide(deck.index+1)}
    else if(["ArrowRight","PageUp","Backspace"].includes(key)){event.preventDefault();goSlide(deck.index-1)}
    else if(key===" "){event.preventDefault();deck.paused=!deck.paused;scheduleNext();syncControls()}
    else if(key==="Escape")endDeck();
    else return;
    wakeControls();
  }
  // أزرار التحكم والمؤشر يختفيان بعد ثانيتين ونصف بلا حركة، حتى يبقى الفيديو نظيفاً.
  function wakeControls(){
    document.documentElement.classList.remove("demo-idle");
    clearTimeout(idleTimer);
    if(deck)idleTimer=setTimeout(()=>document.documentElement.classList.add("demo-idle"),2500);
  }
  function endDeck(){
    if(!deck)return;
    clearTimeout(deck.timer);deck=null;clearTimeout(idleTimer);clearZoom();
    window.removeEventListener("resize",fitSlide);
    document.removeEventListener("keydown",deckKeys);document.removeEventListener("mousemove",wakeControls);
    document.documentElement.classList.remove("demo-presenting","demo-idle");
    view()?.classList.remove("demo-present");
    view()?.querySelectorAll(".demo-shown,.demo-spotlight").forEach(el=>el.classList.remove("demo-shown","demo-spotlight"));
    if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});
    syncControls();
  }

  function tick(){
    if(!isVisible()){stop();return}
    if(!paused)sim.committees.forEach(stepCommittee);
    render();
  }
  async function start(){
    if(!view())return;
    if(!view().childElementCount){view().innerHTML=`<div class="monitor-empty">جارٍ تجهيز العرض التوضيحي…</div>`}
    await loadPool();
    if(!isVisible())return;
    if(!sim)buildSim();
    if(!$("#demoGrid"))skeleton();
    syncControls();render();
    if(!timer)timer=setInterval(tick,TICK_MS/speed);
  }
  function stop(){if(timer)clearInterval(timer);timer=null;clearDrawTimers();endDeck()}
  // المدخل السري: خمس نقرات خلال ثانيتين على شعار القائمة الجانبية. للمدير الرئيسي بالسحابة أو الوضع المحلي فقط.
  let logoClicks=[];
  document.addEventListener("click",event=>{
    if(!event.target.closest(".sidebar-logo"))return;
    const now=Date.now();logoClicks=logoClicks.filter(t=>now-t<2000);logoClicks.push(now);
    if(logoClicks.length<5)return;
    logoClicks=[];
    if(operationMode==="local"||window.CloudCompetition?.context?.kind==="admin")navigate("demo");
  });
  window.DemoMode={start,stop};
})();
