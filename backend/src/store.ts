import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { runQuery } from "./database.js";
import type {
  AuthRole,
  AuthUser,
  AutomationEvent,
  AutomationEventType,
  Collaborator,
  CollaboratorStatus,
  DatabaseShape,
  ServiceWindow,
  SmartInsight,
  Ticket,
  TicketAttachment,
  TicketAttachmentType,
  TicketCategory,
  TicketPriority,
  TicketSlaStatus,
  TicketStatus,
} from "./types.js";

const dataDir = path.resolve(process.cwd(), "data");
const dataFile = path.join(dataDir, "db.json");

function hashPassword(value: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPasswordHash(value: string, storedHash: string): boolean {
  const [salt, storedDigest] = storedHash.split(":");
  if (!salt || !storedDigest) {
    return false;
  }

  const digest = scryptSync(value, salt, 64);
  const storedBuffer = Buffer.from(storedDigest, "hex");
  if (digest.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(digest, storedBuffer);
}

const initialUsers: AuthUser[] = [
  {
    id: randomUUID(),
    username: "rh",
    name: "Equipe RH",
    role: "rh",
    passwordHash: hashPassword("rh123"),
    active: true,
  },
  {
    id: randomUUID(),
    username: "gestor",
    name: "Gestor Unidade",
    role: "manager",
    passwordHash: hashPassword("gestor123"),
    active: true,
  },
];

const initialData: DatabaseShape = {
  users: initialUsers,
  collaborators: [
    {
      id: randomUUID(),
      registration: "RP-1001",
      name: "João Silva",
      phone: "11977776666",
      unit: "Patos de Minas",
      department: "Operações",
      role: "Frentista",
      status: "ATIVO",
      whatsappOptIn: true,
      whatsappOptInDate: "2026-09-08T08:00:00.000Z",
      whatsappOptInVersion: "v1",
      whatsappOptOutDate: null,
      admittedAt: "2026-01-10",
    },
    {
      id: randomUUID(),
      registration: "RP-1002",
      name: "Vanessa Souza",
      phone: "11966665555",
      unit: "Marabá",
      department: "RH",
      role: "Assistente RH",
      status: "ATIVO",
      whatsappOptIn: true,
      whatsappOptInDate: "2026-09-01T08:00:00.000Z",
      whatsappOptInVersion: "v1",
      whatsappOptOutDate: null,
      admittedAt: "2025-03-15",
    },
    {
      id: randomUUID(),
      registration: "RP-1003",
      name: "Carlos Pereira",
      phone: "11955554444",
      unit: "Tomaz de Aquino",
      department: "Logística",
      role: "Motorista",
      status: "DESLIGADO",
      whatsappOptIn: false,
      whatsappOptInDate: null,
      whatsappOptInVersion: null,
      whatsappOptOutDate: "2026-08-30T10:00:00.000Z",
      admittedAt: "2024-02-10",
    }
  ],
  tickets: [],
};

function ensureDatabaseShape(data: Partial<DatabaseShape>): DatabaseShape {
  const users = Array.isArray(data.users) && data.users.length > 0 ? data.users : initialUsers;
  const collaborators = Array.isArray(data.collaborators) ? data.collaborators : initialData.collaborators;
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];

  return {
    users,
    collaborators,
    tickets,
  };
}

function readLegacySeedData(): DatabaseShape {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2), "utf-8");
    return initialData;
  }

  const content = fs.readFileSync(dataFile, "utf-8");
  const parsed = JSON.parse(content) as Partial<DatabaseShape>;
  const hydrated = ensureDatabaseShape(parsed);

  if (!Array.isArray(parsed.users) || !Array.isArray(parsed.collaborators) || !Array.isArray(parsed.tickets)) {
    fs.writeFileSync(dataFile, JSON.stringify(hydrated, null, 2), "utf-8");
  }

  return hydrated;
}

type UserRow = {
  id: string;
  username: string;
  name: string;
  role: AuthRole;
  password_hash: string;
  active: boolean;
};

type CollaboratorRow = {
  id: string;
  registration: string;
  name: string;
  phone: string;
  unit: string;
  department: string;
  job_role: string;
  status: Collaborator["status"];
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_date: Date | null;
  whatsapp_opt_in_version: string | null;
  whatsapp_opt_out_date: Date | null;
  admitted_at: string;
};

