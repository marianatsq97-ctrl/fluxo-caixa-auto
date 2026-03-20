(function () {
  const {
    REQUIRED_SHEET,
    VALID_EXTENSIONS,
    calculateSummary,
    saveFinanceData,
    getFinanceData,
    formatCurrency,
    formatDateBR,
    formatDateTimeBR,
    escapeHtml,
    normalizeText,
    parseBrazilianNumber,
    parseDate
  } = window.FinanceiroUtils;

  const STORAGE_KEYS = {
    rawBase: 'base_financeira',
    updatedAt: 'ultima_atualizacao'
  };

  const COLUMN_ALIASES = {
    cliente: ['cliente', 'sacado', 'razao social', 'razão social', 'nome cliente', 'nome', 'cliente / sacado'],
    data: ['data', 'emissao', 'emissão', 'data emissao', 'data emissão', 'competencia', 'competência'],
    vencimento: ['vencimento', 'dt vencimento', 'data vencimento', 'vcto', 'vence'],
    valor: ['valor', 'valor total', 'valor original', 'vlr', 'valor titulo', 'receber', 'total'],
    valorPago: ['valor pago', 'recebido', 'valor recebido', 'pago', 'vl pago', 'pagamento'],
    saldo: ['saldo', 'valor em aberto', 'saldo atual', 'saldo titulo', 'saldo título'],
    status: ['status', 'situacao', 'situação'],
    documento: ['documento', 'titulo', 'título', 'nf', 'nota', 'numero', 'número', 'pedido']
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'admin') return;

    const input = document.getElementById('fileInput');
    if (input) {
      input.setAttribute('accept', VALID_EXTENSIONS.join(','));
      input.addEventListener('change', handleFileSelection);
    }

    const existingPayload = getFinanceData();
    if (existingPayload) renderPayload(existingPayload);
  });

  async function handleFileSelection(event) {
    const input = event.currentTarget;
    const file = input?.files?.[0];
    if (!file) return;

    const extension = `.${String(file.name.split('.').pop() || '').toLowerCase()}`;
    if (!VALID_EXTENSIONS.includes(extension)) {
      setMessage('Formato inválido. Envie .xlsx, .xls, .xlsm, .xlsb ou .csv.', 'error');
      input.value = '';
      return;
    }

    setMessage('Lendo arquivo e preparando os dados para o dashboard...', 'loading');

    try {
      const rows = extension === '.csv' ? await parseCsv(file) : await parseExcel(file);
      const result = transformRows(rows);
      const updatedAt = new Date().toISOString();
      const payload = {
        fileName: file.name,
        updatedAt,
        sourceType: extension === '.csv' ? 'CSV' : 'Excel',
        columnMap: result.columnMap,
        records: result.records,
        summary: calculateSummary(result.records)
      };

      localStorage.setItem(STORAGE_KEYS.rawBase, JSON.stringify(result.rawRecords));
      localStorage.setItem(STORAGE_KEYS.updatedAt, updatedAt);
      saveFinanceData(payload);
      renderPayload(payload);
      setMessage(`✔ ${file.name} processado com sucesso. ${result.records.length} registros disponíveis.`, 'success');
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Não foi possível processar o arquivo selecionado.', 'error');
    } finally {
      input.value = '';
    }
  }

  async function parseExcel(file) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === normalizeText(REQUIRED_SHEET));

    if (!sheetName) {
      throw new Error("A aba 'Cálculos de Projeção' não foi encontrada");
    }

    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false
    });
  }

  async function parseCsv(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) {
      throw new Error('O CSV informado está vazio.');
    }

    const delimiter = detectDelimiter(lines[0]);
    return lines.map((line) => splitDelimitedLine(line, delimiter));
  }

  function detectDelimiter(firstLine) {
    const candidates = [';', ',', '\t'];
    return candidates
      .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
      .sort((a, b) => b.count - a.count)[0].delimiter;
  }

  function splitDelimitedLine(line, delimiter) {
    const cells = [];
    let current = '';
    let insideQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        const nextCharacter = line[index + 1];
        if (insideQuotes && nextCharacter === '"') {
          current += '"';
          index += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }

      if (character === delimiter && !insideQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }

      current += character;
    }

    cells.push(current.trim());
    return cells;
  }

  function transformRows(rows) {
    const normalizedRows = (rows || []).filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim() !== ''));
    if (!normalizedRows.length) {
      throw new Error('Nenhuma linha válida foi encontrada no arquivo.');
    }

    const headerRowIndex = detectHeaderRow(normalizedRows);
    const headerRow = normalizedRows[headerRowIndex].map((cell) => String(cell || '').trim());
    const columnMap = mapColumns(headerRow);
    const dataRows = normalizedRows.slice(headerRowIndex + 1);

    const rawRecords = [];
    const records = [];

    dataRows.forEach((row) => {
      const record = normalizeRecord(row, columnMap);
      if (!record) return;
      rawRecords.push(record.raw);
      records.push(record.normalized);
    });

    if (!records.length) {
      throw new Error('Os dados foram lidos, mas nenhuma linha válida foi identificada para processamento.');
    }

    return { records, rawRecords, columnMap };
  }

  function detectHeaderRow(rows) {
    const limit = Math.min(rows.length, 10);
    let bestIndex = 0;
    let bestScore = -1;

    for (let index = 0; index < limit; index += 1) {
      const row = rows[index];
      const score = row.reduce((total, cell) => {
        const normalizedCell = normalizeText(cell);
        if (!normalizedCell) return total;
        const matched = Object.values(COLUMN_ALIASES).some((aliases) => aliases.some((alias) => normalizedCell.includes(normalizeText(alias))));
        return total + (matched ? 1 : 0);
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  function mapColumns(headers) {
    const map = {};
    headers.forEach((header, index) => {
      const normalizedHeader = normalizeText(header);
      Object.entries(COLUMN_ALIASES).forEach(([key, aliases]) => {
        if (map[key] !== undefined) return;
        if (aliases.some((alias) => normalizedHeader.includes(normalizeText(alias)))) {
          map[key] = index;
        }
      });
    });
    return map;
  }

  function normalizeRecord(row, columnMap) {
    const getValue = (key) => (columnMap[key] !== undefined ? row[columnMap[key]] : '');

    const cliente = String(getValue('cliente') || '').trim();
    const data = parseDate(getValue('data'));
    const vencimento = parseDate(getValue('vencimento'));
    const valor = parseBrazilianNumber(getValue('valor'));
    const valorPago = parseBrazilianNumber(getValue('valorPago'));
    const saldoInformado = parseBrazilianNumber(getValue('saldo'));
    const saldo = columnMap.saldo !== undefined ? saldoInformado : Number((valor - valorPago).toFixed(2));
    const documento = String(getValue('documento') || '').trim();
    const status = calculateStatus({ saldo, vencimento, statusOriginal: getValue('status') });

    const hasMeaningfulData = cliente || valor || valorPago || saldo || vencimento || documento;
    if (!hasMeaningfulData) return null;

    const raw = {
      cliente: cliente || 'Sem cliente',
      data: data ? data.toISOString() : '',
      vencimento: vencimento ? vencimento.toISOString() : '',
      valor,
      valorPago,
      saldo,
      status
    };

    return {
      raw,
      normalized: {
        cliente: raw.cliente,
        data: raw.data,
        vencimento: raw.vencimento,
        valor: raw.valor,
        valorPago: raw.valorPago,
        saldo: raw.saldo,
        status: raw.status,
        client: raw.cliente,
        issueDate: raw.data,
        dueDate: raw.vencimento,
        amount: raw.valor,
        paidAmount: raw.valorPago,
        saldo: raw.saldo,
        status: raw.status,
        document: documento,
        rawStatus: String(getValue('status') || '').trim()
      }
    };
  }

  function calculateStatus({ saldo, vencimento, statusOriginal }) {
    const today = startOfDay(new Date());
    const dueDate = vencimento ? startOfDay(vencimento) : null;
    const original = normalizeText(statusOriginal);

    if (saldo <= 0) return 'Quitado';
    if (original.includes('quit') || original.includes('pago') || original.includes('receb')) return 'Quitado';
    if (!dueDate) return 'A vencer';
    if (dueDate.getTime() === today.getTime()) return 'Vence hoje';
    if (dueDate < today) return 'Vencido';
    return 'A vencer';
  }

  function startOfDay(date) {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  function renderPayload(payload) {
    const metadataList = document.getElementById('metadataList');
    const previewTableBody = document.getElementById('previewTableBody');
    const summary = payload.summary || calculateSummary(payload.records || []);

    setText('lastFileHint', payload.fileName || 'Última carga');
    setText('fileNameValue', payload.fileName || '-');
    setText('recordsValue', String(payload.records?.length || 0));
    setText('updatedAtValue', formatDateTimeBR(payload.updatedAt));

    if (metadataList) {
      const mappedColumns = Object.keys(payload.columnMap || {}).join(', ') || 'Nenhuma coluna reconhecida';
      metadataList.innerHTML = `
        <div><dt>Origem</dt><dd>${escapeHtml(payload.sourceType || '-')}</dd></div>
        <div><dt>Atualização</dt><dd>${formatDateTimeBR(payload.updatedAt)}</dd></div>
        <div><dt>Colunas mapeadas</dt><dd>${escapeHtml(mappedColumns)}</dd></div>
        <div><dt>Total a receber</dt><dd>${formatCurrency(summary.totalReceber)}</dd></div>
      `;
    }

    if (previewTableBody) {
      const previewRows = (payload.records || []).slice(0, 6).map(
        (record) => `
          <tr>
            <td>${escapeHtml(record.client || record.cliente)}</td>
            <td>${formatDateBR(record.dueDate || record.vencimento)}</td>
            <td>${formatCurrency(record.amount ?? record.valor)}</td>
            <td>${formatCurrency(record.saldo)}</td>
            <td>${renderStatus(record.status)}</td>
          </tr>
        `
      );

      previewTableBody.innerHTML = previewRows.length
        ? previewRows.join('')
        : '<tr><td colspan="5" class="empty-state-cell">Nenhum registro processado.</td></tr>';
    }
  }

  function renderStatus(status) {
    const normalized = normalizeText(status);
    const type = normalized === 'quitado' ? 'success' : normalized === 'vencido' ? 'danger' : 'warning';
    return `<span class="badge badge-${type}">${escapeHtml(status)}</span>`;
  }

  function setMessage(text, status) {
    const message = document.getElementById('processingMessage');
    if (!message) return;
    message.textContent = text;
    message.className = `status-banner is-${status}`;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
})();
