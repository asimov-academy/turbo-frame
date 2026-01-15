import { ProcessingResult } from '../types';

// Detecta automaticamente se está em produção (servidor remoto) ou desenvolvimento
export const getApiBase = (): string => {
  // Se estiver rodando no navegador e acessando via IP, usa o mesmo hostname
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // Se não for localhost, usa o mesmo hostname do frontend
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `http://${hostname}:3001`;
    }
  }
  // Fallback para localhost em desenvolvimento
  return 'http://localhost:3001';
};

// Endereço da API Docker - detecta automaticamente
const API_BASE = getApiBase();

export const checkBackendHealth = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
    return res.ok;
  } catch (e) {
    return false;
  }
};

export const accelerateVideo = async (
  file: File, 
  factor: number,
  onProgress?: (progress: number, message?: string) => void
): Promise<ProcessingResult> => {
  
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    
    const url = new URL(`${API_BASE}/accelerate`);
    url.searchParams.append('fator_aceleracao', factor.toString());
    url.searchParams.append('use_sse', 'true');

    // Primeiro, fazer upload e obter job_id
    const xhr = new XMLHttpRequest();
    
    // Progresso de upload (0-10%)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const uploadProgress = (e.loaded / e.total) * 10; // Upload representa 10% do progresso
        onProgress(uploadProgress, 'Enviando arquivo...');
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
          
          // Conectar ao SSE para receber progresso
          const eventSource = new EventSource(`${API_BASE}/accelerate/stream/${jobId}`);
          
          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              
              if (onProgress) {
                // Progresso real do FFmpeg (10-100%)
                const totalProgress = 10 + (data.progress * 0.9); // 10% upload + 90% processamento
                onProgress(totalProgress, data.message || 'Processando...');
              }
              
              if (data.status === 'completed') {
                eventSource.close();
                
                // Baixar arquivo processado
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
                  .catch(err => {
                    reject(err);
                  });
              } else if (data.status === 'error') {
                eventSource.close();
                reject(new Error(data.message || 'Erro ao processar vídeo'));
              }
            } catch (e) {
              console.error('Erro ao processar evento SSE:', e);
            }
          };
          
          eventSource.onerror = (error) => {
            console.error('Erro no EventSource:', error);
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
          // Ignora erro de parse se não for json
        }
        reject(new Error(errorMessage));
      }
    });
    
    xhr.addEventListener('error', () => {
      reject(new Error(`Erro de conexão. Verifique se o servidor está rodando em ${API_BASE}`));
    });
    
    xhr.addEventListener('timeout', () => {
      reject(new Error('Tempo limite excedido no upload.'));
    });
    
    xhr.timeout = 300000; // 5 minutos para upload
    
    // Enviar requisição
    xhr.open('POST', url.toString());
    xhr.send(formData);
  });
};