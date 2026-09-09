# speakBot

Projeto de atendimento interno de RH da Rede Patão, agora identificado como speakBot.

## Stack

- Frontend: React com Vite
- Backend: Node.js com TypeScript e Express
- Banco de dados: PostgreSQL
- Persistência inicial migrada do JSON legado para schema relacional PostgreSQL
- Próxima etapa natural: integração real com WhatsApp Business Platform

## Fases concluídas

### Fase 1 - Comunicação estruturada

- Cadastro de colaboradores com matrícula, unidade, setor, status e opt-in de WhatsApp
- Bloqueio de acesso para não cadastrados, desligados ou sem autorização
- Intake de mensagens do WhatsApp corporativo com geração automática de protocolo
- Fila inicial de tickets RH com prioridade, categoria e mudança de status
- Fila com responsável por ticket, roteamento automático por unidade e assunto, e SLA calculado
- Dashboard web para RH com indicadores, cadastro e acompanhamento da fila
- Login inicial com perfis separados para RH e gestor
- Permissão de cadastro restrita ao perfil RH, com gestor em modo de leitura operacional
- Bootstrap automático do schema PostgreSQL ao iniciar o backend
- Seed inicial carregado a partir de [backend/data/db.json](backend/data/db.json) quando o banco estiver vazio
- Upload local de anexos por ticket para atestados e documentos, com histórico visível no painel

### Fase 2 - Automação operacional

- Webhook de WhatsApp para intake automatizado: POST /api/whatsapp/webhook
- Classificação automática de categoria e prioridade por palavras-chave da mensagem
- Eventos de automação em trilha de auditoria: criação automática, alertas SLA, violações e escalonamento
- Sweep manual de SLA para atualização em lote e geração de eventos: POST /api/automation/sla-sweep (perfil RH)
- Fila crítica para gestão com foco em tickets de alta prioridade e SLA violado: GET /api/manager/queue

### Fase 3 - RH inteligente

- Endpoint de insights acionáveis: GET /api/insights
- Recomendação automática com severidade para risco de SLA, tempo médio de resolução e concentração por categoria
- Ranking de categorias mais demandadas e unidades com maior volume para orientar capacidade operacional
- Painel web com visão integrada das fases 1, 2 e 3

## Estrutura

```text
rh-central/
├── docker-compose.yml
├── backend/
└── frontend/
```

## Rodando localmente

### Backend

1. Entrar em backend
2. Copiar [.env.example](backend/.env.example) para um arquivo .env se quiser alterar a conexão
3. Subir o PostgreSQL com docker compose na raiz do projeto
4. Executar npm install
5. Executar npm run dev

API padrão: <http://localhost:4000>

Banco padrão: postgresql://postgres:postgres@localhost:5432/rh_central

### Frontend

1. Entrar em frontend
2. Executar npm install
3. Executar npm run dev

Aplicação padrão: <http://localhost:5173>

## Acesso inicial

- RH: usuário rh, senha rh123
- Gestor: usuário gestor, senha gestor123

## Perfis desta fase

- RH: acessa dashboard, colaboradores e tickets; pode cadastrar colaboradores e atualizar tickets
- Gestor: acessa dashboard e tickets; não pode cadastrar colaboradores

## Operação de tickets

- Cada ticket recebe um destino sugerido de fila com base na categoria e, quando aplicável, na unidade do colaborador
- O sistema calcula SLA em horas no momento da abertura e classifica o ticket como no prazo, vencendo ou violado
- RH e gestor podem definir o responsável pelo atendimento dentro do painel
- RH e gestor podem anexar atestados, PDFs, imagens e documentos diretamente no ticket

## Endpoints das fases 2 e 3

- POST /api/whatsapp/webhook
- GET /api/automation/events
- POST /api/automation/sla-sweep
- GET /api/manager/queue
- GET /api/insights

## Anexos

- Endpoint de upload: POST /api/tickets/:id/attachments
- Tipos suportados nesta fase: atestado, documento, imagem e pdf
- Limite atual por arquivo: 10 MB
- Os arquivos enviados ficam acessíveis pelo backend no padrão /uploads/nome-do-arquivo

## Banco de dados

1. Na raiz do projeto, executar docker compose up -d
2. O backend cria as tabelas users, collaborators, tickets e ticket_attachments automaticamente
3. O backend também cria a tabela automation_events para trilha de automação
4. Se o banco estiver vazio, a primeira inicialização importa os dados do arquivo legado [backend/data/db.json](backend/data/db.json)
