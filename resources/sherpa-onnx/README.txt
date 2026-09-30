sherpa-onnx v1.13.8 — Windows x64 CPU runtime

Official artifact:
https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-static-MT-Release.tar.bz2

The included sherpa-onnx-offline.exe is copied without modification from the
upstream bin directory. Static MT build avoids Electron native ABI coupling
and does not require an additional VC++ runtime or Python installation.

Model files are NOT included. model-checksums.json pins the official
SenseVoice 2024-07-17 INT8 model and tokens for corruption/version detection.
See resources/docs/音视频转文字_模型安装指南.txt.

Licenses are under the application's licenses directory (sherpa-onnx,
ONNX Runtime and its third-party notices).

Development/test override: AIVIDEO_SHERPA_ONNX_PATH points to the same-version
native CLI for the host platform. This is not required by Windows end users.
