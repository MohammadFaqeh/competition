"use strict";

window.CloudCompetition=(()=>{
  let client=null,context=null,saveTimer=null,sessionSaveTimer=null;
  const config=()=>window.SUPABASE_CONFIG||{};
  const enabled=()=>Boolean(config().url&&config().anonKey&&window.supabase?.createClient);

  async function init(){
    if(!enabled())return {enabled:false};
    client=window.supabase.createClient(config().url,config().anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data:{session}}=await client.auth.getSession();
    if(session)context=await loadContext(session.user);
    return {enabled:true,context};
  }

  async function loadContext(user){
    const {data:profile,error}=await client.from("profiles").select("id,role,display_name").eq("id",user.id).single();
    if(error)throw new Error("الحساب موجود لكن ملف الصلاحيات غير مُعدّ");
    let committee=null;
    if(profile.role==="committee"){
      const result=await client.from("committees").select("id,name,levels,active").eq("auth_user_id",user.id).single();
      if(result.error||!result.data?.active)throw new Error("حساب اللجنة غير فعال");
      committee=result.data;
    }
    return context={user,profile,committee};
  }

  async function signIn(email,password){
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error)throw new Error("بيانات الدخول غير صحيحة");
    return loadContext(data.user);
  }

  async function signOut(){await client.auth.signOut();context=null}

  async function loadCompetitionState(){
    const {data,error}=await client.from("competition_state").select("payload,updated_at").eq("id",1).single();
    if(error)throw error;return data;
  }

  async function saveCompetitionState(payload){
    const {error}=await client.from("competition_state").upsert({id:1,payload,updated_at:new Date().toISOString(),updated_by:context.user.id});
    if(error)throw error;
  }

  function queueStateSave(payload,onError){
    if(context?.profile.role!=="admin")return;
    clearTimeout(saveTimer);const snapshot=JSON.parse(JSON.stringify(payload));
    saveTimer=setTimeout(()=>saveCompetitionState(snapshot).catch(onError||console.error),450);
  }

  async function listCommittees(){const {data,error}=await client.from("committees").select("id,name,levels,active,auth_user_id,created_at").order("created_at");if(error)throw error;return data}
  async function linkCommitteeAccount(userId,name,levels){const {data,error}=await client.rpc("link_committee_account",{p_user_id:userId,p_name:name,p_levels:levels});if(error)throw new Error(error.message);return data}
  async function setCommitteeActive(id,active){const {data,error}=await client.from("committees").update({active}).eq("id",id).select().single();if(error)throw error;return data}
  async function listSessions(){const {data,error}=await client.from("exam_sessions").select("*").order("updated_at",{ascending:false});if(error)throw error;return data}
  async function claimStudent(participantId,drawId,level){const {data,error}=await client.rpc("claim_student",{p_participant_id:participantId,p_draw_id:drawId,p_level:Number(level)});if(error)throw new Error(error.message);return data}
  async function saveSession(sessionId,assessment,status="in_progress",score=null){const values={assessment,status,score,updated_at:new Date().toISOString()};if(status==="final")values.finalized_at=new Date().toISOString();const {data,error}=await client.from("exam_sessions").update(values).eq("id",sessionId).select().single();if(error)throw error;return data}
  function queueSessionSave(sessionId,assessment,onError){clearTimeout(sessionSaveTimer);const snapshot=JSON.parse(JSON.stringify(assessment));sessionSaveTimer=setTimeout(()=>saveSession(sessionId,snapshot).catch(onError||console.error),300)}
  async function log(action,entityType,entityId,details={}){if(!context)return;await client.from("audit_log").insert({actor_id:context.user.id,action,entity_type:entityType,entity_id:String(entityId),details})}

  return {enabled,init,signIn,signOut,loadCompetitionState,saveCompetitionState,queueStateSave,listCommittees,linkCommitteeAccount,setCommitteeActive,listSessions,claimStudent,saveSession,queueSessionSave,log,get context(){return context},get client(){return client}};
})();
