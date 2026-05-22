/* ===== CLOUD CONFIGURATION ===== */
// Nhập đường dẫn link Web App của Google Apps Script của bạn vào đây (sau khi deploy)
// Ví dụ: const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzhT9Uf9uPbCHjWTuR17cf_YT9U9gsvFg3casxvEBESg2BqxhuoyolxTRsqNhIVxEE/exec';


/* ===== DATA & STATE ===== */
const DEFAULT_USERS = [
  { username: 'admin', password: 'admin123', role: 'admin', label: 'Quản trị viên' },
  { username: 'accountant', password: 'accountant123', role: 'accountant', label: 'Kế toán', permissions: 'view,add,edit,approve,cats,reports,advances_edit,debts_edit' },
  { username: 'treasurer', password: 'treasurer123', role: 'treasurer', label: 'Thủ quỹ', permissions: 'view,advances_pay,debts_pay' },
  { username: 'staff', password: 'staff123', role: 'staff', label: 'Nhân viên', permissions: 'view_self_advances,advances_submit' },
  { username: 'audit', password: 'audit123', role: 'audit', label: 'Ban kiểm soát', permissions: 'view,approve' },
  { username: 'viewer', password: 'viewer123', role: 'viewer', label: 'Chỉ xem' }
];

/* Categories are now managed dynamically via data.js getCategories() */

let state = {
  currentUser: null,
  entries: [],
  users: [],
  advances: [],
  debts: [],
  auditLogs: [],
  chartMonthly: null,
  chartRatio: null,
  chartReport: null,
  editingId: null,
  selectedInvoice: '',
  selectedInvoiceFile: null,
  selectedSetInvoice: ''
};

let dbIndex = { byType: { thu: [], chi: [] }, byCategory: {}, byId: {} };

/* ===== HELPERS ===== */
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const formatThousand = val => (val || val === 0) ? new Intl.NumberFormat('vi-VN').format(val) : '';

/* ===== CLOUD SYNC HELPERS ===== */
window.sendToCloud = async function (payload) {
  if (!SCRIPT_URL || !SCRIPT_URL.startsWith('http')) return;
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain' }
    });
    const data = await res.json();
    if (!data.success) {
      console.error("Cloud action failed:", data.error);
    } else {
      if (data.driveError) {
        toast("Giao dịch đã lưu, nhưng chứng từ lưu Drive thất bại do lỗi phân quyền Apps Script!", "error");
      }
      if (data.invoiceUrl && payload.entry) {
        const entryId = payload.entry.id;
        const idx = state.entries.findIndex(e => e.id === entryId);
        if (idx !== -1) {
          state.entries[idx].invoice = data.invoiceUrl;
          saveData();
          updateJournalView();
        }
      }
    }
  } catch (err) {
    console.error("Failed to send data to cloud:", err);
    toast("Đồng bộ đám mây thất bại! Dữ liệu đã lưu tạm thời ở máy bạn.", "error");
  }
};

async function loadData() {
  const loadingId = 'cloudLoading';
  let loadingEl = $(loadingId);
  if (!loadingEl && SCRIPT_URL && SCRIPT_URL.startsWith('http')) {
    loadingEl = document.createElement('div');
    loadingEl.id = loadingId;
    loadingEl.innerHTML = '<div style="position:fixed;bottom:15px;right:15px;background:rgba(20,20,30,0.9);color:#38ef7d;padding:12px 20px;border-radius:30px;font-size:0.82rem;box-shadow:0 4px 15px rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;gap:8px;border:1px solid rgba(56,239,125,0.2);font-family:Inter,sans-serif;"><i class="fas fa-sync-alt fa-spin"></i> Đang tải dữ liệu đám mây...</div>';
    document.body.appendChild(loadingEl);
  }

  try {
    if (SCRIPT_URL && SCRIPT_URL.startsWith('http')) {
      const res = await fetch(SCRIPT_URL);
      const data = await res.json();

      const serverEntries = data.entries || [];
      const localEntries = JSON.parse(localStorage.getItem('tc_entries') || '[]');

      // Thuật toán gộp thông minh (Smart Merge):
      // 1. Bảo vệ các giao dịch mới tạo ở local chưa kịp đồng bộ lên Cloud để tránh mất dữ liệu khi F5
      // 2. Bảo vệ hóa đơn cục bộ (dạng base64) không bị ghi đè bởi cột rỗng từ server
      const mergedEntries = [...serverEntries];
      localEntries.forEach(le => {
        const se = serverEntries.find(x => x.id === le.id);
        if (!se) {
          mergedEntries.push(le);
        } else if (le.invoice && le.invoice.startsWith('data:') && !se.invoice) {
          const idx = mergedEntries.findIndex(x => x.id === se.id);
          if (idx !== -1) {
            mergedEntries[idx] = { ...se, invoice: le.invoice };
          }
        }
      });
      state.entries = mergedEntries;

      state.users = data.users || [...DEFAULT_USERS];
      if (data.categories) saveCategories(data.categories);

      localStorage.setItem('tc_users', JSON.stringify(state.users));
      localStorage.setItem('tc_entries', JSON.stringify(state.entries));
    } else {
      state.users = JSON.parse(localStorage.getItem('tc_users') || 'null') || [...DEFAULT_USERS];
      state.entries = JSON.parse(localStorage.getItem('tc_entries') || '[]');
    }
  } catch (err) {
    console.warn("Cloud load failed, using local storage:", err);
    state.users = JSON.parse(localStorage.getItem('tc_users') || 'null') || [...DEFAULT_USERS];
    state.entries = JSON.parse(localStorage.getItem('tc_entries') || '[]');
  } finally {
    if (loadingEl) loadingEl.remove();
    // Load local extensions
    state.advances = JSON.parse(localStorage.getItem('tc_advances') || '[]');
    state.debts = JSON.parse(localStorage.getItem('tc_debts') || '[]');
    state.auditLogs = JSON.parse(localStorage.getItem('tc_audit_logs') || '[]');
    rebuildIndexes();
  }
}

function saveData() {
  localStorage.setItem('tc_users', JSON.stringify(state.users));
  localStorage.setItem('tc_entries', JSON.stringify(state.entries));
  localStorage.setItem('tc_advances', JSON.stringify(state.advances));
  localStorage.setItem('tc_debts', JSON.stringify(state.debts));
  localStorage.setItem('tc_audit_logs', JSON.stringify(state.auditLogs));
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: 'check-circle', error: 'exclamation-circle', info: 'info-circle' };
  el.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i> ${msg}`;
  $('toastContainer').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; setTimeout(() => el.remove(), 400); }, 3000);
}

function isAdmin() { return state.currentUser && state.currentUser.role === 'admin'; }

function hasPermission(perm) {
  if (!state.currentUser) return false;
  if (state.currentUser.role === 'admin') return true;

  // Kiểm tra phân quyền chi tiết của người dùng
  if (state.currentUser.permissions) {
    const perms = typeof state.currentUser.permissions === 'string'
      ? state.currentUser.permissions.split(',')
      : state.currentUser.permissions;
    return perms.includes(perm);
  }

  // Phân quyền mặc định nếu chưa được tùy chỉnh chi tiết
  if (state.currentUser.role === 'audit') {
    return ['view', 'approve'].includes(perm);
  }
  if (state.currentUser.role === 'editor') {
    return ['view', 'add', 'edit', 'invoice', 'cats'].includes(perm);
  }
  if (state.currentUser.role === 'accountant') {
    return ['view', 'add', 'edit', 'approve', 'cats', 'reports', 'advances_edit', 'debts_edit'].includes(perm);
  }
  if (state.currentUser.role === 'treasurer') {
    return ['view', 'advances_pay', 'debts_pay'].includes(perm);
  }
  if (state.currentUser.role === 'staff') {
    return ['view_self_advances', 'advances_submit'].includes(perm);
  }
  if (state.currentUser.role === 'viewer') {
    return ['view'].includes(perm);
  }
  return false;
}

/* ===== INDEXING & AUDIT TRAIL ===== */
function rebuildIndexes() {
  dbIndex = { byType: { thu: [], chi: [] }, byCategory: {}, byId: {} };
  state.entries.forEach(e => {
    if (e.type === 'thu' || e.type === 'chi') {
      dbIndex.byType[e.type].push(e);
    }
    if (!dbIndex.byCategory[e.category]) {
      dbIndex.byCategory[e.category] = [];
    }
    dbIndex.byCategory[e.category].push(e);
    dbIndex.byId[e.id] = e;
  });
}

function writeAuditLog(action, details) {
  if (!state.currentUser) return;
  const newLog = {
    timestamp: new Date().toISOString(),
    username: state.currentUser.username,
    role: state.currentUser.label,
    action,
    details
  };
  state.auditLogs.unshift(newLog);
  if (state.auditLogs.length > 1000) state.auditLogs.pop();
  saveData();
  
  if ($('pageAudit') && $('pageAudit').classList.contains('active')) {
    renderAuditLogs();
  }
}

function renderAuditLogs() {
  const tbody = $('auditLogsTable');
  if (!tbody) return;
  
  tbody.innerHTML = state.auditLogs.map(log => {
    const formattedTime = new Date(log.timestamp).toLocaleString('vi-VN');
    return `
      <tr>
        <td style="white-space:nowrap;font-size:0.8rem;color:var(--text2)">${formattedTime}</td>
        <td><strong>${log.username}</strong></td>
        <td><span class="badge" style="background:rgba(102,126,234,.2);color:var(--primary);font-size:0.75rem">${log.role}</span></td>
        <td><span class="badge" style="background:rgba(255,255,255,0.05);color:var(--text);font-size:0.75rem">${log.action}</span></td>
        <td style="font-size:0.85rem;line-height:1.4">${log.details}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:30px">Chưa có lịch sử thao tác nào</td></tr>';
}

/* ===== AUTH ===== */
function initLogin() {
  $('btnLogin').addEventListener('click', () => {
    const u = $('loginUser').value.trim();
    const p = $('loginPass').value;
    const user = state.users.find(x => x.username === u && x.password === p);
    if (!user) { $('loginError').textContent = 'Sai tên đăng nhập hoặc mật khẩu!'; return; }
    state.currentUser = user;
    $('loginScreen').classList.add('hidden');
    $('mainApp').classList.remove('hidden');
    onLogin();
  });
  $('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLogin').click(); });

  const toggleBtn = $('btnToggleLoginPass');
  const passInput = $('loginPass');
  if (toggleBtn && passInput) {
    toggleBtn.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      toggleBtn.innerHTML = isPass ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
      toggleBtn.title = isPass ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu';
    });
  }
}

function onLogin() {
  $('currentUserName').textContent = state.currentUser.username;
  $('currentUserRole').textContent = state.currentUser.label;

  // Hiển thị các mục menu bên dựa vào phân quyền chi tiết
  configureNavigationForRole();

  $('todayDate').textContent = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  // Ghi nhận nhật ký audit
  writeAuditLog('Đăng nhập', `Đăng nhập thành công vào hệ thống với vai trò ${state.currentUser.label}`);
  
  renderDashboard();
  updateJournalView();
}

$('btnLogout').addEventListener('click', () => {
  writeAuditLog('Đăng xuất', 'Đăng xuất khỏi hệ thống');
  state.currentUser = null;
  $('mainApp').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('loginUser').value = '';
  $('loginPass').value = '';
  $('loginError').textContent = '';
});

/* ===== NAVIGATION ===== */
const pageTitles = {
  dashboard: 'Tổng quan',
  journal: 'Nhật Ký Chung',
  advances: 'Quản Lý Tạm & Hoàn Ứng',
  debts: 'Quản Lý Công Nợ',
  categories: 'Quản Lý Danh Mục',
  reports: 'Báo Cáo Tài Chính & P&L',
  audit: 'Nhật Ký Kiểm Toán (Audit Trail)',
  settings: 'Cài Đặt Hệ Thống'
};

function configureNavigationForRole() {
  if (!state.currentUser) return;
  const role = state.currentUser.role;
  
  const getMenuItem = (page) => document.querySelector(`.sidebar-menu li[data-page="${page}"]`);
  
  const menuDashboard = getMenuItem('dashboard');
  const menuJournal = getMenuItem('journal');
  const menuAdvances = $('menuAdvances');
  const menuDebts = $('menuDebts');
  const menuCategories = $('menuCategories');
  const menuReports = getMenuItem('reports');
  const menuAudit = $('menuAudit');
  const menuSettings = $('menuSettings');
  
  [menuDashboard, menuJournal, menuAdvances, menuDebts, menuCategories, menuReports, menuAudit, menuSettings].forEach(m => {
    if (m) m.classList.remove('hidden');
  });

  if (role === 'staff') {
    if (menuJournal) menuJournal.classList.add('hidden');
    if (menuDebts) menuDebts.classList.add('hidden');
    if (menuCategories) menuCategories.classList.add('hidden');
    if (menuReports) menuReports.classList.add('hidden');
    if (menuSettings) menuSettings.classList.add('hidden');
    if (menuAudit) menuAudit.classList.add('hidden');
    
    const activeLi = document.querySelector('.sidebar-menu li.active');
    if (activeLi && ['journal', 'debts', 'categories', 'reports', 'settings', 'audit'].includes(activeLi.dataset.page)) {
      if (menuDashboard) menuDashboard.click();
    }
  } else if (role === 'treasurer') {
    if (menuCategories) menuCategories.classList.add('hidden');
    if (menuReports) menuReports.classList.add('hidden');
    if (menuSettings) menuSettings.classList.add('hidden');
    if (menuAudit) menuAudit.classList.add('hidden');
    
    const activeLi = document.querySelector('.sidebar-menu li.active');
    if (activeLi && ['categories', 'reports', 'settings', 'audit'].includes(activeLi.dataset.page)) {
      if (menuJournal) menuJournal.click();
    }
  } else if (role === 'accountant') {
    if (menuSettings) menuSettings.classList.add('hidden');
    if (menuAudit) menuAudit.classList.add('hidden');
    
    const activeLi = document.querySelector('.sidebar-menu li.active');
    if (activeLi && ['settings', 'audit'].includes(activeLi.dataset.page)) {
      if (menuDashboard) menuDashboard.click();
    }
  } else if (role === 'audit') {
    if (menuSettings) menuSettings.classList.add('hidden');
  }
}

document.querySelectorAll('.sidebar-menu li').forEach(li => {
  li.addEventListener('click', () => {
    const page = li.dataset.page;
    document.querySelectorAll('.sidebar-menu li').forEach(x => x.classList.remove('active'));
    li.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    $('page' + page.charAt(0).toUpperCase() + page.slice(1)).classList.add('active');
    $('pageTitle').textContent = pageTitles[page] || '';
    
    if (page === 'dashboard') renderDashboard();
    if (page === 'journal') updateJournalView();
    if (page === 'advances') renderAdvances();
    if (page === 'debts') renderDebts();
    if (page === 'categories') renderCategoryPage();
    if (page === 'reports') initReportPage();
    if (page === 'audit') renderAuditLogs();
    if (page === 'settings') renderSettings();
    
    // Close mobile sidebar and hide overlay
    document.querySelector('.sidebar').classList.remove('mobile-open');
    const overlay = $('sidebarOverlay');
    if (overlay) overlay.classList.remove('active');
  });
});

$('btnToggleSidebar').addEventListener('click', () => {
  const sb = document.querySelector('.sidebar');
  const overlay = $('sidebarOverlay');
  if (window.innerWidth <= 768) {
    const isOpen = sb.classList.toggle('mobile-open');
    if (isOpen && overlay) overlay.classList.add('active');
    else if (overlay) overlay.classList.remove('active');
  } else {
    sb.classList.toggle('collapsed');
  }
});

// Click overlay to close mobile sidebar
const overlayEl = $('sidebarOverlay');
if (overlayEl) {
  overlayEl.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.remove('mobile-open');
    overlayEl.classList.remove('active');
  });
}

/* ===== MODAL ===== */
function openModal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); state.editingId = null; }
$('modalClose').addEventListener('click', closeModal);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

/* ===== DASHBOARD ===== */
function calcStats(entries) {
  const income = entries.filter(e => e.type === 'thu').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter(e => e.type === 'chi').reduce((s, e) => s + e.amount, 0);
  return { income, expense, profit: income - expense, count: entries.length };
}

