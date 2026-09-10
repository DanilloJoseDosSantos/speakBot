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

- Cadastro de colaboradores com matrícula, CPF, unidade, setor, status e opt-in de WhatsApp
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

### Governança, auditoria e LGPD

- Trilha append-only de operações sensíveis com ator, perfil, ação, recurso, data, IP, agente e metadados mínimos
- Consulta da trilha restrita ao perfil RH em `GET /api/audit-logs`
- Registro e consulta de solicitações do titular em `POST /api/privacy/requests` e `GET /api/privacy/requests`
- Exportação estruturada dos dados do titular em `GET /api/privacy/collaborators/:id/export`
- Termo vigente e decisão explícita do titular em `GET /api/privacy/terms` e `POST /api/privacy/consent`, com aceite ou recusa, versão, snapshot do texto e data
- Cada decisão é arquivada em `consent_records` e pode ser baixada como planilha CSV por `GET /api/privacy/consent-records.csv` (RH)
- O cadastro permanece `pending` e a planilha contém apenas o cabeçalho até o colaborador registrar aceite ou recusa na página pública
- Ao cadastrar um colaborador com WhatsApp autorizado, o backend envia o link público `/consent` pela Meta quando as credenciais oficiais estiverem configuradas
- Após o cadastro, somente nome e endereço podem ser corrigidos pelo RH; CPF, matrícula, telefone, unidade, setor, cargo, status e consentimentos não são editáveis
- Exclusão de colaboradores e anonimização operacional estão bloqueadas para preservar a trilha e os registros arquivados
- O painel não coloca mensagem de WhatsApp, nome de arquivo ou conteúdo de documento dentro da auditoria; esses dados permanecem nas tabelas operacionais e no armazenamento de anexos
- CPF validado pelos dígitos verificadores, normalizado no banco e exibido com máscara no painel; registros antigos podem permanecer sem CPF até atualização cadastral

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
2. Copiar [.env.example](backend/.env.example) para um arquivo .env se quiser alterar a conexão ou configurar a Meta
3. Subir o PostgreSQL com docker compose na raiz do projeto
4. Executar npm install
5. Executar npm run dev

API padrão: <http://localhost:4000>

Banco padrão: postgresql://postgres:postgres@localhost:5432/rh_central

### WhatsApp Business da Meta

O webhook da Meta usa as rotas:

- GET /api/whatsapp/meta/webhook para validação do webhook
- POST /api/whatsapp/meta/webhook para receber mensagens

Configure no arquivo `backend/.env`:

- `META_VERIFY_TOKEN`: token criado por você e informado na configuração do webhook da Meta
- `META_ACCESS_TOKEN`: token permanente ou temporário do WhatsApp Business
- `META_PHONE_NUMBER_ID`: ID do número de telefone no Meta for Developers
- `META_APP_SECRET`: App Secret usado para validar a assinatura da Meta
- `META_GRAPH_API_VERSION`: versão da Graph API, com `v23.0` como padrão

Na Meta, informe como callback URL a URL pública HTTPS do backend seguida de `/api/whatsapp/meta/webhook`. O endereço `localhost` não pode ser acessado pelos servidores da Meta.

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
- GET /api/audit-logs (RH)
- GET /api/privacy/requests (RH)
- POST /api/privacy/requests (RH)
- GET /api/privacy/terms
- POST /api/privacy/consent
- GET /api/privacy/consent-records.csv (RH)
- GET /api/privacy/collaborators/:id/export (RH)

## Anexos

- Endpoint de upload: POST /api/tickets/:id/attachments
- Tipos suportados nesta fase: atestado, documento, imagem e pdf
- Limite atual por arquivo: 10 MB
- Os arquivos enviados ficam acessíveis pelo backend no padrão /uploads/nome-do-arquivo

## Banco de dados

1. Na raiz do projeto, executar docker compose up -d
2. O backend cria as tabelas users, collaborators, tickets e ticket_attachments automaticamente
4. Se o banco estiver vazio, a primeira inicialização importa os dados do arquivo legado [backend/data/db.json](backend/data/db.json)

### Checklist de inicialização

1. Inicie o Docker Desktop e confirme que o engine Linux está disponível.
2. Na raiz, execute `docker compose up -d` e confirme `docker compose ps` com o PostgreSQL em estado `running`.
3. No backend, execute `npm install` e `npm run dev`.
4. No frontend, execute `npm install` e `npm run dev`.
5. Abra `http://localhost:5173/` e valide login, cadastro, termo LGPD, ticket, anexo e auditoria.

Para um ambiente real, configure `CORS_ORIGIN` e `VITE_API_URL` com os domínios oficiais, use HTTPS, troque as credenciais iniciais, configure backup/retensão do PostgreSQL e substitua as sessões em memória por um armazenamento persistente antes de escalar o backend.
4. Se o banco estiver vazio, a primeira inicialização importa os dados do arquivo legado [backend/data/db.json](backend/data/db.json)
