(function () {
  const {
    getSession,
    saveSession,
    clearSession,
    getFinanceData,
    calculateSummary,
    formatCurrency,
    formatDateBR,
    formatDateTimeBR,
    escapeHtml
  } = window.FinanceiroUtils;

  const CREDENTIALS = {
    admin: { password: 'admin123', role: 'admin', redirect: 'admin.html' },
    usuario: { password: '123', role: 'usuario', redirect: 'dashboard.html' }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page;

    if (page === 'login') initLogin();
    if (page === 'admin') initProtectedPage('admin');
    if (page === 'dashboard') initDashboard();

    setupLogout();
  });

  function initLogin() {
    const session = getSession();
    if (session?.role === 'admin') window.location.replace('admin.html');
    if (session?.role === 'usuario') window.location.replace('dashboard.html');

    const form = document.getElementById('loginForm');
    const message = document.getElementById('loginMessage');

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = String(document.getElementById('username')?.value || '').trim().toLowerCase();
      const password = String(document.getElementById('password')?.value || '');
      const credential = CREDENTIALS[username];

      if (!credential || credential.password !== password) {
        message.textContent = 'Usuário ou senha inválidos.';
        return;
      }

      saveSession({ username, role: credential.role, loginAt: new Date().toISOString() });
      message.textContent = '';
      window.location.href = credential.redirect;
    });
  }

  function initProtectedPage(requiredRole) {
    const session = ensureAuthorized(requiredRole);
    const roleTarget = document.getElementById('sessionRole');
    if (roleTarget && session) roleTarget.textContent = session.role;
  }

  function initDashboard() {
    const session = ensureAuthorized();
    const roleTarget = document.getElementById('dashboardRole');
    if (roleTarget && session) roleTarget.textContent = session.role;

    const payload = getFinanceData();
    const tableBody = document.getElementById('detailsTable');
    const emptyState = document.getElementById('dashboardEmptyState');

    if (!payload?.records?.length) {
      if (emptyState) emptyState.classList.add('is-visible');
      if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="7" class="empty-state-cell">Nenhum dado disponível.</td></tr>';
      }
      return;
    }

    const records = payload.records;
    const summary = calculateSummary(records);
    const totalValores = records.reduce((total, record) => total + Number(record.amount || record.valor || 0), 0);

    setText('dashboardUpdatedAt', `Atualizado em ${formatDateTimeBR(payload.updatedAt)}`);
    setText('totalRegistros', String(records.length));
    setText('totalValores', formatCurrency(totalValores));
    setText('totalVencido', formatCurrency(summary.totalVencido));
    setText('totalAVencer', formatCurrency(summary.totalAVencer));

    if (tableBody) {
      tableBody.innerHTML = records
        .map(
          (record) => `
            <tr>
              <td>${escapeHtml(record.client || record.cliente || '-')}</td>
              <td>${formatDateBR(record.issueDate || record.data)}</td>
              <td>${formatDateBR(record.dueDate || record.vencimento)}</td>
              <td>${formatCurrency(record.amount ?? record.valor)}</td>
              <td>${formatCurrency(record.paidAmount ?? record.valorPago)}</td>
              <td>${formatCurrency(record.saldo)}</td>
              <td>${renderStatusBadge(record.status)}</td>
            </tr>
          `
        )
        .join('');
    }
  }

  function ensureAuthorized(requiredRole) {
    const session = getSession();
    if (!session) {
      window.location.replace('index.html');
      return null;
    }

    if (requiredRole === 'admin' && session.role !== 'admin') {
      window.location.replace('dashboard.html');
      return null;
    }

    return session;
  }

  function setupLogout() {
    const logoutButton = document.getElementById('logoutButton');
    logoutButton?.addEventListener('click', () => {
      clearSession();
      window.location.href = 'index.html';
    });
  }

  function renderStatusBadge(status) {
    const normalized = String(status || '').toLowerCase();
    const type = normalized === 'quitado' ? 'success' : normalized === 'vencido' ? 'danger' : 'warning';
    return `<span class="badge badge-${type}">${escapeHtml(status)}</span>`;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
})();