function renderDashboard() {
  const s = calcStats(state.entries);
  $('statIncome').textContent = fmt(s.income);
  $('statExpense').textContent = fmt(s.expense);
  $('statProfit').textContent = fmt(s.profit);
  $('statProfit').style.color = s.profit >= 0 ? 'var(--green)' : 'var(--red)';
  $('statCount').textContent = s.count;

  // Recent
  const recent = [...state.entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  $('recentTable').innerHTML = recent.map(e => `
    <tr>
      <td>${formatDate(e.date)}</td>
      <td><span class="badge badge-${e.type}">${e.type === 'thu' ? '▲ Thu' : '▼ Chi'}</span></td>
      <td style="color:${e.type === 'thu' ? 'var(--green)' : 'var(--red)'};font-weight:600">${e.type === 'thu' ? '+' : '-'}${fmt(e.amount)}</td>
      <td>${e.reason}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:30px">Chưa có giao dịch nào</td></tr>';

  renderCharts();
}

function formatDate(d) {
  const parts = d.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
}

function renderCharts() {
  // Monthly data
  const months = {};
  state.entries.forEach(e => {
    const m = e.date.slice(0, 7);
    if (!months[m]) months[m] = { thu: 0, chi: 0 };
    months[m][e.type] += e.amount;
  });
  const sortedMonths = Object.keys(months).sort();
  const labels = sortedMonths.map(m => { const [y, mo] = m.split('-'); return `T${parseInt(mo)}/${y}`; });

  const ctxMonthly = $('chartMonthly').getContext('2d');
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#ccc' : '#444';
  const gridColor = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';

  // Gradients for Bar Chart
  const gradThu = ctxMonthly.createLinearGradient(0, 0, 0, 300);
  gradThu.addColorStop(0, 'rgba(56, 239, 125, 0.85)');
  gradThu.addColorStop(1, 'rgba(17, 153, 142, 0.4)');

  const gradChi = ctxMonthly.createLinearGradient(0, 0, 0, 300);
  gradChi.addColorStop(0, 'rgba(255, 88, 88, 0.85)');
  gradChi.addColorStop(1, 'rgba(248, 87, 166, 0.4)');

  if (state.chartMonthly) state.chartMonthly.destroy();
  state.chartMonthly = new Chart($('chartMonthly'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Thu', data: sortedMonths.map(m => months[m].thu), backgroundColor: gradThu, borderRadius: 6 },
        { label: 'Chi', data: sortedMonths.map(m => months[m].chi), backgroundColor: gradChi, borderRadius: 6 }
      ]
    },
    options: chartOpts('Số tiền (₫)', textColor, gridColor)
  });

  // Ratio
  const s = calcStats(state.entries);
  if (state.chartRatio) state.chartRatio.destroy();
  state.chartRatio = new Chart($('chartRatio'), {
    type: 'doughnut',
    data: {
      labels: ['Thu', 'Chi'],
      datasets: [{ data: [s.income || 0, s.expense || 0], backgroundColor: ['rgba(56, 239, 125, 0.75)', 'rgba(255, 88, 88, 0.75)'], borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: textColor, font: { family: 'Inter', weight: 500 } } } }, cutout: '65%' }
  });
}

function chartOpts(yLabel, textColor = '#ccc', gridColor = 'rgba(255,255,255,.05)') {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: textColor, font: { family: 'Inter', weight: 500 } } } },
    scales: {
      x: { ticks: { color: textColor, font: { family: 'Inter' } }, grid: { color: gridColor } },
      y: { ticks: { color: textColor, font: { family: 'Inter' }, callback: v => new Intl.NumberFormat('vi-VN').format(v) }, grid: { color: gridColor }, title: { display: true, text: yLabel, color: textColor } }
    }
  };
}

/* ===== JOURNAL ===== */
window.populateFilterCategories = function () {
  const filterTypeEl = $('filterType');
  const filterCategoryEl = $('filterCategory');
  if (!filterCategoryEl || !filterTypeEl) return;

  const currentSelection = filterCategoryEl.value;
  const type = filterTypeEl.value;
  const cats = getCategories();

  let optionsHtml = '<option value="all">Tất cả danh mục</option>';

  const addCategoryOptions = (catList) => {
    const sorted = window.sortCategories ? window.sortCategories(catList) : catList;
    sorted.forEach(c => {
      const parts = c.split(' > ');
      const indent = parts.length > 1 ? '&nbsp;&nbsp;└─ ' : '';
      const displayName = parts[parts.length - 1];
      optionsHtml += `<option value="${c}">${indent}${displayName}</option>`;
    });
  };

  if (type === 'all') {
    optionsHtml += '<optgroup label="Danh mục Thu">';
    addCategoryOptions(cats.thu || []);
    optionsHtml += '</optgroup><optgroup label="Danh mục Chi">';
    addCategoryOptions(cats.chi || []);
    optionsHtml += '</optgroup>';
  } else if (type === 'thu') {
    addCategoryOptions(cats.thu || []);
  } else if (type === 'chi') {
    addCategoryOptions(cats.chi || []);
  }

  filterCategoryEl.innerHTML = optionsHtml;

  if ([...filterCategoryEl.options].some(o => o.value === currentSelection)) {
    filterCategoryEl.value = currentSelection;
  } else {
    filterCategoryEl.value = 'all';
  }
};

let journalPage = 1;
const ITEMS_PER_PAGE = 50;

function updateJournalView() {
  const search = ($('searchInput')?.value || '').toLowerCase();
  const filter = $('filterType')?.value || 'all';
  const filterCat = $('filterCategory')?.value || 'all';
  const startDate = $('filterStartDate')?.value || '';
  const endDate = $('filterEndDate')?.value || '';

  // Hiển thị/ẩn nút xóa bộ lọc ngày
  const btnClear = $('btnClearDates');
  if (btnClear) {
    btnClear.style.display = (startDate || endDate) ? 'flex' : 'none';
  }

  let list = [...state.entries];
  if (filter !== 'all') list = list.filter(e => e.type === filter);
  if (filterCat !== 'all') list = list.filter(e => e.category === filterCat);
  if (startDate) list = list.filter(e => e.date >= startDate);
  if (endDate) list = list.filter(e => e.date <= endDate);
  if (search) list = list.filter(e => e.reason.toLowerCase().includes(search) || e.category.toLowerCase().includes(search));
  list.sort((a, b) => b.date.localeCompare(a.date));

  const totalPages = Math.ceil(list.length / ITEMS_PER_PAGE) || 1;
  if (journalPage > totalPages) journalPage = totalPages;
  const paginatedList = list.slice((journalPage - 1) * ITEMS_PER_PAGE, journalPage * ITEMS_PER_PAGE);

  const canEdit = hasPermission('edit');
  const canDelete = hasPermission('delete');

  $('journalTable').innerHTML = paginatedList.map((e, i) => {
    let actionButtons = [];
    if (canEdit) actionButtons.push(`<button class="btn btn-primary btn-sm" onclick="editEntry('${e.id}')" title="Sửa giao dịch"><i class="fas fa-edit"></i></button>`);
    if (canDelete) actionButtons.push(`<button class="btn btn-danger btn-sm" onclick="deleteEntry('${e.id}')" title="Xóa giao dịch"><i class="fas fa-trash"></i></button>`);
    const actionsHtml = actionButtons.length ? actionButtons.join(' ') : '<span style="color:var(--text2)">-</span>';

    const globalIndex = (journalPage - 1) * ITEMS_PER_PAGE + i + 1;

    return `
      <tr>
        <td>${globalIndex}</td>
        <td>${formatDate(e.date)}</td>
        <td><span class="badge badge-${e.type}">${e.type === 'thu' ? '▲ Thu' : '▼ Chi'}</span></td>
        <td>${e.category}</td>
        <td style="color:${e.type === 'thu' ? 'var(--green)' : 'var(--red)'};font-weight:600">${e.type === 'thu' ? '+' : '-'}${fmt(e.amount)}</td>
        <td>${e.reason}</td>
        <td style="text-align:center; vertical-align: middle;">
          ${e.invoice ? `
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
              ${e.invoice === 'pending'
                ? `<span style="color:var(--text2);font-size:0.75rem;display:inline-flex;align-items:center;gap:4px" title="Đang đồng bộ file lên Google Drive..."><i class="fas fa-spinner fa-spin"></i> Đang tải...</span>`
                : (e.invoice.startsWith('data:image/')
                  ? `<img src="${e.invoice}" onclick="showInvoiceZoom('${e.invoice}', '${e.id}')" style="width:34px;height:34px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid var(--border)" title="Click để xem chi tiết & Phê duyệt">`
                  : (e.invoice.startsWith('data:')
                    ? `<a href="${e.invoice}" target="_blank" style="color:#1a73e8;font-size:1.15rem;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);text-decoration:none" title="Xem file đính kèm"><i class="fas fa-file-alt"></i></a>`
                    : `<a href="${e.invoice}" target="_blank" style="color:#34a853;font-size:1.15rem;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);text-decoration:none" title="Xem chứng từ trên Google Drive"><i class="fab fa-google-drive"></i></a>`
                  )
                )
              }
              ${getApprovalBadgeHtml(e)}
            </div>
          ` : '<span style="color:var(--text2)">-</span>'}
        </td>
        <td>${getAuditBadgeHtml(e)}</td>
        <td>${e.createdBy || '-'}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--text2);padding:30px">Không có dữ liệu</td></tr>';

  // Render pagination
  renderPagination(totalPages);

  // Sums
  const s = calcStats(list);
  $('jSumIncome').textContent = fmt(s.income);
  $('jSumExpense').textContent = fmt(s.expense);
  $('jSumProfit').textContent = fmt(s.profit);
  $('jSumProfit').style.color = s.profit >= 0 ? 'var(--green)' : 'var(--red)';

  // Cấu hình hiển thị các nút chức năng ở đầu thanh công cụ dựa vào phân quyền
  if (hasPermission('add')) {
    $('btnAddEntry')?.classList.remove('hidden');
  } else {
    $('btnAddEntry')?.classList.add('hidden');
  }

  if (hasPermission('users')) {
    $('btnImportLabel')?.classList.remove('hidden');
    $('btnClearJournal')?.classList.remove('hidden');
  } else {
    $('btnImportLabel')?.classList.add('hidden');
    $('btnClearJournal')?.classList.add('hidden');
  }
}

function renderPagination(totalPages) {
  const pagEl = $('journalPagination');
  if (!pagEl) return;
  if (totalPages <= 1) {
    pagEl.innerHTML = '';
    return;
  }
  
  pagEl.innerHTML = `
    <button class="btn btn-secondary btn-sm" ${journalPage === 1 ? 'disabled' : ''} onclick="changeJournalPage(${journalPage - 1})">
      <i class="fas fa-chevron-left"></i> Trước
    </button>
    <span class="pagination-info" style="color:var(--text2);font-size:0.85rem">Trang <strong>${journalPage}</strong> / ${totalPages}</span>
    <button class="btn btn-secondary btn-sm" ${journalPage === totalPages ? 'disabled' : ''} onclick="changeJournalPage(${journalPage + 1})">
      Sau <i class="fas fa-chevron-right"></i>
    </button>
  `;
}

window.changeJournalPage = function(page) {
  journalPage = page;
  updateJournalView();
};

let searchTimeout;
$('searchInput')?.addEventListener('input', () => {
  journalPage = 1;
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(updateJournalView, 250);
});
$('filterType')?.addEventListener('change', () => {
  journalPage = 1;
  window.populateFilterCategories();
  updateJournalView();
});
$('filterCategory')?.addEventListener('change', () => {
  journalPage = 1;
  updateJournalView();
});
$('filterStartDate')?.addEventListener('change', () => {
  journalPage = 1;
  updateJournalView();
});
$('filterEndDate')?.addEventListener('change', () => {
  journalPage = 1;
  updateJournalView();
});
$('btnClearDates')?.addEventListener('click', () => {
  journalPage = 1;
  const startInput = $('filterStartDate');
  const endInput = $('filterEndDate');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  updateJournalView();
});

/* ADD / EDIT ENTRY */
function showEntryForm(entry) {
  const isEdit = !!entry;
  const html = `
    <div class="form-group">
      <label>Loại giao dịch</label>
      <select id="fType" onchange="updateCatOptions()">
        <option value="thu" ${entry && entry.type === 'thu' ? 'selected' : ''}>Thu (nhận tiền vào)</option>
        <option value="chi" ${entry && entry.type === 'chi' ? 'selected' : ''}>Chi (tiền ra)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Ngày</label>
      <input type="date" id="fDate" value="${entry ? entry.date : today()}">
    </div>
    <div class="form-group">
      <label>Danh mục</label>
      <select id="fCat">${window.getCatOptionsHtml(entry ? entry.type : 'thu', entry ? entry.category : '')}</select>
    </div>
    <div class="form-group">
      <label>Số tiền (₫)</label>
      <input type="text" id="fAmount" placeholder="Nhập số tiền" value="${entry ? formatThousand(entry.amount) : ''}">
    </div>
    <div class="form-group">
      <label>Lý do / Ghi chú</label>
      <textarea id="fReason" placeholder="Mô tả giao dịch...">${entry ? entry.reason : ''}</textarea>
    </div>
    <div class="form-group">
      <label>Hóa đơn / Chứng từ đối chứng (Tùy chọn - Mọi định dạng file, lưu trên Drive)</label>
      ${hasPermission('invoice') ? `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <input type="file" id="fInvoiceFile" style="display:none">
          <button type="button" class="btn" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:6px 12px;font-size:0.8rem;border-radius:6px;cursor:pointer" onclick="$('fInvoiceFile').click()"><i class="fas fa-upload"></i> Chọn file chứng từ</button>
          <span id="fInvoiceStatus" style="font-size:0.78rem;color:var(--text2)">
            ${entry && entry.invoice
        ? (entry.invoice === 'pending' ? 'Đang đồng bộ lên Google Drive...' : (entry.invoice.startsWith('http') ? 'Đã lưu trên Google Drive' : 'Đã chọn file'))
        : 'Chưa chọn file'}
          </span>
        </div>
        <div id="fInvoicePreviewContainer" style="display:${entry && entry.invoice ? 'block' : 'none'};position:relative;width:120px;height:120px;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
          <img id="fInvoicePreview" src="${entry && entry.invoice
        ? (entry.invoice === 'pending' ? 'https://cdn-icons-png.flaticon.com/512/2965/2965327.png' : (entry.invoice.startsWith('data:image/') ? entry.invoice : 'https://cdn-icons-png.flaticon.com/512/2965/2965327.png'))
        : ''
      }" style="width:100%;height:100%;object-fit:cover;cursor:pointer" onclick="openInvoiceLink()" title="${entry && entry.invoice && entry.invoice.startsWith('http') ? 'Click để xem chi tiết trên Google Drive' : ''}">
          <button type="button" class="btn btn-danger" onclick="clearInvoiceSelection()" style="position:absolute;top:5px;right:5px;padding:3px 6px;font-size:0.65rem;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;background:#ef4444;color:#fff"><i class="fas fa-times"></i></button>
        </div>
      ` : `
        ${entry && entry.invoice ? `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span style="font-size:0.78rem;color:var(--text2)"><i class="fas fa-info-circle"></i> Bạn không có quyền sửa đổi chứng từ. Chỉ có thể xem bên dưới.</span>
          </div>
          <div id="fInvoicePreviewContainer" style="position:relative;width:120px;height:120px;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
            <img id="fInvoicePreview" src="${entry.invoice === 'pending' ? 'https://cdn-icons-png.flaticon.com/512/2965/2965327.png' : (entry.invoice.startsWith('data:image/') ? entry.invoice : 'https://cdn-icons-png.flaticon.com/512/2965/2965327.png')}" style="width:100%;height:100%;object-fit:cover;cursor:pointer" onclick="openInvoiceLink()" title="Click để xem chi tiết">
          </div>
        ` : `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span style="font-size:0.78rem;color:var(--text2)"><i class="fas fa-lock"></i> Bạn không có quyền đính kèm chứng từ cho giao dịch này.</span>
          </div>
        `}
      `}
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveEntry()">${isEdit ? 'Cập nhật' : 'Thêm mới'}</button>
    </div>
  `;
  state.selectedInvoice = entry ? (entry.invoice || '') : '';
  state.selectedInvoiceFile = null;
  openModal(isEdit ? 'Sửa giao dịch' : 'Thêm giao dịch mới', html);

  const fAmt = $('fAmount');
  if (fAmt) {
    fAmt.addEventListener('input', function () {
      const clean = this.value.replace(/\D/g, '');
      this.value = clean ? new Intl.NumberFormat('vi-VN').format(parseInt(clean)) : '';
    });
  }

  const fInvoiceFile = $('fInvoiceFile');
  if (fInvoiceFile) {
    fInvoiceFile.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 20 * 1024 * 1024) {
        toast('Kích thước file quá lớn (Vui lòng chọn file dưới 20MB)!', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = function (event) {
        const base64Data = event.target.result.split(',')[1];

        state.selectedInvoiceFile = {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64: base64Data,
          size: file.size
        };

        state.selectedInvoice = event.target.result;

        $('fInvoiceStatus').textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        const isImage = file.type.startsWith('image/');
        const fPreview = $('fInvoicePreview');
        if (isImage) {
          fPreview.src = event.target.result;
          fPreview.style.objectFit = 'cover';
        } else {
          fPreview.src = 'https://cdn-icons-png.flaticon.com/512/2965/2965327.png';
          fPreview.style.objectFit = 'contain';
        }
        $('fInvoicePreviewContainer').style.display = 'block';
      };
      reader.readAsDataURL(file);
    });
  }
}

window.updateCatOptions = function () {
  const type = $('fType').value;
  $('fCat').innerHTML = window.getCatOptionsHtml(type);
};

$('btnAddEntry').addEventListener('click', () => {
  if (!hasPermission('add')) return toast('Bạn không có quyền!', 'error');
  state.editingId = null;
  showEntryForm(null);
});

window.editEntry = function (id) {
  if (!hasPermission('edit')) return toast('Bạn không có quyền!', 'error');
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  state.editingId = id;
  showEntryForm(entry);
};

window.saveEntry = function () {
  if (state.editingId) {
    if (!hasPermission('edit')) return toast('Bạn không có quyền sửa giao dịch!', 'error');
  } else {
    if (!hasPermission('add')) return toast('Bạn không có quyền thêm giao dịch mới!', 'error');
  }
  const type = $('fType').value;
  const date = $('fDate').value;
  const category = $('fCat').value;
  const amount = parseInt($('fAmount').value.replace(/\D/g, '')) || 0;
  const reason = $('fReason').value.trim();
  if (!date || !amount || amount <= 0 || !reason) { toast('Vui lòng điền đầy đủ thông tin!', 'error'); return; }

  const invoice = state.selectedInvoice || '';
  let entry;
  if (state.editingId) {
    const idx = state.entries.findIndex(e => e.id === state.editingId);
    if (idx !== -1) {
      state.entries[idx] = { ...state.entries[idx], type, date, category, amount, reason, invoice };
      entry = state.entries[idx];
    }
    toast('Đã cập nhật giao dịch!');
  } else {
    entry = { id: uid(), type, date, category, amount, reason, invoice, createdBy: state.currentUser.username, createdAt: new Date().toISOString() };
    state.entries.push(entry);
    toast('Đã thêm giao dịch mới!');
  }
  saveData();
  if (entry) window.sendToCloud({ action: 'saveEntry', entry, fileData: state.selectedInvoiceFile });
  closeModal();
  updateJournalView();
  renderDashboard();
};

window.clearInvoiceSelection = function () {
  state.selectedInvoice = '';
  state.selectedInvoiceFile = null;
  const fStatus = $('fInvoiceStatus');
  if (fStatus) fStatus.textContent = 'Chưa chọn file';
  const fFile = $('fInvoiceFile');
  if (fFile) fFile.value = '';
  const fPrevContainer = $('fInvoicePreviewContainer');
  if (fPrevContainer) fPrevContainer.style.display = 'none';
};

window.openInvoiceLink = function () {
  if (state.selectedInvoice && (state.selectedInvoice.startsWith('http') || state.selectedInvoice.startsWith('data:'))) {
    window.open(state.selectedInvoice, '_blank');
  }
};

