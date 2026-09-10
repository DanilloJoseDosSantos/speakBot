export type CollaboratorStatus = "ATIVO" | "AFASTADO" | "DESLIGADO";
export type AuthRole = "rh" | "manager";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: AuthRole;
  passwordHash: string;
  active: boolean;
}

export type TicketCategory =
  | "geral"
  | "falta_atraso"
  | "atestado"
  | "ferias"
  | "beneficios"
  | "folha"
  | "duvida_trabalhista";

export type TicketPriority = "baixa" | "media" | "alta";
export type TicketStatus = "novo" | "em_atendimento" | "aguardando_colaborador" | "resolvido";
export type ServiceWindow = "dentro_do_horario" | "fora_do_horario";
export type TicketSlaStatus = "no_prazo" | "vencendo" | "violado";
export type TicketAttachmentType = "atestado" | "documento" | "imagem" | "pdf";
export type AutomationEventType =
  | "ticket_created_auto_reply"
  | "sla_warning"
  | "sla_breached"
  | "manager_escalation"
  | "ticket_resolved_followup";
export type InsightSeverity = "low" | "medium" | "high";
export type AuditAction = "login" | "create" | "update" | "delete" | "export" | "anonymize" | "system";
export type PrivacyRequestType = "access" | "correction" | "deletion" | "consent_revocation";
export type PrivacyRequestStatus = "open" | "completed" | "rejected";
export type LgpdConsentStatus = "pending" | "accepted" | "refused";

export interface Collaborator {
  id: string;
  registration: string;
  cpf: string | null;
  name: string;
  address: string;
  phone: string;
  unit: string;
  department: string;
  role: string;
  status: CollaboratorStatus;
  whatsappOptIn: boolean;
  whatsappOptInDate: string | null;
  whatsappOptInVersion: string | null;
  whatsappOptOutDate: string | null;
  lgpdConsentStatus: LgpdConsentStatus;
  lgpdConsentVersion: string | null;
  lgpdConsentAt: string | null;
  lgpdConsentRefusedAt: string | null;
  admittedAt: string;
}

export interface ConsentRecord {
  id: string;
  collaboratorId: string;
  registration: string;
  cpf: string | null;
  collaboratorName: string;
  address: string;
  phone: string;
  termVersion: string;
  termTitle: string;
  termText: string;
  decision: Exclude<LgpdConsentStatus, "pending">;
  recordedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface Ticket {
  id: string;
  protocol: string;
  collaboratorId: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  channel: "whatsapp";
  serviceWindow: ServiceWindow;
  routeTarget: string;
  routeReason: string;
  slaHours: number;
  dueAt: string;
  slaStatus: TicketSlaStatus;
  message: string;
  createdAt: string;
  assignedTo: string | null;
  lastUpdateAt: string;
  attachments: TicketAttachment[];
}

export interface TicketAttachment {
  id: string;
  ticketId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  attachmentType: TicketAttachmentType;
  uploadedBy: string;
  uploadedAt: string;
  publicUrl: string;
}

export interface AutomationEvent {
  id: string;
  ticketId: string;
  eventType: AutomationEventType;
  description: string;
  triggeredBy: string;
  createdAt: string;
}

export interface SmartInsight {
  id: string;
  title: string;
  detail: string;
  severity: InsightSeverity;
  metricValue: number;
  action: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  actorName: string;
  actorRole: AuthRole | "system";
  action: AuditAction;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface PrivacyRequest {
  id: string;
  collaboratorId: string;
  requestType: PrivacyRequestType;
  status: PrivacyRequestStatus;
  requestedBy: string;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DatabaseShape {
  users: AuthUser[];
  collaborators: Collaborator[];
  tickets: Ticket[];
}
