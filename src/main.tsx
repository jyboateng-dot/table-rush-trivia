import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, Socket } from "socket.io-client";
import {
  BarChart3,
  Check,
  ChevronRight,
  Crown,
  Download,
  Eye,
  Gauge,
  Link as LinkIcon,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Settings,
  ShieldAlert,
  Smartphone,
  Square,
  Trophy,
  Vote,
} from "lucide-react";
import "./styles.css";

type View = "player" | "tv" | "admin";
type Difficulty = "easy" | "medium" | "hard";
type CategoryKey = "general" | "geography" | "movies" | "music" | "sports" | "science" | "history" | "ghana";
type Phase = "vote" | "ready" | "active" | "paused" | "closed" | "reveal" | "finished";
type CategoryMeta = { label: string; accent: string };
type Team = {
  id: string;
  tableNumber: number;
  name: string;
  vote?: CategoryKey;
  score: number;
  answeredQuestionId?: string;
  violations: number;
  reconnects: number;
  lastSeenAt?: number;
  lastViolationAt?: number;
  disqualified?: boolean;
};
type VenueStatus = {
  persistence: string;
  websocket: string;
  connectedDevices: number;
  adminDevices: number;
  uptime: number;
  questionCacheReady: boolean;
};
type PublicQuestion = {
  id: string;
  category: CategoryKey;
  difficulty: Difficulty;
  question: string;
  answers: string[];
  correct?: string;
  source: string;
  sourceUrl: string;
};
type EventState = {
  id: string;
  title: string;
  adminKey?: string;
  phase: Phase;
  categories: Record<CategoryKey, CategoryMeta>;
  votes: Record<CategoryKey, number>;
  selectedCategory: CategoryKey;
  difficulty: Difficulty;
  duration: number;
  questionCount: number;
  questionNumber: number;
  tableLimit: number;
  cachedQuestionCount: number;
  venueStatus: VenueStatus;
  prizeLabel: string;
  winnerTeamId?: string;
  finalizedAt?: number;
  archivedAt?: number;
  question: PublicQuestion | null;
  questionStartedAt: number | null;
  pausedRemainingMs: number | null;
  teams: Team[];
};

const roleFromPath = (): { eventId: string; view: View } | null => {
  const match = window.location.pathname.match(/^\/e\/([^/]+)\/(join|tv|admin)/);
  if (!match) return null;
  return { eventId: match[1], view: match[2] === "join" ? "player" : (match[2] as View) };
};

const getDeviceId = () => {
  const existing = localStorage.getItem("deviceId");
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem("deviceId", next);
  return next;
};

