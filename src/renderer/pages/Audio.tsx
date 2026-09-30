import { useEffect, useState } from "react";
import type {
  Account, Asset, AudioBatchInput, AudioBatchRecord, AudioGenerationConfig,
  Draft, InstructionHistory, InstructionPreset, Voice,
} from "../../shared/types.ts";
import { COSYVOICE_MODEL_ID, voiceCompatible } from "../../shared/audioCatalog.ts";
import { estimateSpeechDuration } from "../../shared/audioDuration.ts";
import { Empty, Field, Modal, SearchBox } from "../components/common.tsx";
import { api, media, run, time, useApp } from "../store.ts";

const newConfig = (n = 1): AudioGenerationConfig => ({
  id: crypto.randomUUID(), name: `配置 ${String(n).padStart(2, "0")}`,
  instruction: "", rate: 1, pitch: 1, volume: 50,
  seed: n === 1 ? 12345 : Math.floor(Math.random() * 65536),
  format: "wav", sampleRate: 24000,
});
const instructionLength = (value: string) => [...value].reduce(
  (sum, char) => sum + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0,
);

export async function useAudioInVideo(assetId: string, draftId: string) {
  const state = useApp.getState();
  await state.flushDraft();
  state.setDraft(await api<Draft>("audio.bind", { assetId, draftId }));
  await state.flushDraft();
  state.setPage("生成视频");
}

