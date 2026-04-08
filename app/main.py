from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask
import os
import uuid
import logging
import asyncio
import json
import time
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict
from app.utils import accelerate_video

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Semáforo para limitar jobs concorrentes — 6 corresponde ao tamanho do time de editoras
JOB_SEMAPHORE = threading.Semaphore(6)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = logging.getLogger(__name__)
    logger.info("Executando limpeza inicial de arquivos antigos...")
    cleanup_old_files(days=3)
    cleanup_thread = threading.Thread(
        target=run_periodic_cleanup,
        args=(24, 3),
        daemon=True
    )
    cleanup_thread.start()
    logger.info("Rotina de limpeza automática iniciada (executa a cada 24 horas)")
    yield


app = FastAPI(title="Video Accelerate API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

processing_status: Dict[str, dict] = {}

VALID_PRESETS = ("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow")


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
    """Executa limpeza manual de arquivos antigos."""
    if days < 1:
        raise HTTPException(status_code=400, detail="O parâmetro 'days' deve ser >= 1")

    logger = logging.getLogger(__name__)

    files_before = {}
    total_size_before = 0

    for directory in [UPLOAD_DIR, OUTPUT_DIR]:
        if directory.exists():
            count = sum(1 for f in directory.iterdir() if f.is_file())
            size = sum(f.stat().st_size for f in directory.iterdir() if f.is_file())
            files_before[str(directory)] = {"count": count, "size": size}
            total_size_before += size

    cleanup_old_files(days=days)

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
    use_sse: bool = False,
    preset: str = "medium",
    crf: int = 23,
    mute_audio: bool = False,
):
    """
    Acelera um vídeo enviado via upload.

    Args:
        file: Arquivo de vídeo a ser acelerado
        fator_aceleracao: Fator de aceleração (padrão: 1.1)
        use_sse: Se True, retorna job_id para usar com SSE
        preset: Preset de encoding do FFmpeg (padrão: medium)
        crf: Qualidade de encoding 18-28, menor = melhor qualidade (padrão: 23)
        mute_audio: Se True, remove o áudio do vídeo de saída
    """
    if fator_aceleracao <= 0:
        raise HTTPException(status_code=400, detail="Fator de aceleração deve ser maior que 0")

    if fator_aceleracao > 10:
        raise HTTPException(status_code=400, detail="Fator de aceleração não pode ser maior que 10")

    if preset not in VALID_PRESETS:
        raise HTTPException(status_code=400, detail=f"Preset inválido. Use um de: {', '.join(VALID_PRESETS)}")

    if not (18 <= crf <= 28):
        raise HTTPException(status_code=400, detail="CRF deve ser entre 18 e 28")

    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Arquivo deve ser um vídeo")

    file_id = str(uuid.uuid4())
    input_path = UPLOAD_DIR / f"{file_id}_{file.filename}"
    output_path = OUTPUT_DIR / f"{file_id}_accelerated_{file.filename}"

    logger = logging.getLogger(__name__)

    size_str = f"{file.size} bytes" if file.size is not None else "tamanho desconhecido"
    logger.info(f"Iniciando upload do arquivo: {file.filename} ({size_str})")
    with open(input_path, "wb") as f:
        content = await file.read()
        f.write(content)
    logger.info(f"Arquivo salvo em: {input_path} ({input_path.stat().st_size} bytes)")

    if use_sse:
        cancel_event = threading.Event()
        processing_status[file_id] = {
            "status": "queued",
            "progress": 0.0,
            "message": "Aguardando fila de processamento...",
            "input_path": str(input_path),
            "output_path": str(output_path),
            "filename": file.filename,
            "cancel_event": cancel_event,
            "preset": preset,
            "crf": crf,
            "mute_audio": mute_audio,
        }

        thread = threading.Thread(
            target=_process_video_async,
            args=(file_id, str(input_path), str(output_path), fator_aceleracao, cancel_event, preset, crf, mute_audio),
            daemon=True
        )
        thread.start()

        return {"job_id": file_id}
    else:
        try:
            logger.info(f"Iniciando processamento FFmpeg com fator: {fator_aceleracao}")
            accelerate_video(str(input_path), str(output_path), fator_aceleracao,
                             preset=preset, crf=crf, mute_audio=mute_audio)
            logger.info("Processamento FFmpeg concluído")

            if not output_path.exists():
                logger.error(f"Arquivo de saída não foi criado: {output_path}")
                raise HTTPException(status_code=500, detail="Erro ao processar vídeo")

            return FileResponse(
                path=str(output_path),
                media_type="video/mp4",
                filename=f"accelerated_{file.filename}",
                background=BackgroundTask(_cleanup_files, input_path, output_path)
            )
        except Exception as e:
            logger.error(f"Erro: {str(e)}", exc_info=True)
            if input_path.exists():
                input_path.unlink()
            if output_path.exists():
                output_path.unlink()
            raise HTTPException(status_code=500, detail=f"Erro ao processar vídeo: {str(e)}")


