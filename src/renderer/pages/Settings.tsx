import { ModelsPage } from "./Models.tsx";
import { Database, Plus } from "lucide-react";
import { useState } from "react";
import type { Settings as SettingsType } from "../../shared/types.ts";
import { Field, Modal } from "../components/common.tsx";
import { api, run, useApp } from "../store.ts";
export function SettingsPage({initialTab='general'}:{initialTab?:'general'|'models'}) {
 const [tab,setTab]=useState(initialTab);
 return <><div className="settings-tabs"><button onClick={()=>setTab('general')}>常规设置</button><button onClick={()=>setTab('models')}>模型与 API</button></div>{tab==='models'?<ModelsPage/>:<GeneralSettings/>}</>;
}
function GeneralSettings() {
  const { boot, refresh } = useApp();
  const [project, setProject] = useState(false),
    [name, setName] = useState(""),
    [backup, setBackup] = useState(false),
    [resetMode, setResetMode] = useState<"defaults" | "factory" | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [deleteOutputs, setDeleteOutputs] = useState(false);
  if (!boot) return null;
  const s = boot.settings;
  const save = (p: Partial<SettingsType>) =>
    run(async () => {
      const updated = await api<SettingsType>("settings.save", p);
      const state = useApp.getState();
      if (
        p.outputDir &&
        state.draft &&
        [boot!.settings.outputDir, boot!.settings.lastOutputDir].includes(
          state.draft.outputDir,
        )
      ) {
        state.setDraft({ ...state.draft, outputDir: updated.outputDir });
        await state.flushDraft();
      }
      await refresh();
    });
  return (
    <section className="settings-page">
      <div className="page-title">
        <div>
          <h1>设置</h1>
          <p>为你的创作节奏，设置一个稳定的工作环境。</p>
        </div>
      </div>
      <section className="settings-section">
        <h3>软件与构建身份</h3>
        {boot.identity && Object.entries({
          'App Version': boot.identity.version,
          'Git Commit': boot.identity.gitCommit,
          'Git Branch': boot.identity.gitBranch,
          'Build ID': boot.identity.buildId,
          'Build Time': boot.identity.buildTime,
          'Data Root': boot.identity.dataRoot,
          'Executable Path': boot.identity.executablePath,
        }).map(([label,value]) => <Field key={label} label={label}><small className="path">{value}</small></Field>)}
      </section>
      <section className="settings-section">
        <h3>外观与默认选项</h3>
        <div className="form-grid">
          <Field label="主题">
            <select
              value={s.theme}
              onChange={(e) =>
                void save({ theme: e.target.value as SettingsType["theme"] })
              }
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </Field>
          <Field label="默认模型">
            <select
              value={s.defaultModel}
              onChange={(e) => void save({ defaultModel: e.target.value })}
            >
              {boot.models
                .filter((m) => m.enabled && m.type === "video")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="默认 API 账户">
            <select
              value={s.defaultAccount}
              onChange={(e) => void save({ defaultAccount: e.target.value })}
            >
              <option value="auto">自动选择</option>
              {boot.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="语言">
            <select value="zh-CN" disabled>
              <option>zh-CN</option>
            </select>
          </Field>
        </div>
      </section>
      <section className="settings-section">
        <h3>通用设置</h3>
        <Field label="点击窗口右上角 × 时">
          <select
            value={s.closeBehavior || "exit"}
            onChange={(e) =>
              void save({ closeBehavior: e.target.value as "exit" | "tray" })
            }
          >
            <option value="exit">退出软件</option>
            <option value="tray">最小化到系统托盘</option>
          </select>
        </Field>
      </section>
      <section className="settings-section">
        <h3>文件与存储</h3>
        <p>程序文件与用户数据已分离；永久业务数据固定保存在下列数据根目录。</p>
        <Field label="软件安装路径">
          <small className="path">{boot.installPath}</small>
        </Field>
        <Field label="固定数据根目录">
          <div className="output-folder">
            <span>{boot.root}</span>
            <button onClick={() => void run(() => api("open", { kind: "data" }))}>
              打开数据目录
            </button>
          </div>
        </Field>
        {(
          [
            ["outputDir", "生成视频"],
            ["audioDir", "生成音频"],
            ["otherDir", "其他输出"],
            ["backupDir", "备份"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <div className="output-folder">
              <span>{s[key]}</span>
              <button
                onClick={() => void run(() => api("directories.open", { key }))}
              >
                打开
              </button>
            </div>
          </Field>
        ))}
        <Field label="FFmpeg 程序路径（留空则使用系统 PATH；用于 MP3 和参考音频转换）">
          <input
            defaultValue={s.ffmpegPath || ""}
            placeholder="例如 C:\工具\ffmpeg.exe"
            onBlur={(e) => void save({ ffmpegPath: e.target.value.trim() })}
          />
        </Field>
      </section>
      <section className="settings-section">
        <h3>任务与下载</h3>
        <div className="form-grid">
          <Field label="全局最大并发">
            <select
              value={s.globalConcurrency}
              onChange={(e) =>
                void save({ globalConcurrency: Number(e.target.value) })
              }
            >
              {[1, 2, 3, 5, 10].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="最大自动重试次数">
            <input
              type="number"
              min={0}
              max={10}
              defaultValue={s.maxRetries}
              onBlur={(e) => void save({ maxRetries: Number(e.target.value) })}
            />
          </Field>
          {boot.providers.map((p) => (
            <Field key={p.id} label={`${p.name} 最大并发`}>
              <input
                type="number"
                min={1}
                max={10}
                defaultValue={s.providerConcurrency[p.id] ?? 2}
                onBlur={(e) =>
                  void save({
                    providerConcurrency: {
                      ...s.providerConcurrency,
                      [p.id]: Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          ))}
          <Field label="状态查询间隔（秒）">
            <input
              type="number"
              min={5}
              max={300}
              defaultValue={s.pollSeconds}
              onBlur={(e) => void save({ pollSeconds: Number(e.target.value) })}
            />
          </Field>
          <Field label="下载超时（秒）">
            <input
              type="number"
              min={30}
              max={3600}
              defaultValue={s.downloadTimeoutSeconds}
              onBlur={(e) =>
                void save({ downloadTimeoutSeconds: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <div className="actions">
          <label className="check">
            <input
              type="checkbox"
              checked={s.notifications}
              onChange={(e) => void save({ notifications: e.target.checked })}
            />
            完成与失败时通知
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.queuePaused}
              onChange={(e) => void save({ queuePaused: e.target.checked })}
            />
            暂停新任务提交（已提交任务继续查询）
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h3>数据与备份</h3>
        <p>数据独立于程序保存。升级替换程序文件不会覆盖用户数据。</p>
        <small className="path">{boot.root}</small>
        <div className="actions">
          <button
            disabled={backup}
            onClick={() => {
              setBackup(true);
              void run(async () => {
                const path = await api<string>("backup");
                useApp.getState().message(`数据库备份已保存：${path}`);
              }).finally(() => setBackup(false));
            }}
          >
            <Database size={16} />
            {backup ? "备份中…" : "备份数据库"}
          </button>
          <button onClick={() => void run(() => api("open", { kind: "data" }))}>
            打开数据目录
          </button>
          <button onClick={() => void run(() => api("open", { kind: "logs" }))}>
            打开日志目录
          </button>
        </div>
        <small>
          数据库备份包含任务和凭据密文，不包含原始素材和输出文件。完整迁移请复制整个目录。
        </small>
      </section>
      <section className="settings-section">
        <h3>数据管理与重置</h3>
        <p>
          所有重置都只处理软件管理的数据和记录，绝不删除、移动、重命名或覆盖用户原始素材。
        </p>
        <div className="actions">
          <button
            onClick={() => {
              setConfirmation("");
              setResetMode("defaults");
            }}
          >
            恢复默认设置
          </button>
          <button
            className="danger"
            onClick={() => {
              setConfirmation("");
              setDeleteOutputs(false);
              setResetMode("factory");
            }}
          >
            恢复出厂状态
          </button>
        </div>
      </section>
      <section className="settings-section">
        <h3>快捷键</h3>
        <div className="shortcut-grid">
          {[
            ["Ctrl N", "新任务"],
            ["Ctrl Enter", "生成视频"],
            ["Ctrl S", "保存 Prompt 模板"],
            ["Ctrl F", "搜索"],
            ["Ctrl ,", "设置"],
          ].map(([k, v]) => (
            <div key={k}>
              <kbd>{k}</kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </section>
      {resetMode && (
        <Modal
          title={resetMode === "defaults" ? "恢复默认设置" : "恢复出厂状态"}
          onClose={() => setResetMode(null)}
        >
          {resetMode === "defaults" ? (
            <p>
              仅恢复窗口布局、工作台状态、默认模型与界面偏好。API、素材记录、音色、Prompt、历史任务和生成成品均保留。
            </p>
          ) : (
            <>
              <p>
                将清空素材库记录、工作区、历史任务、API 与密钥、自定义 Prompt、本地音色记录、缓存和统计记录。云端音色、远端文件及用户原始素材不受影响。
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={deleteOutputs}
                  onChange={(event) => setDeleteOutputs(event.target.checked)}
                />
                同时移除生成成品（默认不勾选；文件将移入可恢复备份区）
              </label>
            </>
          )}
          <Field
            label={`请输入“${resetMode === "defaults" ? "恢复默认设置" : "确认重置"}”`}
          >
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          <button
            className="danger"
            disabled={
              confirmation !==
              (resetMode === "defaults" ? "恢复默认设置" : "确认重置")
            }
            onClick={() =>
              void run(async () => {
                const result = await api<boolean | { backup: string }>(
                  resetMode === "defaults"
                    ? "data.resetDefaults"
                    : "data.factoryReset",
                  { confirmation, deleteOutputs },
                );
                if (!result) return;
                localStorage.removeItem("aivideo-draft-emergency");
                localStorage.removeItem("chigetang-workspace-closed");
                location.reload();
              })
            }
          >
            确认执行
          </button>
        </Modal>
      )}
    </section>
  );
}