export function AudioPage() {
  const { boot, message, setPage } = useApp();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [batches, setBatches] = useState<AudioBatchRecord[]>([]);
  const [presets, setPresets] = useState<InstructionPreset[]>([]);
  const [history, setHistory] = useState<InstructionHistory[]>([]);
  const [accountId, setAccountId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [voiceSearch, setVoiceSearch] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [configs, setConfigs] = useState<AudioGenerationConfig[]>([newConfig()]);
  const [busy, setBusy] = useState(false);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [library, setLibrary] = useState<{ kind: "history" | "presets" | "favorites"; configId: string } | null>(null);
  const [editingPreset, setEditingPreset] = useState<Partial<InstructionPreset> | null>(null);

  const model = boot?.models.find((item) => item.id === COSYVOICE_MODEL_ID);
  const accounts = (boot?.accounts.filter((item) => item.enabled && item.providerId === model?.providerId && item.region === "cn-beijing") ?? [])
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const account = accounts.find((item) => item.id === accountId) ?? accounts[0];
  const compatible = voices.filter((voice) => {
    const owner = accounts.find((item) => item.id === voice.accountId);
    return Boolean(model && owner && voice.voiceId && voiceCompatible(voice, model, owner));
  });
  const shownVoices = compatible.filter((voice) => `${voice.name} ${voice.notes}`.toLowerCase().includes(voiceSearch.toLowerCase()));

  const refresh = async () => {
    const [v, b, p, h] = await Promise.all([
      api<Voice[]>("voices.list"), api<AudioBatchRecord[]>("audio.batches"),
      api<InstructionPreset[]>("audio.presets"), api<InstructionHistory[]>("audio.history"),
    ]);
    setVoices(v); setBatches(b); setPresets(p); setHistory(h);
    const explicit = sessionStorage.getItem("audio-explicit-voice");
    const available = v.filter((voice) => {
      const owner = accounts.find((item) => item.id === voice.accountId);
      return Boolean(model && owner && voice.voiceId && voiceCompatible(voice, model, owner));
    });
    setVoiceId((current) => {
      const selected =
        (explicit ? available.find((item) => item.id === explicit) : undefined) ??
        available.find((item) => item.id === current);
      if (selected) setAccountId(selected.accountId);
      else setAccountId(accounts[0]?.id ?? "");
      return selected?.id ?? "";
    });
    if (explicit) sessionStorage.removeItem("audio-explicit-voice");
  };
  useEffect(() => {
    void run(refresh);
    const off = window.aiVideo.onChange(() => { if(document.visibilityState==='visible')void run(refresh); });
    return off;
  }, []);
  // Local AudioService state only; no additional cloud polling or paid API requests.
  useEffect(() => {
    if (!batches.some(b => b.jobs.some(j => j.status==='pending'||j.status==='generating')))return;
    let inFlight=false;
    const timer=setInterval(()=>{
      if(document.visibilityState!=='visible'||inFlight)return;
      inFlight=true;void refresh().catch(()=>{}).finally(()=>{inFlight=false;});
    },5000);
    return ()=>clearInterval(timer);
  },[batches.some(b => b.jobs.some(j => j.status==='pending'||j.status==='generating'))]);

  const patchConfig = (id: string, patch: Partial<AudioGenerationConfig>) =>
    setConfigs((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const addConfig = (source?: AudioGenerationConfig) => {
    if (configs.length >= 10) return message("当前最多支持 10 套生成配置。");
    setConfigs((items) => [...items, source ? {
      ...source, id: crypto.randomUUID(), name: `${source.name} 副本`,
      seed: Math.floor(Math.random() * 65536), collapsed: false,
    } : newConfig(items.length + 1)]);
  };
  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const count = configs.length;
      const input: AudioBatchInput = { name, text, accountId: account?.id ?? "", voiceId, configs, requestId: crypto.randomUUID() };
      await api("audio.batch.create", input);
      await refresh();
      setName("");
      setText("");
      setConfigs([newConfig()]);
      setVoiceId("");
      message(`已可靠记录 ${count} 条配音任务；输入区已恢复初始配置`);
    } catch (error) {
      message(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  return <section className={`audio-page audio-studio ${resultsCollapsed ? "results-collapsed" : ""}`}>
    <div className="page-title audio-title"><div><h1>专业音频工作台</h1><p>共享一份台词，以不同情绪和参数批量生成可试听版本。</p></div><div className="model-badge"><strong>CosyVoice 3.5 Plus</strong><span>北京地域 · 24kHz WAV</span></div></div>
    <div className="studio-columns">
      <div className="studio-compose">
        <section className="studio-card"><StudioHeading number="01" title="选择音色" note="仅显示当前连接下可用的 CosyVoice 3.5 Plus 音色" />
          <div className="studio-inline"><SearchBox value={voiceSearch} onChange={setVoiceSearch} placeholder="搜索音色名称或备注" />{!accounts.length && <small className="validation-reason">请先在“模型与 API”配置北京地域连接。</small>}</div>
          <div className="voice-choice-list">{shownVoices.map((voice) => <button key={voice.id} className={voiceId === voice.id ? "voice-choice active" : "voice-choice"} onClick={() => { setVoiceId(voice.id); setAccountId(voice.accountId); }}><span>{voice.pinned ? "置顶 · " : ""}{voice.name}{voice.isDefault ? " · 默认" : ""}</span><small>{voice.notes || voice.voiceId}</small></button>)}{!shownVoices.length && <button className="voice-create" onClick={() => setPage("复刻音色")}>＋ 创建第一个有效音色</button>}</div>
        </section>
        <section className="studio-card"><StudioHeading number="02" title="共享台词" note="全部配置使用同一份原文，不会自动改写或截断" /><Field label="批次名称"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：产品介绍 A 组" /></Field><textarea className="studio-script" value={text} onChange={(e) => setText(e.target.value)} placeholder="输入要生成的中文口播台词……" /><small>{[...text].length} / 20000 字符</small></section>
        <section className="studio-card config-section"><StudioHeading number="03" title="生成配置" note="最多 10 套；每套保留独立 instruction 和 Seed" />
          {configs.map((config, index) => <ConfigCard key={config.id} config={config} text={text} voiceId={voiceId} batches={batches} index={index} canDelete={configs.length > 1} patch={(p) => patchConfig(config.id, p)} copy={() => addConfig(config)} remove={() => setConfigs((items) => items.filter((item) => item.id !== config.id))} openLibrary={(kind) => setLibrary({ kind, configId: config.id })} savePreset={() => setEditingPreset({ name: config.name, content: config.instruction, notes: "", favorite: false })} />)}
          <button className="add-config" disabled={configs.length >= 10} onClick={() => addConfig()}>＋ 新增配置 {configs.length >= 10 ? "· 当前最多支持 10 套生成配置" : `· ${configs.length}/10`}</button>
        </section>
        <div className="audio-generate-bar"><div><strong>将生成 {configs.length} 条配音</strong><small>费用以百炼实际账单为准，当前无法提供准确预估。</small></div><button className="primary" disabled={busy || !text.trim() || !voiceId || !account || configs.some((c) => instructionLength(c.instruction) > 100)} onClick={() => void generate()}>{busy ? "正在创建任务…" : `批量生成 ${configs.length} 条配音`}</button></div>
      </div>
      <ResultPanel collapsed={resultsCollapsed} setCollapsed={setResultsCollapsed} batches={batches} refresh={refresh} modify={(batch, config) => { setName(batch.name); setText(batch.text); setConfigs([{ ...config, id: crypto.randomUUID(), collapsed: false }]); const selected = compatible.find((item) => item.id === batch.voiceId); if (selected) { setVoiceId(selected.id); setAccountId(selected.accountId); } else { setVoiceId(""); message("原音色已失效，台词和配置已恢复，请重新选择音色。"); } document.querySelector(".studio-compose")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
    </div>
    {library && <InstructionLibrary kind={library.kind} presets={presets} history={history} onClose={() => setLibrary(null)} apply={(content) => { patchConfig(library.configId, { instruction: content }); setLibrary(null); }} refresh={refresh} edit={setEditingPreset} />}
    {editingPreset && <PresetEditor value={editingPreset} onClose={() => setEditingPreset(null)} onSaved={async () => { setEditingPreset(null); await refresh(); }} />}
  </section>;
}

function StudioHeading({ number, title, note }: { number: string; title: string; note: string }) {
  return <header className="studio-heading"><span>{number}</span><div><h2>{title}</h2><p>{note}</p></div></header>;
}

function ConfigCard({ config, text, voiceId, batches, index, canDelete, patch, copy, remove, openLibrary, savePreset }: {
  config: AudioGenerationConfig; text: string; voiceId: string; batches: AudioBatchRecord[]; index: number; canDelete: boolean;
  patch: (patch: Partial<AudioGenerationConfig>) => void; copy: () => void;
  remove: () => void; openLibrary: (kind: "history" | "presets" | "favorites") => void;
  savePreset: () => void;
}) {
  const count = instructionLength(config.instruction);
  const estimate = estimateSpeechDuration(text, config.rate, voiceId, batches);
  return <article className="config-card"><header><div><span>{String(index + 1).padStart(2, "0")}</span><input aria-label="配置名称" value={config.name} onChange={(e) => patch({ name: e.target.value })} /></div><div className="actions"><button onClick={copy}>复制</button><button disabled={!canDelete} onClick={remove}>删除</button><button onClick={() => patch({ collapsed: !config.collapsed })}>{config.collapsed ? "展开" : "折叠"}</button></div></header>
    {!config.collapsed && <><div className="instruction-editor"><div className="instruction-tools"><button onClick={() => openLibrary("history")}>历史</button><button onClick={() => openLibrary("presets")}>预设</button><button onClick={() => openLibrary("favorites")}>收藏</button></div><textarea value={config.instruction} onChange={(e) => patch({ instruction: e.target.value })} placeholder="描述表演方式，例如：像跟熟人聊天，语气松弛，停顿自然。" /><div className={count > 100 ? "instruction-count over" : "instruction-count"}><span>{count > 100 ? `超过 ${count - 100} 字符；请修改后再生成` : "汉字按 2 字符计，其他字符按 1 字符计"}</span><strong>{count} / 100</strong></div><div className="instruction-actions"><button onClick={() => patch({ instruction: "" })}>清空</button><button onClick={savePreset}>另存为预设</button></div></div>
      <div className="parameter-grid"><Parameter label="语速" value={config.rate} min={0.5} max={2} step={0.1} defaultValue={1} onChange={(rate) => patch({ rate })} /><Parameter label="音调" value={config.pitch} min={0.5} max={2} step={0.1} defaultValue={1} onChange={(pitch) => patch({ pitch })} /><Parameter label="音量" value={config.volume} min={0} max={100} step={1} defaultValue={50} onChange={(volume) => patch({ volume })} /></div>
      <p className="duration-estimate">预计约 {estimate.seconds.toFixed(1)} 秒（{estimate.low.toFixed(1)}–{estimate.high.toFixed(1)} 秒）{estimate.calibrated ? " · 已按近期结果校准" : ""}；仅供参考，以实际生成文件为准。</p>
      <details><summary>高级参数</summary><div className="advanced-row"><Field label="Seed"><div className="seed-input"><input aria-label="Seed" type="number" min={0} max={65535} step={1} value={config.seed} onChange={(e) => patch({ seed: Number(e.target.value) })} /><button onClick={() => void navigator.clipboard.writeText(String(config.seed))}>复制</button><button onClick={() => patch({ seed: 12345 })}>默认</button></div></Field><Field label="输出"><input value="WAV · 24000 Hz" disabled /></Field></div><small>相同 Seed 有助于复现请求条件，但不保证声纹或结果完全一致。</small></details></>}
  </article>;
}

function Parameter({ label, value, min, max, step, defaultValue, onChange }: { label: string; value: number; min: number; max: number; step: number; defaultValue: number; onChange: (v: number) => void }) {
  return <div className="parameter"><div><strong>{label}</strong><button onClick={() => onChange(defaultValue)}>恢复默认</button></div><input aria-label={`${label}滑块`} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /><input aria-label={`${label}数值`} type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}

function ResultPanel({ batches, refresh, modify, collapsed, setCollapsed }: { batches: AudioBatchRecord[]; refresh: () => Promise<void>; modify: (batch: AudioBatchRecord, config: AudioGenerationConfig) => void; collapsed: boolean; setCollapsed: (value: boolean) => void }) {
  const { setPage } = useApp();
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const renameInvalid = Boolean(
    rename &&
      (!rename.name.trim() ||
        [...rename.name.trim()].length > 80 ||
        /[\\/:*?"<>|\r\n]/.test(rename.name)),
  );
  if (collapsed) return <aside className="studio-results collapsed"><button title="展开任务列表" onClick={() => setCollapsed(false)}>‹</button></aside>;
  return <aside className="studio-results"><div className="result-heading"><div><h2>任务列表</h2><p>成功项立即保留；失败不会影响同批其他结果</p></div><div className="actions"><button onClick={() => setCollapsed(true)}>收起</button><button onClick={() => void run(refresh)}>刷新</button></div></div>
    {batches.map((batch) => <section className="batch-card" key={batch.id}><header><div><strong>{batch.name}</strong><small>{batch.voiceName} · {time(batch.createdAt)}</small></div>{batch.jobs.some((job) => job.status === "failed") && <button onClick={() => void run(async () => { await api("audio.batch.retry", { id: batch.id }); await refresh(); }, "已仅重新排队失败项")}>只重试失败项</button>}</header>
      {batch.jobs.map((job) => <article className={`result-job ${job.status}`} key={job.id}><div className="job-title"><strong>{job.config.name}</strong><span>{job.status === "pending" ? "待生成" : job.status === "generating" ? "生成中" : job.status === "completed" ? "已完成" : job.status === "cancelled" ? "已取消" : job.status === "uncertain" ? "提交结果待核对" : "失败"}</span></div><small>配置 {job.configIndex + 1} · Seed {job.config.seed}{job.duration != null ? ` · ${job.duration.toFixed(1)} 秒` : ""}</small>
        {job.status === "completed" && <><audio controls preload="metadata" src={media("output", job.taskId)} />{job.duration == null && <small>播放器元数据尚未载入；生成结果仍可试听。</small>}</>}
        {["completed", "failed", "uncertain", "cancelled"].includes(job.status) && <div className="actions">{job.status === "completed" && <><button onClick={() => setRename({ id: job.id, name: job.config.name })}>重命名</button><button onClick={() => void run(() => api("open", { taskId: job.taskId, folder: true }))}>文件位置</button><button onClick={() => modify(batch, job.config)}>修改</button><button onClick={() => void run(async () => { await api("audio.reclone.prepare", { taskId: job.taskId }); setPage("复刻音色"); })}>复刻此音色</button></>}<button onClick={() => void run(async () => { await api("audio.job.delete", { id: job.id }); await refresh(); }, "已删除该条结果记录，本地音频文件已保留")}>删除</button></div>}
        {job.error && <p className="error-detail">{job.error}</p>}
      </article>)}
    </section>)}
    {!batches.length && <Empty title="还没有生成记录" description="完成左侧配置后，批量生成的结果会按批次出现在这里。" />}
    {rename && <Modal title="重命名音频结果" onClose={() => setRename(null)}><Field label="显示名称" hint="只修改软件内显示名称，不改动本地 WAV 文件名。"><input autoFocus value={rename.name} maxLength={80} onChange={(event) => setRename({ ...rename, name: event.target.value })} /></Field>{renameInvalid && <p className="validation-reason">请输入 1–80 个字符，不要包含路径特殊字符。</p>}<div className="actions"><button onClick={() => setRename(null)}>取消</button><button className="primary" disabled={renameInvalid} onClick={() => void run(async () => { await api("audio.job.rename", { id: rename.id, name: rename.name.trim() }); setRename(null); await refresh(); }, "音频名称已更新")}>确认修改</button></div></Modal>}
  </aside>;
}

function InstructionLibrary({ kind, presets, history, onClose, apply, refresh, edit }: {
  kind: "history" | "presets" | "favorites"; presets: InstructionPreset[];
  history: InstructionHistory[]; onClose: () => void; apply: (content: string) => void;
  refresh: () => Promise<void>; edit: (preset: Partial<InstructionPreset>) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const title = kind === "history" ? "历史指令" : kind === "favorites" ? "收藏指令" : "情绪预设";
  const rows = kind === "history" ? history : presets.filter((item) => kind === "presets" || item.favorite);
  const move = async (id: string, direction: -1 | 1) => {
    const index = presets.findIndex((item) => item.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= presets.length) return;
    const ids = presets.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await api("audio.presets.reorder", { ids }); await refresh();
  };
  const drop = async (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const ids = presets.map((item) => item.id).filter((id) => id !== dragging);
    ids.splice(ids.indexOf(targetId), 0, dragging);
    await api("audio.presets.reorder", { ids }); setDragging(null); await refresh();
  };
  return <Modal title={title} wide onClose={onClose}><p className="notice">点击整条仅查看；只有“应用”会替换当前配置中的指令。</p>{kind !== "history" && <button className="primary" onClick={() => edit({ name: "", content: "", notes: "", favorite: false })}>＋ 新增预设</button>}
    <div className="instruction-list">{rows.map((row, index) => {
      const preset = "position" in row ? row : null;
      return <article key={row.id} draggable={Boolean(preset)} onDragStart={() => setDragging(row.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => void run(() => drop(row.id))}>
        {preset && <div className="sort-controls"><span title="拖拽排序">⠿</span><button disabled={index === 0} onClick={() => void run(() => move(row.id, -1))}>↑</button><button disabled={index === presets.length - 1} onClick={() => void run(() => move(row.id, 1))}>↓</button><b>{String(index + 1).padStart(2, "0")}</b></div>}
        <div className="instruction-copy"><strong>{preset ? preset.name : "历史指令"}</strong><p>{row.content}</p><small>{preset ? preset.notes : `${(row as InstructionHistory).configName} · ${time((row as InstructionHistory).lastUsedAt)}`}</small></div>
        <div className="instruction-row-actions"><button onClick={() => apply(row.content)}>应用</button>{preset ? <button onClick={() => edit(preset)}>编辑</button> : <button onClick={() => edit({ name: "历史指令", content: row.content, notes: `来源配置：${(row as InstructionHistory).configName}`, favorite: row.favorite })}>另存为预设</button>}<button onClick={() => void run(async () => { if (preset) await api("audio.presets.save", { ...preset, favorite: !preset.favorite }); else await api("audio.history.favorite", { id: row.id, favorite: !row.favorite }); await refresh(); })}>{row.favorite ? "取消收藏" : "收藏"}</button><button onClick={() => void run(async () => { if (preset) await api("audio.presets.delete", { id: row.id }); else await api("audio.history.delete", { id: row.id }); await refresh(); })}>删除</button></div>
      </article>;
    })}{!rows.length && <Empty title="暂无内容" description="实际使用过的指令、预设或收藏会显示在这里。" />}</div>
  </Modal>;
}

function PresetEditor({ value, onClose, onSaved }: { value: Partial<InstructionPreset>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(value), count = instructionLength(draft.content ?? "");
  return <Modal title={value.id ? "编辑预设" : "另存为新预设"} onClose={onClose}><Field label="预设名称"><input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field><Field label="情绪指令" hint={`${count} / 100`}><textarea value={draft.content ?? ""} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></Field><Field label="备注"><input value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field><label className="check"><input type="checkbox" checked={Boolean(draft.favorite)} onChange={(e) => setDraft({ ...draft, favorite: e.target.checked })} /> 收藏</label><button className="primary" disabled={!draft.name?.trim() || !draft.content?.trim() || count > 100} onClick={() => void run(async () => { await api("audio.presets.save", draft); await onSaved(); }, "预设已保存")}>保存预设</button></Modal>;
}

interface CloneDraft {
  name: string; notes: string; accountId: string; asset: Asset | null; assetId: string;
  maxPromptAudioLength: number; enablePreprocess: boolean; enableVolumeNormalization: boolean;
  sourceVoiceId: string | null; sourceTaskId: string | null; sourceConfigId: string | null;
  sourceAudioPath: string | null; experimental: boolean;
}
const emptyClone = (): CloneDraft => ({ name: "", notes: "", accountId: "", asset: null, assetId: "", maxPromptAudioLength: 20, enablePreprocess: false, enableVolumeNormalization: false, sourceVoiceId: null, sourceTaskId: null, sourceConfigId: null, sourceAudioPath: null, experimental: false });

export function VoiceClonePage() {
  const { boot, message, setPage } = useApp();
  const [voices, setVoices] = useState<Voice[]>([]), [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CloneDraft>(emptyClone());
  const accounts = (boot?.accounts.filter((item) => item.enabled && item.providerId === "alibaba" && item.region === "cn-beijing") ?? [])
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const refresh = async () => setVoices(await api<Voice[]>("voices.list"));
  useEffect(() => { void run(async () => {
    await refresh();
    const reclone = await api<Partial<CloneDraft> | null>("audio.reclone.draft");
    if (reclone) {
      const asset = reclone.assetId ? await api<Asset>("assets.get", { id: reclone.assetId }) : null;
      setDraft({ ...emptyClone(), ...reclone, asset, experimental: true });
      setCreating(true);
    }
  }); }, []);
  const openCreate = () => { setDraft({ ...emptyClone(), accountId: accounts[0]?.id ?? "" }); setCreating(true); };
  return <section className="audio-page voice-workbench"><div className="page-title audio-title"><div><h1>复刻音色</h1><p>上传参考音频，核对参数，再创建独立且可追溯的音色版本。</p></div><button className="primary" onClick={openCreate}>＋ 创建新音色</button></div><div className="voice-overview"><strong>CosyVoice 3.5 Plus</strong><span>每次创建都会返回新的 voice_id，不会覆盖已有音色。</span></div>
    <div className="voice-grid">{voices.map((voice) => <VoiceCard key={voice.id} voice={voice} voices={voices} refresh={refresh} setPage={setPage} />)}{!voices.length && <Empty title="还没有音色" description="上传 3–20 秒可解码的人声参考音频，创建第一个 CosyVoice 3.5 Plus 音色。" action={<button className="primary" onClick={openCreate}>创建音色</button>} />}</div>
    {creating && <CloneWorkflow value={draft} accounts={accounts} onClose={() => { setCreating(false); void api("audio.reclone.clear"); }} onCreated={async (voice) => { setCreating(false); await api("audio.reclone.clear"); await refresh(); message(`音色“${voice.name}”已创建并保存完整 voice_id`); }} />}
  </section>;
}

function VoiceCard({ voice, voices, refresh, setPage }: { voice: Voice; voices: Voice[]; refresh: () => Promise<void>; setPage: (page: string) => void }) {
  const [notes, setNotes] = useState(voice.notes), [name, setName] = useState(voice.name);
  const pinned = voices.filter((item) => item.pinned), pinIndex = pinned.findIndex((item) => item.id === voice.id);
  const move = async (direction: -1 | 1) => {
    const target = pinIndex + direction;
    if (pinIndex < 0 || target < 0 || target >= pinned.length) return;
    const ids = pinned.map((item) => item.id);
    [ids[pinIndex], ids[target]] = [ids[target], ids[pinIndex]];
    await api("voices.reorder", { ids }); await refresh();
  };
  return <article className={voice.pinned ? "voice-card pinned" : "voice-card"}><header><div><strong>{voice.name}</strong><span>{voice.isDefault ? "默认" : voice.pinned ? "置顶" : "音色"}</span></div><small>{voice.status === "ready" ? "可用" : voice.status === "pending" ? "处理中" : voice.status === "unavailable" ? "不可用" : "状态待确认"}</small></header>{voice.referenceAssetId && <audio controls preload="metadata" src={media("asset", voice.referenceAssetId)} />}<label>名称<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void run(async () => { await api("voices.save", { id: voice.id, name }); await refresh(); }, "名称已保存")} /></label><label>备注<input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void run(async () => { await api("voices.save", { id: voice.id, notes }); await refresh(); }, "备注已保存")} /></label><div className="voice-meta"><span>参考：{voice.referenceName} · {voice.referenceDuration.toFixed(1)} 秒</span><span>创建：{time(voice.createdAt)}</span>{voice.voiceId && <code>{voice.voiceId}</code>}</div>{voice.lastError && <p className="error-detail">{voice.lastError}</p>}{voice.sourceTaskId && <p className="experimental">实验性音色迭代 · 来源生成任务已关联</p>}<div className="actions">{voice.voiceId && <button onClick={() => void navigator.clipboard.writeText(voice.voiceId)}>复制 voice_id</button>}<button onClick={() => void run(async () => { await api("voices.save", { id: voice.id, pinned: !voice.pinned }); await refresh(); })}>{voice.pinned ? "取消置顶" : "置顶"}</button>{voice.pinned && <><button disabled={pinIndex <= 0} onClick={() => void run(() => move(-1))}>上移</button><button disabled={pinIndex < 0 || pinIndex >= pinned.length - 1} onClick={() => void run(() => move(1))}>下移</button></>}<button disabled={!voice.voiceId} onClick={() => void run(async () => { await api("voices.save", { id: voice.id, isDefault: !voice.isDefault }); await refresh(); }, voice.isDefault ? "已取消默认音色" : "默认音色已更新")}>{voice.isDefault ? "取消默认" : "设为默认"}</button><button disabled={!voice.voiceId} onClick={() => { sessionStorage.setItem("audio-explicit-voice", voice.id); setPage("生成音频"); }}>进入生成</button><button onClick={() => void run(async () => { await api("voices.remove", { id: voice.id }); await refresh(); })}>删除</button></div></article>;
}

function CloneWorkflow({ value, accounts, onClose, onCreated }: { value: CloneDraft; accounts: Account[]; onClose: () => void; onCreated: (voice: Voice) => Promise<void> }) {
  const [form, setForm] = useState<CloneDraft>({
    ...value,
    accountId:
      accounts.find((item) => item.id === value.accountId)?.id ??
      accounts[0]?.id ??
      "",
  });
  const [busy, setBusy] = useState(false), [stage, setStage] = useState("等待上传参考音频");
  const duration = Number(form.asset?.duration || 0), assetValid = Boolean(form.asset && form.asset.kind === "audio" && duration >= 3 && duration <= 20 && Number(form.asset.sampleRate) > 0);
  const choose = async () => {
    const rows = await api<{ asset: Asset }[]>("assets.import", { copy: false, kind: "audio" });
    const asset = rows[0]?.asset;
    if (!asset) return;
    setForm((current) => ({ ...current, asset, assetId: asset.id }));
    if (!asset.duration) throw new Error("音频无法解码\n实际检测：未读取到真实时长\n失败原因：文件元数据不可用。\n解决方法：重新导出为 WAV、MP3 或 M4A 后上传。");
    if (asset.duration > 20) throw new Error(`参考音频超过当前上限\n实际检测：当前音频：${asset.duration.toFixed(1)} 秒；当前工作流上限：20.0 秒\n失败原因：本产品不会静默截取前 20 秒。\n解决方法：请先裁剪至 20 秒以内，再创建音色。`);
    if (asset.duration < 3) throw new Error(`参考音频短于接口下限\n实际检测：当前音频：${asset.duration.toFixed(1)} 秒\n失败原因：官方接口至少需要 3.0 秒。\n解决方法：请提供 3–20 秒音频。`);
    if (!asset.sampleRate) throw new Error("采样率不符合要求\n实际检测：无法读取采样率\n失败原因：音频无法完整解码。\n解决方法：重新导出为常见采样率的 WAV、MP3 或 M4A。");
    setStage("参考音频校验通过");
  };
  const create = async () => {
    if (busy || !assetValid) return;
    setBusy(true);
    try {
      setStage("正在上传参考音频并确认服务端可访问");
      await run(async () => {
        setStage("正在调用 voice-enrollment 创建音色");
        const voice = await api<Voice>("voices.clone", {
          accountId: form.accountId, assetId: form.assetId, name: form.name, notes: form.notes,
          languageHints: ["zh"], maxPromptAudioLength: form.maxPromptAudioLength,
          enablePreprocess: form.enablePreprocess, enableVolumeNormalization: form.enableVolumeNormalization,
          sourceVoiceId: form.sourceVoiceId, sourceTaskId: form.sourceTaskId,
          sourceConfigId: form.sourceConfigId, sourceAudioPath: form.sourceAudioPath,
        });
        setStage("已保存 voice_id，音色状态查询完成"); await onCreated(voice);
      });
    } finally { setBusy(false); }
  };
  return <Modal title={form.experimental ? "实验性音色迭代" : "创建 CosyVoice 音色"} wide onClose={() => { if (!busy) onClose(); }}>
    {form.experimental && <p className="notice">当前成品已作为新参考音频带入。二次复刻不会覆盖原音色，也不承诺提高相似度。</p>}
    <div className="clone-steps"><span className={form.asset ? "done" : "active"}>01 上传参考音频</span><span className={form.asset ? "active" : ""}>02 配置复刻参数</span><span>03 创建并管理音色</span></div>
    <section className="clone-panel"><h3>01 上传参考音频</h3><p>支持可解码的 WAV、MP3、M4A；本工作流限制 3–20 秒，不会静默裁剪。</p><button disabled={busy} onClick={() => void run(choose)}>选择参考音频</button>{form.asset && <div className={assetValid ? "reference-summary valid" : "reference-summary invalid"}><audio controls src={media("asset", form.asset.id)} /><div><strong>{form.asset.name}</strong><span>{form.asset.duration?.toFixed(1) ?? "未知"} 秒 · {form.asset.sampleRate || "未知"} Hz · {form.asset.channels || "未知"} 声道 · {(form.asset.size / 1024 / 1024).toFixed(2)} MB</span>{duration >= 3 && duration < 10 && <small>样本短于推荐的 10 秒，可能影响复刻质量。</small>}</div></div>}</section>
    <section className="clone-panel"><h3>02 配置复刻参数</h3><Field label="音色名称"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：品牌主理人 V1" /></Field>{!accounts.length && <p className="validation-reason">请先在“模型与 API”配置北京地域连接。</p>}<Field label="备注"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field><details><summary>高级选项</summary><div className="form-grid"><Field label="语言"><input value="中文 (zh)" disabled /></Field><Field label="参考音频最大使用时长"><input type="number" min={3} max={20} step={0.1} value={form.maxPromptAudioLength} onChange={(e) => setForm({ ...form, maxPromptAudioLength: Number(e.target.value) })} /></Field></div><label className="check"><input type="checkbox" checked={form.enablePreprocess} onChange={(e) => setForm({ ...form, enablePreprocess: e.target.checked })} /> 音频预处理（可能改变音频特征）</label><label className="check"><input type="checkbox" checked={form.enableVolumeNormalization} onChange={(e) => setForm({ ...form, enableVolumeNormalization: e.target.checked })} /> 音量归一化</label></details></section>
    <section className="clone-panel"><h3>03 创建参数摘要</h3><dl className="parameter-summary"><div><dt>模型</dt><dd>cosyvoice-v3.5-plus</dd></div><div><dt>接口</dt><dd>voice-enrollment / create_voice</dd></div><div><dt>语言</dt><dd>zh</dd></div><div><dt>最大时长</dt><dd>{form.maxPromptAudioLength.toFixed(1)} 秒</dd></div><div><dt>预处理 / 归一化</dt><dd>{form.enablePreprocess ? "开" : "关"} / {form.enableVolumeNormalization ? "开" : "关"}</dd></div></dl><p className="progress-copy">{stage}</p><button className="primary" disabled={busy || !assetValid || !form.name.trim() || !form.accountId || form.maxPromptAudioLength < 3 || form.maxPromptAudioLength > 20} onClick={() => void create()}>{busy ? "正在创建，禁止重复提交…" : "确认创建音色"}</button></section>
  </Modal>;
}