function App() {
  const route = roleFromPath();
  const [eventId, setEventId] = useState(route?.eventId ?? "demo");
  const [view, setView] = useState<View>(route?.view ?? "admin");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<EventState | null>(null);
  const [connected, setConnected] = useState(false);
  const [adminPin, setAdminPin] = useState(() => new URLSearchParams(window.location.search).get("key") ?? localStorage.getItem(`adminPin:${eventId}`) ?? "");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState(() => localStorage.getItem(`team:${eventId}`) ?? "");
  const [remaining, setRemaining] = useState(0);
  const [appError, setAppError] = useState("");
  const deviceId = useMemo(getDeviceId, []);

  useEffect(() => {
    if (!route) return;
    setEventId(route.eventId);
    setView(route.view);
  }, []);

  useEffect(() => {
    const nextSocket = io();
    setSocket(nextSocket);
    nextSocket.on("connect", () => setConnected(true));
    nextSocket.on("disconnect", () => setConnected(false));
    nextSocket.on("state", (payload: { state: EventState; adminAuthed?: boolean }) => {
      setState(payload.state);
      if (typeof payload.adminAuthed === "boolean") setAdminAuthed(payload.adminAuthed);
    });
    nextSocket.on("app_error", (payload: { message?: string }) => {
      setAppError(payload.message ?? "Something went wrong.");
      window.setTimeout(() => setAppError(""), 4500);
    });
    nextSocket.on("team_joined", (payload: { teamId: string }) => {
      localStorage.setItem(`team:${eventId}`, payload.teamId);
      setActiveTeamId(payload.teamId);
    });
    return () => {
      nextSocket.close();
    };
  }, [eventId]);

  useEffect(() => {
    if (!socket) return;
    socket.emit("join_event", { eventId, role: view, pin: adminPin, teamId: activeTeamId, deviceId });
  }, [activeTeamId, adminPin, deviceId, eventId, socket, view]);

  useEffect(() => {
    if (!state?.questionStartedAt || state.phase !== "active") {
      setRemaining(state?.phase === "paused" && state.pausedRemainingMs ? state.pausedRemainingMs / 1000 : state?.duration ?? 0);
      return;
    }
    const tick = window.setInterval(() => {
      const elapsed = (Date.now() - state.questionStartedAt!) / 1000;
      setRemaining(Math.max(0, state.duration - elapsed));
    }, 100);
    return () => window.clearInterval(tick);
  }, [state?.duration, state?.phase, state?.pausedRemainingMs, state?.questionStartedAt]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && state?.phase === "active" && activeTeamId) {
        socket?.emit("player_focus_loss", { eventId, teamId: activeTeamId, deviceId });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [activeTeamId, deviceId, eventId, socket, state?.phase]);

  const createEvent = async (settings: Partial<Pick<EventState, "title" | "difficulty" | "duration" | "questionCount" | "tableLimit" | "prizeLabel">> = {}) => {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const payload = await response.json();
    if (payload.adminKey) localStorage.setItem(`adminPin:${payload.eventId}`, payload.adminKey);
    window.location.href = `/e/${payload.eventId}/admin${payload.adminKey ? `?key=${encodeURIComponent(payload.adminKey)}` : ""}`;
  };

  if (!route) return <Home createEvent={createEvent} />;
  if (!state) return <Loading />;

  const baseEventUrl = `${window.location.origin}/e/${eventId}`;
  const activeTeam = state.teams.find((team) => team.id === activeTeamId);
  const leaderboard = [...state.teams].sort((a, b) => Number(a.disqualified) - Number(b.disqualified) || b.score - a.score);

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">{connected ? "Live room connected" : "Reconnecting"}</p>
          <h1>{state.title}</h1>
        </div>
        {view !== "player" && (
          <nav className="viewSwitch" aria-label="View selector">
            <a className={view === "tv" ? "active" : ""} href={`${baseEventUrl}/tv${adminPin ? `?key=${encodeURIComponent(adminPin)}` : ""}`}>
              <Monitor size={18} /> TV
            </a>
            <a className={view === "admin" ? "active" : ""} href={`${baseEventUrl}/admin${adminPin ? `?key=${encodeURIComponent(adminPin)}` : ""}`}>
              <Gauge size={18} /> Admin
            </a>
          </nav>
        )}
      </section>
      {appError && <div className="appError">{appError}</div>}

      {view === "player" && (
        <PlayerView
          state={state}
          activeTeam={activeTeam}
          activeTeamId={activeTeamId}
          remaining={remaining}
          joinTeam={() => socket?.emit("player_join_team", { eventId, deviceId })}
          setActiveTeamId={(teamId) => {
            localStorage.setItem(`team:${eventId}`, teamId);
            setActiveTeamId(teamId);
          }}
          updateTeamName={(name) => socket?.emit("player_update_team", { eventId, teamId: activeTeamId, name, deviceId })}
          voteFor={(category) => socket?.emit("player_vote", { eventId, teamId: activeTeamId, category, deviceId })}
          submitAnswer={(answer) => socket?.emit("player_answer", { eventId, teamId: activeTeamId, answer, deviceId })}
        />
      )}

      {view === "tv" && (
        adminAuthed ? (
          <TvView state={state} remaining={remaining} leaderboard={leaderboard} joinUrl={`${baseEventUrl}/join`} />
        ) : (
          <HostUnlock
            title="TV Screen Locked"
            adminPin={adminPin}
            setAdminPin={(pin) => {
              localStorage.setItem(`adminPin:${eventId}`, pin);
              setAdminPin(pin);
            }}
            authenticate={() => socket?.emit("join_event", { eventId, role: "tv", pin: adminPin, deviceId })}
          />
        )
      )}

      {view === "admin" && (
        <AdminView
          state={state}
          adminPin={adminPin}
          adminAuthed={adminAuthed}
          baseEventUrl={baseEventUrl}
          setAdminPin={(pin) => {
            localStorage.setItem(`adminPin:${eventId}`, pin);
            setAdminPin(pin);
          }}
          authenticate={() => socket?.emit("join_event", { eventId, role: "admin", pin: adminPin, deviceId })}
          setDifficulty={(difficulty) => socket?.emit("admin_set_config", { eventId, pin: adminPin, difficulty })}
          setDuration={(duration) => socket?.emit("admin_set_config", { eventId, pin: adminPin, duration })}
          startRound={() => socket?.emit("admin_start_question", { eventId, pin: adminPin })}
          lockVoting={() => socket?.emit("admin_lock_voting", { eventId, pin: adminPin })}
          pause={() => socket?.emit("admin_pause_question", { eventId, pin: adminPin })}
          resume={() => socket?.emit("admin_resume_question", { eventId, pin: adminPin })}
          closeQuestion={() => socket?.emit("admin_close_question", { eventId, pin: adminPin })}
          reveal={() => socket?.emit("admin_reveal", { eventId, pin: adminPin })}
          finish={() => socket?.emit("admin_finish", { eventId, pin: adminPin })}
          reset={() => socket?.emit("admin_reset", { eventId, pin: adminPin })}
          updateEventSetup={(settings) => socket?.emit("admin_update_event_setup", { eventId, pin: adminPin, ...settings })}
          createEvent={createEvent}
          declareWinner={(teamId) => socket?.emit("admin_declare_winner", { eventId, pin: adminPin, teamId })}
          archiveEvent={() => socket?.emit("admin_archive_event", { eventId, pin: adminPin })}
          adjustScore={(teamId, delta) => socket?.emit("admin_adjust_score", { eventId, pin: adminPin, teamId, delta })}
          setTeamStatus={(teamId, disqualified) =>
            socket?.emit("admin_set_team_status", { eventId, pin: adminPin, teamId, disqualified })
          }
        />
      )}
    </main>
  );
}

