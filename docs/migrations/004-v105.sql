-- Reference copy; the executable source is src/main/database/schema.ts

CREATE TABLE voices(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, model_id TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE TABLE asset_folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,parent_id TEXT REFERENCES asset_folders(id));
CREATE UNIQUE INDEX idx_folder_siblings ON asset_folders(COALESCE(parent_id,''),name);
CREATE INDEX idx_assets_folder_fav ON assets(folder,kind,favorite DESC,created_at DESC);
CREATE INDEX idx_assets_fav ON assets(favorite DESC,created_at DESC);
CREATE INDEX idx_task_kind ON task_versions(COALESCE(json_extract(data,'$.type'),'video'),created_at DESC);
UPDATE task_versions SET data=json_set(data,'$.type','video','$.outputs',json(CASE WHEN json_extract(data,'$.outputPath') IS NULL THEN '[]' ELSE json_array(json_object('kind','video','mimeType','video/mp4','extension','mp4','localPath',json_extract(data,'$.outputPath'),'metadata',json('{}'))) END));
INSERT OR IGNORE INTO asset_folders SELECT DISTINCT folder,folder,NULL FROM assets WHERE folder<>'';
