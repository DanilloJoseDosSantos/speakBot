import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { initDatabase } from "./store.js";
import {
  buildDashboard,
  buildSmartInsights,
  createAuditLog,
  createAutomationEvent,
  createCollaborator,
  createPrivacyRequest,
  createTicket,
  createTicketAttachment,
  createTicketFromWebhookMessage,
  exportCollaboratorData,
  findCollaboratorByPhone,
  findUserByUsername,
  getTicketById,
  listAutomationEvents,
  listAuditLogs,
  listConsentRecords,
  listCollaborators,
  listManagerCriticalQueue,
  listRoutingRules,
  listTicketAttachments,
  listTickets,
  listPrivacyRequests,
  normalizePhone,
  normalizeCpf,
  isValidCpf,
  roleCanManageCollaborators,
  roleCanManageTickets,
  runSlaAutomationSweep,
  sanitizeUser,
  updateCollaboratorProfile,
  updateTicket,
  verifyUserCredentials,
  updateCollaboratorConsent,
} from "./store.js";
import type { AuthRole, CollaboratorStatus, LgpdConsentStatus, TicketAttachmentType, TicketCategory, TicketPriority, TicketStatus } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const metaVerifyToken = process.env.META_VERIFY_TOKEN;
const metaAccessToken = process.env.META_ACCESS_TOKEN;
const metaPhoneNumberId = process.env.META_PHONE_NUMBER_ID;
const metaGraphApiVersion = process.env.META_GRAPH_API_VERSION || "v23.0";
const metaAppSecret = process.env.META_APP_SECRET;
const publicAppUrl = process.env.PUBLIC_APP_URL || "http://localhost:5173";
const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean);
const sessions = new Map<string, { id: string; username: string; name: string; role: AuthRole; active: boolean }>();
const rawBodies = new WeakMap<object, string>();
const uploadsDir = path.resolve(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(cors({ origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? true : corsOrigins }));
app.use(express.json({
  limit: "1mb",
  verify: (request, _response, buffer) => {
    rawBodies.set(request, buffer.toString("utf8"));
  },
}));
const loginSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(4),
});

const collaboratorSchema = z.object({
  registration: z.string().min(3),
  cpf: z.string().transform(normalizeCpf).refine(isValidCpf, "Informe um CPF válido."),
  name: z.string().min(3),
  address: z.string().trim().min(3),
  phone: z.string().min(10),
  unit: z.string().min(2),
  department: z.string().min(2),
  role: z.string().min(2),
  status: z.enum(["ATIVO", "AFASTADO", "DESLIGADO"] satisfies [CollaboratorStatus, ...CollaboratorStatus[]]),
  whatsappOptIn: z.boolean(),
  whatsappOptInDate: z.string().nullable(),
  whatsappOptInVersion: z.string().nullable(),
  whatsappOptOutDate: z.string().nullable(),
  lgpdConsentStatus: z.enum(["pending", "accepted", "refused"]).default("pending"),
  lgpdConsentVersion: z.string().nullable().default(null),
  lgpdConsentAt: z.string().nullable().default(null),
  lgpdConsentRefusedAt: z.string().nullable().default(null),
  admittedAt: z.string().min(10),
});

