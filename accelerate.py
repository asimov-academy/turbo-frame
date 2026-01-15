import subprocess

def accelerate(input_path, output_path, fator_aceleracao=1.1):
    try:
        comando = [
            "ffmpeg",
            "-i", input_path,
            "-filter_complex",
            f"[0:v]setpts={1/fator_aceleracao}*PTS[v];[0:a]atempo={fator_aceleracao}[a]",
            "-map", "[v]",
            "-map", "[a]",
            output_path
        ]
        subprocess.run(comando, check=True)
        print(f"Vídeo acelerado e salvo em: {output_path}")

    except subprocess.CalledProcessError as e:
        print(f"Erro ao executar o FFmpeg:\nSaída do FFmpeg: {e.stderr}")
    except FileNotFoundError:
        print("FFmpeg não encontrado. Certifique-se de que está instalado e no PATH.")

        
input_video_path = "input.mp4" 
output_video_path = "output.mp4"

accelerate(input_video_path, output_video_path)
