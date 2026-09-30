import { LibraryPage } from "./pages/Library.tsx";
import { Copy, AudioLines, Mic, TextCursorInput, Wrench } from "lucide-react";
import { ReplicaPage } from "./pages/Replica.tsx";
import { ToolsPage } from "./pages/Tools.tsx";
import {
  Boxes,
  Clapperboard,
  FileText,
  Images,
  Layers,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { brand } from "../shared/brand.ts";
import { AssetsPage } from "./pages/Assets.tsx";
import { GeneratePage } from "./pages/Generate.tsx";
import { OneClickPage } from "./pages/OneClick.tsx";
import { AudioPage, VoiceClonePage } from "./pages/Audio.tsx";
import { ModelsPage } from "./pages/Models.tsx";
import { PromptsPage } from "./pages/Prompts.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { TranscriptionPage } from "./pages/Transcription.tsx";
import { TaskDetail, TasksPage } from "./pages/Tasks.tsx";
import { run, useApp } from "./store.ts";
import "./style.css";
const RealSpeechPage = React.lazy(() => import("../features/realSpeech/Page.tsx"));
const nav = [
  ["一键生成", Clapperboard],
  ["一键复刻", Copy],
  ["生成视频", Sparkles],
  ["真人口播", Mic],
  ["生成音频", AudioLines],
  ["复刻音色", Mic],
  ["转文字", TextCursorInput],
  ["资产库", Images],
  ["小工具", Wrench],
  ["设置", Settings],
] as const;
function App() {
  const state = useApp();
  const [assetExpanded, setAssetExpanded] = useState(false),
    [fatal, setFatal] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("chigetang-sidebar-width"));
    return Number.isFinite(saved) ? Math.min(300, Math.max(150, saved)) : 164;
  });
  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const move = (next: PointerEvent) => {
      const width = Math.min(300, Math.max(150, next.clientX));
      setSidebarWidth(width);
      localStorage.setItem("chigetang-sidebar-width", String(width));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  useEffect(() => {
    state.initialize().catch((e) => setFatal(String(e)));
    return window.aiVideo.onNavigate((id) => state.setTask(id));
  }, []);
  useEffect(() => {
    const s = state.boot?.settings.theme;
    const media = matchMedia("(prefers-color-scheme:dark)");
    const apply = () => {
      const dark = s === "dark" || (s === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.style.setProperty(
        "--accent",
        dark ? brand.accentDark : brand.accent,
      );
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state.boot?.settings.theme]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        void run(() => state.newDraft());
      }
      if (e.key === ",") {
        e.preventDefault();
        state.setPage("设置");
      }
      if (e.key.toLowerCase() === "f" && state.page !== "生成视频") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-search]")?.focus();
      }
    };
    window.addEventListener("keydown", fn);
    return () => {
      window.removeEventListener("keydown", fn);
    };
  }, [state.page, state.draft]);
  if (fatal)
    return (
      <div className="fatal">
        <h1>{brand.name} 启动失败</h1>
        <p>{fatal}</p>
        <p>请检查程序目录是否可写。现有数据不会被重置。</p>
      </div>
    );
  if (!state.boot || !state.draft)
    return (
      <div className="loading">
        <Clapperboard size={38} />
        <p>正在打开你的工作台…</p>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="brand">
          <div className="brand-symbol">
            <img src={new URL("../../resources/brand.svg", import.meta.url).href} width={35} height={35} alt="吃个糖Agent LOGO" />
          </div>
          <span>
            吃个糖 Agent
          </span>
        </div>
        <nav>
          {nav.map(([name, Icon]) => (
            <React.Fragment key={name}>
              <button
                key={name}
                className={state.page === name ? "active" : ""}
                onClick={() => {
                  if (name === "资产库") {
                    setAssetExpanded((value) => !value);
                    state.setPage("资产库");
                  } else state.setPage(name);
                }}
              >
                <Icon size={19} />
                {name === "生成视频" ? "视频生成" : name === "生成音频" ? "音频生成" : name}
                {state.page === name && <i />}
              </button>
              {false && name === "资产库" && assetExpanded && (
                <div className="asset-shortcuts">
                  {[
                    ["image", "图片"],
                    ["video", "视频"],
                    ["audio", "音频"],
                    ["prompt", "Prompt"],
                    ["hidden", "隐藏资产"],
                  ].map(([k, v]) => (
                    <button
                      key={k}
                      className={
                        state.page === "资产库" && state.assetKind === k
                          ? "active"
                          : ""
                      }
                      onClick={() => state.setAssetKind(k)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <small>
            {brand.name} <span>V{state.boot.version}</span>
          </small>
        </div>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="调整侧边栏宽度"
          onPointerDown={startResize}
        />
      </aside>
      <div className="workspace">
        <main
          className={
            state.page === "生成视频" || state.page === "一键生成"
              ? "main generation-main"
              : "main"
          }
        >
          {state.page === "生成视频" ? (
            <GeneratePage />
          ) : state.page === "一键生成" ? (
            <OneClickPage />
          ) : state.page === "一键复刻" ? (<ReplicaPage />) : state.page === "小工具" ? (<ToolsPage />) : state.page === "真人口播" ? (<React.Suspense fallback={<p>正在打开真人口播…</p>}><RealSpeechPage /></React.Suspense>) : state.page === "生成音频" ? (
            <AudioPage />
          ) : state.page === "复刻音色" ? (
            <VoiceClonePage />
          ) : state.page === "转文字" ? (
            <TranscriptionPage />
          ) : state.page === "任务" ? (
            <LibraryPage />
          ) : state.page === "资产库" ? (
            state.assetKind === "prompt" ? <PromptsPage /> : <LibraryPage />
          ) : state.page === "Prompt" ? (
            <PromptsPage />
          ) : state.page === "模型与 API" ? (
            <SettingsPage key="accounts" initialTab="models" />
          ) : state.page === "统计" ? (
            <ModelsPage key="statistics" initialTab="statistics" />
          ) : (
            <SettingsPage key="general" />
          )}
        </main>
      </div>
      {state.toast && (
        <div className="toast" role="status">
          <span>{state.toast}</span>
          <button onClick={() => useApp.setState({ toast: null })}>
            <X size={16} />
          </button>
        </div>
      )}
      {state.taskId && (
        <TaskDetail id={state.taskId} onClose={() => state.setTask(null)} />
      )}{" "}
    </div>
  );
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>界面遇到问题</h1>
        <p>{this.state.error}</p>
        <p>草稿和任务保存在本机，请重新打开软件。</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
