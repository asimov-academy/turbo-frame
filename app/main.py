from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid
import logging
import subprocess
import asyncio
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict
from app.utils import accelerate_video

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = FastAPI(title="Video Accelerate API", version="1.0.0")

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Criar diretórios necessários
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Armazenar status de processamento
processing_status: Dict[str, dict] = {}


@app.get("/")
async def root():
    return {
        "message": "Video Accelerate API",
        "version": "1.0.0",
        "endpoints": {
            "POST /accelerate": "Upload e acelera um vídeo",
            "GET /health": "Verifica saúde da API"
        }
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "ffmpeg": "installed"}


@app.post("/cleanup")
async def manual_cleanup(days: int = 3):
    """
    Executa limpeza manual de arquivos antigos.
    
    Args:
        days: Número de dias para considerar arquivo como antigo (padrão: 3)
    
    Returns:
        Estatísticas da limpeza
    """
    logger = logging.getLogger(__name__)
    
    # Contar arquivos antes da limpeza
    files_before = {}
    total_size_before = 0
    
    for directory in [UPLOAD_DIR, OUTPUT_DIR]:
        if directory.exists():
            count = sum(1 for f in directory.iterdir() if f.is_file())
            size = sum(f.stat().st_size for f in directory.iterdir() if f.is_file())
            files_before[str(directory)] = {"count": count, "size": size}
            total_size_before += size
    
    # Executar limpeza
    cleanup_old_files(days=days)
    
    # Contar arquivos depois da limpeza
    files_after = {}
    total_size_after = 0
    
    for directory in [UPLOAD_DIR, OUTPUT_DIR]:
        if directory.exists():
            count = sum(1 for f in directory.iterdir() if f.is_file())
            size = sum(f.stat().st_size for f in directory.iterdir() if f.is_file())
            files_after[str(directory)] = {"count": count, "size": size}
            total_size_after += size
    
    deleted_count = sum(files_before[d]["count"] - files_after[d]["count"] for d in files_before)
    freed_mb = (total_size_before - total_size_after) / (1024 * 1024)
    
    return {
        "status": "completed",
        "days": days,
        "deleted_files": deleted_count,
        "freed_space_mb": round(freed_mb, 2),
        "before": files_before,
        "after": files_after
    }


@app.post("/accelerate")
async def accelerate_endpoint(
    file: UploadFile = File(...),
    fator_aceleracao: float = 1.1,
    use_sse: bool = False
):
    """
    Acelera um vídeo enviado via upload.
    
    Args:
        file: Arquivo de vídeo a ser acelerado
        fator_aceleracao: Fator de aceleração (padrão: 1.1)
        use_sse: Se True, retorna job_id para usar com SSE. Se False, processa síncrono.
    
    Returns:
        Se use_sse=True: {"job_id": "..."}
        Se use_sse=False: Arquivo de vídeo acelerado
    """
    if fator_aceleracao <= 0:
        raise HTTPException(status_code=400, detail="Fator de aceleração deve ser maior que 0")
    
    if fator_aceleracao > 10:
        raise HTTPException(status_code=400, detail="Fator de aceleração não pode ser maior que 10")
    
    # Validar tipo de arquivo
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Arquivo deve ser um vídeo")
    
    # Gerar IDs únicos para os arquivos
    file_id = str(uuid.uuid4())
    input_path = UPLOAD_DIR / f"{file_id}_{file.filename}"
    output_path = OUTPUT_DIR / f"{file_id}_accelerated_{file.filename}"
    
    logger = logging.getLogger(__name__)
    
    # Salvar arquivo enviado
    logger.info(f"Iniciando upload do arquivo: {file.filename} ({file.size} bytes)")
    with open(input_path, "wb") as f:
        content = await file.read()
        f.write(content)
    logger.info(f"Arquivo salvo em: {input_path} ({input_path.stat().st_size} bytes)")
    
    if use_sse:
        # Modo assíncrono com SSE
        processing_status[file_id] = {
            "status": "processing",
            "progress": 0.0,
            "message": "Iniciando processamento...",
            "input_path": str(input_path),
            "output_path": str(output_path),
            "filename": file.filename
        }
        
        # Processar em background usando threading (já que FFmpeg é bloqueante)
        import threading
        thread = threading.Thread(
            target=_process_video_async,
            args=(file_id, str(input_path), str(output_path), fator_aceleracao),
            daemon=True
        )
        thread.start()
        
        return {"job_id": file_id}
    else:
        # Modo síncrono (compatibilidade)
        try:
            logger.info(f"Iniciando processamento FFmpeg com fator: {fator_aceleracao}")
            accelerate_video(str(input_path), str(output_path), fator_aceleracao)
            logger.info(f"Processamento FFmpeg concluído")
            
            if not output_path.exists():
                logger.error(f"Arquivo de saída não foi criado: {output_path}")
                raise HTTPException(status_code=500, detail="Erro ao processar vídeo")
            
            return FileResponse(
                path=str(output_path),
                media_type="video/mp4",
                filename=f"accelerated_{file.filename}",
                background=lambda: _cleanup_files(input_path, output_path)
            )
        except Exception as e:
            logger.error(f"Erro: {str(e)}", exc_info=True)
            if input_path.exists():
                input_path.unlink()
            if output_path.exists():
                output_path.unlink()
            raise HTTPException(status_code=500, detail=f"Erro ao processar vídeo: {str(e)}")


