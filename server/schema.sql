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

ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS asked_question_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trivia_events ADD COLUMN IF NOT EXISTS admin_key text;
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
