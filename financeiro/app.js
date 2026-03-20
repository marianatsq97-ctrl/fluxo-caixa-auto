diff --git a/financeiro/app.js b/financeiro/app.js
new file mode 100644
index 0000000000000000000000000000000000000000..e19a6c5d272e7f214d9be69910714b2c5f2bf813
--- /dev/null
+++ b/financeiro/app.js
@@ -0,0 +1,166 @@
+(function () {
+  const {
+    getSession,
+    saveSession,
+    clearSession,
+    getFinanceData,
+    calculateSummary,
+    aggregateLateClients,
+    upcomingRecords,
+    formatCurrency,
+    formatDateBR,
+    formatDateTimeBR,
+    escapeHtml
+  } = window.FinanceiroUtils;
+
+  const CREDENTIALS = {
+    admin: { password: 'admin123', role: 'admin', redirect: 'admin.html' },
+    usuario: { password: '123', role: 'usuario', redirect: 'dashboard.html' }
+  };
+
+  document.addEventListener('DOMContentLoaded', () => {
+    const page = document.body.dataset.page;
+
+    if (page === 'login') initLogin();
+    if (page === 'admin') initProtectedPage('admin');
+    if (page === 'dashboard') initDashboard();
+
+    setupLogout();
+  });
+
+  function initLogin() {
+    const session = getSession();
+    if (session?.role === 'admin') window.location.replace('admin.html');
+    if (session?.role === 'usuario') window.location.replace('dashboard.html');
+
+    const form = document.getElementById('loginForm');
+    const message = document.getElementById('loginMessage');
+
+    form?.addEventListener('submit', (event) => {
+      event.preventDefault();
+      const username = String(document.getElementById('username')?.value || '').trim().toLowerCase();
+      const password = String(document.getElementById('password')?.value || '');
+      const credential = CREDENTIALS[username];
+
+      if (!credential || credential.password !== password) {
+        message.textContent = 'Usuário ou senha inválidos.';
+        return;
+      }
+
+      saveSession({ username, role: credential.role, loginAt: new Date().toISOString() });
+      message.textContent = '';
+      window.location.href = credential.redirect;
+    });
+  }
+
+  function initProtectedPage(requiredRole) {
+    const session = ensureAuthorized(requiredRole);
+    const roleTarget = document.getElementById('sessionRole');
+    if (roleTarget && session) roleTarget.textContent = session.role;
+  }
+
+  function initDashboard() {
+    const session = ensureAuthorized();
+    const roleTarget = document.getElementById('dashboardRole');
+    if (roleTarget && session) roleTarget.textContent = session.role;
+
+    const payload = getFinanceData();
+    const detailsTable = document.getElementById('detailsTable');
+    const lateClientsTable = document.getElementById('lateClientsTable');
+    const upcomingTable = document.getElementById('upcomingTable');
+
+    if (!payload?.records?.length) {
+      const emptyRow = '<tr><td colspan="6" class="empty-state-cell">Nenhum dado processado ainda. Acesse o admin para importar uma planilha.</td></tr>';
+      if (detailsTable) detailsTable.innerHTML = emptyRow;
+      if (lateClientsTable) lateClientsTable.innerHTML = '<tr><td colspan="3" class="empty-state-cell">Sem dados.</td></tr>';
+      if (upcomingTable) upcomingTable.innerHTML = '<tr><td colspan="3" class="empty-state-cell">Sem dados.</td></tr>';
+      return;
+    }
+
+    const records = payload.records;
+    const summary = calculateSummary(records);
+
+    setText('dashboardUpdatedAt', formatDateTimeBR(payload.updatedAt));
+    setText('dashboardFileName', payload.fileName || '-');
+    setText('totalReceber', formatCurrency(summary.totalReceber));
+    setText('totalVencido', formatCurrency(summary.totalVencido));
+    setText('totalAVencer', formatCurrency(summary.totalAVencer));
+    setText('faturamentoMes', formatCurrency(summary.faturamentoMes));
+    setText('faturamentoAno', formatCurrency(summary.faturamentoAno));
+
+    renderTable(
+      lateClientsTable,
+      aggregateLateClients(records).map(
+        (entry) => `<tr><td>${escapeHtml(entry.client)}</td><td>${entry.count}</td><td>${formatCurrency(entry.saldo)}</td></tr>`
+      ),
+      3,
+      'Nenhum cliente inadimplente na base atual.'
+    );
+
+    renderTable(
+      upcomingTable,
+      upcomingRecords(records).map(
+        (record) => `<tr><td>${escapeHtml(record.client)}</td><td>${formatDateBR(record.dueDate)}</td><td>${formatCurrency(record.saldo)}</td></tr>`
+      ),
+      3,
+      'Nenhuma conta a vencer encontrada.'
+    );
+
+    const detailRows = records
+      .slice()
+      .sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0))
+      .map(
+        (record) => `
+          <tr>
+            <td>${escapeHtml(record.client)}</td>
+            <td>${escapeHtml(record.document || '-')}</td>
+            <td>${formatDateBR(record.dueDate)}</td>
+            <td>${formatCurrency(record.amount)}</td>
+            <td>${formatCurrency(record.saldo)}</td>
+            <td>${renderStatusBadge(record.status)}</td>
+          </tr>
+        `
+      );
+
+    renderTable(detailsTable, detailRows, 6, 'Nenhum recebível disponível.');
+  }
+
+  function ensureAuthorized(requiredRole) {
+    const session = getSession();
+    if (!session) {
+      window.location.replace('index.html');
+      return null;
+    }
+
+    if (requiredRole === 'admin' && session.role !== 'admin') {
+      window.location.replace('dashboard.html');
+      return null;
+    }
+
+    return session;
+  }
+
+  function setupLogout() {
+    const logoutButton = document.getElementById('logoutButton');
+    logoutButton?.addEventListener('click', () => {
+      clearSession();
+      window.location.href = 'index.html';
+    });
+  }
+
+  function renderTable(target, rows, colspan, emptyMessage) {
+    if (!target) return;
+    target.innerHTML = rows.length ? rows.join('') : `<tr><td colspan="${colspan}" class="empty-state-cell">${emptyMessage}</td></tr>`;
+  }
+
+  function renderStatusBadge(status) {
+    const normalized = String(status || '').toLowerCase();
+    const type = normalized === 'quitado' ? 'success' : normalized === 'vencido' ? 'danger' : 'warning';
+    return `<span class="badge badge-${type}">${escapeHtml(status)}</span>`;
+  }
+
+  function setText(id, value) {
+    const element = document.getElementById(id);
+    if (element) element.textContent = value;
+  }
+})();
