import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dropzone } from './components/Dropzone';
import {
  ProcessingStatus,
  VideoMetadata,
  ProcessingResult,
  QueueItem,
  QualityPreset,
  QUALITY_PRESETS,
} from './types';
import { accelerateVideo, checkBackendHealth, getApiBase } from './services/api';
import {
  ZapIcon,
  FileVideoIcon,
  Loader2Icon,
  CheckCircleIcon,
  DownloadIcon,
  PlayIcon,
  ServerIcon,
  VolumeXIcon,
  Volume2Icon,
  BellIcon,
  XIcon,
  RefreshIcon,
  PlayCircleIcon,
} from './components/Icons';

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatDuration = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const extractMetadata = (file: File): Promise<VideoMetadata> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        sizeMb: file.size / (1024 * 1024),
      });
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => reject(new Error('Falha ao ler metadados'));
    video.src = URL.createObjectURL(file);
  });

const extractThumbnail = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      video.currentTime = Math.min(1, video.duration);
    };
    video.onseeked = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas não suportado')); return; }
      ctx.drawImage(video, 0, 0);
      URL.revokeObjectURL(video.src);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    video.onerror = () => reject(new Error('Falha ao extrair thumbnail'));
    video.src = URL.createObjectURL(file);
  });

// ─── Status badge ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ProcessingStatus, { label: string; className: string }> = {
  [ProcessingStatus.IDLE]:       { label: 'AGUARDANDO',  className: 'text-slate-500 bg-slate-900/80' },
  [ProcessingStatus.QUEUED]:     { label: 'NA FILA',     className: 'text-amber-400 bg-amber-950/40 animate-pulse' },
  [ProcessingStatus.PROCESSING]: { label: 'PROCESSANDO', className: 'text-cyan-400 bg-cyan-950/40' },
  [ProcessingStatus.COMPLETED]:  { label: 'CONCLUÍDO',   className: 'text-green-400 bg-green-950/40' },
  [ProcessingStatus.ERROR]:      { label: 'ERRO',        className: 'text-red-400 bg-red-950/40' },
  [ProcessingStatus.CANCELLED]:  { label: 'CANCELADO',   className: 'text-slate-400 bg-slate-900/80' },
};

