import { ProcessingResult } from '../types';

export interface EncodeOptions {
  preset?: string;
  crf?: number;
  muteAudio?: boolean;
}

export const getApiBase = (): string => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      const protocol = window.location.protocol;
      return `${protocol}//${hostname}:3001`;
    }
  }
  return 'http://localhost:3001';
};

const API_BASE = getApiBase();

const SSE_IDLE_TIMEOUT_MS = 120000;

export const checkBackendHealth = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
    return res.ok;
  } catch (e) {
    return false;
  }
};

export const cancelJob = async (jobId: string): Promise<void> => {
  try {
    await fetch(`${API_BASE}/accelerate/${jobId}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('Erro ao cancelar job:', e);
  }
};

export const accelerateVideo = async (
  file: File,
  factor: number,
  onProgress?: (progress: number, message?: string, backendStatus?: string) => void,
  signal?: AbortSignal,
  options: EncodeOptions = {},
): Promise<ProcessingResult> => {

  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const url = new URL(`${API_BASE}/accelerate`);
    url.searchParams.append('fator_aceleracao', factor.toString());
    url.searchParams.append('use_sse', 'true');
    url.searchParams.append('preset', options.preset ?? 'medium');
    url.searchParams.append('crf', String(options.crf ?? 23));
    url.searchParams.append('mute_audio', String(options.muteAudio ?? false));

    const xhr = new XMLHttpRequest();

    signal?.addEventListener('abort', () => {
      xhr.abort();
      reject(new DOMException('Cancelado pelo usuário', 'AbortError'));
    });

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const uploadProgress = (e.loaded / e.total) * 10;
        onProgress(uploadProgress, 'Enviando arquivo...', 'uploading');
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          const jobId = response.job_id;

          if (!jobId) {
            reject(new Error('Job ID não recebido do servidor'));
            return;
          }

          const eventSource = new EventSource(`${API_BASE}/accelerate/stream/${jobId}`);

          signal?.addEventListener('abort', () => {
            clearTimeout(sseTimeout);
            eventSource.close();
            cancelJob(jobId);
            reject(new DOMException('Cancelado pelo usuário', 'AbortError'));
          });

          // Timeout por inatividade, não pelo tempo total: vídeos longos ou jobs esperando
          // na fila podem passar de 10 min. O backend reenvia o status a cada 15s.
          let sseTimeout: ReturnType<typeof setTimeout>;
          const armSseTimeout = () => {
            clearTimeout(sseTimeout);
            sseTimeout = setTimeout(() => {
              eventSource.close();
              reject(new Error('Servidor parou de responder (2 minutos sem atualização)'));
            }, SSE_IDLE_TIMEOUT_MS);
          };
          armSseTimeout();

          eventSource.onmessage = (event) => {
            armSseTimeout();
            try {
              const data = JSON.parse(event.data);

              if (onProgress) {
                const totalProgress = data.status === 'queued'
                  ? 10
                  : 10 + (data.progress * 0.9);
                onProgress(totalProgress, data.message || 'Processando...', data.status);
              }

              if (data.status === 'completed') {
                clearTimeout(sseTimeout);
                eventSource.close();

                fetch(`${API_BASE}/accelerate/download/${jobId}`)
                  .then(response => {
                    if (!response.ok) {
                      throw new Error(`Erro ao baixar: ${response.statusText}`);
                    }
                    return response.blob();
                  })
                  .then(blob => {
                    const downloadUrl = URL.createObjectURL(blob);
                    resolve({
                      downloadUrl,
                      originalName: file.name,
                      processedName: `accelerated_${file.name}`,
                      duration: 0
                    });
                  })
                  .catch(err => reject(err));
              } else if (data.status === 'error') {
                clearTimeout(sseTimeout);
                eventSource.close();
                reject(new Error(data.message || 'Erro ao processar vídeo'));
              } else if (data.status === 'cancelled') {
                clearTimeout(sseTimeout);
                eventSource.close();
                reject(new DOMException('Cancelado pelo usuário', 'AbortError'));
              }
            } catch (e) {
              console.error('Erro ao processar evento SSE:', e);
              clearTimeout(sseTimeout);
              eventSource.close();
              reject(new Error('Erro ao processar resposta de progresso'));
            }
          };

          eventSource.onerror = (error) => {
            console.error('Erro no EventSource:', error);
            clearTimeout(sseTimeout);
            eventSource.close();
            reject(new Error('Erro na conexão de progresso'));
          };

        } catch (e) {
          reject(new Error('Erro ao processar resposta do servidor'));
        }
      } else {
        let errorMessage = `Erro ${xhr.status}: ${xhr.statusText}`;
        try {
          const jsonError = JSON.parse(xhr.responseText);
          errorMessage = jsonError.detail || errorMessage;
        } catch (e) {
          // não é json
        }
        reject(new Error(errorMessage));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error(`Erro de conexão. Verifique se o servidor está rodando em ${API_BASE}`));
    });

    // Sem xhr.timeout: vídeos de vários GB levam mais de 5 min para subir pela rede.
    xhr.open('POST', url.toString());
    xhr.send(formData);
  });
};
