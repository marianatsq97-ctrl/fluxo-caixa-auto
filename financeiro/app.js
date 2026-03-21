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
      renderChart('projVolumeChart', summary.byPeriod.map((row) => ({ label: row.periodo, value: row.faturamento_projetado })), formatCurrency);
      return;
    }

    renderCanvasChart('projComparativoChart', {
      type: 'bar',
      data: {
        labels: summary.byPeriod.map((row) => row.periodo),
        datasets: [
          {
            label: 'Realizado',
            data: summary.byPeriod.map((row) => row.faturamento_realizado),
            backgroundColor: 'rgba(255, 122, 26, 0.82)',
            borderColor: 'rgba(255, 145, 69, 1)',
            borderWidth: 1.5,
            borderRadius: 10,
            borderSkipped: false,
            maxBarThickness: 58
          },
          {
            label: 'Projetado',
            data: summary.byPeriod.map((row) => row.faturamento_projetado),
            backgroundColor: 'rgba(99, 132, 255, 0.74)',
            borderColor: 'rgba(145, 168, 255, 1)',
            borderWidth: 1.5,
            borderRadius: 10,
            borderSkipped: false,
            maxBarThickness: 58
          }
        ]
      },
      options: buildCurrencyChartOptions({
        xTitle: 'Período',
        yTitle: 'Valores financeiros',
        stacked: false
      })
    });

    renderCanvasChart('projFaturamentoChart', {
      type: 'bar',
      data: {
        labels: summary.byUnit.map((row) => row.unidade),
        datasets: [
          {
            label: 'Realizado',
            data: summary.byUnit.map((row) => row.faturamento_realizado),
            backgroundColor: 'rgba(255, 122, 26, 0.82)',
            borderColor: 'rgba(255, 145, 69, 1)',
            borderWidth: 1.5,
            borderRadius: 10,
            borderSkipped: false
          },
          {
            label: 'Projetado',
            data: summary.byUnit.map((row) => row.faturamento_projetado),
            backgroundColor: 'rgba(99, 132, 255, 0.74)',
            borderColor: 'rgba(145, 168, 255, 1)',
            borderWidth: 1.5,
            borderRadius: 10,
            borderSkipped: false
          }
        ]
      },
      options: buildCurrencyChartOptions({
        xTitle: 'Unidade de negócio',
        yTitle: 'Valores financeiros',
        stacked: false
      })
    });

    renderCanvasChart('projVolumeChart', {
      type: 'line',
      data: {
        labels: summary.byPeriod.map((row) => row.periodo),
        datasets: [
          {
            label: 'Faturamento médio',
            data: summary.byPeriod.map((row) => row.faturamento_medio),
            borderColor: 'rgba(255, 208, 123, 1)',
            backgroundColor: 'rgba(255, 208, 123, 0.18)',
            borderWidth: 3,
            pointRadius: 4,
            pointHoverRadius: 5,
            pointBackgroundColor: 'rgba(255, 208, 123, 1)',
            tension: 0.34,
            fill: false
          },
          {
            label: 'Faturamento projetado',
            data: summary.byPeriod.map((row) => row.faturamento_projetado),
            borderColor: 'rgba(99, 132, 255, 1)',
            backgroundColor: 'rgba(99, 132, 255, 0.18)',
            borderWidth: 3,
            pointRadius: 4,
            pointHoverRadius: 5,
            pointBackgroundColor: 'rgba(99, 132, 255, 1)',
            tension: 0.34,
            fill: false
          }
        ]
      },
      options: buildCurrencyChartOptions({
        xTitle: 'Período',
        yTitle: 'Valores financeiros',
        stacked: false
      })
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
    const byPeriodMap = new Map();

    rows.forEach((row) => {
      const unitKey = row.unidade || 'Sem unidade';
      const periodKey = row.periodo || 'Sem período';
      const current = byUnitMap.get(unitKey) || {
        unidade: unitKey,
        unidade_medida: row.unidade_medida || '-',
        volume_realizado: 0,
        volume_medio: 0,
        volume_projetado: 0,
        faturamento_realizado: 0,
        faturamento_medio: 0,
        faturamento_projetado: 0,
        registros: 0
      };
      const currentPeriod = byPeriodMap.get(periodKey) || {
        periodo: periodKey,
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
      byUnitMap.set(unitKey, current);

      currentPeriod.faturamento_realizado += Number(row.faturamento_realizado || 0);
      currentPeriod.faturamento_medio += Number(row.faturamento_medio || 0);
      currentPeriod.faturamento_projetado += Number(row.faturamento_projetado || 0);
      currentPeriod.registros += 1;
      byPeriodMap.set(periodKey, currentPeriod);
    });

    const byUnit = [...byUnitMap.values()].sort((a, b) => b.faturamento_projetado - a.faturamento_projetado);
    const byPeriod = [...byPeriodMap.values()].sort((a, b) => comparePeriodLabels(a.periodo, b.periodo));
    const totalRealizado = sum(rows, 'faturamento_realizado');
    const totalProjetado = sum(rows, 'faturamento_projetado');
    const totalFaturado = totalRealizado + sum(rows, 'faturamento_medio');

    return { totalRealizado, totalProjetado, totalFaturado, byUnit, byPeriod };
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

  function buildCurrencyChartOptions({ xTitle, yTitle, stacked = false } = {}) {
    return {
      scales: {
        x: buildAxisOptions(xTitle, stacked),
        y: {
          beginAtZero: true,
          stacked,
          title: buildAxisTitle(yTitle),
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

  function buildNumberChartOptions({ xTitle, yTitle, stacked = false } = {}) {
    return {
      scales: {
        x: buildAxisOptions(xTitle, stacked),
        y: {
          beginAtZero: true,
          stacked,
          title: buildAxisTitle(yTitle),
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

  function buildAxisOptions(title, stacked = false) {
    return {
      stacked,
      title: buildAxisTitle(title),
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

  function buildAxisTitle(text) {
    return text
      ? {
          display: true,
          text,
          color: '#99a5c3',
          font: {
            size: 12,
            weight: '600'
          }
        }
      : undefined;
  }

  function comparePeriodLabels(left, right) {
    const leftDate = normalizePeriodLabel(left);
    const rightDate = normalizePeriodLabel(right);
    return leftDate - rightDate;
  }

  function normalizePeriodLabel(value) {
    const normalized = String(value || '').trim();
    const isoMonth = normalized.match(/^(\d{4})[-/](\d{1,2})$/);
    if (isoMonth) return new Date(Number(isoMonth[1]), Number(isoMonth[2]) - 1, 1).getTime();

    const brMonth = normalized.match(/^(\d{1,2})[-/](\d{4})$/);
    if (brMonth) return new Date(Number(brMonth[2]), Number(brMonth[1]) - 1, 1).getTime();

    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
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
