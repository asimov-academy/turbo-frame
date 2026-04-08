#!/usr/bin/env python3
"""
Script para subir toda a aplicação Video Accelerate
Inclui API (Docker) e Frontend (Vite)
"""

import subprocess
import sys
import time
import os
import signal
from pathlib import Path

# Verificar e instalar rich se necessário
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    from rich.table import Table
    from rich.live import Live
    from rich.progress import Progress, SpinnerColumn, TextColumn
    from rich import box
except ImportError:
    print("📦 Instalando dependência 'rich'...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "rich>=13.0.0", "-q"])
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    from rich.table import Table
    from rich.live import Live
    from rich.progress import Progress, SpinnerColumn, TextColumn
    from rich import box

console = Console()

# Cores e estilos
SUCCESS = "green"
ERROR = "red"
WARNING = "yellow"
INFO = "blue"
HIGHLIGHT = "cyan"

# URLs da aplicação
API_URL = "http://localhost:3001"
API_DOCS_SWAGGER = "http://localhost:3001/docs"
API_DOCS_REDOC = "http://localhost:3001/redoc"
FRONTEND_URL = "http://localhost:3000"

# Diretórios
# start.py está em app/scripts/, então:
# __file__ = app/scripts/start.py
# parent = app/scripts/
# parent.parent = app/
# parent.parent.parent = raiz do projeto
PROJECT_ROOT = Path(__file__).parent.parent.parent
APP_DIR = PROJECT_ROOT / "app"


def print_header():
    """Imprime cabeçalho bonito"""
    header = Text()
    header.append("🚀 ", style="yellow")
    header.append("VIDEO ACCELERATE", style="bold cyan")
    header.append(" - Iniciando Aplicação", style="white")
    
    console.print(Panel(header, box=box.ROUNDED, style="bold blue"))


def check_docker():
    """Verifica se Docker está instalado e rodando"""
    console.print("\n[bold cyan]📦 Verificando Docker...[/bold cyan]")
    
    try:
        result = subprocess.run(
            ["docker", "--version"],
            capture_output=True,
            text=True,
            check=True
        )
        docker_version = result.stdout.strip()
        console.print(f"[{SUCCESS}]✓ Docker encontrado: {docker_version}[/{SUCCESS}]")
        
        # Verificar se Docker está rodando
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            text=True,
            check=True
        )
        console.print(f"[{SUCCESS}]✓ Docker está rodando[/{SUCCESS}]")
        return True
        
    except subprocess.CalledProcessError:
        console.print(f"[{ERROR}]✗ Docker não está instalado ou não está rodando[/{ERROR}]")
        console.print("[yellow]Por favor, instale o Docker e certifique-se de que está rodando.[/yellow]")
        return False
    except FileNotFoundError:
        console.print(f"[{ERROR}]✗ Docker não encontrado no sistema[/{ERROR}]")
        console.print("[yellow]Por favor, instale o Docker primeiro.[/yellow]")
        return False


def check_docker_compose():
    """Verifica se Docker Compose está disponível"""
    console.print("\n[bold cyan]🐳 Verificando Docker Compose...[/bold cyan]")
    
    try:
        # Tenta docker compose (v2) primeiro
        result = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True,
            text=True,
            check=True
        )
        version = result.stdout.strip()
        console.print(f"[{SUCCESS}]✓ Docker Compose encontrado: {version}[/{SUCCESS}]")
        return "docker compose"
    except (subprocess.CalledProcessError, FileNotFoundError):
        try:
            # Tenta docker-compose (v1)
            result = subprocess.run(
                ["docker-compose", "--version"],
                capture_output=True,
                text=True,
                check=True
            )
            version = result.stdout.strip()
            console.print(f"[{SUCCESS}]✓ Docker Compose encontrado: {version}[/{SUCCESS}]")
            return "docker-compose"
        except (subprocess.CalledProcessError, FileNotFoundError):
            console.print(f"[{ERROR}]✗ Docker Compose não encontrado[/{ERROR}]")
            return None


def check_node():
    """Verifica se Node.js está instalado"""
    console.print("\n[bold cyan]📦 Verificando Node.js...[/bold cyan]")
    
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            text=True,
            check=True
        )
        node_version = result.stdout.strip()
        console.print(f"[{SUCCESS}]✓ Node.js encontrado: {node_version}[/{SUCCESS}]")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        console.print(f"[{WARNING}]⚠ Node.js não encontrado[/{WARNING}]")
        console.print("[yellow]O frontend não será iniciado. Apenas a API será iniciada.[/yellow]")
        return False