type TicketRow = {
  id: string;
  protocol: string;
  collaborator_id: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  channel: "whatsapp";
  service_window: ServiceWindow;
  route_target: string;
  route_reason: string;
  sla_hours: number;
  due_at: Date;
  sla_status: TicketSlaStatus;
  message: string;
  created_at: Date;
  assigned_to: string | null;
  last_update_at: Date;
};

type TicketAttachmentRow = {
  id: string;
  ticket_id: string;
  file_name: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  attachment_type: TicketAttachmentType;
  uploaded_by: string;
  uploaded_at: Date;
};

type AutomationEventRow = {
  id: string;
  ticket_id: string;
  event_type: AutomationEventType;
  description: string;
  triggered_by: string;
  created_at: Date;
};

type RoutingRule = {
  queue: string;
  defaultSlaHours: number;
  unitScoped: boolean;
  reason: string;
};

const routingRules: Record<TicketCategory, RoutingRule> = {
  geral: {
    queue: "RH Corporativo",
    defaultSlaHours: 24,
    unitScoped: false,
    reason: "Demandas gerais seguem para a fila corporativa do RH.",
  },
  falta_atraso: {
    queue: "Assiduidade",
    defaultSlaHours: 2,
    unitScoped: true,
    reason: "Ausência e atraso precisam chegar rápido ao RH da unidade.",
  },
  atestado: {
    queue: "Documentos e Medicina do Trabalho",
    defaultSlaHours: 4,
    unitScoped: true,
    reason: "Atestados exigem triagem documental e validação por unidade.",
  },
  ferias: {
    queue: "Jornada e Férias",
    defaultSlaHours: 24,
    unitScoped: false,
    reason: "Solicitações de férias seguem para a célula central de jornada.",
  },
  beneficios: {
    queue: "Benefícios",
    defaultSlaHours: 24,
    unitScoped: false,
    reason: "Benefícios dependem de tratamento corporativo padronizado.",
  },
  folha: {
    queue: "Folha e Pagamento",
    defaultSlaHours: 8,
    unitScoped: false,
    reason: "Divergências de folha têm SLA reduzido e fila especializada.",
  },
  duvida_trabalhista: {
    queue: "Relações Trabalhistas",
    defaultSlaHours: 12,
    unitScoped: false,
    reason: "Assuntos trabalhistas seguem para uma trilha mais sensível e controlada.",
  },
};

const intentRules: Array<{ category: TicketCategory; keywords: string[]; priority?: TicketPriority }> = [
  { category: "atestado", keywords: ["atestado", "cid", "afastamento"], priority: "alta" },
  { category: "falta_atraso", keywords: ["falta", "atraso", "ponto", "abono"], priority: "alta" },
  { category: "folha", keywords: ["holerite", "salario", "pagamento", "desconto"], priority: "media" },
  { category: "beneficios", keywords: ["vale", "beneficio", "plano", "convenio"], priority: "media" },
  { category: "ferias", keywords: ["ferias", "recesso", "abono pecuniario"], priority: "baixa" },
  { category: "duvida_trabalhista", keywords: ["trabalhista", "advertencia", "justa causa"], priority: "alta" },
  { category: "geral", keywords: ["duvida", "informacao", "solicitacao"], priority: "media" },
];

function mapUserRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    passwordHash: row.password_hash,
    active: row.active,
  };
}

function mapCollaboratorRow(row: CollaboratorRow): Collaborator {
  return {
    id: row.id,
    registration: row.registration,
    name: row.name,
    phone: row.phone,
    unit: row.unit,
    department: row.department,
    role: row.job_role,
    status: row.status,
    whatsappOptIn: row.whatsapp_opt_in,
    whatsappOptInDate: row.whatsapp_opt_in_date ? row.whatsapp_opt_in_date.toISOString() : null,
    whatsappOptInVersion: row.whatsapp_opt_in_version,
    whatsappOptOutDate: row.whatsapp_opt_out_date ? row.whatsapp_opt_out_date.toISOString() : null,
    admittedAt: row.admitted_at,
  };
}

function mapTicketRow(row: TicketRow): Ticket {
  return {
    id: row.id,
    protocol: row.protocol,
    collaboratorId: row.collaborator_id,
    category: row.category,
    priority: row.priority,
    status: row.status,
    channel: row.channel,
    serviceWindow: row.service_window,
    routeTarget: row.route_target,
    routeReason: row.route_reason,
    slaHours: row.sla_hours,
    dueAt: row.due_at.toISOString(),
    slaStatus: row.sla_status,
    message: row.message,
    createdAt: row.created_at.toISOString(),
    assignedTo: row.assigned_to,
    lastUpdateAt: row.last_update_at.toISOString(),
    attachments: [],
  };
}

