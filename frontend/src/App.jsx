import { useEffect, useRef, useState } from 'react'

import {
  createCollaborator,
  createTicketIntake,
  createWebhookIntake,
  getAutomationEvents,
  getCollaborators,
  getCurrentUser,
  getDashboard,
  getInsights,
  getManagerQueue,
  getRoutingRules,
  getTickets,
  login,
  runSlaSweep,
  updateTicket,
  uploadTicketAttachment,
} from './api'

const SESSION_KEY = 'rh-central-token'
const THEME_KEY = 'rh-central-theme'

const initialCollaboratorForm = {
  registration: '',
  name: '',
  phone: '',
  unit: '',
  department: '',
  role: '',
  status: 'ATIVO',
  whatsappOptIn: true,
  whatsappOptInDate: '2026-09-08T08:00:00.000Z',
  whatsappOptInVersion: 'v1',
  whatsappOptOutDate: null,
  admittedAt: '2026-09-08',
}

const initialIntakeForm = {
  phone: '',
  category: 'geral',
  priority: 'media',
  message: '',
}

const initialWebhookForm = {
  phone: '',
  message: '',
}

function formatPhone(value) {
  const hasPlus = value.trim().startsWith('+')
  const digits = value.replace(/\D/g, '').slice(0, 13)
  if (hasPlus && digits.length === 0) return '+'
  if (digits.startsWith('55')) {
    const national = digits.slice(2)
    if (national.length <= 2) return `+55${national ? ` (${national}` : ''}`
    if (national.length <= 7) return `+55 (${national.slice(0, 2)}) ${national.slice(2)}`
    return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`
  }
  if (digits.length <= 2) return digits
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

function ticketStatusLabel(value) {
  return {
    novo: 'Novo',
    em_atendimento: 'Em atendimento',
    aguardando_colaborador: 'Aguardando colaborador',
    resolvido: 'Resolvido',
  }[value] || value
}

function categoryLabel(value) {
  return {
    geral: 'Geral',
    falta_atraso: 'Falta ou atraso',
    atestado: 'Atestado',
    ferias: 'Ferias',
    beneficios: 'Beneficios',
    folha: 'Folha',
    duvida_trabalhista: 'Duvida trabalhista',
  }[value] || value
}

function slaLabel(value) {
  return {
    no_prazo: 'No prazo',
    vencendo: 'Vencendo',
    violado: 'Violado',
  }[value] || value
}

function eventLabel(value) {
  return {
    ticket_created_auto_reply: 'Confirmação automática',
    sla_warning: 'Alerta de SLA',
    sla_breached: 'SLA violado',
    manager_escalation: 'Escalonamento gestor',
    ticket_resolved_followup: 'Follow-up pós-resolução',
  }[value] || value
}

function severityLabel(value) {
  return {
    low: 'Baixa',
    medium: 'Média',
    high: 'Alta',
  }[value] || value
}

function getErrorMessage(error) {
  if (!error) return 'Falha na operação.'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error?.message === 'string') return error.message
  if (typeof error === 'object') {
    return Object.entries(error)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join('; ')
  }
  return 'Falha na operação.'
}

function App() {
  const [theme, setTheme] = useState(() => window.localStorage.getItem(THEME_KEY) || 'light')
  const [splitRatio, setSplitRatio] = useState(() => Number(window.localStorage.getItem('rh-central-split-ratio')) || 42)
  const [isResizing, setIsResizing] = useState(false)
  const contentGridRef = useRef(null)
  const [user, setUser] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [collaborators, setCollaborators] = useState([])
  const [tickets, setTickets] = useState([])
  const [routingRules, setRoutingRules] = useState([])
  const [automationEvents, setAutomationEvents] = useState([])
  const [managerQueue, setManagerQueue] = useState([])
  const [insightsPayload, setInsightsPayload] = useState(null)
  const [collaboratorForm, setCollaboratorForm] = useState(initialCollaboratorForm)
  const [intakeForm, setIntakeForm] = useState(initialIntakeForm)
  const [webhookForm, setWebhookForm] = useState(initialWebhookForm)
  const [ticketAssignments, setTicketAssignments] = useState({})
  const [ticketAttachmentForms, setTicketAttachmentForms] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loginForm, setLoginForm] = useState({ username: 'rh', password: 'rh123' })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('rh-central-split-ratio', String(splitRatio))
  }, [splitRatio])

  useEffect(() => {
    if (!isResizing) return undefined

    const handlePointerMove = (event) => {
      const grid = contentGridRef.current
      if (!grid) return

      const bounds = grid.getBoundingClientRect()
      const nextRatio = ((event.clientX - bounds.left) / bounds.width) * 100
      setSplitRatio(Math.min(65, Math.max(30, nextRatio)))
    }

    const stopResizing = () => setIsResizing(false)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [isResizing])

  const toggleTheme = () => {
    setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')
  }

  const handleResizeStart = (event) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsResizing(true)
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [dashboardData, collaboratorsData, ticketsData, routingRulesData, eventsData, queueData, insightsData] = await Promise.all([
        getDashboard(),
        getCollaborators(),
        getTickets(),
        getRoutingRules(),
        getAutomationEvents(),
        getManagerQueue(),
        getInsights(),
      ])
      setDashboard(dashboardData)
      setCollaborators(collaboratorsData)
      setTickets(ticketsData)
      setRoutingRules(routingRulesData)
      setAutomationEvents(eventsData)
      setManagerQueue(queueData)
      setInsightsPayload(insightsData)
      setTicketAssignments(Object.fromEntries(ticketsData.map((ticket) => [ticket.id, ticket.assignedTo || ''])))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const bootstrap = async () => {
      const token = window.localStorage.getItem(SESSION_KEY)
      if (!token) {
        setLoading(false)
        return
      }

      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        await loadData()
      } catch {
        window.localStorage.removeItem(SESSION_KEY)
        setUser(null)
        setLoading(false)
      }
    }

    bootstrap()
  }, [])

  useEffect(() => {
    if (!user) return undefined

    const refreshTimer = window.setInterval(() => {
      loadData()
    }, 15000)

    return () => window.clearInterval(refreshTimer)
  }, [user])

  const handleLoginSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      setSuccess('')
      const result = await login(loginForm)
      window.localStorage.setItem(SESSION_KEY, result.token)
      setUser(result.user)
      setSuccess('Acesso liberado.')
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleLogout = () => {
    window.localStorage.removeItem(SESSION_KEY)
    setUser(null)
    setDashboard(null)
    setCollaborators([])
    setTickets([])
    setAutomationEvents([])
    setManagerQueue([])
    setInsightsPayload(null)
    setError('')
    setSuccess('')
  }

  const handleCollaboratorSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      setSuccess('')
      const payload = {
        ...collaboratorForm,
        phone: collaboratorForm.phone,
        whatsappOptInDate: collaboratorForm.whatsappOptIn ? new Date().toISOString() : null,
        whatsappOptInVersion: collaboratorForm.whatsappOptIn ? collaboratorForm.whatsappOptInVersion : null,
        whatsappOptOutDate: collaboratorForm.whatsappOptIn ? null : new Date().toISOString(),
      }
      await createCollaborator(payload)
      setCollaboratorForm(initialCollaboratorForm)
      setSuccess('Colaborador cadastrado na Central RH.')
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleIntakeSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      setSuccess('')
      const result = await createTicketIntake(intakeForm)
      setIntakeForm(initialIntakeForm)
      setSuccess(`Protocolo ${result.ticket.protocol} registrado com sucesso.`)
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleStatusChange = async (ticketId, status) => {
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      await updateTicket(ticketId, { status })
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleAssignTicket = async (ticketId) => {
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      const assignedTo = ticketAssignments[ticketId]?.trim() || null
      await updateTicket(ticketId, {
        assignedTo,
        status: assignedTo ? 'em_atendimento' : undefined,
      })
      setSuccess(assignedTo ? 'Responsável atualizado.' : 'Responsável removido.')
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleTicketAttachmentUpload = async (ticketId) => {
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      setSuccess('')
      const currentForm = ticketAttachmentForms[ticketId]
      if (!currentForm?.file) {
        setError('Selecione um arquivo antes de enviar.')
        return
      }

      await uploadTicketAttachment(ticketId, currentForm.file, currentForm.attachmentType || 'documento')
      setSuccess('Anexo enviado com sucesso.')
      setTicketAttachmentForms({
        ...ticketAttachmentForms,
        [ticketId]: { attachmentType: 'documento', file: null },
      })
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleWebhookSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      setSuccess('')
      const result = await createWebhookIntake(webhookForm)
      setWebhookForm(initialWebhookForm)
      setSuccess(`Webhook processado: ${result.ticket.protocol} (${categoryLabel(result.classification.category)}).`)
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSlaSweep = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      setSuccess('')
      const result = await runSlaSweep()
      setSuccess(`Varredura concluída: ${result.updated} ticket(s) atualizados, ${result.breaches} violação(ões).`)
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) {
    return (
      <div className="shell login-shell">
        <div className="login-card">
          <div className="login-heading-row">
            <p className="eyebrow">Rede Patao • RH 2026</p>
            <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`}>
              {theme === 'dark' ? '☀ Claro' : '☾ Escuro'}
            </button>
          </div>
          <h1>Acesso ao painel interno</h1>
          <p className="subtitle">Perfis disponíveis nesta fase: RH e gestor. O canal do colaborador continua sendo processado pelo intake da Central RH.</p>
          {error ? <div className="feedback error">{error}</div> : null}
          <form className="form-grid" onSubmit={handleLoginSubmit}>
            <input value={loginForm.username} onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })} placeholder="Usuário" />
            <input type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="Senha" />
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Entrando...' : 'Entrar'}</button>
          </form>
          <div className="hint-box">
            <strong>Credenciais iniciais</strong>
            <p>RH: rh / rh123</p>
            <p>Gestor: gestor / gestor123</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="hero-panel">
        <div>
          <div className="hero-heading-row">
            <p className="eyebrow">Rede Patao • RH 2026</p>
            <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`}>
              {theme === 'dark' ? '☀ Claro' : '☾ Escuro'}
            </button>
          </div>
          <h1>Central de atendimento interno via WhatsApp corporativo</h1>
          <p className="subtitle">
            MVP do zero para validar colaborador ativo, registrar protocolos e operar a fila do RH sem usar WhatsApp pessoal.
          </p>
        </div>
        <div className="hero-card">
          <span className="hero-kicker">Canal controlado</span>
          <small className="user-badge">{user.name} • {user.role === 'rh' ? 'RH' : 'Gestor'}</small>
          <strong>Somente colaboradores ativos com opt-in entram na fila.</strong>
          <p>O foco desta fase e rastreabilidade: protocolo, categoria, prioridade, horario e acompanhamento pelo painel.</p>
          <button type="button" className="ghost-button light" onClick={handleLogout}>Sair</button>
        </div>
      </header>

      {error ? <div className="feedback error">{error}</div> : null}
      {success ? <div className="feedback success">{success}</div> : null}

      <section className="metrics-grid">
        <article className="metric accent">
          <span>Colaboradores ativos</span>
          <strong>{dashboard?.collaborators.active ?? '-'}</strong>
        </article>
        <article className="metric warm">
          <span>WhatsApp habilitado</span>
          <strong>{dashboard?.collaborators.whatsappEnabled ?? '-'}</strong>
        </article>
        <article className="metric cool">
          <span>Tickets novos</span>
          <strong>{dashboard?.tickets.new ?? '-'}</strong>
        </article>
        <article className="metric dark">
          <span>SLA em risco</span>
          <strong>{(dashboard?.tickets.slaWarning ?? 0) + (dashboard?.tickets.slaBreached ?? 0)}</strong>
        </article>
        <article className="metric slate">
          <span>Fila crítica gestor</span>
          <strong>{managerQueue.length}</strong>
        </article>
      </section>

      <main
        ref={contentGridRef}
        className={`content-grid ${isResizing ? 'is-resizing' : ''}`}
        style={{ '--split-ratio': `${splitRatio}%` }}
      >
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Cadastro</p>
              <h2>Colaboradores autorizados</h2>
            </div>
            <button type="button" className="ghost-button" onClick={loadData}>Atualizar</button>
          </div>

          {user.role === 'rh' ? <form className="form-grid" onSubmit={handleCollaboratorSubmit}>
            <input value={collaboratorForm.name} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, name: event.target.value })} placeholder="Nome completo" />
            <input value={collaboratorForm.registration} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, registration: event.target.value })} placeholder="Matricula" />
            <input value={collaboratorForm.phone} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, phone: formatPhone(event.target.value) })} placeholder="Telefone / WhatsApp" />
            <input value={collaboratorForm.role} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, role: event.target.value })} placeholder="Cargo" />
            <input value={collaboratorForm.unit} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, unit: event.target.value })} placeholder="Unidade" />
            <input value={collaboratorForm.department} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, department: event.target.value })} placeholder="Setor" />
            <select value={collaboratorForm.status} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, status: event.target.value })}>
              <option value="ATIVO">Ativo</option>
              <option value="AFASTADO">Afastado</option>
              <option value="DESLIGADO">Desligado</option>
            </select>
            <input type="date" value={collaboratorForm.admittedAt} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, admittedAt: event.target.value })} />
            <input value={collaboratorForm.whatsappOptInVersion} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, whatsappOptInVersion: event.target.value })} placeholder="Versao do termo de opt-in" />
            <label className="checkbox-field">
              <input type="checkbox" checked={collaboratorForm.whatsappOptIn} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, whatsappOptIn: event.target.checked })} />
              WhatsApp corporativo autorizado
            </label>
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar colaborador'}</button>
          </form> : <div className="read-only-box">Perfil gestor em modo de leitura para cadastro de colaboradores.</div>}

          <div className="list-block">
            {loading ? <p>Carregando base de colaboradores...</p> : collaborators.map((collaborator) => (
              <article key={collaborator.id} className="list-card">
                <div>
                  <h3>{collaborator.name}</h3>
                  <p>{collaborator.registration} • {collaborator.role}</p>
                </div>
                <div className="meta-stack">
                  <span>{collaborator.unit}</span>
                  <span>{collaborator.department}</span>
                  <span>{formatPhone(collaborator.phone)}</span>
                  <span>{collaborator.status}</span>
                  <span>{collaborator.whatsappOptIn ? 'opt-in ativo' : 'sem opt-in'}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div
          className="split-divider"
          role="separator"
          aria-label="Redimensionar divisão entre cadastro e canal"
          aria-valuemin="30"
          aria-valuemax="65"
          aria-valuenow={Math.round(splitRatio)}
          tabIndex="0"
          onPointerDown={handleResizeStart}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setSplitRatio((value) => Math.max(30, value - 2))
            if (event.key === 'ArrowRight') setSplitRatio((value) => Math.min(65, value + 2))
          }}
        >
          <span />
        </div>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Canal</p>
              <h2>Simular mensagem recebida</h2>
            </div>
            <span className="badge mode-badge">Teste local</span>
          </div>

          <form className="form-grid" onSubmit={handleIntakeSubmit}>
            <input value={intakeForm.phone} onChange={(event) => setIntakeForm({ ...intakeForm, phone: formatPhone(event.target.value) })} placeholder="Telefone do colaborador" />
            <select value={intakeForm.category} onChange={(event) => setIntakeForm({ ...intakeForm, category: event.target.value })}>
              <option value="geral">Geral</option>
              <option value="falta_atraso">Falta ou atraso</option>
              <option value="atestado">Atestado</option>
              <option value="ferias">Ferias</option>
              <option value="beneficios">Beneficios</option>
              <option value="folha">Folha</option>
              <option value="duvida_trabalhista">Duvida trabalhista</option>
            </select>
            <select value={intakeForm.priority} onChange={(event) => setIntakeForm({ ...intakeForm, priority: event.target.value })}>
              <option value="baixa">Prioridade baixa</option>
              <option value="media">Prioridade media</option>
              <option value="alta">Prioridade alta</option>
            </select>
            <textarea value={intakeForm.message} onChange={(event) => setIntakeForm({ ...intakeForm, message: event.target.value })} placeholder="Mensagem original recebida no WhatsApp corporativo" />
            <button className="primary-button contrast" type="submit" disabled={submitting}>{submitting ? 'Processando...' : 'Gerar protocolo'}</button>
          </form>

          <div className="tickets-header">
            <div>
              <p className="section-label">Fila</p>
              <h2>Protocolos da Central RH</h2>
            </div>
            <span className="badge">{tickets.length} registros</span>
          </div>

          <div className="routing-grid">
            {routingRules.map((rule) => (
              <article key={rule.category} className="routing-card">
                <strong>{categoryLabel(rule.category)}</strong>
                <p>{rule.queue}</p>
                <small>SLA base: {rule.defaultSlaHours}h • {rule.unitScoped ? 'por unidade' : 'central'}</small>
              </article>
            ))}
          </div>

          <div className="list-block">
            {loading ? <p>Carregando fila...</p> : tickets.map((ticket) => (
              <article key={ticket.id} className="ticket-card">
                <div className="ticket-topline">
                  <div>
                    <h3>{ticket.protocol}</h3>
                    <p>{ticket.collaborator?.name || 'Colaborador removido'} • {ticket.collaborator?.unit || 'Sem unidade'}</p>
                  </div>
                  <div className="ticket-badges">
                    <span>{categoryLabel(ticket.category)}</span>
                    <span>{ticket.priority}</span>
                    <span>{slaLabel(ticket.slaStatus)}</span>
                  </div>
                </div>
                <p className="ticket-message">{ticket.message}</p>
                <div className="route-box">
                  <strong>Roteamento</strong>
                  <p>{ticket.routeTarget}</p>
                  <small>{ticket.routeReason}</small>
                </div>
                <div className="attachments-box">
                  <strong>Anexos</strong>
                  <div className="attachments-upload-row">
                    <select value={ticketAttachmentForms[ticket.id]?.attachmentType || 'documento'} onChange={(event) => setTicketAttachmentForms({ ...ticketAttachmentForms, [ticket.id]: { ...(ticketAttachmentForms[ticket.id] || {}), attachmentType: event.target.value } })}>
                      <option value="atestado">Atestado</option>
                      <option value="documento">Documento</option>
                      <option value="imagem">Imagem</option>
                      <option value="pdf">PDF</option>
                    </select>
                    <input type="file" onChange={(event) => setTicketAttachmentForms({ ...ticketAttachmentForms, [ticket.id]: { ...(ticketAttachmentForms[ticket.id] || {}), file: event.target.files?.[0] || null, attachmentType: ticketAttachmentForms[ticket.id]?.attachmentType || 'documento' } })} />
                    <button type="button" className="ghost-button" onClick={() => handleTicketAttachmentUpload(ticket.id)} disabled={submitting}>{submitting ? 'Enviando...' : 'Enviar anexo'}</button>
                  </div>
                  <div className="attachments-list">
                    {(ticket.attachments || []).map((attachment) => (
                      <a key={attachment.id} href={attachment.publicUrl} target="_blank" rel="noreferrer" className="attachment-link">
                        <strong>{attachment.originalName}</strong>
                        <span>{attachment.attachmentType} • {attachment.uploadedBy}</span>
                      </a>
                    ))}
                    {(ticket.attachments || []).length === 0 ? <small>Nenhum anexo enviado.</small> : null}
                  </div>
                </div>
                <div className="ticket-footer">
                  <div className="ticket-meta-column">
                    <small>Abertura: {new Date(ticket.createdAt).toLocaleString('pt-BR')}</small>
                    <small>Prazo: {new Date(ticket.dueAt).toLocaleString('pt-BR')} • SLA {ticket.slaHours}h</small>
                    <small>Responsável atual: {ticket.assignedTo || 'não definido'}</small>
                  </div>
                  <div className="ticket-actions-column">
                    <input value={ticketAssignments[ticket.id] || ''} onChange={(event) => setTicketAssignments({ ...ticketAssignments, [ticket.id]: event.target.value })} placeholder="Responsável pelo atendimento" />
                    <button type="button" className="ghost-button" onClick={() => handleAssignTicket(ticket.id)} disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar responsável'}</button>
                    <select value={ticket.status} onChange={(event) => handleStatusChange(ticket.id, event.target.value)}>
                      <option value="novo">Novo</option>
                      <option value="em_atendimento">Em atendimento</option>
                      <option value="aguardando_colaborador">Aguardando colaborador</option>
                      <option value="resolvido">Resolvido</option>
                    </select>
                  </div>
                </div>
                <div className="status-row">
                  <strong className="status-label">{ticketStatusLabel(ticket.status)}</strong>
                  <strong className={`status-label sla ${ticket.slaStatus}`}>{slaLabel(ticket.slaStatus)}</strong>
                </div>
              </article>
            ))}
          </div>

          <div className="tickets-header phase-block-title">
            <div>
              <p className="section-label">Fase 2</p>
              <h2>Automação operacional</h2>
            </div>
            {user.role === 'rh' ? <button type="button" className="ghost-button" onClick={handleSlaSweep} disabled={submitting}>{submitting ? 'Executando...' : 'Executar sweep de SLA'}</button> : null}
          </div>

          <form className="form-grid" onSubmit={handleWebhookSubmit}>
            <input value={webhookForm.phone} onChange={(event) => setWebhookForm({ ...webhookForm, phone: formatPhone(event.target.value) })} placeholder="Telefone recebido no webhook" />
            <textarea value={webhookForm.message} onChange={(event) => setWebhookForm({ ...webhookForm, message: event.target.value })} placeholder="Mensagem bruta do WhatsApp Business API" />
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Processando...' : 'Processar teste de webhook'}</button>
          </form>

          <div className="phase-grid">
            <article className="phase-card">
              <h3>Eventos automáticos</h3>
              <div className="events-list">
                {automationEvents.slice(0, 8).map((event) => (
                  <div key={event.id} className="event-item">
                    <strong>{eventLabel(event.eventType)}</strong>
                    <small>{event.description}</small>
                    <small>{new Date(event.createdAt).toLocaleString('pt-BR')} • {event.triggeredBy}</small>
                  </div>
                ))}
                {automationEvents.length === 0 ? <small>Sem eventos registrados.</small> : null}
              </div>
            </article>

            <article className="phase-card">
              <h3>Fila crítica da gestão</h3>
              <div className="events-list">
                {managerQueue.slice(0, 8).map((ticket) => (
                  <div key={ticket.id} className="event-item">
                    <strong>{ticket.protocol} • {categoryLabel(ticket.category)}</strong>
                    <small>{ticket.collaborator?.name || 'Sem colaborador'} • SLA {slaLabel(ticket.slaStatus)}</small>
                    <small>{ticket.assignedTo || 'Sem responsável'} • {ticket.routeTarget}</small>
                  </div>
                ))}
                {managerQueue.length === 0 ? <small>Nenhum ticket crítico no momento.</small> : null}
              </div>
            </article>
          </div>

          <div className="tickets-header phase-block-title">
            <div>
              <p className="section-label">Fase 3</p>
              <h2>RH inteligente</h2>
            </div>
          </div>

          <div className="insights-grid">
            {(insightsPayload?.insights || []).map((insight) => (
              <article key={insight.id} className={`insight-card ${insight.severity}`}>
                <span className="insight-severity">Prioridade {severityLabel(insight.severity)}</span>
                <h3>{insight.title}</h3>
                <p>{insight.detail}</p>
                <small>{insight.action}</small>
              </article>
            ))}
          </div>

          <div className="phase-grid">
            <article className="phase-card">
              <h3>Top categorias</h3>
              <div className="events-list">
                {(insightsPayload?.topCategories || []).map((item) => (
                  <div key={item.category} className="event-item compact">
                    <strong>{categoryLabel(item.category)}</strong>
                    <small>{item.total} ticket(s)</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="phase-card">
              <h3>Unidades com maior demanda</h3>
              <div className="events-list">
                {(insightsPayload?.busiestUnits || []).map((item) => (
                  <div key={item.unit} className="event-item compact">
                    <strong>{item.unit}</strong>
                    <small>{item.total} ticket(s)</small>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