const collaboratorProfileSchema = z.object({
  name: z.string().trim().min(3),
  address: z.string().trim().min(3),
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

const privacyRequestSchema = z.object({
  collaboratorId: z.string().uuid(),
  requestType: z.enum(["access", "correction", "deletion", "consent_revocation"]),
  notes: z.string().trim().max(500).nullable().optional(),
});

const consentSchema = z.object({
  registration: z.string().min(3),
  phone: z.string().min(10),
  decision: z.enum(["accepted", "refused"] satisfies [Exclude<LgpdConsentStatus, "pending">, ...Exclude<LgpdConsentStatus, "pending">[]]),
});

const lgpdTerms = {
  version: "v1",
  title: "Termo de privacidade e tratamento de dados",
  text: "A Rede Patao poderá tratar os dados cadastrais e as informações fornecidas no atendimento para executar rotinas de RH, responder solicitações, cumprir obrigações legais e proteger direitos. O titular pode solicitar acesso, correção, informação sobre o uso e anonimização quando aplicável. O aceite deste termo não substitui o consentimento específico do WhatsApp.",
};

function getBaseUrl(request: express.Request): string {
  return `${request.protocol}://${request.get("host")}`;
}

function getBearerToken(value: string | undefined): string | null {
  if (!value || !value.startsWith("Bearer ")) {
    return null;
  }

  return value.slice("Bearer ".length).trim();
}

function isMetaSignatureValid(rawBody: string, signature: string | undefined): boolean {
  if (!metaAppSecret) {
    return true;
  }

  if (!signature?.startsWith("sha256=")) {
    return false;
  }

  const expected = Buffer.from(`sha256=${createHmac("sha256", metaAppSecret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function sendMetaTextMessage(to: string, body: string): Promise<void> {
  if (!metaAccessToken || !metaPhoneNumberId) {
    return;
  }

  const response = await fetch(`https://graph.facebook.com/${metaGraphApiVersion}/${metaPhoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${metaAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Falha ao enviar resposta pela Meta: ${response.status} ${detail}`);
  }
}

async function sendConsentInvitation(phone: string, registration: string): Promise<"sent" | "not_configured"> {
  if (!metaAccessToken || !metaPhoneNumberId) return "not_configured";
  const consentUrl = `${publicAppUrl}/consent?registration=${encodeURIComponent(registration)}`;
  await sendMetaTextMessage(phone, `Olá! Acesse o termo de privacidade da Central RH e registre sua decisão (aceitar ou recusar): ${consentUrl}`);
  return "sent";
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

app.get("/uploads/:fileName", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) return;

  const fileName = path.basename(String(request.params.fileName));
  const filePath = path.join(uploadsDir, fileName);
  if (!fs.existsSync(filePath)) {
    response.status(404).json({ detail: "Anexo não encontrado." });
    return;
  }
  response.sendFile(filePath);
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "speakBot-backend" });
});

app.get("/api/privacy/terms", (_request, response) => {
  response.json(lgpdTerms);
});

app.get("/api/privacy/consent-records.csv", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) return;
  if (session.role !== "rh") {
    response.status(403).json({ detail: "Somente RH pode exportar o arquivo de consentimentos." });
    return;
  }
  const records = await listConsentRecords();
  const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["id", "collaboratorId", "registration", "cpf", "collaboratorName", "address", "phone", "termVersion", "termTitle", "termText", "decision", "recordedAt", "ipAddress", "userAgent"];
  const lines = [header.join(","), ...records.map((record) => header.map((field) => escapeCsv(record[field as keyof typeof record])).join(","))];
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", "attachment; filename=consentimentos-lgpd.csv");
  response.send(`\uFEFF${lines.join("\n")}`);
});

app.get("/api/privacy/consent-records", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) return;
  if (session.role !== "rh") {
    response.status(403).json({ detail: "Somente RH pode consultar os registros de consentimento." });
    return;
  }
  response.json(await listConsentRecords());
});

app.post("/api/privacy/consent", async (request, response) => {
  const parsed = consentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: parsed.error.flatten() });
    return;
  }
  const collaborator = await updateCollaboratorConsent({
    registration: parsed.data.registration,
    phone: parsed.data.phone,
    status: parsed.data.decision,
    version: lgpdTerms.version,
    termTitle: lgpdTerms.title,
    termText: lgpdTerms.text,
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });
  if (!collaborator) {
    response.status(403).json({ detail: "Matrícula e telefone não conferem com um cadastro ativo." });
    return;
  }
  await createAuditLog({
    actorName: "titular",
    actorRole: "system",
    action: "update",
    resourceType: "lgpd_consent",
    resourceId: collaborator.id,
    metadata: { decision: parsed.data.decision, version: lgpdTerms.version },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });
  response.json({ accepted: true, consent: { status: collaborator.lgpdConsentStatus, version: collaborator.lgpdConsentVersion, recordedAt: collaborator.lgpdConsentAt || collaborator.lgpdConsentRefusedAt } });
});

