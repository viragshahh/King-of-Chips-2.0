import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {"Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS"};
const out = (data: unknown, status=200) => new Response(JSON.stringify(data), {status, headers:{...cors,"Content-Type":"application/json"}});
const categories = ["High Card","One Pair","Two Pair","Three of a Kind","Straight","Flush","Full House","Four of a Kind","Straight Flush"];
type Card = {r:number;s:string};
type Question = {id:string;hole_cards:Card[];options:{label:string;cards:Card[]}[];correct_option:string;category:string;best_cards:Card[]};

function makeQuestions(): Question[] {
  let seed = 20261118;
  const rand = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  const deck:Card[] = [];
  for(let r=2;r<=14;r++) for(const s of ["♠","♥","♦","♣"]) deck.push({r,s});
  const rankCounts = (cards:Card[]) => {
    const c = new Map<number,number>();
    for(const x of cards)c.set(x.r,(c.get(x.r)||0)+1);
    return [...c.entries()].map(([r,n])=>({r,n})).sort((a,b)=>b.n-a.n||b.r-a.r);
  };
  const eval5 = (cards:Card[]):number[] => {
    const rs=cards.map(c=>c.r).sort((a,b)=>b-a), flush=cards.every(c=>c.s===cards[0].s);
    const uniq=[...new Set(rs)].sort((a,b)=>b-a);
    let straight=0;
    if(uniq.length===5){if(uniq[0]-uniq[4]===4)straight=uniq[0];else if(uniq.join(",")==="14,5,4,3,2")straight=5;}
    const g=rankCounts(cards);
    if(flush&&straight)return [8,straight];
    if(g[0].n===4)return [7,g[0].r,g[1].r];
    if(g[0].n===3&&g[1].n===2)return [6,g[0].r,g[1].r];
    if(flush)return [5,...rs];
    if(straight)return [4,straight];
    if(g[0].n===3)return [3,g[0].r,...g.slice(1).map(x=>x.r).sort((a,b)=>b-a)];
    if(g[0].n===2&&g[1].n===2)return [2,...g.slice(0,2).map(x=>x.r).sort((a,b)=>b-a),g[2].r];
    if(g[0].n===2)return [1,g[0].r,...g.slice(1).map(x=>x.r).sort((a,b)=>b-a)];
    return [0,...rs];
  };
  const cmp=(a:number[],b:number[])=>{for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d;}return 0;};
  const best7=(cards:Card[])=>{
    let best:number[]=[];let bestCards:Card[]=[];
    for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)for(let c=b+1;c<7;c++)for(let d=c+1;d<7;d++)for(let e=d+1;e<7;e++){
      const five=[cards[a],cards[b],cards[c],cards[d],cards[e]], score=eval5(five);
      if(!best.length||cmp(score,best)>0){best=score;bestCards=five;}
    }
    return {score:best,cards:bestCards};
  };
  const shuffle=(a:Card[])=>{const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;};
  const result:Question[]=[];let attempts=0;
  while(result.length<20&&attempts<100000){
    attempts++;
    const p=shuffle(deck),hole=p.slice(0,2);
    const opts=[0,1,2,3].map(i=>p.slice(2+i*5,7+i*5));
    const evaluated=opts.map(o=>best7([...hole,...o]));
    let best=0;for(let i=1;i<4;i++)if(cmp(evaluated[i].score,evaluated[best].score)>0)best=i;
    if(evaluated.filter(x=>cmp(x.score,evaluated[best].score)===0).length!==1)continue;
    result.push({id:"q"+(result.length+1),hole_cards:hole,options:opts.map((cards,i)=>({label:"ABCD"[i],cards})),correct_option:"ABCD"[best],category:categories[evaluated[best].score[0]],best_cards:evaluated[best].cards});
  }
  if(result.length!==20)throw new Error("Could not prepare the full quiz question set.");
  return result;
}
const questions=makeQuestions();
const publicQuestions=questions.map(({id,hole_cards,options})=>({id,hole_cards,options}));

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const token=(req.headers.get("Authorization")||"").replace("Bearer ","");
    const {data:claimsData,error:userError}=await db.auth.getClaims(token);
    const uid=claimsData?.claims?.sub as string | undefined;
    if(userError||!uid)return out({error:"A participant session is required."},401);
    const b=await req.json();
    const [{data:t,error:te},{data:profile}]=await Promise.all([
      db.from("tournaments").select("*").order("created_at",{ascending:true}).limit(1).maybeSingle(),
      db.from("profiles").select("role").eq("user_id",uid).maybeSingle()
    ]);
    if(te||!t)return out({error:"Tournament configuration was not found."},500);
    const isAdmin=profile?.role==="admin";
    const [{data:team},{data:initialSettings}]=await Promise.all([
      db.from("teams").select("id,team_name,captain_name,status,owner_user_id").eq("owner_user_id",uid).eq("tournament_id",t.id).maybeSingle(),
      db.from("quiz_settings").select("*").eq("tournament_id",t.id).maybeSingle()
    ]);
    let settings=initialSettings;
    if(!settings){
      const {data:created,error:ce}=await db.from("quiz_settings").insert({tournament_id:t.id,status:"draft",question_seconds:20,question_count:20,phase:"waiting",current_index:0}).select().single();
      if(ce)return out({error:ce.message},500);settings=created;
    }
    const requireAdmin=()=>{if(!isAdmin)throw new Error("Admin access required.");};
    const getAttempts=async()=>{
      const {data,error}=await db.from("quiz_attempts").select("id,team_id,user_id,status,score,correct_count,total_time_ms,started_at,completed_at,answers,last_submitted_index").eq("tournament_id",t.id);
      if(error)throw error;return data||[];
    };
    const leaderboard=async()=>{
      const {data,error}=await db.from("quiz_attempts").select("id,team_id,status,score,correct_count,total_time_ms,started_at,completed_at,teams(team_name,captain_name)").eq("tournament_id",t.id).order("correct_count",{ascending:false}).order("score",{ascending:false}).order("total_time_ms",{ascending:true});
      if(error)throw error;
      return (data||[]).map((x:any,i:number)=>({rank:i+1,team_id:x.team_id,team_name:x.teams?.team_name||"Participant",captain_name:x.teams?.captain_name||"",status:x.status,score:x.score,correct_count:x.correct_count,total_time_ms:x.total_time_ms,completed_at:x.completed_at}));
    };
    const reconcile=async()=>{
      const {data:current,error:settingsError}=await db.from("quiz_settings").select("*").eq("tournament_id",t.id).single();
      if(settingsError)throw settingsError;
      settings=current; 
      if(settings.status!=="live")return;
      const idx=Number(settings.current_index||0),now=Date.now(),seconds=Number(settings.question_seconds||20);
      if(settings.phase==="question"){
        let attempts=await getAttempts();
        const deadline=settings.question_started_at?new Date(settings.question_started_at).getTime()+seconds*1000:now;
        const expired=now>=deadline;
        if(expired){
          for(const a of attempts){
            if(a.status==="completed"||Number(a.last_submitted_index)>=idx)continue;
            const elapsed=seconds*1000;
            const entry={question_id:questions[idx].id,selected_option:null,correct:false,correct_option:questions[idx].correct_option,category:questions[idx].category,response_ms:elapsed};
            const {error}=await db.from("quiz_attempts").update({answers:[...(a.answers||[]),entry],last_submitted_index:idx,current_index:idx+1,total_time_ms:Number(a.total_time_ms||0)+elapsed}).eq("id",a.id).eq("last_submitted_index",Number(a.last_submitted_index));
            if(error)throw error;
          }
          attempts=await getAttempts();
        }
        const submitted=attempts.filter((a:any)=>Number(a.last_submitted_index)>=idx).length;
        if(expired|| (attempts.length>0&&submitted>=attempts.length)){
          const stamp=new Date().toISOString();
          await db.from("quiz_settings").update({phase:"leaderboard",phase_started_at:stamp,updated_at:stamp}).eq("tournament_id",t.id).eq("status","live").eq("phase","question").eq("current_index",idx);
        }
      } else if(settings.phase==="leaderboard"){
        const phaseAt=settings.phase_started_at?new Date(settings.phase_started_at).getTime():now;
        if(now-phaseAt>=5000){
          const stamp=new Date().toISOString();
          if(idx>=19){
            await db.from("quiz_settings").update({status:"completed",phase:"complete",updated_at:stamp}).eq("tournament_id",t.id).eq("status","live").eq("phase","leaderboard").eq("current_index",idx);
            await db.from("quiz_attempts").update({status:"completed",completed_at:stamp}).eq("tournament_id",t.id).eq("status","in_progress");
            await db.from("tournaments").update({status:"completed"}).eq("id",t.id);
          }else{
            await db.from("quiz_settings").update({phase:"question",current_index:idx+1,question_started_at:stamp,phase_started_at:stamp,updated_at:stamp}).eq("tournament_id",t.id).eq("status","live").eq("phase","leaderboard").eq("current_index",idx);
          }
        }
      }
      const {data:latest,error:latestError}=await db.from("quiz_settings").select("*").eq("tournament_id",t.id).single();
      if(latestError)throw latestError;settings=latest;
    };
    if(b.action==="state"){
      // The organiser tab is the single round coordinator. Participants only read state,
      // avoiding N simultaneous timeout/phase-transition sweeps at the same deadline.
      if(isAdmin) await reconcile();
      const idx=Number(settings.current_index||0);
      let attempts:any[]=[];
      let submitted=0,totalParticipants=0;
      const [attemptResult,progressResult] = await Promise.all([
        team?db.from("quiz_attempts").select("*").eq("tournament_id",t.id).eq("team_id",team.id).maybeSingle():Promise.resolve({data:null,error:null}),
        isAdmin?Promise.resolve({data:null,error:null}):db.from("quiz_attempts").select("id,last_submitted_index").eq("tournament_id",t.id)
      ]);
      if(attemptResult.error)throw attemptResult.error;
      const attempt=attemptResult.data;
      if(isAdmin){
        attempts=await getAttempts();
        submitted=attempts.filter((a:any)=>Number(a.last_submitted_index)>=idx).length;
        totalParticipants=attempts.length;
      }else{
        if(progressResult.error)throw progressResult.error;
        const progress=progressResult.data||[];
        totalParticipants=progress.length;
        submitted=progress.filter((a:any)=>Number(a.last_submitted_index)>=idx).length;
      }
      const seconds=Number(settings.question_seconds||20);
      const remaining=settings.phase==="question"&&settings.question_started_at?Math.max(0,Math.ceil((new Date(settings.question_started_at).getTime()+seconds*1000-Date.now())/1000)):0;
      const showBoard=isAdmin||settings.phase==="leaderboard"||settings.status==="completed";
      const board=showBoard?await leaderboard():[];
      const participants=isAdmin?(await db.from("teams").select("id,team_name,captain_name,status,created_at").eq("tournament_id",t.id).order("created_at")).data||[]:[];
      const participantProgress=isAdmin?participants.map((p:any)=>{const a=attempts.find((x:any)=>x.team_id===p.id);return {...p,has_submitted:!!a&&Number(a.last_submitted_index)>=idx,attempt_status:a?.status||"not_started"};}):[];
      const answer=attempt?.answers?.[idx]||null;
      const lastRoundResult=attempt&&Number(attempt.last_submitted_index)>=idx&&answer?{
        question_index:idx,selected_option:answer.selected_option,correct:!!answer.correct,correct_option:answer.correct_option,
        category:answer.category,points_earned:answer.correct?100+Math.max(0,Math.ceil((seconds*1000-Number(answer.response_ms||0))/1000)):0,
        speed_bonus:answer.correct?Math.max(0,Math.ceil((seconds*1000-Number(answer.response_ms||0))/1000)):0,
        timed_out:!answer.selected_option,best_cards:questions[idx]?.best_cards||[]
      }:null;
      return out({tournament:{id:t.id,status:t.status,name:t.name},settings,team,is_admin:isAdmin,attempt,questions:publicQuestions,admin_questions:isAdmin?questions:undefined,leaderboard:board,participants:participantProgress,last_round_result:lastRoundResult,round:{phase:settings.phase,current_index:idx,submitted_count:submitted,total_participants:totalParticipants,seconds_remaining:remaining,leaderboard_seconds_remaining:settings.phase==="leaderboard"&&settings.phase_started_at?Math.max(0,5-Math.floor((Date.now()-new Date(settings.phase_started_at).getTime())/1000)):0}});
    }
    if(b.action==="admin_delete_participant"){
      requireAdmin();
      if(settings.status!=="draft")return out({error:"Individual participant deletion is available only while registration is open. Use the full reset to clear the event and reopen registration."},409);
      const teamId=String(b.team_id||"");
      if(!teamId)return out({error:"Participant ID is required."},400);
      const {data:target}=await db.from("teams").select("id,team_name").eq("id",teamId).eq("tournament_id",t.id).maybeSingle();
      if(!target)return out({error:"Participant not found."},404);
      const {error:attemptDeleteError}=await db.from("quiz_attempts").delete().eq("team_id",teamId);
      if(attemptDeleteError)return out({error:attemptDeleteError.message},500);
      const {data:deleted,error:teamDeleteError}=await db.from("teams").delete().eq("id",teamId).select("id").maybeSingle();
      if(teamDeleteError)return out({error:teamDeleteError.message},500);
      if(!deleted)return out({error:"Participant deletion could not be confirmed."},500);
      return out({ok:true,deleted:true,team_id:teamId,team_name:target.team_name});
    }
    if(b.action==="admin_start"){
      requireAdmin();
      if(settings.status==="live")return out({error:"The quiz is already live."},409);
      const {count,error:countError}=await db.from("teams").select("id",{count:"exact",head:true}).eq("tournament_id",t.id).not("status","in",'("left","disqualified")');
      if(countError)return out({error:countError.message},500);
      if(!count)return out({error:"Register at least one participant before starting."},409);
      const {data:teams,error:teamsError}=await db.from("teams").select("id,owner_user_id").eq("tournament_id",t.id).not("status","in",'("left","disqualified")');
      if(teamsError)return out({error:teamsError.message},500);
      const now=new Date().toISOString();
      const rows=(teams||[]).map((x:any)=>({tournament_id:t.id,team_id:x.id,user_id:x.owner_user_id,status:"in_progress",started_at:now,question_started_at:now,current_index:0,score:0,correct_count:0,total_time_ms:0,answers:[],last_submitted_index:-1}));
      const {error:insertError}=await db.from("quiz_attempts").insert(rows);
      if(insertError)return out({error:insertError.code==="23505"?"Existing attempts found. Reset the quiz before starting again.":insertError.message},409);
      const {data:updated,error}=await db.from("quiz_settings").update({status:"live",started_at:now,question_started_at:now,phase_started_at:now,phase:"question",current_index:0,question_seconds:20,question_count:20,updated_at:now}).eq("tournament_id",t.id).select().single();
      if(error)return out({error:error.message},500);
      await db.from("tournaments").update({status:"ready"}).eq("id",t.id);
      return out({ok:true,settings:updated,participants:rows.length});
    }
    if(b.action==="admin_reset"){
      requireAdmin();
      const {error:attemptDeleteError}=await db.from("quiz_attempts").delete().eq("tournament_id",t.id);
      if(attemptDeleteError)return out({error:"Could not clear quiz attempts: "+attemptDeleteError.message},500);
      const {error:roomDeleteError}=await db.from("rooms").delete().eq("tournament_id",t.id);
      if(roomDeleteError)return out({error:"Could not clear old game rooms: "+roomDeleteError.message},500);
      const {error:teamDeleteError}=await db.from("teams").delete().eq("tournament_id",t.id);
      if(teamDeleteError)return out({error:"Could not permanently delete participant registrations: "+teamDeleteError.message},500);
      const {data:updated,error}=await db.from("quiz_settings").update({status:"draft",started_at:null,question_seconds:20,question_count:20,current_index:0,phase:"waiting",question_started_at:null,phase_started_at:null,updated_at:new Date().toISOString()}).eq("tournament_id",t.id).select().single();
      if(error)return out({error:error.message},500);
      const {error:tournamentError}=await db.from("tournaments").update({status:"registration"}).eq("id",t.id);
      if(tournamentError)return out({error:tournamentError.message},500);
      return out({ok:true,settings:updated,deleted_participant_registrations:true});
    }
    if(b.action==="admin_finish"){
      requireAdmin();
      const stamp=new Date().toISOString();
      const {data:updated,error}=await db.from("quiz_settings").update({status:"completed",phase:"complete",updated_at:stamp}).eq("tournament_id",t.id).select().single();
      if(error)return out({error:error.message},500);
      const {error:finishAttemptsError}=await db.from("quiz_attempts").update({status:"completed",completed_at:stamp}).eq("tournament_id",t.id).eq("status","in_progress");
      if(finishAttemptsError)return out({error:finishAttemptsError.message},500);
      await db.from("tournaments").update({status:"completed"}).eq("id",t.id);
      return out({ok:true,settings:updated});
    }
    if(b.action==="answer"){
      await reconcile();
      if(settings.status!=="live"||settings.phase!=="question")return out({error:"This question is closed. Wait for the next question."},409);
      if(!team)return out({error:"Participant registration was not found."},403);
      const index=Number(settings.current_index),seconds=Number(settings.question_seconds||20);
      if(Number(b.question_index)!==index)return out({error:"This is not the active question."},409);
      const elapsed=Math.max(0,Date.now()-new Date(settings.question_started_at).getTime());
      if(elapsed>=seconds*1000)return out({error:"Time is up. Your answer is locked."},409);
      const {data:attempt,error:ae}=await db.from("quiz_attempts").select("*").eq("tournament_id",t.id).eq("team_id",team.id).maybeSingle();
      if(ae||!attempt)return out({error:"Your quiz attempt was not prepared. Contact the organiser."},404);
      if(attempt.status!=="in_progress")return out({error:"This quiz attempt is already complete."},409);
      if(Number(attempt.last_submitted_index)>=index)return out({error:"Your answer for this question is already locked."},409);
      const selected=b.selected_option==null?null:String(b.selected_option).toUpperCase();
      if(!selected||!["A","B","C","D"].includes(selected))return out({error:"Select one of the four options."},400);
      const q=questions[index],correct=selected===q.correct_option;
      const speedBonus=correct?Math.max(0,Math.ceil((seconds*1000-elapsed)/1000)):0;
      const pointsEarned=correct?100+speedBonus:0;
      const entry={question_id:q.id,selected_option:selected,correct,correct_option:q.correct_option,category:q.category,response_ms:Math.min(elapsed,seconds*1000)};
      const answers=[...(attempt.answers||[]),entry];
      const {data:updated,error:upError}=await db.from("quiz_attempts").update({answers,last_submitted_index:index,current_index:index+1,score:Number(attempt.score)+pointsEarned,correct_count:Number(attempt.correct_count)+(correct?1:0),total_time_ms:Number(attempt.total_time_ms)+Math.min(elapsed,seconds*1000)}).eq("id",attempt.id).eq("last_submitted_index",index-1).select().maybeSingle();
      if(upError)return out({error:upError.message},500);
      if(!updated)return out({error:"Your answer is already locked. Please wait."},409);
      const correctQuips=["CERTIFIED JUWARI!","TABLE KA ASLI SIKANDAR!","DEALER BHI SALUTE MAARE!","CHIPS KI BAARISH, BOSS!","AAJ TOH KISMAT ALL-IN HAI!","POKER FACE, PERFECT ACE!","CASINO KO GHAR BEJH DIYA!","YEH HAATH NAHI, MASTERCLASS THI!","FULL HOUSE OF TALENT!","BOSS LEVEL JUWARI!","BAAP RE BAAP, KYA HAND HAI!","SEAT BELT BAANDH, SHARK AAYA!"];
      const wrongQuips=["DOOB GAYE SAARE PAISE!","YEH HAATH NAHI, HEARTBREAK THA!","DEALER NE AANKHON MEIN DHOOL JHOK DI!","CHIPS GAYE TEL LENE!","BLUFF BHI NAHI CHALA!","POKER FACE THA, PAR ANSWER WRONG!","TABLE NE AAPKO FOLD KAR DIYA!","KISMAT NE BHI DISCONNECT KAR DIYA!","ALL-IN GAYE, ALL-OUT AAYE!","AAJ CARDS AAPKE SAATH NAHI HAIN!","YEH MOVE DEKH KE DEALER BHI RO DIYA!","JEB GARMAI NAHI, KHALI HO GAYI!"];
      const quips=correct?correctQuips:wrongQuips;
      return out({accepted:true,locked:true,selected_option:selected,correct,correct_option:q.correct_option,category:q.category,best_cards:q.best_cards,points_earned:pointsEarned,speed_bonus:speedBonus,quip:quips[Math.floor(Math.random()*quips.length)],attempt:{score:updated.score,correct_count:updated.correct_count,last_submitted_index:updated.last_submitted_index}});
    }
    return out({error:"Unknown quiz action."},400);
  }catch(e){return out({error:e instanceof Error?e.message:"Unexpected server error."},500);}
});