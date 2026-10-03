import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildIdentity } from '../src/main/services/buildIdentity.ts';
import { WINDOWS_DATA_ROOT } from '../src/main/services/storage.ts';
import { brand } from '../src/shared/brand.ts';

test('v145 GUI and runtime identity use packaged metadata and actual process paths', () => {
  const root=mkdtempSync(join(tmpdir(),'ctg-v145-identity-'));
  mkdirSync(join(root,'dist'));
  const metadata={version:brand.version,gitCommit:'test-commit',gitBranch:'dev',buildId:'test-build',buildTime:'2026-10-03T00:00:00Z',sourceTreeHash:'test-hash',sourceDirty:false};
  writeFileSync(join(root,'dist/build-identity.json'),JSON.stringify(metadata));
  assert.deepEqual(buildIdentity(root,WINDOWS_DATA_ROOT),{...metadata,dataRoot:WINDOWS_DATA_ROOT,executablePath:process.execPath});
  writeFileSync(join(root,'dist/build-identity.json'),JSON.stringify({...metadata,version:'1.2.9'}));
  assert.throws(()=>buildIdentity(root,WINDOWS_DATA_ROOT),/构建身份与程序版本不一致/);
  assert.equal(WINDOWS_DATA_ROOT,'D:\\吃个糖Agent软件数据库');
});
