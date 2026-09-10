import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createCollaborator,
  createTicketIntake,
  createWebhookIntake,
  downloadTicketAttachment,
  downloadConsentRecordsCsv,
  getAutomationEvents,
  getAuditLogs,
  getCollaborators,
  getConsentRecords,
  getCurrentUser,
  getDashboard,
  getInsights,
  getManagerQueue,
  getPrivacyRequests,
  getPrivacyTerms,
  getRoutingRules,
  getTickets,
  login,
  exportCollaboratorData,
  runSlaSweep,
  submitPrivacyConsent,
  updateCollaboratorProfile,
  updateTicket,
  uploadTicketAttachment,
} from './api'

const SESSION_KEY = 'rh-central-token'
const THEME_KEY = 'rh-central-theme'

const initialCollaboratorForm = {
  registration: '',
  cpf: '',
  name: '',
  address: '',
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

const initialConsentForm = {
  registration: '',
  phone: '',
  decision: 'accepted',
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

function formatCpf(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function attachmentTypeLabel(value) {
  return {
    atestado: 'Atestado',
    documento: 'Documento',
    imagem: 'Imagem',
    pdf: 'PDF',
  }[value] || 'Anexo'
}

function buildAttachmentDownloadName(attachment, collaborator) {
  const extension = attachment.originalName.includes('.')
    ? `.${attachment.originalName.split('.').pop().replace(/[^a-zA-Z0-9]/g, '')}`
    : ''
  const safePart = (value) => String(value || 'nao-identificado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const type = safePart(attachmentTypeLabel(attachment.attachmentType))
  const name = safePart(collaborator?.name)
  const registration = safePart(collaborator?.registration)
  return `${type} - ${name} - ${registration}${extension}`
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

function ConsentPage() {
  const [terms, setTerms] = useState(null)
  const [form, setForm] = useState({
    registration: new URLSearchParams(window.location.search).get('registration') || '',
    phone: '',
    decision: 'accepted',
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getPrivacyTerms().then(setTerms).catch((requestError) => setError(getErrorMessage(requestError)))
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await submitPrivacyConsent(form)
      setMessage('Sua decisão foi registrada e arquivada. Esta página pode ser fechada.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="shell login-shell">
      <div className="login-card consent-public-card">
        <p className="eyebrow">Rede Patao • Central RH</p>
        <h1>{terms?.title || 'Termo de privacidade'}</h1>
        <p className="subtitle">Versão {terms?.version || 'vigente'}</p>
        <div className="privacy-consent-box"><p>{terms?.text || 'Carregando termo...'}</p></div>
        {error ? <div className="feedback error">{error}</div> : null}
        {message ? <div className="feedback success">{message}</div> : null}
        {!message ? <form className="form-grid" onSubmit={submit}>
          <input value={form.registration} onChange={(event) => setForm({ ...form, registration: event.target.value })} placeholder="Matrícula" required />
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: formatPhone(event.target.value) })} placeholder="Telefone cadastrado" required />
          <select value={form.decision} onChange={(event) => setForm({ ...form, decision: event.target.value })}>
            <option value="accepted">Aceito o termo</option>
            <option value="refused">Recuso o termo</option>
          </select>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Registrando...' : 'Confirmar decisão'}</button>
        </form> : null}
      </div>
    </div>
  )
}

function App() {
  const [theme, setTheme] = useState(() => window.localStorage.getItem(THEME_KEY) || 'light')
  const [user, setUser] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [collaborators, setCollaborators] = useState([])
  const [tickets, setTickets] = useState([])
  const [routingRules, setRoutingRules] = useState([])
  const [automationEvents, setAutomationEvents] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [privacyRequests, setPrivacyRequests] = useState([])
  const [privacyTerms, setPrivacyTerms] = useState(null)
  const [consentRecords, setConsentRecords] = useState([])
  const [managerQueue, setManagerQueue] = useState([])
  const [insightsPayload, setInsightsPayload] = useState(null)
  const [collaboratorForm, setCollaboratorForm] = useState(initialCollaboratorForm)
  const [collaboratorSearch, setCollaboratorSearch] = useState('')
  const [editingCollaboratorId, setEditingCollaboratorId] = useState(null)
  const [editingCollaboratorName, setEditingCollaboratorName] = useState('')
  const [editingCollaboratorAddress, setEditingCollaboratorAddress] = useState('')
  const [intakeForm, setIntakeForm] = useState(initialIntakeForm)
  const [webhookForm, setWebhookForm] = useState(initialWebhookForm)
  const [consentForm, setConsentForm] = useState(initialConsentForm)
  const [ticketAssignments, setTicketAssignments] = useState({})
  const [ticketAttachmentForms, setTicketAttachmentForms] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loginForm, setLoginForm] = useState({ username: 'rh', password: 'rh123' })
  const [showPassword, setShowPassword] = useState(false)
  const userRoleRef = useRef(null)

  useEffect(() => {
    userRoleRef.current = user?.role || null
  }, [user])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')
  }

  const loadData = useCallback(async (role = userRoleRef.current) => {
    try {
      setLoading(true)
      const [dashboardData, collaboratorsData, ticketsData, routingRulesData, eventsData, queueData, insightsData, auditLogsData, privacyRequestsData, privacyTermsData, consentRecordsData] = await Promise.all([
        getDashboard(),
        getCollaborators(),
        getTickets(),
        getRoutingRules(),
        getAutomationEvents(),
        getManagerQueue(),
        getInsights(),
        role === 'rh' ? getAuditLogs() : Promise.resolve([]),
        role === 'rh' ? getPrivacyRequests() : Promise.resolve([]),
        getPrivacyTerms(),
        role === 'rh' ? getConsentRecords() : Promise.resolve([]),
      ])
      setDashboard(dashboardData)
      setCollaborators(collaboratorsData)
      setTickets(ticketsData)
      setRoutingRules(routingRulesData)
      setAutomationEvents(eventsData)
      setManagerQueue(queueData)
      setInsightsPayload(insightsData)
      setAuditLogs(auditLogsData)
      setPrivacyRequests(privacyRequestsData)
      setPrivacyTerms(privacyTermsData)
      setConsentRecords(consentRecordsData)
      setTicketAssignments(Object.fromEntries(ticketsData.map((ticket) => [ticket.id, ticket.assignedTo || ''])))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [])

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
        await loadData(currentUser.role)
      } catch {
        window.localStorage.removeItem(SESSION_KEY)
        setUser(null)
        setLoading(false)
      }
    }

    bootstrap()
  }, [loadData])

  useEffect(() => {
    if (!user) return undefined

    const refreshTimer = window.setInterval(() => {
      loadData()
    }, 15000)

    return () => window.clearInterval(refreshTimer)
  }, [loadData, user])

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
      await loadData(result.user.role)
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
    setAuditLogs([])
    setPrivacyRequests([])
    setPrivacyTerms(null)
    setConsentRecords([])
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

  const handleCollaboratorExport = async (collaborator) => {
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      const data = await exportCollaboratorData(collaborator.id)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `dados-lgpd-${collaborator.registration}.json`
      link.click()
      URL.revokeObjectURL(url)
      setSuccess(`Exportação LGPD de ${collaborator.name} concluída.`)
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleConsentSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      await submitPrivacyConsent(consentForm)
      setConsentForm(initialConsentForm)
      setSuccess(`Decisão LGPD registrada para a matrícula ${consentForm.registration}.`)
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const startCollaboratorNameEdit = (collaborator) => {
    setEditingCollaboratorId(collaborator.id)
    setEditingCollaboratorName(collaborator.name)
    setEditingCollaboratorAddress(collaborator.address || '')
    setError('')
    setSuccess('')
  }

  const handleCollaboratorNameSave = async (collaborator) => {
    if (submitting) return
    setSubmitting(true)
    try {
      setError('')
      setSuccess('')
      await updateCollaboratorProfile(collaborator.id, { name: editingCollaboratorName, address: editingCollaboratorAddress })
      setEditingCollaboratorId(null)
      setEditingCollaboratorName('')
      setEditingCollaboratorAddress('')
      setSuccess(`Nome de ${collaborator.name} atualizado.`)
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleConsentRecordsExport = async () => {
    try {
      setError('')
      await downloadConsentRecordsCsv()
      setSuccess('Planilha imutável de consentimentos exportada.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
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

  const handleTicketAttachmentDownload = async (attachment, collaborator) => {
    try {
      setError('')
      await downloadTicketAttachment(attachment.fileName, buildAttachmentDownloadName(attachment, collaborator))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
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

  if (window.location.pathname === '/consent') {
    return <ConsentPage />
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
            <div className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="Senha" />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar senha' : 'Visualizar senha'}>
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
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
          <h1>SpeakBot</h1>
          <p className="subtitle">
            Central de atendimento interno via WhatsApp corporativo para organizar solicitações, protocolos e a fila do RH.
          </p>
        </div>
        <div className="hero-card logout-card">
          <small className="user-badge">{user.name} • {user.role === 'rh' ? 'RH' : 'Gestor'}</small>
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

      <main className="content-grid">
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
            <input value={collaboratorForm.cpf} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, cpf: formatCpf(event.target.value) })} placeholder="CPF" inputMode="numeric" autoComplete="off" />
            <input value={collaboratorForm.phone} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, phone: formatPhone(event.target.value) })} placeholder="Telefone / WhatsApp" />
            <input value={collaboratorForm.role} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, role: event.target.value })} placeholder="Cargo" />
            <input value={collaboratorForm.unit} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, unit: event.target.value })} placeholder="Unidade" />
            <input value={collaboratorForm.department} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, department: event.target.value })} placeholder="Setor" />
            <input value={collaboratorForm.address} onChange={(event) => setCollaboratorForm({ ...collaboratorForm, address: event.target.value })} placeholder="Endereço" />
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

          <div className="form-grid">
            <input value={collaboratorSearch} onChange={(event) => setCollaboratorSearch(event.target.value)} placeholder="Buscar colaborador por nome" aria-label="Buscar colaborador por nome" />
          </div>

          <div className="list-block">
            {loading ? <p>Carregando base de colaboradores...</p> : collaborators
              .filter((collaborator) => collaborator.name.toLocaleLowerCase('pt-BR').includes(collaboratorSearch.trim().toLocaleLowerCase('pt-BR')))
              .map((collaborator) => (
              <article key={collaborator.id} className="list-card">
                <div>
                  {editingCollaboratorId === collaborator.id ? <>
                    <input className="inline-edit-input" value={editingCollaboratorName} onChange={(event) => setEditingCollaboratorName(event.target.value)} aria-label={`Editar nome de ${collaborator.name}`} />
                    <input className="inline-edit-input" value={editingCollaboratorAddress} onChange={(event) => setEditingCollaboratorAddress(event.target.value)} aria-label={`Editar endereço de ${collaborator.name}`} placeholder="Endereço" />
                  </> : <h3>{collaborator.name}</h3>}
                  <p>{collaborator.registration} • {collaborator.role}</p>
                </div>
                <div className="meta-stack">
                  <span>{collaborator.unit}</span>
                  <span>{collaborator.department}</span>
                  <span>{collaborator.address || 'Endereço não informado'}</span>
                  <span>{formatPhone(collaborator.phone)}</span>
                  <span>CPF: {collaborator.cpf ? formatCpf(collaborator.cpf) : 'não informado'}</span>
                  <span>{collaborator.status}</span>
                  <span>{collaborator.whatsappOptIn ? 'opt-in ativo' : 'sem opt-in'}</span>
                  <span>LGPD: {collaborator.lgpdConsentStatus === 'accepted' ? 'aceito' : collaborator.lgpdConsentStatus === 'refused' ? 'recusado' : 'pendente'}</span>
                </div>
                {user.role === 'rh' ? <div className="list-card-actions">
                  {editingCollaboratorId === collaborator.id ? <>
                    <button type="button" className="ghost-button" onClick={() => handleCollaboratorNameSave(collaborator)} disabled={submitting}>Salvar dados permitidos</button>
                    <button type="button" className="ghost-button" onClick={() => setEditingCollaboratorId(null)} disabled={submitting}>Cancelar</button>
                  </> : <button type="button" className="ghost-button" onClick={() => startCollaboratorNameEdit(collaborator)} disabled={submitting}>Editar nome</button>}
                  <button type="button" className="ghost-button" onClick={() => handleCollaboratorExport(collaborator)} disabled={submitting}>Exportar LGPD</button>
                </div> : null}
              </article>
              ))}
            {!loading && collaborators.length > 0 && collaborators.filter((collaborator) => collaborator.name.toLocaleLowerCase('pt-BR').includes(collaboratorSearch.trim().toLocaleLowerCase('pt-BR'))).length === 0 ? <p>Nenhum colaborador encontrado.</p> : null}
          </div>

          {user.role === 'rh' ? <div className="privacy-consent-box">
            <div>
              <p className="section-label">Termo vigente {privacyTerms?.version || ''}</p>
              <h3>{privacyTerms?.title || 'Termo de privacidade'}</h3>
              <p>{privacyTerms?.text || 'Carregando termo vigente...'}</p>
            </div>
            <form className="form-grid" onSubmit={handleConsentSubmit}>
              <input value={consentForm.registration} onChange={(event) => setConsentForm({ ...consentForm, registration: event.target.value })} placeholder="Matrícula do titular" />
              <input value={consentForm.phone} onChange={(event) => setConsentForm({ ...consentForm, phone: formatPhone(event.target.value) })} placeholder="Telefone do titular" />
              <select value={consentForm.decision} onChange={(event) => setConsentForm({ ...consentForm, decision: event.target.value })}>
                <option value="accepted">Aceitar termo</option>
                <option value="refused">Recusar termo</option>
              </select>
              <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Registrando...' : 'Registrar decisão do titular'}</button>
            </form>
          </div> : null}
        </section>

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
                      <button key={attachment.id} type="button" onClick={() => handleTicketAttachmentDownload(attachment, ticket.collaborator)} className="attachment-link">
                        <strong>{attachment.originalName}</strong>
                        <span>{attachment.attachmentType} • {attachment.uploadedBy}</span>
                      </button>
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

          {user.role === 'rh' ? <>
            <div className="tickets-header phase-block-title">
              <div>
                <p className="section-label">Governança</p>
                <h2>Auditoria e LGPD</h2>
              </div>
              <div className="panel-actions"><span className="badge">{auditLogs.length} eventos</span><button type="button" className="ghost-button" onClick={handleConsentRecordsExport}>Exportar planilha</button></div>
            </div>
            <div className="phase-grid">
              <article className="phase-card">
                <h3>Trilha de auditoria</h3>
                <div className="events-list">
                  {auditLogs.slice(0, 10).map((log) => (
                    <div key={log.id} className="event-item">
                      <strong>{log.action} • {log.resourceType}</strong>
                      <small>{log.actorName} • {new Date(log.createdAt).toLocaleString('pt-BR')}</small>
                      <small>{log.resourceId || 'sessão'}{log.metadata?.outcome ? ` • ${log.metadata.outcome}` : ''}</small>
                    </div>
                  ))}
                  {auditLogs.length === 0 ? <small>Sem eventos de auditoria.</small> : null}
                </div>
              </article>
              <article className="phase-card">
                <h3>Solicitações LGPD</h3>
                <div className="events-list">
                  {privacyRequests.slice(0, 10).map((item) => (
                    <div key={item.id} className="event-item">
                      <strong>{item.requestType} • {item.status}</strong>
                      <small>Titular: {collaborators.find((collaborator) => collaborator.id === item.collaboratorId)?.name || 'Anonimizado'}</small>
                      <small>{item.requestedBy} • {new Date(item.createdAt).toLocaleString('pt-BR')}</small>
                    </div>
                  ))}
                  {privacyRequests.length === 0 ? <small>Nenhuma solicitação registrada.</small> : null}
                </div>
              </article>
              <article className="phase-card consent-records-card">
                <h3>Consentimentos arquivados</h3>
                <p className="section-note">Cada linha abaixo é um snapshot imutável da decisão do titular. Cadastros com status LGPD pendente ainda não geram uma linha no arquivo.</p>
                <div className="events-list">
                  {consentRecords.slice().reverse().slice(0, 20).map((record) => (
                    <div key={record.id} className="event-item">
                      <strong>{record.decision === 'accepted' ? 'Aceite' : 'Recusa'} • {record.collaboratorName}</strong>
                      <small>Matrícula {record.registration} • CPF {record.cpf || 'não informado'}</small>
                      <small>Termo {record.termVersion} • {new Date(record.recordedAt).toLocaleString('pt-BR')}</small>
                      <small>Telefone {record.phone} • Endereço: {record.address || 'não informado'}</small>
                    </div>
                  ))}
                  {consentRecords.length === 0 ? <small>Nenhuma decisão arquivada. Enquanto o titular não responder, o cadastro permanece pendente.</small> : null}
                </div>
              </article>
            </div>
          </> : null}

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