def _process_video_async(file_id: str, input_path: str, output_path: str, fator_aceleracao: float):
    """Processa vídeo em background e atualiza status"""
    logger = logging.getLogger(__name__)
    
    def progress_callback(progress: float, message: str):
        """Callback para atualizar progresso"""
        if file_id in processing_status:
            processing_status[file_id]["progress"] = progress
            processing_status[file_id]["message"] = message
    
    try:
        logger.info(f"Processando vídeo {file_id} em background")
        processing_status[file_id]["status"] = "processing"
        processing_status[file_id]["progress"] = 0.0
        processing_status[file_id]["message"] = "Iniciando FFmpeg..."
        
        accelerate_video(input_path, output_path, fator_aceleracao, progress_callback)
        
        if Path(output_path).exists():
            processing_status[file_id]["status"] = "completed"
            processing_status[file_id]["progress"] = 100.0
            processing_status[file_id]["message"] = "Processamento concluído"
            logger.info(f"Vídeo {file_id} processado com sucesso")
        else:
            raise Exception("Arquivo de saída não foi criado")
            
    except Exception as e:
        logger.error(f"Erro ao processar vídeo {file_id}: {str(e)}", exc_info=True)
        processing_status[file_id]["status"] = "error"
        processing_status[file_id]["message"] = f"Erro: {str(e)}"
        
        # Limpar arquivos em caso de erro
        if Path(input_path).exists():
            Path(input_path).unlink()
        if Path(output_path).exists():
            Path(output_path).unlink()


@app.get("/accelerate/status/{job_id}")
async def get_processing_status(job_id: str):
    """Retorna status do processamento"""
    if job_id not in processing_status:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    return processing_status[job_id]


@app.get("/accelerate/stream/{job_id}")
async def stream_progress(job_id: str):
    """Stream de progresso via Server-Sent Events"""
    if job_id not in processing_status:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    
    async def event_generator():
        """Gera eventos SSE com progresso"""
        last_progress = -1.0
        
        while True:
            if job_id not in processing_status:
                yield f"data: {json.dumps({'error': 'Job não encontrado'})}\n\n"
                break
            
            status = processing_status[job_id]
            current_progress = status.get("progress", 0.0)
            
            # Enviar apenas se progresso mudou
            if current_progress != last_progress:
                data = {
                    "progress": current_progress,
                    "status": status.get("status", "unknown"),
                    "message": status.get("message", "")
                }
                
                # Se completou, incluir URL do arquivo
                if status.get("status") == "completed":
                    data["download_url"] = f"/accelerate/download/{job_id}"
                    yield f"data: {json.dumps(data)}\n\n"
                    break
                
                # Se erro, enviar e sair
                if status.get("status") == "error":
                    yield f"data: {json.dumps(data)}\n\n"
                    break
                
                yield f"data: {json.dumps(data)}\n\n"
                last_progress = current_progress
            
            await asyncio.sleep(0.5)  # Atualizar a cada 500ms
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.get("/accelerate/download/{job_id}")
async def download_processed_video(job_id: str):
    """Baixa o vídeo processado"""
    if job_id not in processing_status:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    
    status = processing_status[job_id]
    
    if status.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Vídeo ainda não foi processado")
    
    output_path = Path(status["output_path"])
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    
    filename = status.get("filename", "video.mp4")
    input_path = Path(status["input_path"])
    
    return FileResponse(
        path=str(output_path),
        media_type="video/mp4",
        filename=f"accelerated_{filename}",
        background=lambda: _cleanup_files(input_path, output_path)
    )


