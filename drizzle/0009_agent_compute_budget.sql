CREATE TABLE compute_budget_grants (
 id TEXT PRIMARY KEY NOT NULL,
 agent_id TEXT NOT NULL,
 usd_micros INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX compute_budget_grants_agent_idx ON compute_budget_grants(agent_id,created_at);
CREATE INDEX events_agent_time_idx ON events(agent_id,created_at);
CREATE INDEX model_calls_agent_time_idx ON model_calls(agent_id,created_at);
CREATE INDEX execution_jobs_agent_status_idx ON execution_jobs(agent_id,status);
