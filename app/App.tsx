import React, { useState, useEffect, useRef } from 'react';
import { Dropzone } from './components/Dropzone';
import { ProcessingStatus, VideoFile, ProcessingResult } from './types';
import { accelerateVideo, checkBackendHealth, getApiBase } from './services/api';
import { 
  ZapIcon, 
  FileVideoIcon, 
  TrashIcon, 
  Loader2Icon, 
  CheckCircleIcon, 
  DownloadIcon,
  PlayIcon,
  ServerIcon,
  LayersIcon,
  ClockIcon
} from './components/Icons';

const App: React.FC = () => {
  const [videoFile, setVideoFile] = useState<VideoFile | null>(null);
  const [speed, setSpeed] = useState<number | string>(1.5); // Allow string for typing handling
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(false);
  
  // UX Features States
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const [viewMode, setViewMode] = useState<'original' | 'processed'>('processed');
  
  const videoRef = useRef<HTMLVideoElement>(null);

  // Health Check Loop
  useEffect(() => {
    const check = async () => {
      const online = await checkBackendHealth();
      setIsBackendOnline(online);
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleFileSelect = (file: File) => {
    if (result?.downloadUrl) URL.revokeObjectURL(result.downloadUrl);
    if (videoFile?.previewUrl) URL.revokeObjectURL(videoFile.previewUrl);
    
    setResult(null);
    setStatus(ProcessingStatus.IDLE);
    setError(null);
    setSimulatedProgress(0);
    setViewMode('processed'); // Default but won't show until processed

    const previewUrl = URL.createObjectURL(file);
    setVideoFile({ file, previewUrl });
  };

  const handleRemoveFile = () => {
    if (videoFile?.previewUrl) URL.revokeObjectURL(videoFile.previewUrl);
    if (result?.downloadUrl) URL.revokeObjectURL(result.downloadUrl);
    
    setVideoFile(null);
    setResult(null);
    setStatus(ProcessingStatus.IDLE);
    setSimulatedProgress(0);
  };

  const handleProcess = async () => {
    if (!videoFile) return;

    // Validate Speed
    const numericSpeed = Number(speed);
    if (isNaN(numericSpeed) || numericSpeed <= 0 || numericSpeed > 10) {
      setError("Por favor, insira uma velocidade válida entre 0.1 e 10");
      setStatus(ProcessingStatus.ERROR);
      return;
    }

    setStatus(ProcessingStatus.PROCESSING);
    setError(null);
    setSimulatedProgress(0);
    setViewMode('processed');

    // Progresso de fallback caso não receba eventos de progresso
    const fallbackInterval = setInterval(() => {
      setSimulatedProgress(prev => {
        // Se já está em 90% ou mais, não incrementa mais (aguarda resposta real)
        if (prev >= 90) return prev;
        // Incremento mais lento para não chegar muito rápido em 90%
        const increment = prev < 30 ? 2 : prev < 60 ? 1 : 0.3;
        return Math.min(prev + increment, 90);
      });
    }, 500);

    try {
      const data = await accelerateVideo(
        videoFile.file, 
        numericSpeed,
        (progress, message) => {
          // Progresso real do upload + processamento FFmpeg
          clearInterval(fallbackInterval);
          setSimulatedProgress(Math.min(progress, 99));
          // Opcional: mostrar mensagem de progresso
          if (message) {
            console.log(`Progresso: ${Math.round(progress)}% - ${message}`);
          }
        }
      );
      
      clearInterval(fallbackInterval);
      setSimulatedProgress(100);
      
      setTimeout(() => {
        setResult(data);
        setStatus(ProcessingStatus.COMPLETED);
      }, 500);
      
    } catch (err: any) {
      clearInterval(fallbackInterval);
      console.error("Erro ao processar vídeo:", err);
      setError(err.message || "Erro desconhecido ao processar");
      setStatus(ProcessingStatus.ERROR);
      setSimulatedProgress(0);
    }
  };

  const handleManualSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow empty string for backspacing everything
    if (val === '') {
      setSpeed('');
      return;
    }
    // Only allow numbers and one decimal point
    if (/^\d*\.?\d*$/.test(val)) {
       setSpeed(val);
    }
  };

  const getSpeedNumber = () => {
    const n = Number(speed);
    return isNaN(n) ? 1.0 : n;
  };

  return (
    <div className="min-h-screen text-slate-100 font-sans selection:bg-cyber-purple/30 pb-20">
      
      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[500px] bg-cyber-purple/10 blur-[120px] rounded-full mix-blend-screen"></div>
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-cyber-blue/10 blur-[100px] rounded-full mix-blend-screen"></div>
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-cyber-panel/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3 select-none">
            {/* LOGO CONTAINER with Hover Glow */}
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

          <div className="flex items-center space-x-3 bg-black/40 px-4 py-1.5 rounded-full border border-white/5 backdrop-blur-md">
             <ServerIcon className={`w-4 h-4 ${isBackendOnline ? 'text-green-400' : 'text-red-500'}`} />
             <div className="flex flex-col">
               <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Status da Engine</span>
               <span className={`text-xs font-medium ${isBackendOnline ? 'text-green-400' : 'text-red-400'}`}>
                 {isBackendOnline ? 'ONLINE' : 'DESCONECTADO'}
               </span>
             </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        
        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* LEFT: Configuration & Input */}
          <div className="lg:col-span-5 space-y-8">
            
            {/* Upload Section */}
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <h2 className="text-xl font-display font-semibold text-white flex items-center">
                  <span className="w-1.5 h-6 bg-metallic-gradient mr-3 rounded-full"></span>
                  ARQUIVO FONTE
                </h2>
                {videoFile && (
                  <button onClick={handleRemoveFile} className="text-xs text-red-400 hover:text-red-300 transition flex items-center bg-red-950/20 px-2 py-1 rounded border border-red-900/30">
                    <TrashIcon className="w-3 h-3 mr-1"/> LIMPAR
                  </button>
                )}
              </div>
              
              {!videoFile ? (
                <Dropzone onFileSelect={handleFileSelect} />
              ) : (
                <div className="relative group rounded-xl overflow-hidden border border-white/10 bg-black shadow-2xl transition-all duration-300 hover:border-cyber-purple/50">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none z-10"></div>
                  {/* Small preview of source */}
                  <video 
                    src={videoFile.previewUrl} 
                    className="w-full h-32 object-cover opacity-60 group-hover:opacity-80 transition duration-500"
                  />
                  <div className="absolute bottom-0 left-0 right-0 p-4 z-20 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-white/10 backdrop-blur rounded-lg border border-white/10">
                        <FileVideoIcon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white truncate max-w-[200px]">{videoFile.file.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{(videoFile.file.size / (1024 * 1024)).toFixed(2)} MB</p>
                      </div>
                    </div>
                    <div className="text-xs font-mono text-cyan-400 bg-cyan-950/30 px-2 py-1 rounded border border-cyan-500/20">
                      PRONTO
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Controls Section (Glass Card) */}
            <div className={`transition-all duration-500 transform ${videoFile ? 'opacity-100 translate-y-0' : 'opacity-40 translate-y-4 pointer-events-none grayscale'}`}>
              <div className="bg-glass border border-white/10 rounded-2xl p-6 backdrop-blur-md relative overflow-hidden group">
                {/* Decorative glow */}
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-cyber-purple/20 blur-[50px] rounded-full pointer-events-none transition duration-500 group-hover:bg-cyber-blue/20"></div>

                <div className="space-y-6 relative z-10">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center">
                      <ClockIcon className="w-4 h-4 text-slate-400 mr-2" />
                      <label className="text-sm font-display font-bold text-slate-300 uppercase tracking-widest">
                        Fator de Velocidade
                      </label>
                    </div>
                    
                    {/* Manual Input Field */}
                    <div className="relative group/input">
                      <input 
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={speed}
                        onChange={handleManualSpeedChange}
                        className="w-24 bg-black/50 border border-white/10 rounded-md py-1.5 pl-3 pr-8 text-right font-mono text-xl text-cyan-400 font-bold focus:outline-none focus:border-cyber-purple focus:shadow-[0_0_15px_rgba(124,58,237,0.3)] transition-all"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-sm pointer-events-none">x</span>
                    </div>
                  </div>

                  {/* Range Slider */}
                  <div className="py-2">
                    <input
                      type="range"
                      min={0.1}
                      max={5.0}
                      step={0.1}
                      value={getSpeedNumber()}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  {/* NOTE: Removed Preset Buttons as requested */}

                  <div className="h-px bg-white/5 my-4"></div>

                  <button
                    onClick={handleProcess}
                    disabled={status === ProcessingStatus.PROCESSING || !isBackendOnline}
                    className={`
                      relative w-full py-4 rounded-xl font-display font-bold text-lg tracking-widest uppercase transition-all duration-300 overflow-hidden group
                      ${status === ProcessingStatus.PROCESSING 
                        ? 'bg-slate-800 text-slate-500 cursor-wait border border-white/5' 
                        : !isBackendOnline 
                          ? 'bg-red-900/20 text-red-500 border border-red-500/20 cursor-not-allowed'
                          : 'text-white shadow-[0_0_20px_rgba(0,0,0,0.5)] hover:shadow-neon-purple'
                      }
                    `}
                  >
                    {!isBackendOnline ? (
                      <span className="flex items-center justify-center">
                        API DESCONECTADA
                      </span>
                    ) : status === ProcessingStatus.PROCESSING ? (
                      <span className="flex items-center justify-center">
                        <Loader2Icon className="w-5 h-5 mr-3 animate-spin text-cyan-400" />
                        PROCESSANDO...
                      </span>
                    ) : (
                      <>
                        <div className="absolute inset-0 bg-metallic-gradient opacity-90 group-hover:opacity-100 transition duration-300"></div>
                        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                        <span className="relative z-10 flex items-center justify-center">
                          INICIAR PROCESSO <ZapIcon className="w-5 h-5 ml-2 fill-white" />
                        </span>
                      </>
                    )}
                  </button>
                  
                  {!isBackendOnline && (
                    <p className="text-[10px] text-red-400 text-center">
                      Certifique-se que o Docker está rodando em {getApiBase()}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Output Display */}
          <div className="lg:col-span-7">
             <div className="h-full min-h-[500px] bg-cyber-panel border border-white/10 rounded-3xl overflow-hidden relative flex flex-col shadow-2xl">
                
                {/* Header of Panel */}
                <div className="h-14 border-b border-white/5 bg-black/20 flex items-center justify-between px-6 z-20">
                  <div className="flex space-x-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                  </div>
                  
                  {/* View Toggle (Only visible when completed) */}
                  {status === ProcessingStatus.COMPLETED && result && (
                    <div className="flex bg-black/50 rounded-lg p-1 border border-white/10">
                      <button
                        onClick={() => setViewMode('original')}
                        className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewMode === 'original' ? 'bg-white/20 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        ORIGINAL
                      </button>
                      <button
                        onClick={() => setViewMode('processed')}
                        className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewMode === 'processed' ? 'bg-cyber-purple text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        RESULTADO ({getSpeedNumber()}x)
                      </button>
                    </div>
                  )}

                  <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono hidden sm:block">
                    Modulo_Previa_v1
                  </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 relative flex items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 to-black p-6">
                  
                  {status === ProcessingStatus.COMPLETED && result ? (
                    <div className="w-full h-full flex flex-col animate-in fade-in duration-700">
                       <div className="flex-1 bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10 relative group">
                          
                          {/* Video Player */}
                          <video 
                            key={viewMode} // Force re-render on switch
                            ref={videoRef}
                            src={viewMode === 'original' && videoFile ? videoFile.previewUrl : result.downloadUrl} 
                            className="w-full h-full object-contain"
                            controls
                            autoPlay
                          />
                          
                          {/* Label Overlay */}
                          <div className="absolute top-4 left-4 px-3 py-1 bg-black/60 backdrop-blur border border-white/10 rounded text-xs font-mono text-white/80 pointer-events-none">
                            {viewMode === 'original' ? 'VÍDEO ORIGINAL' : `VÍDEO ACELERADO (${getSpeedNumber()}x)`}
                          </div>
                       </div>
                       
                       <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                          <div className="flex items-center space-x-4">
                             <div className="flex items-center text-green-400 font-bold font-display text-lg">
                                <CheckCircleIcon className="w-5 h-5 mr-2" />
                                RENDERIZAÇÃO COMPLETA
                             </div>
                             <div className="h-4 w-px bg-white/10 hidden sm:block"></div>
                             <div className="flex items-center text-xs text-slate-400 cursor-help" title="Alterne a visualização acima para comparar">
                                <LayersIcon className="w-4 h-4 mr-1" />
                                Modo de Comparação Ativo
                             </div>
                          </div>
                          
                          <a
                            href={result.downloadUrl}
                            download={result.processedName}
                            className="w-full sm:w-auto flex items-center justify-center px-8 py-3 bg-white text-black rounded-lg font-bold hover:bg-cyan-50 hover:scale-105 transition duration-200 shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                          >
                            <DownloadIcon className="w-5 h-5 mr-2" />
                            BAIXAR MP4
                          </a>
                       </div>
                    </div>
                  ) : status === ProcessingStatus.ERROR ? (
                    <div className="text-center">
                       <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                          <span className="text-3xl">⚠️</span>
                       </div>
                       <h3 className="text-xl font-display font-bold text-white mb-2">Falha no Sistema</h3>
                       <p className="text-red-400 max-w-sm mx-auto bg-red-950/30 p-4 rounded border border-red-900/50 font-mono text-xs">
                         {error}
                       </p>
                       <button onClick={() => setStatus(ProcessingStatus.IDLE)} className="mt-6 text-slate-400 hover:text-white underline text-sm">Reiniciar Sistema</button>
                    </div>
                  ) : status === ProcessingStatus.PROCESSING ? (
                    <div className="w-full max-w-md space-y-8">
                       <div className="text-center">
                         <div className="relative w-24 h-24 mx-auto mb-6">
                            <div className="absolute inset-0 rounded-full border-t-2 border-l-2 border-cyber-purple animate-spin"></div>
                            <div className="absolute inset-2 rounded-full border-r-2 border-b-2 border-cyber-blue animate-spin animation-delay-150"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                               <ZapIcon className="w-8 h-8 text-white animate-pulse" />
                            </div>
                         </div>
                         <h3 className="text-2xl font-display font-bold text-white tracking-widest animate-pulse">PROCESSANDO</h3>
                         <p className="text-cyan-400/60 font-mono text-xs mt-2">Executando algoritmo de aceleração FFmpeg...</p>
                       </div>

                       {/* Fake Progress Bar */}
                       <div className="space-y-2">
                         <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-white/5">
                           <div 
                              className="h-full bg-metallic-gradient transition-all duration-300 ease-out"
                              style={{ width: `${simulatedProgress}%` }}
                           ></div>
                         </div>
                         <div className="flex justify-between text-[10px] font-mono text-slate-500">
                           <span>ENVIANDO & PROCESSANDO</span>
                           <span>{Math.round(simulatedProgress)}%</span>
                         </div>
                       </div>
                    </div>
                  ) : (
                    <div className="text-center opacity-30 select-none">
                       <PlayIcon className="w-24 h-24 mx-auto mb-4 text-white" />
                       <h3 className="text-3xl font-display font-bold text-white tracking-widest">AGUARDANDO ARQUIVO</h3>
                       <p className="text-sm font-mono mt-2">Selecione um arquivo para começar</p>
                    </div>
                  )}

                </div>
             </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;