app.get("/api/whatsapp/meta/webhook", (request, response) => {
  const mode = request.query["hub.mode"];
  const token = request.query["hub.verify_token"];
  const challenge = request.query["hub.challenge"];

  if (mode === "subscribe" && metaVerifyToken && token === metaVerifyToken && typeof challenge === "string") {
    response.status(200).send(challenge);
    return;
  }

  response.sendStatus(403);
});

app.post("/api/whatsapp/meta/webhook", async (request, response) => {
  const rawBody = rawBodies.get(request) || JSON.stringify(request.body);
  if (!isMetaSignatureValid(rawBody, request.header("x-hub-signature-256"))) {
    response.sendStatus(403);
    return;
  }

  try {
    const payload = JSON.parse(rawBody) as {
      entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ from?: string; text?: { body?: string } }> } }> }>;
    };
    const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const phone = message?.from;
    const text = message?.text?.body;

    if (!phone || !text) {
      response.sendStatus(200);
      return;
    }

    const result = await createTicketFromWebhookMessage({ phone, message: text });
    if (metaAccessToken && metaPhoneNumberId) {
      await sendMetaTextMessage(phone, `Solicitação registrada na Central RH. Protocolo: ${result.ticket.protocol}.`);
    }

    response.status(200).json({ accepted: true, protocol: result.ticket.protocol });
  } catch (error) {
    response.status(200).json({ accepted: false, detail: error instanceof Error ? error.message : "Falha no webhook da Meta." });
  }
});

app.post("/api/login", async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: parsed.error.flatten() });
    return;
  }

  const user = await verifyUserCredentials(parsed.data.username, parsed.data.password);
  if (!user) {
    await createAuditLog({
      actorName: parsed.data.username,
      actorRole: "system",
      action: "login",
      resourceType: "session",
      metadata: { outcome: "failure" },
      ipAddress: request.ip,
      userAgent: request.get("user-agent") || null,
    });
    response.status(401).json({ detail: "Usuário ou senha inválidos." });
    return;
  }

  const token = randomUUID();
  const safeUser = sanitizeUser(user);
  sessions.set(token, safeUser);
  await createAuditLog({
    actorUserId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: "login",
    resourceType: "session",
    metadata: { outcome: "success" },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });
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

app.get("/api/audit-logs", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) return;
  if (session.role !== "rh") {
    response.status(403).json({ detail: "Somente RH pode consultar a trilha de auditoria." });
    return;
  }
  response.json(await listAuditLogs(Number(request.query.limit) || 100));
});

app.get("/api/privacy/requests", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) return;
  if (session.role !== "rh") {
    response.status(403).json({ detail: "Somente RH pode consultar solicitações LGPD." });
    return;
  }
  response.json(await listPrivacyRequests(Number(request.query.limit) || 100));
});

app.post("/api/privacy/requests", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) return;
  if (session.role !== "rh") {
    response.status(403).json({ detail: "Somente RH pode registrar solicitações LGPD." });
    return;
  }
  const parsed = privacyRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: parsed.error.flatten() });
    return;
  }
  const collaborator = (await listCollaborators()).find((item) => item.id === parsed.data.collaboratorId);
  if (!collaborator) {
    response.status(404).json({ detail: "Colaborador não encontrado." });
    return;
  }
  const privacyRequest = await createPrivacyRequest({
    ...parsed.data,
    requestedBy: session.name,
  });
  await createAuditLog({
    actorUserId: session.id,
    actorName: session.name,
    actorRole: session.role,
    action: "create",
    resourceType: "privacy_request",
    resourceId: privacyRequest.id,
    metadata: { requestType: privacyRequest.requestType, collaboratorId: collaborator.id },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });
  response.status(201).json(privacyRequest);
});

app.get("/api/privacy/collaborators/:id/export", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) return;
  if (session.role !== "rh") {
    response.status(403).json({ detail: "Somente RH pode exportar dados pessoais." });
    return;
  }
  const exported = await exportCollaboratorData(String(request.params.id));
  if (!exported) {
    response.status(404).json({ detail: "Colaborador não encontrado." });
    return;
  }
  await createAuditLog({
    actorUserId: session.id,
    actorName: session.name,
    actorRole: session.role,
    action: "export",
    resourceType: "collaborator_data",
    resourceId: String(request.params.id),
    metadata: { ticketCount: exported.tickets.length },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });
  response.json({ exportedAt: new Date().toISOString(), ...exported });
});

