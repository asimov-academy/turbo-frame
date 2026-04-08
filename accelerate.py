import subprocess
from typing import Optional


def _build_atempo_chain(factor: float) -> str:
    filters = []
    remaining = factor
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    filters.append(f"atempo={remaining:.4f}")
    return ",".join(filters)


def _get_video_fps(input_path: str) -> Optional[float]:
    """Obtém o framerate do vídeo usando ffprobe"""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate",
                "-of", "default=noprint_wrappers=1:nokey=1",
                input_path
            ],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            num, den = result.stdout.strip().split('/')
            return float(num) / float(den)
    except Exception:
        pass
    return None


def accelerate(input_path, output_path, fator_aceleracao=1.1):
    try:
        source_fps = _get_video_fps(input_path)
        fps_filter = f",fps={source_fps:.3f}" if source_fps else ""

        comando = [
            "ffmpeg",
            "-i", input_path,
            "-filter_complex",
            f"[0:v]setpts={1/fator_aceleracao}*PTS{fps_filter}[v];[0:a]{_build_atempo_chain(fator_aceleracao)}[a]",
            "-map", "[v]",
            "-map", "[a]",
            output_path
        ]
        subprocess.run(comando, check=True, capture_output=True, text=True)
        print(f"Vídeo acelerado e salvo em: {output_path}")

    except subprocess.CalledProcessError as e:
        print(f"Erro ao executar o FFmpeg:\nSaída do FFmpeg: {e.stderr}")
    except FileNotFoundError:
        print("FFmpeg não encontrado. Certifique-se de que está instalado e no PATH.")

        
input_video_path = "input.mp4" 
output_video_path = "output.mp4"

accelerate(input_video_path, output_video_path)
