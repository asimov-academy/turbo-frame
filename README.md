# 🚀 Turbo Frame

Aplicação web completa para aceleração de vídeos com interface moderna e processamento em tempo real.

## 📖 Sobre o Projeto

**Turbo Frame** é uma aplicação full-stack que permite acelerar vídeos de forma rápida e intuitiva. A aplicação consiste em um frontend React moderno com interface cyberpunk e um backend FastAPI robusto que processa vídeos usando FFmpeg.

### ✨ Funcionalidades

- 🎬 **Interface Moderna**: UI cyberpunk com design responsivo
- ⚡ **Aceleração de Vídeos**: Processa vídeos com fator de aceleração configurável (0.1x a 10x)
- 📊 **Progresso em Tempo Real**: Acompanhe o processamento com feedback visual em tempo real via Server-Sent Events (SSE)
- 🔄 **Processamento Assíncrono**: Suporta múltiplos usuários processando vídeos simultaneamente
- 📥 **Download Automático**: Baixe o vídeo processado diretamente pela interface
- 🎨 **Comparação Visual**: Compare o vídeo original com o resultado processado
- 🏥 **Health Check**: Monitoramento de status da API em tempo real

## 🛠️ Tecnologias

### Frontend
- **React 19** - Framework UI
- **TypeScript** - Tipagem estática
- **Vite** - Build tool e dev server
- **Tailwind CSS** - Estilização

### Backend
- **FastAPI** - Framework web assíncrono
- **FFmpeg** - Processamento de vídeo
- **Python 3.11** - Linguagem backend
- **Uvicorn** - Servidor ASGI

### Infraestrutura
- **Docker** - Containerização
- **Docker Compose** - Orquestração de containers

## 📋 Pré-requisitos

- **Docker** (versão 20.10+)
- **Docker Compose** (versão 2.0+)
- **Node.js** (versão 18+, apenas para desenvolvimento do frontend)

## 🚀 Instalação e Uso

### Iniciar a Aplicação Completa

A forma mais fácil de iniciar toda a aplicação é usando o script fornecido:

```bash
./scripts/start.sh
```

Este script irá:
1. ✅ Verificar se Docker e Docker Compose estão instalados
2. ✅ Verificar se Node.js está disponível
3. ✅ Construir e iniciar os containers Docker
4. ✅ Instalar dependências do frontend (se necessário)
5. ✅ Iniciar o frontend em modo desenvolvimento
6. ✅ Exibir todas as URLs de acesso

### Iniciar Manualmente

#### 1. Iniciar Backend (Docker)

```bash
docker-compose up --build
```

#### 2. Iniciar Frontend (Terminal separado)

```bash
cd app
npm install  # Apenas na primeira vez
npm run dev
```

## 🌐 URLs de Acesso

Após iniciar a aplicação, você terá acesso a:

| Serviço | URL | Descrição |
|---------|-----|-----------|
| 🎬 **Frontend** | http://localhost:3000 | Interface principal da aplicação |
| 🔌 **API** | http://localhost:8888 | API REST principal |
| 📚 **Swagger Docs** | http://localhost:8888/docs | Documentação interativa da API |
| 📖 **ReDoc** | http://localhost:8888/redoc | Documentação alternativa da API |
| ❤️ **Health Check** | http://localhost:8888/health | Verificação de saúde da API |

## 📡 API Endpoints

### GET `/`
Retorna informações sobre a API.

### GET `/health`
Verifica a saúde da API e se o FFmpeg está disponível.

### POST `/accelerate`
Acelera um vídeo enviado.

**Parâmetros:**
- `file`: Arquivo de vídeo (multipart/form-data)
- `fator_aceleracao`: Fator de aceleração (query parameter, padrão: 1.1)
- `use_sse`: Se `true`, retorna job_id para acompanhar progresso via SSE (query parameter, padrão: false)

**Resposta (use_sse=false):**
- Retorna o arquivo de vídeo processado diretamente

**Resposta (use_sse=true):**
```json
{
  "job_id": "uuid-do-job"
}
```

### GET `/accelerate/status/{job_id}`
Retorna o status atual de um job de processamento.

### GET `/accelerate/stream/{job_id}`
Stream de progresso via Server-Sent Events (SSE) para acompanhar o processamento em tempo real.

