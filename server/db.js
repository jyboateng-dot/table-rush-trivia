import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
const sslEnabled = databaseUrl && process.env.PGSSLMODE !== "disable";

export const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    })
  : null;

export const hasDatabase = Boolean(pool);

export async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trivia_events (
      id text PRIMARY KEY,
      title text NOT NULL,
      admin_key text,
      phase text NOT NULL,
      difficulty text NOT NULL,
      duration integer NOT NULL,
      question_count integer NOT NULL DEFAULT 10,
      question_number integer NOT NULL DEFAULT 0,
      table_limit integer NOT NULL DEFAULT 40,
      question jsonb,
      question_queue jsonb NOT NULL DEFAULT '[]'::jsonb,
      question_started_at bigint,
      paused_remaining_ms integer,
      asked_question_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      prize_label text NOT NULL DEFAULT 'Venue prize',
      winner_team_id text,
      finalized_at bigint,
      archived_at bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS admin_key text;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS asked_question_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS question_count integer NOT NULL DEFAULT 10;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS question_number integer NOT NULL DEFAULT 0;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS table_limit integer NOT NULL DEFAULT 40;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS question_queue jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS paused_remaining_ms integer;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS prize_label text NOT NULL DEFAULT 'Venue prize';
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS winner_team_id text;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS finalized_at bigint;
    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS archived_at bigint;

    CREATE TABLE IF NOT EXISTS trivia_teams (
      id text PRIMARY KEY,
      event_id text NOT NULL REFERENCES trivia_events(id) ON DELETE CASCADE,
      table_number integer,
      name text NOT NULL,
      vote text,
      score integer NOT NULL DEFAULT 0,
      answered_question_id text,
      last_answer text,
      last_answer_correct boolean,
      violations integer NOT NULL DEFAULT 0,
      reconnects integer NOT NULL DEFAULT 0,
      last_seen_at bigint,
      last_violation_at bigint,
      disqualified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE trivia_teams ADD COLUMN IF NOT EXISTS disqualified boolean NOT NULL DEFAULT false;
    ALTER TABLE trivia_teams ADD COLUMN IF NOT EXISTS table_number integer;
    ALTER TABLE trivia_teams ADD COLUMN IF NOT EXISTS last_answer text;
    ALTER TABLE trivia_teams ADD COLUMN IF NOT EXISTS last_answer_correct boolean;
    ALTER TABLE trivia_teams ADD COLUMN IF NOT EXISTS reconnects integer NOT NULL DEFAULT 0;
    ALTER TABLE trivia_teams ADD COLUMN IF NOT EXISTS last_seen_at bigint;
    ALTER TABLE trivia_teams ADD COLUMN IF NOT EXISTS last_violation_at bigint;

    CREATE INDEX IF NOT EXISTS trivia_teams_event_id_idx ON trivia_teams(event_id);

    CREATE TABLE IF NOT EXISTS trivia_submissions (
      id bigserial PRIMARY KEY,
      event_id text NOT NULL REFERENCES trivia_events(id) ON DELETE CASCADE,
      team_id text NOT NULL REFERENCES trivia_teams(id) ON DELETE CASCADE,
      question_id text NOT NULL,
      answer text NOT NULL,
      is_correct boolean NOT NULL,
      points integer NOT NULL,
      elapsed_ms integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (event_id, team_id, question_id)
    );

    CREATE INDEX IF NOT EXISTS trivia_submissions_event_id_idx ON trivia_submissions(event_id);

    CREATE TABLE IF NOT EXISTS trivia_event_logs (
      id bigserial PRIMARY KEY,
      event_id text NOT NULL REFERENCES trivia_events(id) ON DELETE CASCADE,
      actor text NOT NULL,
      action text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS trivia_event_logs_event_id_idx ON trivia_event_logs(event_id);

    CREATE TABLE IF NOT EXISTS socket_io_attachments (
      id bigserial UNIQUE,
      created_at timestamptz DEFAULT now(),
      payload bytea
    );
  `);
}

export async function loadEvent(eventId, categories) {
  if (!pool) return null;

  const eventResult = await pool.query("SELECT * FROM trivia_events WHERE id = $1", [eventId]);
  if (eventResult.rowCount === 0) return null;

  const eventRow = eventResult.rows[0];
  const teamResult = await pool.query(
    `SELECT id, table_number, name, vote, score, answered_question_id, last_answer, last_answer_correct, violations, reconnects, last_seen_at, last_violation_at, disqualified
     FROM trivia_teams
     WHERE event_id = $1
     ORDER BY created_at ASC`,
    [eventId]
  );

  return {
    id: eventRow.id,
    title: eventRow.title,
    adminKey: eventRow.admin_key ?? undefined,
    phase: eventRow.phase,
    categories,
    difficulty: eventRow.difficulty,
    duration: eventRow.duration,
    questionCount: eventRow.question_count,
    questionNumber: eventRow.question_number,
    tableLimit: eventRow.table_limit,
    question: eventRow.question,
    questionQueue: Array.isArray(eventRow.question_queue) ? eventRow.question_queue : [],
    questionStartedAt: eventRow.question_started_at ? Number(eventRow.question_started_at) : null,
    pausedRemainingMs: eventRow.paused_remaining_ms ?? null,
    askedQuestionIds: Array.isArray(eventRow.asked_question_ids) ? eventRow.asked_question_ids : [],
    prizeLabel: eventRow.prize_label,
    winnerTeamId: eventRow.winner_team_id ?? undefined,
    finalizedAt: eventRow.finalized_at ? Number(eventRow.finalized_at) : undefined,
    archivedAt: eventRow.archived_at ? Number(eventRow.archived_at) : undefined,
    teams: teamResult.rows.map((row, index) => ({
      id: row.id,
      tableNumber: row.table_number ?? index + 1,
      name: row.name,
      vote: row.vote ?? undefined,
      score: row.score,
      answeredQuestionId: row.answered_question_id ?? undefined,
      lastAnswer: row.last_answer ?? undefined,
      lastAnswerCorrect: row.last_answer_correct ?? undefined,
      violations: row.violations,
      reconnects: row.reconnects,
      lastSeenAt: row.last_seen_at ? Number(row.last_seen_at) : undefined,
      lastViolationAt: row.last_violation_at ? Number(row.last_violation_at) : undefined,
      disqualified: row.disqualified,
    })),
  };
}

export async function saveEvent(event) {
  if (!pool) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO trivia_events (
         id, title, admin_key, phase, difficulty, duration, question_count, question_number, table_limit,
         question, question_queue, question_started_at, paused_remaining_ms, asked_question_ids,
         prize_label, winner_team_id, finalized_at, archived_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         admin_key = COALESCE(trivia_events.admin_key, EXCLUDED.admin_key),
         phase = EXCLUDED.phase,
         difficulty = EXCLUDED.difficulty,
         duration = EXCLUDED.duration,
         question_count = EXCLUDED.question_count,
         question_number = EXCLUDED.question_number,
         table_limit = EXCLUDED.table_limit,
         question = EXCLUDED.question,
         question_queue = EXCLUDED.question_queue,
         question_started_at = EXCLUDED.question_started_at,
         paused_remaining_ms = EXCLUDED.paused_remaining_ms,
         asked_question_ids = EXCLUDED.asked_question_ids,
         prize_label = EXCLUDED.prize_label,
         winner_team_id = EXCLUDED.winner_team_id,
         finalized_at = EXCLUDED.finalized_at,
         archived_at = EXCLUDED.archived_at,
         updated_at = now()`,
      [
        event.id,
        event.title,
        event.adminKey ?? null,
        event.phase,
        event.difficulty,
        event.duration,
        event.questionCount ?? 10,
        event.questionNumber ?? 0,
        event.tableLimit ?? 40,
        event.question ? JSON.stringify(event.question) : null,
        JSON.stringify(event.questionQueue ?? []),
        event.questionStartedAt,
        event.pausedRemainingMs ?? null,
        JSON.stringify(event.askedQuestionIds ?? []),
        event.prizeLabel ?? "Venue prize",
        event.winnerTeamId ?? null,
        event.finalizedAt ?? null,
        event.archivedAt ?? null,
      ]
    );

    for (const team of event.teams) {
      await client.query(
        `INSERT INTO trivia_teams (
           id, event_id, table_number, name, vote, score, answered_question_id,
           last_answer, last_answer_correct, violations, reconnects, last_seen_at, last_violation_at, disqualified, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
         ON CONFLICT (id) DO UPDATE SET
           table_number = EXCLUDED.table_number,
           name = EXCLUDED.name,
           vote = EXCLUDED.vote,
           score = EXCLUDED.score,
           answered_question_id = EXCLUDED.answered_question_id,
           last_answer = EXCLUDED.last_answer,
           last_answer_correct = EXCLUDED.last_answer_correct,
           violations = EXCLUDED.violations,
           reconnects = EXCLUDED.reconnects,
           last_seen_at = EXCLUDED.last_seen_at,
           last_violation_at = EXCLUDED.last_violation_at,
           disqualified = EXCLUDED.disqualified,
           updated_at = now()`,
        [
          team.id,
          event.id,
          team.tableNumber ?? null,
          team.name,
          team.vote ?? null,
          team.score,
          team.answeredQuestionId ?? null,
          team.lastAnswer ?? null,
          team.lastAnswerCorrect ?? null,
          team.violations,
          team.reconnects ?? 0,
          team.lastSeenAt ?? null,
          team.lastViolationAt ?? null,
          team.disqualified === true,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveSubmission(submission) {
  if (!pool) return;

  await pool.query(
    `INSERT INTO trivia_submissions (event_id, team_id, question_id, answer, is_correct, points, elapsed_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id, team_id, question_id) DO NOTHING`,
    [
      submission.eventId,
      submission.teamId,
      submission.questionId,
      submission.answer,
      submission.isCorrect,
      submission.points,
      submission.elapsedMs,
    ]
  );
}

export async function logEvent(eventId, actor, action, details = {}) {
  if (!pool) return;

  await pool.query(
    `INSERT INTO trivia_event_logs (event_id, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [eventId, actor, action, JSON.stringify(details)]
  );
}
