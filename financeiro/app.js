(function () {
  const {
    getSession,
    saveSession,
    clearSession,
    getFinanceData,
    formatCurrency,
    formatDateBR,
    formatDateTimeBR,
    escapeHtml,
    normalizeText
  } = window.FinanceiroUtils;
  const chartRegistry = new Map();

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
    setupReceber(payload.tables.tb_a_receber || []);
    setupInadimplentes(payload.tables.tb_inadimplentes || []);
  }

  function renderProjecoes(rows) {
    const summary = summarizeProjecoes(rows);

    setText('projTotalFaturado', formatCurrency(summary.totalFaturado));
    setText('projTotalProjetado', formatCurrency(summary.totalProjetado));
    setText('projTotalRealizado', formatCurrency(summary.totalRealizado));
    setText('projTotalRegistros', String(rows.length));

    renderProjectionCharts(summary);
    renderProjectionTable(summary.byUnit);
  }

  function setupReceber(rows) {
    bindFilteredSection({
      rows,
      clienteSelectId: 'receberClienteFilter',
      portadorSelectId: 'receberPortadorFilter',
      textInputId: 'receberTextoFilter',
      onRender: renderReceber
    });
  }

  function setupInadimplentes(rows) {
    bindFilteredSection({
      rows,
      clienteSelectId: 'inadClienteFilter',
      portadorSelectId: 'inadPortadorFilter',
      textInputId: 'inadTextoFilter',
      onRender: renderInadimplentes
    });
  }

  function bindFilteredSection({ rows, clienteSelectId, portadorSelectId, textInputId, onRender }) {
    const clienteSelect = document.getElementById(clienteSelectId);
    const portadorSelect = document.getElementById(portadorSelectId);
    const textInput = document.getElementById(textInputId);

    fillSelect(clienteSelect, uniqueValues(rows, 'cliente'));
    fillSelect(portadorSelect, uniqueValues(rows, 'portador'));

    const render = () => {
      const filtered = rows.filter((row) => {
        const clienteOk = !clienteSelect?.value || row.cliente === clienteSelect.value;
        const portadorOk = !portadorSelect?.value || row.portador === portadorSelect.value;
        const search = normalizeText(textInput?.value || '');
        const textOk = !search || normalizeText(`${row.cliente} ${row.documento}`).includes(search);
        return clienteOk && portadorOk && textOk;
      });
      onRender(filtered);
    };

    clienteSelect?.addEventListener('change', render);
    portadorSelect?.addEventListener('change', render);
    textInput?.addEventListener('input', render);
    render();
  }

  function renderReceber(rows) {
    setText('receberTotalClientes', String(uniqueValues(rows, 'cliente').length));
    setText('receberTotalPortadores', String(uniqueValues(rows, 'portador').length));
    setText('receberTotalValor', formatCurrency(sum(rows, 'saldo')));
    setText('receberTotalTitulos', String(rows.length));

    renderChart('receberFaixaChart', aggregateBy(rows, 'classificacao_vencimento', 'saldo'), formatCurrency);
    renderChart('receberClienteChart', aggregateBy(rows, 'cliente', 'saldo').slice(0, 8), formatCurrency);
    renderChart('receberPortadorChart', aggregateBy(rows, 'portador', 'saldo'), formatCurrency);
    renderTable('receberTableBody', rows.slice(0, 20), ['cliente', 'portador', 'documento', 'vencimento', 'saldo', 'dias_para_vencer', 'classificacao_vencimento']);
  }

  function renderInadimplentes(rows) {
    setText('inadTotalClientes', String(uniqueValues(rows, 'cliente').length));
    setText('inadTotalPortadores', String(uniqueValues(rows, 'portador').length));
    setText('inadTotalValor', formatCurrency(sum(rows, 'saldo')));
    setText('inadTotalTitulos', String(rows.length));

    renderChart('inadFaixaChart', aggregateBy(rows, 'faixa_atraso', 'saldo'), formatCurrency);
    renderChart('inadClienteChart', aggregateBy(rows, 'cliente', 'saldo').slice(0, 8), formatCurrency);
    renderChart('inadPortadorChart', aggregateBy(rows, 'portador', 'saldo'), formatCurrency);
    renderTable('inadTableBody', rows.slice(0, 20), ['cliente', 'portador', 'documento', 'vencimento', 'saldo', 'dias_em_atraso', 'faixa_atraso']);
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

  function renderProjectionCharts(summary) {
    const chartApi = window.Chart;
    if (!chartApi) {
      renderChart('projComparativoChart', [
        { label: 'Realizado', value: summary.totalRealizado },
        { label: 'Projetado', value: summary.totalProjetado }
      ], formatCurrency);
      renderChart('projFaturamentoChart', summary.byUnit.map((row) => ({ label: row.unidade, value: row.faturamento_projetado })), formatCurrency);
      renderChart('projVolumeChart', summary.byUnit.map((row) => ({ label: row.unidade, value: row.volume_projetado })), formatNumber);
      return;
    }

    renderCanvasChart('projComparativoChart', {
      type: 'bar',
      data: {
        labels: ['Realizado', 'Projetado'],
        datasets: [{
          label: 'Faturamento',
          data: [summary.totalRealizado, summary.totalProjetado],
          backgroundColor: ['rgba(255, 122, 26, 0.82)', 'rgba(99, 132, 255, 0.72)'],
          borderRadius: 12,
          borderSkipped: false,
          maxBarThickness: 84
        }]
      },
      options: buildCurrencyChartOptions()
    });

    renderCanvasChart('projFaturamentoChart', {
      type: 'bar',
      data: {
        labels: summary.byUnit.map((row) => row.unidade),
        datasets: [{
          label: 'Faturamento projetado',
          data: summary.byUnit.map((row) => row.faturamento_projetado),
          backgroundColor: 'rgba(255, 122, 26, 0.72)',
          borderColor: 'rgba(255, 145, 69, 1)',
          borderWidth: 1.5,
          borderRadius: 10,
          borderSkipped: false
        }]
      },
      options: buildCurrencyChartOptions()
    });

    renderCanvasChart('projVolumeChart', {
      type: 'bar',
      data: {
        labels: summary.byUnit.map((row) => row.unidade),
        datasets: [{
          label: 'Volume projetado',
          data: summary.byUnit.map((row) => row.volume_projetado),
          backgroundColor: 'rgba(99, 132, 255, 0.72)',
          borderColor: 'rgba(145, 168, 255, 1)',
          borderWidth: 1.5,
          borderRadius: 10,
          borderSkipped: false
        }]
      },
      options: buildNumberChartOptions()
    });
  }

  function renderCanvasChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;

    const previous = chartRegistry.get(canvasId);
    if (previous) previous.destroy();

    const chart = new window.Chart(canvas, {
      ...config,
      options: {
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {
            display: Boolean(config.data?.datasets?.length > 1)
          },
          tooltip: {
            callbacks: {
              label(context) {
                const label = context.dataset?.label ? `${context.dataset.label}: ` : '';
                return `${label}${formatChartValue(context.raw, canvasId)}`;
              }
            }
          }
        },
        ...config.options
      }
    });

    chartRegistry.set(canvasId, chart);
  }

  function summarizeProjecoes(rows) {
    const byUnitMap = new Map();

    rows.forEach((row) => {
      const key = row.unidade || 'Sem unidade';
      const current = byUnitMap.get(key) || {
        unidade: key,
        unidade_medida: row.unidade_medida || '-',
        volume_realizado: 0,
        volume_medio: 0,
        volume_projetado: 0,
        faturamento_realizado: 0,
        faturamento_medio: 0,
        faturamento_projetado: 0,
        registros: 0
      };

      current.unidade_medida = current.unidade_medida === '-' ? row.unidade_medida || '-' : current.unidade_medida;
      current.volume_realizado += Number(row.volume_realizado || 0);
      current.volume_medio += Number(row.volume_medio || 0);
      current.volume_projetado += Number(row.volume_projetado || 0);
      current.faturamento_realizado += Number(row.faturamento_realizado || 0);
      current.faturamento_medio += Number(row.faturamento_medio || 0);
      current.faturamento_projetado += Number(row.faturamento_projetado || 0);
      current.registros += 1;
      byUnitMap.set(key, current);
    });

    const byUnit = [...byUnitMap.values()].sort((a, b) => b.faturamento_projetado - a.faturamento_projetado);
    const totalRealizado = sum(rows, 'faturamento_realizado');
    const totalProjetado = sum(rows, 'faturamento_projetado');
    const totalFaturado = totalRealizado + sum(rows, 'faturamento_medio');

    return { totalRealizado, totalProjetado, totalFaturado, byUnit };
  }

  function renderProjectionTable(rows) {
    const target = document.getElementById('projecoesTableBody');
    if (!target) return;

    target.innerHTML = rows.length
      ? rows
          .map((row) => `
            <tr>
              <td>${escapeHtml(row.unidade || '-')}</td>
              <td>${escapeHtml(row.unidade_medida || '-')}</td>
              <td class="numeric-cell">${escapeHtml(formatNumber(row.volume_realizado))}</td>
              <td class="numeric-cell">${escapeHtml(formatNumber(row.volume_medio))}</td>
              <td class="numeric-cell">${escapeHtml(formatNumber(row.volume_projetado))}</td>
              <td class="numeric-cell">${escapeHtml(formatCurrency(row.faturamento_realizado))}</td>
              <td class="numeric-cell">${escapeHtml(formatCurrency(row.faturamento_medio))}</td>
              <td class="numeric-cell">${escapeHtml(formatCurrency(row.faturamento_projetado))}</td>
            </tr>
          `)
          .join('')
      : '<tr><td colspan="8" class="empty-state-cell">Sem dados disponíveis.</td></tr>';
  }

  function renderTable(targetId, rows, columns) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = rows.length
      ? rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatValue(row[column]))}</td>`).join('')}</tr>`).join('')
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

  function fillSelect(select, values) {
    if (!select) return;
    select.innerHTML = `<option value="">Todos</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  }

  function uniqueValues(rows, field) {
    return [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort();
  }

  function aggregateBy(rows, field, valueField) {
    const bucket = new Map();
    rows.forEach((row) => {
      const label = row[field] || 'Sem grupo';
      bucket.set(label, (bucket.get(label) || 0) + Number(row[valueField] || 0));
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

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('pt-BR');
  }

  function formatChartValue(value, canvasId) {
    return canvasId === 'projVolumeChart' ? formatNumber(value) : formatCurrency(value);
  }

  function buildCurrencyChartOptions() {
    return {
      scales: {
        x: buildAxisOptions(),
        y: {
          beginAtZero: true,
          ticks: {
            color: '#99a5c3',
            callback: (value) => compactCurrency(value)
          },
          grid: {
            color: 'rgba(255,255,255,0.07)'
          }
        }
      }
    };
  }

  function buildNumberChartOptions() {
    return {
      scales: {
        x: buildAxisOptions(),
        y: {
          beginAtZero: true,
          ticks: {
            color: '#99a5c3',
            callback: (value) => compactNumber(value)
          },
          grid: {
            color: 'rgba(255,255,255,0.07)'
          }
        }
      }
    };
  }

  function buildAxisOptions() {
    return {
      ticks: {
        color: '#d4def8',
        maxRotation: 0,
        autoSkip: false
      },
      grid: {
        display: false
      }
    };
  }

  function compactCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(Number(value || 0));
  }

  function compactNumber(value) {
    return new Intl.NumberFormat('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(Number(value || 0));
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
})();
