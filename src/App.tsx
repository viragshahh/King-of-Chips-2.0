import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { Spade, Trophy, Shield, Users, Clock3, Crown, Sparkles, RotateCcw, CheckCircle2, AlertTriangle, ArrowRight, Zap, Timer, Medal } from "lucide-react";
import "./style.css";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = URL && KEY ? createClient(URL, KEY) : null;

type CardData = { r: number; s: string };
type OptionData = { label: string; cards: CardData[] };
type Question = { id: string; hole_cards: CardData[]; options: OptionData[] };
type QuizData = {
  tournament: any;
  settings: any;
  team: any;
  is_admin: boolean;
  attempt: any;
  questions: Question[];
  admin_questions?: (Question & { correct_option: string; category: string; best_cards: CardData[] })[];
  leaderboard: any[];
  participants: any[];
  last_round_result?: any;
  round?: { phase: string; current_index: number; submitted_count: number; total_participants: number; seconds_remaining: number; leaderboard_seconds_remaining: number };
};

const rank = (r: number) => ({ 14: "A", 13: "K", 12: "Q", 11: "J" } as Record<number, string>)[r] || String(r);
const redSuit = (s: string) => s === "♥" || s === "♦";

function PlayingCard({ card, size = "normal", delay = 0 }: { card: CardData; size?: "normal" | "large" | "tiny"; delay?: number }) {
  return <div className={"playing-card " + size + (redSuit(card.s) ? " red" : "")} style={{ animationDelay: delay + "ms" }}>
    <b>{rank(card.r)}</b><strong>{card.s}</strong><small>{card.s}</small>
  </div>;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [teamName, setTeamName] = useState("");
  const [captainName, setCaptainName] = useState("");
  const [password, setPassword] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(20);
  const [result, setResult] = useState<any>(null);
  const submitLock = useRef(false);
  const submitRef = useRef<((option: string | null) => void) | null>(null);
  const shownResultRef = useRef<number | null>(null);

  const api = useCallback(async (fn: string, body: any) => {
    if (!supabase) throw new Error("The website is missing its Supabase configuration.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Your participant session is not ready. Please refresh.");
    const response = await fetch(URL + "/functions/v1/" + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": KEY!, "Authorization": "Bearer " + data.session.access_token },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
    return payload;
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api("koc-quiz", { action: "state" });
      setQuiz(data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, api]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      let s = data.session;
      if (!s) {
        const { data: guest, error: guestError } = await supabase.auth.signInAnonymously();
        if (guestError) {
          const rateLimited = guestError.status === 429 || guestError.code === "over_request_rate_limit" || /rate limit|too many requests/i.test(guestError.message || "");
          if (alive) setError(guestError.code === "anonymous_provider_disabled"
            ? "Anonymous sign-ins are disabled. Enable Anonymous Sign-Ins in Supabase Authentication, then reload."
            : rateLimited
              ? "Registration is temporarily busy. Please wait a minute and refresh. The organiser should raise Supabase Authentication > Rate Limits > Anonymous Sign-Ins to at least 200 per hour per IP for this event."
              : "Could not create a participant session: " + guestError.message);
          if (alive) setLoading(false);
          return;
        }
        s = guest.session;
      }
      if (alive) setSession(s);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setQuiz(null);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(load, 2000);
    return () => window.clearInterval(id);
  }, [session, load]);

  const attempt = quiz?.attempt;
  const questionIndex = Number(quiz?.settings?.current_index ?? 0);
  const roundPhase = quiz?.settings?.phase || "waiting";
  const isAdmin = !!quiz?.is_admin;
  const isRegistered = !!quiz?.team;
  const quizStatus = quiz?.settings?.status || "draft";
  const question = quizStatus === "live" && roundPhase === "question" ? quiz?.questions?.[questionIndex] : null;
  const answerLocked = !!attempt && Number(attempt.last_submitted_index ?? -1) >= questionIndex;
  const mySelectedOption = selected || (answerLocked ? (attempt?.answers?.[questionIndex]?.selected_option || "") : "");

  const register = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await api("koc-api", { action: "register", team_name: teamName.trim(), captain_name: captainName.trim() });
      setNotice("Registration successful. You're on the list.");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const adminLogin = async () => {
    setBusy(true); setError("");
    try {
      await api("koc-api", { action: "admin_login", password });
      setPassword(""); setAdminMode(false);
      setNotice("Organiser access granted.");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const adminAction = async (action: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await api("koc-quiz", { action });
      setNotice(action === "admin_start" ? "The quiz is live. Good luck to all players!" : action === "admin_reset" ? "Full reset complete. All participant registrations and quiz attempts have been permanently deleted. Everyone must register again." : "Quiz has been closed.");
      setResult(null); setSelected("");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const deleteParticipant = async (participant: any) => {
    if (!window.confirm("Permanently delete " + participant.team_name + "? Their registration and quiz attempt will be deleted. They must register again to participate.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api("koc-quiz", { action: "admin_delete_participant", team_id: participant.id });
      setNotice(participant.team_name + " has been permanently deleted. They must register again.");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const startQuiz = async () => {
    setBusy(true); setError("");
    try {
      await api("koc-quiz", { action: "start" });
      setSelected(""); setResult(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const submitAnswer = useCallback(async (option: string) => {
    if (submitLock.current || !attempt || answerLocked || roundPhase !== "question") return;
    submitLock.current = true;
    setSelected(option);
    try {
      const response = await api("koc-quiz", { action: "answer", question_index: questionIndex, selected_option: option });
      shownResultRef.current = questionIndex;
      setResult({ ...response, question_index: questionIndex });
      await load();
    } catch (e) {
      const message = (e as Error).message;
      if (message.toLowerCase().includes("already locked") || message.toLowerCase().includes("closed") || message.toLowerCase().includes("time is up")) {
        await load();
      } else {
        setError(message);
        setSelected("");
      }
      submitLock.current = false;
    }
  }, [attempt, answerLocked, roundPhase, questionIndex, api, load]);
  submitRef.current = (option) => { if (option) void submitAnswer(option); };

  useEffect(() => {
    submitLock.current = false;
    setSelected("");
    setResult(null);
    shownResultRef.current = null;
  }, [questionIndex]);

  useEffect(() => {
    const roundResult = quiz?.last_round_result;
    if (!roundResult || Number(roundResult.question_index) !== questionIndex) return;
    if (shownResultRef.current === questionIndex) return;
    const timeoutQuips = ["TIME OUT, JUWARI! GHADI JEET GAYI!","SOCHTE REH GAYE, BLINDS NIKAL GAYE!","20 SECOND THE, NOVEL NAHI LIKHNA THA!","CLOCK NE AAPKO FOLD KAR DIYA!"];
    const quip = roundResult.timed_out ? timeoutQuips[Math.floor(Math.random()*timeoutQuips.length)] : (roundResult.correct ? "CERTIFIED JUWARI!" : "DOOB GAYE SAARE PAISE!");
    setResult({ ...roundResult, quip });
    shownResultRef.current = questionIndex;
  }, [quiz?.last_round_result, questionIndex]);

  useEffect(() => {
    if (quizStatus !== "live" || roundPhase !== "question" || !quiz?.settings?.question_started_at) return;
    const tick = () => {
      const started = new Date(quiz.settings.question_started_at).getTime();
      const duration = Number(quiz.settings.question_seconds || 20);
      setSecondsLeft(Math.max(0, Math.ceil((started + duration * 1000 - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [quizStatus, roundPhase, quiz?.settings?.question_started_at, quiz?.settings?.question_seconds]);

  const sortedBoard = useMemo(() => quiz?.leaderboard || [], [quiz?.leaderboard]);
  const completed = quizStatus === "completed" || attempt?.status === "completed";
  const totalScore = attempt?.score || 0;
  const answeredCount = attempt?.answers?.length || 0;
  const registrationOpen = quiz?.tournament?.status === "registration";
  const projectorMode = new URLSearchParams(window.location.search).get("projector") === "1";
  const projectorQuestion = quizStatus === "live" && roundPhase === "question" ? quiz?.questions?.[questionIndex] : null;
  const registrationUrl = window.location.origin;
  const registrationQrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=" + encodeURIComponent(registrationUrl);

  if (!URL || !KEY) return <div className="setup-screen"><h1>KING OF CHIPS 2.0</h1><p>Website configuration is incomplete. Supabase URL and publishable key are required.</p></div>;

  return <div className="site-shell">
    <header className="site-header">
      <div className="brand-lockup"><div className="brand-icon"><Spade size={25}/></div><div><b>KING OF <i>CHIPS</i></b><small>FINCEPTION · THE FINANCE CLUB</small></div></div>
      <div className="header-right"><span className="live-tag"><span/> {isAdmin ? "ORGANISER" : "TEXAS HOLD'EM QUIZ"}</span><div className="header-chip">♠ <b>20</b> QUESTIONS</div></div>
    </header>

    <main className="main-wrap">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span>♠</span> FINCEPTION PRESENTS</div>
          <h1>READ THE HAND.<br/><em>OWN THE TABLE.</em></h1>
          <p>20 poker challenges. 20 seconds each. One shot at the crown.</p>
          <div className="hero-pills"><span><Timer size={14}/> 20 SEC / QUESTION</span><span><Trophy size={14}/> LIVE LEADERBOARD</span><span><Zap size={14}/> 100 + SPEED BONUS</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="halo halo-one"/><div className="halo halo-two"/>
          <div className="hero-card hero-card-one"><b>A</b><strong>♠</strong></div>
          <div className="hero-card hero-card-two"><b>K</b><strong>♥</strong></div>
          <div className="hero-chip chip-one">♠</div><div className="hero-chip chip-two">♦</div><div className="hero-chip chip-three">♣</div>
          <div className="hero-wordmark">ALL IN</div>
        </div>
      </section>

      {error && <div className="notice error"><AlertTriangle size={17}/><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
      {notice && <div className="notice success"><CheckCircle2 size={17}/><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}

      {!session || loading ? <section className="glass-card loading-card"><div className="loading-spinner"/><h2>SHUFFLING THE DECK</h2><p>Preparing your table…</p></section> :
      projectorMode ? <ProjectorView quiz={quiz} quizStatus={quizStatus} roundPhase={roundPhase} questionIndex={questionIndex} question={projectorQuestion} secondsLeft={secondsLeft} leaderboard={sortedBoard}/> : !isRegistered && !isAdmin ? <section className="entry-grid">
        <div className="glass-card entry-card">
          <div className="section-kicker">PLAYER REGISTRATION</div><h2>TAKE YOUR SEAT.</h2>
          <p>Enter your team and captain details to join King of Chips 2.0.</p>
          {registrationOpen ? <>
            <label>TEAM NAME<input value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="Your team name"/></label>
            <label>CAPTAIN / PLAYER NAME<input value={captainName} onChange={e => setCaptainName(e.target.value)} placeholder="Your name"/></label>
            <button className="gold-button wide" disabled={busy || teamName.trim().length < 2 || captainName.trim().length < 2} onClick={register}>REGISTER & JOIN <ArrowRight size={16}/></button>
          </> : <div className="waiting-box"><Clock3/><b>REGISTRATION CLOSED</b><span>The organiser has started the quiz. Please contact the event team.</span></div>}
          <div className="entry-foot">No email or password required. Your browser session keeps your entry connected.</div>
        </div>
        <div className="glass-card entry-card admin-entry">
          <div className="section-kicker">EVENT ORGANISER</div><h2>ADMIN ACCESS.</h2>
          <p>Manage the quiz, start the round and monitor the leaderboard.</p>
          {!adminMode ? <button className="outline-button wide" onClick={() => setAdminMode(true)}><Shield size={16}/> ORGANISER LOGIN</button> : <>
            <label>ADMIN PASSWORD<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter organiser password"/></label>
            <button className="gold-button wide" disabled={busy || !password} onClick={adminLogin}>UNLOCK CONTROL ROOM <ArrowRight size={16}/></button>
            <button className="subtle-button" onClick={() => { setAdminMode(false); setPassword(""); }}>Cancel</button>
          </>}
          <div className="entry-foot">Organiser access is protected by the existing admin password.</div>
        </div>
      </section> :
      isAdmin ? <section className="admin-layout">
        <div className="glass-card admin-main">
          <div className="admin-title-row"><div><div className="section-kicker">CONTROL ROOM</div><h2>QUIZ OPERATIONS</h2></div><div className={"status-pill " + quizStatus}>{quizStatus.toUpperCase()}</div></div>
          <div className="admin-stats">
            <div><small>REGISTERED</small><b>{quiz?.participants?.filter((p:any) => !["left","disqualified"].includes(p.status)).length || 0}</b></div>
            <div><small>ATTEMPTS</small><b>{quiz?.leaderboard?.length || 0}</b></div>
            <div><small>QUESTIONS</small><b>20</b></div>
            <div><small>TIME / Q</small><b>20s</b></div>
          </div>
          <div className="admin-controls">
            <a className="outline-button wide projector-open-link" href={window.location.origin + "/?projector=1"} target="_blank" rel="noreferrer">OPEN PROJECTOR MODE <ArrowRight size={16}/></a>
            {quizStatus === "draft" ? <button className="gold-button wide" disabled={busy || !(quiz?.participants?.length)} onClick={() => { if (window.confirm("Start the 20-question quiz now? Registration will close and the 20-second timer will apply to every question.")) adminAction("admin_start"); }}><Spade size={17}/> START QUIZ FOR EVERYONE</button> :
            quizStatus === "live" ? <button className="outline-button wide" disabled={busy} onClick={() => { if (window.confirm("End the quiz now? Participants will no longer be able to submit answers.")) adminAction("admin_finish"); }}>END QUIZ</button> :
            <div className="waiting-box"><b>QUIZ COMPLETED</b><span>Reset the event to clear all registrations and open a fresh registration round.</span></div>}
            <button className="danger-outline wide" disabled={busy} onClick={() => { if (window.confirm("PERMANENT RESET: This will permanently delete ALL participant registrations and quiz attempts. Everyone will have to register again. This cannot be undone. Continue?")) adminAction("admin_reset"); }}><RotateCcw size={16}/> RESET & DELETE ALL PARTICIPANTS</button>
          </div>
          <div className="glass-card registration-qr-card">
            <div className="section-kicker">PARTICIPANT REGISTRATION</div>
            <h3>SCAN TO JOIN THE TABLE</h3>
            <p>Display this QR code on the projector. Participants can scan it to open the registration page.</p>
            <a className="registration-qr-image" href={registrationUrl} target="_blank" rel="noreferrer" aria-label="Open participant registration page">
              <img src={registrationQrUrl} alt="QR code for King of Chips 2.0 participant registration" />
            </a>
            <div className="registration-qr-url">{registrationUrl}</div>
            <a className="outline-button registration-open-link" href={registrationUrl} target="_blank" rel="noreferrer">OPEN REGISTRATION PAGE <ArrowRight size={15}/></a>
          </div>
          {quizStatus === "live" && <div className="round-monitor">
            <div className="section-kicker">LIVE ROUND MONITOR</div>
            <div className="round-monitor-top"><b>{roundPhase === "question" ? "QUESTION " + String(questionIndex+1).padStart(2,"0") + " · ANSWER COLLECTION" : roundPhase === "leaderboard" ? "LEADERBOARD · ROUND " + (questionIndex+1) : "QUIZ COMPLETE"}</b><span>{quiz?.round?.submitted_count || 0} / {quiz?.round?.total_participants || 0} SUBMITTED</span></div>
            <div className="submission-track"><div style={{width: ((quiz?.round?.total_participants ? (quiz.round.submitted_count/quiz.round.total_participants)*100 : 0)) + "%"}}/></div>
            <div className="round-monitor-foot">{roundPhase === "question" ? (quiz?.round?.seconds_remaining || 0) + " seconds remaining · Answers lock individually" : roundPhase === "leaderboard" ? "Next question in " + (quiz?.round?.leaderboard_seconds_remaining || 0) + " seconds" : "All rounds complete"}</div>
          </div>}
          {quizStatus === "live" && quiz?.admin_questions?.[questionIndex] && <div className="glass-card admin-live-question">
            <div className="section-kicker">LIVE QUESTION PREVIEW · ROUND {questionIndex+1}/20</div>
            <div className="admin-question-top"><h3>{roundPhase === "leaderboard" ? "ROUND ANSWER REVEAL" : "CURRENT QUESTION"}</h3><span>{quiz?.round?.seconds_remaining || 0}s LEFT</span></div>
            <p className="admin-question-prompt">Which five-card community combination gives you the strongest possible hand?</p>
            <div className="admin-hole-cards">{quiz.admin_questions[questionIndex].hole_cards.map((c:CardData,i:number)=><PlayingCard key={i} card={c} size="normal" delay={i*70}/>)}</div>
            <div className="admin-options-grid">{quiz.admin_questions[questionIndex].options.map((o:OptionData)=><div key={o.label} className={"admin-option " + (roundPhase === "leaderboard" && o.label === (quiz?.admin_questions?.[questionIndex]?.correct_option || "") ? "admin-option-correct" : "")}><b>{o.label}</b><div>{o.cards.map((c:CardData,i:number)=><PlayingCard key={i} card={c} size="tiny" delay={i*30}/>)}</div>{roundPhase === "leaderboard" && o.label === quiz?.admin_questions?.[questionIndex]?.correct_option && <small>✓ CORRECT ANSWER</small>}</div>)}</div>
            {roundPhase === "leaderboard" && <div className="admin-answer-key">Correct answer: <b>{quiz?.admin_questions?.[questionIndex]?.correct_option || "—"}</b> · {quiz?.admin_questions?.[questionIndex]?.category || ""}</div>}
          </div>}
          {quizStatus === "live" && <div className="admin-submission-list">
            <div className="admin-section-head"><h3>ROUND SUBMISSIONS</h3><span>{quiz?.round?.submitted_count || 0} / {quiz?.round?.total_participants || 0} LOCKED</span></div>
            <div className="submission-people">{(quiz?.participants || []).map((p:any)=><div className="submission-person" key={p.id}><span className={"submission-dot " + (p.has_submitted ? "done" : "pending")}/><b>{p.team_name}</b><small>{p.has_submitted ? "SUBMITTED" : "WAITING"}</small></div>)}</div>
          </div>}
          <div className="admin-note"><Shield size={16}/><span>Keep this Control Room tab open throughout the event. It coordinates the shared timer, closes rounds, records timeouts and advances everyone together. Submitted answers lock immediately; the leaderboard appears when everyone submits or time expires.</span></div>
          <div className="admin-section-head"><h3>REGISTERED PLAYERS</h3><span>{quiz?.participants?.length || 0} entries</span></div>
          <div className="participant-list">
            {(quiz?.participants || []).filter((p:any) => !["left","disqualified"].includes(p.status)).map((p:any) => <div className="participant-row" key={p.id}><div className="avatar-chip">{(p.team_name || "?").slice(0,1).toUpperCase()}</div><div><b>{p.team_name}</b><small>{p.captain_name}</small></div><span className="player-state">{p.status?.toUpperCase()}</span><button className="delete-participant" disabled={busy || quizStatus !== "draft"} title={quizStatus !== "draft" ? "Individual deletion is available while registration is open" : "Permanently delete " + p.team_name} onClick={() => deleteParticipant(p)}>DELETE</button></div>)}
            {!quiz?.participants?.length && <div className="empty-state">No registrations yet.</div>}
          </div>
        </div>
        {(roundPhase === "leaderboard" || quizStatus === "completed") && <Leaderboard rows={sortedBoard}/>}
      </section> :
      <section className="player-layout">
        <div className="quiz-column">
          {!attempt ? <div className="glass-card waiting-card">
            <div className="waiting-emblem"><Spade size={34}/></div><div className="section-kicker">YOU'RE IN THE GAME</div><h2>WELCOME, {quiz?.team?.team_name?.toUpperCase()}.</h2>
            {quizStatus === "live" ? <><p>The quiz is live. Your question will appear automatically with everyone else's.</p><div className="waiting-box"><div className="pulse-dot"/><b>JOINING THE LIVE ROUND</b><span>Keep this page open. The current question is synchronised for all players.</span></div></> :
              quizStatus === "completed" ? <p>The quiz has ended. Check the leaderboard for final standings.</p> :
              <><p>You're registered. The organiser will start the quiz shortly.</p><div className="waiting-box"><div className="pulse-dot"/><b>WAITING FOR THE ORGANISER</b><span>Keep this page open. It will update automatically when the quiz starts.</span></div></>}
          </div> : completed ? <div className="glass-card finish-card">
            <div className="finish-trophy"><Trophy size={44}/></div><div className="section-kicker">QUIZ COMPLETED</div><h2>YOU PLAYED YOUR HAND.</h2>
            <div className="final-score"><b>{totalScore}</b><span>/ 2,400 POINTS</span></div>
            <div className="finish-stats"><div><b>{attempt.correct_count}/20</b><small>CORRECT ANSWERS</small></div><div><b>{(attempt.total_time_ms/1000).toFixed(1)}s</b><small>TIME USED</small></div></div>
            <p>Your score is on the live leaderboard. Good game!</p>
          </div> : quizStatus === "live" && roundPhase === "leaderboard" ? <div className="glass-card round-leaderboard">
            <div className="finish-trophy"><Trophy size={40}/></div><div className="section-kicker">ROUND {questionIndex+1} COMPLETE</div><h2>THE TABLE HAS SPOKEN.</h2>
            <p>All answers are locked. Here's the leaderboard after this hand.</p>
            <Leaderboard rows={sortedBoard}/>
            <div className="next-round-countdown"><Clock3 size={15}/> NEXT QUESTION IN {quiz?.round?.leaderboard_seconds_remaining ?? 0}s</div>
          </div> : question ? <div className="glass-card question-card">
            <div className="question-topline"><div><div className="section-kicker">HAND {String(questionIndex+1).padStart(2,"0")} <span>/ 20</span></div><h2>FIND YOUR BEST HAND.</h2></div><div className={"countdown " + (secondsLeft <= 5 ? "urgent" : "")}><Clock3 size={16}/><b>{secondsLeft}</b><small>SEC</small></div></div>
            <div className="progress-track"><div className="progress-fill" style={{width: ((questionIndex)/20*100) + "%"}}/></div>
            <div className="private-area"><div className="card-label">YOUR PRIVATE CARDS <span>HOLE CARDS</span></div><div className="card-row private-cards">{question.hole_cards.map((c,i)=><PlayingCard key={i} card={c} size="large" delay={i*100}/>)}</div></div>
            <div className="question-instruction">Which five-card community combination gives you the strongest possible hand?</div>
            <div className="options-grid">
              {question.options.map((o) => <button key={o.label} className={"option-card " + (mySelectedOption===o.label ? "chosen" : "")} disabled={answerLocked || !!selected || busy || secondsLeft<=0} onClick={() => submitAnswer(o.label)}>
                <span className="option-letter">{o.label}</span><span className="option-cards">{o.cards.map((c,i)=><PlayingCard key={i} card={c} size="tiny" delay={i*45}/>)}</span><span className="option-select">{mySelectedOption===o.label ? "LOCKED" : answerLocked ? "ANSWER LOCKED" : "CHOOSE"}</span>
              </button>)}
            </div>
            <div className="question-footer"><span><Timer size={14}/> {answerLocked ? "ANSWER LOCKED · WAITING FOR OTHERS" : secondsLeft<=0 ? "TIME UP · CLOSING ROUND" : "20 SECONDS PER QUESTION"}</span><span>{questionIndex+1} OF 20</span></div>
          </div> : <div className="glass-card loading-card"><div className="loading-spinner"/><h2>DEALING THE NEXT HAND</h2></div>}
        </div>
        <aside className="side-column">
          <div className="glass-card player-info"><div className="section-kicker">PLAYER CARD</div><div className="player-name"><div className="avatar-chip big">{quiz?.team?.team_name?.slice(0,1).toUpperCase()}</div><div><b>{quiz?.team?.team_name}</b><small>{quiz?.team?.captain_name}</small></div></div><div className="player-score"><small>YOUR SCORE</small><b>{totalScore}<span> / 2,400</span></b></div><div className="mini-progress"><div style={{width:(totalScore/2400*100)+"%"}}/></div><div className="score-meta"><span>{attempt?.correct_count || 0} correct</span><span>{answeredCount}/20 answered</span></div></div>
          {(roundPhase === "leaderboard" || quizStatus === "completed") ? <Leaderboard rows={sortedBoard} compact/> : <div className="glass-card leaderboard-pending"><div className="section-kicker">LIVE STANDINGS</div><Trophy size={24}/><b>LEADERBOARD AFTER THE HAND</b><span>Lock in your answer. Standings will appear as soon as the round closes.</span></div>}
        </aside>
      </section>}

      {result && !isAdmin && !projectorMode && roundPhase === "question" && <div className={"result-overlay " + (result.correct ? "is-correct" : "is-wrong")}>
        <div className="result-sparks">{Array.from({length:18},(_,i)=><i key={i} style={{"--i":i} as React.CSSProperties}/>)}</div>
        <div className="result-content">
          {result.correct ? <><div className="result-icon"><Crown size={42}/></div><div className="result-kicker">THE CROWD GOES WILD</div><div className="points-pop">+{result.points_earned} POINTS {result.speed_bonus > 0 ? "(+" + result.speed_bonus + " SPEED)" : ""}</div><h2 className="quip-title">{result.quip || "CERTIFIED JUWARI!"}</h2><p>{result.category} · Your answer {result.selected_option || "NOT ANSWERED"} · Correct answer {result.correct_option}</p><div className="result-waiting">ANSWER LOCKED · WAITING FOR THE TABLE</div><div className="reveal-cards">{(result.best_cards||[]).map((c:CardData,i:number)=><PlayingCard key={i} card={c} size="tiny" delay={i*90}/>)}</div><div className="chip-shower"><span>♠</span><span>♦</span><span>♣</span><span>♥</span><span>♠</span><span>♦</span><span>♣</span></div></> :
          <><div className="result-icon fold-icon"><Spade size={40}/></div><div className="result-kicker">NOT THIS TIME</div><h2 className="quip-title">{result.quip || "DOOB GAYE SAARE PAISE!"}</h2><div className="points-pop muted-points">NO POINTS</div><p>{result.timed_out ? "TIME'S UP! " : ""}Your answer: {result.selected_option || "NOT ANSWERED"} · Best answer: {result.correct_option} · {result.category}</p><div className="result-waiting">ANSWER LOCKED · WAITING FOR THE TABLE</div><div className="reveal-cards">{(result.best_cards||[]).map((c:CardData,i:number)=><PlayingCard key={i} card={c} size="tiny" delay={i*90}/>)}</div></>}
        </div>
      </div>}
      <footer className="site-footer"><span><b>♠ KING OF CHIPS 2.0</b> · FINCEPTION</span><span>PLAY SMART. PLAY FAIR. VIRTUAL CHIPS ONLY.</span></footer>
    </main>
  </div>;
}

function ProjectorView({ quiz, quizStatus, roundPhase, questionIndex, question, secondsLeft, leaderboard }: { quiz: QuizData | null; quizStatus: string; roundPhase: string; questionIndex: number; question: Question | null | undefined; secondsLeft: number; leaderboard: any[] }) {
  return <section className="projector-screen">
    <div className="projector-top"><div className="brand-lockup"><div className="brand-icon"><Spade size={25}/></div><div><b>KING OF <i>CHIPS</i></b><small>FINCEPTION · THE FINANCE CLUB</small></div></div><div className="projector-live"><span/> {quizStatus === "live" ? (roundPhase === "question" ? "LIVE QUESTION" : "LEADERBOARD") : quizStatus.toUpperCase()}</div></div>
    {quizStatus !== "live" ? <div className="projector-hold"><div className="section-kicker">KING OF CHIPS 2.0</div><h1>{quizStatus === "completed" ? "THE TABLE HAS SPOKEN." : "GET READY TO PLAY."}</h1><p>{quizStatus === "completed" ? "Final standings are ready." : "The next hand will appear here when the organiser starts the quiz."}</p>{quizStatus === "completed" && <Leaderboard rows={leaderboard}/>}</div> :
      roundPhase === "leaderboard" ? <div className="projector-board"><div className="section-kicker">ROUND {questionIndex+1} COMPLETE</div><h1><Trophy size={35}/> LIVE LEADERBOARD</h1><p>All answers are locked · Next hand in {quiz?.round?.leaderboard_seconds_remaining ?? 0}s</p><Leaderboard rows={leaderboard}/></div> : question ? <div className="projector-question">
        <div className="projector-question-head"><div><div className="section-kicker">HAND {String(questionIndex+1).padStart(2,"0")} / 20</div><h1>FIND YOUR BEST HAND.</h1></div><div className={"countdown projector-countdown " + (secondsLeft <= 5 ? "urgent" : "")}><Clock3 size={22}/><b>{secondsLeft}</b><small>SEC</small></div></div>
        <div className="projector-progress"><div style={{width: (questionIndex/20*100)+"%"}}/></div>
        <div className="projector-private"><div className="card-label">PRIVATE CARDS <span>HOLE CARDS</span></div><div className="card-row private-cards">{question.hole_cards.map((c,i)=><PlayingCard key={i} card={c} size="large" delay={i*100}/>)}</div></div>
        <div className="projector-instruction">Which five-card community combination gives you the strongest possible hand?</div>
        <div className="projector-options">{question.options.map(o=><div className="projector-option" key={o.label}><b>{o.label}</b><div>{o.cards.map((c,i)=><PlayingCard key={i} card={c} size="normal" delay={i*35}/>)}</div></div>)}</div>
        <div className="projector-bottom"><span>{quiz?.round?.submitted_count || 0} / {quiz?.round?.total_participants || 0} PLAYERS SUBMITTED</span><span>QUESTION CLOSES IN {secondsLeft}s</span></div>
      </div> : <div className="projector-hold"><h1>DEALING THE NEXT HAND</h1></div>}
  </section>;
}

function Leaderboard({ rows, compact = false }: { rows: any[]; compact?: boolean }) {
  return <div className={"glass-card leaderboard-card " + (compact ? "compact" : "")}>
    <div className="leaderboard-heading"><div><div className="section-kicker">THE RACE FOR THE CROWN</div><h3><Trophy size={17}/> LIVE LEADERBOARD</h3></div><span className="live-mini"><i/> LIVE</span></div>
    <div className="leaderboard-list">
      {rows.slice(0, compact ? 8 : 20).map((p:any) => <div className={"leader-row " + (p.rank<=3 ? "top-rank" : "")} key={p.team_id}>
        <div className="rank-number">{p.rank===1?<Crown size={16}/>:p.rank<=3?<Medal size={15}/>:String(p.rank).padStart(2,"0")}</div>
        <div className="leader-name"><b>{p.team_name}</b><small>{p.captain_name}</small></div>
        <div className="leader-points"><b>{p.score}</b><small>{p.correct_count}/20 RIGHT</small></div>
      </div>)}
      {!rows.length && <div className="empty-state">The leaderboard will appear once players finish questions.</div>}
    </div>
    <div className="leaderboard-foot">RANKED BY CORRECT ANSWERS · SPEED BONUS · TIME</div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App/>);
