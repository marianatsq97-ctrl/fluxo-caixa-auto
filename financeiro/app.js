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

    setupProjecoes(payload.tables.tb_projecoes || []);
    setupReceber(payload.tables.tb_a_receber || []);
    setupInadimplentes(payload.tables.tb_inadimplentes || []);
  }

  function setupProjecoes(rows) {
    const viewSelect = document.getElementById('projViewFilter');
    const monthSelect = document.getElementById('projMonthFilter');
    const yearSelect = document.getElementById('projYearFilter');
    const periods = rows.map((row) => parsePeriodParts(row.periodo)).filter(Boolean);

    fillSelect(viewSelect, [
      { value: 'periodo', label: 'Por período' },
      { value: 'unidade', label: 'Por unidade' }
    ], 'Todas');
    fillSelect(monthSelect, uniqueOptionValues(periods.map((item) => ({ value: String(item.month).padStart(2, '0'), label: item.monthLabel }))), 'Todos');
    fillSelect(yearSelect, uniqueOptionValues(periods.map((item) => ({ value: String(item.year), label: String(item.year) }))), 'Todos');

    const render = () => {
      const filteredRows = rows.filter((row) => {
        const period = parsePeriodParts(row.periodo);
        if (!period) return !monthSelect?.value && !yearSelect?.value;
        const monthOk = !monthSelect?.value || String(period.month).padStart(2, '0') === monthSelect.value;
        const yearOk = !yearSelect?.value || String(period.year) === yearSelect.value;
        return monthOk && yearOk;
      });
      renderProjecoes(filteredRows, viewSelect?.value || 'periodo');
    };

    viewSelect?.addEventListener('change', render);
    monthSelect?.addEventListener('change', render);
    yearSelect?.addEventListener('change', render);
    render();
  }

  function renderProjecoes(rows, viewMode = 'periodo') {
    const summary = summarizeProjecoes(rows);

    setText('projTotalFaturado', formatCurrency(summary.totalFaturado));
    setText('projTotalProjetado', formatCurrency(summary.totalProjetado));
    setText('projTotalRealizado', formatCurrency(summary.totalRealizado));
    setText('projTotalRegistros', String(rows.length));

    renderProjectionCharts(summary, viewMode);
    renderProjectionTable(summary.byUnit);
  }

  function setupReceber(rows) {
    const clienteSelect = document.getElementById('receberClienteFilter');
    const portadorSelect = document.getElementById('receberPortadorFilter');
    const classificacaoSelect = document.getElementById('receberClassificacaoFilter');
    const vencimentoInput = document.getElementById('receberVencimentoFilter');

    fillSelect(clienteSelect, uniqueValues(rows, 'cliente'), 'Todos');
    fillSelect(portadorSelect, uniqueValues(rows, 'portador'), 'Todos');
    fillSelect(classificacaoSelect, uniqueValues(rows, 'classificacao_vencimento'), 'Todas');

    const render = () => {
      const filtered = rows.filter((row) => {
        const clienteOk = !clienteSelect?.value || row.cliente === clienteSelect.value;
        const portadorOk = !portadorSelect?.value || row.portador === portadorSelect.value;
        const classificacaoOk = !classificacaoSelect?.value || row.classificacao_vencimento === classificacaoSelect.value;
        const vencimentoOk = !vencimentoInput?.value || extractMonthToken(row.vencimento) === vencimentoInput.value;
        return clienteOk && portadorOk && classificacaoOk && vencimentoOk;
      });
      renderReceber(filtered);
    };

    clienteSelect?.addEventListener('change', render);
    portadorSelect?.addEventListener('change', render);
    classificacaoSelect?.addEventListener('change', render);
    vencimentoInput?.addEventListener('input', render);
    render();
  }

  function setupInadimplentes(rows) {
    const clienteSelect = document.getElementById('inadClienteFilter');
    const portadorSelect = document.getElementById('inadPortadorFilter');
    const faixaSelect = document.getElementById('inadFaixaFilter');
    const vencimentoInput = document.getElementById('inadVencimentoFilter');

    fillSelect(clienteSelect, uniqueValues(rows, 'cliente'), 'Todos');
    fillSelect(portadorSelect, uniqueValues(rows, 'portador'), 'Todos');
    fillSelect(faixaSelect, uniqueValues(rows, 'faixa_atraso'), 'Todas');

    const render = () => {
      const filtered = rows.filter((row) => {
        const clienteOk = !clienteSelect?.value || row.cliente === clienteSelect.value;
        const portadorOk = !portadorSelect?.value || row.portador === portadorSelect.value;
        const faixaOk = !faixaSelect?.value || row.faixa_atraso === faixaSelect.value;
        const vencimentoOk = !vencimentoInput?.value || extractMonthToken(row.vencimento) === vencimentoInput.value;
        return clienteOk && portadorOk && faixaOk && vencimentoOk;
      });
      renderInadimplentes(filtered);
    };

    clienteSelect?.addEventListener('change', render);
    portadorSelect?.addEventListener('change', render);
    faixaSelect?.addEventListener('change', render);
    vencimentoInput?.addEventListener('input', render);
    render();
  }

  function renderReceber(rows) {
    setText('receberTotalValor', formatCurrency(sum(rows, 'saldo')));
    setText('receberTotalClientes', String(uniqueValues(rows, 'cliente').length));
    setText('receberTotalPortadores', String(uniqueValues(rows, 'portador').length));
    setText('receberTotalTitulos', String(rows.length));

    renderMetricBarChart('receberFaixaChart', aggregateBy(rows, 'classificacao_vencimento', 'saldo'), {
      datasetLabel: 'Saldo',
      xTitle: 'Classificação',
      yTitle: 'Saldo financeiro',
      format: 'currency'
    });
    renderMetricBarChart('receberClienteChart', aggregateBy(rows, 'cliente', 'saldo').slice(0, 8), {
      datasetLabel: 'Saldo',
      xTitle: 'Cliente',
      yTitle: 'Saldo financeiro',
      format: 'currency'
    });
    renderMetricBarChart('receberPortadorChart', aggregateBy(rows, 'portador', 'saldo'), {
      datasetLabel: 'Saldo',
      xTitle: 'Portador',
      yTitle: 'Saldo financeiro',
      format: 'currency'
    });
    renderTable('receberTableBody', rows.slice(0, 20), ['cliente', 'portador', 'documento', 'vencimento', 'saldo', 'dias_para_vencer', 'classificacao_vencimento']);
  }

  function renderInadimplentes(rows) {
    setText('inadTotalValor', formatCurrency(sum(rows, 'saldo')));
    setText('inadTotalClientes', String(uniqueValues(rows, 'cliente').length));
    setText('inadTotalPortadores', String(uniqueValues(rows, 'portador').length));
    setText('inadTotalTitulos', String(rows.length));

    renderMetricBarChart('inadFaixaChart', aggregateBy(rows, 'faixa_atraso', 'saldo'), {
      datasetLabel: 'Saldo vencido',
      xTitle: 'Faixa de atraso',
      yTitle: 'Valor vencido',
      format: 'currency'
    });
    renderMetricBarChart('inadClienteChart', aggregateBy(rows, 'cliente', 'saldo').slice(0, 8), {
      datasetLabel: 'Saldo vencido',
      xTitle: 'Cliente',
      yTitle: 'Valor vencido',
      format: 'currency'
    });
    renderMetricBarChart('inadPortadorChart', aggregateBy(rows, 'portador', 'saldo'), {
      datasetLabel: 'Saldo vencido',
      xTitle: 'Portador',
      yTitle: 'Valor vencido',
      format: 'currency'
    });
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

  function renderProjectionCharts(summary, viewMode = 'periodo') {
    const chartApi = window.Chart;
    const comparativeSeries = viewMode === 'unidade'
      ? {
          labels: summary.byUnit.map((row) => row.unidade),
          realizado: summary.byUnit.map((row) => row.faturamento_realizado),
          projetado: summary.byUnit.map((row) => row.faturamento_projetado),
          xTitle: 'Unidade de negócio'
        }
      : {
          labels: summary.byPeriod.map((row) => row.periodo),
          realizado: summary.byPeriod.map((row) => row.faturamento_realizado),
          projetado: summary.byPeriod.map((row) => row.faturamento_projetado),
          xTitle: 'Período'
        };

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
        labels: comparativeSeries.labels,
        datasets: [
          {
            label: 'Realizado',
            data: comparativeSeries.realizado,
            backgroundColor: 'rgba(255, 122, 26, 0.82)',
            borderColor: 'rgba(255, 145, 69, 1)',
            borderWidth: 1.5,
            borderRadius: 10,
            borderSkipped: false,
            maxBarThickness: 58
          },
          {
            label: 'Projetado',
            data: comparativeSeries.projetado,
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
        xTitle: comparativeSeries.xTitle,
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
      type: 'bar',
      data: {
        labels: summary.byUnit.map((row) => row.unidade),
        datasets: [{
          label: 'Volume projetado',
          data: summary.byUnit.map((row) => row.volume_projetado),
          backgroundColor: 'rgba(255, 208, 123, 0.78)',
          borderColor: 'rgba(255, 208, 123, 1)',
          borderWidth: 1.5,
          borderRadius: 10,
          borderSkipped: false
        }]
      },
      options: buildNumberChartOptions({
        xTitle: 'Unidade de negócio',
        yTitle: 'Volume',
        stacked: false
      })
    });
  }

  function renderMetricBarChart(canvasId, data, { datasetLabel, xTitle, yTitle, format = 'currency' }) {
    if (!window.Chart) {
      renderChart(canvasId, data, format === 'currency' ? formatCurrency : formatNumber);
      return;
    }

    renderCanvasChart(canvasId, {
      type: 'bar',
      data: {
        labels: data.map((item) => item.label),
        datasets: [{
          label: datasetLabel,
          data: data.map((item) => item.value),
          backgroundColor: 'rgba(255, 122, 26, 0.78)',
          borderColor: 'rgba(255, 145, 69, 1)',
          borderWidth: 1.5,
          borderRadius: 10,
          borderSkipped: false
        }]
      },
      options: (format === 'currency' ? buildCurrencyChartOptions : buildNumberChartOptions)({
        xTitle,
        yTitle,
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

  function fillSelect(select, values, emptyLabel = 'Todos') {
    if (!select) return;
    const options = values.map((item) => {
      if (typeof item === 'object') {
        return `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`;
      }
      return `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`;
    }).join('');
    select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>${options}`;
  }

  function uniqueValues(rows, field) {
    return [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort();
  }

  function uniqueOptionValues(options) {
    const seen = new Map();
    options.forEach((option) => {
      if (!option?.value || seen.has(option.value)) return;
      seen.set(option.value, option);
    });
    return [...seen.values()];
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

  function extractMonthToken(value) {
    const parsed = String(value || '');
    return parsed ? parsed.slice(0, 7) : '';
  }

  function parsePeriodParts(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;

    const isoMonth = normalized.match(/^(\d{4})[-/](\d{1,2})$/);
    if (isoMonth) {
      return {
        year: Number(isoMonth[1]),
        month: Number(isoMonth[2]),
        monthLabel: getMonthLabel(Number(isoMonth[2])),
        normalized: `${isoMonth[1]}-${String(isoMonth[2]).padStart(2, '0')}`
      };
    }

    const brMonth = normalized.match(/^(\d{1,2})[-/](\d{4})$/);
    if (brMonth) {
      return {
        year: Number(brMonth[2]),
        month: Number(brMonth[1]),
        monthLabel: getMonthLabel(Number(brMonth[1])),
        normalized: `${brMonth[2]}-${String(brMonth[1]).padStart(2, '0')}`
      };
    }

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    return {
      year,
      month,
      monthLabel: getMonthLabel(month),
      normalized: `${year}-${String(month).padStart(2, '0')}`
    };
  }

  function getMonthLabel(month) {
    return ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][month - 1] || String(month);
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
})();
