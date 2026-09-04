create table if not exists workspaces (
  id text primary key,
  name text not null,
  canonical_path text not null unique,
  updated_at text not null
);

create table if not exists sessions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  title text not null,
  created_at text not null,
  updated_at text not null
);
create index if not exists sessions_workspace_updated on sessions(workspace_id, updated_at desc);

create table if not exists messages (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content_json text not null,
  model_switch_json text,
  created_at text not null
);
create index if not exists messages_session_created on messages(session_id, created_at);

create table if not exists tasks (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  status text not null check (status in (
    'preparing', 'running', 'waiting-approval', 'completed', 'partial-complete',
    'stopped', 'failed', 'undone', 'undo-conflict'
  )),
  created_at text not null,
  updated_at text not null
);
create index if not exists tasks_session_created on tasks(session_id, created_at);

create table if not exists tool_activities (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  kind text not null,
  payload_json text not null,
  created_at text not null
);

create table if not exists file_changes (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  relative_path text not null,
  kind text not null check (kind in ('created', 'modified', 'renamed', 'deleted')),
  metadata_json text not null
);

create table if not exists provider_configs (
  id text primary key,
  name text not null,
  provider_type text not null,
  endpoint text,
  model text not null,
  credential_ref text,
  settings_json text not null,
  created_at text not null,
  updated_at text not null
);
