#!/bin/bash

# Script para iniciar a aplicação Video Accelerate
# Este script chama o start.py que está em app/scripts/

# Obter o diretório raiz do projeto (onde está este script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_SCRIPT="$PROJECT_ROOT/app/scripts/start.py"

# Verificar se o arquivo Python existe
if [ ! -f "$PYTHON_SCRIPT" ]; then
    echo "❌ Erro: Arquivo $PYTHON_SCRIPT não encontrado!"
    exit 1
fi

# Executar o script Python
python3 "$PYTHON_SCRIPT"
