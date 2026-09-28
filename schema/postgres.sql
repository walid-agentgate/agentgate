-- AgentGate production Postgres schema
-- Runtime database sessions should set: select set_config('agentgate.tenant_id', '<tenant>', true);
create table if not exists agentgate_records (
  id text primary key,
  tenant_id text not null,
  kind text not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists agentgate_records_tenant_kind_idx on agentgate_records (tenant_id, kind);
alter table agentgate_records enable row level security;
alter table agentgate_records force row level security;
drop policy if exists agentgate_tenant_isolation on agentgate_records;
create policy agentgate_tenant_isolation on agentgate_records
  using (tenant_id = current_setting('agentgate.tenant_id', true))
  with check (tenant_id = current_setting('agentgate.tenant_id', true));
