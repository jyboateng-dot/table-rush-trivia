import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/postgres-adapter";
import { hasDatabase, initDb, loadEvent, logEvent, pool, saveEvent, saveSubmission } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 5173;
const hostPin = process.env.HOST_PIN || "2468";
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];
const corsOrigin = allowedOrigins.length > 0 ? allowedOrigins : "*";
const io = new Server(httpServer, { cors: { origin: corsOrigin } });

const categories = {
  general: { label: "General Trivia", accent: "#f4c95d", openTdb: 9 },
  geography: { label: "Geography", accent: "#5fc4b3", openTdb: 22 },
  movies: { label: "Movies", accent: "#ff7a59", openTdb: 11 },
  music: { label: "Music", accent: "#c084fc", openTdb: 12 },
  sports: { label: "Sports", accent: "#55a7ff", openTdb: 21 },
  science: { label: "Science", accent: "#8fd14f", openTdb: 17 },
  history: { label: "History", accent: "#f59e0b", openTdb: 23 },
  ghana: { label: "Ghana", accent: "#22c55e" },
};

const ghanaBank = [
  ["easy", "What is the capital city of Ghana?", ["Accra", "Kumasi", "Tamale", "Cape Coast"], "Accra", "Ghana High Commission, Ghana at a Glance", "https://london.mfa.gov.gh/ghana-at-a-glance"],
  ["easy", "On what date is Ghana's Independence Day observed?", ["6 March", "1 July", "25 May", "21 September"], "6 March", "Ghana High Commission, Ghana at a Glance", "https://london.mfa.gov.gh/ghana-at-a-glance"],
  ["medium", "What is Ghana's official currency?", ["Ghana cedi", "West African franc", "Naira", "Dalasi"], "Ghana cedi", "Ghana High Commission, Ghana at a Glance", "https://london.mfa.gov.gh/ghana-at-a-glance"],
  ["medium", "Which country borders Ghana to the east?", ["Togo", "Benin", "Burkina Faso", "Cote d'Ivoire"], "Togo", "Encyclopaedia Britannica, Ghana", "https://www.britannica.com/place/Ghana"],
  ["hard", "Which major Ghanaian lake was formed after construction of the Akosombo Dam?", ["Lake Volta", "Lake Bosumtwi", "Lake Tana", "Lake Kivu"], "Lake Volta", "Encyclopaedia Britannica, Ghana", "https://www.britannica.com/place/Ghana"],
  ["hard", "Which Ghanaian leader became the country's first prime minister and president?", ["Kwame Nkrumah", "J. B. Danquah", "Kofi Annan", "Jerry Rawlings"], "Kwame Nkrumah", "Encyclopaedia Britannica, Kwame Nkrumah", "https://www.britannica.com/biography/Kwame-Nkrumah"],
].map(([difficulty, question, answers, correct, source, sourceUrl], index) => ({
  id: `ghana-${index + 1}`,
  category: "ghana",
  difficulty,
  question,
  answers,
  correct,
  source,
  sourceUrl,
}));

const fallbackQuestions = [
  {
    id: "fallback-general-1",
    category: "general",
    difficulty: "easy",
    question: "How many days are there in a leap year?",
    answers: ["366", "365", "364", "367"],
    correct: "366",
    source: "Built-in fallback question",
    sourceUrl: "https://opentdb.com/",
  },
];

const events = new Map();
const timers = new Map();
const rateBuckets = new Map();
const eventIdPattern = /^[A-Z0-9-]{3,32}$/i;

if (pool) {
  pool.on("error", (error) => {
    console.error("Postgres pool error", error);
  });
}