function mapTicketAttachmentRow(row: TicketAttachmentRow, baseUrl: string): TicketAttachment {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    fileName: row.file_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    attachmentType: row.attachment_type,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at.toISOString(),
    publicUrl: `${baseUrl}/uploads/${row.file_name}`,
  };
}

function mapAutomationEventRow(row: AutomationEventRow): AutomationEvent {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventType: row.event_type,
    description: row.description,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at.toISOString(),
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferTicketCategoryAndPriority(message: string): { category: TicketCategory; priority: TicketPriority } {
  const normalizedMessage = normalizeText(message);
  for (const rule of intentRules) {
    const matched = rule.keywords.some((keyword) => normalizedMessage.includes(keyword));
    if (matched) {
      return {
        category: rule.category,
        priority: rule.priority ?? "media",
      };
    }
  }

  return {
    category: "geral",
    priority: "media",
  };
}

function priorityBonusHours(priority: TicketPriority): number {
  return {
    alta: -1,
    media: 0,
    baixa: 8,
  }[priority];
}

function computeSlaHours(category: TicketCategory, priority: TicketPriority): number {
  return Math.max(1, routingRules[category].defaultSlaHours + priorityBonusHours(priority));
}

function buildRouteTarget(collaborator: Collaborator, category: TicketCategory): string {
  const rule = routingRules[category];
  if (rule.unitScoped) {
    return `${rule.queue} • ${collaborator.unit}`;
  }
  return rule.queue;
}

function buildRouteReason(collaborator: Collaborator, category: TicketCategory): string {
  const rule = routingRules[category];
  if (rule.unitScoped) {
    return `${rule.reason} Unidade identificada: ${collaborator.unit}.`;
  }
  return rule.reason;
}

function computeDueAt(createdAt: Date, slaHours: number): string {
  const dueAt = new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000);
  return dueAt.toISOString();
}

function computeSlaStatus(dueAtIso: string, status: TicketStatus, reference = new Date()): TicketSlaStatus {
  if (status === "resolvido") {
    return "no_prazo";
  }

  const dueAt = new Date(dueAtIso);
  const remainingMs = dueAt.getTime() - reference.getTime();
  if (remainingMs <= 0) {
    return "violado";
  }
  if (remainingMs <= 2 * 60 * 60 * 1000) {
    return "vencendo";
  }
  return "no_prazo";
}

export function listRoutingRules() {
  return Object.entries(routingRules).map(([category, config]) => ({
    category,
    queue: config.queue,
    defaultSlaHours: config.defaultSlaHours,
    unitScoped: config.unitScoped,
    reason: config.reason,
  }));
}

