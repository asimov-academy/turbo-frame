export enum ProcessingStatus {
  IDLE = 'IDLE',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  ERROR = 'ERROR'
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  sizeMb: number;
}

export interface VideoFile {
  file: File;
  previewUrl: string;
  thumbnailUrl?: string;
}

export interface ProcessingResult {
  downloadUrl: string;
  originalName: string;
  processedName: string;
  duration: number;
}

export type QualityPreset = 'rapido' | 'balanceado' | 'qualidade';

export const QUALITY_PRESETS: Record<QualityPreset, { label: string; preset: string; crf: number }> = {
  rapido:     { label: 'Rápido',     preset: 'fast',   crf: 26 },
  balanceado: { label: 'Balanceado', preset: 'medium', crf: 23 },
  qualidade:  { label: 'Qualidade',  preset: 'slow',   crf: 20 },
};

export interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  thumbnailUrl?: string;
  metadata?: VideoMetadata;
  speed: number;
  qualityPreset: QualityPreset;
  muteAudio: boolean;
  status: ProcessingStatus;
  progress: number;
  error?: string;
  result?: ProcessingResult;
  abortController: AbortController | null;
}
