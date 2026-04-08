import React, { useRef, useState } from 'react';
import { UploadCloudIcon, FileVideoIcon } from './Icons';

interface DropzoneProps {
  onFilesSelect: (files: File[]) => void;
  accept?: string;
  disabled?: boolean;
  compact?: boolean;
}

export const Dropzone: React.FC<DropzoneProps> = ({
  onFilesSelect,
  accept = 'video/*',
  disabled = false,
  compact = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/'));
      if (files.length > 0) {
        onFilesSelect(files);
      }
    }
  };

  const handleClick = () => {
    if (!disabled && inputRef.current) inputRef.current.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('video/'));
      if (files.length > 0) onFilesSelect(files);
      // reset so the same file can be re-selected
      e.target.value = '';
    }
  };

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple
      onChange={handleInputChange}
      className="hidden"
      disabled={disabled}
    />
  );

  if (compact) {
    return (
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          flex items-center justify-center w-full h-11 rounded-xl border border-dashed cursor-pointer transition-all duration-300
          ${disabled ? 'opacity-40 cursor-not-allowed border-white/5' : ''}
          ${isDragOver
            ? 'border-cyber-blue bg-cyber-blue/10 scale-[1.01]'
            : 'border-white/10 hover:border-cyber-purple/50 hover:bg-white/5'
          }
        `}
      >
        {hiddenInput}
        <span className="text-xs font-mono text-slate-500">
          + ADICIONAR MAIS ARQUIVOS
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative group flex flex-col items-center justify-center w-full h-64 rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer overflow-hidden
        ${disabled ? 'opacity-50 cursor-not-allowed border-white/5 bg-black' : ''}
        ${isDragOver
          ? 'border-cyber-blue bg-cyber-blue/10 scale-[1.01] shadow-neon-blue'
          : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-cyber-purple hover:shadow-neon-purple'
        }
      `}
    >
      {hiddenInput}

      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 pointer-events-none"></div>

      <div className="flex flex-col items-center justify-center space-y-4 text-center p-6 relative z-10">
        <div className={`p-5 rounded-full transition-all duration-300 ${isDragOver ? 'bg-cyber-blue text-black' : 'bg-white/5 text-slate-300 group-hover:bg-cyber-purple group-hover:text-white'}`}>
          {isDragOver ? <FileVideoIcon className="w-10 h-10" /> : <UploadCloudIcon className="w-10 h-10" />}
        </div>
        <div className="space-y-1">
          <p className="text-lg font-display font-bold text-white tracking-wide">
            {isDragOver ? 'SOLTE OS ARQUIVOS AQUI' : 'CLIQUE OU ARRASTE'}
          </p>
          <p className="text-xs font-mono text-slate-400">MP4, MKV, MOV — Máx. 10 GB — Múltiplos arquivos suportados</p>
        </div>
      </div>
    </div>
  );
};