export async function initDatabase(): Promise<void> {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS collaborators (
      id UUID PRIMARY KEY,
      registration TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL,
      department TEXT NOT NULL,
      job_role TEXT NOT NULL,
      status TEXT NOT NULL,
      whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
      whatsapp_opt_in_date TIMESTAMPTZ NULL,
      whatsapp_opt_in_version TEXT NULL,
      whatsapp_opt_out_date TIMESTAMPTZ NULL,
      admitted_at DATE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY,
      protocol TEXT NOT NULL UNIQUE,
      collaborator_id UUID NOT NULL REFERENCES collaborators(id) ON DELETE RESTRICT,
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      channel TEXT NOT NULL,
      service_window TEXT NOT NULL,
      route_target TEXT NOT NULL DEFAULT 'RH Corporativo',
      route_reason TEXT NOT NULL DEFAULT 'Regra inicial não calculada.',
      sla_hours INTEGER NOT NULL DEFAULT 24,
      due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sla_status TEXT NOT NULL DEFAULT 'no_prazo',
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      assigned_to TEXT NULL,
      last_update_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id UUID PRIMARY KEY,
      ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      attachment_type TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS automation_events (
      id UUID PRIMARY KEY,
      ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await runQuery(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS route_target TEXT NOT NULL DEFAULT 'RH Corporativo'`);
  await runQuery(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS route_reason TEXT NOT NULL DEFAULT 'Regra inicial não calculada.'`);
  await runQuery(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_hours INTEGER NOT NULL DEFAULT 24`);
  await runQuery(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await runQuery(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_status TEXT NOT NULL DEFAULT 'no_prazo'`);

  const { rows } = await runQuery<{ users_count: string; collaborators_count: string; tickets_count: string; attachments_count: string; events_count: string }>(`
    SELECT
      (SELECT COUNT(*)::text FROM users) AS users_count,
      (SELECT COUNT(*)::text FROM collaborators) AS collaborators_count,
      (SELECT COUNT(*)::text FROM tickets) AS tickets_count,
      (SELECT COUNT(*)::text FROM ticket_attachments) AS attachments_count,
      (SELECT COUNT(*)::text FROM automation_events) AS events_count
  `);

  const counts = rows[0];
  const shouldSeed =
    counts.users_count === "0"
    && counts.collaborators_count === "0"
    && counts.tickets_count === "0"
    && counts.attachments_count === "0"
    && counts.events_count === "0";
  if (!shouldSeed) {
    return;
  }

  const seed = readLegacySeedData();

  for (const user of seed.users) {
    await runQuery(
      `INSERT INTO users (id, username, name, role, password_hash, active) VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.username, user.name, user.role, user.passwordHash, user.active],
    );
  }

  for (const collaborator of seed.collaborators) {
    await runQuery(
      `
        INSERT INTO collaborators (
          id, registration, name, phone, unit, department, job_role, status,
          whatsapp_opt_in, whatsapp_opt_in_date, whatsapp_opt_in_version, whatsapp_opt_out_date, admitted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        collaborator.id,
        collaborator.registration,
        collaborator.name,
        normalizePhone(collaborator.phone),
        collaborator.unit,
        collaborator.department,
        collaborator.role,
        collaborator.status,
        collaborator.whatsappOptIn,
        collaborator.whatsappOptInDate,
        collaborator.whatsappOptInVersion,
        collaborator.whatsappOptOutDate,
        collaborator.admittedAt,
      ],
    );
  }

  for (const ticket of seed.tickets) {
    await runQuery(
      `
        INSERT INTO tickets (
          id, protocol, collaborator_id, category, priority, status, channel,
          service_window, route_target, route_reason, sla_hours, due_at, sla_status,
          message, created_at, assigned_to, last_update_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `,
      [
        ticket.id,
        ticket.protocol,
        ticket.collaboratorId,
        ticket.category,
        ticket.priority,
        ticket.status,
        ticket.channel,
        ticket.serviceWindow,
        ticket.routeTarget,
        ticket.routeReason,
        ticket.slaHours,
        ticket.dueAt,
        ticket.slaStatus,
        ticket.message,
        ticket.createdAt,
        ticket.assignedTo,
        ticket.lastUpdateAt,
      ],
    );
  }
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function isBusinessHours(reference = new Date()): boolean {
  const day = reference.getDay();
  const hour = reference.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

export async function listCollaborators(): Promise<Collaborator[]> {
  const { rows } = await runQuery<CollaboratorRow>(`SELECT * FROM collaborators ORDER BY name ASC`);
  return rows.map(mapCollaboratorRow);
}

export async function listUsers(): Promise<AuthUser[]> {
  const { rows } = await runQuery<UserRow>(`SELECT * FROM users ORDER BY username ASC`);
  return rows.map(mapUserRow);
}

export function sanitizeUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active,
  };
}

export async function findUserByUsername(username: string): Promise<AuthUser | undefined> {
  const { rows } = await runQuery<UserRow>(`SELECT * FROM users WHERE lower(username) = lower($1) LIMIT 1`, [username.trim()]);
  return rows[0] ? mapUserRow(rows[0]) : undefined;
}

export async function verifyUserCredentials(username: string, password: string): Promise<AuthUser | undefined> {
  const user = await findUserByUsername(username);
  if (!user || !user.active) {
    return undefined;
  }

  return verifyPasswordHash(password, user.passwordHash) ? user : undefined;
}

export async function createCollaborator(collaborator: Omit<Collaborator, "id">): Promise<Collaborator> {
  const record: Collaborator = {
    id: randomUUID(),
    ...collaborator,
    phone: normalizePhone(collaborator.phone),
  };

  await runQuery(
    `
      INSERT INTO collaborators (
        id, registration, name, phone, unit, department, job_role, status,
        whatsapp_opt_in, whatsapp_opt_in_date, whatsapp_opt_in_version, whatsapp_opt_out_date, admitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      record.id,
      record.registration,
      record.name,
      record.phone,
      record.unit,
      record.department,
      record.role,
      record.status,
      record.whatsappOptIn,
      record.whatsappOptInDate,
      record.whatsappOptInVersion,
      record.whatsappOptOutDate,
      record.admittedAt,
    ],
  );

  return record;
}

export async function deleteCollaborator(id: string): Promise<"deleted" | "not_found" | "has_tickets" | "not_terminated"> {
  const { rows } = await runQuery<{ status: CollaboratorStatus; has_tickets: boolean }>(
    `
      SELECT c.status, EXISTS (SELECT 1 FROM tickets WHERE collaborator_id = c.id) AS has_tickets
      FROM collaborators c
      WHERE c.id = $1
    `,
    [id],
  );
  const target = rows[0];

  if (!target) return "not_found";
  if (target.status !== "DESLIGADO") return "not_terminated";
  if (target.has_tickets) return "has_tickets";

  await runQuery(`DELETE FROM collaborators WHERE id = $1`, [id]);
  return "deleted";
}

export async function updateCollaboratorName(id: string, name: string): Promise<Collaborator | undefined> {
  const { rows } = await runQuery<CollaboratorRow>(
    `UPDATE collaborators SET name = $2 WHERE id = $1 RETURNING *`,
    [id, name.trim()],
  );

  return rows[0] ? mapCollaboratorRow(rows[0]) : undefined;
}

export async function findCollaboratorByPhone(phone: string): Promise<Collaborator | undefined> {
  const normalized = normalizePhone(phone);
  const nationalNumber = normalized.startsWith("55") ? normalized.slice(2) : normalized;
  const internationalNumber = normalized.startsWith("55") ? normalized : `55${normalized}`;
  const { rows } = await runQuery<CollaboratorRow>(
    `SELECT * FROM collaborators WHERE phone IN ($1, $2, $3) ORDER BY CASE WHEN phone = $1 THEN 0 ELSE 1 END LIMIT 1`,
    [normalized, nationalNumber, internationalNumber],
  );
  return rows[0] ? mapCollaboratorRow(rows[0]) : undefined;
}

export async function listTickets(): Promise<Ticket[]> {
  const { rows } = await runQuery<TicketRow>(`SELECT * FROM tickets ORDER BY created_at DESC`);
  return rows.map(mapTicketRow);
}

export async function listTicketAttachments(ticketIds: string[], baseUrl: string): Promise<Record<string, TicketAttachment[]>> {
  if (ticketIds.length === 0) {
    return {};
  }

  const { rows } = await runQuery<TicketAttachmentRow>(
    `SELECT * FROM ticket_attachments WHERE ticket_id = ANY($1::uuid[]) ORDER BY uploaded_at DESC`,
    [ticketIds],
  );

  return rows.reduce<Record<string, TicketAttachment[]>>((accumulator, row) => {
    const mapped = mapTicketAttachmentRow(row, baseUrl);
    if (!accumulator[row.ticket_id]) {
      accumulator[row.ticket_id] = [];
    }
    accumulator[row.ticket_id].push(mapped);
    return accumulator;
  }, {});
}

export async function createTicket(input: {
  collaborator: Collaborator;
  collaboratorId: string;
  category: TicketCategory;
  priority: TicketPriority;
  message: string;
  assignedTo?: string | null;
}): Promise<Ticket> {
  const { rows: countRows } = await runQuery<{ total: string }>(`SELECT COUNT(*)::text AS total FROM tickets`);
  const timestamp = new Date();
  const sequence = Number(countRows[0]?.total || "0") + 1;
  const serviceWindow: ServiceWindow = isBusinessHours(timestamp) ? "dentro_do_horario" : "fora_do_horario";
  const status: TicketStatus = serviceWindow === "dentro_do_horario" ? "novo" : "aguardando_colaborador";
  const slaHours = computeSlaHours(input.category, input.priority);
  const dueAt = computeDueAt(timestamp, slaHours);
  const ticket: Ticket = {
    id: randomUUID(),
    protocol: `RH-${timestamp.toISOString().slice(0, 10).replace(/-/g, "")}-${String(sequence).padStart(5, "0")}`,
    collaboratorId: input.collaboratorId,
    category: input.category,
    priority: input.priority,
    status,
    channel: "whatsapp",
    serviceWindow,
    routeTarget: buildRouteTarget(input.collaborator, input.category),
    routeReason: buildRouteReason(input.collaborator, input.category),
    slaHours,
    dueAt,
    slaStatus: computeSlaStatus(dueAt, status, timestamp),
    message: input.message.trim(),
    createdAt: timestamp.toISOString(),
    assignedTo: input.assignedTo ?? null,
    lastUpdateAt: timestamp.toISOString(),
    attachments: [],
  };

  await runQuery(
    `
      INSERT INTO tickets (
        id, protocol, collaborator_id, category, priority, status, channel,
        service_window, route_target, route_reason, sla_hours, due_at, sla_status,
        message, created_at, assigned_to, last_update_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `,
    [
      ticket.id,
      ticket.protocol,
      ticket.collaboratorId,
      ticket.category,
      ticket.priority,
      ticket.status,
      ticket.channel,
      ticket.serviceWindow,
      ticket.routeTarget,
      ticket.routeReason,
      ticket.slaHours,
      ticket.dueAt,
      ticket.slaStatus,
      ticket.message,
      ticket.createdAt,
      ticket.assignedTo,
      ticket.lastUpdateAt,
    ],
  );

  return ticket;
}

export async function createAutomationEvent(input: {
  ticketId: string;
  eventType: AutomationEventType;
  description: string;
  triggeredBy: string;
}): Promise<AutomationEvent> {
  const { rows } = await runQuery<AutomationEventRow>(
    `
      INSERT INTO automation_events (id, ticket_id, event_type, description, triggered_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [randomUUID(), input.ticketId, input.eventType, input.description, input.triggeredBy],
  );

  return mapAutomationEventRow(rows[0]);
}

export async function listAutomationEvents(limit = 50): Promise<AutomationEvent[]> {
  const { rows } = await runQuery<AutomationEventRow>(
    `SELECT * FROM automation_events ORDER BY created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return rows.map(mapAutomationEventRow);
}

export async function createTicketFromWebhookMessage(input: {
  phone: string;
  message: string;
}): Promise<{ ticket: Ticket; collaborator: Collaborator; classification: { category: TicketCategory; priority: TicketPriority } }> {
  const collaborator = await findCollaboratorByPhone(input.phone);
  if (!collaborator || collaborator.status !== "ATIVO") {
    throw new Error("Canal exclusivo para colaboradores ativos cadastrados.");
  }

  if (!collaborator.whatsappOptIn) {
    throw new Error("Colaborador sem autorização para atendimento via WhatsApp corporativo.");
  }

  const classification = inferTicketCategoryAndPriority(input.message);
  const ticket = await createTicket({
    collaborator,
    collaboratorId: collaborator.id,
    category: classification.category,
    priority: classification.priority,
    message: input.message,
  });

  await createAutomationEvent({
    ticketId: ticket.id,
    eventType: "ticket_created_auto_reply",
    description: `Mensagem recebida e classificada automaticamente como ${classification.category}. Resposta de confirmação enviada para o colaborador.`,
    triggeredBy: "bot-whatsapp",
  });

  return { ticket, collaborator, classification };
}

export async function updateTicket(id: string, updates: Partial<Pick<Ticket, "status" | "assignedTo">>): Promise<Ticket | undefined> {
  const { rows: existingRows } = await runQuery<TicketRow>(`SELECT * FROM tickets WHERE id = $1 LIMIT 1`, [id]);
  const existing = existingRows[0];
  if (!existing) {
    return undefined;
  }

  const nextStatus = updates.status ?? existing.status;
  const nextAssignedTo = Object.hasOwn(updates, "assignedTo") ? updates.assignedTo ?? null : existing.assigned_to;
  const timestamp = new Date().toISOString();
  const nextSlaStatus = computeSlaStatus(existing.due_at.toISOString(), nextStatus);

  const { rows } = await runQuery<TicketRow>(
    `
      UPDATE tickets
      SET status = $2, assigned_to = $3, sla_status = $4, last_update_at = $5
      WHERE id = $1
      RETURNING *
    `,
    [id, nextStatus, nextAssignedTo, nextSlaStatus, timestamp],
  );

  return rows[0] ? mapTicketRow(rows[0]) : undefined;
}

export async function getTicketById(id: string): Promise<Ticket | undefined> {
  const { rows } = await runQuery<TicketRow>(`SELECT * FROM tickets WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? mapTicketRow(rows[0]) : undefined;
}

export async function createTicketAttachment(input: {
  ticketId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  attachmentType: TicketAttachmentType;
  uploadedBy: string;
}, baseUrl: string): Promise<TicketAttachment> {
  const { rows } = await runQuery<TicketAttachmentRow>(
    `
      INSERT INTO ticket_attachments (
        id, ticket_id, file_name, original_name, mime_type, size_bytes, attachment_type, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      randomUUID(),
      input.ticketId,
      input.fileName,
      input.originalName,
      input.mimeType,
      input.sizeBytes,
      input.attachmentType,
      input.uploadedBy,
    ],
  );

  return mapTicketAttachmentRow(rows[0], baseUrl);
}

export async function runSlaAutomationSweep(triggeredBy: string): Promise<{ scanned: number; updated: number; warnings: number; breaches: number }> {
  const tickets = await listTickets();
  let updated = 0;
  let warnings = 0;
  let breaches = 0;

  for (const ticket of tickets) {
    const nextSlaStatus = computeSlaStatus(ticket.dueAt, ticket.status);
    if (ticket.status === "resolvido" || nextSlaStatus === ticket.slaStatus) {
      continue;
    }

    await runQuery(
      `UPDATE tickets SET sla_status = $2, last_update_at = $3 WHERE id = $1`,
      [ticket.id, nextSlaStatus, new Date().toISOString()],
    );
    updated += 1;

    if (nextSlaStatus === "vencendo") {
      warnings += 1;
      await createAutomationEvent({
        ticketId: ticket.id,
        eventType: "sla_warning",
        description: `Ticket ${ticket.protocol} entrou na janela de alerta de SLA.`,
        triggeredBy,
      });
    }

    if (nextSlaStatus === "violado") {
      breaches += 1;
      await createAutomationEvent({
        ticketId: ticket.id,
        eventType: "sla_breached",
        description: `Ticket ${ticket.protocol} violou o SLA e foi marcado como crítico.`,
        triggeredBy,
      });

      await createAutomationEvent({
        ticketId: ticket.id,
        eventType: "manager_escalation",
        description: `Escalonamento automático para gestão por violação de SLA no protocolo ${ticket.protocol}.`,
        triggeredBy,
      });
    }
  }

  return {
    scanned: tickets.length,
    updated,
    warnings,
    breaches,
  };
}

export async function listManagerCriticalQueue(limit = 30): Promise<Ticket[]> {
  const { rows } = await runQuery<TicketRow>(
    `
      SELECT * FROM tickets
      WHERE status <> 'resolvido' AND (sla_status = 'violado' OR priority = 'alta')
      ORDER BY
        CASE WHEN sla_status = 'violado' THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 200))],
  );

  return rows.map(mapTicketRow);
}

export async function buildSmartInsights(): Promise<{
  generatedAt: string;
  insights: SmartInsight[];
  topCategories: Array<{ category: TicketCategory; total: number }>;
  busiestUnits: Array<{ unit: string; total: number }>;
}> {
  const [topCategoriesResult, busiestUnitsResult, slaResult, leadTimeResult] = await Promise.all([
    runQuery<{ category: TicketCategory; total: string }>(
      `SELECT category, COUNT(*)::text AS total FROM tickets GROUP BY category ORDER BY COUNT(*) DESC LIMIT 5`,
    ),
    runQuery<{ unit: string; total: string }>(
      `
        SELECT c.unit, COUNT(*)::text AS total
        FROM tickets t
        INNER JOIN collaborators c ON c.id = t.collaborator_id
        GROUP BY c.unit
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `,
    ),
    runQuery<{ warning_count: string; breach_count: string }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE sla_status = 'vencendo')::text AS warning_count,
          COUNT(*) FILTER (WHERE sla_status = 'violado')::text AS breach_count
        FROM tickets
        WHERE status <> 'resolvido'
      `,
    ),
    runQuery<{ avg_hours: string | null }>(
      `
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (last_update_at - created_at)) / 3600)::numeric, 2)::text AS avg_hours
        FROM tickets
        WHERE status = 'resolvido'
      `,
    ),
  ]);

  const topCategories = topCategoriesResult.rows.map((row) => ({
    category: row.category,
    total: Number(row.total),
  }));

  const busiestUnits = busiestUnitsResult.rows.map((row) => ({
    unit: row.unit,
    total: Number(row.total),
  }));

  const warningCount = Number(slaResult.rows[0]?.warning_count || 0);
  const breachCount = Number(slaResult.rows[0]?.breach_count || 0);
  const avgResolutionHours = Number(leadTimeResult.rows[0]?.avg_hours || 0);

  const insights: SmartInsight[] = [
    {
      id: "insight-sla-risk",
      title: "Risco de SLA na fila ativa",
      detail: `${warningCount + breachCount} ticket(s) exigem atuação imediata para proteger experiência do colaborador.`,
      severity: breachCount > 0 ? "high" : warningCount > 0 ? "medium" : "low",
      metricValue: warningCount + breachCount,
      action: "Priorizar tickets críticos e revisar capacidade da fila nas próximas 24h.",
    },
    {
      id: "insight-resolution-time",
      title: "Tempo médio de resolução",
      detail: avgResolutionHours > 0
        ? `${avgResolutionHours}h entre abertura e fechamento dos tickets resolvidos.`
        : "Ainda não há tickets resolvidos para calcular o tempo médio.",
      severity: avgResolutionHours > 24 ? "high" : avgResolutionHours > 12 ? "medium" : "low",
      metricValue: avgResolutionHours,
      action: "Padronizar playbooks por categoria para reduzir retrabalho no atendimento.",
    },
    {
      id: "insight-category-load",
      title: "Categoria mais recorrente",
      detail: topCategories[0]
        ? `${topCategories[0].category} representa ${topCategories[0].total} ocorrência(s) no período analisado.`
        : "Sem volume suficiente para inferir categoria dominante.",
      severity: topCategories[0] && topCategories[0].total >= 5 ? "medium" : "low",
      metricValue: topCategories[0]?.total ?? 0,
      action: "Criar resposta guiada e macro específica para a categoria dominante.",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    insights,
    topCategories,
    busiestUnits,
  };
}

export async function buildDashboard() {
  const { rows } = await runQuery<{
    collaborators_total: string;
    collaborators_active: string;
    collaborators_whatsapp_enabled: string;
    collaborators_awaiting_opt_in: string;
    tickets_total: string;
    tickets_new: string;
    tickets_in_progress: string;
    tickets_waiting_employee: string;
    tickets_solved: string;
    tickets_outside_business_hours: string;
    tickets_sla_warning: string;
    tickets_sla_breached: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM collaborators) AS collaborators_total,
      (SELECT COUNT(*)::text FROM collaborators WHERE status = 'ATIVO') AS collaborators_active,
      (SELECT COUNT(*)::text FROM collaborators WHERE status = 'ATIVO' AND whatsapp_opt_in = TRUE) AS collaborators_whatsapp_enabled,
      (SELECT COUNT(*)::text FROM collaborators WHERE status = 'ATIVO' AND whatsapp_opt_in = FALSE) AS collaborators_awaiting_opt_in,
      (SELECT COUNT(*)::text FROM tickets) AS tickets_total,
      (SELECT COUNT(*)::text FROM tickets WHERE status = 'novo') AS tickets_new,
      (SELECT COUNT(*)::text FROM tickets WHERE status = 'em_atendimento') AS tickets_in_progress,
      (SELECT COUNT(*)::text FROM tickets WHERE status = 'aguardando_colaborador') AS tickets_waiting_employee,
      (SELECT COUNT(*)::text FROM tickets WHERE status = 'resolvido') AS tickets_solved,
        (SELECT COUNT(*)::text FROM tickets WHERE service_window = 'fora_do_horario') AS tickets_outside_business_hours,
        (SELECT COUNT(*)::text FROM tickets WHERE sla_status = 'vencendo') AS tickets_sla_warning,
        (SELECT COUNT(*)::text FROM tickets WHERE sla_status = 'violado') AS tickets_sla_breached
  `);

  const metrics = rows[0];
  return {
    collaborators: {
      total: Number(metrics.collaborators_total),
      active: Number(metrics.collaborators_active),
      whatsappEnabled: Number(metrics.collaborators_whatsapp_enabled),
      awaitingOptIn: Number(metrics.collaborators_awaiting_opt_in),
    },
    tickets: {
      total: Number(metrics.tickets_total),
      new: Number(metrics.tickets_new),
      inProgress: Number(metrics.tickets_in_progress),
      waitingEmployee: Number(metrics.tickets_waiting_employee),
      solved: Number(metrics.tickets_solved),
      outsideBusinessHours: Number(metrics.tickets_outside_business_hours),
      slaWarning: Number(metrics.tickets_sla_warning),
      slaBreached: Number(metrics.tickets_sla_breached),
    },
  };
}

export function roleCanManageCollaborators(role: AuthRole): boolean {
  return role === "rh";
}

export function roleCanManageTickets(role: AuthRole): boolean {
  return role === "rh" || role === "manager";
}
