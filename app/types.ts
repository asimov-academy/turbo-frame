export enum ProcessingStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface VideoFile {
  file: File;
  previewUrl: string;
}

export interface ProcessingResult {
  downloadUrl: string;
  originalName: string;
  processedName: string;
  duration: number; 
}