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
      phase text NOT NULL,
      difficulty text NOT NULL,
      duration integer NOT NULL,
      question jsonb,
      question_started_at bigint,
      asked_question_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS asked_question_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

    CREATE TABLE IF NOT EXISTS trivia_teams (
      id text PRIMARY KEY,
      event_id text NOT NULL REFERENCES trivia_events(id) ON DELETE CASCADE,
      name text NOT NULL,
      vote text,
      score integer NOT NULL DEFAULT 0,
      answered_question_id text,
      violations integer NOT NULL DEFAULT 0,
      disqualified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE trivia_teams ADD COLUMN IF NOT EXISTS disqualified boolean NOT NULL DEFAULT false;

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
    `SELECT id, name, vote, score, answered_question_id, violations, disqualified
     FROM trivia_teams
     WHERE event_id = $1
     ORDER BY created_at ASC`,
    [eventId]
  );

  return {
    id: eventRow.id,
    title: eventRow.title,
    phase: eventRow.phase,
    categories,
    difficulty: eventRow.difficulty,
    duration: eventRow.duration,
    question: eventRow.question,
    questionStartedAt: eventRow.question_started_at ? Number(eventRow.question_started_at) : null,
    askedQuestionIds: Array.isArray(eventRow.asked_question_ids) ? eventRow.asked_question_ids : [],
    teams: teamResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      vote: row.vote ?? undefined,
      score: row.score,
      answeredQuestionId: row.answered_question_id ?? undefined,
      violations: row.violations,
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
      `INSERT INTO trivia_events (id, title, phase, difficulty, duration, question, question_started_at, asked_question_ids, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         phase = EXCLUDED.phase,
         difficulty = EXCLUDED.difficulty,
         duration = EXCLUDED.duration,
         question = EXCLUDED.question,
         question_started_at = EXCLUDED.question_started_at,
         asked_question_ids = EXCLUDED.asked_question_ids,
         updated_at = now()`,
      [
        event.id,
        event.title,
        event.phase,
        event.difficulty,
        event.duration,
        event.question ? JSON.stringify(event.question) : null,
        event.questionStartedAt,
        JSON.stringify(event.askedQuestionIds ?? []),
      ]
    );

    for (const team of event.teams) {
      await client.query(
        `INSERT INTO trivia_teams (id, event_id, name, vote, score, answered_question_id, violations, disqualified, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           vote = EXCLUDED.vote,
           score = EXCLUDED.score,
           answered_question_id = EXCLUDED.answered_question_id,
           violations = EXCLUDED.violations,
           disqualified = EXCLUDED.disqualified,
           updated_at = now()`,
        [
          team.id,
          event.id,
          team.name,
          team.vote ?? null,
          team.score,
          team.answeredQuestionId ?? null,
          team.violations,
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