function Home({ createEvent }: { createEvent: () => void }) {
  return (
    <main className="shell home">
      <section>
        <p className="eyebrow">Hosted live trivia</p>
        <h1>Table Rush Trivia</h1>
        <p className="heroCopy">Create a live event, show the TV link on venue screens, and let every table join from any phone by scanning a public QR code.</p>
        <div className="actionRow">
          <button className="primaryAction" onClick={() => createEvent()}>
            <Plus size={18} /> Create live event
          </button>
          <a className="secondaryLink" href="/e/demo/admin">
            <Play size={18} /> Open demo event
          </a>
        </div>
      </section>
    </main>
  );
}

function Loading() {
  return (
    <main className="shell">
      <div className="panel loadingPanel">
        <p className="eyebrow">Connecting</p>
        <h1>Table Rush Trivia</h1>
        <p className="statusLine">Opening live event room...</p>
      </div>
    </main>
  );
}

function PlayerView(props: {
  state: EventState;
  activeTeam?: Team;
  activeTeamId: string;
  remaining: number;
  joinTeam: () => void;
  setActiveTeamId: (id: string) => void;
  updateTeamName: (name: string) => void;
  voteFor: (category: CategoryKey) => void;
  submitAnswer: (answer: string) => void;
}) {
  const answered = props.state.question?.id === props.activeTeam?.answeredQuestionId;
  const disqualified = props.activeTeam?.disqualified === true;

  if (!props.activeTeam) {
    return (
      <section className="workspace playerGrid">
        <section className="panel mainPanel">
          <div className="panelTitle">
            <Smartphone size={19} />
            <h2>Join Your Table</h2>
          </div>
          <p className="statusLine">You will be assigned the next table number automatically. The leaderboard name starts as the table name and can be edited after joining.</p>
          <button className="primaryAction wideAction" onClick={props.joinTeam}>
            <Plus size={18} /> Join next table
          </button>
          {props.state.teams.length > 0 && (
            <>
              <p className="statusLine">Or reconnect to an existing table on this device:</p>
              <div className="teamList">
                {props.state.teams.map((team) => (
                  <button className="teamPick" key={team.id} onClick={() => props.setActiveTeamId(team.id)}>
                    Table {team.tableNumber} - {team.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </section>
    );
  }

  return (
    <section className="workspace playerGrid">
      <aside className="panel compact">
        <div className="panelTitle">
          <Smartphone size={19} />
          <h2>Table Phone</h2>
        </div>
        <label className="fieldLabel" htmlFor="team-select">Table</label>
        <select id="team-select" value={props.activeTeamId} onChange={(event) => props.setActiveTeamId(event.target.value)}>
          {props.state.teams.map((team) => (
            <option key={team.id} value={team.id}>Table {team.tableNumber}</option>
          ))}
        </select>
        <p className="fixedTableLabel">Table {props.activeTeam.tableNumber}</p>
        <label className="fieldLabel" htmlFor="team-name">Leaderboard name</label>
        <input id="team-name" value={props.activeTeam.name} onChange={(event) => props.updateTeamName(event.target.value)} />
        <button className="secondaryAction" onClick={() => props.setActiveTeamId("")}>
          <Plus size={18} /> Add another table
        </button>
        {disqualified && <p className="dangerText">This table has been disqualified by the host.</p>}
      </aside>

      <section className="panel mainPanel">
        {disqualified ? (
          <div className="emptyState">
            <ShieldAlert size={28} />
            <h2>Table Disqualified</h2>
            <p className="statusLine">Please speak to the host if this was a mistake.</p>
          </div>
        ) : props.state.phase === "vote" ? (
          <>
            <div className="panelTitle">
              <Vote size={20} />
              <h2>Category Vote</h2>
            </div>
            <div className="categoryGrid">
              {(Object.entries(props.state.categories) as [CategoryKey, CategoryMeta][]).map(([key, item]) => (
                <button
                  className={`categoryButton ${props.activeTeam?.vote === key ? "chosen" : ""}`}
                  key={key}
                  style={{ "--accent": item.accent } as React.CSSProperties}
                  onClick={() => props.voteFor(key)}
                >
                  <span>{item.label}</span>
                  {props.activeTeam?.vote === key && <Check size={18} />}
                </button>
              ))}
            </div>
          </>
        ) : props.state.phase === "finished" ? (
          <div className="emptyState">
            <Trophy size={28} />
            <h2>Game Finished</h2>
            <p className="statusLine">Check the TV screen for the final leaderboard.</p>
          </div>
        ) : props.state.question ? (
          <>
            <div className="questionHeader">
              <span>{props.state.question ? props.state.categories[props.state.question.category].label : "Question"}</span>
              <strong>{Math.ceil(props.remaining)}s</strong>
            </div>
            <h2 className="questionText">{props.state.question?.question ?? "Waiting for host..."}</h2>
            <div className="answerGrid">
              {props.state.question?.answers.map((answer) => (
                <button key={answer} disabled={answered || props.state.phase !== "active" || disqualified} onClick={() => props.submitAnswer(answer)}>
                  {answered ? <Check size={17} /> : <ChevronRight size={17} />}
                  {answer}
                </button>
              ))}
            </div>
            {answered && <p className="statusLine">Answer locked for {props.activeTeam.name}.</p>}
          </>
        ) : (
          <div className="emptyState">
            <Vote size={28} />
            <h2>Voting Locked</h2>
            <p className="statusLine">Waiting for the host to start the next question.</p>
          </div>
        )}
      </section>
    </section>
  );
}

function TvView(props: { state: EventState; remaining: number; leaderboard: Team[]; joinUrl: string }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(props.joinUrl)}`;
  const winner = props.state.teams.find((team) => team.id === props.state.winnerTeamId) ?? props.leaderboard[0];
  return (
    <section className="workspace tvLayout">
      <section className="stage">
        {props.state.phase === "finished" ? (
          <>
            <p className="eyebrow">Final winner</p>
            <h2 className="stageQuestion">{winner?.name ?? "No winner yet"}</h2>
            <div className="reveal">
              <Trophy size={22} /> {winner?.score ?? 0} points - {props.state.prizeLabel}
            </div>
          </>
        ) : props.state.phase === "vote" ? (
          <>
            <div className="qrBlock">
              <img src={qrUrl} alt="Game QR code" />
              <div>
                <p className="eyebrow">Scan to join</p>
                <h2>Vote for tonight's trivia</h2>
                <p className="joinUrl">{props.joinUrl}</p>
              </div>
            </div>
            <VoteBars categories={props.state.categories} votes={props.state.votes} />
          </>
        ) : (
          <>
            <div className="questionHeader large">
              <span>{props.state.question ? props.state.categories[props.state.question.category].label : props.state.categories[props.state.selectedCategory].label}</span>
              <strong>{Math.ceil(props.remaining)}s</strong>
            </div>
            <h2 className="stageQuestion">{props.state.question?.question ?? "Ready for the next question"}</h2>
            {props.state.phase === "reveal" && props.state.question?.correct && (
              <div className="reveal">
                <Check size={22} /> {props.state.question.correct}
              </div>
            )}
          </>
        )}
      </section>
      <Leaderboard teams={props.leaderboard} />
    </section>
  );
}

function HostUnlock(props: {
  title: string;
  adminPin: string;
  setAdminPin: (pin: string) => void;
  authenticate: () => void;
}) {
  return (
    <section className="workspace">
      <section className="panel authPanel">
        <div className="panelTitle">
          <ShieldAlert size={20} />
          <h2>{props.title}</h2>
        </div>
        <input type="password" placeholder="Host PIN or secure event key" value={props.adminPin} onChange={(event) => props.setAdminPin(event.target.value)} />
        <button className="primaryAction wideAction" onClick={props.authenticate}>
          <Check size={18} /> Unlock
        </button>
        <p className="statusLine">Use the private host PIN or the secure link from the admin dashboard.</p>
      </section>
    </section>
  );
}

function AdminView(props: {
  state: EventState;
  adminPin: string;
  adminAuthed: boolean;
  baseEventUrl: string;
  setAdminPin: (pin: string) => void;
  authenticate: () => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setDuration: (duration: number) => void;
  startRound: () => void;
  lockVoting: () => void;
  pause: () => void;
  resume: () => void;
  closeQuestion: () => void;
  reveal: () => void;
  finish: () => void;
  reset: () => void;
  updateEventSetup: (settings: Partial<Pick<EventState, "title" | "difficulty" | "duration" | "questionCount" | "tableLimit" | "prizeLabel">>) => void;
  createEvent: (settings: Partial<Pick<EventState, "title" | "difficulty" | "duration" | "questionCount" | "tableLimit" | "prizeLabel">>) => void;
  declareWinner: (teamId: string) => void;
  archiveEvent: () => void;
  adjustScore: (teamId: string, delta: number) => void;
  setTeamStatus: (teamId: string, disqualified: boolean) => void;
}) {
  const [setup, setSetup] = useState({
    title: props.state.title,
    difficulty: props.state.difficulty,
    duration: props.state.duration,
    questionCount: props.state.questionCount,
    tableLimit: props.state.tableLimit,
    prizeLabel: props.state.prizeLabel,
  });

  useEffect(() => {
    setSetup({
      title: props.state.title,
      difficulty: props.state.difficulty,
      duration: props.state.duration,
      questionCount: props.state.questionCount,
      tableLimit: props.state.tableLimit,
      prizeLabel: props.state.prizeLabel,
    });
  }, [props.state.difficulty, props.state.duration, props.state.prizeLabel, props.state.questionCount, props.state.tableLimit, props.state.title]);

  if (!props.adminAuthed) {
    return (
      <HostUnlock title="Admin Locked" adminPin={props.adminPin} setAdminPin={props.setAdminPin} authenticate={props.authenticate} />
    );
  }

  const setupLocked = !["vote", "ready"].includes(props.state.phase);
  const answeredCount = props.state.question ? props.state.teams.filter((team) => team.answeredQuestionId === props.state.question?.id).length : 0;
  const winner = props.state.teams.find((team) => team.id === props.state.winnerTeamId) ?? [...props.state.teams].sort((a, b) => Number(a.disqualified) - Number(b.disqualified) || b.score - a.score)[0];
  const secureKey = props.adminPin || props.state.adminKey;
  const adminUrl = `${props.baseEventUrl}/admin${secureKey ? `?key=${encodeURIComponent(secureKey)}` : ""}`;
  const tvUrl = `${props.baseEventUrl}/tv${secureKey ? `?key=${encodeURIComponent(secureKey)}` : ""}`;
  const resultsUrl = `/api/events/${props.state.id}/results?key=${encodeURIComponent(props.adminPin)}`;
  const suspiciousTeams = props.state.teams
    .filter((team) => team.violations > 0 || team.reconnects > 2 || team.disqualified)
    .sort((a, b) => b.violations - a.violations || b.reconnects - a.reconnects);

  return (
    <section className="workspace adminGrid">
      <section className="panel">
        <div className="panelTitle">
          <Gauge size={20} />
          <h2>Host Controls</h2>
        </div>
        <div className="launchStrip">
          <span>Launch ready</span>
          <strong>{props.state.teams.length}/{props.state.tableLimit} tables</strong>
          <strong>{props.state.prizeLabel}</strong>
        </div>
        <div className="hostStatus">
          <span>{props.state.phase}</span>
          <strong>Question {props.state.questionNumber}/{props.state.questionCount}</strong>
          <strong>{answeredCount}/{props.state.teams.filter((team) => !team.disqualified).length} answered</strong>
          <strong>{props.state.cachedQuestionCount} cached</strong>
        </div>
        <div className="actionRow">
          <button className="secondaryAction" onClick={props.lockVoting} disabled={props.state.phase !== "vote"}>
            <Vote size={18} /> Lock voting
          </button>
          <button className="primaryAction" onClick={props.startRound} disabled={["active", "paused", "finished"].includes(props.state.phase)}>
            <Play size={18} /> {props.state.phase === "reveal" ? "Next question" : "Start question"}
          </button>
          <button className="secondaryAction" onClick={props.pause} disabled={props.state.phase !== "active"}>
            <Pause size={18} /> Pause
          </button>
          <button className="secondaryAction" onClick={props.resume} disabled={props.state.phase !== "paused"}>
            <Play size={18} /> Resume
          </button>
          <button className="secondaryAction" onClick={props.closeQuestion} disabled={!["active", "paused"].includes(props.state.phase)}>
            <Square size={18} /> Close
          </button>
          <button className="secondaryAction" onClick={props.reveal} disabled={props.state.phase !== "closed"}>
            <Eye size={18} /> Reveal
          </button>
          <button className="secondaryAction" onClick={props.finish} disabled={props.state.phase === "finished"}>
            <Trophy size={18} /> Finish
          </button>
          <button className="secondaryAction" onClick={props.reset}>
            <RefreshCcw size={18} /> Reset
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panelTitle">
          <Settings size={20} />
          <h2>Event Setup</h2>
        </div>
        <div className="setupGrid">
          <label>
            <span>Event name</span>
            <input value={setup.title} onChange={(event) => setSetup({ ...setup, title: event.target.value })} disabled={setupLocked} />
          </label>
          <label>
            <span>Prize</span>
            <input value={setup.prizeLabel} onChange={(event) => setSetup({ ...setup, prizeLabel: event.target.value })} disabled={setupLocked} />
          </label>
          <label>
            <span>Difficulty</span>
            <select value={setup.difficulty} onChange={(event) => setSetup({ ...setup, difficulty: event.target.value as Difficulty })} disabled={setupLocked}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label>
            <span>Timer</span>
            <input type="number" min={8} max={45} value={setup.duration} onChange={(event) => setSetup({ ...setup, duration: Number(event.target.value) })} disabled={setupLocked} />
          </label>
          <label>
            <span>Questions</span>
            <input type="number" min={3} max={30} value={setup.questionCount} onChange={(event) => setSetup({ ...setup, questionCount: Number(event.target.value) })} disabled={setupLocked} />
          </label>
          <label>
            <span>Table limit</span>
            <input type="number" min={2} max={100} value={setup.tableLimit} onChange={(event) => setSetup({ ...setup, tableLimit: Number(event.target.value) })} disabled={setupLocked} />
          </label>
        </div>
        <div className="actionRow">
          <button className="primaryAction" onClick={() => props.updateEventSetup(setup)} disabled={setupLocked}>
            <Check size={18} /> Save setup
          </button>
          <button className="secondaryAction" onClick={() => props.createEvent(setup)}>
            <Plus size={18} /> New event
          </button>
        </div>
        {setupLocked && <p className="statusLine">Setup is locked after the first question starts.</p>}
      </section>

      <section className="panel">
        <div className="panelTitle">
          <LinkIcon size={20} />
          <h2>Launch Lobby</h2>
        </div>
        <div className="adminQr">
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`${props.baseEventUrl}/join`)}`} alt="Join QR code" />
          <div>
            <p className="eyebrow">Audience QR</p>
            <h2>{props.state.teams.length} joined</h2>
            <p className="statusLine">Category: {props.state.categories[props.state.selectedCategory].label}</p>
          </div>
        </div>
        <div className="linkStack">
          <a href={`${props.baseEventUrl}/join`}>Player QR link</a>
          <a href={tvUrl}>Secure TV screen link</a>
          <a href={adminUrl}>Secure admin link</a>
        </div>
        <p className="selectedLine">Leading: {props.state.categories[props.state.selectedCategory].label}</p>
        <VoteBars categories={props.state.categories} votes={props.state.votes} />
      </section>

      <section className="panel">
        <div className="panelTitle">
          <BarChart3 size={20} />
          <h2>Venue Status</h2>
        </div>
        <div className="statusGrid">
          <span>Database <strong>{props.state.venueStatus.persistence}</strong></span>
          <span>Socket <strong>{props.state.venueStatus.websocket}</strong></span>
          <span>Devices <strong>{props.state.venueStatus.connectedDevices}</strong></span>
          <span>Cache <strong>{props.state.venueStatus.questionCacheReady ? "Ready" : "Warming"}</strong></span>
        </div>
        <p className="statusLine">Server uptime: {Math.floor(props.state.venueStatus.uptime / 60)}m {props.state.venueStatus.uptime % 60}s</p>
      </section>

      <section className="panel">
        <div className="panelTitle">
          <Trophy size={20} />
          <h2>Prize & Results</h2>
        </div>
        <p className="selectedLine">Winner: {winner?.name ?? "No tables yet"}</p>
        <div className="actionRow">
          {props.state.teams.slice().sort((a, b) => Number(a.disqualified) - Number(b.disqualified) || b.score - a.score).slice(0, 4).map((team) => (
            <button className="secondaryAction" key={team.id} onClick={() => props.declareWinner(team.id)}>
              <Crown size={18} /> {team.name}
            </button>
          ))}
          <a className="secondaryLink" href={resultsUrl} target="_blank" rel="noreferrer">
            <Download size={18} /> Export
          </a>
          <button className="secondaryAction" onClick={props.archiveEvent} disabled={Boolean(props.state.archivedAt)}>
            <Square size={18} /> {props.state.archivedAt ? "Archived" : "Archive"}
          </button>
        </div>
        {props.state.finalizedAt && <p className="statusLine">Finalized: {new Date(props.state.finalizedAt).toLocaleString()}</p>}
      </section>

      <section className="panel">
        <div className="panelTitle">
          <ShieldAlert size={20} />
          <h2>Anti-Cheat Watch</h2>
        </div>
        <div className="watchSummary">
          <span>{suspiciousTeams.length} watched</span>
          <span>{props.state.teams.filter((team) => team.disqualified).length} DQ</span>
          <span>{props.state.teams.length}/{props.state.tableLimit} tables</span>
        </div>
        <div className="teamList">
          {(suspiciousTeams.length ? suspiciousTeams : props.state.teams).map((team) => (
            <div className="teamRow" key={team.id}>
              <span>
                <b>Table {team.tableNumber}</b>
                {team.name}
                {team.disqualified && <em>DQ</em>}
                <small>{team.violations} focus flags | {team.reconnects} reconnects</small>
              </span>
              <div className="adminTeamActions">
                <button onClick={() => props.adjustScore(team.id, -100)}>-100</button>
                <button onClick={() => props.adjustScore(team.id, 100)}>+100</button>
                <button onClick={() => props.setTeamStatus(team.id, !team.disqualified)}>
                  {team.disqualified ? "Restore" : "DQ"}
                </button>
              </div>
              <strong>{team.score}</strong>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function VoteBars(props: { categories: Record<CategoryKey, CategoryMeta>; votes: Record<CategoryKey, number> }) {
  const max = Math.max(1, ...Object.values(props.votes));
  return (
    <div className="voteBars">
      {(Object.entries(props.categories) as [CategoryKey, CategoryMeta][]).map(([key, item]) => (
        <div className="voteBar" key={key}>
          <span>{item.label}</span>
          <div>
            <i style={{ width: `${(props.votes[key] / max) * 100}%`, background: item.accent }} />
          </div>
          <strong>{props.votes[key]}</strong>
        </div>
      ))}
    </div>
  );
}

function Leaderboard({ teams }: { teams: Team[] }) {
  return (
    <aside className="leaderboard">
      <div className="panelTitle">
        <Trophy size={20} />
        <h2>Leaderboard</h2>
      </div>
      {teams.map((team, index) => (
        <div className={`leaderRow ${team.disqualified ? "disqualified" : ""}`} key={team.id}>
          <span className="rank">{index === 0 ? <Crown size={17} /> : index + 1}</span>
          <span><b>Table {team.tableNumber}</b>{team.name}{team.disqualified ? " (DQ)" : ""}</span>
          <strong>{team.score}</strong>
        </div>
      ))}
    </aside>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