window.showInvoiceZoom = function (imgSrc, entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  const canApprove = hasPermission('approve');
  let approvalButtonsHtml = '';
  
  if (entry && canApprove) {
    const currentStatus = entry.approvalStatus || 'pending';
    approvalButtonsHtml = `
      <div style="margin-top:15px;padding-top:12px;border-top:1px solid var(--card-border);display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:0.8rem;color:var(--text2)"><i class="fas fa-user-shield"></i> Xác nhận:</span>
        <button class="btn btn-success btn-sm" ${currentStatus === 'approved' ? 'disabled style="opacity:0.5;pointer-events:none;"' : ''} onclick="updateApprovalStatus('${entryId}', 'approved', true)"><i class="fas fa-check"></i> Duyệt</button>
        <button class="btn btn-danger btn-sm" ${currentStatus === 'rejected' ? 'disabled style="opacity:0.5;pointer-events:none;"' : ''} onclick="updateApprovalStatus('${entryId}', 'rejected', true)"><i class="fas fa-times"></i> Từ chối</button>
        <button class="btn btn-secondary btn-sm" ${currentStatus === 'pending' ? 'disabled style="opacity:0.5;pointer-events:none;"' : ''} onclick="updateApprovalStatus('${entryId}', 'pending', true)"><i class="fas fa-clock"></i> Chờ</button>
      </div>
    `;
  }

  openModal('Chi tiết Hóa đơn / Chứng từ', `
    <div style="text-align:center;padding:10px">
      <img src="${imgSrc}" style="max-width:100%;max-height:60vh;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.3)">
      <div style="margin-top:15px;display:flex;justify-content:center;gap:10px">
        <a href="${imgSrc}" download="hoa_don_${Date.now()}.jpg" class="btn btn-primary btn-sm" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none"><i class="fas fa-download"></i> Tải về hóa đơn</a>
        <button class="btn btn-secondary btn-sm" onclick="closeModal()">Đóng</button>
      </div>
      ${approvalButtonsHtml}
    </div>
  `);
};

function getApprovalBadgeHtml(e) {
  const status = e.approvalStatus || 'pending';
  const canApprove = hasPermission('approve');
  
  let badgeStyle = '';
  let icon = '';
  let text = '';
  
  if (status === 'approved') {
    badgeStyle = 'background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.2)';
    icon = 'fa-check-circle';
    text = 'Đã duyệt';
  } else if (status === 'rejected') {
    badgeStyle = 'background:rgba(244,63,94,.15);color:var(--red);border:1px solid rgba(244,63,94,.2)';
    icon = 'fa-times-circle';
    text = 'Từ chối';
  } else {
    badgeStyle = 'background:rgba(245,158,11,.15);color:var(--yellow);border:1px solid rgba(245,158,11,.2)';
    icon = 'fa-clock';
    text = 'Chờ duyệt';
  }
  
  if (canApprove) {
    return `<span class="badge" style="${badgeStyle};font-size:0.68rem;padding:2px 6px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;margin-top:2px" onclick="showApprovalActionModal('${e.id}')" title="Click để thay đổi trạng thái phê duyệt"><i class="fas ${icon}"></i> ${text}</span>`;
  } else {
    return `<span class="badge" style="${badgeStyle};font-size:0.68rem;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;margin-top:2px"><i class="fas ${icon}"></i> ${text}</span>`;
  }
}

window.showApprovalActionModal = function (entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  
  const statusLabels = {
    pending: '<span class="badge" style="background:rgba(245,158,11,.15);color:var(--yellow);border:1px solid rgba(245,158,11,.2)"><i class="fas fa-clock"></i> Chờ duyệt</span>',
    approved: '<span class="badge" style="background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.2)"><i class="fas fa-check-circle"></i> Đã duyệt</span>',
    rejected: '<span class="badge" style="background:rgba(244,63,94,.15);color:var(--red);border:1px solid rgba(244,63,94,.2)"><i class="fas fa-times-circle"></i> Từ chối</span>'
  };
  
  const currentStatus = entry.approvalStatus || 'pending';
  
  let previewHtml = '';
  if (entry.invoice) {
    if (entry.invoice.startsWith('data:image/')) {
      previewHtml = `<div style="text-align:center;margin-top:12px;"><img src="${entry.invoice}" style="max-width:100%;max-height:200px;border-radius:6px;border:1px solid var(--border)"></div>`;
    } else if (entry.invoice.startsWith('http') || entry.invoice.startsWith('data:')) {
      previewHtml = `<div style="text-align:center;margin-top:12px;"><a href="${entry.invoice}" target="_blank" class="btn btn-info btn-sm"><i class="fas fa-external-link-alt"></i> Xem chứng từ đính kèm</a></div>`;
    }
  }

  openModal('Phê duyệt hóa đơn', `
    <div style="font-size:0.9rem;line-height:1.6">
      <div style="display:grid;grid-template-columns:100px 1fr;gap:8px;margin-bottom:12px;background:rgba(255,255,255,0.02);padding:12px;border-radius:8px;border:1px solid var(--border)">
        <strong>Ngày:</strong> <span>${formatDate(entry.date)}</span>
        <strong>Loại:</strong> <span><span class="badge badge-${entry.type}">${entry.type === 'thu' ? 'Thu' : 'Chi'}</span></span>
        <strong>Danh mục:</strong> <span>${entry.category}</span>
        <strong>Số tiền:</strong> <span style="color:${entry.type === 'thu' ? 'var(--green)' : 'var(--red)'};font-weight:600">${fmt(entry.amount)}</span>
        <strong>Lý do:</strong> <span>${entry.reason}</span>
        <strong>Người tạo:</strong> <span>${entry.createdBy || '-'}</span>
        <strong>Trạng thái:</strong> <span>${statusLabels[currentStatus]}</span>
      </div>
      
      ${previewHtml}
      
      <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px;display:flex;justify-content:center;gap:10px">
        <button class="btn btn-success" onclick="updateApprovalStatus('${entryId}', 'approved')"><i class="fas fa-check"></i> Duyệt</button>
        <button class="btn btn-danger" onclick="updateApprovalStatus('${entryId}', 'rejected')"><i class="fas fa-times"></i> Từ chối</button>
        <button class="btn btn-secondary" onclick="updateApprovalStatus('${entryId}', 'pending')"><i class="fas fa-clock"></i> Chờ duyệt</button>
      </div>
    </div>
  `);
};

window.updateApprovalStatus = function (entryId, status, keepZoomOpen = false) {
  if (!hasPermission('approve')) return toast('Bạn không có quyền phê duyệt!', 'error');
  
  const idx = state.entries.findIndex(e => e.id === entryId);
  if (idx === -1) return;
  
  state.entries[idx].approvalStatus = status;
  saveData();
  
  // Sync to cloud if SCRIPT_URL is configured
  window.sendToCloud({
    action: 'saveEntry',
    entry: state.entries[idx]
  });
  
  const statusMsgs = {
    approved: 'Đã duyệt hóa đơn chứng từ thành công!',
    rejected: 'Đã từ chối hóa đơn chứng từ!',
    pending: 'Đã chuyển trạng thái hóa đơn về chờ duyệt!'
  };
  
  toast(statusMsgs[status] || 'Đã cập nhật trạng thái phê duyệt!');
  
  if (keepZoomOpen && status !== 'pending' && state.entries[idx].invoice && state.entries[idx].invoice.startsWith('data:image/')) {
    // Re-render zoom modal to update disabled states of buttons
    showInvoiceZoom(state.entries[idx].invoice, entryId);
  } else {
    closeModal();
  }
  
  updateJournalView();
  renderDashboard();
};

function getAuditBadgeHtml(e) {
  const status = e.auditStatus || 'pending';
  const canApprove = hasPermission('approve');
  
  let badgeStyle = '';
  let icon = '';
  let text = '';
  
  if (status === 'valid') {
    badgeStyle = 'background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.2)';
    icon = 'fa-check-double';
    text = 'Hợp lệ';
  } else if (status === 'invalid') {
    badgeStyle = 'background:rgba(244,63,94,.15);color:var(--red);border:1px solid rgba(244,63,94,.2)';
    icon = 'fa-exclamation-triangle';
    text = 'Không hợp lệ';
  } else {
    badgeStyle = 'background:rgba(245,158,11,.15);color:var(--yellow);border:1px solid rgba(245,158,11,.2)';
    icon = 'fa-shield-alt';
    text = 'Chờ kiểm soát';
  }
  
  let noteIndicator = '';
  if (e.auditNote) {
    noteIndicator = `<i class="fas fa-comment-dots" style="margin-left:4px;opacity:0.8" title="Ghi chú: ${e.auditNote.replace(/"/g, '&quot;')}"></i> `;
  }
  
  if (canApprove) {
    return `<span class="badge" style="${badgeStyle};font-size:0.68rem;padding:2px 6px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" onclick="showAuditActionModal('${e.id}')" title="Click để kiểm soát & để lại ghi chú">${noteIndicator}<i class="fas ${icon}"></i> ${text}</span>`;
  } else {
    return `<span class="badge" style="${badgeStyle};font-size:0.68rem;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;">${noteIndicator}<i class="fas ${icon}"></i> ${text}</span>`;
  }
}

window.showAuditActionModal = function (entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  
  const statusLabels = {
    pending: '<span class="badge" style="background:rgba(245,158,11,.15);color:var(--yellow);border:1px solid rgba(245,158,11,.2)"><i class="fas fa-shield-alt"></i> Chờ kiểm soát</span>',
    valid: '<span class="badge" style="background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.2)"><i class="fas fa-check-double"></i> Hợp lệ</span>',
    invalid: '<span class="badge" style="background:rgba(244,63,94,.15);color:var(--red);border:1px solid rgba(244,63,94,.2)"><i class="fas fa-exclamation-triangle"></i> Không hợp lệ</span>'
  };
  
  const currentStatus = entry.auditStatus || 'pending';
  const currentNote = entry.auditNote || '';
  
  let previewHtml = '';
  if (entry.invoice) {
    if (entry.invoice.startsWith('data:image/')) {
      previewHtml = `<div style="text-align:center;margin-top:12px;"><img src="${entry.invoice}" style="max-width:100%;max-height:180px;border-radius:6px;border:1px solid var(--border)"></div>`;
    } else if (entry.invoice.startsWith('http') || entry.invoice.startsWith('data:')) {
      previewHtml = `<div style="text-align:center;margin-top:12px;"><a href="${entry.invoice}" target="_blank" class="btn btn-info btn-sm"><i class="fas fa-external-link-alt"></i> Xem chứng từ đính kèm</a></div>`;
    }
  }

  openModal('Kiểm soát & Soát xét Giao dịch', `
    <div style="font-size:0.9rem;line-height:1.6">
      <div style="display:grid;grid-template-columns:100px 1fr;gap:8px;margin-bottom:12px;background:rgba(255,255,255,0.02);padding:12px;border-radius:8px;border:1px solid var(--border)">
        <strong>Ngày:</strong> <span>${formatDate(entry.date)}</span>
        <strong>Loại:</strong> <span><span class="badge badge-${entry.type}">${entry.type === 'thu' ? 'Thu' : 'Chi'}</span></span>
        <strong>Danh mục:</strong> <span>${entry.category}</span>
        <strong>Số tiền:</strong> <span style="color:${entry.type === 'thu' ? 'var(--green)' : 'var(--red)'};font-weight:600">${fmt(entry.amount)}</span>
        <strong>Lý do:</strong> <span>${entry.reason}</span>
        <strong>Người tạo:</strong> <span>${entry.createdBy || '-'}</span>
        <strong>Chứng từ:</strong> <span>${entry.invoice ? 'Đã đính kèm' : 'Không có'}</span>
        <strong>Trạng thái:</strong> <span>${statusLabels[currentStatus]}</span>
      </div>
      
      ${previewHtml}
      
      <div style="margin-top:15px;" class="form-group">
        <label style="display:block;font-weight:600;margin-bottom:8px;">Xác nhận tính hợp lệ:</label>
        <div style="display:flex;gap:12px;flex-wrap:wrap;background:rgba(255,255,255,0.02);padding:10px;border-radius:8px;border:1px solid var(--border);">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;font-weight:normal;">
            <input type="radio" name="auditStatusRadio" value="valid" ${currentStatus === 'valid' ? 'checked' : ''} style="width:auto;margin:0;">
            <span style="color:var(--green);font-weight:600;"><i class="fas fa-check-double"></i> Hợp lệ</span>
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;font-weight:normal;">
            <input type="radio" name="auditStatusRadio" value="invalid" ${currentStatus === 'invalid' ? 'checked' : ''} style="width:auto;margin:0;">
            <span style="color:var(--red);font-weight:600;"><i class="fas fa-exclamation-triangle"></i> Không hợp lệ</span>
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;font-weight:normal;">
            <input type="radio" name="auditStatusRadio" value="pending" ${currentStatus === 'pending' ? 'checked' : ''} style="width:auto;margin:0;">
            <span style="color:var(--yellow);font-weight:600;"><i class="fas fa-shield-alt"></i> Chờ kiểm soát</span>
          </label>
        </div>
      </div>
      
      <div class="form-group" style="margin-top:12px;">
        <label for="fAuditNote" style="display:block;font-weight:600;margin-bottom:6px;">Ghi chú kiểm soát:</label>
        <textarea id="fAuditNote" placeholder="Để lại ý kiến kiểm soát hoặc lý do không hợp lệ nếu có..." style="width:100%;height:70px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);color:var(--text);border:1px solid var(--card-border);font-family:inherit;font-size:0.88rem;">${currentNote}</textarea>
      </div>
      
      <div style="margin-top:20px;border-top:1px solid var(--card-border);padding-top:16px;display:flex;justify-content:flex-end;gap:10px">
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="saveAuditStatus('${entry.id}')"><i class="fas fa-save"></i> Lưu xác nhận</button>
      </div>
    </div>
  `);
};

window.saveAuditStatus = function (entryId) {
  if (!hasPermission('approve')) return toast('Bạn không có quyền soát xét kiểm soát!', 'error');
  
  const idx = state.entries.findIndex(e => e.id === entryId);
  if (idx === -1) return;
  
  const oldStatus = state.entries[idx].auditStatus || 'pending';
  const oldNote = state.entries[idx].auditNote || '';
  
  const selectedRadio = document.querySelector('input[name="auditStatusRadio"]:checked');
  const newStatus = selectedRadio ? selectedRadio.value : 'pending';
  const newNote = document.getElementById('fAuditNote') ? document.getElementById('fAuditNote').value.trim() : '';
  
  state.entries[idx].auditStatus = newStatus;
  state.entries[idx].auditNote = newNote;
  saveData();
  
  // Ghi nhận lịch sử audit trail
  const statusLabels = { pending: 'Chờ kiểm soát', valid: 'Hợp lệ', invalid: 'Không hợp lệ' };
  const actionDetails = `Kiểm soát giao dịch [ID: ${entryId}]: từ [${statusLabels[oldStatus]}] sang [${statusLabels[newStatus]}]. Ghi chú: "${newNote || 'Không có ghi chú'}"`;
  writeAuditLog('Kiểm soát giao dịch', actionDetails);
  
  // Đồng bộ đám mây
  window.sendToCloud({
    action: 'saveEntry',
    entry: state.entries[idx]
  });
  
  toast('Đã cập nhật trạng thái kiểm soát giao dịch thành công!');
  closeModal();
  updateJournalView();
};

window.deleteEntry = function (id) {
  if (!hasPermission('delete')) return toast('Bạn không có quyền!', 'error');
  if (!confirm('Bạn có chắc muốn xoá giao dịch này?')) return;
  state.entries = state.entries.filter(e => e.id !== id);
  saveData();
  window.sendToCloud({ action: 'deleteEntry', id });
  updateJournalView();
  renderDashboard();
  toast('Đã xoá giao dịch!');
};

/* ===== HELPER: Download Excel ===== */
function s2ab(s) {
  const buf = new ArrayBuffer(s.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
  return buf;
}

async function downloadExcel(wb, filename) {
  if (typeof XLSX === 'undefined') {
    toast('Lỗi: Thư viện XLSX chưa được tải!', 'error');
    return;
  }
  const wbBinary = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });
  const buf = s2ab(wbBinary);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  // Dùng showSaveFilePicker để mở hộp thoại "Save As"
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Excel Workbook',
          accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toast('Đã lưu file Excel thành công!');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User cancelled
      console.warn('showSaveFilePicker failed, falling back:', err);
    }
  }

  // Fallback cho trình duyệt cũ
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 40000);
}

