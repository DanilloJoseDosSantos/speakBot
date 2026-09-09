import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { initDatabase } from "./store.js";
import {
  buildDashboard,
  buildSmartInsights,
  createAutomationEvent,
  createCollaborator,
  createTicket,
  createTicketAttachment,
  createTicketFromWebhookMessage,
  findCollaboratorByPhone,
  findUserByUsername,
  getTicketById,
  listAutomationEvents,
  listCollaborators,
  listManagerCriticalQueue,
  listRoutingRules,
  listTicketAttachments,
  listTickets,
  normalizePhone,
  roleCanManageCollaborators,
  roleCanManageTickets,
  runSlaAutomationSweep,
  sanitizeUser,
  updateTicket,
  verifyUserCredentials,
} from "./store.js";
import type { AuthRole, CollaboratorStatus, TicketAttachmentType, TicketCategory, TicketPriority, TicketStatus } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const sessions = new Map<string, { id: string; username: string; name: string; role: AuthRole; active: boolean }>();
const uploadsDir = path.resolve(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

const loginSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(4),
});

const collaboratorSchema = z.object({
  registration: z.string().min(3),
  name: z.string().min(3),
  phone: z.string().min(10),
  unit: z.string().min(2),
  department: z.string().min(2),
  role: z.string().min(2),
  status: z.enum(["ATIVO", "AFASTADO", "DESLIGADO"] satisfies [CollaboratorStatus, ...CollaboratorStatus[]]),
  whatsappOptIn: z.boolean(),
  whatsappOptInDate: z.string().nullable(),
  whatsappOptInVersion: z.string().nullable(),
  whatsappOptOutDate: z.string().nullable(),
  admittedAt: z.string().min(10),
});

const intakeSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(3),
  category: z.enum(["geral", "falta_atraso", "atestado", "ferias", "beneficios", "folha", "duvida_trabalhista"] satisfies [TicketCategory, ...TicketCategory[]]),
  priority: z.enum(["baixa", "media", "alta"] satisfies [TicketPriority, ...TicketPriority[]]),
});

const ticketUpdateSchema = z.object({
  status: z.enum(["novo", "em_atendimento", "aguardando_colaborador", "resolvido"] satisfies [TicketStatus, ...TicketStatus[]]).optional(),
  assignedTo: z.string().min(2).nullable().optional(),
});

const attachmentTypeSchema = z.enum(["atestado", "documento", "imagem", "pdf"] satisfies [TicketAttachmentType, ...TicketAttachmentType[]]);
const webhookSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(3),
});

function getBaseUrl(request: express.Request): string {
  return `${request.protocol}://${request.get("host")}`;
}

function getBearerToken(value: string | undefined): string | null {
  if (!value || !value.startsWith("Bearer ")) {
    return null;
  }

  return value.slice("Bearer ".length).trim();
}

async function requireAuth(request: express.Request, response: express.Response) {
  const token = getBearerToken(request.header("authorization"));
  if (!token) {
    response.status(401).json({ detail: "Token ausente." });
    return null;
  }

  const session = sessions.get(token);
  const user = session ? await findUserByUsername(session.username) : undefined;
  if (!session || !user?.active) {
    response.status(401).json({ detail: "Sessão inválida." });
    return null;
  }

  return session;
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "speakBot-backend" });
});

app.post("/api/login", async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: parsed.error.flatten() });
    return;
  }

  const user = await verifyUserCredentials(parsed.data.username, parsed.data.password);
  if (!user) {
    response.status(401).json({ detail: "Usuário ou senha inválidos." });
    return;
  }

  const token = randomUUID();
  const safeUser = sanitizeUser(user);
  sessions.set(token, safeUser);
  response.json({ token, user: safeUser });
});

app.get("/api/me", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  response.json(session);
});

app.get("/api/routing-rules", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  response.json(listRoutingRules());
});

app.get("/api/dashboard", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  response.json(await buildDashboard());
});

app.get("/api/insights", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  response.json(await buildSmartInsights());
});

app.get("/api/automation/events", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  response.json(await listAutomationEvents(80));
});

app.post("/api/automation/sla-sweep", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  if (session.role !== "rh") {
    response.status(403).json({ detail: "Somente RH pode disparar varredura de SLA." });
    return;
  }

  const result = await runSlaAutomationSweep(session.name);
  response.json(result);
});

app.get("/api/manager/queue", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  if (!roleCanManageTickets(session.role)) {
    response.status(403).json({ detail: "Perfil sem permissão para acessar fila crítica." });
    return;
  }

  const queue = await listManagerCriticalQueue();
  const collaborators = await listCollaborators();
  response.json(queue.map((ticket) => ({
    ...ticket,
    collaborator: collaborators.find((item) => item.id === ticket.collaboratorId) ?? null,
  })));
});

app.get("/api/collaborators", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  response.json(await listCollaborators());
});

