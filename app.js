/* ===== CLOUD CONFIGURATION ===== */
// Nhập đường dẫn link Web App của Google Apps Script của bạn vào đây (sau khi deploy)
// Ví dụ: const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwpjrAWo1HNP3WFHKvrwNyd9LCBkkUHc3L5sNkt8l69by90d6JhlxO9bfr6Wo6wk109/exec';

/* ===== DATA & STATE ===== */
const DEFAULT_USERS = [
  { username: 'admin', password: 'admin123', role: 'admin', label: 'Quản trị viên' },
  { username: 'viewer', password: 'viewer123', role: 'viewer', label: 'Chỉ xem' }
];

/* Categories are now managed dynamically via data.js getCategories() */

let state = {
  currentUser: null,
  entries: [],
  users: [],
  chartMonthly: null,
  chartRatio: null,
  chartReport: null,
  editingId: null
};

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

      // Bảo vệ hóa đơn cục bộ không bị ghi đè bởi cột rỗng từ server
      state.entries = serverEntries.map(se => {
        const le = localEntries.find(x => x.id === se.id);
        if (le && le.invoice && !se.invoice) {
          if (le.invoice.startsWith('data:')) {
            return { ...se, invoice: le.invoice };
          }
        }
        return se;
      });

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
  }
}

function saveData() {
  localStorage.setItem('tc_users', JSON.stringify(state.users));
  localStorage.setItem('tc_entries', JSON.stringify(state.entries));
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
  if (state.currentUser.role === 'editor') {
    return ['view', 'add', 'edit', 'invoice', 'cats'].includes(perm);
  }
  if (state.currentUser.role === 'viewer') {
    return ['view'].includes(perm);
  }
  return false;
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
}

function onLogin() {
  $('currentUserName').textContent = state.currentUser.username;
  $('currentUserRole').textContent = state.currentUser.label;

  // Hiển thị các mục menu bên dựa vào phân quyền chi tiết
  if (hasPermission('users')) {
    $('menuSettings').classList.remove('hidden');
  } else {
    $('menuSettings').classList.add('hidden');
  }

  if (hasPermission('cats')) {
    $('menuCategories').classList.remove('hidden');
  } else {
    $('menuCategories').classList.add('hidden');
  }

  // Ẩn/hiện các phần chỉ dành riêng cho Admin tối cao
  if (!isAdmin()) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  $('todayDate').textContent = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  renderDashboard();
  updateJournalView();
}

$('btnLogout').addEventListener('click', () => {
  state.currentUser = null;
  $('mainApp').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('loginUser').value = '';
  $('loginPass').value = '';
  $('loginError').textContent = '';
});

/* ===== NAVIGATION ===== */
const pageTitles = { dashboard: 'Tổng quan', journal: 'Nhật Ký Chung', categories: 'Quản Lý Danh Mục', reports: 'Báo Cáo', settings: 'Cài Đặt' };

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
    if (page === 'categories') renderCategoryPage();
    if (page === 'reports') initReportPage();
    if (page === 'settings') renderSettings();
    // Close mobile sidebar
    document.querySelector('.sidebar').classList.remove('mobile-open');
  });
});

