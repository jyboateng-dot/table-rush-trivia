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
