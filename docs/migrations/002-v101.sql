CREATE TABLE drafts(id TEXT PRIMARY KEY,name TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
INSERT INTO drafts SELECT 'legacy-draft',COALESCE(json_extract(data,'$.name'),''),strftime('%Y-%m-%dT%H:%M:%fZ','now'),json_set(data,'$.draftId','legacy-draft') FROM settings WHERE key='draft' AND json_type(data)='object';
UPDATE settings SET data=json_set(data,'$.draftId','legacy-draft') WHERE key='draft' AND json_type(data)='object';
CREATE TABLE pricing_configs(model_id TEXT PRIMARY KEY REFERENCES models(id),data TEXT NOT NULL);
INSERT INTO pricing_configs SELECT id,json_extract(data,'$.price') FROM models;
CREATE TABLE billing_records(version_id TEXT PRIMARY KEY REFERENCES task_versions(id),account_id TEXT NOT NULL,provider_id TEXT NOT NULL,model_id TEXT NOT NULL,created_at TEXT NOT NULL,submitted_at TEXT,status TEXT NOT NULL,currency TEXT NOT NULL,estimated REAL,usage_estimated REAL,actual REAL,actual_source TEXT,data TEXT NOT NULL);
INSERT INTO billing_records SELECT v.id,v.account_id,v.provider_id,v.model_id,v.created_at,json_extract(v.data,'$.submittedAt'),v.status,COALESCE(json_extract(s.data,'$.estimatedCost.currency'),'CNY'),json_extract(s.data,'$.estimatedCost.amount'),CASE WHEN json_extract(v.data,'$.cost.kind')='estimate' THEN json_extract(v.data,'$.cost.amount') END,CASE WHEN json_extract(v.data,'$.cost.kind')='actual' THEN json_extract(v.data,'$.cost.amount') END,NULL,'{}' FROM task_versions v JOIN task_snapshots s ON s.version_id=v.id;
CREATE INDEX idx_billing_time ON billing_records(submitted_at,account_id,provider_id);
CREATE INDEX idx_draft_time ON drafts(updated_at DESC);
