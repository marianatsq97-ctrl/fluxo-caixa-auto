(function () {
  const STORAGE_KEYS = {
    session: 'aa_finance_session',
    financeData: 'aa_finance_data'
  };

  const REQUIRED_SHEET = 'Cálculos de Projeção';
  const VALID_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv'];
  const COLUMN_SYNONYMS = {
    client: ['cliente', 'sacado', 'razao social', 'nome cliente', 'nome', 'cliente sacado'],
    amount: ['valor', 'valor total', 'vlr', 'valor original', 'valor titulo', 'receber', 'total'],
    dueDate: ['vencimento', 'dt vencimento', 'data vencimento', 'vence', 'vcto'],
    paidAmount: ['valor pago', 'recebido', 'pagamento', 'valor recebido', 'vl pago', 'pago'],
    paymentDate: ['data pagamento', 'dt pagamento', 'baixa', 'recebimento', 'data recebimento'],
    status: ['status', 'situacao', 'situação'],
    document: ['documento', 'titulo', 'título', 'nf', 'nota', 'numero', 'número', 'pedido'],
    issueDate: ['data emissao', 'data emissão', 'emissao', 'emissão', 'data', 'competencia', 'competência'],
    category: ['categoria', 'carteira', 'grupo', 'segmento', 'origem']
  };

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseBrazilianNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    let sanitized = String(value).trim();
    if (!sanitized) return 0;

    sanitized = sanitized.replace(/R\$/gi, '').replace(/\s/g, '');

    const hasComma = sanitized.includes(',');
    const hasDot = sanitized.includes('.');

    if (hasComma && hasDot) {
      sanitized = sanitized.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      sanitized = sanitized.replace(',', '.');
    }

    sanitized = sanitized.replace(/[^0-9.-]/g, '');
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function excelDateToJSDate(serial) {
    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    const fractionalDay = serial - Math.floor(serial) + 0.0000001;
    let totalSeconds = Math.floor(86400 * fractionalDay);
    const seconds = totalSeconds % 60;
    totalSeconds -= seconds;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60) % 60;
    return new Date(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate(), hours, minutes, seconds);
  }

  function parseDate(value) {
    if (!value && value !== 0) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value) && value > 59) return excelDateToJSDate(value);

    const raw = String(value).trim();
    if (!raw) return null;

    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
      const [day, month, year] = raw.split('/').map(Number);
      const normalizedYear = year < 100 ? 2000 + year : year;
      const date = new Date(normalizedYear, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const isoDate = new Date(raw);
    return Number.isNaN(isoDate.getTime()) ? null : isoDate;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(Number(value || 0));
  }

  function formatDateBR(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return '-';
    return new Intl.DateTimeFormat('pt-BR').format(date);
  }

  function formatDateTimeBR(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!date || Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(date);
  }

  function guessHeaderRow(rows) {
    const limit = Math.min(rows.length, 12);
    let bestIndex = 0;
    let bestScore = -1;

    for (let index = 0; index < limit; index += 1) {
      const row = rows[index] || [];
      const score = row.reduce((total, cell) => {
        const normalized = normalizeText(cell);
        if (!normalized) return total;
        const matched = Object.values(COLUMN_SYNONYMS).some((synonyms) =>
          synonyms.some((synonym) => normalized.includes(normalizeText(synonym)))
        );
        return total + (matched ? 1 : 0);
      }, 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  function inferColumnMap(headers) {
    const map = {};
    headers.forEach((header, index) => {
      const normalized = normalizeText(header);
      Object.entries(COLUMN_SYNONYMS).forEach(([key, synonyms]) => {
        if (!map[key] && synonyms.some((synonym) => normalized.includes(normalizeText(synonym)))) {
          map[key] = index;
        }
      });
    });
    return map;
  }

  function normalizeStatus(baseStatus, saldo, dueDate) {
    const normalizedStatus = normalizeText(baseStatus);
    const today = startOfDay(new Date());
    const normalizedDue = dueDate ? startOfDay(dueDate) : null;

    if (normalizedStatus.includes('quit') || normalizedStatus.includes('pago') || normalizedStatus.includes('receb')) {
      return 'quitado';
    }

    if (saldo <= 0) return 'quitado';
    if (normalizedDue && normalizedDue < today) return 'vencido';
    return 'a vencer';
  }

  function startOfDay(date) {
    const cloned = new Date(date);
    cloned.setHours(0, 0, 0, 0);
    return cloned;
  }

  function toRecord(row, columnMap) {
    const value = (key) => (columnMap[key] !== undefined ? row[columnMap[key]] : '');
    const amount = parseBrazilianNumber(value('amount'));
    const paidAmount = parseBrazilianNumber(value('paidAmount'));
    const dueDate = parseDate(value('dueDate'));
    const paymentDate = parseDate(value('paymentDate'));
    const issueDate = parseDate(value('issueDate'));
    const rawStatus = value('status');
    const saldo = Math.max(amount - paidAmount, 0);
    const status = normalizeStatus(rawStatus, saldo, dueDate);

    return {
      client: String(value('client') || 'Sem cliente').trim(),
      document: String(value('document') || '').trim(),
      category: String(value('category') || '').trim(),
      amount,
      paidAmount,
      saldo,
      dueDate: dueDate ? dueDate.toISOString() : '',
      paymentDate: paymentDate ? paymentDate.toISOString() : '',
      issueDate: issueDate ? issueDate.toISOString() : '',
      status,
      rawStatus: String(rawStatus || '').trim(),
      isOverdue: status === 'vencido',
      isUpcoming: status === 'a vencer',
      isSettled: status === 'quitado'
    };
  }

  function buildRecords(sheetRows) {
    const rows = (sheetRows || []).filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim() !== ''));
    if (!rows.length) throw new Error('A planilha selecionada está vazia.');

    const headerRowIndex = guessHeaderRow(rows);
    const headers = rows[headerRowIndex].map((header) => String(header || '').trim());
    const columnMap = inferColumnMap(headers);

    if (columnMap.client === undefined || columnMap.amount === undefined || columnMap.dueDate === undefined) {
      throw new Error('Não foi possível identificar as colunas essenciais (cliente, valor e vencimento).');
    }

    const records = rows
      .slice(headerRowIndex + 1)
      .map((row) => toRecord(row, columnMap))
      .filter((record) => {
        const hasIdentity = record.client && record.client !== 'Sem cliente';
        const hasFinancialData = record.amount > 0 || record.paidAmount > 0 || record.saldo > 0;
        const hasDate = Boolean(record.dueDate);
        return hasIdentity && (hasFinancialData || hasDate);
      });

    if (!records.length) {
      throw new Error('Nenhum registro válido foi encontrado após o processamento da planilha.');
    }

    return { records, columnMap };
  }

  function calculateSummary(records) {
    const today = startOfDay(new Date());
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    return records.reduce(
      (summary, record) => {
        const dueDate = record.dueDate ? startOfDay(new Date(record.dueDate)) : null;
        const paymentDate = record.paymentDate ? new Date(record.paymentDate) : null;

        summary.totalReceber += record.saldo;
        const normalizedStatus = normalizeText(record.status);
        if (normalizedStatus === 'vencido') summary.totalVencido += record.saldo;
        if (normalizedStatus === 'a vencer' || normalizedStatus === 'vence hoje') summary.totalAVencer += record.saldo;

        if (paymentDate && paymentDate.getMonth() === currentMonth && paymentDate.getFullYear() === currentYear) {
          summary.faturamentoMes += record.paidAmount || (record.status === 'quitado' ? record.amount : 0);
        }

        if (paymentDate && paymentDate.getFullYear() === currentYear) {
          summary.faturamentoAno += record.paidAmount || (record.status === 'quitado' ? record.amount : 0);
        }

        if (!paymentDate && dueDate && dueDate.getFullYear() === currentYear && record.status === 'quitado') {
          summary.faturamentoAno += record.amount;
          if (dueDate.getMonth() === currentMonth) summary.faturamentoMes += record.amount;
        }

        return summary;
      },
      {
        totalReceber: 0,
        totalVencido: 0,
        totalAVencer: 0,
        faturamentoMes: 0,
        faturamentoAno: 0
      }
    );
  }

  function aggregateLateClients(records) {
    const grouped = new Map();
    records.filter((record) => normalizeText(record.status) === 'vencido').forEach((record) => {
      const current = grouped.get(record.client) || { client: record.client, count: 0, saldo: 0 };
      current.count += 1;
      current.saldo += record.saldo;
      grouped.set(record.client, current);
    });

    return [...grouped.values()].sort((a, b) => b.saldo - a.saldo).slice(0, 10);
  }

  function upcomingRecords(records) {
    return records
      .filter((record) => ['a vencer', 'vence hoje'].includes(normalizeText(record.status)))
      .sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0))
      .slice(0, 10);
  }

  function saveSession(session) {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.session) || 'null');
    } catch (error) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEYS.session);
  }

  function saveFinanceData(payload) {
    localStorage.setItem(STORAGE_KEYS.financeData, JSON.stringify(payload));
  }

  function getFinanceData() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.financeData) || 'null');
    } catch (error) {
      return null;
    }
  }

  window.FinanceiroUtils = {
    STORAGE_KEYS,
    REQUIRED_SHEET,
    VALID_EXTENSIONS,
    buildRecords,
    calculateSummary,
    aggregateLateClients,
    upcomingRecords,
    escapeHtml,
    formatCurrency,
    formatDateBR,
    formatDateTimeBR,
    getFinanceData,
    getSession,
    normalizeText,
    parseBrazilianNumber,
    parseDate,
    saveFinanceData,
    saveSession,
    clearSession
  };
})();