/* ===== EXPORT EXCEL ===== */
$('btnExport').addEventListener('click', () => {
  const search = ($('searchInput')?.value || '').toLowerCase();
  const filter = $('filterType')?.value || 'all';
  const startDate = $('filterStartDate')?.value || '';
  const endDate = $('filterEndDate')?.value || '';

  let list = [...state.entries];
  if (filter !== 'all') list = list.filter(e => e.type === filter);
  if (startDate) list = list.filter(e => e.date >= startDate);
  if (endDate) list = list.filter(e => e.date <= endDate);
  if (search) list = list.filter(e => e.reason.toLowerCase().includes(search) || e.category.toLowerCase().includes(search));

  if (!list.length) { toast('Không có dữ liệu khớp bộ lọc để xuất!', 'error'); return; }
  const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
  const data = sorted.map((e, i) => ({
    'STT': i + 1,
    'Ngày': formatDate(e.date),
    'Loại': e.type === 'thu' ? 'Thu' : 'Chi',
    'Danh mục': e.category,
    'Số tiền': e.amount,
    'Lý do': e.reason,
    'Người tạo': e.createdBy || '',
    'Trạng thái duyệt': e.approvalStatus === 'approved' ? 'Đã duyệt' : (e.approvalStatus === 'rejected' ? 'Từ chối' : (e.invoice ? 'Chờ duyệt' : '-')),
    'Kiểm soát': e.auditStatus === 'valid' ? 'Hợp lệ' : (e.auditStatus === 'invalid' ? 'Không hợp lệ' : 'Chờ kiểm soát'),
    'Ghi chú kiểm soát': e.auditNote || ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 8 }, { wch: 22 }, { wch: 18 }, { wch: 35 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Nhật Ký Chung');
  downloadExcel(wb, `NhatKyChung_${today()}.xlsx`);
  toast('Đã xuất file Excel thành công!');
});

/* ===== IMPORT EXCEL ===== */
$('btnImport').addEventListener('change', function (e) {
  if (!isAdmin()) { toast('Bạn không có quyền!', 'error'); return; }
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      let count = 0;
      rows.forEach(r => {
        const rawDate = r['Ngày'] || r['ngày'] || r['Date'] || r['date'] || '';
        let date = '';
        if (typeof rawDate === 'number') {
          const d = XLSX.SSF.parse_date_code(rawDate);
          date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
        } else {
          date = String(rawDate);
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
            const [dd, mm, yy] = date.split('/');
            date = `${yy}-${mm}-${dd}`;
          }
        }
        const typeRaw = (r['Loại'] || r['loại'] || r['Type'] || '').toString().toLowerCase();
        const type = typeRaw.includes('thu') || typeRaw.includes('income') ? 'thu' : 'chi';
        const amount = parseInt(r['Số tiền'] || r['số tiền'] || r['Amount'] || r['amount'] || 0);
        const reason = r['Lý do'] || r['lý do'] || r['Reason'] || r['Ghi chú'] || '';
        const category = r['Danh mục'] || r['danh mục'] || r['Category'] || (type === 'thu' ? 'Thu khác' : 'Chi khác');
        if (date && amount > 0) {
          state.entries.push({ id: uid(), type, date, category: String(category), amount, reason: String(reason), createdBy: state.currentUser.username, createdAt: new Date().toISOString() });
          count++;
        }
      });
      saveData();
      window.sendToCloud({
        action: 'restoreAll',
        entries: state.entries,
        users: state.users,
        categories: getCategories()
      });
      updateJournalView();
      renderDashboard();
      toast(`Đã nhập ${count} giao dịch từ Excel!`);
    } catch (err) {
      toast('Lỗi đọc file Excel! Kiểm tra định dạng.', 'error');
      console.error(err);
    }
  };
  reader.readAsBinaryString(file);
  this.value = '';
});

/* ===== REPORTS ===== */
function initReportPage() {
  if (!$('rptFrom').value) {
    const d = new Date();
    $('rptFrom').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    $('rptTo').value = today();
  }
  generateReport();
}

$('btnGenReport').addEventListener('click', generateReport);

function generateReport() {
  const from = $('rptFrom').value;
  const to = $('rptTo').value;
  let list = state.entries;
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);
  list.sort((a, b) => a.date.localeCompare(b.date));

  const s = calcStats(list);
  $('rptIncome').textContent = fmt(s.income);
  $('rptExpense').textContent = fmt(s.expense);
  $('rptProfit').textContent = fmt(s.profit);
  $('rptProfit').style.color = s.profit >= 0 ? 'var(--green)' : 'var(--red)';

  $('reportTable').innerHTML = list.map(e => `
    <tr>
      <td>${formatDate(e.date)}</td>
      <td><span class="badge badge-${e.type}">${e.type === 'thu' ? '▲ Thu' : '▼ Chi'}</span></td>
      <td>${e.category}</td>
      <td style="color:${e.type === 'thu' ? 'var(--green)' : 'var(--red)'};font-weight:600">${e.type === 'thu' ? '+' : '-'}${fmt(e.amount)}</td>
      <td>${e.reason}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:30px">Không có dữ liệu</td></tr>';

  // Chart
  const daily = {};
  list.forEach(e => {
    if (!daily[e.date]) daily[e.date] = { thu: 0, chi: 0 };
    daily[e.date][e.type] += e.amount;
  });
  const dates = Object.keys(daily).sort();
  
  const ctxReport = $('chartReport').getContext('2d');
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#ccc' : '#444';
  const gridColor = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';

  const gradLineThu = ctxReport.createLinearGradient(0, 0, 0, 300);
  gradLineThu.addColorStop(0, 'rgba(56, 239, 125, 0.25)');
  gradLineThu.addColorStop(1, 'rgba(56, 239, 125, 0)');

  const gradLineChi = ctxReport.createLinearGradient(0, 0, 0, 300);
  gradLineChi.addColorStop(0, 'rgba(255, 88, 88, 0.25)');
  gradLineChi.addColorStop(1, 'rgba(255, 88, 88, 0)');

  if (state.chartReport) state.chartReport.destroy();
  state.chartReport = new Chart($('chartReport'), {
    type: 'line',
    data: {
      labels: dates.map(formatDate),
      datasets: [
        { label: 'Thu', data: dates.map(d => daily[d].thu), borderColor: 'rgba(56,239,125,.9)', backgroundColor: gradLineThu, fill: true, tension: .4, pointRadius: 3, borderWidth: 2.5 },
        { label: 'Chi', data: dates.map(d => daily[d].chi), borderColor: 'rgba(255,88,88,.9)', backgroundColor: gradLineChi, fill: true, tension: .4, pointRadius: 3, borderWidth: 2.5 }
      ]
    },
    options: chartOpts('Số tiền (₫)', textColor, gridColor)
  });

  // Nâng cấp: Tự động cập nhật Báo cáo P&L rút gọn và Dự báo dòng tiền tuyến tính
  updatePLStatement(list);
  generateForecastChart();
}

/* ===== SETTINGS ===== */
/* ===== SETTINGS ===== */
function renderSettings() {
  if (!hasPermission('users')) return;
  $('usersTable').innerHTML = state.users.map(u => {
    // Phân tích danh sách quyền đang có
    const perms = u.permissions
      ? (typeof u.permissions === 'string' ? u.permissions.split(',') : u.permissions)
      : (u.role === 'admin' ? ['view', 'add', 'edit', 'delete', 'invoice', 'approve', 'users', 'cats', 'audit', 'reports', 'advances_edit', 'debts_edit'] 
        : (u.role === 'audit' ? ['view', 'approve']
        : (u.role === 'editor' ? ['view', 'add', 'edit', 'invoice', 'cats'] 
        : ['view'])));

    const permMap = {
      view: 'Xem',
      add: 'Ghi',
      edit: 'Sửa',
      delete: 'Xóa',
      invoice: 'Drive',
      approve: 'Xác nhận',
      cats: 'D.Mục',
      users: 'User',
      audit: 'K.Soát',
      reports: 'B.Cáo P&L',
      advances_submit: 'Tạo T.Ứng',
      view_self_advances: 'Xem T.Ứng CN',
      advances_edit: 'KT T.Ứng',
      advances_pay: 'TQ Chi Ứng',
      debts_edit: 'KT C.Nợ',
      debts_pay: 'TQ Thanh Nợ'
    };

    const permBadges = perms.map(p => {
      const colorMap = {
        view: 'rgba(58,123,213,.2);color:#3a7bd5',
        add: 'rgba(56,239,125,.2);color:#20bf55',
        edit: 'rgba(247,151,30,.2);color:#f7971e',
        delete: 'rgba(255,88,88,.2);color:#ff5858',
        invoice: 'rgba(0,210,255,.2);color:#00d2ff',
        approve: 'rgba(16,185,129,.2);color:#10b981',
        cats: 'rgba(118,75,162,.2);color:#764ba2',
        users: 'rgba(255,88,88,.2);color:#ff5858',
        audit: 'rgba(16,185,129,.2);color:#10b981',
        reports: 'rgba(102,126,234,.2);color:#667eea',
        advances_submit: 'rgba(56,239,125,.2);color:#20bf55',
        view_self_advances: 'rgba(58,123,213,.2);color:#3a7bd5',
        advances_edit: 'rgba(118,75,162,.2);color:#764ba2',
        advances_pay: 'rgba(247,151,30,.2);color:#f7971e',
        debts_edit: 'rgba(118,75,162,.2);color:#764ba2',
        debts_pay: 'rgba(247,151,30,.2);color:#f7971e'
      };
      return `<span class="badge" style="background:${colorMap[p] || 'rgba(255,255,255,.1);color:#ccc'};font-size:0.7rem;margin:1px;padding:2px 6px;border-radius:4px;display:inline-block">${permMap[p] || p}</span>`;
    }).join(' ');

    return `
      <tr>
        <td><strong>${u.username}</strong></td>
        <td><span class="badge" style="background:rgba(102,126,234,.2);color:var(--primary)">${u.label}</span></td>
        <td style="white-space:normal;max-width:280px;line-height:1.6;">${permBadges}</td>
        <td>
          ${u.username !== 'admin' ? `
            <button class="btn btn-primary btn-sm" onclick="editUserPermissions('${u.username}')" title="Tùy chỉnh quyền chi tiết" style="padding:4px 8px;font-size:0.75rem;margin-right:4px">
              <i class="fas fa-user-shield"></i> Quyền
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.username}')" title="Xóa người dùng" style="padding:4px 8px;font-size:0.75rem">
              <i class="fas fa-trash-alt"></i>
            </button>
          ` : '<span style="color:var(--text2)">Mặc định (Toàn quyền)</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

window.editUserPermissions = function (username) {
  const u = state.users.find(x => x.username === username);
  if (!u) return;

  let activePerms = [];
  if (u.permissions) {
    activePerms = typeof u.permissions === 'string' ? u.permissions.split(',') : u.permissions;
  } else {
    if (u.role === 'admin') activePerms = ['view', 'add', 'edit', 'delete', 'invoice', 'approve', 'users', 'cats', 'reports', 'advances_edit', 'debts_edit'];
    else if (u.role === 'audit') activePerms = ['view', 'approve'];
    else if (u.role === 'editor') activePerms = ['view', 'add', 'edit', 'invoice', 'cats'];
    else activePerms = ['view'];
  }

  const groups = [
    {
      title: '📁 Quyền Hệ thống & Sổ quỹ',
      color: 'var(--primary)',
      perms: [
        { key: 'view', label: 'Xem nhật ký & Sổ quỹ', desc: 'Quyền xem Dashboard tổng quan và Sổ nhật ký chung.' },
        { key: 'add', label: 'Ghi sổ nhật ký chung', desc: 'Quyền thêm mới các giao dịch thu chi.' },
        { key: 'edit', label: 'Sửa nhật ký chung', desc: 'Quyền chỉnh sửa thông tin giao dịch thu chi đã ghi.' },
        { key: 'delete', label: 'Xóa nhật ký chung', desc: 'Quyền xóa giao dịch hoặc xóa toàn bộ sổ quỹ.' },
        { key: 'invoice', label: 'Tải hóa đơn (Drive)', desc: 'Quyền đính kèm, tải lên hóa đơn chứng từ của giao dịch.' },
        { key: 'cats', label: 'Quản lý danh mục', desc: 'Quyền thêm, sửa, xóa danh mục thu chi động.' },
        { key: 'reports', label: 'Báo cáo P&L & CFO AI', desc: 'Quyền xem báo cáo P&L chuyên sâu, dự báo dòng tiền và tương tác chatbot CFO AI.' },
        { key: 'users', label: 'Quản lý thành viên', desc: 'Quyền thêm, xóa và phân quyền chi tiết cho thành viên khác.' }
      ]
    },
    {
      title: '🛡️ Quyền Kiểm soát soát xét',
      color: '#10b981',
      perms: [
        { key: 'approve', label: 'Kiểm soát & Soát xét', desc: 'Quyền xem và cập nhật trạng thái kiểm soát giao dịch (Hợp lệ, Không hợp lệ) và ghi chú soát xét.' }
      ]
    },
    {
      title: '💸 Quyền Quản lý Tạm ứng',
      color: '#764ba2',
      perms: [
        { key: 'advances_submit', label: 'Tạo đề xuất tạm ứng', desc: 'Quyền cho phép tạo đề xuất xin tạm ứng kinh phí.' },
        { key: 'view_self_advances', label: 'Chỉ xem tạm ứng cá nhân', desc: 'Giới hạn chỉ được xem lịch sử đề xuất tạm ứng của chính mình (thường cho Staff).' },
        { key: 'advances_edit', label: 'Kế toán kiểm soát tạm ứng', desc: 'Quyền xem toàn bộ tạm ứng, phê duyệt đề xuất và đối chiếu hoàn ứng của nhân sự.' },
        { key: 'advances_pay', label: 'Thủ quỹ chi tạm ứng', desc: 'Quyền thực hiện chi tiền từ két quỹ cho các đề xuất tạm ứng đã duyệt.' }
      ]
    },
    {
      title: '🤝 Quyền Quản lý Công nợ',
      color: '#f7971e',
      perms: [
        { key: 'debts_edit', label: 'Kế toán kiểm soát công nợ', desc: 'Quyền theo dõi, thiết lập và quản lý công nợ Phải thu/Phải trả.' },
        { key: 'debts_pay', label: 'Thủ quỹ chi trả/Thu nợ', desc: 'Quyền thực hiện thu tiền nợ khách hàng hoặc chi tiền trả nợ nhà cung cấp.' }
      ]
    }
  ];

  const checklistHtml = groups.map(g => {
    const groupPermsHtml = g.perms.map(p => {
      const checked = activePerms.includes(p.key) ? 'checked' : '';
      return `
        <div class="perm-card" style="display:flex;align-items:flex-start;gap:12px;background:rgba(255,255,255,0.02);padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);margin-bottom:8px;transition:var(--transition);position:relative;">
          <input type="checkbox" id="perm_${p.key}" class="perm-checkbox" value="${p.key}" ${checked} style="width:18px;height:18px;margin-top:2px;cursor:pointer">
          <div style="flex:1;cursor:pointer" onclick="const cb = document.getElementById('perm_${p.key}'); cb.checked = !cb.checked;">
            <label style="display:block;margin:0 0 2px 0;font-weight:600;font-size:0.85rem;color:var(--text);cursor:pointer">${p.label}</label>
            <small style="color:var(--text2);font-size:0.72rem;line-height:1.3;display:block">${p.desc}</small>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-bottom:18px;">
        <h5 style="color:${g.color};font-size:0.88rem;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:6px;">
          ${g.title}
        </h5>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${groupPermsHtml}
        </div>
      </div>
    `;
  }).join('');

  openModal(`Phân Quyền: ${u.username}`, `
    <div style="max-height:65vh;overflow-y:auto;padding-right:8px">
      <p style="font-size:0.82rem;color:var(--text2);margin-bottom:16px">Tùy chỉnh phân quyền chi tiết cho tài khoản <strong>${u.username}</strong> (Vai trò: ${u.label}). Mọi thay đổi sẽ được đồng bộ lên đám mây ngay lập tức.</p>
      <div class="perm-checklist">${checklistHtml}</div>
    </div>
    <div class="modal-actions" style="margin-top:20px">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveUserPermissions('${u.username}')"><i class="fas fa-save"></i> Lưu phân quyền</button>
    </div>
  `);
};

window.saveUserPermissions = function (username) {
  const u = state.users.find(x => x.username === username);
  if (!u) return;

  const checkedCheckboxes = Array.from(document.querySelectorAll('.perm-checkbox:checked'));
  const selectedPerms = checkedCheckboxes.map(cb => cb.value);

  // Cập nhật quyền chi tiết và giữ nguyên vai trò nhãn của tài khoản gốc để tránh đè vai trò
  u.permissions = selectedPerms.join(',');

  saveData();
  window.sendToCloud({ action: 'saveUser', user: u });
  closeModal();
  renderSettings();
  toast(`Đã cập nhật phân quyền cho tài khoản ${username}!`);
};

$('btnAddUser').addEventListener('click', () => {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  openModal('Thêm người dùng mới', `
    <div class="form-group"><label>Tên đăng nhập</label><input type="text" id="fNewUser" placeholder="Nhập tên đăng nhập"></div>
    <div class="form-group"><label>Mật khẩu</label><input type="password" id="fNewPass" placeholder="Nhập mật khẩu"></div>
    <div class="form-group"><label>Mẫu vai trò mặc định</label>
      <select id="fNewRole">
        <option value="admin">Quản trị viên (Toàn quyền hệ thống)</option>
        <option value="accountant">Kế toán tổng hợp (Thu chi, Tạm ứng, Công nợ, P&L)</option>
        <option value="treasurer">Thủ quỹ (Quản lý két quỹ, Chi tiền, Thanh toán nợ)</option>
        <option value="staff">Nhân viên (Tạo đề xuất tạm ứng & Quyết toán hoàn ứng)</option>
        <option value="audit">Ban kiểm soát (Soát xét và kiểm soát tính hợp lệ giao dịch)</option>
        <option value="viewer" selected>Chỉ xem (Xem nhật ký chung và báo cáo)</option>
      </select>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" onclick="saveNewUser()"><i class="fas fa-plus"></i> Thêm người dùng</button></div>
  `);
});

window.saveNewUser = function () {
  const username = $('fNewUser').value.trim();
  const password = $('fNewPass').value;
  const role = $('fNewRole').value;
  if (!username || !password) { toast('Điền đầy đủ thông tin!', 'error'); return; }
  if (state.users.find(u => u.username === username)) { toast('Tên đăng nhập đã tồn tại!', 'error'); return; }

  let permissions = 'view';
  let label = 'Chỉ xem';
  if (role === 'admin') {
    permissions = 'view,add,edit,delete,invoice,approve,users,cats,reports,advances_edit,debts_edit';
    label = 'Quản trị viên';
  } else if (role === 'accountant') {
    permissions = 'view,add,edit,approve,cats,reports,advances_edit,debts_edit';
    label = 'Kế toán';
  } else if (role === 'treasurer') {
    permissions = 'view,advances_pay,debts_pay';
    label = 'Thủ quỹ';
  } else if (role === 'staff') {
    permissions = 'view_self_advances,advances_submit';
    label = 'Nhân viên';
  } else if (role === 'audit') {
    permissions = 'view,approve';
    label = 'Ban kiểm soát';
  }

  const newUser = { username, password, role, label, permissions };
  state.users.push(newUser);
  saveData();
  window.sendToCloud({ action: 'saveUser', user: newUser });
  closeModal();
  renderSettings();
  toast(`Đã thêm người dùng ${username} thành công!`);
};

window.deleteUser = function (username) {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  if (username === 'admin') return toast('Không thể xóa tài khoản Quản trị viên tối cao!', 'error');
  if (!confirm(`Xoá người dùng "${username}"?`)) return;
  state.users = state.users.filter(u => u.username !== username);
  saveData();
  window.sendToCloud({ action: 'deleteUser', username });
  renderSettings();
  toast('Đã xoá người dùng!');
};

/* BACKUP / RESTORE */
$('btnBackup').addEventListener('click', () => {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Nhật ký chung
  const sorted = [...state.entries].sort((a, b) => a.date.localeCompare(b.date));
  const entryData = sorted.map((e, i) => ({
    'STT': i + 1,
    'Ngày': formatDate(e.date),
    'Loại': e.type === 'thu' ? 'Thu' : 'Chi',
    'Danh mục': e.category,
    'Số tiền': e.amount,
    'Lý do': e.reason,
    'Người tạo': e.createdBy || '',
    'ID': e.id,
    'Ngày tạo': e.createdAt || '',
    'Date_raw': e.date,
    'Trạng thái duyệt': e.approvalStatus || ''
  }));
  const ws1 = XLSX.utils.json_to_sheet(entryData);
  ws1['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 8 }, { wch: 22 }, { wch: 18 }, { wch: 35 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Nhật Ký Chung');

  // Sheet 2: Người dùng
  const userData = state.users.map(u => ({
    'Tên đăng nhập': u.username,
    'Vai trò': u.label,
    'Mã vai trò': u.role,
    'Mật khẩu': u.password
  }));
  const ws2 = XLSX.utils.json_to_sheet(userData);
  ws2['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Người Dùng');

  // Sheet 3: Danh mục
  const cats = getCategories();
  const catData = [];
  (cats.thu || []).forEach(c => catData.push({ 'Loại': 'Thu', 'Tên danh mục': c }));
  (cats.chi || []).forEach(c => catData.push({ 'Loại': 'Chi', 'Tên danh mục': c }));
  const ws3 = XLSX.utils.json_to_sheet(catData);
  ws3['!cols'] = [{ wch: 8 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Danh Mục');

  downloadExcel(wb, `SaoLuu_ThuChi_${today()}.xlsx`);
  toast('Đã sao lưu dữ liệu dưới dạng Excel!');
});

$('btnRestore').addEventListener('change', function (e) {
  if (!hasPermission('users')) { toast('Bạn không có quyền!', 'error'); return; }
  const file = e.target.files[0];
  if (!file) return;
  const fileExt = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      if (fileExt === 'json') {
        const data = JSON.parse(ev.target.result);
        if (data.entries) state.entries = data.entries;
        if (data.users) state.users = data.users;
        if (data.categories) saveCategories(data.categories);
      } else {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });
        if (wb.SheetNames.includes('Nhật Ký Chung')) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets['Nhật Ký Chung']);
          state.entries = rows.map(r => {
            const typeRaw = (r['Loại'] || '').toString().toLowerCase();
            let date = r['Date_raw'] || '';
            if (!date) {
              const d = r['Ngày'] || '';
              if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) { const [dd, mm, yy] = d.split('/'); date = `${yy}-${mm}-${dd}`; }
              else date = String(d);
            }
            return {
              id: r['ID'] || uid(), type: typeRaw.includes('thu') ? 'thu' : 'chi',
              date, category: r['Danh mục'] || 'Khác', amount: parseInt(r['Số tiền'] || 0),
              reason: r['Lý do'] || '', createdBy: r['Người tạo'] || 'imported',
              createdAt: r['Ngày tạo'] || new Date().toISOString(),
              approvalStatus: r['Trạng thái duyệt'] || ''
            };
          }).filter(e => e.date && e.amount > 0);
        }
        if (wb.SheetNames.includes('Người Dùng')) {
          const uRows = XLSX.utils.sheet_to_json(wb.Sheets['Người Dùng']);
          state.users = uRows.map(r => ({
            username: r['Tên đăng nhập'], password: r['Mật khẩu'] || '123456',
            role: r['Mã vai trò'] || 'viewer', label: r['Vai trò'] || 'Chỉ xem'
          })).filter(u => u.username);
          if (!state.users.find(u => u.username === 'admin')) {
            state.users.unshift({ username: 'admin', password: 'admin123', role: 'admin', label: 'Quản trị viên' });
          }
        }
        if (wb.SheetNames.includes('Danh Mục')) {
          const cRows = XLSX.utils.sheet_to_json(wb.Sheets['Danh Mục']);
          const cats = { thu: [], chi: [] };
          cRows.forEach(r => {
            const t = (r['Loại'] || '').toLowerCase().includes('thu') ? 'thu' : 'chi';
            if (r['Tên danh mục']) cats[t].push(r['Tên danh mục']);
          });
          if (cats.thu.length || cats.chi.length) saveCategories(cats);
        }
      }
      saveData();
      window.sendToCloud({
        action: 'restoreAll',
        entries: state.entries,
        users: state.users,
        categories: getCategories()
      });
      renderDashboard();
      updateJournalView();
      renderSettings();
      toast('Đã khôi phục dữ liệu thành công!');
    } catch (err) { console.error(err); toast('File không hợp lệ! Hỗ trợ .json và .xlsx', 'error'); }
  };
  if (fileExt === 'json') reader.readAsText(file);
  else reader.readAsBinaryString(file);
  this.value = '';
});

