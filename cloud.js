"use strict";

window.CloudCompetition=(()=>{
  const TOKEN_KEY="competition.committeeToken";
  const SUB_ADMIN_TOKEN_KEY="competition.subAdminToken";
  let client=null,context=null,saveTimer=null,sessionSaveTimer=null,lastAccessRefresh=0,committeeRequest=null;
  let subAdminSaveTimer=null,subAdminKnownIds=new Set();
  let supervisorSaveTimer=null,supervisorKnownParticipantIds=new Set(),supervisorKnownDrawIds=new Set();
  const config=()=>window.SUPABASE_CONFIG||{};
  const enabled=()=>Boolean(config().url&&config().anonKey&&window.supabase?.createClient);
  const rpcError=error=>new Error(error?.code?error.message:"تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجددًا");

  async function init(){
    if(!enabled())return {enabled:false};
    client=window.supabase.createClient(config().url,config().anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data:{session}}=await client.auth.getSession();
    if(session)context=await loadAdminContext(session.user);
    else if(localStorage.getItem(TOKEN_KEY)){
      try{context=await resumeCommittee(localStorage.getItem(TOKEN_KEY))}catch{localStorage.removeItem(TOKEN_KEY)}
    }else if(localStorage.getItem(SUB_ADMIN_TOKEN_KEY)){
      try{context=await resumeSubAdmin(localStorage.getItem(SUB_ADMIN_TOKEN_KEY))}catch{localStorage.removeItem(SUB_ADMIN_TOKEN_KEY)}
    }
    return {enabled:true,context};
  }

  // الإداري الرئيسي ومشرف المسابقة كلاهما حساب Supabase Auth حقيقي، ويدخلان من نفس نموذج
  // البريد/كلمة السر — الدور (admin أو supervisor) محفوظ في profiles.role ويحدد الصلاحيات.
  async function loadAdminContext(user){
    const {data:profile,error}=await client.from("profiles").select("id,role,display_name,can_edit_final,can_delete_data").eq("id",user.id).single();
    if(error||!["admin","supervisor"].includes(profile?.role))throw new Error("الحساب موجود لكن ملف الصلاحية غير مُعدّ");
    return context={kind:profile.role,user,profile,committee:null};
  }
  async function signInAdmin(email,password){const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw new Error("بيانات الدخول غير صحيحة");return loadAdminContext(data.user)}
  // "نسيت كلمة السر/الرمز" — لكل الحسابات (إدارة/مشرف بالإيميل، لجنة/مسؤول فرعي برمز الدخول)،
  // تدفق ذاتي كامل عبر Edge Function واحدة (password-reset) تشتغل بصلاحية service_role (لا
  // يوجد المفتاح بالمتصفح إطلاقاً): ترسل رمزاً للإداري الرئيسي فقط، وتحدّث كلمة السر/الـPIN
  // مباشرة على نفس الحساب بعد التحقق من الرمز. identifier: إيميل أو رمز دخول اللجنة/المسؤول.
  async function requestLoginRecoveryCode(identifier){const {data,error}=await client.functions.invoke("password-reset",{body:{action:"request",identifier}});if(error)throw rpcError(error);if(data?.ok===false)throw new Error(data.error||"تعذر إرسال الرمز");return data}
  async function confirmLoginRecovery(identifier,code,newValue){const {data,error}=await client.functions.invoke("password-reset",{body:{action:"reset",identifier,code,newValue}});if(error)throw rpcError(error);if(data?.ok===false)throw new Error(data.error||"تعذر التحديث");return data}
  async function signInCommittee(code,pin){const {data,error}=await client.rpc("committee_login",{p_login_code:code,p_pin:pin});if(error)throw rpcError(error);localStorage.setItem(TOKEN_KEY,data.token);return context={kind:"committee",token:data.token,committee:data.committee,profile:{role:"committee",display_name:data.committee.name}}}
  async function resumeCommittee(token){const {data,error}=await client.rpc("committee_resume",{p_token:token});if(error)throw rpcError(error);return context={kind:"committee",token,committee:data,profile:{role:"committee",display_name:data.name}}}
  async function refreshCommitteeAccess(force=false){if(context?.kind!=="committee")return null;if(!force&&Date.now()-lastAccessRefresh<15000)return context.committee;const resumed=await resumeCommittee(context.token);lastAccessRefresh=Date.now();return resumed.committee}
  async function signInSubAdmin(code,pin){const {data,error}=await client.rpc("sub_admin_login",{p_login_code:code,p_pin:pin});if(error)throw rpcError(error);localStorage.setItem(SUB_ADMIN_TOKEN_KEY,data.token);return context={kind:"subAdmin",token:data.token,subAdmin:data.admin,profile:{role:"subAdmin",display_name:data.admin.name}}}
  async function resumeSubAdmin(token){const {data,error}=await client.rpc("sub_admin_resume",{p_token:token});if(error)throw rpcError(error);return context={kind:"subAdmin",token,subAdmin:data,profile:{role:"subAdmin",display_name:data.name}}}
  async function signOut(){if(context?.kind==="committee"){await client.rpc("committee_logout",{p_token:context.token});localStorage.removeItem(TOKEN_KEY)}else if(context?.kind==="subAdmin"){await client.rpc("sub_admin_logout",{p_token:context.token});localStorage.removeItem(SUB_ADMIN_TOKEN_KEY)}else await client.auth.signOut();context=null}

  async function loadCompetitionState(){if(context?.kind==="committee"){const {data,error}=await client.rpc("committee_load_state",{p_token:context.token});if(error)throw rpcError(error);return {payload:data}}if(context?.kind==="subAdmin"){const {data,error}=await client.rpc("sub_admin_load_state",{p_token:context.token});if(error)throw rpcError(error);return {payload:data}}if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_load_state");if(error)throw rpcError(error);return {payload:data}}const {data,error}=await client.from("competition_state").select("payload,updated_at").eq("id",1).single();if(error)throw error;return data}
  let adminKnownParticipantIds=new Set(),adminKnownDrawIds=new Set();
  function markAdminKnownIds(participants,draws){adminKnownParticipantIds=new Set((participants||[]).map(p=>p.id));adminKnownDrawIds=new Set((draws||[]).map(d=>d.id))}
  // يدمج بدل الاستبدال الأعمى: أي متسابق أو سحب أضافه طرف آخر (مسؤول فرعي مثلاً) بعد آخر
  // مزامنة محلية للإدارة يبقى محفوظاً بدل أن يُمحى بصمت لو حفظت الإدارة في نفس اللحظة تقريباً.
  async function saveCompetitionState(payload){
    const currentParticipantIds=new Set((payload.participants||[]).map(p=>p.id));
    const currentDrawIds=new Set((payload.draws||[]).map(d=>d.id));
    const deletedParticipantIds=[...adminKnownParticipantIds].filter(id=>!currentParticipantIds.has(id));
    const deletedDrawIds=[...adminKnownDrawIds].filter(id=>!currentDrawIds.has(id));
    const {error}=await client.rpc("admin_save_state",{p_config:payload.config,p_participants:payload.participants,p_draws:payload.draws,p_deleted_participant_ids:deletedParticipantIds,p_deleted_draw_ids:deletedDrawIds});
    if(error)throw rpcError(error);
    adminKnownParticipantIds=currentParticipantIds;adminKnownDrawIds=currentDrawIds;
  }
  function queueStateSave(payload,onError){if(context?.kind!=="admin")return;clearTimeout(saveTimer);const snapshot=JSON.parse(JSON.stringify(payload));saveTimer=setTimeout(()=>saveCompetitionState(snapshot).catch(onError||console.error),450)}

  function markSupervisorKnownIds(participants,draws){supervisorKnownParticipantIds=new Set((participants||[]).map(p=>p.id));supervisorKnownDrawIds=new Set((draws||[]).map(d=>d.id))}
  async function saveSupervisorState(payload){
    const currentParticipantIds=new Set((payload.participants||[]).map(p=>p.id));
    const currentDrawIds=new Set((payload.draws||[]).map(d=>d.id));
    const deletedParticipantIds=[...supervisorKnownParticipantIds].filter(id=>!currentParticipantIds.has(id));
    const deletedDrawIds=[...supervisorKnownDrawIds].filter(id=>!currentDrawIds.has(id));
    const {error}=await client.rpc("supervisor_save_state",{p_participants:payload.participants,p_draws:payload.draws,p_deleted_participant_ids:deletedParticipantIds,p_deleted_draw_ids:deletedDrawIds});
    if(error)throw rpcError(error);
    supervisorKnownParticipantIds=currentParticipantIds;supervisorKnownDrawIds=currentDrawIds;
  }
  function queueSupervisorSave(payload,onError){if(context?.kind!=="supervisor")return;clearTimeout(supervisorSaveTimer);const snapshot=JSON.parse(JSON.stringify(payload));supervisorSaveTimer=setTimeout(()=>saveSupervisorState(snapshot).catch(onError||console.error),450)}

  // القراءة (لجان/جلسات/أدمن فرعي/سجل النشاط): يشترك فيها admin وsupervisor عبر نفس القراءة
  // المباشرة من الجداول — سياسات RLS موسّعة لتشمل الدورين، فلا حاجة لأي تفرّع هنا.
  // show_stats_summary عمود إضافي جديد (زر مستقل لإخفاء/إظهار بطاقة إحصائية اللجنة، منفصل عن
  // show_score) قد لا يكون مُطبَّقاً بعد على قاعدة بيانات معينة (راجع supabase/committee-stats-
  // summary-visibility.sql) — لو فشل السطر الأول بسببه (العمود غير موجود)، نتراجع فورًا للقائمة
  // القديمة بلا هذا العمود، بدل ما تنكسر شاشة إدارة اللجان كاملةً لحين تطبيق ملف الـSQL.
  async function listCommittees(){if(committeeRequest)return committeeRequest;committeeRequest=(async()=>{const {data,error}=await client.from("committees").select("id,name,chairman_name,member_name,responsible_gender,level_names,levels,extra_participant_ids,active,login_code,member_login_code,can_edit_final,can_self_draw,show_score,show_stats_summary,created_at").order("created_at");if(!error)return data;const fallback=await client.from("committees").select("id,name,chairman_name,member_name,responsible_gender,level_names,levels,extra_participant_ids,active,login_code,member_login_code,can_edit_final,can_self_draw,show_score,created_at").order("created_at");if(fallback.error)throw fallback.error;return fallback.data})();try{return await committeeRequest}finally{committeeRequest=null}}
  async function saveCommittee(values){if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_save_committee",{p_id:values.id||null,p_name:values.name,p_chairman_name:values.chairmanName,p_chairman_code:values.code,p_chairman_pin:values.pin||"",p_member_name:values.memberName||null,p_member_code:values.memberCode,p_member_pin:values.memberPin||"",p_responsible_gender:values.responsibleGender,p_level_names:values.levelNames,p_active:values.active!==false});if(error)throw rpcError(error);return data}const {data,error}=await client.rpc("admin_save_committee_v3",{p_id:values.id||null,p_name:values.name,p_chairman_name:values.chairmanName,p_chairman_code:values.code,p_chairman_pin:values.pin||"",p_member_name:values.memberName||null,p_member_code:values.memberCode,p_member_pin:values.memberPin||"",p_responsible_gender:values.responsibleGender,p_level_names:values.levelNames,p_active:values.active!==false});if(error)throw rpcError(error);return data}
  async function assignParticipantToCommittee(committeeId,participantId,assign=true){if(context?.kind==="subAdmin"){const {data,error}=await client.rpc("sub_admin_assign_participant_to_committee",{p_token:context.token,p_committee_id:committeeId,p_participant_id:participantId,p_assign:assign});if(error)throw rpcError(error);return data}const {data,error}=await client.rpc("admin_assign_participant_to_committee",{p_committee_id:committeeId,p_participant_id:participantId,p_assign:assign});if(error)throw rpcError(error);return data}
  async function transferParticipant(participantId,committeeId){if(context?.kind==="subAdmin"){const {data,error}=await client.rpc("sub_admin_transfer_participant",{p_token:context.token,p_participant_id:participantId,p_committee_id:committeeId});if(error)throw rpcError(error);return data}if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_transfer_participant",{p_participant_id:participantId,p_committee_id:committeeId});if(error)throw rpcError(error);return data}const {data,error}=await client.rpc("admin_transfer_participant",{p_participant_id:participantId,p_committee_id:committeeId});if(error)throw rpcError(error);return data}
  async function setCommitteeActive(id,active){if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_set_committee_active",{p_committee_id:id,p_active:active});if(error)throw rpcError(error);return data}const {data,error}=await client.from("committees").update({active}).eq("id",id).select().single();if(error)throw error;return data}
  async function deleteCommittee(id,purgeHistory=false){const {data,error}=await client.rpc("admin_delete_committee",{p_committee_id:id,p_purge_history:purgeHistory});if(error)throw rpcError(error);return data}
  async function setCommitteeFinalEdit(id,enabled){if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_set_committee_final_edit",{p_committee_id:id,p_enabled:Boolean(enabled)});if(error)throw rpcError(error);return data}const {data,error}=await client.rpc("admin_set_committee_final_edit",{p_committee_id:id,p_enabled:Boolean(enabled)});if(error)throw rpcError(error);return data}
  async function setCommitteeSelfDraw(id,enabled){const {data,error}=await client.rpc("admin_set_committee_self_draw",{p_committee_id:id,p_enabled:Boolean(enabled)});if(error)throw rpcError(error);return data}
  async function setCommitteeShowScore(id,enabled){if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_set_committee_show_score",{p_committee_id:id,p_enabled:Boolean(enabled)});if(error)throw rpcError(error);return data}const {data,error}=await client.rpc("admin_set_committee_show_score",{p_committee_id:id,p_enabled:Boolean(enabled)});if(error)throw rpcError(error);return data}
  async function setCommitteeShowStatsSummary(id,enabled){if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_set_committee_show_stats_summary",{p_committee_id:id,p_enabled:Boolean(enabled)});if(error)throw rpcError(error);return data}const {data,error}=await client.rpc("admin_set_committee_show_stats_summary",{p_committee_id:id,p_enabled:Boolean(enabled)});if(error)throw rpcError(error);return data}
  async function listFinalEditAudit(){const {data,error}=await client.from("audit_log").select("id,action,entity_type,entity_id,details,created_at").in("action",["grant_final_edit","revoke_final_edit","reopen_final_result","revise_final_result"]).order("created_at",{ascending:false}).limit(100);if(error)throw error;return data}
  async function deleteParticipantSession(participantId){if(context?.kind==="supervisor"){const {error}=await client.rpc("supervisor_delete_participant_session",{p_participant_id:participantId});if(error)throw rpcError(error);return}if(context?.kind==="subAdmin"){const {error}=await client.rpc("sub_admin_delete_participant_session",{p_token:context.token,p_participant_id:participantId});if(error)throw rpcError(error);return}if(context?.kind!=="admin")return;const {error}=await client.rpc("admin_delete_participant_session",{p_participant_id:participantId});if(error)throw rpcError(error)}
  async function listSessions(){if(context?.kind==="committee"){const {data,error}=await client.rpc("committee_list_sessions",{p_token:context.token});if(error)throw rpcError(error);return data}if(context?.kind==="subAdmin"){const {data,error}=await client.rpc("sub_admin_list_sessions",{p_token:context.token});if(error)throw rpcError(error);return data}const {data,error}=await client.from("exam_sessions").select("*").order("updated_at",{ascending:false});if(error)throw error;return data}
  // خفيفة عن listSessions: تجلب فقط الجلسات المعتمدة نهائيًا (final)، وهي كل ما يحتاجه
  // دمج النتائج بجهاز الإدارة (mergeFinalSessionsIntoState) — تتجنب سحب كل الجلسات الجارية
  // (في_تقدم) بتفاصيلها الكاملة يلي تكبر وتتحدّث باستمرار أثناء الرصد الفعلي عند اللجان.
  async function listFinalSessions(){const {data,error}=await client.from("exam_sessions").select("*").eq("status","final").order("updated_at",{ascending:false});if(error)throw error;return data}
  // خفيفة عن listSessions: تجلب فقط الجلسات الجارية الآن (in_progress)، لا تجرّ معها كل جلسة
  // معتمدة (final) سابقة — تستخدمها المراقبة الحية فقط، التي تستطلع كل 4 ثوانٍ وما بيهمها إلا
  // الجلسات الجارية، فتتجنب سحب أرشيف الجلسات المعتمدة (وتقييماتها الكاملة) في كل استطلاع
  // كلما تراكمت اختبارات منتهية أكثر بمرور اليوم.
  async function listActiveSessions(){if(context?.kind==="subAdmin"){const {data,error}=await client.rpc("sub_admin_list_sessions",{p_token:context.token});if(error)throw rpcError(error);return (data||[]).filter(s=>s.status==="in_progress")}const {data,error}=await client.from("exam_sessions").select("*").eq("status","in_progress").order("updated_at",{ascending:false});if(error)throw error;return data}
  // نافذة زمنية متجددة بدل كل الجلسات المعتمدة منذ أول يوم بالمسابقة: تُستخدم فقط باستطلاع
  // الإدارة الدوري (refreshAdminChanges كل 9 ثوانٍ). جلسة اعتُمدت قبل أكثر من sinceIso عمليًا
  // لن تتغيّر (إلا بإعادة فتحها للتعديل، وحينها finalized_at تصير جديدة فتدخل النافذة من جديد
  // تلقائيًا)، فلا داعي لسحبها بكل نبضة — بياناتها محفوظة أصلاً محليًا من آخر مرة كانت "حديثة"
  // أو من الجلب الكامل عند تسجيل الدخول/زر "تحديث النتائج" اليدوي (listFinalSessions العادية).
  async function listRecentFinalSessions(sinceIso){const {data,error}=await client.from("exam_sessions").select("*").eq("status","final").gte("finalized_at",sinceIso).order("updated_at",{ascending:false});if(error)throw error;return data}
  // نسخة "حية فقط" من listSessions (اللجنة/المسؤول الفرعي): تجلب الجلسات الجارية حاليًا + المعتمدة
  // خلال sinceIso فقط، بدل كامل تاريخ اللجنة منذ أول يوم — تُستخدم باستطلاع اللجنة الدوري (9 ثوانٍ).
  // تعتمد على دالتَي SQL إضافيتين (committee_list_live_sessions/sub_admin_list_live_sessions،
  // راجع supabase/exam-sessions-tiered-realtime.sql) قد لا تكونان مُطبَّقتين بعد على قاعدة بيانات
  // معينة — لو فشل الاستدعاء (الدالة غير موجودة بعد)، نتراجع فورًا لـlistSessions الكاملة
  // بلا أي انقطاع بعمل اللجنة (فقط بلا توفير بالبيانات المنقولة إلى حين تطبيق ملف الـSQL).
  async function listLiveCommitteeSessions(sinceIso){
    try{
      if(context?.kind==="committee"){const {data,error}=await client.rpc("committee_list_live_sessions",{p_token:context.token,p_since:sinceIso});if(error)throw error;return data}
      if(context?.kind==="subAdmin"){const {data,error}=await client.rpc("sub_admin_list_live_sessions",{p_token:context.token,p_since:sinceIso});if(error)throw error;return data}
    }catch(error){console.warn("[examTrace] listLiveCommitteeSessions: الدالة الخفيفة غير متاحة بعد (طبّق supabase/exam-sessions-tiered-realtime.sql)، رجوع للجلب الكامل مؤقتًا",error?.message)}
    return listSessions();
  }
  // جلسة واحدة بعينها بدل قائمة اللجنة الكاملة — لمزامنة موضع الرئيس أثناء رصد العضو (كل 1.5
  // ثانية، أسخن نقطة استطلاع بالموقع). نفس منطق التراجع الآمن أعلاه لو الدالة الخفيفة غير
  // مُطبَّقة بعد؛ ولو نجحت لكن الجلسة غير موجودة/لا تخص هذه اللجنة (data فارغة)، نتراجع أيضًا
  // للبحث بالقائمة الكاملة كطبقة أمان إضافية بدل افتراض "غير موجودة" من أول محاولة.
  async function getCommitteeSession(sessionId){
    if(context?.kind==="committee"){
      try{
        const {data,error}=await client.rpc("committee_get_session",{p_token:context.token,p_session_id:sessionId});
        if(error)throw error;
        if(data)return data;
      }catch(error){console.warn("[examTrace] getCommitteeSession: الدالة الخفيفة غير متاحة بعد (طبّق supabase/exam-sessions-tiered-realtime.sql)، رجوع للجلب الكامل مؤقتًا",error?.message)}
    }
    const sessions=await listSessions();
    return sessions.find(item=>item.id===sessionId)||null;
  }
  async function listCommitteeNotifications(){if(context?.kind!=="committee")return [];const {data,error}=await client.rpc("committee_list_notifications",{p_token:context.token});if(error)throw rpcError(error);return data||[]}
  async function lookupChangeTimes(participantIds){if(context?.kind!=="committee"||!participantIds?.length)return [];const {data,error}=await client.rpc("committee_lookup_change_times",{p_token:context.token,p_participant_ids:participantIds});if(error)throw rpcError(error);return data||[]}
  async function reportCommitteeIssue(participantId,message){if(context?.kind!=="committee")return;const {error}=await client.rpc("committee_report_issue",{p_token:context.token,p_participant_id:participantId,p_message:message});if(error)throw rpcError(error)}
  async function listIssueReports(){if(context?.kind==="subAdmin"){const {data,error}=await client.rpc("sub_admin_list_issue_reports",{p_token:context.token});if(error)throw rpcError(error);return data||[]}if(!["admin","supervisor"].includes(context?.kind))return [];const {data,error}=await client.from("committee_issue_reports").select("*").eq("resolved",false).order("created_at",{ascending:false}).limit(200);if(error)throw error;return data||[]}
  async function resolveIssueReport(id){if(context?.kind==="subAdmin"){const {error}=await client.rpc("sub_admin_resolve_issue_report",{p_token:context.token,p_id:id});if(error)throw rpcError(error);return}if(!["admin","supervisor"].includes(context?.kind))return;const {error}=await client.from("committee_issue_reports").update({resolved:true,resolved_at:new Date().toISOString()}).eq("id",id);if(error)throw error}
  async function claimStudent(participantId,drawId,level){const {data,error}=await client.rpc("committee_claim_student",{p_token:context.token,p_participant_id:participantId,p_draw_id:drawId,p_level:Number(level)});if(error)throw rpcError(error);return data}
  async function cancelCommitteeSession(participantId){const {error}=await client.rpc("committee_cancel_session",{p_token:context.token,p_participant_id:participantId});if(error)throw rpcError(error)}
  async function createCommitteeDraw(participantId,level,parts,draw,changeReason=""){const {data,error}=await client.rpc("committee_create_draw",{p_token:context.token,p_participant_id:participantId,p_level:Number(level),p_parts:parts.map(Number),p_draw:draw,p_change_reason:changeReason||null});if(error)throw rpcError(error);return data}
  async function listCommitteeUsedPositionIds(){const {data,error}=await client.rpc("committee_used_position_ids",{p_token:context.token});if(error)throw rpcError(error);return data||[]}
  async function createAdminDraw(draw){const {data,error}=await client.rpc("admin_create_draw",{p_draw:draw});if(error)throw rpcError(error);return data}
  async function createSupervisorDraw(draw){const {data,error}=await client.rpc("supervisor_create_draw",{p_draw:draw});if(error)throw rpcError(error);return data}
  async function replaceCommitteePosition(participantId,drawId,index,position,assessment){const {data,error}=await client.rpc("committee_replace_position",{p_token:context.token,p_participant_id:participantId,p_draw_id:drawId,p_position_index:Number(index),p_position:position,p_assessment:assessment});if(error)throw rpcError(error);return data}
  async function saveSession(sessionId,assessment,status="in_progress",score=null){if(context?.committee){assessment.committeeName=context.committee.name;assessment.committee={id:context.committee.id,name:context.committee.name}}const {data,error}=await client.rpc("committee_save_session",{p_token:context.token,p_session_id:sessionId,p_assessment:assessment,p_status:status,p_score:score});if(error)throw rpcError(error);return data}
  function queueSessionSave(sessionId,assessment,onError){clearTimeout(sessionSaveTimer);const snapshot=JSON.parse(JSON.stringify(assessment));sessionSaveTimer=setTimeout(()=>saveSession(sessionId,snapshot).catch(onError||console.error),300)}
  // يمنع حفظ مسودة تلقائي متأخر (مجدول قبل ثوانٍ من "queueSessionSave") من الوصول للسيرفر
  // بعد اعتماد النتيجة النهائية ويرجّعها بالغلط لحالة "قيد الاختبار" بعلامة فارغة — استدعها
  // فورًا قبل أي حفظ مباشر (اعتماد نهائي أو تثبيت رصد) حتى لا يتزاحم مع مسودة معلّقة.
  function cancelQueuedSessionSave(){clearTimeout(sessionSaveTimer);sessionSaveTimer=null}
  // عمداً بلا تنفيذ: كل الأفعال المهمة تُسجَّل من داخل دوال قاعدة البيانات نفسها (audit_log)،
  // وهذا الاستدعاء من الواجهة موجود فقط لتوافق نداءات قديمة في app.js.
  async function log(){return}

  async function listSubAdmins(){const {data,error}=await client.from("sub_admins").select("id,name,login_code,gender,active,created_at").order("created_at");if(error)throw error;return data}
  async function saveSubAdmin(values){if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_save_sub_admin",{p_id:values.id||null,p_name:values.name,p_login_code:values.code,p_pin:values.pin||"",p_gender:values.gender,p_active:values.active!==false});if(error)throw rpcError(error);return data}const {data,error}=await client.rpc("admin_save_sub_admin",{p_id:values.id||null,p_name:values.name,p_login_code:values.code,p_pin:values.pin||"",p_gender:values.gender,p_active:values.active!==false});if(error)throw rpcError(error);return data}
  async function deleteSubAdmin(id){if(context?.kind==="supervisor"){const {data,error}=await client.rpc("supervisor_delete_sub_admin",{p_id:id});if(error)throw rpcError(error);return data}const {data,error}=await client.rpc("admin_delete_sub_admin",{p_id:id});if(error)throw rpcError(error);return data}
  async function saveSubAdminParticipants(participants,deletedIds=[]){const {data,error}=await client.rpc("sub_admin_save_participants",{p_token:context.token,p_participants:participants,p_deleted_ids:deletedIds});if(error)throw rpcError(error);return data}
  function markSubAdminKnownIds(ids){subAdminKnownIds=new Set(ids)}
  function queueSubAdminParticipantsSave(participants,onError){if(context?.kind!=="subAdmin")return;clearTimeout(subAdminSaveTimer);const snapshot=JSON.parse(JSON.stringify(participants));subAdminSaveTimer=setTimeout(()=>{const currentIds=new Set(snapshot.map(p=>p.id)),deletedIds=[...subAdminKnownIds].filter(id=>!currentIds.has(id));saveSubAdminParticipants(snapshot,deletedIds).then(()=>{subAdminKnownIds=currentIds}).catch(onError||console.error)},450)}
  async function createSubAdminDraw(draw){const {data,error}=await client.rpc("sub_admin_create_draw",{p_token:context.token,p_draw:draw});if(error)throw rpcError(error);return data}
  async function listActivityLog(limit=200){const {data,error}=await client.from("audit_log").select("id,actor_id,action,entity_type,entity_id,details,created_at").order("created_at",{ascending:false}).limit(limit);if(error)throw error;return data}

  // النسخ الاحتياطي التلقائي الدوري — يُرسله فعليًا Edge Function خارجية على جدولة Cron
  // (راجع supabase/functions/auto-backup)؛ هذا فقط تفعيل/تعطيل الفاصل الزمني من هنا.
  async function getBackupSettings(){const {data,error}=await client.from("backup_settings").select("*").eq("id",1).single();if(error)throw error;return data}
  async function setBackupSettings({enabled,intervalMinutes,notifyEmail}){const patch={};if(enabled!==undefined)patch.enabled=enabled;if(intervalMinutes!==undefined)patch.interval_minutes=intervalMinutes;if(notifyEmail!==undefined)patch.notify_email=notifyEmail;const {data,error}=await client.from("backup_settings").update(patch).eq("id",1).select().single();if(error)throw error;return data}

  // إدارة حسابات المشرفين — للإداري الرئيسي فقط. لا يوجد service_role بالمشروع، فلا يمكن
  // إنشاء مستخدم Supabase Auth جديد من هنا؛ الإداري يُنشئه يدويًا من لوحة Supabase أولاً،
  // وهذه الدوال تربط الـ UID الناتج بدور supervisor داخل profiles فقط.
  async function listSupervisors(){const {data,error}=await client.rpc("admin_list_supervisors");if(error)throw rpcError(error);return data}
  async function linkSupervisor(values){const {data,error}=await client.rpc("admin_link_supervisor",{p_user_id:values.userId,p_name:values.name,p_can_edit_final:Boolean(values.canEditFinal),p_can_delete_data:Boolean(values.canDeleteData)});if(error)throw rpcError(error);return data}
  async function unlinkSupervisor(id){const {data,error}=await client.rpc("admin_delete_supervisor",{p_id:id});if(error)throw rpcError(error);return data}

  return {enabled,init,signInAdmin,requestLoginRecoveryCode,confirmLoginRecovery,signInCommittee,signInSubAdmin,resumeSubAdmin,refreshCommitteeAccess,signOut,loadCompetitionState,saveCompetitionState,queueStateSave,markAdminKnownIds,listCommittees,saveCommittee,assignParticipantToCommittee,transferParticipant,setCommitteeActive,deleteCommittee,setCommitteeFinalEdit,setCommitteeSelfDraw,setCommitteeShowScore,setCommitteeShowStatsSummary,listFinalEditAudit,deleteParticipantSession,listSessions,listFinalSessions,listActiveSessions,listRecentFinalSessions,listLiveCommitteeSessions,getCommitteeSession,listCommitteeNotifications,reportCommitteeIssue,listIssueReports,resolveIssueReport,lookupChangeTimes,claimStudent,cancelCommitteeSession,createCommitteeDraw,listCommitteeUsedPositionIds,createAdminDraw,createSupervisorDraw,replaceCommitteePosition,saveSession,queueSessionSave,cancelQueuedSessionSave,log,listSubAdmins,saveSubAdmin,deleteSubAdmin,saveSubAdminParticipants,queueSubAdminParticipantsSave,markSubAdminKnownIds,createSubAdminDraw,listActivityLog,getBackupSettings,setBackupSettings,markSupervisorKnownIds,saveSupervisorState,queueSupervisorSave,listSupervisors,linkSupervisor,unlinkSupervisor,get context(){return context},get client(){return client}};
})();
