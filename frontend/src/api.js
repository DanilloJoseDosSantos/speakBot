const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function normalizeErrorMessage(detail, fallback = "Falha na requisição.") {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => normalizeErrorMessage(item, fallback)).join("; ");
  if (typeof detail === "object") {
    const readable = Object.entries(detail)
      .map(([key, value]) => {
        if (value === null || value === undefined) return `${key}: null`;
        if (typeof value === "object") return `${key}: ${normalizeErrorMessage(value, fallback)}`;
        return `${key}: ${String(value)}`;
      })
      .join("; ");
    return readable || fallback;
  }
  return String(detail) || fallback;
}

async function request(path, options = {}) {
  const token = window.localStorage.getItem("rh-central-token");
  const { headers: extraHeaders = {}, ...restOptions } = options;

  const response = await fetch(`${API_URL}${path}`, {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = normalizeErrorMessage(data?.detail, "Falha na requisição.");
    throw new Error(message);
  }
  return data;
}

export function login(payload) {
  return request("/login", {
    method: "POST",
    headers: {},
    body: JSON.stringify(payload),
  });
}

export function getCurrentUser() {
  return request("/me");
}

export function getDashboard() {
  return request("/dashboard");
}

export function getCollaborators() {
  return request("/collaborators");
}

export function createCollaborator(payload) {
  return request("/collaborators", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteCollaborator(collaboratorId) {
  return request(`/collaborators/${collaboratorId}`, {
    method: "DELETE",
  });
}

export function updateCollaboratorName(collaboratorId, name) {
  return request(`/collaborators/${collaboratorId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function getTickets() {
  return request("/tickets");
}

export function getRoutingRules() {
  return request("/routing-rules");
}

export function createTicketIntake(payload) {
  return request("/tickets/intake", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createWebhookIntake(payload) {
  return request("/whatsapp/webhook", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAutomationEvents() {
  return request("/automation/events");
}

export function runSlaSweep() {
  return request("/automation/sla-sweep", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getManagerQueue() {
  return request("/manager/queue");
}

export function getInsights() {
  return request("/insights");
}

export function updateTicket(ticketId, payload) {
  return request(`/tickets/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function uploadTicketAttachment(ticketId, file, attachmentType) {
  const token = window.localStorage.getItem("rh-central-token");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("attachmentType", attachmentType);

  const response = await fetch(`${API_URL}/tickets/${ticketId}/attachments`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = normalizeErrorMessage(data?.detail, "Falha no upload do anexo.");
    throw new Error(message);
  }
  return data;
}
