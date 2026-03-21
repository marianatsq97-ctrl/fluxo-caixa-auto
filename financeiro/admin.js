(function () {
  const {
    REQUIRED_SHEET,
    VALID_EXTENSIONS,
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
    projecoes: 'tb_projecoes',
    receber: 'tb_a_receber',
    inadimplentes: 'tb_inadimplentes',
    financeData: 'financeData'
  };

  const PROJECOES_COLUMNS = {
    periodo: ['periodo', 'período', 'mes', 'mês', 'competencia', 'competência'],
    unidade: ['unidade', 'filial', 'regional', 'empresa'],
    unidade_medida: ['unidade medida', 'unidade de medida', 'medida', 'u.m.', 'um'],
    volume_realizado: ['volume realizado', 'vol realizado', 'realizado volume'],
    volume_medio: ['volume medio', 'volume médio', 'vol medio', 'vol médio'],
    volume_projetado: ['volume projetado', 'vol projetado', 'projetado volume'],
    faturamento_realizado: ['faturamento realizado', 'fat realizado', 'realizado faturamento'],
    faturamento_medio: ['faturamento medio', 'faturamento médio', 'fat medio', 'fat médio'],
    faturamento_projetado: ['faturamento projetado', 'fat projetado', 'projetado faturamento']
  };

  const RECEBER_COLUMNS = {
    cliente: ['cliente', 'sacado', 'razao social', 'razão social', 'nome cliente'],
    documento: ['documento', 'titulo', 'título', 'nota', 'nf', 'numero', 'número'],
    emissao: ['data', 'emissao', 'emissão', 'data emissao', 'data emissão'],
    vencimento: ['vencimento', 'dt vencimento', 'data vencimento', 'vcto', 'vence'],
    valor: ['valor', 'valor total', 'valor original', 'vlr', 'receber', 'total'],
    valor_pago: ['valor pago', 'recebido', 'pago', 'valor recebido'],
    saldo: ['saldo', 'valor em aberto', 'saldo atual'],
    unidade: ['unidade', 'filial', 'regional', 'empresa'],
    portador: ['portador', 'carteira', 'banco', 'cobrador']
  };

  let selectedFiles = [];

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'admin') return;

    const input = document.getElementById('fileInput');
    const processButton = document.getElementById('processButton');

    input?.setAttribute('accept', [...VALID_EXTENSIONS, '.eb', '.txt'].join(','));
    input?.addEventListener('change', handleFileSelection);
    processButton?.addEventListener('click', processSelectedFiles);

    const existingData = getFinanceData();
    if (existingData?.tables) {
      renderPayload(existingData);
    }
  });

  function handleFileSelection(event) {
    selectedFiles = Array.from(event.currentTarget?.files || []);
    setText('selectedFileLabel', selectedFiles.length ? selectedFiles.map((file) => file.name).join(' • ') : 'Nenhum arquivo selecionado');
    setMessage(selectedFiles.length ? 'Arquivos prontos para processamento.' : 'Selecione os arquivos das bases.', 'idle');
  }

  async function processSelectedFiles() {
    if (!selectedFiles.length) {
      setMessage('Selecione ao menos um arquivo para processar.', 'error');
      return;
    }

    setMessage('Lendo planilhas e consolidando bases...', 'loading');

    try {
      const tables = {
        tb_projecoes: [],
        tb_a_receber: [],
        tb_inadimplentes: []
      };
      const processedFiles = [];

      for (const file of selectedFiles) {
        const source = await readSource(file);
        const datasetType = detectDataset(file, source);
        processedFiles.push({ name: file.name, datasetType });

        if (datasetType === 'projecoes') {
          tables.tb_projecoes.push(...parseProjecoes(source, file));
        } else if (datasetType === 'receber') {
          tables.tb_a_receber.push(...parseReceber(source, file));
        } else if (datasetType === 'inadimplentes') {
          tables.tb_inadimplentes.push(...parseInadimplentes(source, file));
        }
      }

      tables.tb_projecoes = dedupeBy(tables.tb_projecoes, (row) => `${row.periodo}|${row.unidade}`);
      tables.tb_a_receber = dedupeBy(tables.tb_a_receber, (row) => `${row.cliente}|${row.documento}|${row.vencimento}|${row.saldo}`)
        .filter((row) => row.saldo > 0 && row.dias_para_vencer >= 0)
        .sort((a, b) => a.dias_para_vencer - b.dias_para_vencer);
      tables.tb_inadimplentes = dedupeBy(tables.tb_inadimplentes, (row) => `${row.cliente}|${row.documento}|${row.vencimento}|${row.saldo}`)
        .filter((row) => row.saldo > 0 && row.dias_em_atraso > 0)
        .sort((a, b) => b.dias_em_atraso - a.dias_em_atraso);

      const payload = {
        updatedAt: new Date().toISOString(),
        processedFiles,
        tables
      };

      saveTables(payload);
      renderPayload(payload);
      setMessage('Bases consolidadas com sucesso. Redirecionando para o dashboard...', 'success');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 900);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Falha ao processar as bases enviadas.', 'error');
    }
  }

  async function readSource(file) {
    const extension = getExtension(file.name);
    const isExcel = ['.xlsx', '.xls', '.xlsm', '.xlsb'].includes(extension);
    if (isExcel) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      return { kind: 'excel', workbook, fileName: file.name };
    }

    const text = await file.text();
    return { kind: 'text', text, fileName: file.name };
  }


  function getExtension(fileName) {
    const lastDot = String(fileName || '').lastIndexOf('.');
    return lastDot >= 0 ? String(fileName).slice(lastDot).toLowerCase() : '';
  }

  function detectDataset(file, source) {
    const normalizedName = normalizeText(file.name);
    if (normalizedName.includes('receber')) return 'receber';
    if (normalizedName.includes('vencid') || normalizedName.includes('inadimpl')) return 'inadimplentes';
    if (normalizedName.includes('projec') || normalizedName.includes('fatur')) return 'projecoes';
    if (source.kind === 'excel' && findProjectionSheetName(source.workbook)) return 'projecoes';
    return 'receber';
  }

  function parseProjecoes(source) {
    if (source.kind !== 'excel') {
      throw new Error('A base de projeções precisa ser enviada em formato Excel.');
    }

    const sheetName = findProjectionSheetName(source.workbook);
    if (!sheetName) {
      throw new Error("A aba 'Cálculos de Projeção' não foi encontrada");
    }

    const rows = sheetToRows(source.workbook.Sheets[sheetName]);
    const tableStartIndex = findRowIndex(rows, 'volumes e faturamento');
    const scopedRows = tableStartIndex >= 0 ? rows.slice(tableStartIndex + 1) : rows;
    const headerIndex = detectHeaderRow(scopedRows, PROJECOES_COLUMNS, 12);
    const headers = scopedRows[headerIndex] || [];
    const map = mapColumns(headers, PROJECOES_COLUMNS);

    return scopedRows
      .slice(headerIndex + 1)
      .map((row) => ({
        periodo: String(valueAt(row, map.periodo) || '').trim(),
        unidade: String(valueAt(row, map.unidade) || '').trim(),
        unidade_medida: String(valueAt(row, map.unidade_medida) || '').trim(),
        volume_realizado: parseBrazilianNumber(valueAt(row, map.volume_realizado)),
        volume_medio: parseBrazilianNumber(valueAt(row, map.volume_medio)),
        volume_projetado: parseBrazilianNumber(valueAt(row, map.volume_projetado)),
        faturamento_realizado: parseBrazilianNumber(valueAt(row, map.faturamento_realizado)),
        faturamento_medio: parseBrazilianNumber(valueAt(row, map.faturamento_medio)),
        faturamento_projetado: parseBrazilianNumber(valueAt(row, map.faturamento_projetado))
      }))
      .filter((row) => row.periodo || row.unidade || hasNumericValues(row));
  }

  function parseReceber(source, file) {
    const rows = getRowsFromSource(source);
    const headerIndex = detectHeaderRow(rows, RECEBER_COLUMNS, 15);
    const headers = rows[headerIndex] || [];
    const map = mapColumns(headers, RECEBER_COLUMNS);
    const today = startOfDay(new Date());
    const origin = normalizeText(file.name).includes('topcon') ? 'TOPCON' : 'TOPGERENTE';

    return rows
      .slice(headerIndex + 1)
      .map((row) => normalizeFinancialRow(row, map, origin))
      .filter(Boolean)
      .map((row) => {
        const dias = calculateDays(row.vencimento, today);
        return {
          ...row,
          dias_para_vencer: dias,
          classificacao_vencimento: classifyUpcoming(dias)
        };
      })
      .filter((row) => row.dias_para_vencer >= 0);
  }

  function parseInadimplentes(source, file) {
    const rows = getRowsFromSource(source);
    const normalizedName = normalizeText(file.name);
    const today = startOfDay(new Date());

    const records = normalizedName.includes('topcon')
      ? parseTopconBlocks(rows)
      : parseStructuredInadimplentes(rows, normalizedName.includes('topgerente') ? 'TOPGERENTE' : 'TOPCON');

    return records
      .map((row) => {
        const dias = Math.max(calculateDays(today, row.vencimento), 0);
        return {
          ...row,
          dias_em_atraso: dias,
          faixa_atraso: classifyDelay(dias)
        };
      })
      .filter((row) => row.dias_em_atraso > 0);
  }

  function parseStructuredInadimplentes(rows, origin) {
    const headerIndex = detectHeaderRow(rows, RECEBER_COLUMNS, 15);
    const map = mapColumns(rows[headerIndex] || [], RECEBER_COLUMNS);
    return rows
      .slice(headerIndex + 1)
      .map((row) => normalizeFinancialRow(row, map, origin))
      .filter(Boolean)
      .filter((row) => row.saldo > 0 && row.vencimento);
  }

  function parseTopconBlocks(rows) {
    const records = [];
    let currentClient = '';

    rows.forEach((row) => {
      const values = row.map((cell) => String(cell || '').trim()).filter(Boolean);
      if (!values.length || isSeparatorRow(values)) return;

      if (isLikelyClientHeader(values)) {
        currentClient = values.join(' ').trim();
        return;
      }

      const record = normalizeLooseRow(values, currentClient, 'TOPCON');
      if (record) records.push(record);
    });

    return records;
  }

  function normalizeFinancialRow(row, map, origin) {
    const cliente = String(valueAt(row, map.cliente) || '').trim();
    const documento = String(valueAt(row, map.documento) || '').trim();
    const emissao = parseDate(valueAt(row, map.emissao));
    const vencimento = parseDate(valueAt(row, map.vencimento));
    const valor = Math.abs(parseBrazilianNumber(valueAt(row, map.valor)));
    const valorPago = Math.abs(parseBrazilianNumber(valueAt(row, map.valor_pago)));
    const saldoInformado = Math.abs(parseBrazilianNumber(valueAt(row, map.saldo)));
    const saldo = map.saldo !== undefined ? saldoInformado : Math.max(valor - valorPago, 0);
    const unidade = String(valueAt(row, map.unidade) || origin).trim() || origin;
    const portador = String(valueAt(row, map.portador) || unidade || origin).trim() || origin;

    if (!cliente && !documento && !vencimento && !valor && !saldo) {
      return null;
    }

    return {
      cliente: cliente || 'Sem cliente',
      documento: documento || '-',
      emissao: emissao ? emissao.toISOString() : '',
      vencimento: vencimento ? vencimento.toISOString() : '',
      valor,
      valor_pago: valorPago,
      saldo,
      origem: origin,
      unidade,
      portador
    };
  }

  function normalizeLooseRow(values, currentClient, origin) {
    if (!currentClient) return null;
    const dates = values.map(parseDate).filter(Boolean);
    const numerics = values.map(parseBrazilianNumber).filter((value) => value > 0);
    if (!dates.length || !numerics.length) return null;

    const dueDate = dates[dates.length - 1];
    const amount = Math.max(...numerics.map(Math.abs));
    const document = values.find((value) => /\d/.test(value) && !parseDate(value)) || '-';

    return {
      cliente: currentClient,
      documento: String(document).trim() || '-',
      emissao: '',
      vencimento: dueDate.toISOString(),
      valor: amount,
      valor_pago: 0,
      saldo: amount,
      origem: origin,
      unidade: origin,
      portador: origin
    };
  }

  function getRowsFromSource(source) {
    if (source.kind === 'excel') {
      const sheetName = source.workbook.SheetNames[0];
      return sheetToRows(source.workbook.Sheets[sheetName]);
    }
    return textToRows(source.text);
  }

  function findProjectionSheetName(workbook) {
    const exact = workbook.SheetNames.find((name) => normalizeText(name) === normalizeText(REQUIRED_SHEET));
    if (exact) return exact;

    return workbook.SheetNames.find((name) => {
      const rows = sheetToRows(workbook.Sheets[name]).slice(0, 20);
      return rows.some((row) => row.some((cell) => normalizeText(cell).includes('volumes e faturamento')));
    });
  }

  function sheetToRows(sheet) {
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false
    });
  }

  function textToRows(text) {
    const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];
    const delimiter = detectDelimiter(lines[0]);
    return lines.map((line) => splitQuotedLine(line, delimiter));
  }

  function detectDelimiter(line) {
    const candidates = [';', '\t', ',', '|'];
    return candidates
      .map((delimiter) => ({ delimiter, score: line.split(delimiter).length }))
      .sort((a, b) => b.score - a.score)[0].delimiter;
  }

  function splitQuotedLine(line, delimiter) {
    const cells = [];
    let current = '';
    let insideQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        insideQuotes = !insideQuotes;
        continue;
      }
      if (char === delimiter && !insideQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  }

  function detectHeaderRow(rows, aliases, maxScan) {
    const limit = Math.min(rows.length, maxScan || 10);
    let bestIndex = 0;
    let bestScore = -1;
    for (let index = 0; index < limit; index += 1) {
      const row = rows[index] || [];
      const score = row.reduce((total, cell) => {
        const normalizedCell = normalizeText(cell);
        if (!normalizedCell) return total;
        const matched = Object.values(aliases).some((items) => items.some((item) => normalizedCell.includes(normalizeText(item))));
        return total + (matched ? 1 : 0);
      }, 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  function mapColumns(headers, aliases) {
    const map = {};
    headers.forEach((header, index) => {
      const normalizedHeader = normalizeText(header);
      Object.entries(aliases).forEach(([key, items]) => {
        if (map[key] !== undefined) return;
        if (items.some((item) => normalizedHeader.includes(normalizeText(item)))) {
          map[key] = index;
        }
      });
    });
    return map;
  }

  function renderPayload(payload) {
    const { tb_projecoes, tb_a_receber, tb_inadimplentes } = payload.tables;
    setText('fileNameValue', String(payload.processedFiles.length));
    setText('projecoesValue', String(tb_projecoes.length));
    setText('receberValue', String(tb_a_receber.length));
    setText('inadimplentesValue', String(tb_inadimplentes.length));
    setText('updatedAtValue', `Atualizado em ${formatDateTimeBR(payload.updatedAt)}`);
    setText('previewTitle', 'Amostra da tabela consolidada mais relevante');

    const fileListPreview = document.getElementById('fileListPreview');
    if (fileListPreview) {
      fileListPreview.innerHTML = payload.processedFiles
        .map((file) => `<span class="chip">${escapeHtml(file.name)} → ${escapeHtml(file.datasetType)}</span>`)
        .join('');
    }

    const metadataList = document.getElementById('metadataList');
    if (metadataList) {
      metadataList.innerHTML = `
        <div><dt>Status</dt><dd>Consolidação concluída</dd></div>
        <div><dt>Arquivos</dt><dd>${payload.processedFiles.length}</dd></div>
        <div><dt>tb_projecoes</dt><dd>${tb_projecoes.length} registros</dd></div>
        <div><dt>tb_a_receber</dt><dd>${tb_a_receber.length} registros</dd></div>
        <div><dt>tb_inadimplentes</dt><dd>${tb_inadimplentes.length} registros</dd></div>
      `;
    }

    const previewHeaders = document.getElementById('previewTableHead');
    const previewBody = document.getElementById('previewTableBody');
    const previewDataset = tb_inadimplentes.length ? { title: 'tb_inadimplentes', rows: tb_inadimplentes } : tb_a_receber.length ? { title: 'tb_a_receber', rows: tb_a_receber } : { title: 'tb_projecoes', rows: tb_projecoes };
    const previewRows = previewDataset.rows.slice(0, 6);

    if (!previewRows.length) {
      previewHeaders.innerHTML = '<tr><th>Sem dados</th></tr>';
      previewBody.innerHTML = '<tr><td class="empty-state-cell">Nenhum dado consolidado.</td></tr>';
      return;
    }

    const columns = Object.keys(previewRows[0]);
    previewHeaders.innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>`;
    previewBody.innerHTML = previewRows
      .map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatValue(row[column]))}</td>`).join('')}</tr>`)
      .join('');
  }

  function saveTables(payload) {
    localStorage.setItem(STORAGE_KEYS.projecoes, JSON.stringify(payload.tables.tb_projecoes));
    localStorage.setItem(STORAGE_KEYS.receber, JSON.stringify(payload.tables.tb_a_receber));
    localStorage.setItem(STORAGE_KEYS.inadimplentes, JSON.stringify(payload.tables.tb_inadimplentes));
    localStorage.setItem(STORAGE_KEYS.financeData, JSON.stringify(payload));
    saveFinanceData(payload);
  }

  function classifyUpcoming(days) {
    if (days <= 3) return 'urgente';
    if (days <= 7) return 'atenção';
    if (days <= 15) return 'normal';
    return 'futuro';
  }

  function classifyDelay(days) {
    if (days <= 15) return 'leve';
    if (days <= 30) return 'moderado';
    if (days <= 60) return 'grave';
    return 'crítico';
  }

  function calculateDays(dateValue, baseDate) {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
    if (!date || Number.isNaN(date.getTime())) return 0;
    return Math.round((startOfDay(date) - startOfDay(baseDate)) / 86400000);
  }

  function startOfDay(date) {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  function findRowIndex(rows, keyword) {
    return rows.findIndex((row) => row.some((cell) => normalizeText(cell).includes(normalizeText(keyword))));
  }

  function valueAt(row, index) {
    return index === undefined ? '' : row[index];
  }

  function hasNumericValues(row) {
    return Object.values(row).some((value) => typeof value === 'number' && value > 0);
  }

  function isSeparatorRow(values) {
    return values.every((value) => /^[-_=]+$/.test(value));
  }

  function isLikelyClientHeader(values) {
    if (values.length > 2) return false;
    const text = values.join(' ').trim();
    return Boolean(text) && !parseDate(text) && parseBrazilianNumber(text) === 0;
  }

  function dedupeBy(rows, getKey) {
    const map = new Map();
    rows.forEach((row) => {
      map.set(getKey(row), row);
    });
    return [...map.values()];
  }

  function formatValue(value) {
    if (typeof value === 'number') return value.toLocaleString('pt-BR');
    if (String(value).includes('T') && !Number.isNaN(Date.parse(value))) return formatDateBR(value);
    return value ?? '-';
  }

  function setMessage(text, status) {
    const element = document.getElementById('processingMessage');
    if (!element) return;
    element.textContent = text;
    element.className = `status-banner is-${status}`;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
})();
