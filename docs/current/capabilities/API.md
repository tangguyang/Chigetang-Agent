# Capability API 能力清单

以运行时 capability.describe 返回的Schema为准。默认compact；完整控制结果保存在resultPath。生成输入保持完整。

| 能力 | 必填参数 | 作用 | 业务入口 |
|---|---|---|---|
| accounts.balance | id | read | Application / accounts.balance |
| accounts.test | id | read | Application / accounts.test |
| assets.get | id | read | Application / assets.get |
| assets.import | paths | write | Application / assets.import |
| assets.inspect | id | write | Application / assets.inspect |
| assets.list | 无 | read | Application / assets.list |
| assets.refresh | 无 | write | Application / assets.refresh |
| assets.relocate | id, path | write | Application / assets.relocate |
| assets.relocateFolder | id, path | write | Application / assets.relocateFolder |
| assets.remove | id | destructive | Application / assets.remove |
| assets.removeMany | ids | destructive | Application / assets.removeMany |
| assets.save | id | write | Application / assets.save |
| assets.thumbnail.ensure | id | write | Application / assets.thumbnail.ensure |
| audio.batch.create | accountId, voiceId, name, text, requestId, configs | paid | Application / audio.batch.create |
| audio.batch.retry | id | paid | Application / audio.batch.retry |
| audio.batches | 无 | read | Application / audio.batches |
| audio.bind | assetId, draftId | write | Application / audio.bind |
| audio.capabilities | 无 | read | Application / audio.capabilities |
| audio.convert | path, format | write | Application / audio.convert |
| audio.history | 无 | read | Application / audio.history |
| audio.history.delete | id | destructive | Application / audio.history.delete |
| audio.history.favorite | id, favorite | write | Application / audio.history.favorite |
| audio.job.delete | id | destructive | Application / audio.job.delete |
| audio.job.rename | id, name | write | Application / audio.job.rename |
| audio.presets | 无 | read | Application / audio.presets |
| audio.presets.delete | id | destructive | Application / audio.presets.delete |
| audio.presets.reorder | ids | write | Application / audio.presets.reorder |
| audio.presets.save | 无 | write | Application / audio.presets.save |
| audio.reclone.clear | 无 | write | Application / audio.reclone.clear |
| audio.reclone.draft | 无 | read | Application / audio.reclone.draft |
| audio.reclone.prepare | taskId | write | Application / audio.reclone.prepare |
| backup | 无 | write | Application / backup |
| billing.correct | id, amount | write | Application / billing.correct |
| billing.history | id | read | Application / billing.history |
| billing.report | 无 | read | Application / billing.report |
| bootstrap | 无 | read | Application / bootstrap |
| capability.describe | id | read | CapabilityRegistry |
| capability.search | query | read | CapabilityRegistry |
| draft.finishSubmitted | id | destructive | Application / draft.finishSubmitted |
| draft.get | 无 | read | Application / draft.get |
| draft.list | 无 | read | Application / draft.list |
| draft.load | id | read | Application / draft.load |
| draft.new | 无 | write | Application / draft.new |
| draft.remove | id | destructive | Application / draft.remove |
| draft.rename | id, name | write | Application / draft.rename |
| draft.save | 无 | write | Application / draft.save |
| files.export | output | write | Application / files.export |
| folders.list | 无 | read | Application / folders.list |
| folders.remove | id | destructive | Application / folders.remove |
| folders.save | 无 | write | Application / folders.save |
| image.process | path, output, format | write | Application / image.process |
| jobs.status | jobId | read | CapabilityJobs |
| jobs.submit | requestId, request | write | CapabilityJobs |
| jobs.wait | jobId | read | CapabilityJobs |
| library.hide | id | write | Application / library.hide |
| library.list | 无 | write | Application / library.list |
| logs.read | executionId | read | CapabilityRegistry |
| media.trim | path, start, duration, kind, format | write | Application / media.trim |
| models.save | 无 | write | Application / models.save |
| packages.compileTemplate | output | write | Application / packages.compileTemplate |
| packages.confirm | sessionId, revision | write | Application / packages.confirm |
| packages.detail | sessionId | read | Application / packages.detail |
| packages.discard | sessionId | destructive | Application / packages.discard |
| packages.exportGuide | kind, output | write | Application / packages.exportGuide |
| packages.import | path | write | Application / packages.import |
| packages.list | 无 | read | Application / packages.list |
| packages.preflight | sessionId | write | Application / packages.preflight |
| packages.stage1Apply | token | write | Application / packages.stage1Apply |
| packages.stage1Info | 无 | read | Application / packages.stage1Info |
| packages.stage1Inspect | path | write | Application / packages.stage1Inspect |
| packages.stage1Restore | 无 | write | Application / packages.stage1Restore |
| packages.submit | sessionId | paid | Application / packages.submit |
| packages.update | sessionId, segmentId, patch | write | Application / packages.update |
| projects.create | name | write | Application / projects.create |
| prompts.list | 无 | read | Application / prompts.list |
| prompts.save | 无 | write | Application / prompts.save |
| prompts.versions | id | read | Application / prompts.versions |
| replica.compile | path, output | write | Application / replica.compile |
| replica.confirm | id, revision | write | Application / replica.confirm |
| replica.import | path | write | Application / replica.import |
| replica.list | 无 | read | Application / replica.list |
| replica.preflight | id | write | Application / replica.preflight |
| replica.submit | id | paid | Application / replica.submit |
| replica.update | id, segmentId, draft | write | Application / replica.update |
| runtime.status | 无 | read | Application |
| runtime.stop | 无 | destructive | Application |
| speech.acknowledge | taskId | write | RealSpeechV2Service / acknowledge |
| speech.concat | taskId | write | RealSpeechV2Service / concat |
| speech.export | taskId | write | RealSpeechV2Service / export |
| speech.generate | taskId | paid | RealSpeechV2Service / generate |
| speech.get | taskId | read | RealSpeechV2Service / get |
| speech.import | name, voiceRef, text, confirmed | write | RealSpeechV2Service / import |
| speech.legacy.apply | 无 | write | RealSpeechService / apply |
| speech.legacy.concat | 无 | write | RealSpeechService / concat |
| speech.legacy.create | 无 | write | RealSpeechService / create |
| speech.legacy.document | 无 | read | RealSpeechService / document |
| speech.legacy.export | 无 | write | RealSpeechService / export |
| speech.legacy.feedback | 无 | write | RealSpeechService / feedback |
| speech.legacy.generate | 无 | paid | RealSpeechService / generate |
| speech.legacy.get | 无 | read | RealSpeechService / get |
| speech.legacy.list | 无 | write | RealSpeechService / list |
| speech.legacy.preview | 无 | read | RealSpeechService / preview |
| speech.legacy.recover | 无 | write | RealSpeechService / recover |
| speech.legacy.remove | 无 | destructive | RealSpeechService / remove |
| speech.legacy.update | 无 | write | RealSpeechService / update |
| speech.list | 无 | read | RealSpeechV2Service / list |
| speech.mutate | taskId | write | RealSpeechV2Service / mutate |
| speech.patchApply | taskId | paid | RealSpeechV2Service / patchApply |
| speech.patchPreview | taskId | read | RealSpeechV2Service / patchPreview |
| speech.preview | text | read | RealSpeechV2Service / preview |
| speech.recover | taskId | write | RealSpeechV2Service / recover |
| statistics | 无 | read | Application / statistics |
| tasks.again | id, requestId | paid | Application / tasks.again |
| tasks.cancel | id | write | Application / tasks.cancel |
| tasks.children | parentId | read | Application / tasks.children |
| tasks.clone | id | write | Application / tasks.clone |
| tasks.create | draft, requestId | paid | Application / tasks.create |
| tasks.estimate | 无 | read | Application / tasks.estimate |
| tasks.get | id | read | Application / tasks.get |
| tasks.list | 无 | read | Application / tasks.list |
| tasks.redownload | id | write | Application / tasks.redownload |
| tasks.refreshAll | 无 | write | Application / tasks.refreshAll |
| tasks.refreshStatus | id | write | Application / tasks.refreshStatus |
| tasks.remove | id | destructive | Application / tasks.remove |
| tasks.resume | id | paid | Application / tasks.resume |
| tasks.segment.create | draft, requestId | paid | Application / tasks.segment.create |
| tasks.segment.plan | 无 | read | Application / tasks.segment.plan |
| tasks.segment.retry | id, requestId | paid | Application / tasks.segment.retry |
| tasks.versions | id | read | Application / tasks.versions |
| text.process | text, operation | read | Application / text.process |
| text.subtitles | segments, output | write | Application / text.subtitles |
| tools.audio | path, format | write | Application / tools.audio |
| transcription.cancel | 无 | write | Application / transcription.cancel |
| transcription.inspect | path | read | Application / transcription.inspect |
| transcription.progress | 无 | read | Application / transcription.progress |
| transcription.result | taskId, kind | read | Application / transcription.result |
| transcription.run | path | write | Application / transcription.run |
| transcription.start | path | write | Application / transcription.start |
| transcription.wait | 无 | read | Application / transcription.wait |
| video.concat | paths | write | Application / video.concat |
| video.convert | path, format | write | Application / video.convert |
| video.frames | path | write | Application / video.frames |
| voices.clone | accountId, assetId, name | paid | Application / voices.clone |
| voices.list | 无 | read | Application / voices.list |
| voices.remove | id | destructive | Application / voices.remove |
| voices.reorder | ids | write | Application / voices.reorder |
| voices.save | 无 | write | Application / voices.save |
| workflow.run | steps | write | CapabilityRegistry |