$('btnToggleSidebar').addEventListener('click', () => {
  const sb = document.querySelector('.sidebar');
  if (window.innerWidth <= 768) sb.classList.toggle('mobile-open');
  else sb.classList.toggle('collapsed');
});

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

  if (state.chartMonthly) state.chartMonthly.destroy();
  state.chartMonthly = new Chart($('chartMonthly'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Thu', data: sortedMonths.map(m => months[m].thu), backgroundColor: 'rgba(56,239,125,.6)', borderRadius: 6 },
        { label: 'Chi', data: sortedMonths.map(m => months[m].chi), backgroundColor: 'rgba(255,88,88,.6)', borderRadius: 6 }
      ]
    },
    options: chartOpts('Số tiền (₫)')
  });

  // Ratio
  const s = calcStats(state.entries);
  if (state.chartRatio) state.chartRatio.destroy();
  state.chartRatio = new Chart($('chartRatio'), {
    type: 'doughnut',
    data: {
      labels: ['Thu', 'Chi'],
      datasets: [{ data: [s.income || 0, s.expense || 0], backgroundColor: ['rgba(56,239,125,.7)', 'rgba(255,88,88,.7)'], borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#ccc', font: { family: 'Inter' } } } }, cutout: '65%' }
  });
}

function chartOpts(yLabel) {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: '#ccc', font: { family: 'Inter' } } } },
    scales: {
      x: { ticks: { color: '#888', font: { family: 'Inter' } }, grid: { color: 'rgba(255,255,255,.05)' } },
      y: { ticks: { color: '#888', font: { family: 'Inter' }, callback: v => new Intl.NumberFormat('vi-VN').format(v) }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: yLabel, color: '#888' } }
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

  const canEdit = hasPermission('edit');
  const canDelete = hasPermission('delete');

  $('journalTable').innerHTML = list.map((e, i) => {
    let actionButtons = [];
    if (canEdit) actionButtons.push(`<button class="btn btn-primary btn-sm" onclick="editEntry('${e.id}')" title="Sửa giao dịch"><i class="fas fa-edit"></i></button>`);
    if (canDelete) actionButtons.push(`<button class="btn btn-danger btn-sm" onclick="deleteEntry('${e.id}')" title="Xóa giao dịch"><i class="fas fa-trash"></i></button>`);
    const actionsHtml = actionButtons.length ? actionButtons.join(' ') : '<span style="color:var(--text2)">-</span>';

    return `
      <tr>
        <td>${i + 1}</td>
        <td>${formatDate(e.date)}</td>
        <td><span class="badge badge-${e.type}">${e.type === 'thu' ? '▲ Thu' : '▼ Chi'}</span></td>
        <td>${e.category}</td>
        <td style="color:${e.type === 'thu' ? 'var(--green)' : 'var(--red)'};font-weight:600">${e.type === 'thu' ? '+' : '-'}${fmt(e.amount)}</td>
        <td>${e.reason}</td>
        <td style="text-align:center">
          ${e.invoice ? (
        e.invoice === 'pending'
          ? `<span style="color:var(--text2);font-size:0.75rem;display:inline-flex;align-items:center;gap:4px" title="Đang đồng bộ file lên Google Drive..."><i class="fas fa-spinner fa-spin"></i> Đang tải...</span>`
          : (e.invoice.startsWith('data:image/')
            ? `<img src="${e.invoice}" onclick="showInvoiceZoom('${e.invoice}')" style="width:30px;height:30px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid var(--border)" title="Click để phóng to">`
            : (e.invoice.startsWith('data:')
              ? `<a href="${e.invoice}" target="_blank" style="color:#1a73e8;font-size:1.15rem;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:4px;border:1px solid var(--border);background:var(--bg2);text-decoration:none" title="Xem file đính kèm"><i class="fas fa-file-alt"></i></a>`
              : `<a href="${e.invoice}" target="_blank" style="color:#34a853;font-size:1.15rem;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:4px;border:1px solid var(--border);background:var(--bg2);text-decoration:none" title="Xem chứng từ trên Google Drive"><i class="fab fa-google-drive"></i></a>`
            )
          )
      ) : '<span style="color:var(--text2)">-</span>'}
        </td>
        <td>${e.createdBy || '-'}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:30px">Không có dữ liệu</td></tr>';

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

$('searchInput')?.addEventListener('input', updateJournalView);
$('filterType')?.addEventListener('change', () => {
  window.populateFilterCategories();
  updateJournalView();
});
$('filterCategory')?.addEventListener('change', updateJournalView);
$('filterStartDate')?.addEventListener('change', updateJournalView);
$('filterEndDate')?.addEventListener('change', updateJournalView);
$('btnClearDates')?.addEventListener('click', () => {
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

window.showInvoiceZoom = function (imgSrc) {
  openModal('Chi tiết Hóa đơn / Chứng từ', `
    <div style="text-align:center;padding:10px">
      <img src="${imgSrc}" style="max-width:100%;max-height:70vh;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.3)">
      <div style="margin-top:15px;display:flex;justify-content:center;gap:10px">
        <a href="${imgSrc}" download="hoa_don_${Date.now()}.jpg" class="btn btn-primary btn-sm" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none"><i class="fas fa-download"></i> Tải về hóa đơn</a>
        <button class="btn btn-secondary btn-sm" onclick="closeModal()">Đóng</button>
      </div>
    </div>
  `);
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
    'Người tạo': e.createdBy || ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 8 }, { wch: 22 }, { wch: 18 }, { wch: 35 }, { wch: 14 }];
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
  if (state.chartReport) state.chartReport.destroy();
  state.chartReport = new Chart($('chartReport'), {
    type: 'line',
    data: {
      labels: dates.map(formatDate),
      datasets: [
        { label: 'Thu', data: dates.map(d => daily[d].thu), borderColor: 'rgba(56,239,125,.8)', backgroundColor: 'rgba(56,239,125,.1)', fill: true, tension: .4, pointRadius: 3 },
        { label: 'Chi', data: dates.map(d => daily[d].chi), borderColor: 'rgba(255,88,88,.8)', backgroundColor: 'rgba(255,88,88,.1)', fill: true, tension: .4, pointRadius: 3 }
      ]
    },
    options: chartOpts('Số tiền (₫)')
  });
}

/* ===== SETTINGS ===== */
/* ===== SETTINGS ===== */
function renderSettings() {
  if (!hasPermission('users')) return;
  $('usersTable').innerHTML = state.users.map(u => {
    // Phân tích danh sách quyền đang có
    const perms = u.permissions
      ? (typeof u.permissions === 'string' ? u.permissions.split(',') : u.permissions)
      : (u.role === 'admin' ? ['view', 'add', 'edit', 'delete', 'invoice', 'users', 'cats'] : (u.role === 'editor' ? ['view', 'add', 'edit', 'invoice', 'cats'] : ['view']));

    const permMap = {
      view: 'Xem',
      add: 'Ghi',
      edit: 'Sửa',
      delete: 'Xóa',
      invoice: 'Drive',
      cats: 'D.Mục',
      users: 'User'
    };

    const permBadges = perms.map(p => {
      const colorMap = {
        view: 'rgba(58,123,213,.2);color:#3a7bd5',
        add: 'rgba(56,239,125,.2);color:#20bf55',
        edit: 'rgba(247,151,30,.2);color:#f7971e',
        delete: 'rgba(255,88,88,.2);color:#ff5858',
        invoice: 'rgba(0,210,255,.2);color:#00d2ff',
        cats: 'rgba(118,75,162,.2);color:#764ba2',
        users: 'rgba(255,88,88,.2);color:#ff5858'
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
    if (u.role === 'admin') activePerms = ['view', 'add', 'edit', 'delete', 'invoice', 'users', 'cats'];
    else if (u.role === 'editor') activePerms = ['view', 'add', 'edit', 'invoice', 'cats'];
    else activePerms = ['view'];
  }

  const permissionsList = [
    { key: 'view', label: 'Xem nhật ký & Báo cáo', desc: 'Quyền xem Dashboard, Báo cáo và Nhật ký chung.' },
    { key: 'add', label: 'Ghi sổ nhật ký chung', desc: 'Quyền thêm mới giao dịch thu chi.' },
    { key: 'edit', label: 'Sửa nhật ký chung', desc: 'Quyền chỉnh sửa thông tin giao dịch.' },
    { key: 'delete', label: 'Xóa nhật ký chung', desc: 'Quyền xóa giao dịch hoặc xóa toàn bộ sổ.' },
    { key: 'invoice', label: 'Cập nhật hóa đơn', desc: 'Quyền đính kèm/tải lên hóa đơn chứng từ.' },
    { key: 'cats', label: 'Quản lý danh mục', desc: 'Quyền thêm, sửa, xóa danh mục thu chi.' },
    { key: 'users', label: 'Quản lý thành viên', desc: 'Quyền thêm, xóa, phân quyền thành viên khác.' }
  ];

  const checklistHtml = permissionsList.map(p => {
    const checked = activePerms.includes(p.key) ? 'checked' : '';
    return `
      <div class="perm-card" style="display:flex;align-items:flex-start;gap:12px;background:rgba(255,255,255,0.03);padding:12px 16px;border-radius:10px;border:1px solid var(--border);margin-bottom:10px;transition:var(--transition)">
        <input type="checkbox" id="perm_${p.key}" class="perm-checkbox" value="${p.key}" ${checked} style="width:18px;height:18px;margin-top:2px;cursor:pointer">
        <div style="flex:1;cursor:pointer" onclick="const cb = document.getElementById('perm_${p.key}'); cb.checked = !cb.checked;">
          <label style="display:block;margin:0 0 2px 0;font-weight:600;font-size:0.88rem;color:var(--text);cursor:pointer">${p.label}</label>
          <small style="color:var(--text2);font-size:0.75rem;line-height:1.4;display:block">${p.desc}</small>
        </div>
      </div>
    `;
  }).join('');

  openModal(`Phân Quyền: ${u.username}`, `
    <div style="max-height:60vh;overflow-y:auto;padding-right:4px">
      <p style="font-size:0.82rem;color:var(--text2);margin-bottom:16px">Tùy chỉnh phân quyền chi tiết cho tài khoản <strong>${u.username}</strong>. Mọi thay đổi sẽ được đồng bộ lên đám mây ngay lập tức.</p>
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

  // Cập nhật vai trò phù hợp nhất dựa trên quyền hạn được chọn
  let newRole = 'viewer';
  let newLabel = 'Chỉ xem';

  if (selectedPerms.includes('users')) {
    newRole = 'admin';
    newLabel = 'Quản trị viên';
  } else if (selectedPerms.includes('add') || selectedPerms.includes('edit')) {
    newRole = 'editor';
    newLabel = 'Biên tập viên';
  }

  u.role = newRole;
  u.label = newLabel;
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
        <option value="admin">Quản trị viên (Toàn quyền)</option>
        <option value="editor">Biên tập viên (Ghi sổ, Sửa, Drive)</option>
        <option value="viewer" selected>Chỉ xem</option>
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
    permissions = 'view,add,edit,delete,invoice,users,cats';
    label = 'Quản trị viên';
  } else if (role === 'editor') {
    permissions = 'view,add,edit,invoice,cats';
    label = 'Biên tập viên';
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
    'Date_raw': e.date
  }));
  const ws1 = XLSX.utils.json_to_sheet(entryData);
  ws1['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 8 }, { wch: 22 }, { wch: 18 }, { wch: 35 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 12 }];
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
              createdAt: r['Ngày tạo'] || new Date().toISOString()
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

/* ===== INIT ===== */
(async function () {
  await loadData();
  initLogin();
  window.populateFilterCategories();
})();
