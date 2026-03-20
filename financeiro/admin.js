(function () {
  const {
    REQUIRED_SHEET,
    VALID_EXTENSIONS,
    buildRecords,
    calculateSummary,
    saveFinanceData,
    getFinanceData,
    formatCurrency,
    formatDateBR,
    formatDateTimeBR,
    escapeHtml,
    normalizeText
  } = window.FinanceiroUtils;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'admin') return;

    const input = document.getElementById('fileInput');
    input?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const extension = `.${file.name.split('.').pop().toLowerCase()}`;
      if (!VALID_EXTENSIONS.includes(extension)) {
        setMessage('Formato inválido. Envie .xlsx, .xls, .xlsm, .xlsb ou .csv.', 'error');
        input.value = '';
        return;
      }

      setMessage('Processando arquivo e interpretando dados...', 'loading');

      try {
        const sheetRows = extension === '.csv' ? await parseCsv(file) : await parseExcel(file);
        const { records, columnMap } = buildRecords(sheetRows);
        const updatedAt = new Date().toISOString();
        const payload = {
          fileName: file.name,
          updatedAt,
          sourceType: extension === '.csv' ? 'CSV' : 'Excel',
          summary: calculateSummary(records),
          columnMap,
          records
        };

        saveFinanceData(payload);
        renderPayload(payload);
        setMessage(`Arquivo processado com sucesso: ${records.length} registros prontos para o dashboard.`, 'success');
      } catch (error) {
        console.error(error);
        setMessage(error.message || 'Não foi possível processar a planilha selecionada.', 'error');
      } finally {
        input.value = '';
      }
    });

    const existingPayload = getFinanceData();
    if (existingPayload) renderPayload(existingPayload);
  });

  async function parseExcel(file) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const targetName = workbook.SheetNames.find((name) => normalizeText(name) === normalizeText(REQUIRED_SHEET));

    if (!targetName) {
      throw new Error(`A aba obrigatória "${REQUIRED_SHEET}" não foi encontrada nesta planilha.`);
    }

    return XLSX.utils.sheet_to_json(workbook.Sheets[targetName], {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false
    });
  }

  async function parseCsv(file) {
    const text = await file.text();
    const delimiter = detectDelimiter(text);

    try {
      const workbook = XLSX.read(text, { type: 'string', raw: false, FS: delimiter });
      const firstSheet = workbook.SheetNames[0];

      if (!firstSheet) {
        throw new Error();
      }

      return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false
      });
    } catch (error) {
      const rows = text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, '').trim()));

      if (!rows.length) {
        throw new Error('O CSV informado está vazio ou não pôde ser lido.');
      }

      return rows;
    }
  }

  function detectDelimiter(text) {
    const firstLine = String(text || '').split(/\r?\n/).find((line) => line.trim()) || '';
    const candidates = [';', ',', '\t'];
    return candidates
      .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
      .sort((a, b) => b.count - a.count)[0].delimiter;
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
      const mappedColumns = Object.keys(payload.columnMap || {}).join(', ') || '-';
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
            <td>${escapeHtml(record.client)}</td>
            <td>${formatDateBR(record.dueDate)}</td>
            <td>${formatCurrency(record.amount)}</td>
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
    const normalized = String(status || '').toLowerCase();
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
