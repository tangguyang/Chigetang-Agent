
CREATE TABLE providers(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE models(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE credentials(id TEXT PRIMARY KEY, data TEXT NOT NULL, encrypted BLOB NOT NULL);
CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE assets(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL, project_id TEXT, folder TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE asset_tags(asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(asset_id,tag));
CREATE TABLE project_assets(project_id TEXT REFERENCES projects(id),asset_id TEXT REFERENCES assets(id),PRIMARY KEY(project_id,asset_id));
CREATE TABLE prompts(id TEXT PRIMARY KEY,name TEXT NOT NULL,content TEXT NOT NULL,folder TEXT NOT NULL,project_id TEXT,favorite INTEGER NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE prompt_versions(id TEXT PRIMARY KEY,prompt_id TEXT REFERENCES prompts(id),version INTEGER NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(prompt_id,version));
CREATE TABLE tasks(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE task_versions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),parent_task_id TEXT,parent_version_id TEXT REFERENCES task_versions(id),version INTEGER NOT NULL,status TEXT NOT NULL,provider_id TEXT NOT NULL,model_id TEXT NOT NULL,account_id TEXT NOT NULL,project_id TEXT,created_at TEXT NOT NULL,deleted_at TEXT,data TEXT NOT NULL,UNIQUE(task_id,version));
CREATE TABLE task_snapshots(version_id TEXT PRIMARY KEY REFERENCES task_versions(id),data TEXT NOT NULL);
CREATE TRIGGER immutable_snapshot BEFORE UPDATE ON task_snapshots BEGIN SELECT RAISE(ABORT,'Task snapshots are immutable'); END;
CREATE TABLE task_assets(version_id TEXT REFERENCES task_versions(id),asset_id TEXT REFERENCES assets(id),role TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(version_id,position));
CREATE TABLE task_results(version_id TEXT PRIMARY KEY REFERENCES task_versions(id),data TEXT NOT NULL);
CREATE TABLE usage_records(version_id TEXT PRIMARY KEY REFERENCES task_versions(id),currency TEXT NOT NULL,amount REAL,kind TEXT NOT NULL);
CREATE TABLE price_snapshots(version_id TEXT PRIMARY KEY REFERENCES task_versions(id),data TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE downloads(version_id TEXT PRIMARY KEY REFERENCES task_versions(id),data TEXT NOT NULL);
CREATE TABLE logs_metadata(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE INDEX idx_tasks_state ON task_versions(status,deleted_at,created_at);
CREATE INDEX idx_tasks_group ON task_versions(task_id,version);
CREATE INDEX idx_tasks_filter ON task_versions(provider_id,model_id,account_id,project_id,created_at);
CREATE INDEX idx_assets_type ON assets(kind,project_id,created_at);
CREATE INDEX idx_assets_name ON assets(name);
CREATE INDEX idx_prompt_time ON prompts(updated_at);

PRAGMA user_version=1;