app.post("/api/privacy/collaborators/:id/anonymize", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) return;
  response.status(405).json({ detail: "A anonimização operacional está desativada para preservar o arquivo imutável de consentimentos." });
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
  const normalizedCpf = normalizeCpf(parsed.data.cpf);
  const existing = (await listCollaborators()).find((item) => item.phone === normalizedPhone || item.registration === parsed.data.registration || item.cpf === normalizedCpf);
  if (existing) {
    response.status(409).json({ detail: "Colaborador já cadastrado com este telefone, matrícula ou CPF." });
    return;
  }

  const collaborator = await createCollaborator({
    ...parsed.data,
    cpf: normalizedCpf,
    phone: normalizedPhone,
  });

  let consentInvitation: "sent" | "not_configured" = "not_configured";
  if (collaborator.whatsappOptIn) {
    try {
      consentInvitation = await sendConsentInvitation(collaborator.phone, collaborator.registration);
    } catch (error) {
      await createAuditLog({
        actorUserId: session.id,
        actorName: session.name,
        actorRole: session.role,
        action: "system",
        resourceType: "consent_invitation",
        resourceId: collaborator.id,
        metadata: { outcome: "failed", detail: error instanceof Error ? error.message : "unknown" },
      });
    }
  }

  await createAuditLog({
    actorUserId: session.id,
    actorName: session.name,
    actorRole: session.role,
    action: "create",
    resourceType: "collaborator",
    resourceId: collaborator.id,
    metadata: { registration: collaborator.registration, unit: collaborator.unit },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });

  response.status(201).json({ collaborator, consentInvitation });
});

app.delete("/api/collaborators/:id", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }
  response.status(405).json({ detail: "Dados cadastrais não podem ser apagados. Apenas nome e endereço podem ser corrigidos pelo RH." });
});

app.patch("/api/collaborators/:id", async (request, response) => {
  const session = await requireAuth(request, response);
  if (!session) {
    return;
  }

  if (!roleCanManageCollaborators(session.role)) {
    response.status(403).json({ detail: "Somente RH pode editar colaboradores." });
    return;
  }

  const parsed = collaboratorProfileSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ detail: "Informe um nome com pelo menos 3 caracteres." });
    return;
  }

  const collaborator = await updateCollaboratorProfile(String(request.params.id), parsed.data.name, parsed.data.address);
  if (!collaborator) {
    response.status(404).json({ detail: "Colaborador não encontrado." });
    return;
  }

  await createAuditLog({
    actorUserId: session.id,
    actorName: session.name,
    actorRole: session.role,
    action: "update",
    resourceType: "collaborator",
    resourceId: collaborator.id,
    metadata: { fields: ["name"] },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });

  response.json(collaborator);
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

  await createAuditLog({
    actorName: "intake-manual",
    actorRole: "system",
    action: "create",
    resourceType: "ticket",
    resourceId: ticket.id,
    metadata: { channel: ticket.channel, category: ticket.category, priority: ticket.priority },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
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
    await createAuditLog({
      actorName: "whatsapp-webhook",
      actorRole: "system",
      action: "create",
      resourceType: "ticket",
      resourceId: result.ticket.id,
      metadata: { channel: "whatsapp", category: result.ticket.category, priority: result.ticket.priority },
      ipAddress: request.ip,
      userAgent: request.get("user-agent") || null,
    });
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

  await createAuditLog({
    actorUserId: session.id,
    actorName: session.name,
    actorRole: session.role,
    action: "update",
    resourceType: "ticket",
    resourceId: updated.id,
    metadata: { fields: Object.keys(parsed.data) },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });

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

  await createAuditLog({
    actorUserId: session.id,
    actorName: session.name,
    actorRole: session.role,
    action: "create",
    resourceType: "ticket_attachment",
    resourceId: attachment.id,
    metadata: { ticketId, attachmentType: attachment.attachmentType, sizeBytes: attachment.sizeBytes },
    ipAddress: request.ip,
    userAgent: request.get("user-agent") || null,
  });

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
