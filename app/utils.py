import subprocess
import os
import re
import threading
import time
from typing import Optional, Callable


def accelerate_video(
    input_path: str, 
    output_path: str, 
    fator_aceleracao: float = 1.1,
    progress_callback: Optional[Callable[[float, str], None]] = None
):
    """
    Acelera um vídeo usando FFmpeg.
    
    Args:
        input_path: Caminho do vídeo de entrada
        output_path: Caminho do vídeo de saída
        fator_aceleracao: Fator de aceleração (padrão: 1.1)
        progress_callback: Função callback(opcao) que recebe (progresso: float, mensagem: str)
                          progresso é de 0.0 a 100.0
    
    Raises:
        subprocess.CalledProcessError: Se o FFmpeg falhar
        FileNotFoundError: Se o FFmpeg não estiver instalado
    """
    import logging
    logger = logging.getLogger(__name__)
    
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Arquivo de entrada não encontrado: {input_path}")
    
    # Melhorar o comando FFmpeg para ser mais robusto
    comando = [
        "ffmpeg",
        "-i", input_path,
        "-filter_complex",
        f"[0:v]setpts={1/fator_aceleracao}*PTS[v];[0:a]atempo={fator_aceleracao}[a]",
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264",  # Codec de vídeo
        "-preset", "medium",  # Balance entre velocidade e qualidade
        "-crf", "23",  # Qualidade (18-28, menor = melhor qualidade)
        "-c:a", "aac",  # Codec de áudio
        "-b:a", "192k",  # Bitrate de áudio
        "-movflags", "+faststart",  # Otimização para streaming
        "-y",  # Sobrescrever arquivo de saída se existir
        output_path
    ]
    
    logger.info(f"Executando FFmpeg: {' '.join(comando)}")
    
    try:
        # Executar FFmpeg com captura de progresso em tempo real
        logger.info("Iniciando processamento FFmpeg...")
        
        if progress_callback:
            # Modo com progresso em tempo real
            # Obter duração do vídeo primeiro (para calcular progresso)
            duration = _get_video_duration(input_path)
            if duration:
                logger.info(f"Duração do vídeo: {duration:.2f} segundos")
            
            process = subprocess.Popen(
                comando,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            
            stderr_lines = []
            last_progress = 0.0
            stderr_data = []
            
            # Ler stderr em thread separada para não bloquear
            def read_stderr():
                for line in iter(process.stderr.readline, ''):
                    if line:
                        stderr_data.append(line.strip())
            
            stderr_thread = threading.Thread(target=read_stderr, daemon=True)
            stderr_thread.start()
            
            # Monitorar progresso enquanto processo roda
            while process.poll() is None:
                # Processar linhas acumuladas
                while stderr_data:
                    line = stderr_data.pop(0)
                    stderr_lines.append(line)
                    
                    # Parsear progresso do FFmpeg
                    progress = _parse_ffmpeg_progress(line, duration)
                    if progress is not None and progress > last_progress:
                        last_progress = progress
                        progress_callback(progress, line)
                    elif "error" in line.lower():
                        logger.error(f"FFmpeg error: {line}")
                
                # Pequeno delay para não consumir CPU
                time.sleep(0.1)
            
            # Processar linhas restantes
            stderr_thread.join(timeout=2)
            while stderr_data:
                line = stderr_data.pop(0)
                stderr_lines.append(line)
                progress = _parse_ffmpeg_progress(line, duration)
                if progress is not None:
                    progress_callback(min(progress, 99.9), line)
            
            # Aguardar processo terminar
            return_code = process.poll()
            
            if return_code != 0:
                error_msg = "\n".join(stderr_lines[-10:]) if stderr_lines else "Erro desconhecido ao executar FFmpeg"
                logger.error(f"FFmpeg falhou com código {return_code}: {error_msg}")
                raise subprocess.CalledProcessError(return_code, comando, error_msg)
            
            if progress_callback:
                progress_callback(100.0, "Processamento concluído")
            
            logger.info(f"FFmpeg concluído com sucesso. Arquivo de saída: {output_path}")
            return subprocess.CompletedProcess(comando, return_code, "", "\n".join(stderr_lines))
        else:
            # Modo sem progresso (compatibilidade)
            result = subprocess.run(
                comando,
                check=True,
                capture_output=True,
                text=True,
                timeout=600
            )
            logger.info(f"FFmpeg concluído com sucesso. Arquivo de saída: {output_path}")
            return result
        
    except FileNotFoundError:
        logger.error("FFmpeg não encontrado no PATH")
        raise FileNotFoundError(
            "FFmpeg não encontrado. Certifique-se de que está instalado e no PATH."
        )
    except Exception as e:
        logger.error(f"Erro inesperado ao executar FFmpeg: {str(e)}")
        raise


def _get_video_duration(input_path: str) -> Optional[float]:
    """Obtém a duração do vídeo em segundos usando ffprobe"""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                input_path
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return None


def _parse_ffmpeg_progress(line: str, duration: Optional[float]) -> Optional[float]:
    """Extrai progresso percentual de uma linha do FFmpeg"""
    # Formato: time=00:01:23.45 ou time=83.45
    time_match = re.search(r'time=(\d+):(\d+):(\d+\.\d+)|time=(\d+\.\d+)', line)
    if time_match:
        if duration:
            if time_match.group(4):  # Formato simples: time=83.45
                current_time = float(time_match.group(4))
            else:  # Formato HH:MM:SS.mmm
                hours = int(time_match.group(1))
                minutes = int(time_match.group(2))
                seconds = float(time_match.group(3))
                current_time = hours * 3600 + minutes * 60 + seconds
            
            if duration > 0:
                progress = (current_time / duration) * 100
                return min(progress, 99.9)  # Não retorna 100% até terminar
    
    return None

