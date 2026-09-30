export const migrations = [
  {
    version: 1,
    backup: true,
    sql: `
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
`,
  },
  {
    version: 2,
    backup: true,
    sql: `
CREATE TABLE drafts(id TEXT PRIMARY KEY,name TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
INSERT INTO drafts SELECT 'legacy-draft',COALESCE(json_extract(data,'$.name'),''),strftime('%Y-%m-%dT%H:%M:%fZ','now'),json_set(data,'$.draftId','legacy-draft') FROM settings WHERE key='draft' AND json_type(data)='object';
UPDATE settings SET data=json_set(data,'$.draftId','legacy-draft') WHERE key='draft' AND json_type(data)='object';
CREATE TABLE pricing_configs(model_id TEXT PRIMARY KEY REFERENCES models(id),data TEXT NOT NULL);
INSERT INTO pricing_configs SELECT id,json_extract(data,'$.price') FROM models;
CREATE TABLE billing_records(version_id TEXT PRIMARY KEY REFERENCES task_versions(id),account_id TEXT NOT NULL,provider_id TEXT NOT NULL,model_id TEXT NOT NULL,created_at TEXT NOT NULL,submitted_at TEXT,status TEXT NOT NULL,currency TEXT NOT NULL,estimated REAL,usage_estimated REAL,actual REAL,actual_source TEXT,data TEXT NOT NULL);
INSERT INTO billing_records SELECT v.id,v.account_id,v.provider_id,v.model_id,v.created_at,json_extract(v.data,'$.submittedAt'),v.status,COALESCE(json_extract(s.data,'$.estimatedCost.currency'),'CNY'),json_extract(s.data,'$.estimatedCost.amount'),CASE WHEN json_extract(v.data,'$.cost.kind')='estimate' THEN json_extract(v.data,'$.cost.amount') END,CASE WHEN json_extract(v.data,'$.cost.kind')='actual' THEN json_extract(v.data,'$.cost.amount') END,NULL,'{}' FROM task_versions v JOIN task_snapshots s ON s.version_id=v.id;
CREATE INDEX idx_billing_time ON billing_records(submitted_at,account_id,provider_id);
CREATE INDEX idx_draft_time ON drafts(updated_at DESC);
`,
  },
  {
    version: 3,
    backup: true,
    sql: `
CREATE TABLE billing_manual(version_id TEXT PRIMARY KEY REFERENCES task_versions(id), amount REAL NOT NULL CHECK(amount>=0), note TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE billing_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,version_id TEXT NOT NULL REFERENCES task_versions(id),created_at TEXT NOT NULL,before_data TEXT,after_data TEXT);
CREATE INDEX idx_billing_audit_task ON billing_audit(version_id,id);
`,
  },
  {
    version: 4,
    backup: true,
    sql: `
CREATE TABLE voices(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, model_id TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE TABLE asset_folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,parent_id TEXT REFERENCES asset_folders(id));
CREATE UNIQUE INDEX idx_folder_siblings ON asset_folders(COALESCE(parent_id,''),name);
CREATE INDEX idx_assets_folder_fav ON assets(folder,kind,favorite DESC,created_at DESC);
CREATE INDEX idx_assets_fav ON assets(favorite DESC,created_at DESC);
CREATE INDEX idx_task_kind ON task_versions(COALESCE(json_extract(data,'$.type'),'video'),created_at DESC);
UPDATE task_versions SET data=json_set(data,'$.type','video','$.outputs',json(CASE WHEN json_extract(data,'$.outputPath') IS NULL THEN '[]' ELSE json_array(json_object('kind','video','mimeType','video/mp4','extension','mp4','localPath',json_extract(data,'$.outputPath'),'metadata',json('{}'))) END));
INSERT OR IGNORE INTO asset_folders SELECT DISTINCT folder,folder,NULL FROM assets WHERE folder<>'';
`,
  },
  {
    version: 5,
    backup: true,
    sql: `
CREATE TABLE cloud_uploads(task_id TEXT NOT NULL,asset_id TEXT NOT NULL,provider_id TEXT NOT NULL,remote_ref TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT,data TEXT NOT NULL,PRIMARY KEY(task_id,asset_id));
CREATE INDEX idx_cloud_upload_asset ON cloud_uploads(asset_id,provider_id,created_at DESC);
`,
  },
  {
    version: 6,
    backup: false,
    sql: `
CREATE TABLE cosy_voices(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, model_id TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, pin_order INTEGER, is_default INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE UNIQUE INDEX idx_cosy_default_voice ON cosy_voices(is_default) WHERE is_default=1;
CREATE INDEX idx_cosy_voice_order ON cosy_voices(pinned DESC,pin_order);
CREATE TABLE cosy_presets(id TEXT PRIMARY KEY, position INTEGER NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, builtin INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE UNIQUE INDEX idx_cosy_preset_position ON cosy_presets(position);
CREATE TABLE cosy_instruction_history(id TEXT PRIMARY KEY, content TEXT NOT NULL UNIQUE, favorite INTEGER NOT NULL DEFAULT 0, last_used_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX idx_cosy_history_time ON cosy_instruction_history(last_used_at DESC);
CREATE TABLE cosy_batches(id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX idx_cosy_batch_time ON cosy_batches(created_at DESC);
CREATE TABLE cosy_jobs(id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES cosy_batches(id) ON DELETE CASCADE, task_id TEXT NOT NULL UNIQUE REFERENCES task_versions(id), config_index INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(batch_id,config_index));
CREATE INDEX idx_cosy_job_batch ON cosy_jobs(batch_id,config_index);
DELETE FROM pricing_configs WHERE model_id IN (SELECT id FROM models WHERE json_extract(data,'$.type')='audio');
DELETE FROM models WHERE json_extract(data,'$.type')='audio';
DELETE FROM settings WHERE key IN ('audioDraft','adoptedAudio','audio-pending-reset','v108-audio-models') OR key LIKE 'audio-request:%';
`,
  },
  {
    version: 7,
    backup: true,
    sql: `
DROP INDEX IF EXISTS idx_cosy_default_voice;
CREATE UNIQUE INDEX idx_cosy_default_voice_account ON cosy_voices(account_id) WHERE is_default=1;
`,
  },
];
