import {createClient} from "npm:@supabase/supabase-js@2";import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"Content-Type":"application/json"}});
async function resetTournament(t:any){
 const detach=await db.from("teams").update({room_id:null,is_ready:false}).eq("tournament_id",t.id);
 if(detach.error)throw new Error("Could not release participant seats: "+detach.error.message);
 const {data:rooms,error:roomReadError}=await db.from("rooms").select("id").eq("tournament_id",t.id);
 if(roomReadError)throw new Error("Could not load rooms: "+roomReadError.message);
 const roomIds=(rooms||[]).map(x=>x.id);
 if(roomIds.length){
  const {data:hands,error:handReadError}=await db.from("hands").select("id").in("room_id",roomIds);
  if(handReadError)throw new Error("Could not load hands: "+handReadError.message);
  const handIds=(hands||[]).map(x=>x.id);
  if(handIds.length){
   const a=await db.from("hand_actions").delete().in("hand_id",handIds);if(a.error)throw new Error(a.error.message);
   const p=await db.from("hand_players").delete().in("hand_id",handIds);if(p.error)throw new Error(p.error.message);
   const h=await db.from("hands").delete().in("id",handIds);if(h.error)throw new Error(h.error.message);
  }
  const rd=await db.from("rooms").delete().in("id",roomIds);if(rd.error)throw new Error(rd.error.message);
 }
 const resetTeams=await db.from("teams").update({room_id:null,chip_stack:t.starting_stack,highest_pot_won:0,is_ready:false,status:"registered"}).eq("tournament_id",t.id).not("team_name","like","DEMO BOT %").neq("status","disqualified").neq("status","left");
 if(resetTeams.error)throw new Error(resetTeams.error.message);
 const botDelete=await db.from("teams").delete().eq("tournament_id",t.id).like("team_name","DEMO BOT %");
 if(botDelete.error)throw new Error(botDelete.error.message);
 const {data:updated,error}=await db.from("tournaments").update({test_mode:false,status:"registration",started_at:null}).eq("id",t.id).select().single();
 if(error)throw new Error(error.message);
 return {tournament:updated};
}
Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});try{
 const token=(req.headers.get("Authorization")||"").replace("Bearer ",""),{data:u,error}=await db.auth.getUser(token);if(error||!u.user)return out({error:"Guest session required"},401);
 const uid=u.user.id,b=await req.json();if(b.action==="admin_login"){const {data:cfg}=await db.from("admin_config").select("value").eq("key","admin_password_sha256").single();const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(b.password||""))))).map(x=>x.toString(16).padStart(2,"0")).join("");if(!cfg||digest!==cfg.value)return out({error:"Incorrect admin password"},401);const {error:pe}=await db.from("profiles").update({role:"admin"}).eq("user_id",uid);if(pe)return out({error:pe.message},500);return out({ok:true,role:"admin"});}
 const {data:profile}=await db.from("profiles").select("role").eq("user_id",uid).single(),admin=profile?.role==="admin";
 const {data:t}=await db.from("tournaments").select("*").order("created_at").limit(1).single();if(!t)return out({error:"Tournament missing"},500);
 if(["allocate","set_status","configure","reset","remove_team","delete_team"].includes(b.action)&&!admin)return out({error:"Admin access required"},403);
 if(b.action==="state"){
  const {data:mine}=await db.from("teams").select("*").eq("owner_user_id",uid).eq("tournament_id",t.id).maybeSingle();
  const {data:all}=await db.from("teams").select("id,team_name,captain_name,room_id,chip_stack,highest_pot_won,status,is_ready").eq("tournament_id",t.id).order("created_at");
  const {data:rooms}=await db.from("rooms").select("*").eq("tournament_id",t.id).order("room_number");
  const rid=b.room_id||mine?.room_id;if(!admin&&rid&&rid!==mine?.room_id)return out({error:"Not your room"},403);
  let hand=null,players=[];
  if(rid){const {data:h}=await db.from("hands").select("id,room_id,hand_number,status,pot_total,current_bet,min_raise,board,dealer_seat,turn_seat,action_deadline,last_action,result").eq("room_id",rid).order("hand_number",{ascending:false}).limit(1).maybeSingle();hand=h;if(h){const {data:ps}=await db.from("hand_players").select("id,team_id,seat_number,stack_current,street_bet,folded,all_in,acted,hole_cards").eq("hand_id",h.id).order("seat_number");players=(ps||[]).map(p=>({...p,hole_cards:(admin||p.team_id===mine?.id||(h.status==="settled"&&!p.folded&&(h.result||[]).some((r:any)=>Array.isArray(r.hand_rank)&&r.hand_rank.length>0)))?p.hole_cards:null,team_name:all?.find(x=>x.id===p.team_id)?.team_name||"Team"}));}}
  const visible=admin?all:(all||[]).filter(x=>!!mine&&(x.id===mine.id||!!mine.room_id&&x.room_id===mine.room_id));
  return out({tournament:t,profile,teams:visible,rooms:admin?rooms:(rooms||[]).filter(r=>r.id===mine?.room_id),my_team:mine,hand,players});
 }
 if(b.action==="leave"){
  const {data:team}=await db.from("teams").select("*").eq("owner_user_id",uid).eq("tournament_id",t.id).maybeSingle();
  if(!team)return out({ok:true,left:false});
  if(team.room_id){
   const {data:active}=await db.from("hands").select("*").eq("room_id",team.room_id).in("status",["preflop","flop","turn","river"]).order("hand_number",{ascending:false}).limit(1).maybeSingle();
   if(active){
    const {data:players}=await db.from("hand_players").select("*").eq("hand_id",active.id).order("seat_number");
    const leaving=(players||[]).find(p=>p.team_id===team.id);
    if(leaving&&!leaving.folded&&!leaving.all_in){
     await db.from("hand_players").update({folded:true,acted:true}).eq("id",leaving.id);
     if(active.turn_seat===leaving.seat_number){
      const eligible=(players||[]).filter(p=>p.team_id!==team.id&&!p.folded&&!p.all_in&&p.stack_current>0);
      const next=eligible.find(p=>p.seat_number>leaving.seat_number)||eligible[0];
      if(next)await db.from("hands").update({turn_seat:next.seat_number,action_deadline:new Date(Date.now()+(t.action_time_seconds||8)*1000).toISOString(),last_action:team.team_name+" left the table — turn passed"}).eq("id",active.id);
     }
    }
   }
  }
  const {error:leaveError}=await db.from("teams").update({room_id:null,is_ready:false,status:"left"}).eq("id",team.id);
  if(leaveError)return out({error:leaveError.message},500);
  return out({ok:true,left:true});
 }
 if(b.action==="delete_team"){
  const teamId=String(b.team_id||"");
  if(!teamId)return out({error:"Participant ID is required"},400);
  const {data:team}=await db.from("teams").select("id,team_name").eq("id",teamId).eq("tournament_id",t.id).maybeSingle();
  if(!team)return out({error:"Participant not found"},404);
  const {error:attemptError}=await db.from("quiz_attempts").delete().eq("team_id",team.id);
  if(attemptError)return out({error:"Could not delete participant's quiz attempt: "+attemptError.message},500);
  const {data:deleted,error:deleteError}=await db.from("teams").delete().eq("id",team.id).select("id").maybeSingle();
  if(deleteError)return out({error:"Could not permanently delete participant: "+deleteError.message},500);
  if(!deleted)return out({error:"Participant deletion could not be confirmed."},500);
  return out({ok:true,deleted:true,team_id:team.id,team_name:team.team_name});
 }
 if(b.action==="remove_team"){
  const teamId=String(b.team_id||"");
  if(!teamId)return out({error:"Participant ID is required"},400);
  const {data:team}=await db.from("teams").select("*").eq("id",teamId).eq("tournament_id",t.id).maybeSingle();
  if(!team)return out({error:"Participant not found"},404);
  if(team.room_id){
   const {data:active}=await db.from("hands").select("*").eq("room_id",team.room_id).in("status",["preflop","flop","turn","river"]).order("hand_number",{ascending:false}).limit(1).maybeSingle();
   if(active){
    const {data:players}=await db.from("hand_players").select("*").eq("hand_id",active.id).order("seat_number");
    const leaving=(players||[]).find(p=>p.team_id===team.id);
    if(leaving&&!leaving.folded&&!leaving.all_in){
     await db.from("hand_players").update({folded:true,acted:true}).eq("id",leaving.id);
     if(active.turn_seat===leaving.seat_number){
      const eligible=(players||[]).filter(p=>p.team_id!==team.id&&!p.folded&&!p.all_in&&p.stack_current>0);
      const next=eligible.find(p=>p.seat_number>leaving.seat_number)||eligible[0];
      if(next)await db.from("hands").update({turn_seat:next.seat_number,action_deadline:new Date(Date.now()+(t.action_time_seconds||8)*1000).toISOString(),last_action:team.team_name+" removed by admin — turn passed"}).eq("id",active.id);
     }
    }
   }
  }
  const {data:removedTeam,error:removeError}=await db.from("teams").update({room_id:null,is_ready:false,status:"disqualified"}).eq("id",team.id).select("id,team_name,status,room_id").single();
  if(removeError)return out({error:removeError.message},500);
  if(!removedTeam||removedTeam.status!=="disqualified"||removedTeam.room_id!==null)return out({error:"Removal could not be confirmed. Please refresh and try again."},500);
  return out({ok:true,removed:true,team_id:removedTeam.id,team_name:removedTeam.team_name,status:removedTeam.status});
 }
 if(b.action==="register"){
  if(t.status!=="registration")return out({error:"Registration closed"},409);
  const n=String(b.team_name||"").trim(),c=String(b.captain_name||"").trim();
  if(n.length<2||n.length>60||c.length<2||c.length>60)return out({error:"Enter valid team and captain names"},400);
  const {data:owned}=await db.from("teams").select("id").eq("owner_user_id",uid).eq("tournament_id",t.id).maybeSingle();
  if(owned)return out({error:"One team per account"},409);
  const {data:existing}=await db.from("teams").select("*").eq("tournament_id",t.id).eq("team_name",n).maybeSingle();
  let team:any=null;
  if(existing){
   if(existing.status!=="left")return out({error:"This team name is already registered or has been removed. Please use your existing participant session or choose a different team name."},409);
   const {data:rejoined,error:rejoinError}=await db.from("teams").update({captain_name:c,owner_user_id:uid,room_id:null,is_ready:false,status:"registered",chip_stack:t.starting_stack,highest_pot_won:0}).eq("id",existing.id).select().single();
   if(rejoinError)return out({error:rejoinError.message},400);
   team=rejoined;
  }else{
   const {data:created,error:createError}=await db.from("teams").insert({tournament_id:t.id,team_name:n,captain_name:c,owner_user_id:uid,chip_stack:t.starting_stack}).select().single();
   if(createError)return out({error:createError.code==="23505"?"This team name is already registered. Please choose another name.":createError.message},createError.code==="23505"?409:400);
   team=created;
  }
  return out({team});
 }
 if(b.action==="allocate"){
 const reset=await resetTournament(t);
 const {data:teams,error:teamError}=await db.from("teams").select("id,team_name").eq("tournament_id",t.id).not("team_name","like","DEMO BOT %").neq("status","disqualified").neq("status","left");
 if(teamError)return out({error:teamError.message},500);
 if(!teams?.length)return out({error:"No active participants registered"},400);
 const cap=Math.max(2,Math.min(6,Number(b.capacity||t.room_capacity||6)));
 const mix=[...teams].sort(()=>Math.random()-.5),num=Math.ceil(mix.length/cap),base=Math.floor(mix.length/num),extra=mix.length%num;
 const {data:rooms,error:roomError}=await db.from("rooms").insert(Array.from({length:num},(_,i)=>({tournament_id:t.id,room_number:i+1}))).select();
 if(roomError)return out({error:roomError.message},500);
 let k=0;
 for(let i=0;i<rooms.length;i++){
  const n=base+(i<extra?1:0);
  for(const x of mix.slice(k,k+n)){const {error}=await db.from("teams").update({room_id:rooms[i].id,status:"registered",chip_stack:t.starting_stack,is_ready:false}).eq("id",x.id);if(error)return out({error:error.message},500);}
  k+=n;
 }
 const {data:updated,error:statusError}=await db.from("tournaments").update({status:"ready",room_capacity:cap,test_mode:false}).eq("id",t.id).select().single();
 if(statusError)return out({error:statusError.message},500);
 return out({ok:true,rooms,team_count:teams.length,tournament:updated});
}
 if(b.action==="configure"){
 const starting_stack=Math.max(100,Math.min(100000,Math.floor(Number(b.starting_stack)||1000)));
 const small_blind=Math.max(1,Math.min(10000,Math.floor(Number(b.small_blind)||10)));
 const big_blind=Math.max(small_blind,Math.min(20000,Math.floor(Number(b.big_blind)||20)));
 const hands_per_room=Math.max(1,Math.min(20,Math.floor(Number(b.hands_per_room)||3)));
 const action_time_seconds=Math.max(5,Math.min(60,Math.floor(Number(b.action_time_seconds)||8)));
 const game_duration_minutes=Math.max(5,Math.min(180,Math.floor(Number(b.game_duration_minutes)||15)));
 const {data:updated,error}=await db.from("tournaments").update({starting_stack,small_blind,big_blind,hands_per_room,action_time_seconds,game_duration_minutes}).eq("id",t.id).select().single();
 if(error)return out({error:error.message},400);
 return out({tournament:updated});
}
if(b.action==="reset"){
 const result=await resetTournament(t);
 return out({ok:true,...result});
}
if(b.action==="set_status"){if(!["registration","ready","live","completed"].includes(b.status))return out({error:"Invalid tournament status"},400);const {data,error}=await db.from("tournaments").update({status:b.status}).eq("id",t.id).select().single();if(error)return out({error:error.message},400);return out({tournament:data});}
 return out({error:"Unknown action"},400);
 }catch(e){return out({error:e instanceof Error?e.message:"Server error"},500);}});