const StatusBadge: React.FC<{ status: ProcessingStatus }> = ({ status }) => {
  const c = STATUS_CONFIG[status];
  return (
    <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border border-white/5 whitespace-nowrap ${c.className}`}>
      {c.label}
    </span>
  );
};

// ─── App ─────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [queue, setQueue] = useState<QueueItem[]>([]);

  // Default settings applied to every new file added
  const [defaults, setDefaults] = useState<{
    speed: number;
    qualityPreset: QualityPreset;
    muteAudio: boolean;
  }>({ speed: 1.5, qualityPreset: 'balanceado', muteAudio: false });

  const [autoDownload, setAutoDownload] = useState(false);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);

  // ── Derived counts ──────────────────────────────────────────────────────────
  const idleCount      = queue.filter(i => i.status === ProcessingStatus.IDLE).length;
  const completedCount = queue.filter(i => i.status === ProcessingStatus.COMPLETED).length;
  const activeCount    = queue.filter(i =>
    i.status === ProcessingStatus.PROCESSING || i.status === ProcessingStatus.QUEUED
  ).length;

  // ── Health check ────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => setIsBackendOnline(await checkBackendHealth());
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Item updater ────────────────────────────────────────────────────────────
  const updateItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }, []);

  // ── Add files to queue ──────────────────────────────────────────────────────
  const handleFilesSelect = (files: File[]) => {
    const toAdd: QueueItem[] = [];
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024 * 1024) continue;
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      toAdd.push({
        id, file, previewUrl,
        speed: defaults.speed,
        qualityPreset: defaults.qualityPreset,
        muteAudio: defaults.muteAudio,
        status: ProcessingStatus.IDLE,
        progress: 0,
        abortController: null,
      });
      extractMetadata(file).then(m => updateItem(id, { metadata: m })).catch(() => {});
      extractThumbnail(file).then(t => updateItem(id, { thumbnailUrl: t })).catch(() => {});
    }
    if (toAdd.length) setQueue(prev => [...prev, ...toAdd]);
  };

  // ── Remove one item ─────────────────────────────────────────────────────────
  const handleRemoveItem = (id: string) => {
    if (previewItemId === id) setPreviewItemId(null);
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item) {
        item.abortController?.abort();
        URL.revokeObjectURL(item.previewUrl);
        if (item.result?.downloadUrl) URL.revokeObjectURL(item.result.downloadUrl);
      }
      return prev.filter(i => i.id !== id);
    });
  };

  // ── Clear all completed ─────────────────────────────────────────────────────
  const handleClearCompleted = () => {
    setQueue(prev => {
      prev.filter(i => i.status === ProcessingStatus.COMPLETED)
          .forEach(i => { if (i.result?.downloadUrl) URL.revokeObjectURL(i.result.downloadUrl); });
      return prev.filter(i => i.status !== ProcessingStatus.COMPLETED);
    });
  };

  // ── Clear entire queue ──────────────────────────────────────────────────────
  const handleClearAll = () => {
    setPreviewItemId(null);
    setQueue(prev => {
      prev.forEach(i => {
        i.abortController?.abort();
        URL.revokeObjectURL(i.previewUrl);
        if (i.result?.downloadUrl) URL.revokeObjectURL(i.result.downloadUrl);
      });
      return [];
    });
  };

  // ── Process a single queue item ─────────────────────────────────────────────
  const processItem = async (itemId: string) => {
    const item = queue.find(i => i.id === itemId);
    if (!item || item.status !== ProcessingStatus.IDLE) return;

    const { preset, crf } = QUALITY_PRESETS[item.qualityPreset];
    const controller = new AbortController();

    updateItem(itemId, {
      status: ProcessingStatus.PROCESSING,
      progress: 0,
      error: undefined,
      abortController: controller,
    });

    let lastFallbackProg = 0;
    let usingRealProgress = false;
    const fallbackInterval = setInterval(() => {
      if (usingRealProgress) return;
      lastFallbackProg = Math.min(
        lastFallbackProg + (lastFallbackProg < 30 ? 2 : lastFallbackProg < 60 ? 1 : 0.3),
        90,
      );
      updateItem(itemId, { progress: lastFallbackProg });
    }, 500);

    try {
      const data = await accelerateVideo(
        item.file,
        item.speed,
        (progress, _message, backendStatus) => {
          usingRealProgress = true;
          clearInterval(fallbackInterval);
          updateItem(itemId, {
            progress: Math.min(progress, 99),
            status: backendStatus === 'queued'
              ? ProcessingStatus.QUEUED
              : ProcessingStatus.PROCESSING,
          });
        },
        controller.signal,
        { preset, crf, muteAudio: item.muteAudio },
      );

      clearInterval(fallbackInterval);
      updateItem(itemId, {
        status: ProcessingStatus.COMPLETED,
        progress: 100,
        result: data,
        abortController: null,
      });

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('TurboFrame — Pronto!', {
          body: `"${item.file.name}" processado com sucesso.`,
          icon: '/favicon.ico',
        });
      }

      if (autoDownload) triggerDownload(data.downloadUrl, data.processedName);

    } catch (err: unknown) {
      clearInterval(fallbackInterval);
      if (err instanceof DOMException && err.name === 'AbortError') {
        updateItem(itemId, { status: ProcessingStatus.IDLE, progress: 0, abortController: null });
      } else {
        const message = err instanceof Error ? err.message : 'Erro desconhecido';
        updateItem(itemId, { status: ProcessingStatus.ERROR, error: message, abortController: null });
      }
    }
  };

  const handleProcessAll = () => {
    queue.filter(i => i.status === ProcessingStatus.IDLE).forEach(i => processItem(i.id));
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') return;
    setNotifPermission(await Notification.requestPermission());
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const previewItem = previewItemId ? queue.find(i => i.id === previewItemId) ?? null : null;

  return (
    <div className="min-h-screen text-slate-100 font-sans selection:bg-cyber-purple/30 pb-20">

      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[500px] bg-cyber-purple/10 blur-[120px] rounded-full mix-blend-screen"></div>
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-cyber-blue/10 blur-[100px] rounded-full mix-blend-screen"></div>
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="relative z-10 border-b border-white/5 bg-cyber-panel/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3 select-none">
            <div className="relative group cursor-default">
              <div className="absolute inset-0 bg-metallic-gradient blur opacity-20 group-hover:opacity-50 transition duration-500 rounded-lg"></div>
              <div className="relative p-2 bg-black rounded-lg border border-white/10 group-hover:border-yellow-400/50 transition-colors duration-300">
                <ZapIcon className="w-6 h-6 text-yellow-400 transition-all duration-300 group-hover:drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold tracking-wider text-white">
                TURBO<span className="text-transparent bg-clip-text bg-metallic-gradient">FRAME</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {typeof Notification !== 'undefined' && notifPermission === 'default' && (
              <button
                onClick={requestNotificationPermission}
                title="Ativar notificações"
                className="flex items-center space-x-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/5 hover:border-cyber-purple/50 transition text-slate-400 hover:text-white"
              >
                <BellIcon className="w-4 h-4" />
                <span className="text-xs hidden sm:inline">Notificações</span>
              </button>
            )}
            {notifPermission === 'granted' && (
              <div title="Notificações ativas" className="text-green-400/50">
                <BellIcon className="w-4 h-4" />
              </div>
            )}

            <div className="flex items-center space-x-3 bg-black/40 px-4 py-1.5 rounded-full border border-white/5 backdrop-blur-md">
              <ServerIcon className={`w-4 h-4 ${isBackendOnline ? 'text-green-400' : 'text-red-500'}`} />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Engine</span>
                <span className={`text-xs font-medium ${isBackendOnline ? 'text-green-400' : 'text-red-400'}`}>
                  {isBackendOnline ? 'ONLINE' : 'DESCONECTADO'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* ── LEFT: Dropzone + action ─────────────────────────────────── */}
          <div className="lg:col-span-4 flex flex-col gap-5">

            {/* Dropzone */}
            {queue.length === 0 ? (
              <Dropzone onFilesSelect={handleFilesSelect} />
            ) : (
              <Dropzone onFilesSelect={handleFilesSelect} compact />
            )}

            {/* Stats + actions */}
            {queue.length > 0 && (
              <div className="bg-black/30 border border-white/5 rounded-2xl p-4 space-y-4">
                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-black/40 rounded-xl py-3">
                    <p className="text-xl font-display font-bold text-white">{idleCount}</p>
                    <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wide mt-0.5">Na fila</p>
                  </div>
                  <div className="bg-black/40 rounded-xl py-3">
                    <p className={`text-xl font-display font-bold ${activeCount > 0 ? 'text-cyan-400' : 'text-white'}`}>{activeCount}</p>
                    <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wide mt-0.5">Processando</p>
                  </div>
                  <div className="bg-black/40 rounded-xl py-3">
                    <p className={`text-xl font-display font-bold ${completedCount > 0 ? 'text-green-400' : 'text-white'}`}>{completedCount}</p>
                    <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wide mt-0.5">Concluídos</p>
                  </div>
                </div>

                {/* Auto-download toggle */}
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <DownloadIcon className="w-3.5 h-3.5" />
                    Download automático
                  </div>
                  <button
                    onClick={() => setAutoDownload(p => !p)}
                    className={`relative w-10 h-5 rounded-full transition-all duration-300 ${autoDownload ? 'bg-cyber-purple' : 'bg-white/10'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all duration-300 ${autoDownload ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                <div className="h-px bg-white/5" />

                {/* Process button */}
                <button
                  onClick={handleProcessAll}
                  disabled={idleCount === 0 || !isBackendOnline}
                  className={`
                    relative w-full py-4 rounded-xl font-display font-bold text-lg tracking-widest uppercase transition-all duration-300 overflow-hidden group
                    ${idleCount === 0 || !isBackendOnline
                      ? 'bg-slate-800/50 text-slate-500 cursor-not-allowed border border-white/5'
                      : 'text-white'
                    }
                  `}
                >
                  {!isBackendOnline ? (
                    <span className="flex items-center justify-center text-base">API DESCONECTADA</span>
                  ) : idleCount === 0 ? (
                    <span className="flex items-center justify-center text-base">
                      {activeCount > 0
                        ? <><Loader2Icon className="w-5 h-5 mr-2 animate-spin text-cyan-400" />PROCESSANDO...</>
                        : 'TUDO PROCESSADO'
                      }
                    </span>
                  ) : (
                    <>
                      <div className="absolute inset-0 bg-metallic-gradient opacity-90 group-hover:opacity-100 transition duration-300" />
                      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20" />
                      <span className="relative z-10 flex items-center justify-center">
                        PROCESSAR {idleCount} ARQUIVO{idleCount !== 1 ? 'S' : ''}
                        <ZapIcon className="w-5 h-5 ml-2 fill-white" />
                      </span>
                    </>
                  )}
                </button>

                {!isBackendOnline && (
                  <p className="text-[10px] text-red-400 text-center">
                    Docker não encontrado em {getApiBase()}
                  </p>
                )}

                {/* Queue management */}
                <div className="flex justify-between text-[10px] font-mono text-slate-600">
                  {completedCount > 0 && (
                    <button onClick={handleClearCompleted} className="hover:text-green-400 transition">
                      Limpar concluídos
                    </button>
                  )}
                  <button onClick={handleClearAll} className="hover:text-red-400 transition ml-auto">
                    Limpar tudo
                  </button>
                </div>
              </div>
            )}

            {/* Empty state hint */}
            {queue.length === 0 && (
              <div className="flex items-center gap-2 text-slate-600 text-xs font-mono justify-center mt-2">
                <span>Múltiplos arquivos suportados</span>
              </div>
            )}
          </div>

          {/* ── RIGHT: Queue panel ───────────────────────────────────────── */}
          <div className="lg:col-span-8">
            <div className="h-full min-h-[540px] bg-cyber-panel border border-white/10 rounded-3xl overflow-hidden flex flex-col shadow-2xl">

              {/* Panel header */}
              <div className="h-14 border-b border-white/5 bg-black/20 flex items-center justify-between px-5 flex-shrink-0">
                <div className="flex items-center space-x-3">
                  <div className="flex space-x-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                    <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 tracking-wide uppercase">
                    Fila de processamento
                    {queue.length > 0 && <span className="ml-2 text-slate-400">· {queue.length} arquivo{queue.length !== 1 ? 's' : ''}</span>}
                  </span>
                </div>
              </div>

              {/* Queue list */}
              <div className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 to-black">
                {queue.length === 0 ? (
                  <div className="h-full flex items-center justify-center p-6">
                    <div className="text-center opacity-30 select-none">
                      <PlayIcon className="w-20 h-20 mx-auto mb-4 text-white" />
                      <h3 className="text-2xl font-display font-bold text-white tracking-widest">FILA VAZIA</h3>
                      <p className="text-sm font-mono mt-2">Arraste vídeos para o dropzone para começar</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 space-y-2">
                    {queue.map(item => (
                      <QueueCard
                        key={item.id}
                        item={item}
                        onRemove={handleRemoveItem}
                        onUpdate={(id, updates) => updateItem(id, updates)}
                        onRetry={(id) => updateItem(id, { status: ProcessingStatus.IDLE, progress: 0, error: undefined })}
                        onPreview={(id) => setPreviewItemId(id)}
                        onDownload={triggerDownload}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* ── Video Preview Modal ─────────────────────────────────────────────── */}
      {previewItem && previewItem.result && (
        <VideoPreviewModal
          item={previewItem}
          onClose={() => setPreviewItemId(null)}
          onDownload={triggerDownload}
        />
      )}
    </div>
  );
};

// ─── Queue Item Card ──────────────────────────────────────────────────────────

interface QueueCardProps {
  item: QueueItem;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<QueueItem>) => void;
  onRetry: (id: string) => void;
  onPreview: (id: string) => void;
  onDownload: (url: string, filename: string) => void;
}

const QueueCard: React.FC<QueueCardProps> = ({ item, onRemove, onUpdate, onRetry, onPreview, onDownload }) => {
  const isActive = item.status === ProcessingStatus.PROCESSING || item.status === ProcessingStatus.QUEUED;
  const isIdle   = item.status === ProcessingStatus.IDLE;

  return (
    <div className="bg-black/40 border border-white/5 rounded-xl overflow-hidden hover:border-white/10 transition-all duration-200 group">

      {/* ── Info row ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-3">
        {/* Thumbnail */}
        <div className="w-[80px] h-[50px] flex-shrink-0 rounded-lg overflow-hidden bg-slate-900 border border-white/5">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileVideoIcon className="w-5 h-5 text-slate-700" />
            </div>
          )}
        </div>

        {/* Text info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate leading-snug">{item.file.name}</p>
          {item.metadata ? (
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {item.metadata.width}×{item.metadata.height}
              {' · '}
              {formatDuration(item.metadata.duration)}
              {' → '}
              <span className="text-cyan-400/80">{formatDuration(item.metadata.duration / item.speed)}</span>
              {' · '}
              {item.metadata.sizeMb.toFixed(1)} MB
            </p>
          ) : (
            <p className="text-[10px] text-slate-600 font-mono mt-0.5">
              {(item.file.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          )}
        </div>

        {/* Status + remove */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={item.status} />
          <button
            onClick={() => onRemove(item.id)}
            title={isActive ? 'Cancelar' : 'Remover'}
            className="p-1 text-slate-600 hover:text-red-400 transition rounded opacity-0 group-hover:opacity-100"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Settings row (IDLE only) ─────────────────────────────────────── */}
      {isIdle && (
        <div className="px-3 pb-3 border-t border-white/5 pt-2.5 flex items-center gap-3">

          {/* Speed value (direct input) */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={item.speed}
              onChange={e => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0.1 && v <= 10) onUpdate(item.id, { speed: Math.round(v * 10) / 10 });
              }}
              className="w-14 bg-black/50 border border-white/10 rounded-md py-1 text-center font-mono text-sm text-cyan-400 font-bold focus:outline-none focus:border-cyber-purple transition-all"
            />
            <span className="text-slate-600 text-xs font-mono">×</span>
          </div>

          {/* Speed slider */}
          <input
            type="range"
            min={0.25}
            max={5}
            step={0.05}
            value={item.speed}
            onChange={e => onUpdate(item.id, { speed: Math.round(parseFloat(e.target.value) * 100) / 100 })}
            className="flex-1 min-w-0"
          />

          {/* Quality preset pills */}
          <div className="flex gap-1 flex-shrink-0">
            {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map(key => (
              <button
                key={key}
                onClick={() => onUpdate(item.id, { qualityPreset: key })}
                className={`text-[9px] font-mono font-bold px-2 py-1 rounded-md transition-all ${
                  item.qualityPreset === key
                    ? 'bg-cyber-purple text-white'
                    : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300'
                }`}
              >
                {QUALITY_PRESETS[key].label}
              </button>
            ))}
          </div>

          {/* Mute toggle */}
          <button
            onClick={() => onUpdate(item.id, { muteAudio: !item.muteAudio })}
            title={item.muteAudio ? 'Áudio removido — clique para ativar' : 'Áudio ativo — clique para remover'}
            className={`flex-shrink-0 p-1.5 rounded-lg transition-all ${
              item.muteAudio
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-white/5 text-slate-500 hover:text-slate-300 hover:bg-white/10'
            }`}
          >
            {item.muteAudio ? <VolumeXIcon className="w-3.5 h-3.5" /> : <Volume2Icon className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* ── Progress bar (QUEUED / PROCESSING) ──────────────────────────── */}
      {isActive && (
        <div className="px-3 pb-3">
          <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
            {item.status === ProcessingStatus.QUEUED ? (
              <div className="h-full w-full bg-amber-500/40 animate-pulse" />
            ) : (
              <div
                className="h-full bg-cyber-purple transition-all duration-300 ease-out"
                style={{ width: `${item.progress}%` }}
              />
            )}
          </div>
          <div className="flex justify-between text-[9px] font-mono text-slate-600 mt-1">
            <span>{item.status === ProcessingStatus.QUEUED ? 'AGUARDANDO SLOT...' : 'PROCESSANDO'}</span>
            {item.status === ProcessingStatus.PROCESSING && <span>{Math.round(item.progress)}%</span>}
          </div>
        </div>
      )}

      {/* ── Completed actions ────────────────────────────────────────────── */}
      {item.status === ProcessingStatus.COMPLETED && item.result && (
        <div className="px-3 pb-3 flex items-center justify-between border-t border-white/5 pt-2.5">
          <div className="flex items-center text-xs text-green-400 gap-1.5">
            <CheckCircleIcon className="w-3.5 h-3.5" />
            Concluído
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPreview(item.id)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-300 bg-white/5 hover:bg-white/15 px-3 py-1.5 rounded-lg transition border border-white/5 hover:border-cyber-purple/40"
            >
              <PlayCircleIcon className="w-3.5 h-3.5" />
              VISUALIZAR
            </button>
            <button
              onClick={() => onDownload(item.result!.downloadUrl, item.result!.processedName)}
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              BAIXAR MP4
            </button>
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {item.status === ProcessingStatus.ERROR && (
        <div className="px-3 pb-3 flex items-center justify-between gap-3 border-t border-white/5 pt-2.5">
          <p className="text-[10px] text-red-400 font-mono truncate flex-1">{item.error}</p>
          <button
            onClick={() => onRetry(item.id)}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white transition flex-shrink-0"
          >
            <RefreshIcon className="w-3 h-3" />
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Video Preview Modal ──────────────────────────────────────────────────────

interface VideoPreviewModalProps {
  item: QueueItem;
  onClose: () => void;
  onDownload: (url: string, filename: string) => void;
}

const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({ item, onClose, onDownload }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!item.result) return null;

  const qualityLabel = QUALITY_PRESETS[item.qualityPreset].label;
  const outputDuration = item.metadata
    ? formatDuration(item.metadata.duration / item.speed)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-3xl bg-cyber-panel border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-start justify-between p-5 border-b border-white/5">
          <div className="min-w-0 flex-1 mr-4">
            <p className="text-sm font-medium text-white truncate">{item.file.name}</p>
            <p className="text-[10px] font-mono text-slate-500 mt-0.5">
              {item.metadata && `${item.metadata.width}×${item.metadata.height} · `}
              {outputDuration && `${outputDuration} · `}
              {item.speed.toFixed(1)}× · {qualityLabel}
              {item.muteAudio && ' · Sem áudio'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-2 text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Video player */}
        <div className="bg-black relative">
          <video
            ref={videoRef}
            src={item.result.downloadUrl}
            controls
            autoPlay
            className="w-full max-h-[65vh] object-contain"
          />
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/5">
          <button
            onClick={() => onDownload(item.result!.downloadUrl, item.result!.processedName)}
            className="flex items-center gap-2 text-sm font-bold text-white bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition"
          >
            <DownloadIcon className="w-4 h-4" />
            BAIXAR MP4
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
