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
    legacyBase: 'base_financeira',
    legacyUpdatedAt: 'ultima_atualizacao'
  };

  const COLUMN_ALIASES = {
    cliente: ['cliente', 'sacado', 'razao social', 'razão social', 'nome cliente', 'nome'],
    data: ['data', 'emissao', 'emissão', 'data emissao', 'data emissão', 'competencia', 'competência'],
    vencimento: ['vencimento', 'dt vencimento', 'data vencimento', 'vcto', 'vence'],
    valor: ['valor', 'valor total', 'valor original', 'vlr', 'valor titulo', 'receber', 'total'],
    valorPago: ['valor pago', 'recebido', 'valor recebido', 'pago', 'vl pago', 'pagamento'],
    saldo: ['saldo', 'valor em aberto', 'saldo atual'],
    status: ['status', 'situacao', 'situação']
  };

  let selectedFile = null;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'admin') return;

    const input = document.getElementById('fileInput');
    const processButton = document.getElementById('processButton');

    if (input) {
      input.setAttribute('accept', VALID_EXTENSIONS.join(','));
      input.addEventListener('change', handleFileSelection);
    }

    processButton?.addEventListener('click', processSelectedFile);

    const existingPayload = getFinanceData();
    if (existingPayload) {
      renderPayload(existingPayload);
    }
  });

  function handleFileSelection(event) {
    const input = event.currentTarget;
    selectedFile = input?.files?.[0] || null;
    setText('selectedFileLabel', selectedFile ? selectedFile.name : 'Nenhum arquivo selecionado');
    setMessage(selectedFile ? 'Arquivo selecionado. Clique em Processar para continuar.' : 'Aguardando seleção de arquivo.', 'idle');
  }

  async function processSelectedFile() {
    if (!selectedFile) {
      setMessage('Selecione um arquivo antes de processar.', 'error');
      return;
    }

    const extension = `.${String(selectedFile.name.split('.').pop() || '').toLowerCase()}`;
    if (!VALID_EXTENSIONS.includes(extension)) {
      setMessage('Formato inválido. Envie .xlsx, .xls, .xlsm, .xlsb ou .csv.', 'error');
      return;
    }

    setMessage('Processando arquivo, aguarde...', 'loading');

    try {
      const rows = extension === '.csv' ? await parseCsv(selectedFile) : await parseExcel(selectedFile);
      const records = transformRows(rows);
      const updatedAt = new Date().toISOString();
      const payload = {
        fileName: selectedFile.name,
        updatedAt,
        sourceType: extension === '.csv' ? 'CSV' : 'Excel',
        records,
        summary: calculateSummary(records)
      };

      saveFinanceData(payload);
      localStorage.setItem('financeData', JSON.stringify(payload));
      localStorage.setItem(STORAGE_KEYS.legacyBase, JSON.stringify(records));
      localStorage.setItem(STORAGE_KEYS.legacyUpdatedAt, updatedAt);
      renderPayload(payload);
      setMessage(`✔ ${selectedFile.name} processado com sucesso. Redirecionando para o dashboard...`, 'success');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 700);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Não foi possível processar o arquivo selecionado.', 'error');
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
    const workbook = XLSX.read(text, { type: 'string', raw: false });
    const firstSheet = workbook.SheetNames[0];

    if (!firstSheet) {
      throw new Error('O CSV informado está vazio.');
    }

    return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false
    });
  }

  function transformRows(rows) {
    const validRows = (rows || []).filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim() !== ''));
    if (!validRows.length) {
      throw new Error('Nenhuma linha válida foi encontrada no arquivo.');
    }

    const headers = validRows[0].map((cell) => String(cell || '').trim());
    const columnMap = mapColumns(headers);
    const records = validRows
      .slice(1)
      .map((row) => normalizeRecord(row, columnMap))
      .filter(Boolean);

    if (!records.length) {
      throw new Error('Os dados foram lidos, mas nenhum registro válido foi encontrado.');
    }

    return records;
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

    if (!cliente && !valor && !valorPago && !vencimento) {
      return null;
    }

    const status = resolveStatus(saldo, vencimento);

    return {
      cliente: cliente || 'Sem cliente',
      data: data ? data.toISOString() : '',
      vencimento: vencimento ? vencimento.toISOString() : '',
      valor,
      valorPago,
      saldo,
      status,
      client: cliente || 'Sem cliente',
      issueDate: data ? data.toISOString() : '',
      dueDate: vencimento ? vencimento.toISOString() : '',
      amount: valor,
      paidAmount: valorPago
    };
  }

  function resolveStatus(saldo, vencimento) {
    const today = startOfDay(new Date());
    const dueDate = vencimento ? startOfDay(vencimento) : null;

    if (saldo <= 0) return 'Quitado';
    if (!dueDate) return 'A vencer';
    if (dueDate.getTime() === today.getTime()) return 'Vence hoje';
    if (dueDate < today) return 'Vencido';
    return 'A vencer';
  }

  function startOfDay(date) {
    const current = new Date(date);
    current.setHours(0, 0, 0, 0);
    return current;
  }

  function renderPayload(payload) {
    const previewTableBody = document.getElementById('previewTableBody');
    const metadataList = document.getElementById('metadataList');
    const summary = payload.summary || calculateSummary(payload.records || []);

    setText('fileNameValue', payload.fileName || '-');
    setText('recordsValue', String(payload.records?.length || 0));
    setText('updatedAtValue', formatDateTimeBR(payload.updatedAt));
    setText('selectedFileLabel', payload.fileName || 'Nenhum arquivo selecionado');

    if (metadataList) {
      metadataList.innerHTML = `
        <div><dt>Origem</dt><dd>${escapeHtml(payload.sourceType || '-')}</dd></div>
        <div><dt>Atualização</dt><dd>${formatDateTimeBR(payload.updatedAt)}</dd></div>
        <div><dt>Total de registros</dt><dd>${payload.records?.length || 0}</dd></div>
        <div><dt>Total de valores</dt><dd>${formatCurrency((payload.records || []).reduce((total, item) => total + Number(item.valor || 0), 0))}</dd></div>
        <div><dt>Total em aberto</dt><dd>${formatCurrency(summary.totalReceber)}</dd></div>
      `;
    }

    if (previewTableBody) {
      const previewRows = (payload.records || []).slice(0, 6).map(
        (record) => `
          <tr>
            <td>${escapeHtml(record.cliente)}</td>
            <td>${formatDateBR(record.vencimento)}</td>
            <td>${formatCurrency(record.valor)}</td>
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
