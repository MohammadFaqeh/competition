"use strict";

window.CloudCompetition=(()=>{
  const TOKEN_KEY="competition.committeeToken";
  let client=null,context=null,saveTimer=null,sessionSaveTimer=null,lastAccessRefresh=0,committeeRequest=null;
  const config=()=>window.SUPABASE_CONFIG||{};
  const enabled=()=>Boolean(config().url&&config().anonKey&&window.supabase?.createClient);
  const rpcError=error=>new Error(error?.message||"تعذر الاتصال بقاعدة البيانات");

  async function init(){
    if(!enabled())return {enabled:false};
    client=window.supabase.createClient(config().url,config().anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data:{session}}=await client.auth.getSession();
    if(session)context=await loadAdminContext(session.user);
    else if(localStorage.getItem(TOKEN_KEY)){
      try{context=await resumeCommittee(localStorage.getItem(TOKEN_KEY))}catch{localStorage.removeItem(TOKEN_KEY)}
    }
    return {enabled:true,context};
  }

  async function loadAdminContext(user){
    const {data:profile,error}=await client.from("profiles").select("id,role,display_name").eq("id",user.id).single();
    if(error||profile?.role!=="admin")throw new Error("الحساب موجود لكن ملف صلاحية الإدارة غير مُعدّ");
    return context={kind:"admin",user,profile,committee:null};
  }
  async function signInAdmin(email,password){const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw new Error("بيانات دخول الإدارة غير صحيحة");return loadAdminContext(data.user)}
  async function signInCommittee(code,pin){const {data,error}=await client.rpc("committee_login",{p_login_code:code,p_pin:pin});if(error)throw rpcError(error);localStorage.setItem(TOKEN_KEY,data.token);return context={kind:"committee",token:data.token,committee:data.committee,profile:{role:"committee",display_name:data.committee.name}}}
  async function resumeCommittee(token){const {data,error}=await client.rpc("committee_resume",{p_token:token});if(error)throw rpcError(error);return context={kind:"committee",token,committee:data,profile:{role:"committee",display_name:data.name}}}
  async function refreshCommitteeAccess(force=false){if(context?.kind!=="committee")return null;if(!force&&Date.now()-lastAccessRefresh<15000)return context.committee;const resumed=await resumeCommittee(context.token);lastAccessRefresh=Date.now();return resumed.committee}
  async function signOut(){if(context?.kind==="committee"){await client.rpc("committee_logout",{p_token:context.token});localStorage.removeItem(TOKEN_KEY)}else await client.auth.signOut();context=null}

  async function loadCompetitionState(){if(context?.kind==="committee"){const {data,error}=await client.rpc("committee_load_state",{p_token:context.token});if(error)throw rpcError(error);return {payload:data}}const {data,error}=await client.from("competition_state").select("payload,updated_at").eq("id",1).single();if(error)throw error;return data}
  async function saveCompetitionState(payload){const {error}=await client.from("competition_state").upsert({id:1,payload,updated_at:new Date().toISOString(),updated_by:context.user.id});if(error)throw error}
  function queueStateSave(payload,onError){if(context?.kind!=="admin")return;clearTimeout(saveTimer);const snapshot=JSON.parse(JSON.stringify(payload));saveTimer=setTimeout(()=>saveCompetitionState(snapshot).catch(onError||console.error),450)}

  async function listCommittees(){if(committeeRequest)return committeeRequest;committeeRequest=(async()=>{const {data,error}=await client.from("committees").select("id,name,levels,active,login_code,can_edit_final,created_at").order("created_at");if(error)throw error;return data})();try{return await committeeRequest}finally{committeeRequest=null}}
  async function saveCommittee(values){const {data,error}=await client.rpc("admin_save_committee",{p_id:values.id||null,p_name:values.name,p_login_code:values.code,p_pin:values.pin||"",p_levels:values.levels,p_active:values.active!==false});if(error)throw rpcError(error);return data}
  async function setCommitteeActive(id,active){const {data,error}=await client.from("committees").update({active}).eq("id",id).select().single();if(error)throw error;return data}
  async function setCommitteeFinalEdit(id,enabled){const {data,error}=await client.rpc("admin_set_committee_final_edit",{p_committee_id:id,p_enabled:Boolean(enabled)});if(error)throw rpcError(error);return data}
  async function listFinalEditAudit(){const {data,error}=await client.from("audit_log").select("id,action,entity_type,entity_id,details,created_at").in("action",["grant_final_edit","revoke_final_edit","reopen_final_result","revise_final_result"]).order("created_at",{ascending:false}).limit(100);if(error)throw error;return data}
  async function deleteParticipantSession(participantId){if(context?.kind!=="admin")return;const {error}=await client.rpc("admin_delete_participant_session",{p_participant_id:participantId});if(error)throw rpcError(error)}
  async function listSessions(){if(context?.kind==="committee"){const {data,error}=await client.rpc("committee_list_sessions",{p_token:context.token});if(error)throw rpcError(error);return data}const {data,error}=await client.from("exam_sessions").select("*").order("updated_at",{ascending:false});if(error)throw error;return data}
  async function claimStudent(participantId,drawId,level){const {data,error}=await client.rpc("committee_claim_student",{p_token:context.token,p_participant_id:participantId,p_draw_id:drawId,p_level:Number(level)});if(error)throw rpcError(error);return data}
  async function createCommitteeDraw(participantId,level,parts,draw,changeReason=""){const {data,error}=await client.rpc("committee_create_draw",{p_token:context.token,p_participant_id:participantId,p_level:Number(level),p_parts:parts.map(Number),p_draw:draw,p_change_reason:changeReason||null});if(error)throw rpcError(error);return data}
  async function createAdminDraw(draw){const {data,error}=await client.rpc("admin_create_draw",{p_draw:draw});if(error)throw rpcError(error);return data}
  async function replaceCommitteePosition(participantId,drawId,index,position,assessment){const {data,error}=await client.rpc("committee_replace_position",{p_token:context.token,p_participant_id:participantId,p_draw_id:drawId,p_position_index:Number(index),p_position:position,p_assessment:assessment});if(error)throw rpcError(error);return data}
  async function saveSession(sessionId,assessment,status="in_progress",score=null){if(context?.committee){assessment.committeeName=context.committee.name;assessment.committee={id:context.committee.id,name:context.committee.name}}const {data,error}=await client.rpc("committee_save_session",{p_token:context.token,p_session_id:sessionId,p_assessment:assessment,p_status:status,p_score:score});if(error)throw rpcError(error);return data}
  function queueSessionSave(sessionId,assessment,onError){clearTimeout(sessionSaveTimer);const snapshot=JSON.parse(JSON.stringify(assessment));sessionSaveTimer=setTimeout(()=>saveSession(sessionId,snapshot).catch(onError||console.error),300)}
  async function log(){return}

  return {enabled,init,signInAdmin,signInCommittee,refreshCommitteeAccess,signOut,loadCompetitionState,saveCompetitionState,queueStateSave,listCommittees,saveCommittee,setCommitteeActive,setCommitteeFinalEdit,listFinalEditAudit,deleteParticipantSession,listSessions,claimStudent,createCommitteeDraw,createAdminDraw,replaceCommitteePosition,saveSession,queueSessionSave,log,get context(){return context},get client(){return client}};
})();