def start_docker_services(docker_compose_cmd):
    """Inicia os serviços Docker"""
    console.print("\n[bold cyan]🐳 Iniciando serviços Docker...[/bold cyan]")
    
    os.chdir(PROJECT_ROOT)
    
    # Parar containers existentes primeiro
    console.print("[dim]Parando containers existentes (se houver)...[/dim]")
    subprocess.run(
        docker_compose_cmd.split() + ["down"],
        capture_output=True,
        text=True
    )
    
    # Construir e iniciar
    console.print("[dim]Construindo e iniciando containers...[/dim]")
    
    process = subprocess.Popen(
        docker_compose_cmd.split() + ["up", "--build", "--no-cache", "-d"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    
    # Mostrar output em tempo real com prefixo
    output_lines = []
    for line in process.stdout:
        if line.strip():
            clean_line = line.strip()
            output_lines.append(clean_line)
            # Mostrar apenas linhas importantes
            if any(keyword in clean_line.lower() for keyword in ['building', 'creating', 'starting', 'started', 'error', 'warning']):
                console.print(f"[dim]  → {clean_line}[/dim]")
    
    process.wait()
    
    if process.returncode == 0:
        console.print(f"[{SUCCESS}]✓ Serviços Docker iniciados com sucesso[/{SUCCESS}]")
        return True
    else:
        console.print(f"[{ERROR}]✗ Erro ao iniciar serviços Docker[/{ERROR}]")
        # Mostrar últimas linhas de erro
        if output_lines:
            console.print("[dim]Últimas linhas de output:[/dim]")
            for line in output_lines[-5:]:
                console.print(f"[dim]  {line}[/dim]")
        return False


def wait_for_api():
    """Aguarda a API ficar disponível"""
    console.print("\n[bold cyan]⏳ Aguardando API ficar disponível...[/bold cyan]")
    
    import urllib.request
    import urllib.error
    
    max_attempts = 30
    attempt = 0
    
    with console.status("[bold green]Verificando saúde da API...", spinner="dots"):
        while attempt < max_attempts:
            try:
                urllib.request.urlopen(f"{API_URL}/health", timeout=2)
                console.print(f"[{SUCCESS}]✓ API está online![/{SUCCESS}]")
                return True
            except (urllib.error.URLError, Exception):
                attempt += 1
                time.sleep(2)
        
        console.print(f"[{WARNING}]⚠ API não respondeu após {max_attempts * 2} segundos[/{WARNING}]")
        console.print("[yellow]A API pode estar ainda inicializando. Verifique manualmente.[/yellow]")
        return False


def install_frontend_dependencies():
    """Instala dependências do frontend"""
    console.print("\n[bold cyan]📦 Instalando dependências do frontend...[/bold cyan]")
    
    os.chdir(APP_DIR)
    
    # Verificar se node_modules existe
    if (APP_DIR / "node_modules").exists():
        console.print("[dim]Dependências já instaladas. Pulando instalação...[/dim]")
        return True
    
    with console.status("[bold green]Instalando pacotes npm...", spinner="dots"):
        process = subprocess.run(
            ["npm", "install"],
            capture_output=True,
            text=True
        )
    
    if process.returncode == 0:
        console.print(f"[{SUCCESS}]✓ Dependências instaladas com sucesso[/{SUCCESS}]")
        return True
    else:
        console.print(f"[{ERROR}]✗ Erro ao instalar dependências[/{ERROR}]")
        console.print(f"[dim]{process.stderr}[/dim]")
        return False


def start_frontend():
    """Inicia o frontend"""
    console.print("\n[bold cyan]⚛️  Iniciando frontend...[/bold cyan]")
    
    os.chdir(APP_DIR)
    
    # Iniciar em background
    try:
        process = subprocess.Popen(
            ["npm", "run", "dev"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        
        # Aguardar um pouco para ver se inicia sem erros
        time.sleep(3)
        
        if process.poll() is None:
            console.print(f"[{SUCCESS}]✓ Frontend iniciado em background[/{SUCCESS}]")
            console.print(f"[dim]Frontend rodando em {FRONTEND_URL}[/dim]")
            return process
        else:
            # Ler stderr se houver
            stdout, _ = process.communicate()
            console.print(f"[{ERROR}]✗ Erro ao iniciar frontend[/{ERROR}]")
            if stdout:
                console.print(f"[dim]{stdout[:200]}[/dim]")
            return None
    except Exception as e:
        console.print(f"[{ERROR}]✗ Erro ao iniciar frontend: {str(e)}[/{ERROR}]")
        return None


def print_urls_table():
    """Imprime tabela bonita com todas as URLs"""
    console.print("\n")
    
    table = Table(
        title="🌐 URLs de Acesso",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold cyan",
        title_style="bold yellow",
        border_style="bright_blue"
    )
    
    table.add_column("Serviço", style="bold cyan", width=25, justify="left")
    table.add_column("URL", style="bold green", width=50, justify="left")
    table.add_column("Descrição", style="white", width=40, justify="left")
    
    table.add_row(
        "🎬 Frontend",
        f"[bold bright_green]{FRONTEND_URL}[/bold bright_green]",
        "Interface principal da aplicação"
    )
    
    table.add_row(
        "🔌 API",
        f"[bold bright_green]{API_URL}[/bold bright_green]",
        "API REST principal"
    )
    
    table.add_row(
        "📚 Documentação (Swagger)",
        f"[bold bright_green]{API_DOCS_SWAGGER}[/bold bright_green]",
        "Documentação interativa da API"
    )
    
    table.add_row(
        "📖 Documentação (ReDoc)",
        f"[bold bright_green]{API_DOCS_REDOC}[/bold bright_green]",
        "Documentação alternativa da API"
    )
    
    table.add_row(
        "❤️  Health Check",
        f"[bold bright_green]{API_URL}/health[/bold bright_green]",
        "Verificação de saúde da API"
    )
    
    console.print(table)
    console.print("\n")
    
    # Adicionar URLs clicáveis (se suportado pelo terminal)
    console.print("[bold cyan]💡 Dica:[/bold cyan] Clique nas URLs acima para abrir no navegador\n")


def print_footer():
    """Imprime rodapé com informações finais"""
    footer_text = Text()
    footer_text.append("✨ ", style="yellow")
    footer_text.append("Aplicação iniciada com sucesso!", style="bold green")
    footer_text.append("\n\n", style="white")
    footer_text.append("💡 ", style="cyan")
    footer_text.append("Dica: Use ", style="white")
    footer_text.append("Ctrl+C", style="bold yellow")
    footer_text.append(" para parar os serviços", style="white")
    footer_text.append("\n", style="white")
    footer_text.append("🛑 ", style="cyan")
    footer_text.append("Para parar: ", style="white")
    footer_text.append("docker-compose down", style="bold yellow")
    
    console.print(Panel(footer_text, box=box.ROUNDED, style="bold blue"))


def main():
    """Função principal"""
    print_header()
    
    # Verificações iniciais
    if not check_docker():
        sys.exit(1)
    
    docker_compose_cmd = check_docker_compose()
    if not docker_compose_cmd:
        sys.exit(1)
    
    has_node = check_node()
    
    # Iniciar Docker
    if not start_docker_services(docker_compose_cmd):
        console.print(f"\n[{ERROR}]Falha ao iniciar serviços Docker. Abortando.[/{ERROR}]")
        sys.exit(1)
    
    # Aguardar API
    wait_for_api()
    
    # Frontend (opcional)
    frontend_process = None
    if has_node:
        if install_frontend_dependencies():
            frontend_process = start_frontend()
            if frontend_process:
                time.sleep(2)  # Dar tempo para o frontend iniciar
        else:
            console.print("[yellow]Frontend não será iniciado devido a erros na instalação.[/yellow]")
    
    # Mostrar URLs
    console.print("\n")
    console.print(Panel.fit(
        "[bold green]✅ Todos os serviços foram iniciados![/bold green]",
        box=box.ROUNDED,
        style="bold green"
    ))
    
    print_urls_table()
    print_footer()
    
    # Manter script rodando e capturar Ctrl+C
    try:
        if frontend_process:
            console.print("\n[dim]Pressione Ctrl+C para parar todos os serviços...[/dim]\n")
            # Aguardar processo do frontend
            frontend_process.wait()
        else:
            console.print("\n[dim]Serviços Docker continuam rodando em background.[/dim]")
            console.print("[dim]Pressione Ctrl+C para sair...[/dim]\n")
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        console.print("\n\n[yellow]Interrompendo serviços...[/yellow]")
        if frontend_process:
            frontend_process.terminate()
        console.print("[green]✓ Serviços interrompidos[/green]")
        console.print("[yellow]Nota: Containers Docker continuam rodando. Use 'docker-compose down' para pará-los.[/yellow]")


if __name__ == "__main__":
    main()