app.post("/api/collaborators", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  if (!roleCanManageCollaborators(session.role)) {
    response.status(403).json({ detail: "Somente RH pode cadastrar colaboradores." });
    return;
  }

  const parsed = collaboratorSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: parsed.error.flatten() });
    return;
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const existing = (await listCollaborators()).find((item) => item.phone === normalizedPhone || item.registration === parsed.data.registration);
  if (existing) {
    response.status(409).json({ detail: "Colaborador já cadastrado com este telefone ou matrícula." });
    return;
  }

  const collaborator = await createCollaborator({
    ...parsed.data,
    phone: normalizedPhone,
  });

  response.status(201).json(collaborator);
});

app.get("/api/tickets", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  const collaborators = await listCollaborators();
  const rawTickets = await listTickets();
  const attachmentsByTicketId = await listTicketAttachments(rawTickets.map((ticket) => ticket.id), getBaseUrl(request));
  const tickets = rawTickets.map((ticket) => ({
    ...ticket,
    attachments: attachmentsByTicketId[ticket.id] || [],
    collaborator: collaborators.find((item) => item.id === ticket.collaboratorId) ?? null,
  }));
  response.json(tickets);
});

app.post("/api/tickets/intake", async (request, response) => {
  const parsed = intakeSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: parsed.error.flatten() });
    return;
  }

  const collaborator = await findCollaboratorByPhone(parsed.data.phone);
  if (!collaborator || collaborator.status !== "ATIVO") {
    response.status(403).json({ detail: "Canal exclusivo para colaboradores ativos cadastrados." });
    return;
  }

  if (!collaborator.whatsappOptIn) {
    response.status(403).json({ detail: "Colaborador sem autorização para atendimento via WhatsApp corporativo." });
    return;
  }

  const ticket = await createTicket({
    collaborator,
    collaboratorId: collaborator.id,
    category: parsed.data.category,
    priority: parsed.data.priority,
    message: parsed.data.message,
  });

  response.status(201).json({
    accepted: true,
    message: "Solicitação registrada na Central RH.",
    ticket: {
      ...ticket,
      collaborator,
    },
  });
});

app.post("/api/whatsapp/webhook", async (request, response) => {
  const parsed = webhookSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: parsed.error.flatten() });
    return;
  }

  try {
    const result = await createTicketFromWebhookMessage(parsed.data);
    response.status(201).json({
      accepted: true,
      mode: "automated",
      classification: result.classification,
      ticket: {
        ...result.ticket,
        collaborator: result.collaborator,
      },
    });
  } catch (error) {
    response.status(403).json({ detail: error instanceof Error ? error.message : "Falha no webhook." });
  }
});

app.patch("/api/tickets/:id", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  if (!roleCanManageTickets(session.role)) {
    response.status(403).json({ detail: "Perfil sem permissão para atualizar tickets." });
    return;
  }

  const parsed = ticketUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: parsed.error.flatten() });
    return;
  }

  const updated = await updateTicket(request.params.id, parsed.data);
  if (!updated) {
    response.status(404).json({ detail: "Ticket não encontrado." });
    return;
  }

  const collaborator = (await listCollaborators()).find((item) => item.id === updated.collaboratorId) ?? null;
  const attachmentsByTicketId = await listTicketAttachments([updated.id], getBaseUrl(request));

  if (parsed.data.status === "resolvido") {
    await createAutomationEvent({
      ticketId: updated.id,
      eventType: "ticket_resolved_followup",
      description: `Ticket ${updated.protocol} resolvido. Follow-up automático preparado para confirmação com o colaborador.`,
      triggeredBy: session.name,
    });
  }

  response.json({
    ...updated,
    attachments: attachmentsByTicketId[updated.id] || [],
    collaborator,
  });
});

app.post("/api/tickets/:id/attachments", upload.single("file"), async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  if (!roleCanManageTickets(session.role)) {
    response.status(403).json({ detail: "Perfil sem permissão para anexar documentos." });
    return;
  }

  const ticketId = String(request.params.id);
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    response.status(404).json({ detail: "Ticket não encontrado." });
    return;
  }

  const file = request.file;
  if (!file) {
    response.status(400).json({ detail: "Arquivo obrigatório." });
    return;
  }

  const parsedType = attachmentTypeSchema.safeParse(request.body.attachmentType || "documento");
  if (!parsedType.success) {
    response.status(400).json({ detail: "Tipo de anexo inválido." });
    return;
  }

  const extension = path.extname(file.originalname || "");
  const nextFileName = `${file.filename}${extension}`;
  fs.renameSync(file.path, path.join(uploadsDir, nextFileName));

  const attachment = await createTicketAttachment({
    ticketId,
    fileName: nextFileName,
    originalName: file.originalname,
    mimeType: file.mimetype || "application/octet-stream",
    sizeBytes: file.size,
    attachmentType: parsedType.data,
    uploadedBy: session.name,
  }, getBaseUrl(request));

  const collaborator = (await listCollaborators()).find((item) => item.id === ticket.collaboratorId) ?? null;
  const attachmentsByTicketId = await listTicketAttachments([ticketId], getBaseUrl(request));

  response.status(201).json({
    ticket: {
      ...ticket,
      attachments: attachmentsByTicketId[ticketId] || [],
      collaborator,
    },
    attachment,
  });
});

async function bootstrap() {
  await initDatabase();
  app.listen(port, () => {
    console.log(`RH Central backend running on http://localhost:${port}`);
  });
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to initialize RH Central backend", error);
  process.exit(1);
});