def _cleanup_files(*paths):
    """Remove arquivos após o download"""
    import threading
    
    def cleanup():
        time.sleep(60)  # Aguarda 60 segundos antes de deletar
        for path in paths:
            if Path(path).exists():
                try:
                    Path(path).unlink()
                except Exception:
                    pass  # Ignora erros ao deletar
    
    thread = threading.Thread(target=cleanup, daemon=True)
    thread.start()


def cleanup_old_files(days: int = 3):
    """
    Remove arquivos com mais de X dias das pastas uploads e outputs.
    
    Args:
        days: Número de dias para considerar arquivo como antigo (padrão: 3)
    """
    logger = logging.getLogger(__name__)
    
    cutoff_time = datetime.now() - timedelta(days=days)
    deleted_count = 0
    total_size_freed = 0
    
    for directory in [UPLOAD_DIR, OUTPUT_DIR]:
        if not directory.exists():
            continue
        
        logger.info(f"Verificando arquivos antigos em {directory}")
        
        for file_path in directory.iterdir():
            if file_path.is_file():
                try:
                    # Obter data de modificação do arquivo
                    file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                    
                    if file_mtime < cutoff_time:
                        file_size = file_path.stat().st_size
                        file_path.unlink()
                        deleted_count += 1
                        total_size_freed += file_size
                        logger.info(f"Arquivo deletado: {file_path.name} ({file_mtime.strftime('%Y-%m-%d %H:%M:%S')})")
                except Exception as e:
                    logger.warning(f"Erro ao deletar arquivo {file_path}: {str(e)}")
    
    if deleted_count > 0:
        size_mb = total_size_freed / (1024 * 1024)
        logger.info(f"Limpeza concluída: {deleted_count} arquivo(s) deletado(s), {size_mb:.2f} MB liberados")
    else:
        logger.info("Nenhum arquivo antigo encontrado para deletar")


def run_periodic_cleanup(interval_hours: int = 24, days: int = 3):
    """
    Executa limpeza periódica de arquivos antigos.
    
    Args:
        interval_hours: Intervalo em horas entre execuções (padrão: 24)
        days: Número de dias para considerar arquivo como antigo (padrão: 3)
    """
    logger = logging.getLogger(__name__)
    logger.info(f"Iniciando rotina de limpeza automática (executa a cada {interval_hours}h, remove arquivos com mais de {days} dias)")
    
    while True:
        try:
            cleanup_old_files(days=days)
        except Exception as e:
            logger.error(f"Erro na rotina de limpeza: {str(e)}", exc_info=True)
        
        # Aguardar próximo ciclo
        time.sleep(interval_hours * 3600)  # Converter horas para segundos


@app.on_event("startup")
async def startup_event():
    """Inicia rotina de limpeza automática ao iniciar a aplicação"""
    import threading
    logger = logging.getLogger(__name__)
    
    # Executar limpeza imediatamente ao iniciar
    logger.info("Executando limpeza inicial de arquivos antigos...")
    cleanup_old_files(days=3)
    
    # Iniciar thread para limpeza periódica (executa a cada 24 horas)
    cleanup_thread = threading.Thread(
        target=run_periodic_cleanup,
        args=(24, 3),  # A cada 24 horas, remove arquivos com mais de 3 dias
        daemon=True
    )
    cleanup_thread.start()
    logger.info("Rotina de limpeza automática iniciada (executa a cada 24 horas)")

