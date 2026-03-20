(function () {
  const {
    getSession,
    saveSession,
    clearSession,
    getFinanceData,
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
    ensureAuthorized(requiredRole);
  }

  function initDashboard() {
    ensureAuthorized();
    initTabs();

    const payload = getFinanceData();
    const emptyState = document.getElementById('dashboardEmptyState');
    if (!payload?.tables) {
      emptyState?.classList.add('is-visible');
      return;
    }

    emptyState?.classList.remove('is-visible');
    setText('dashboardUpdatedAt', `Atualizado em ${formatDateTimeBR(payload.updatedAt)}`);

    renderProjecoes(payload.tables.tb_projecoes || []);
    renderReceber(payload.tables.tb_a_receber || []);
    renderInadimplentes(payload.tables.tb_inadimplentes || []);
  }

  function renderProjecoes(rows) {
    const totalRealizado = sum(rows, 'faturamento_realizado');
    const totalProjetado = sum(rows, 'faturamento_projetado');
    const totalFaturado = totalRealizado + sum(rows, 'faturamento_medio');

    setText('projTotalFaturado', formatCurrency(totalFaturado));
    setText('projTotalProjetado', formatCurrency(totalProjetado));
    setText('projTotalRealizado', formatCurrency(totalRealizado));
    setText('projTotalRegistros', String(rows.length));

    const chartData = aggregateBy(rows, 'unidade', 'faturamento_projetado');
    renderChart('projecoesChart', chartData, formatCurrency);
    renderTable('projecoesTableBody', rows.slice(0, 12), ['periodo', 'unidade', 'volume_projetado', 'faturamento_realizado', 'faturamento_projetado']);
  }

  function renderReceber(rows) {
    setText('receberTotalValor', formatCurrency(sum(rows, 'saldo')));
    setText('receberTotalTitulos', String(rows.length));
    setText('receberUrgentes', String(rows.filter((row) => row.classificacao_vencimento === 'urgente').length));
    setText('receberProximos', String(rows.filter((row) => row.dias_para_vencer <= 7).length));

    const chartData = aggregateBy(rows, 'classificacao_vencimento', 'saldo');
    renderChart('receberChart', chartData, formatCurrency);
    renderTable('receberTableBody', rows.slice(0, 15), ['cliente', 'vencimento', 'saldo', 'dias_para_vencer', 'classificacao_vencimento']);
  }

  function renderInadimplentes(rows) {
    setText('inadTotalValor', formatCurrency(sum(rows, 'saldo')));
    setText('inadTotalTitulos', String(rows.length));
    setText('inadTotalClientes', String(new Set(rows.map((row) => row.cliente)).size));
    setText('inadCriticos', String(rows.filter((row) => row.faixa_atraso === 'crítico').length));

    const chartData = aggregateBy(rows, 'faixa_atraso', 'saldo');
    renderChart('inadChart', chartData, formatCurrency);
    renderTable('inadTableBody', rows.slice(0, 15), ['cliente', 'vencimento', 'saldo', 'dias_em_atraso', 'faixa_atraso']);
  }

  function renderChart(containerId, data, formatter) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const max = Math.max(...data.map((item) => item.value), 0) || 1;
    container.innerHTML = data.length
      ? data
          .map(
            (item) => `
              <div class="chart-item">
                <div class="chart-label-row">
                  <span>${escapeHtml(item.label || 'Sem grupo')}</span>
                  <strong>${formatter(item.value)}</strong>
                </div>
                <div class="chart-bar-track"><div class="chart-bar" style="width:${(item.value / max) * 100}%"></div></div>
              </div>
            `
          )
          .join('')
      : '<div class="empty-state-cell">Sem dados para gráfico.</div>';
  }

  function renderTable(targetId, rows, columns) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatValue(row[column]))}</td>`).join('')}</tr>`
          )
          .join('')
      : `<tr><td colspan="${columns.length}" class="empty-state-cell">Sem dados disponíveis.</td></tr>`;
  }

  function initTabs() {
    const buttons = Array.from(document.querySelectorAll('[data-tab-target]'));
    const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.tabTarget;
        buttons.forEach((item) => item.classList.toggle('is-active', item === button));
        panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.tabPanel === target));
      });
    });
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

  function aggregateBy(rows, field, valueField) {
    const bucket = new Map();
    rows.forEach((row) => {
      const label = row[field] || 'Sem grupo';
      const current = bucket.get(label) || 0;
      bucket.set(label, current + Number(row[valueField] || 0));
    });
    return [...bucket.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  function sum(rows, field) {
    return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  }

  function formatValue(value) {
    if (typeof value === 'number') return value.toLocaleString('pt-BR');
    if (String(value).includes('T') && !Number.isNaN(Date.parse(value))) return formatDateBR(value);
    return value ?? '-';
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
})();