def _process_video_async(
    file_id: str,
    input_path: str,
    output_path: str,
    fator_aceleracao: float,
    cancel_event: threading.Event,
    preset: str = "medium",
    crf: int = 23,
    mute_audio: bool = False,
):
    """Processa vídeo em background — aguarda semáforo, processa e atualiza status."""
    logger = logging.getLogger(__name__)

    def progress_callback(progress: float, message: str):
        if file_id in processing_status:
            processing_status[file_id]["progress"] = progress
            processing_status[file_id]["message"] = message

    # Aguardar vaga no semáforo (status já é "queued" desde o endpoint)
    JOB_SEMAPHORE.acquire()
    try:
        if file_id not in processing_status:
            return

        if cancel_event.is_set():
            return

        logger.info(f"Semáforo adquirido — processando vídeo {file_id}")
        processing_status[file_id]["status"] = "processing"
        processing_status[file_id]["progress"] = 0.0
        processing_status[file_id]["message"] = "Iniciando FFmpeg..."

        accelerate_video(
            input_path, output_path, fator_aceleracao,
            progress_callback, cancel_event,
            preset=preset, crf=crf, mute_audio=mute_audio,
        )

        if Path(output_path).exists():
            processing_status[file_id]["status"] = "completed"
            processing_status[file_id]["progress"] = 100.0
            processing_status[file_id]["message"] = "Processamento concluído"
            logger.info(f"Vídeo {file_id} processado com sucesso")
        else:
            raise Exception("Arquivo de saída não foi criado")

    except InterruptedError:
        logger.info(f"Vídeo {file_id} cancelado pelo usuário")
        if file_id in processing_status:
            processing_status[file_id]["status"] = "cancelled"
            processing_status[file_id]["message"] = "Cancelado pelo usuário"
        for p in [input_path, output_path]:
            Path(p).unlink(missing_ok=True)

    except Exception as e:
        logger.error(f"Erro ao processar vídeo {file_id}: {str(e)}", exc_info=True)
        if file_id in processing_status:
            processing_status[file_id]["status"] = "error"
            processing_status[file_id]["message"] = f"Erro: {str(e)}"
        for p in [input_path, output_path]:
            Path(p).unlink(missing_ok=True)

    finally:
        JOB_SEMAPHORE.release()


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
        last_progress = -1.0
        last_status = None

        while True:
            if job_id not in processing_status:
                yield f"data: {json.dumps({'error': 'Job não encontrado'})}\n\n"
                break

            status = processing_status[job_id]
            current_progress = status.get("progress", 0.0)
            current_status = status.get("status", "unknown")

            # Emitir quando progresso OU status mudar
            if current_progress != last_progress or current_status != last_status:
                data = {
                    "progress": current_progress,
                    "status": current_status,
                    "message": status.get("message", "")
                }

                if current_status == "completed":
                    data["download_url"] = f"/accelerate/download/{job_id}"
                    yield f"data: {json.dumps(data)}\n\n"
                    break

                if current_status in ("error", "cancelled"):
                    yield f"data: {json.dumps(data)}\n\n"
                    break

                yield f"data: {json.dumps(data)}\n\n"
                last_progress = current_progress
                last_status = current_status

            await asyncio.sleep(0.5)

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
        background=BackgroundTask(_cleanup_files, input_path, output_path)
    )


@app.delete("/accelerate/{job_id}", status_code=204)
async def cancel_job(job_id: str):
    """Cancela um job em processamento, mata o FFmpeg e limpa os arquivos"""
    if job_id not in processing_status:
        raise HTTPException(status_code=404, detail="Job não encontrado")

    status = processing_status[job_id]

    if status.get("status") not in ("processing", "queued"):
        raise HTTPException(
            status_code=409,
            detail=f"Job não pode ser cancelado (status atual: {status.get('status')})"
        )

    cancel_event = status.get("cancel_event")
    if cancel_event:
        cancel_event.set()

    status["status"] = "cancelled"
    status["message"] = "Cancelado pelo usuário"

    for key in ("input_path", "output_path"):
        p = Path(status.get(key, ""))
        if p.exists():
            p.unlink(missing_ok=True)

    processing_status.pop(job_id, None)


def _cleanup_files(*paths):
    """Remove arquivos após o download e libera entrada do processing_status"""
    def cleanup():
        time.sleep(60)
        for path in paths:
            path_obj = Path(path)
            if path_obj.exists():
                try:
                    path_obj.unlink()
                except Exception:
                    pass
            job_id = path_obj.stem.split("_")[0]
            processing_status.pop(job_id, None)

    thread = threading.Thread(target=cleanup, daemon=True)
    thread.start()


def cleanup_old_files(days: int = 3):
    """Remove arquivos com mais de X dias das pastas uploads e outputs."""
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
    """Executa limpeza periódica de arquivos antigos."""
    logger = logging.getLogger(__name__)
    logger.info(f"Iniciando rotina de limpeza automática (executa a cada {interval_hours}h, remove arquivos com mais de {days} dias)")

    while True:
        try:
            cleanup_old_files(days=days)
        except Exception as e:
            logger.error(f"Erro na rotina de limpeza: {str(e)}", exc_info=True)

        time.sleep(interval_hours * 3600)