$('btnClearData').addEventListener('click', () => {
  if (!confirm('XOÁ TẤT CẢ dữ liệu giao dịch? Hành động này không thể hoàn tác!')) return;
  state.entries = [];
  saveData();
  window.sendToCloud({ action: 'clearJournal' });
  renderDashboard();
  updateJournalView();
  toast('Đã xoá tất cả giao dịch!', 'info');
});

/* ===== CLEAR JOURNAL (admin) ===== */
$('btnClearJournal').addEventListener('click', () => {
  if (!hasPermission('delete')) return toast('Bạn không có quyền!', 'error');
  if (!confirm('XOÁ TOÀN BỘ sổ nhật ký chung? Hành động này không thể hoàn tác!')) return;
  state.entries = [];
  saveData();
  window.sendToCloud({ action: 'clearJournal' });
  updateJournalView();
  renderDashboard();
  toast('Đã xoá toàn bộ nhật ký chung!', 'info');
});

/* ===== GENERATE 1000 DEMO ===== */
$('btnGenDemo').addEventListener('click', () => {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  if (!confirm('Tạo 1000 mẫu dữ liệu demo? Dữ liệu hiện tại sẽ được giữ nguyên.')) return;
  const demos = generateDemoEntries(1000);
  state.entries = state.entries.concat(demos);
  saveData();
  window.sendToCloud({
    action: 'restoreAll',
    entries: state.entries,
    users: state.users,
    categories: getCategories()
  });
  renderDashboard();
  updateJournalView();
  toast('Đã tạo 1000 mẫu dữ liệu demo!', 'success');
});

/* ===== THEME IMPLEMENTATION ===== */
function initTheme() {
  const btn = $('btnThemeToggle');
  if (!btn) return;
  const currentTheme = localStorage.getItem('tc_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcon(currentTheme);
  
  btn.addEventListener('click', () => {
    const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tc_theme', theme);
    updateThemeIcon(theme);
    if (state.currentUser) {
      renderCharts();
      if ($('pageReports').classList.contains('active')) {
        generateReport();
      }
    }
  });

  initColorScheme();
}

function updateThemeIcon(theme) {
  const btn = $('btnThemeToggle');
  if (!btn) return;
  btn.innerHTML = theme === 'light' ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
}

/* ===== COLOR SCHEME IMPLEMENTATION ===== */
function initColorScheme() {
  const currentScheme = localStorage.getItem('tc_color_scheme') || 'indigo';
  document.documentElement.setAttribute('data-color-scheme', currentScheme);
  updateSchemeActiveDot(currentScheme);
  
  const dots = document.querySelectorAll('.dot-btn');
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const scheme = dot.dataset.scheme;
      document.documentElement.setAttribute('data-color-scheme', scheme);
      localStorage.setItem('tc_color_scheme', scheme);
      updateSchemeActiveDot(scheme);
      toast(`Đã đổi tông màu chủ đạo thành ${getSchemeName(scheme)}!`, 'success');
      
      if (state.currentUser) {
        renderCharts();
        if ($('pageReports').classList.contains('active')) {
          generateReport();
        }
      }
    });
  });
}

