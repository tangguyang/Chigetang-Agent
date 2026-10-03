# 脚本索引

当前打包统一指向package-agent-control-ipc.mjs。旧源码ZIP/多份交付脚本仅历史归档，禁止执行。

发布准备：`npm run prepare:runtime` 下载固定运行时，`npm run verify:runtime` 只校验；`npm run test:release` 验证缺失/损坏拒绝边界；`npm run verify:package` 验证最终包。旧 prepare-sherpa-runtime.mjs 转交统一准备脚本。详见 [可复现发布](REPRODUCIBLE_RELEASE.md)。

|脚本|类别|入口|
|---|---|---|
| accept-v130-package.mjs | build | 间接引用或人工工具 |
| agent-control-gw002-offline.ts | maintenance/manual | 间接引用或人工工具 |
| archive/make-delivery.py | archive (历史，禁止用于当前交付) | 间接引用或人工工具 |
| archive/package-source.py | archive (历史，禁止用于当前交付) | 间接引用或人工工具 |
| archive/package-win.mjs | archive (历史，禁止用于当前交付) | 间接引用或人工工具 |
| archive-capability-package.py | build | 间接引用或人工工具 |
| build-cli.mjs | build | pretest, build:cli |
| build-icon.mjs | build | build |
| build-installer.py | build | 间接引用或人工工具 |
| build-native-pipe.mjs | build | 间接引用或人工工具 |
| build.mjs | build | build, test:bundle, test:capability:runtime |
| bundle-smoke.ts | maintenance/manual | 间接引用或人工工具 |
| check-real-speech-docs.ts | maintenance/manual | build |
| chigetang.mjs | maintenance/manual | speech |
| cleanup-v142.py | maintenance/manual | 间接引用或人工工具 |
| create-shortcut.ps1 | maintenance/manual | 间接引用或人工工具 |
| dev.mjs | dev | dev |
| export-capability-docs.mjs | maintenance/manual | 间接引用或人工工具 |
| installer-delete-files.nsh | maintenance/manual | 间接引用或人工工具 |
| installer.nsi | maintenance/manual | 间接引用或人工工具 |
| maintenance-v142.py | maintenance/manual | 间接引用或人工工具 |
| make-delivery.py | build | 间接引用或人工工具 |
| organize-imports.mjs | maintenance/manual | 间接引用或人工工具 |
| package-agent-control-ipc.mjs | build | pack:agent-control:win, pack:capability:win |
| package-repair2.py | build | 间接引用或人工工具 |
| package-win.mjs | build | pack:win |
| patch-pe-version.mjs | maintenance/manual | 间接引用或人工工具 |
| prepare-sherpa-runtime.mjs | maintenance/manual | 间接引用或人工工具 |
| prepare-test-resources.mjs | test | pretest |
| prepare-v142-acceptance.py | maintenance/manual | 间接引用或人工工具 |
| rebase-win-runtime.mjs | maintenance/manual | 间接引用或人工工具 |
| report-v142.py | maintenance/manual | 间接引用或人工工具 |
| restore-repair2-runtime.mjs | maintenance/manual | 间接引用或人工工具 |
| run-cosyvoice-spike.mjs | test | spike:dry-run, spike:preflight |
| run-real-speech-ui.mjs | test | test:repair2, test:real-speech, test:real-speech:v2 |
| run-repair-ui.mjs | test | test:repair2, test:repair |
| run-repair2-electron.mjs | test | test:repair2:windows |
| run-repair2-workflow-ui.mjs | test | test:repair2 |
| run-transcription-ui.mjs | test | test:transcription:ui |
| run-ui-tests.mjs | test | test:ui |
| run-v142-ui.mjs | test | test:v142:ui |
| run-v2-documents-native.mjs | test | test:real-speech:v2 |
| test-agent-control-portable.ts | test | test:agent-control:portable |
| test-browser.ts | test | test:browser |
| test-bundle.mjs | test | test:bundle |
| test-capability-runtime.mjs | test | test:capability:runtime |
| test-local-pdf.ts | test | test:pdf |
| test-real-speech-ui.tsx | test | 间接引用或人工工具 |
| test-repair-ui.tsx | test | 间接引用或人工工具 |
| test-repair2-workflow-ui.tsx | test | 间接引用或人工工具 |
| test-transcription-ui.tsx | test | 间接引用或人工工具 |
| test-transcription.mjs | test | test:transcription |
| test-ui.tsx | test | 间接引用或人工工具 |
| test-v142-ui.tsx | test | 间接引用或人工工具 |
| test-v2-documents-native.ts | test | 间接引用或人工工具 |
| test-v2-workflow-ui.tsx | test | 间接引用或人工工具 |
| ui-env.mjs | maintenance/manual | 间接引用或人工工具 |
| ui-harness.ts | maintenance/manual | 间接引用或人工工具 |
| validate-doc-links-v142.py | maintenance/manual | 间接引用或人工工具 |
| verify-package.mjs | build | 间接引用或人工工具 |
| visual-server.ts | maintenance/manual | 间接引用或人工工具 |
| visual-test.mjs | test | 间接引用或人工工具 |
| visual-v123.mjs | maintenance/manual | 间接引用或人工工具 |
| windows-smoke.ps1 | maintenance/manual | 间接引用或人工工具 |