function makeEvent(id) {
  return {
    id,
    title: "Table Rush Trivia",
    phase: "vote",
    categories,
    difficulty: "medium",
    duration: 15,
    questionCount: 10,
    questionNumber: 0,
    tableLimit: 40,
    question: null,
    questionQueue: [],
    questionStartedAt: null,
    pausedRemainingMs: null,
    askedQuestionIds: [],
    teams: [],
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeEventSettings(settings = {}) {
  return {
    title: cleanName(settings.title || "Table Rush Trivia") || "Table Rush Trivia",
    difficulty: ["easy", "medium", "hard"].includes(settings.difficulty) ? settings.difficulty : "medium",
    duration: clampNumber(settings.duration, 8, 45, 15),
    questionCount: clampNumber(settings.questionCount, 3, 30, 10),
    tableLimit: clampNumber(settings.tableLimit, 2, 100, 40),
  };
}

async function getEvent(id) {
  const persisted = hasDatabase ? await loadEvent(id, categories) : null;
  if (!persisted && events.has(id)) return events.get(id);
  const event = persisted ?? makeEvent(id);
  events.set(id, event);
  if (!persisted) await persistEvent(event);
  await recoverActiveTimer(id, event);
  return event;
}

async function persistEvent(event) {
  await saveEvent(event);
}

async function recoverActiveTimer(eventId, event) {
  if (event.phase !== "active" || !event.questionStartedAt || timers.has(eventId)) return;
  const remainingMs = event.duration * 1000 - (Date.now() - event.questionStartedAt);
  if (remainingMs <= 0) {
    event.phase = "closed";
    await persistEvent(event);
    return;
  }
  timers.set(eventId, setTimeout(() => {
    void (async () => {
      const latest = await getEvent(eventId);
      if (latest.phase !== "active") return;
      latest.phase = "closed";
      await persistEvent(latest);
      broadcastEvent(eventId, latest);
    })().catch((error) => console.error("recovered timer failed", error));
  }, remainingMs));
}

function countVotes(event) {
  const votes = Object.fromEntries(Object.keys(categories).map((key) => [key, 0]));
  for (const team of event.teams) {
    if (team.vote) votes[team.vote] += 1;
  }
  return votes;
}

function selectedFromVotes(votes) {
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}

function sanitizeEvent(event, includeCorrect = false) {
  const votes = countVotes(event);
  return {
    ...event,
    votes,
    selectedCategory: selectedFromVotes(votes),
    cachedQuestionCount: event.questionQueue?.length ?? 0,
    question: event.question
      ? {
          ...event.question,
          correct: includeCorrect || event.phase === "reveal" || event.phase === "finished" ? event.question.correct : undefined,
        }
      : null,
  };
}

function broadcastEvent(eventId, event) {
  io.to(eventId).emit("state", { state: sanitizeEvent(event, false), adminAuthed: false });
  io.to(`${eventId}:admins`).emit("state", { state: sanitizeEvent(event, true), adminAuthed: true });
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function decodeHtml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&eacute;", "e")
    .replaceAll("&uuml;", "u");
}

function questionFingerprint(question) {
  return `${question.source}:${question.question}`.toLowerCase();
}

async function fetchQuestion(category, difficulty, askedQuestionIds = []) {
  if (category === "ghana") {
    const pool = ghanaBank.filter((item) => item.difficulty === difficulty);
    const shuffled = shuffle(pool.length ? pool : ghanaBank);
    const selected = shuffled.find((item) => !askedQuestionIds.includes(questionFingerprint(item))) ?? shuffled[0];
    return { ...selected, id: `ghana-${Date.now()}` };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const categoryId = categories[category].openTdb;
      const response = await fetch(`https://opentdb.com/api.php?amount=1&category=${categoryId}&difficulty=${difficulty}&type=multiple`);
      const data = await response.json();
      const item = data.results?.[0];
      if (!item) throw new Error("No question returned");
      const correct = decodeHtml(item.correct_answer);
      const question = {
        id: `${category}-${Date.now()}-${attempt}`,
        category,
        difficulty,
        question: decodeHtml(item.question),
        answers: shuffle([correct, ...item.incorrect_answers.map(decodeHtml)]),
        correct,
        source: "Open Trivia Database",
        sourceUrl: "https://opentdb.com/",
      };
      if (!askedQuestionIds.includes(questionFingerprint(question)) || attempt === 4) return question;
    } catch {
      break;
    }
  }

  return { ...shuffle(fallbackQuestions)[0], id: `fallback-${Date.now()}` };
}

async function fillQuestionQueue(event, minimum = 1) {
  event.questionQueue = event.questionQueue ?? [];
  const selectedCategory = selectedFromVotes(countVotes(event));
  const target = Math.min(event.questionCount ?? 10, Math.max(minimum, event.questionQueue.length));
  const reservedIds = [...(event.askedQuestionIds ?? []), ...event.questionQueue.map(questionFingerprint)];

  while (event.questionQueue.length < target) {
    const question = await fetchQuestion(selectedCategory, event.difficulty, reservedIds);
    const fingerprint = questionFingerprint(question);
    reservedIds.push(fingerprint);
    event.questionQueue.push(question);
  }
}

async function getNextQuestion(event) {
  await fillQuestionQueue(event, 1);
  const question = event.questionQueue.shift();
  if (question) return question;
  return fetchQuestion(selectedFromVotes(countVotes(event)), event.difficulty, event.askedQuestionIds ?? []);
}

function clearEventTimer(eventId) {
  const timer = timers.get(eventId);
  if (timer) clearTimeout(timer);
  timers.delete(eventId);
}

function startQuestionTimer(eventId, remainingMs) {
  clearEventTimer(eventId);
  timers.set(eventId, setTimeout(() => {
    void (async () => {
      const latest = await getEvent(eventId);
      if (latest.phase !== "active") return;
      latest.phase = "closed";
      latest.pausedRemainingMs = null;
      await persistEvent(latest);
      broadcastEvent(eventId, latest);
    })().catch((error) => console.error("question timer failed", error));
  }, remainingMs));
}

function requireAdmin(socket, pin) {
  if (pin === hostPin || socket.data.adminAuthed) {
    socket.data.adminAuthed = true;
    return true;
  }
  return false;
}

function normalizeEventId(value) {
  const eventId = String(value || "demo").trim();
  return eventIdPattern.test(eventId) ? eventId : null;
}

function cleanName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function emitError(socket, code, message) {
  socket.emit("app_error", { code, message });
}

function allowAction(socket, action, limit = 8, windowMs = 10_000) {
  const key = `${socket.id}:${action}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) ?? [];
  const fresh = bucket.filter((timestamp) => now - timestamp < windowMs);
  if (fresh.length >= limit) return false;
  fresh.push(now);
  rateBuckets.set(key, fresh);
  return true;
}

function canUseEvent(socket, rawEventId) {
  const eventId = normalizeEventId(rawEventId);
  if (!eventId) {
    emitError(socket, "invalid_event", "That event link is not valid.");
    return null;
  }
  return eventId;
}

app.use(express.json());
app.set("trust proxy", 1);

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    persistence: hasDatabase ? "postgres" : "memory",
    uptime: Math.round(process.uptime()),
  });
});

app.get("/readyz", (_req, res) => {
  void (async () => {
    if (pool) await pool.query("SELECT 1");
    res.json({
      ok: true,
      persistence: hasDatabase ? "postgres" : "memory",
      websocketAdapter: hasDatabase ? "postgres" : "in-process",
    });
  })().catch((error) => {
    res.status(503).json({ ok: false, error: error.message });
  });
});

app.post("/api/events", (req, res) => {
  void (async () => {
    const eventId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const event = makeEvent(eventId);
    Object.assign(event, normalizeEventSettings(req.body));
    events.set(eventId, event);
    await persistEvent(event);
    res.json({ eventId });
  })().catch((error) => {
    console.error("Create event failed", error);
    res.status(500).json({ error: "Failed to create event" });
  });
});

io.on("connection", (socket) => {
  socket.on("join_event", ({ eventId = "demo", role, pin, teamId }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    socket.join(eventId);
    socket.data.eventId = eventId;
    socket.data.role = role;
    socket.data.adminAuthed = role === "admin" && requireAdmin(socket, pin);
    if (socket.data.adminAuthed) {
      socket.leave(eventId);
      socket.join(`${eventId}:admins`);
    }
    const event = await getEvent(eventId);
    if (role === "player" && teamId) {
      const team = event.teams.find((item) => item.id === teamId);
      if (team) {
        team.reconnects = (team.reconnects ?? 0) + 1;
        team.lastSeenAt = Date.now();
        await persistEvent(event);
        await logEvent(eventId, team.id, "player_reconnected", { reconnects: team.reconnects });
        broadcastEvent(eventId, event);
      }
    }
    socket.emit("state", { state: sanitizeEvent(event, socket.data.adminAuthed), adminAuthed: socket.data.adminAuthed });
    })().catch((error) => console.error("join_event failed", error));
  });

  socket.on("player_join_team", ({ eventId = "demo", name }) => {
    void (async () => {
    if (!allowAction(socket, "join_team", 3, 60_000)) return emitError(socket, "rate_limited", "Please wait before joining another table.");
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    const cleanTeamName = cleanName(name);
    if (cleanTeamName.length < 2) return emitError(socket, "invalid_name", "Enter a table name with at least two characters.");
    const event = await getEvent(eventId);
    if (event.phase !== "vote") return emitError(socket, "join_closed", "The host has already started the game.");
    if (event.teams.length >= (event.tableLimit ?? 40)) return emitError(socket, "table_limit", "This event has reached the table limit.");
    const team = {
      id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanTeamName,
      score: 0,
      violations: 0,
      reconnects: 0,
      lastSeenAt: Date.now(),
      disqualified: false,
    };
    event.teams.push(team);
    await persistEvent(event);
    await logEvent(eventId, team.id, "team_joined", { name: team.name });
    socket.emit("team_joined", { teamId: team.id });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("player_join_team failed", error));
  });

  socket.on("player_update_team", ({ eventId = "demo", teamId, name }) => {
    void (async () => {
    if (!allowAction(socket, "update_team", 10, 60_000)) return emitError(socket, "rate_limited", "Please wait before renaming again.");
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    const event = await getEvent(eventId);
    const team = event.teams.find((item) => item.id === teamId);
    const cleanTeamName = cleanName(name);
    if (team && cleanTeamName.length >= 2) team.name = cleanTeamName;
    await persistEvent(event);
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("player_update_team failed", error));
  });

  socket.on("player_vote", ({ eventId = "demo", teamId, category }) => {
    void (async () => {
    if (!allowAction(socket, "vote", 20, 60_000)) return emitError(socket, "rate_limited", "Please slow down your voting.");
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    const event = await getEvent(eventId);
    if (event.phase !== "vote" || !categories[category]) return;
    const team = event.teams.find((item) => item.id === teamId);
    if (team?.disqualified) return emitError(socket, "team_disqualified", "This table has been disqualified by the host.");
    if (team) team.vote = category;
    await persistEvent(event);
    if (team) await logEvent(eventId, team.id, "category_vote", { category });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("player_vote failed", error));
  });

  socket.on("player_answer", ({ eventId = "demo", teamId, answer }) => {
    void (async () => {
    if (!allowAction(socket, "answer", 6, 10_000)) return emitError(socket, "rate_limited", "Please wait before submitting again.");
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    const event = await getEvent(eventId);
    const team = event.teams.find((item) => item.id === teamId);
    if (!team || !event.question || event.phase !== "active" || team.answeredQuestionId === event.question.id) return;
    if (team.disqualified) return emitError(socket, "team_disqualified", "This table has been disqualified by the host.");
    if (!event.question.answers.includes(answer)) return emitError(socket, "invalid_answer", "That answer is not valid for this question.");
    const elapsed = Math.max(0, Date.now() - event.questionStartedAt);
    const speedFactor = Math.max(0, 1 - elapsed / (event.duration * 1000));
    const isCorrect = answer === event.question.correct;
    const points = isCorrect ? Math.round(500 + speedFactor * 500) : 0;
    team.score += points;
    team.answeredQuestionId = event.question.id;
    await saveSubmission({
      eventId,
      teamId: team.id,
      questionId: event.question.id,
      answer,
      isCorrect,
      points,
      elapsedMs: Math.round(elapsed),
    });
    await persistEvent(event);
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("player_answer failed", error));
  });

  socket.on("player_focus_loss", ({ eventId = "demo", teamId }) => {
    void (async () => {
    if (!allowAction(socket, "focus_loss", 10, 10_000)) return;
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    const event = await getEvent(eventId);
    const team = event.teams.find((item) => item.id === teamId);
    if (team?.disqualified) return;
    if (team) {
      team.violations += 1;
      team.lastViolationAt = Date.now();
      team.lastSeenAt = Date.now();
    }
    await persistEvent(event);
    if (team) await logEvent(eventId, team.id, "focus_loss", { phase: event.phase });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("player_focus_loss failed", error));
  });

  socket.on("admin_set_config", ({ eventId = "demo", pin, difficulty, duration }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    const event = await getEvent(eventId);
    if (["easy", "medium", "hard"].includes(difficulty)) event.difficulty = difficulty;
    if (Number.isFinite(duration)) event.duration = clampNumber(duration, 8, 45, event.duration);
    await persistEvent(event);
    await logEvent(eventId, "admin", "config_updated", { difficulty: event.difficulty, duration: event.duration });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_set_config failed", error));
  });

  socket.on("admin_update_event_setup", ({ eventId = "demo", pin, title, difficulty, duration, questionCount, tableLimit }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    const event = await getEvent(eventId);
    if (!["vote", "ready"].includes(event.phase)) return emitError(socket, "setup_locked", "Event setup can only change before questions start.");
    const settings = normalizeEventSettings({ title, difficulty, duration, questionCount, tableLimit });
    Object.assign(event, settings);
    event.questionQueue = [];
    await persistEvent(event);
    await logEvent(eventId, "admin", "event_setup_updated", settings);
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_update_event_setup failed", error));
  });

  socket.on("admin_start_question", async ({ eventId = "demo", pin }) => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    const event = await getEvent(eventId);
    clearEventTimer(eventId);
    if (event.phase === "finished") return;
    if ((event.questionNumber ?? 0) >= (event.questionCount ?? 10)) {
      event.phase = "finished";
      await persistEvent(event);
      broadcastEvent(eventId, event);
      return;
    }
    event.question = await getNextQuestion(event);
    event.askedQuestionIds = [...(event.askedQuestionIds ?? []), questionFingerprint(event.question)];
    event.questionStartedAt = Date.now();
    event.pausedRemainingMs = null;
    event.questionNumber = (event.questionNumber ?? 0) + 1;
    event.phase = "active";
    event.teams = event.teams.map((team) => ({ ...team, answeredQuestionId: undefined }));
    startQuestionTimer(eventId, event.duration * 1000);
    await persistEvent(event);
    void fillQuestionQueue(event, Math.min(3, event.questionCount ?? 10))
      .then(() => persistEvent(event))
      .catch((error) => console.error("question queue refill failed", error));
    await logEvent(eventId, "admin", "question_started", { questionId: event.question.id, category: event.question.category });
    broadcastEvent(eventId, event);
  });

  socket.on("admin_lock_voting", ({ eventId = "demo", pin }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    const event = await getEvent(eventId);
    if (event.phase !== "vote") return;
    event.phase = "ready";
    await fillQuestionQueue(event, Math.min(3, event.questionCount ?? 10));
    await persistEvent(event);
    await logEvent(eventId, "admin", "voting_locked", { selectedCategory: selectedFromVotes(countVotes(event)) });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_lock_voting failed", error));
  });

  socket.on("admin_pause_question", ({ eventId = "demo", pin }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    const event = await getEvent(eventId);
    if (event.phase !== "active" || !event.questionStartedAt) return;
    const elapsed = Date.now() - event.questionStartedAt;
    event.pausedRemainingMs = Math.max(0, event.duration * 1000 - elapsed);
    event.phase = "paused";
    clearEventTimer(eventId);
    await persistEvent(event);
    await logEvent(eventId, "admin", "question_paused", { remainingMs: event.pausedRemainingMs });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_pause_question failed", error));
  });

  socket.on("admin_resume_question", ({ eventId = "demo", pin }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    const event = await getEvent(eventId);
    if (event.phase !== "paused" || !event.question) return;
    const remainingMs = Math.max(0, event.pausedRemainingMs ?? event.duration * 1000);
    event.questionStartedAt = Date.now() - (event.duration * 1000 - remainingMs);
    event.pausedRemainingMs = null;
    event.phase = "active";
    startQuestionTimer(eventId, remainingMs);
    await persistEvent(event);
    await logEvent(eventId, "admin", "question_resumed", { remainingMs });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_resume_question failed", error));
  });

  socket.on("admin_close_question", ({ eventId = "demo", pin }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    clearEventTimer(eventId);
    const event = await getEvent(eventId);
    if (!["active", "paused"].includes(event.phase)) return;
    event.phase = "closed";
    event.pausedRemainingMs = null;
    await persistEvent(event);
    await logEvent(eventId, "admin", "question_closed", { questionId: event.question?.id });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_close_question failed", error));
  });

  socket.on("admin_finish", ({ eventId = "demo", pin }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    clearEventTimer(eventId);
    const event = await getEvent(eventId);
    event.phase = "finished";
    await persistEvent(event);
    await logEvent(eventId, "admin", "event_finished");
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_finish failed", error));
  });

  socket.on("admin_reveal", ({ eventId = "demo", pin }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    clearEventTimer(eventId);
    const event = await getEvent(eventId);
    event.phase = "reveal";
    await persistEvent(event);
    await logEvent(eventId, "admin", "answer_revealed", { questionId: event.question?.id });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_reveal failed", error));
  });

  socket.on("admin_adjust_score", ({ eventId = "demo", pin, teamId, delta }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    const event = await getEvent(eventId);
    const team = event.teams.find((item) => item.id === teamId);
    const adjustment = Number(delta);
    if (!team || !Number.isFinite(adjustment)) return;
    team.score = Math.max(0, team.score + Math.round(adjustment));
    await persistEvent(event);
    await logEvent(eventId, "admin", "score_adjusted", { teamId, delta: Math.round(adjustment), score: team.score });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_adjust_score failed", error));
  });

  socket.on("admin_set_team_status", ({ eventId = "demo", pin, teamId, disqualified }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    const event = await getEvent(eventId);
    const team = event.teams.find((item) => item.id === teamId);
    if (!team) return;
    team.disqualified = disqualified === true;
    await persistEvent(event);
    await logEvent(eventId, "admin", team.disqualified ? "team_disqualified" : "team_restored", { teamId });
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_set_team_status failed", error));
  });

  socket.on("admin_reset", ({ eventId = "demo", pin }) => {
    void (async () => {
    eventId = canUseEvent(socket, eventId);
    if (!eventId) return;
    if (!requireAdmin(socket, pin)) return;
    socket.join(`${eventId}:admins`);
    clearEventTimer(eventId);
    const event = await getEvent(eventId);
    event.phase = "vote";
    event.question = null;
    event.questionNumber = 0;
    event.questionQueue = [];
    event.questionStartedAt = null;
    event.pausedRemainingMs = null;
    event.askedQuestionIds = [];
    event.teams = event.teams.map((team) => ({
      ...team,
      vote: undefined,
      score: 0,
      answeredQuestionId: undefined,
      violations: 0,
      reconnects: 0,
      lastViolationAt: undefined,
      disqualified: false,
    }));
    await persistEvent(event);
    await logEvent(eventId, "admin", "event_reset");
    broadcastEvent(eventId, event);
    })().catch((error) => console.error("admin_reset failed", error));
  });
});

const distPath = join(__dirname, "..", "dist");
app.use(express.static(distPath));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(join(distPath, "index.html"));
});

async function start() {
  await initDb();
  if (pool) io.adapter(createAdapter(pool));
  if (process.env.NODE_ENV === "production" && hostPin === "2468") {
    console.warn("HOST_PIN is using the default value. Set a secure HOST_PIN before venue use.");
  }
  if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
    console.warn("ALLOWED_ORIGINS is not set. Socket.IO is accepting all origins.");
  }
  console.log(hasDatabase ? "Postgres persistence enabled" : "DATABASE_URL not set; using in-memory local state");
  httpServer.listen(port, () => {
    console.log(`Table Rush Trivia listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error("Server startup failed", error);
  process.exit(1);
});