function updateSchemeActiveDot(scheme) {
  const dots = document.querySelectorAll('.dot-btn');
  dots.forEach(dot => {
    if (dot.dataset.scheme === scheme) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

function getSchemeName(scheme) {
  const names = { indigo: 'Indigo & Sky', emerald: 'Emerald & Mint', violet: 'Obsidian & Violet' };
  return names[scheme] || scheme;
}

/* ===== ADVANCES & SETTLEMENTS CRUD ===== */
window.renderAdvances = function() {
  const tbody = $('advancesTable');
  if (!tbody) return;

  let list = [...state.advances];
  const search = ($('advSearchInput')?.value || '').toLowerCase();
  const status = $('advFilterStatus')?.value || 'all';

  if (search) {
    list = list.filter(a => a.employee.toLowerCase().includes(search) || a.reason.toLowerCase().includes(search));
  }
  if (status !== 'all') {
    list = list.filter(a => a.status === status);
  }

  // Phân quyền giới hạn: Nhân viên (staff) chỉ được xem các đề xuất của chính mình
  if (state.currentUser && state.currentUser.role === 'staff') {
    list = list.filter(a => a.employee === state.currentUser.username);
  }

  // Sắp xếp theo ngày giảm dần
  list.sort((a, b) => b.date.localeCompare(a.date));

  tbody.innerHTML = list.map((a, i) => {
    let actionButtons = [];
    const isTreasurer = hasPermission('advances_pay');
    const isAccountantOrAdmin = hasPermission('advances_edit');
    const isSelf = state.currentUser && state.currentUser.username === a.employee;

    if (a.status === 'pending') {
      if (isTreasurer) {
        actionButtons.push(`<button class="btn btn-success btn-sm" onclick="payAdvance('${a.id}')"><i class="fas fa-check"></i> Duyệt chi</button>`);
      }
      if (isSelf || isAccountantOrAdmin) {
        actionButtons.push(`<button class="btn btn-danger btn-sm" onclick="deleteAdvance('${a.id}')" title="Xóa đề xuất"><i class="fas fa-trash"></i></button>`);
      }
    } else if (a.status === 'paid') {
      if (isSelf || isAccountantOrAdmin) {
        actionButtons.push(`<button class="btn btn-primary btn-sm" onclick="showSettlementForm('${a.id}')"><i class="fas fa-file-invoice-dollar"></i> Quyết toán hoàn ứng</button>`);
      }
    } else if (a.status === 'settled') {
      if (isAccountantOrAdmin) {
        actionButtons.push(`<button class="btn btn-danger btn-sm" onclick="deleteAdvance('${a.id}')" title="Xóa lịch sử"><i class="fas fa-trash"></i></button>`);
      }
    }

    const actionsHtml = actionButtons.length ? actionButtons.join(' ') : '<span style="color:var(--text2)">-</span>';

    // Hóa đơn hoàn ứng cell
    let invoiceHtml = '-';
    if (a.status === 'settled') {
      if (a.settlementInvoice) {
        if (a.settlementInvoice.startsWith('data:image/')) {
          invoiceHtml = `<img src="${a.settlementInvoice}" onclick="showInvoiceZoom('${a.settlementInvoice}', '${a.id}')" style="width:34px;height:34px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid var(--border)" title="Click để phóng to">`;
        } else {
          invoiceHtml = `<a href="${a.settlementInvoice}" target="_blank" style="color:#1a73e8;font-size:1.15rem;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);text-decoration:none" title="Xem chứng từ"><i class="fas fa-file-alt"></i></a>`;
        }
      } else {
        invoiceHtml = '<span style="color:var(--text2);font-size:0.75rem">Không có hóa đơn</span>';
      }
    }

    // Chênh lệch hoàn ứng cell
    let diffHtml = '-';
    if (a.status === 'settled') {
      const diff = a.settledAmount - a.amount;
      if (diff > 0) {
        diffHtml = `<span style="color:var(--red);font-weight:600">+${fmt(diff)}<br><small style="font-size:0.7rem;font-weight:normal">(Doanh nghiệp chi bù)</small></span>`;
      } else if (diff < 0) {
        diffHtml = `<span style="color:var(--green);font-weight:600">${fmt(diff)}<br><small style="font-size:0.7rem;font-weight:normal">(Thu hồi tiền thừa)</small></span>`;
      } else {
        diffHtml = '<span style="color:var(--text2)">Đủ hóa đơn</span>';
      }
    }

    // Trạng thái badge
    let statusBadge = '';
    if (a.status === 'pending') {
      statusBadge = '<span class="badge" style="background:rgba(245,158,11,.15);color:var(--yellow);border:1px solid rgba(245,158,11,.2)"><i class="fas fa-clock"></i> Chờ duyệt chi</span>';
    } else if (a.status === 'paid') {
      statusBadge = '<span class="badge" style="background:rgba(58,123,213,.15);color:#3a7bd5;border:1px solid rgba(58,123,213,.2)"><i class="fas fa-money-bill-wave"></i> Đã ứng (Chờ hoàn)</span>';
    } else if (a.status === 'settled') {
      statusBadge = '<span class="badge" style="background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.2)"><i class="fas fa-check-circle"></i> Đã quyết toán</span>';
    }

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${a.employee}</strong></td>
        <td style="font-weight:600;color:var(--text)">${fmt(a.amount)}</td>
        <td>${formatDate(a.date)}</td>
        <td>${a.reason}</td>
        <td style="text-align:center">${invoiceHtml}</td>
        <td style="text-align:right">${diffHtml}</td>
        <td>${statusBadge}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:30px">Chưa có đề xuất tạm ứng nào</td></tr>';
};

window.submitAdvanceProposal = function() {
  const isStaff = state.currentUser && state.currentUser.role === 'staff';
  const requesterHtml = isStaff 
    ? `<input type="text" id="advEmployee" value="${state.currentUser.username}" readonly style="background:rgba(255,255,255,0.05);color:var(--text2);width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">`
    : `<input type="text" id="advEmployee" placeholder="Nhập tên nhân viên đề xuất..." style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">`;
  
  openModal('Đề xuất tạm ứng mới', `
    <div class="form-group">
      <label>Nhân viên đề xuất</label>
      ${requesterHtml}
    </div>
    <div class="form-group">
      <label>Số tiền tạm ứng (₫)</label>
      <input type="text" id="advAmount" placeholder="Nhập số tiền tạm ứng..." style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
    </div>
    <div class="form-group">
      <label>Ngày tạm ứng</label>
      <input type="date" id="advDate" value="${today()}" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
    </div>
    <div class="form-group">
      <label>Lý do / Mục đích chi tạm ứng</label>
      <textarea id="advReason" placeholder="Mô tả chi tiết mục đích tạm ứng chi tiêu..." style="width:100%;height:70px;padding:8px;border-radius:6px;border:1px solid var(--border)"></textarea>
    </div>
    <div class="modal-actions" style="margin-top:15px">
      <button class="btn btn-primary" onclick="saveAdvanceProposal()"><i class="fas fa-plus"></i> Gửi đề xuất</button>
    </div>
  `);

  const advAmt = $('advAmount');
  if (advAmt) {
    advAmt.addEventListener('input', function () {
      const clean = this.value.replace(/\D/g, '');
      this.value = clean ? new Intl.NumberFormat('vi-VN').format(parseInt(clean)) : '';
    });
  }
};

window.saveAdvanceProposal = function() {
  const employee = $('advEmployee').value.trim();
  const amount = parseInt($('advAmount').value.replace(/\D/g, '')) || 0;
  const date = $('advDate').value;
  const reason = $('advReason').value.trim();

  if (!employee || !amount || amount <= 0 || !date || !reason) {
    toast('Vui lòng nhập đầy đủ thông tin đề xuất tạm ứng!', 'error');
    return;
  }

  const newAdv = {
    id: uid(),
    employee,
    amount,
    date,
    reason,
    status: 'pending',
    invoice: null,
    settledAmount: 0,
    settledDate: null,
    settlementInvoice: null
  };

  state.advances.push(newAdv);
  saveData();
  writeAuditLog('Tạo đề xuất tạm ứng', `Tài khoản ${state.currentUser.username} đề xuất tạm ứng ${fmt(amount)} cho nhân viên ${employee} - Lý do: ${reason}`);
  toast('Đã tạo đề xuất tạm ứng thành công!');
  closeModal();
  renderAdvances();
};

window.payAdvance = function(id) {
  if (!hasPermission('advances_pay')) return toast('Bạn không có quyền duyệt chi tạm ứng!', 'error');
  
  const adv = state.advances.find(a => a.id === id);
  if (!adv) return;

  if (!confirm(`Xác nhận DUYỆT CHI và trả số tiền tạm ứng ${fmt(adv.amount)} cho nhân viên ${adv.employee}?`)) return;

  adv.status = 'paid';
  
  // Tự động hạch toán phiếu chi tạm ứng vào Nhật ký chung
  const journalEntry = {
    id: uid(),
    type: 'chi',
    date: today(),
    category: 'Chi khác',
    amount: adv.amount,
    reason: `[Tạm ứng] Chi tiền tạm ứng cho nhân viên ${adv.employee} - Lý do: ${adv.reason}`,
    createdBy: state.currentUser.username,
    createdAt: new Date().toISOString(),
    approvalStatus: 'approved'
  };
  
  state.entries.push(journalEntry);
  rebuildIndexes();
  saveData();
  
  // Đồng bộ đám mây
  window.sendToCloud({ action: 'saveEntry', entry: journalEntry });
  
  writeAuditLog('Duyệt chi tạm ứng', `Duyệt chi số tiền ${fmt(adv.amount)} cho nhân viên ${adv.employee}`);
  toast(`Đã duyệt chi và ghi sổ quỹ số tiền ${fmt(adv.amount)} thành công!`);
  renderAdvances();
};

window.showSettlementForm = function(id) {
  const adv = state.advances.find(a => a.id === id);
  if (!adv) return;

  openModal('Hồ sơ Quyết toán Hoàn ứng', `
    <div style="margin-bottom: 12px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border); font-size: 0.85rem; line-height: 1.5;">
      <div><strong>Nhân viên đề xuất:</strong> ${adv.employee}</div>
      <div><strong>Số tiền đã tạm ứng:</strong> <span style="color:var(--primary); font-weight:600">${fmt(adv.amount)}</span></div>
      <div><strong>Ngày tạm ứng quỹ:</strong> ${formatDate(adv.date)}</div>
      <div><strong>Lý do tạm ứng:</strong> ${adv.reason}</div>
    </div>
    
    <div class="form-group">
      <label>Tổng số tiền chi tiêu thực tế trên hóa đơn đỏ (₫)</label>
      <input type="text" id="settleAmount" placeholder="Nhập số tiền thực chi trên hóa đơn..." style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
    </div>
    <div class="form-group">
      <label>Ngày hoàn ứng hóa đơn</label>
      <input type="date" id="settleDate" value="${today()}" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
    </div>
    <div class="form-group">
      <label>Hóa đơn đỏ / Chứng từ đính kèm (Tùy chọn - Chụp ảnh/Scan)</label>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input type="file" id="settleInvoiceFile" style="display:none">
        <button type="button" class="btn" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:6px 12px;font-size:0.8rem;border-radius:6px;cursor:pointer" onclick="$('settleInvoiceFile').click()"><i class="fas fa-upload"></i> Chọn ảnh hóa đơn</button>
        <span id="settleInvoiceStatus" style="font-size:0.78rem;color:var(--text2)">Chưa chọn file chứng từ</span>
      </div>
      <div id="settleInvoicePreviewContainer" style="display:none;position:relative;width:120px;height:120px;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
        <img id="settleInvoicePreview" src="" style="width:100%;height:100%;object-fit:cover;">
      </div>
    </div>
    <div class="modal-actions" style="margin-top:15px">
      <button class="btn btn-primary" onclick="submitSettlement('${id}')"><i class="fas fa-check"></i> Xác nhận hoàn ứng</button>
    </div>
  `);

  const settleAmt = $('settleAmount');
  if (settleAmt) {
    settleAmt.value = formatThousand(adv.amount); // pre-fill với số tiền đã ứng
    settleAmt.addEventListener('input', function () {
      const clean = this.value.replace(/\D/g, '');
      this.value = clean ? new Intl.NumberFormat('vi-VN').format(parseInt(clean)) : '';
    });
  }

  state.selectedSetInvoice = '';
  const settleFile = $('settleInvoiceFile');
  if (settleFile) {
    settleFile.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = function(event) {
        state.selectedSetInvoice = event.target.result;
        $('settleInvoiceStatus').textContent = file.name;
        const isImage = file.type.startsWith('image/');
        const preview = $('settleInvoicePreview');
        if (isImage) {
          preview.src = event.target.result;
          preview.style.objectFit = 'cover';
        } else {
          preview.src = 'https://cdn-icons-png.flaticon.com/512/2965/2965327.png';
          preview.style.objectFit = 'contain';
        }
        $('settleInvoicePreviewContainer').style.display = 'block';
      };
      reader.readAsDataURL(file);
    });
  }
};

window.submitSettlement = function(id) {
  const adv = state.advances.find(a => a.id === id);
  if (!adv) return;

  const spentAmount = parseInt($('settleAmount').value.replace(/\D/g, '')) || 0;
  const settleDate = $('settleDate').value;
  const settlementInvoice = state.selectedSetInvoice || '';

  if (!settleDate || spentAmount <= 0) {
    toast('Vui lòng nhập số tiền chi tiêu thực tế hợp lệ!', 'error');
    return;
  }

  adv.status = 'settled';
  adv.settledAmount = spentAmount;
  adv.settledDate = settleDate;
  adv.settlementInvoice = settlementInvoice;

  // 1. Tự động hạch toán khoản CHI TIÊU THỰC TẾ dựa theo hóa đơn
  const suggestedCategory = suggestCategoryAI(adv.reason, 'chi') || 'Chi khác';
  const expenseEntry = {
    id: uid(),
    type: 'chi',
    date: settleDate,
    category: suggestedCategory,
    amount: spentAmount,
    reason: `[Quyết toán Tạm ứng] Chi phí thực tế từ tạm ứng của nhân viên ${adv.employee} - ${adv.reason}`,
    invoice: settlementInvoice,
    createdBy: state.currentUser.username,
    createdAt: new Date().toISOString(),
    approvalStatus: 'approved'
  };
  state.entries.push(expenseEntry);
  window.sendToCloud({ action: 'saveEntry', entry: expenseEntry });

  // 2. Tính toán đối soát chênh lệch thừa/thiếu dòng tiền
  const diff = spentAmount - adv.amount;
  if (diff > 0) {
    // Chi thêm bù
    const repayEntry = {
      id: uid(),
      type: 'chi',
      date: settleDate,
      category: 'Chi khác',
      amount: diff,
      reason: `[Quyết toán Tạm ứng] Chi trả bù thêm hoàn ứng cho nhân viên ${adv.employee} (Chi thực tế: ${fmt(spentAmount)} vs Đã ứng: ${fmt(adv.amount)})`,
      createdBy: state.currentUser.username,
      createdAt: new Date().toISOString(),
      approvalStatus: 'approved'
    };
    state.entries.push(repayEntry);
    window.sendToCloud({ action: 'saveEntry', entry: repayEntry });
  } else if (diff < 0) {
    // Thu hồi tiền thừa
    const refundAmount = Math.abs(diff);
    const refundEntry = {
      id: uid(),
      type: 'thu',
      date: settleDate,
      category: 'Thu khác',
      amount: refundAmount,
      reason: `[Quyết toán Tạm ứng] Thu hồi tạm ứng thừa từ nhân viên ${adv.employee} (Chi thực tế: ${fmt(spentAmount)} vs Đã ứng: ${fmt(adv.amount)})`,
      createdBy: state.currentUser.username,
      createdAt: new Date().toISOString(),
      approvalStatus: 'approved'
    };
    state.entries.push(refundEntry);
    window.sendToCloud({ action: 'saveEntry', entry: refundEntry });
  }

  rebuildIndexes();
  saveData();
  
  writeAuditLog('Quyết toán tạm ứng', `Nhân viên ${adv.employee} hoàn ứng số tiền thực tế ${fmt(spentAmount)}, chênh lệch ${fmt(diff)}`);
  toast('Đã ghi sổ quyết toán hoàn ứng và đối soát chênh lệch tự động thành công!', 'success');
  closeModal();
  renderAdvances();
};

window.deleteAdvance = function(id) {
  if (!hasPermission('advances_edit')) return toast('Bạn không có quyền quản lý tạm ứng!', 'error');
  
  const advIdx = state.advances.findIndex(a => a.id === id);
  if (advIdx === -1) return;

  const adv = state.advances[advIdx];
  if (!confirm(`Xác nhận xóa hoàn toàn đề xuất tạm ứng của nhân viên ${adv.employee}?`)) return;

  state.advances.splice(advIdx, 1);
  saveData();
  
  writeAuditLog('Xóa tạm ứng', `Xóa lịch sử tạm ứng nhân viên ${adv.employee} trị giá ${fmt(adv.amount)}`);
  toast('Đã xóa dữ liệu tạm ứng thành công!');
  renderAdvances();
};


/* ===== DEBTS MANAGEMENT CRUD ===== */
window.renderDebts = function() {
  const tbody = $('debtsTable');
  if (!tbody) return;

  let list = [...state.debts];
  const search = ($('debtSearchInput')?.value || '').toLowerCase();
  const type = $('debtFilterType')?.value || 'all';
  const status = $('debtFilterStatus')?.value || 'all';

  if (search) {
    list = list.filter(d => d.partner.toLowerCase().includes(search) || d.reason.toLowerCase().includes(search));
  }
  if (type !== 'all') {
    list = list.filter(d => d.type === type);
  }
  if (status !== 'all') {
    list = list.filter(d => d.status === status);
  }

  // Sắp xếp hạn thanh toán gần nhất lên đầu
  list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  tbody.innerHTML = list.map((d, i) => {
    let actionButtons = [];
    const isTreasurer = hasPermission('debts_pay');
    const isAccountantOrAdmin = hasPermission('debts_edit');

    if (d.status === 'unpaid') {
      if (isTreasurer) {
        actionButtons.push(`<button class="btn btn-success btn-sm" onclick="payDebt('${d.id}')"><i class="fas fa-coins"></i> Thanh toán</button>`);
      }
      if (d.type === 'thu') {
        actionButtons.push(`<button class="btn btn-info btn-sm" onclick="showDebtReminderModal('${d.id}')" title="Gửi tin nhắn nhắc nợ"><i class="fas fa-bell"></i> Nhắc nợ</button>`);
      }
    }
    if (isAccountantOrAdmin) {
      actionButtons.push(`<button class="btn btn-danger btn-sm" onclick="deleteDebt('${d.id}')" title="Xóa công nợ"><i class="fas fa-trash"></i></button>`);
    }

    const actionsHtml = actionButtons.length ? actionButtons.join(' ') : '<span style="color:var(--text2)">-</span>';

    // Overdue check
    const isOverdue = d.dueDate < today() && d.status === 'unpaid';
    const dueDateText = isOverdue 
      ? `<span style="color:var(--red);font-weight:600"><i class="fas fa-exclamation-triangle"></i> ${formatDate(d.dueDate)}<br><small style="font-size:0.65rem">(Quá hạn!)</small></span>`
      : formatDate(d.dueDate);

    // Type text
    const typeText = d.type === 'thu' 
      ? '<span class="badge" style="background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.2)"><i class="fas fa-arrow-down"></i> Phải thu (Khách)</span>' 
      : '<span class="badge" style="background:rgba(244,63,94,.15);color:var(--red);border:1px solid rgba(244,63,94,.2)"><i class="fas fa-arrow-up"></i> Phải trả (NCC)</span>';

    // Status text
    const statusText = d.status === 'paid'
      ? '<span class="badge" style="background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.2)"><i class="fas fa-check-circle"></i> Đã thanh toán</span>'
      : '<span class="badge" style="background:rgba(245,158,11,.15);color:var(--yellow);border:1px solid rgba(245,158,11,.2)"><i class="fas fa-exclamation-circle"></i> Chưa thanh toán</span>';

    return `
      <tr>
        <td>${i + 1}</td>
        <td>${typeText}</td>
        <td><strong>${d.partner}</strong></td>
        <td style="font-weight:600;color:var(--text);text-align:right">${fmt(d.amount)}</td>
        <td style="text-align:center">${dueDateText}</td>
        <td>${d.reason}</td>
        <td>${statusText}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:30px">Chưa có công nợ nào phát sinh</td></tr>';

  // Cập nhật thẻ tổng số liệu công nợ
  const totalReceivables = state.debts.filter(d => d.type === 'thu' && d.status === 'unpaid').reduce((s, d) => s + d.amount, 0);
  const totalPayables = state.debts.filter(d => d.type === 'chi' && d.status === 'unpaid').reduce((s, d) => s + d.amount, 0);

  const totalRecEl = $('debtTotalReceivable');
  const totalPayEl = $('debtTotalPayable');
  if (totalRecEl) totalRecEl.textContent = fmt(totalReceivables);
  if (totalPayEl) totalPayEl.textContent = fmt(totalPayables);
};

window.submitNewDebt = function() {
  openModal('Ghi nhận công nợ mới', `
    <div class="form-group">
      <label>Loại công nợ</label>
      <select id="debtType" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
        <option value="thu">Phải thu (Khách hàng nợ doanh nghiệp)</option>
        <option value="chi">Phải trả (Doanh nghiệp nợ nhà cung cấp)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Đối tác / Khách hàng / Nhà cung cấp</label>
      <input type="text" id="debtPartner" placeholder="Nhập tên đối tác phát sinh công nợ..." style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
    </div>
    <div class="form-group">
      <label>Số tiền công nợ (₫)</label>
      <input type="text" id="debtAmount" placeholder="Nhập số tiền công nợ..." style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
    </div>
    <div class="form-group">
      <label>Hạn thanh toán</label>
      <input type="date" id="debtDueDate" value="${today()}" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
    </div>
    <div class="form-group">
      <label>Nội dung / Diễn giải khoản công nợ</label>
      <textarea id="debtReason" placeholder="Ví dụ: 'Phần tiền còn nợ lại của đơn sỉ hàng may mặc'..." style="width:100%;height:70px;padding:8px;border-radius:6px;border:1px solid var(--border)"></textarea>
    </div>
    <div class="modal-actions" style="margin-top:15px">
      <button class="btn btn-primary" onclick="saveNewDebt()"><i class="fas fa-plus"></i> Thêm công nợ</button>
    </div>
  `);

  const debtAmt = $('debtAmount');
  if (debtAmt) {
    debtAmt.addEventListener('input', function () {
      const clean = this.value.replace(/\D/g, '');
      this.value = clean ? new Intl.NumberFormat('vi-VN').format(parseInt(clean)) : '';
    });
  }
};

window.saveNewDebt = function() {
  const type = $('debtType').value;
  const partner = $('debtPartner').value.trim();
  const amount = parseInt($('debtAmount').value.replace(/\D/g, '')) || 0;
  const dueDate = $('debtDueDate').value;
  const reason = $('debtReason').value.trim();

  if (!partner || !amount || amount <= 0 || !dueDate || !reason) {
    toast('Vui lòng nhập đầy đủ thông tin công nợ!', 'error');
    return;
  }

  const newDebt = {
    id: uid(),
    type,
    partner,
    amount,
    dueDate,
    reason,
    status: 'unpaid',
    paymentDate: null
  };

  state.debts.push(newDebt);
  saveData();
  
  const typeLabel = type === 'thu' ? 'phải thu' : 'phải trả';
  writeAuditLog('Ghi công nợ', `Tạo công nợ ${typeLabel} đối tác ${partner} số tiền ${fmt(amount)} - Hạn thanh toán: ${formatDate(dueDate)}`);
  toast('Đã ghi nhận công nợ mới thành công!');
  closeModal();
  renderDebts();
};

window.payDebt = function(id) {
  if (!hasPermission('debts_pay')) return toast('Bạn không có quyền thanh toán công nợ!', 'error');
  
  const debt = state.debts.find(d => d.id === id);
  if (!debt) return;

  const actionText = debt.type === 'thu' ? 'THU TIỀN' : 'THANH TOÁN';
  if (!confirm(`Xác nhận đối soát ${actionText} số tiền công nợ ${fmt(debt.amount)} của đối tác ${debt.partner}?`)) return;

  debt.status = 'paid';
  debt.paymentDate = today();
  
  // Tự động hạch toán Phiếu Thu/Chi đối chiếu công nợ vào Nhật ký chung
  const journalEntry = {
    id: uid(),
    type: debt.type, // 'thu' thì tạo Phiếu Thu tiền mặt, 'chi' thì tạo Phiếu Chi
    date: today(),
    category: debt.type === 'thu' ? 'Thu khác' : 'Chi khác',
    amount: debt.amount,
    reason: `[Công nợ] ${debt.type === 'thu' ? 'Thu hồi công nợ từ' : 'Thanh toán công nợ cho'} đối tác ${debt.partner} - Nội dung: ${debt.reason}`,
    createdBy: state.currentUser.username,
    createdAt: new Date().toISOString(),
    approvalStatus: 'approved'
  };

  state.entries.push(journalEntry);
  rebuildIndexes();
  saveData();
  
  // Đồng bộ đám mây
  window.sendToCloud({ action: 'saveEntry', entry: journalEntry });
  
  writeAuditLog('Thanh toán công nợ', `Hạch toán thanh toán đối soát công nợ đối tác ${debt.partner} số tiền ${fmt(debt.amount)}`);
  toast(`Đã hạch toán đối soát công nợ thành công!`, 'success');
  renderDebts();
};

window.deleteDebt = function(id) {
  if (!hasPermission('debts_edit')) return toast('Bạn không có quyền quản lý công nợ!', 'error');
  
  const debtIdx = state.debts.findIndex(d => d.id === id);
  if (debtIdx === -1) return;

  const debt = state.debts[debtIdx];
  if (!confirm(`Xác nhận xóa hoàn toàn công nợ đối tác ${debt.partner}?`)) return;

  state.debts.splice(debtIdx, 1);
  saveData();
  
  writeAuditLog('Xóa công nợ', `Xóa công nợ đối tác ${debt.partner} trị giá ${fmt(debt.amount)}`);
  toast('Đã xóa công nợ thành công!');
  renderDebts();
};

window.showDebtReminderModal = function(id) {
  const debt = state.debts.find(d => d.id === id);
  if (!debt) return;

  const reminderMsg = `Kính gửi Quý đối tác ${debt.partner},\n\nHệ thống tài chính xin thông báo khoản công nợ của Quý đối tác trị giá ${fmt(debt.amount)} (Nội dung: ${debt.reason}) chưa hoàn tất hạch toán.\n\nHạn thanh toán: ${formatDate(debt.dueDate)}.\n\nKính mong Quý đối tác sắp xếp thanh toán sớm để đảm bảo cân đối dòng tiền kỳ này. Xin chân thành cảm ơn!`;

  openModal('Gửi Tin Nhắn Nhắc Nợ Công Ty', `
    <div style="font-size:0.9rem;line-height:1.5">
      <p style="color:var(--text2);margin-bottom:12px">Mẫu nhắc nợ chuyên nghiệp được soạn sẵn tự động. Bạn có thể sao chép hoặc gửi trực tiếp qua các mạng xã hội:</p>
      
      <textarea id="debtReminderText" style="width:100%;height:140px;margin-bottom:15px;font-family:inherit;font-size:0.85rem;padding:8px;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,0.02)">${reminderMsg}</textarea>
      
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="copyReminderText()"><i class="fas fa-copy"></i> Sao chép tin nhắn</button>
        <a href="https://t.me/share/url?url=${encodeURIComponent(reminderMsg)}" target="_blank" class="btn btn-info" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px"><i class="fab fa-telegram"></i> Gửi Telegram</a>
        <a href="https://zalo.me/" target="_blank" class="btn btn-success" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;background:#0068ff;border-color:#0068ff"><i class="fas fa-comment-dots"></i> Mở Zalo Web</a>
      </div>
    </div>
  `);

  window.copyReminderText = function() {
    const txt = $('debtReminderText');
    txt.select();
    txt.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(txt.value);
    toast('Đã sao chép tin nhắn nhắc nợ thành công!');
  };
};


/* ===== AI SEMANTIC NATURAL LANGUAGE QUICK ENTRY ===== */
window.parseNaturalLanguage = function(text) {
  if (!text) return null;
  
  // Clean dots/commas between thousands (e.g. 1.200.000 or 150,000)
  let cleanText = text.replace(/(\d)[.](\d{3})/g, '$1$2').replace(/(\d)[,](\d{3})/g, '$1$2');
  
  // Parse type (thu/chi)
  let type = 'chi';
  const thuKeywords = ['thu', 'nhận', 'thu về', 'bán', 'cộng', '+', 'doanh thu', 'lãi', 'hoàn ứng', 'thu hồi'];
  const chiKeywords = ['chi', 'trả', 'mua', 'trừ', '-', 'tiêu', 'khoản chi', 'lương', 'tiền', 'tạm ứng', 'nộp'];
  
  let thuHits = 0;
  let chiHits = 0;
  const lowerText = cleanText.toLowerCase();
  
  thuKeywords.forEach(k => { if (lowerText.includes(k)) thuHits++; });
  chiKeywords.forEach(k => { if (lowerText.includes(k)) chiHits++; });
  
  if (thuHits > chiHits) {
    type = 'thu';
  }
  
  // Parse amount (Matches 150k, 1.5tr, 10tr, 500000)
  let amount = 0;
  const amountRegex = /(\d+(?:[.,]\d+)?)\s*(k|tr|triệu|nghìn|ngàn|đ|đồng|đông)?/gi;
  let match;
  let matches = [];
  while ((match = amountRegex.exec(cleanText)) !== null) {
    matches.push(match);
  }
  
  if (matches.length > 0) {
    const primaryMatch = matches[0];
    let valStr = primaryMatch[1].replace(',', '.');
    let val = parseFloat(valStr);
    let unit = (primaryMatch[2] || '').toLowerCase();
    
    if (unit.includes('k') || unit.includes('nghìn') || unit.includes('ngàn')) {
      val *= 1000;
    } else if (unit.includes('tr') || unit.includes('triệu')) {
      val *= 1000000;
    }
    amount = Math.round(val);
  }
  
  // Suggest category using rule-based AI in data.js
  const suggestedCategory = suggestCategoryAI(cleanText, type) || (type === 'thu' ? 'Thu khác' : 'Chi khác');
  
  return {
    type,
    amount,
    category: suggestedCategory,
    reason: text
  };
};

window.openNaturalLanguageModal = function() {
  openModal('Trí Tuệ Nhân Tạo AI: Nhập Liệu Tự Nhiên', `
    <div style="font-size:0.9rem;line-height:1.5">
      <p style="color:var(--text2);margin-bottom:12px">Nhập nội dung giao dịch bằng tiếng Việt tự nhiên. AI sẽ tự động bóc tách số tiền, đề xuất danh mục thu/chi và hoàn thiện phiếu ghi sổ:</p>
      
      <div class="form-group">
        <textarea id="nlpInputText" placeholder="Ví dụ: 'mua nước cafe tiếp khách hết 150k' hoặc 'doanh thu bán sỉ nhận tiền mặt 10tr'..." style="width:100%;height:100px;padding:8px;border-radius:6px;border:1px solid var(--border);margin-bottom:12px"></textarea>
      </div>
      
      <div style="text-align:right">
        <button class="btn btn-primary" onclick="processNlpText()"><i class="fas fa-magic"></i> Phân tích giao dịch</button>
      </div>
      
      <div id="nlpResultPreview" style="display:none;margin-top:20px;padding-top:16px;border-top:1px dashed var(--border)">
        <h5 style="margin-bottom:12px;color:var(--primary);font-size:0.95rem"><i class="fas fa-check-double"></i> Kết quả phân tích & Đề xuất định khoản của AI:</h5>
        
        <div class="form-group">
          <label>Loại giao dịch</label>
          <select id="nlpType" onchange="updateNlpCatOptions()" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
            <option value="thu">Thu (Tiền vào)</option>
            <option value="chi">Chi (Tiền ra)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Danh mục hạch toán</label>
          <select id="nlpCat" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)"></select>
        </div>
        <div class="form-group">
          <label>Số tiền giao dịch (₫)</label>
          <input type="text" id="nlpAmount" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border)">
        </div>
        <div class="form-group">
          <label>Lý do / Nội dung ghi sổ</label>
          <textarea id="nlpReason" style="width:100%;height:60px;padding:8px;border-radius:6px;border:1px solid var(--border)"></textarea>
        </div>
        
        <div class="modal-actions" style="margin-top:15px">
          <button class="btn btn-success" onclick="submitNlpEntry()"><i class="fas fa-save"></i> Đồng ý ghi sổ quỹ</button>
        </div>
      </div>
    </div>
  `);
  
  const nlpInput = $('nlpInputText');
  if (nlpInput) nlpInput.focus();
};

window.processNlpText = function() {
  const text = $('nlpInputText').value.trim();
  if (!text) return toast('Vui lòng nhập nội dung để phân tích!', 'error');

  const parsed = parseNaturalLanguage(text);
  if (!parsed) return toast('Không thể phân tích dữ liệu!', 'error');

  $('nlpType').value = parsed.type;
  
  // Cập nhật danh sách option và chọn category đề xuất
  $('nlpCat').innerHTML = window.getCatOptionsHtml(parsed.type, parsed.category);
  $('nlpCat').value = parsed.category;
  
  $('nlpAmount').value = formatThousand(parsed.amount);
  
  const amtInput = $('nlpAmount');
  if (amtInput) {
    amtInput.addEventListener('input', function () {
      const clean = this.value.replace(/\D/g, '');
      this.value = clean ? new Intl.NumberFormat('vi-VN').format(parseInt(clean)) : '';
    });
  }
  
  $('nlpReason').value = parsed.reason;
  
  $('nlpResultPreview').style.display = 'block';
  toast('AI đã phân tích và phân loại danh mục thành công!', 'success');
};

window.updateNlpCatOptions = function() {
  const type = $('nlpType').value;
  $('nlpCat').innerHTML = window.getCatOptionsHtml(type);
};

window.submitNlpEntry = function() {
  const type = $('nlpType').value;
  const category = $('nlpCat').value;
  const amount = parseInt($('nlpAmount').value.replace(/\D/g, '')) || 0;
  const reason = $('nlpReason').value.trim();

  if (!amount || amount <= 0 || !reason) {
    toast('Vui lòng nhập đầy đủ thông tin giao dịch!', 'error');
    return;
  }

  const entry = {
    id: uid(),
    type,
    date: today(),
    category,
    amount,
    reason,
    invoice: '',
    createdBy: state.currentUser.username,
    createdAt: new Date().toISOString()
  };

  state.entries.push(entry);
  rebuildIndexes();
  saveData();

  // Sync lên cloud
  window.sendToCloud({ action: 'saveEntry', entry });

  toast('Đã hạch toán thành công giao dịch vào sổ quỹ!', 'success');
  closeModal();
  updateJournalView();
  renderDashboard();
};

window.quickInsertEntry = function(type, category, amount, reason) {
  if (!hasPermission('add')) return toast('Bạn không có quyền ghi sổ giao dịch!', 'error');

  const entry = {
    id: uid(),
    type,
    date: today(),
    category,
    amount,
    reason,
    invoice: '',
    createdBy: state.currentUser.username,
    createdAt: new Date().toISOString()
  };

  state.entries.push(entry);
  rebuildIndexes();
  saveData();

  // Sync lên cloud
  window.sendToCloud({ action: 'saveEntry', entry });

  toast(`Đã nhập siêu tốc: ${type === 'thu' ? '+' : '-'}${fmt(amount)} vào nhật ký chung!`, 'success');
  renderDashboard();
};


/* ===== P&L REPORT & MOVING CASH FORECAST MODULE ===== */
window.updatePLStatement = function(list) {
  // 1. Phân tích doanh số đầu thu (Revenue)
  const sales = list.filter(e => e.type === 'thu' && (e.category === 'Doanh thu bán hàng' || e.category.toLowerCase().includes('bán hàng'))).reduce((s, e) => s + e.amount, 0);
  const service = list.filter(e => e.type === 'thu' && (e.category === 'Dịch vụ' || e.category.toLowerCase().includes('dịch vụ'))).reduce((s, e) => s + e.amount, 0);
  const totalIncome = list.filter(e => e.type === 'thu').reduce((s, e) => s + e.amount, 0);
  const otherIncome = totalIncome - sales - service;

  $('plSalesRevenue').textContent = fmt(sales);
  $('plServiceRevenue').textContent = fmt(service);
  $('plNetRevenue').textContent = fmt(totalIncome);

  // 2. Phân tích giá vốn & chi phí trực tiếp (COGS)
  const rawMat = list.filter(e => e.type === 'chi' && (e.category === 'Nguyên vật liệu' || e.category.toLowerCase().includes('nguyên liệu') || e.category.toLowerCase().includes('vật tư'))).reduce((s, e) => s + e.amount, 0);
  const delivery = list.filter(e => e.type === 'chi' && (e.category === 'Vận chuyển' || e.category.toLowerCase().includes('vận chuyển') || e.category.toLowerCase().includes('ship') || e.category.toLowerCase().includes('xăng'))).reduce((s, e) => s + e.amount, 0);
  const totalCOGS = rawMat + delivery;

  $('plRawMatCost').textContent = fmt(rawMat);
  $('plDeliveryCost').textContent = fmt(delivery);
  $('plCOGS').textContent = fmt(totalCOGS);

  // 3. Tính toán lợi nhuận gộp (Gross Profit)
  const grossProfit = totalIncome - totalCOGS;
  $('plGrossProfit').textContent = fmt(grossProfit);
  $('plGrossProfit').style.color = grossProfit >= 0 ? 'var(--blue)' : 'var(--red)';

  // 4. Phân tích chi phí vận hành cố định & biến đổi (OPEX)
  const staff = list.filter(e => e.type === 'chi' && (e.category === 'Nhân công' || e.category.toLowerCase().includes('nhân sự') || e.category.toLowerCase().includes('lương'))).reduce((s, e) => s + e.amount, 0);
  const rent = list.filter(e => e.type === 'chi' && (e.category === 'Thuê mặt bằng' || e.category.toLowerCase().includes('thuê văn phòng') || e.category.toLowerCase().includes('mặt bằng'))).reduce((s, e) => s + e.amount, 0);
  const marketing = list.filter(e => e.type === 'chi' && (e.category === 'Marketing' || e.category.toLowerCase().includes('quảng cáo') || e.category.toLowerCase().includes('ads'))).reduce((s, e) => s + e.amount, 0);
  const utilities = list.filter(e => e.type === 'chi' && (e.category === 'Điện nước' || e.category.toLowerCase().includes('điện') || e.category.toLowerCase().includes('nước') || e.category.toLowerCase().includes('mạng') || e.category.toLowerCase().includes('internet'))).reduce((s, e) => s + e.amount, 0);
  const device = list.filter(e => e.type === 'chi' && (e.category === 'Thiết bị' || e.category.toLowerCase().includes('thiết bị') || e.category.toLowerCase().includes('máy tính') || e.category.toLowerCase().includes('máy in'))).reduce((s, e) => s + e.amount, 0);
  
  const totalExpense = list.filter(e => e.type === 'chi').reduce((s, e) => s + e.amount, 0);
  const otherOPEX = totalExpense - totalCOGS - staff - rent - marketing - utilities - device;

  $('plStaffCost').textContent = fmt(staff);
  $('plRentCost').textContent = fmt(rent);
  $('plMarketingCost').textContent = fmt(marketing);
  $('plUtilityCost').textContent = fmt(utilities);
  $('plDeviceCost').textContent = fmt(device);
  $('plOtherOPEX').textContent = fmt(otherOPEX >= 0 ? otherOPEX : 0);

  const totalOPEX = staff + rent + marketing + utilities + device + (otherOPEX >= 0 ? otherOPEX : 0);
  $('plOPEX').textContent = fmt(totalOPEX);

  // 5. Lợi nhuận ròng cuối kỳ (Net Profit)
  const netProfit = grossProfit - totalOPEX;
  $('plNetProfit').textContent = fmt(netProfit);
  $('plNetProfit').style.color = netProfit >= 0 ? 'var(--green)' : 'var(--red)';

  // 6. Kích hoạt báo cáo phân tích CFO bằng trí tuệ nhân tạo
  generateAICommentary(totalIncome, totalCOGS, totalOPEX, netProfit, { sales, service, rawMat, delivery, staff, rent, marketing, utilities, device });
};

window.generateAICommentary = function(revenue, cogs, opex, profit, details) {
  const container = $('aiPLCommentaryContent');
  if (!container) return;

  if (revenue === 0) {
    container.innerHTML = '<span style="color:var(--text2)">Chưa ghi nhận dòng doanh thu nào trong kỳ này để Trợ lý CFO tiến hành phân tích hiệu năng.</span>';
    return;
  }

  let text = '';
  const profitMargin = (profit / revenue) * 100;
  
  if (profit > 0) {
    text += `🎉 <strong>TÌNH HÌNH TÀI CHÍNH KHỎE MẠNH:</strong> Kỳ này doanh nghiệp ghi nhận mức tăng trưởng có lợi nhuận ròng đạt tỷ suất biên là <strong>${profitMargin.toFixed(1)}%</strong> trên tổng doanh thu. Đây là tín hiệu rất tích cực.<br><br>`;
  } else {
    text += `⚠️ <strong>CẢNH BÁO TỐI NGUY HIỂM - THÂM HỤT RÒNG:</strong> Lợi nhuận ròng của kỳ này đang bị âm <strong>${fmt(Math.abs(profit))}</strong>. Doanh nghiệp đang tiêu tiền nhiều hơn thu vào.<br><br>`;
  }

  // Tách biệt rò rỉ dòng tiền (Leak Analysis)
  let leakAnalysis = [];
  const cogsRatio = (cogs / revenue) * 100;
  const opexRatio = (opex / revenue) * 100;

  if (cogsRatio > 50) {
    leakAnalysis.push(`- <strong>Giá vốn trực tiếp (COGS) quá cao (${cogsRatio.toFixed(1)}% doanh thu):</strong> Chi phí nhập nguyên vật liệu, vật tư và giao nhận hàng (${fmt(cogs)}) đang bào mòn biên lợi nhuận gộp.`);
  }
  if (opexRatio > 40) {
    leakAnalysis.push(`- <strong>Chi phí quản lý vận hành (OPEX) cồng kềnh (${opexRatio.toFixed(1)}% doanh thu):</strong> Tổng chi phí văn phòng và nhân công cố định là ${fmt(opex)}.`);
  }

  // Phân tích chi phí cao nhất
  const opexNames = ['Lương & Nhân công', 'Thuê mặt bằng', 'Marketing quảng cáo', 'Điện nước utilities', 'Thiết bị máy móc'];
  const opexVals = [details.staff, details.rent, details.marketing, details.utilities, details.device];
  const maxIdx = opexVals.indexOf(Math.max(...opexVals));
  if (opexVals[maxIdx] > 0 && opexVals[maxIdx] / revenue > 0.15) {
    leakAnalysis.push(`- <strong>Điểm rò rỉ chính là ${opexNames[maxIdx]}:</strong> Chi phí này đang chiếm tới <strong>${fmt(opexVals[maxIdx])}</strong> (${((opexVals[maxIdx]/revenue)*100).toFixed(1)}% doanh thu).`);
  }

  if (leakAnalysis.length > 0) {
    text += `🔍 <strong>Các lỗ hổng dòng tiền phát hiện tự động:</strong><br>${leakAnalysis.join('<br>')}<br><br>`;
  } else {
    text += `✅ <strong>HỆ THỐNG VẬN HÀNH TỐI ƯU:</strong> Chỉ số giá vốn (${cogsRatio.toFixed(1)}%) và chi phí vận hành (${opexRatio.toFixed(1)}%) đang nằm trong ngưỡng kiểm soát lý tưởng.<br><br>`;
  }

  // Ý kiến tư vấn của CFO (Executive CFO Recommendations)
  text += `💡 <strong>Khuyến nghị chiến lược CFO Việt Nam:</strong><br>`;
  if (profit <= 0 || cogsRatio > 50 || opexRatio > 40) {
    if (cogsRatio > 50) {
      text += `1. Xem xét đàm phán lại hợp đồng khung với nhà cung ứng vật tư lớn hoặc tối ưu lại quy trình vận chuyển giao vận để cắt giảm giá vốn.<br>`;
    }
    if (details.marketing / revenue > 0.20) {
      text += `2. Cắt giảm ngay các chiến dịch quảng cáo không sinh chuyển đổi trực tiếp. Giảm ngân sách Marketing (${fmt(details.marketing)}) chỉ giữ các phễu cốt lõi.<br>`;
    }
    if (details.staff / revenue > 0.30) {
      text += `3. Định biên lại năng suất lao động, tối ưu hiệu năng nhân sự cố định, cắt giảm giờ làm thêm không cấp thiết.<br>`;
    }
    text += `4. Trì hoãn tạm thời các dự án mua sắm máy móc thiết bị văn phòng chưa tạo ra tiền ngay lập tức, siết định mức chi vặt nội bộ.<br>`;
  } else {
    text += `1. Tiếp tục đẩy mạnh phễu bán lẻ sinh lời cao hiện tại và giữ vững định biên kiểm soát OPEX.<br>`;
    text += `2. Trích lập quỹ dự phòng dòng tiền 3 tháng vận hành và cân nhắc giải ngân mở rộng sản xuất hoặc tối ưu sớm công nợ NCC để hưởng chiết khấu trả sớm.<br>`;
  }

  container.innerHTML = text;
};

window.exportPLToExcel = function() {
  const from = $('rptFrom').value;
  const to = $('rptTo').value;
  let list = state.entries;
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);

  const sales = list.filter(e => e.type === 'thu' && (e.category === 'Doanh thu bán hàng' || e.category.toLowerCase().includes('bán hàng'))).reduce((s, e) => s + e.amount, 0);
  const service = list.filter(e => e.type === 'thu' && (e.category === 'Dịch vụ' || e.category.toLowerCase().includes('dịch vụ'))).reduce((s, e) => s + e.amount, 0);
  const totalIncome = list.filter(e => e.type === 'thu').reduce((s, e) => s + e.amount, 0);
  const otherIncome = totalIncome - sales - service;

  const rawMat = list.filter(e => e.type === 'chi' && (e.category === 'Nguyên vật liệu' || e.category.toLowerCase().includes('nguyên liệu') || e.category.toLowerCase().includes('vật tư'))).reduce((s, e) => s + e.amount, 0);
  const delivery = list.filter(e => e.type === 'chi' && (e.category === 'Vận chuyển' || e.category.toLowerCase().includes('vận chuyển') || e.category.toLowerCase().includes('ship'))).reduce((s, e) => s + e.amount, 0);
  const totalCOGS = rawMat + delivery;
  const grossProfit = totalIncome - totalCOGS;

  const staff = list.filter(e => e.type === 'chi' && (e.category === 'Nhân công' || e.category.toLowerCase().includes('nhân sự') || e.category.toLowerCase().includes('lương'))).reduce((s, e) => s + e.amount, 0);
  const rent = list.filter(e => e.type === 'chi' && (e.category === 'Thuê mặt bằng' || e.category.toLowerCase().includes('mặt bằng'))).reduce((s, e) => s + e.amount, 0);
  const marketing = list.filter(e => e.type === 'chi' && (e.category === 'Marketing' || e.category.toLowerCase().includes('quảng cáo'))).reduce((s, e) => s + e.amount, 0);
  const utilities = list.filter(e => e.type === 'chi' && (e.category === 'Điện nước' || e.category.toLowerCase().includes('điện') || e.category.toLowerCase().includes('nước'))).reduce((s, e) => s + e.amount, 0);
  const device = list.filter(e => e.type === 'chi' && (e.category === 'Thiết bị' || e.category.toLowerCase().includes('thiết bị'))).reduce((s, e) => s + e.amount, 0);
  const totalExpense = list.filter(e => e.type === 'chi').reduce((s, e) => s + e.amount, 0);
  const otherOPEX = totalExpense - totalCOGS - staff - rent - marketing - utilities - device;
  const totalOPEX = staff + rent + marketing + utilities + device + (otherOPEX >= 0 ? otherOPEX : 0);
  const netProfit = grossProfit - totalOPEX;

  const data = [
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '1. DOANH THU THUẦN (Doanh số bán hàng & Dịch vụ)', 'Số tiền hạch toán (₫)': totalIncome },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Doanh thu bán hàng', 'Số tiền hạch toán (₫)': sales },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Doanh thu cung cấp dịch vụ', 'Số tiền hạch toán (₫)': service },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Doanh thu hoạt động khác & Tài chính', 'Số tiền hạch toán (₫)': otherIncome },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '2. GIÁ VỐN HÀNG BÁN & CHI PHÍ TRỰC TIẾP (COGS)', 'Số tiền hạch toán (₫)': totalCOGS },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Nhập nguyên vật liệu / Hàng hóa nhập kho', 'Số tiền hạch toán (₫)': rawMat },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Chi phí vận chuyển / Giao nhận / Grab', 'Số tiền hạch toán (₫)': delivery },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '3. LỢI NHUẬN GỘP (Doanh thu - Giá vốn)', 'Số tiền hạch toán (₫)': grossProfit },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '4. CHI PHÍ VẬN HÀNH DOANH NGHIỆP (OPEX)', 'Số tiền hạch toán (₫)': totalOPEX },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Lương thưởng cố định & BHXH nhân sự', 'Số tiền hạch toán (₫)': staff },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Thuê văn phòng / Mặt bằng kinh doanh', 'Số tiền hạch toán (₫)': rent },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Quảng cáo Facebook / Google / Ads', 'Số tiền hạch toán (₫)': marketing },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Điện, nước, internet, mạng viễn thông', 'Số tiền hạch toán (₫)': utilities },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Mua máy móc, bàn ghế, thiết bị phần cứng', 'Số tiền hạch toán (₫)': device },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '   - Chi phí văn phòng phẩm & các khoản chi vặt khác', 'Số tiền hạch toán (₫)': otherOPEX >= 0 ? otherOPEX : 0 },
    { 'Chỉ tiêu Báo cáo Kết quả Kinh doanh (P&L)': '5. LỢI NHUẬN RÒNG CUỐI KỲ (Gross Profit - OPEX)', 'Số tiền hạch toán (₫)': netProfit }
  ];

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 60 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo P&L nội bộ');
  downloadExcel(wb, `BaoCao_PL_${today()}.xlsx`);
  toast('Đã kết xuất và tải báo cáo P&L nội bộ thành công!');
};

window.generateForecastChart = function() {
  const canvas = $('chartForecast');
  if (!canvas) return;

  const list = [...state.entries].sort((a, b) => a.date.localeCompare(b.date));
  if (list.length < 2) {
    const alertBox = $('forecastAlertBox');
    if (alertBox) {
      alertBox.style.display = 'block';
      alertBox.style.background = 'rgba(255,255,255,0.03)';
      alertBox.style.color = 'var(--text2)';
      alertBox.innerHTML = '⚠️ Chưa đủ số lượng giao dịch lịch sử tối thiểu (ít nhất 2 ngày) để chạy mô hình hồi quy tuyến tính dự báo xu hướng dòng tiền.';
    }
    return;
  }

  // 1. Nhóm và tính toán số dư quỹ lũy kế theo ngày thực tế
  let balance = 0;
  const dailyBalances = [];
  
  list.forEach(e => {
    if (e.type === 'thu') balance += e.amount;
    else balance -= e.amount;
    
    const last = dailyBalances[dailyBalances.length - 1];
    if (last && last.date === e.date) {
      last.balance = balance;
    } else {
      dailyBalances.push({ date: e.date, balance });
    }
  });

  const N = dailyBalances.length;
  // Khớp hồi quy tuyến tính: y = ax + b
  // x: chỉ số ngày (0 đến N-1)
  // y: số dư lũy kế
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < N; i++) {
    sumX += i;
    sumY += dailyBalances[i].balance;
    sumXY += i * dailyBalances[i].balance;
    sumXX += i * i;
  }

  let slope = 0;
  let intercept = balance; // Mặc định là số dư hôm nay nếu denominator = 0
  
  const denom = (N * sumXX - sumX * sumX);
  if (denom !== 0) {
    slope = (N * sumXY - sumX * sumY) / denom;
    intercept = (sumY - slope * sumX) / N;
  }

  // 2. Chạy tuyến tính phóng chiếu 30 ngày tiếp theo
  const labels = [];
  const forecastData = [];
  const currentDate = new Date();
  
  for (let i = 1; i <= 30; i++) {
    const fDate = new Date(currentDate);
    fDate.setDate(fDate.getDate() + i);
    labels.push(fDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }));
    
    // Chỉ số phóng chiếu là N - 1 + i
    const projectedVal = slope * (N - 1 + i) + intercept;
    forecastData.push(Math.round(projectedVal));
  }

  // 3. Vẽ đồ thị forecast lên canvas
  const ctx = canvas.getContext('2d');
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#ccc' : '#444';
  const gridColor = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';

  const gradForecast = ctx.createLinearGradient(0, 0, 0, 300);
  const endVal = forecastData[forecastData.length - 1];
  
  if (endVal >= 0) {
    gradForecast.addColorStop(0, 'rgba(56, 239, 125, 0.2)');
    gradForecast.addColorStop(1, 'rgba(56, 239, 125, 0)');
  } else {
    gradForecast.addColorStop(0, 'rgba(255, 88, 88, 0.2)');
    gradForecast.addColorStop(1, 'rgba(255, 88, 88, 0)');
  }

  if (state.chartForecast) state.chartForecast.destroy();
  state.chartForecast = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Dự báo quỹ tương lai (₫)',
        data: forecastData,
        borderColor: endVal >= 0 ? 'rgba(56,239,125,.9)' : 'rgba(255,88,88,.9)',
        backgroundColor: gradForecast,
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 2
      }]
    },
    options: chartOpts('Dự báo (₫)', textColor, gridColor)
  });

  // 4. Cập nhật thẻ cảnh báo thâm hụt Alert Box
  const alertBox = $('forecastAlertBox');
  if (alertBox) {
    alertBox.style.display = 'block';
    if (endVal < 0) {
      alertBox.style.background = 'rgba(244,63,94,.12)';
      alertBox.style.color = '#f43f5e';
      alertBox.style.border = '1px solid rgba(244,63,94,.2)';
      alertBox.innerHTML = `⚠️ <strong>CẢNH BÁO THÂM HỤT QUỸ DÒNG TIỀN:</strong> Thuật toán phát hiện xu hướng chi đang lấn át thu trầm trọng. Quỹ tiền mặt dự kiến sẽ bị <strong>âm ${fmt(Math.abs(endVal))}</strong> vào cuối kỳ 30 ngày tới. <br>👉 <strong>Khuyến nghị hành động ngay:</strong> Siết chi OPEX tức khắc, trì hoãn đầu tư và thúc giục các khoản công nợ khách hàng chưa trả!`;
    } else {
      alertBox.style.background = 'rgba(16,185,129,.12)';
      alertBox.style.color = '#10b981';
      alertBox.style.border = '1px solid rgba(16,185,129,.2)';
      alertBox.innerHTML = `✅ <strong>DÒNG TIỀN PHÁT TRIỂN AN TOÀN:</strong> Mô hình tuyến tính xác nhận quỹ duy trì thặng dư dương lành mạnh. Dự báo cuối kỳ số dư tiền mặt đạt <strong>${fmt(endVal)}</strong>. <br>👉 <strong>Khuyến nghị chiến lược:</strong> Có thể trích lập quỹ đầu tư sinh lời ngắn hạn, đàm phán trả sớm công nợ NCC để nhận chiết khấu thương mại!`;
    }
  }
};


/* ===== FLOATING INTERACTIVE AI CFO CHATBOT ===== */
window.initChatbot = function() {
  const btnToggle = $('btnToggleChatbot');
  const btnClose = $('btnCloseChatbot');
  const chatbotWin = $('chatbotWindow');
  const btnSend = $('btnSendChatbotMessage');
  const chatInput = $('chatbotInput');

  if (!btnToggle || !chatbotWin) return;

  btnToggle.addEventListener('click', () => {
    chatbotWin.classList.toggle('hidden');
    const pulse = btnToggle.querySelector('.pulse-ring');
    if (pulse) pulse.style.display = 'none';
  });

  btnClose.addEventListener('click', () => {
    chatbotWin.classList.add('hidden');
  });

  btnSend.addEventListener('click', () => {
    submitChatbotQuery();
  });

  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitChatbotQuery();
  });
};

function submitChatbotQuery() {
  const input = $('chatbotInput');
  const query = input.value.trim();
  if (!query) return;

  appendChatMessage(query, 'user');
  input.value = '';

  // Hiệu ứng gõ phím
  const typingId = 'chat-typing-' + Date.now();
  const messagesContainer = $('chatbotMessages');
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-message bot';
  typingEl.id = typingId;
  typingEl.innerHTML = `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>`;
  messagesContainer.appendChild(typingEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  setTimeout(() => {
    typingEl.remove();
    const reply = processChatbotQuery(query);
    appendChatMessage(reply, 'bot');
  }, 700);
}

function appendChatMessage(text, sender) {
  const messagesContainer = $('chatbotMessages');
  if (!messagesContainer) return;

  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${sender}`;
  msgEl.innerHTML = text.replace(/\n/g, '<br>');
  messagesContainer.appendChild(msgEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

window.processChatbotQuery = function(query) {
  const q = query.toLowerCase();
  
  const s = calcStats(state.entries);
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const thisMonthEntries = state.entries.filter(e => e.date.startsWith(currentMonthStr));
  const mStats = calcStats(thisMonthEntries);

  // 1. Kiểm tra số dư quỹ
  if (q.includes('số dư') || q.includes('còn bao nhiêu') || q.includes('tiền mặt') || q.includes('quỹ hiện tại') || q.includes('dòng tiền')) {
    return `💵 <strong>Báo cáo số dư quỹ thực tế:</strong><br>Tổng tiền mặt khả dụng hiện tại trong két là <strong>${fmt(s.profit)}</strong>.<br>- Tổng thu hạch toán: ${fmt(s.income)}<br>- Tổng chi thực tế: ${fmt(s.expense)}`;
  }

  // 2. Doanh thu
  if (q.includes('doanh thu') || q.includes('tiền vào') || q.includes('thu tháng') || q.includes('thu nhập')) {
    return `📈 <strong>Hiệu suất doanh thu kỳ này:</strong><br>- Doanh thu tháng này (${now.getMonth()+1}/${now.getFullYear()}) đạt: <strong>${fmt(mStats.income)}</strong>.<br>- Toàn bộ thời gian tích lũy: <strong>${fmt(s.income)}</strong>.`;
  }

  // 3. Chi phí
  if (q.includes('chi phí') || q.includes('tiền ra') || q.includes('chi tháng') || q.includes('chi tiêu')) {
    const categoriesGroup = {};
    thisMonthEntries.filter(e => e.type === 'chi').forEach(e => {
      categoriesGroup[e.category] = (categoriesGroup[e.category] || 0) + e.amount;
    });
    
    let breakDown = '';
    Object.keys(categoriesGroup).forEach(cat => {
      breakDown += `- ${cat}: ${fmt(categoriesGroup[cat])}<br>`;
    });

    return `📉 <strong>Cơ cấu chi tiêu & Dòng chi tháng này:</strong><br>Tổng chi hạch toán tháng này là <strong>${fmt(mStats.expense)}</strong>.<br><br><strong>Danh mục phân bổ chi tiết:</strong><br>${breakDown || '- Chưa ghi nhận khoản chi tiêu nào trong tháng.'}`;
  }

  // 4. Công nợ
  if (q.includes('công nợ') || q.includes('nợ') || q.includes('phải thu') || q.includes('phải trả') || q.includes('nhắc nợ')) {
    const rec = state.debts.filter(d => d.type === 'thu' && d.status === 'unpaid').reduce((sum, d) => sum + d.amount, 0);
    const pay = state.debts.filter(d => d.type === 'chi' && d.status === 'unpaid').reduce((sum, d) => sum + d.amount, 0);
    
    return `📝 <strong>Báo cáo tổng hợp công nợ hiện tại:</strong><br>- <strong>Phải thu từ khách hàng:</strong> ${fmt(rec)}<br>- <strong>Phải trả nhà cung cấp:</strong> ${fmt(pay)}<br><br>👉 Bạn có thể chuyển qua mục <strong>'Công nợ'</strong> để đối soát thanh toán hoặc tạo tin nhắn nhắc nợ Zalo/Telegram nhanh!`;
  }

  // 5. Tạm ứng
  if (q.includes('tạm ứng') || q.includes('hoàn ứng') || q.includes('ứng tiền')) {
    const pending = state.advances.filter(a => a.status === 'pending').length;
    const paid = state.advances.filter(a => a.status === 'paid').length;
    
    return `💸 <strong>Thông số quỹ tạm ứng nhân viên:</strong><br>- Đang chờ duyệt chi: <strong>${pending}</strong> đề xuất.<br>- Đang chờ hoàn hóa đơn: <strong>${paid}</strong> khoản.<br><br>👉 Hãy bảo vệ dòng tiền bằng cách đối soát hoàn ứng nhanh sau tối đa 7 ngày làm việc!`;
  }

  // 6. Dự báo
  if (q.includes('dự báo') || q.includes('tương lai') || q.includes('xu hướng')) {
    return `🔮 <strong>Dự báo dòng tiền AI:</strong><br>Báo cáo đồ thị dự báo 30 ngày tới sử dụng thuật toán hồi quy tuyến tính đã được cập nhật hoàn chỉnh.<br>Vui lòng chuyển qua tab <strong>'Báo cáo'</strong> để xem trực quan xu hướng dòng tiền tăng/giảm và các gợi ý bảo vệ quỹ!`;
  }

  // 7. Giải pháp / Lời khuyên tư vấn tài chính doanh nghiệp
  if (q.includes('lời khuyên') || q.includes('tư vấn') || q.includes('giải pháp') || q.includes('giúp tôi')) {
    return `💡 <strong>Tư vấn từ Chuyên gia Tài chính Doanh nghiệp:</strong><br>Để tối ưu hóa cấu trúc vốn, doanh nghiệp nên:<br>1. Giữ chi phí OPEX (vận hành) dưới 35% doanh số để đảm bảo biên an toàn cao.<br>2. Siết chặt công nợ phải thu, khuyến khích khách hàng thanh toán sớm bằng chiết khấu 1-2%.<br>3. Xem chi tiết cảnh báo rò rỉ tại <strong>'Báo cáo P&L'</strong> để biết chi phí nào đang tăng đột biến kỳ này!`;
  }

  // 8. Fallback
  return `🤖 Xin chào! Tôi là Trợ lý tài chính & CFO ảo Việt Nam. Tôi có thể giải đáp nhanh tất cả số liệu hạch toán thực tế:<br>- Gõ <strong>'số dư'</strong> để xem két tiền mặt.<br>- Gõ <strong>'doanh thu'</strong> hoặc <strong>'chi phí'</strong> để xem tình hình thu chi tháng này.<br>- Gõ <strong>'công nợ'</strong> để kiểm toán tiền nợ khách hàng.<br>- Gõ <strong>'tạm ứng'</strong> để xem sổ tạm ứng nhân viên.<br>- Gõ <strong>'lời khuyên'</strong> để nhận phân tích tư vấn strategic.`;
};


/* ===== EVENT WIRING & ADAPTER CORES ===== */
function wireUpAdvancedModules() {
  $('advSearchInput')?.addEventListener('input', () => {
    renderAdvances();
  });
  $('advFilterStatus')?.addEventListener('change', () => {
    renderAdvances();
  });
  $('debtSearchInput')?.addEventListener('input', () => {
    renderDebts();
  });
  $('debtFilterType')?.addEventListener('change', () => {
    renderDebts();
  });
  $('debtFilterStatus')?.addEventListener('change', () => {
    renderDebts();
  });
  $('btnNewDebt')?.addEventListener('click', () => {
    submitNewDebt();
  });
  $('btnExportPL')?.addEventListener('click', () => {
    exportPLToExcel();
  });
  $('btnClearAuditLogs')?.addEventListener('click', () => {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử Audit Logs kiểm soát? Hành động này không thể phục hồi.')) return;
    state.auditLogs = [];
    saveData();
    renderAuditLogs();
    toast('Đã xóa sạch nhật ký kiểm toán hệ thống thành công!', 'info');
  });
}


/* ===== INIT ===== */
(async function () {
  await loadData();
  initLogin();
  initTheme();
  window.populateFilterCategories();
  wireUpAdvancedModules();
  initChatbot();
})();