### GET `/accelerate/download/{job_id}`
Baixa o vídeo processado após a conclusão.

## 📁 Estrutura do Projeto

```
turbo-frame/
├── app/                          # Frontend React + Backend FastAPI
│   ├── components/              # Componentes React
│   │   ├── Dropzone.tsx         # Componente de upload
│   │   └── Icons.tsx            # Ícones customizados
│   ├── services/                # Serviços do frontend
│   │   └── api.ts               # Cliente API
│   ├── scripts/                 # Scripts Python
│   │   └── start.py             # Script de inicialização
│   ├── App.tsx                  # Componente principal
│   ├── main.py                  # Aplicação FastAPI
│   ├── utils.py                 # Funções de processamento FFmpeg
│   ├── package.json             # Dependências do frontend
│   └── vite.config.ts           # Configuração Vite
├── scripts/                      # Scripts de inicialização
│   └── start.sh                 # Script principal de start
├── uploads/                     # Vídeos enviados (criado automaticamente)
├── outputs/                     # Vídeos processados (criado automaticamente)
├── Dockerfile                    # Imagem Docker do backend
├── docker-compose.yml            # Configuração Docker Compose
├── requirements.txt              # Dependências Python
└── README.md                     # Este arquivo
```

## 🔧 Configuração

### Alterar Porta da API

Edite o arquivo `docker-compose.yml`:

```yaml
ports:
  - "SUA_PORTA:8000"
```

**Nota:** A porta interna do container permanece 8000. A porta externa (8888) é mapeada no docker-compose.

### Alterar Porta do Frontend

Edite o arquivo `app/vite.config.ts`:

```typescript
server: {
  port: SUA_PORTA,
  host: '0.0.0.0',
}
```

### Limites de Processamento

Os limites padrão são:
- Fator de aceleração mínimo: > 0
- Fator de aceleração máximo: ≤ 10

## 🎯 Como Usar

1. **Acesse o Frontend**: Abra http://localhost:3000 no navegador
2. **Selecione um Vídeo**: Arraste e solte ou clique para selecionar um arquivo de vídeo
3. **Configure a Velocidade**: Use o slider ou digite o fator de aceleração (ex: 1.5x, 2x)
4. **Inicie o Processamento**: Clique em "INICIAR PROCESSO"
5. **Acompanhe o Progresso**: Veja o progresso em tempo real na barra de progresso
6. **Baixe o Resultado**: Após concluir, baixe o vídeo processado

## 🛑 Parar os Serviços

### Usando o Script

Pressione `Ctrl+C` no terminal onde o script está rodando.

### Manualmente

```bash
# Parar containers Docker
docker-compose down

# Parar frontend
# Pressione Ctrl+C no terminal do frontend
```

Para remover também os volumes:

```bash
docker-compose down -v
```

## 🔄 Processamento Simultâneo

O sistema suporta múltiplos usuários processando vídeos simultaneamente:

- ✅ Cada usuário recebe um `job_id` único
- ✅ Processamento em threads separadas
- ✅ Arquivos isolados por usuário
- ✅ Progresso individual via SSE

## 📝 Notas Importantes

- Os arquivos temporários são automaticamente limpos após 60 segundos do download
- A aplicação aceita qualquer formato de vídeo suportado pelo FFmpeg
- O vídeo de saída será no formato MP4
- O processamento pode demorar dependendo do tamanho e duração do vídeo
- Múltiplos processamentos simultâneos podem impactar a performance do sistema

## 🐛 Troubleshooting

### API não responde

```bash
# Verificar logs do container
docker logs video-accelerate-api

# Reiniciar container
docker-compose restart
```

### Frontend não carrega

```bash
# Verificar se a porta 3000 está disponível
# Verificar logs do npm no terminal onde foi iniciado
```

### Erro ao processar vídeo

- Verifique se o FFmpeg está instalado no container: `docker exec video-accelerate-api ffmpeg -version`
- Verifique os logs: `docker logs video-accelerate-api`
- Certifique-se de que o arquivo é um vídeo válido

## 📄 Licença

Este projeto é de código aberto.

## 👥 Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou pull requests.

---

**Desenvolvido com ⚡ por Turbo Frame**
