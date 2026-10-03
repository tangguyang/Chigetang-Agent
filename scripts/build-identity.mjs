import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
const pkg = JSON.parse(readFileSync('package.json','utf8'));
const h = createHash('sha256');
const paths=git('ls-files','-z','--cached','--others','--exclude-standard','--','src','scripts','package.json','package-lock.json','VERSION').split('\0').filter(Boolean).sort();
for(const path of paths) {h.update(path);h.update(readFileSync(path,'utf8').replaceAll('\r\n','\n'));}
const sourceTreeHash=h.digest('hex'),gitCommit=git('rev-parse','HEAD'),gitBranch=git('branch','--show-current');
const buildTime=new Date().toISOString(),sourceDirty=Boolean(git('status','--porcelain','--untracked-files=normal','--','src','scripts','package.json','package-lock.json','VERSION'));
const identity={version:pkg.version,gitCommit,gitBranch,sourceTreeHash,sourceDirty,buildTime,buildId:`${pkg.version}-${gitCommit.slice(0,12)}-${sourceTreeHash.slice(0,12)}-${Date.now()}`};
mkdirSync('dist',{recursive:true});writeFileSync('dist/build-identity.json',JSON.stringify(identity,null,2)+'\n');
console.log('Build identity:',identity.buildId);
