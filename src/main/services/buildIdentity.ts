import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brand } from '../../shared/brand.ts';
import type { BuildIdentity } from '../../shared/types.ts';

export function buildIdentity(programPath: string, dataRoot: string): BuildIdentity {
  const file = join(programPath, 'dist', 'build-identity.json');
  const build = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (build.version && build.version !== brand.version) {
    throw new Error('构建身份与程序版本不一致，请重新构建正式软件。');
  }
  return {
    version: brand.version,
    gitCommit: build.gitCommit ?? 'unbuilt',
    gitBranch: build.gitBranch ?? 'unbuilt',
    buildId: build.buildId ?? 'unbuilt',
    buildTime: build.buildTime ?? '',
    sourceTreeHash: build.sourceTreeHash ?? '',
    sourceDirty: build.sourceDirty ?? true,
    dataRoot,
    executablePath: process.execPath,
  };
}
