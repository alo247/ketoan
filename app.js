/* ===== CLOUD CONFIGURATION ===== */
// Nhập đường dẫn link Web App của Google Apps Script của bạn vào đây (sau khi deploy)
// Ví dụ: const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzhT9Uf9uPbCHjWTuR17cf_YT9U9gsvFg3casxvEBESg2BqxhuoyolxTRsqNhIVxEE/exec';


/* ===== DATA & STATE ===== */
const DEFAULT_USERS = [
  { username: 'admin', password: 'admin123', role: 'admin', label: 'Quản trị viên' },
  { username: 'accountant', password: 'accountant123', role: 'accountant', label: 'Kế toán', permissions: 'view,add,edit,approve,cats,reports,advances_edit,debts_edit,fleet_view,fleet_edit,fleet_salary' },
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
  accounts: [],
  fleetVehicles: [],
  fleetDrivers: [],
  fleetRoutes: [],
  fleetTrips: [],
  systemSettings: [],
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
const getNextSTT = () => state.entries.length > 0 ? Math.max(...state.entries.map(e => Number(e.stt) || 0)) + 1 : 1;
const formatThousand = val => (val || val === 0) ? new Intl.NumberFormat('vi-VN').format(val) : '';

function normalizeDate(d) {
  if (!d) return today();
  let s = String(d).trim();
  
  // Heal corrupted format "21T17:00:00.000Z/05/2026"
  if (s.includes('/') && s.includes('T')) {
    let clean = s.replace(/T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/gi, '');
    const parts = clean.split('/');
    if (parts.length === 3) {
      let dd = parts[0].replace(/\D/g, '').padStart(2, '0');
      let mm = parts[1].replace(/\D/g, '').padStart(2, '0');
      let yyyy = parts[2].replace(/\D/g, '');
      if (dd && mm && yyyy.length === 4) {
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  }

  // Strip ISO time part if present: "2026-05-21T17:00:00.000Z" -> "2026-05-21"
  if (s.includes('T')) {
    s = s.split(/T/i)[0];
  }
  
  // Standard YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  
  // DD/MM/YYYY format
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  
  // Match any DD-MM-YYYY or DD/MM/YYYY
  const match = s.match(/(\d{1,2})[^\d]+(\d{1,2})[^\d]+(\d{4})/);
  if (match) {
    const dd = match[1].padStart(2, '0');
    const mm = match[2].padStart(2, '0');
    const yyyy = match[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  
  try {
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  } catch (e) {}
  
  return today();
}

/* ===== CLOUD SYNC HELPERS ===== */
const syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ketoan_sync') : null;
let pollingTimeout = null;

window.triggerSync = async function () {
  if (!state.currentUser) return;
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
  }
  await loadData(true);
  triggerViewUpdate();
  if (typeof runPolling === 'function') {
    const delay = document.visibilityState === 'visible' ? 4000 : 30000;
    pollingTimeout = setTimeout(runPolling, delay);
  }
};

if (syncChannel) {
  syncChannel.onmessage = async (event) => {
    if (event.data === 'sync' && state.currentUser) {
      await window.triggerSync();
    }
  };
}

window.addEventListener('focus', async () => {
  await window.triggerSync();
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    await window.triggerSync();
  }
});

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
      
      // Xóa cờ _unsynced sau khi đã lưu thành công lên Cloud
      if (payload.action === 'saveEntry' && payload.entry) {
        const entryId = payload.entry.id;
        const idx = state.entries.findIndex(e => e.id === entryId);
        if (idx !== -1) {
          delete state.entries[idx]._unsynced;
        }
      } else if (payload.action === 'saveAdvance' && payload.advance) {
        const advId = payload.advance.id;
        const idx = state.advances.findIndex(a => a.id === advId);
        if (idx !== -1) {
          delete state.advances[idx]._unsynced;
        }
      } else if (payload.action === 'saveDebt' && payload.debt) {
        const debtId = payload.debt.id;
        const idx = state.debts.findIndex(d => d.id === debtId);
        if (idx !== -1) {
          delete state.debts[idx]._unsynced;
        }
      } else if (payload.action === 'saveFleetVehicle' && payload.vehicle) {
        const vehId = payload.vehicle.id;
        const idx = state.fleetVehicles.findIndex(v => v.id === vehId);
        if (idx !== -1) {
          delete state.fleetVehicles[idx]._unsynced;
        }
      } else if (payload.action === 'saveFleetDriver' && payload.driver) {
        const drvId = payload.driver.id;
        const idx = state.fleetDrivers.findIndex(d => d.id === drvId);
        if (idx !== -1) {
          delete state.fleetDrivers[idx]._unsynced;
        }
      } else if (payload.action === 'saveFleetRoute' && payload.route) {
        const rotId = payload.route.id;
        const idx = state.fleetRoutes.findIndex(r => r.id === rotId);
        if (idx !== -1) {
          delete state.fleetRoutes[idx]._unsynced;
        }
      } else if (payload.action === 'saveFleetTrip' && payload.trip) {
        const trpId = payload.trip.id;
        const idx = state.fleetTrips.findIndex(t => t.id === trpId);
        if (idx !== -1) {
          delete state.fleetTrips[idx]._unsynced;
        }
      } else if (payload.action === 'restoreAll') {
        state.entries.forEach(e => {
          delete e._unsynced;
        });
        state.advances.forEach(a => {
          delete a._unsynced;
        });
        state.debts.forEach(d => {
          delete d._unsynced;
        });
        state.fleetVehicles.forEach(v => {
          delete v._unsynced;
        });
        state.fleetDrivers.forEach(d => {
          delete d._unsynced;
        });
        state.fleetRoutes.forEach(r => {
          delete r._unsynced;
        });
        state.fleetTrips.forEach(t => {
          delete t._unsynced;
        });
      }

      if (data.invoiceUrl) {
        if (payload.entry) {
          const entryId = payload.entry.id;
          const idx = state.entries.findIndex(e => e.id === entryId);
          if (idx !== -1) {
            state.entries[idx].invoice = data.invoiceUrl;
          }
        }
        if (payload.advance) {
          const advId = payload.advance.id;
          const idx = state.advances.findIndex(a => a.id === advId);
          if (idx !== -1) {
            state.advances[idx].settlementInvoice = data.invoiceUrl;
          }
        }
        if (payload.trip) {
          const trpId = payload.trip.id;
          const idx = state.fleetTrips.findIndex(t => t.id === trpId);
          if (idx !== -1) {
            state.fleetTrips[idx].invoice = data.invoiceUrl;
          }
        }
      }

      saveData();
      triggerViewUpdate();
      
      // Phát thông báo đồng bộ tức thời cho các tab trình duyệt khác
      if (syncChannel) {
        syncChannel.postMessage('sync');
      }
    }
  } catch (err) {
    console.error("Failed to send data to cloud:", err);
    toast("Đồng bộ đám mây thất bại! Dữ liệu đã lưu tạm thời ở máy bạn.", "error");
  }
};

async function loadData(silent = false) {
  const loadingId = 'cloudLoading';
  let loadingEl = $(loadingId);
  if (!silent && !loadingEl && SCRIPT_URL && SCRIPT_URL.startsWith('http')) {
    loadingEl = document.createElement('div');
    loadingEl.id = loadingId;
    loadingEl.innerHTML = '<div style="position:fixed;bottom:15px;right:15px;background:rgba(20,20,30,0.9);color:#38ef7d;padding:12px 20px;border-radius:30px;font-size:0.82rem;box-shadow:0 4px 15px rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;gap:8px;border:1px solid rgba(56,239,125,0.2);font-family:Inter,sans-serif;"><i class="fas fa-sync-alt fa-spin"></i> Đang tải dữ liệu đám mây...</div>';
    document.body.appendChild(loadingEl);
  }

  try {
    if (SCRIPT_URL && SCRIPT_URL.startsWith('http')) {
      // Tải dữ liệu kèm cơ chế Cache-Busting để luôn nhận dữ liệu mới nhất
      const cacheBustUrl = SCRIPT_URL + (SCRIPT_URL.includes('?') ? '&' : '?') + '_t=' + Date.now();
      const res = await fetch(cacheBustUrl);
      const data = await res.json();

      const serverEntries = data.entries || [];
      const localEntries = JSON.parse(localStorage.getItem('tc_entries') || '[]');

      // Thuật toán gộp thông minh (Smart Merge) nâng cấp cho Entries
      const mergedEntries = [...serverEntries];
      localEntries.forEach(le => {
        const se = serverEntries.find(x => x.id === le.id);
        if (!se) {
          if (le._unsynced) {
            mergedEntries.push(le);
          }
        } else {
          if (le.invoice && le.invoice.startsWith('data:') && !se.invoice) {
            const idx = mergedEntries.findIndex(x => x.id === se.id);
            if (idx !== -1) {
              mergedEntries[idx] = { ...se, invoice: le.invoice };
            }
          }
          if (le._unsynced) {
            const idx = mergedEntries.findIndex(x => x.id === se.id);
            if (idx !== -1) {
              mergedEntries[idx] = { ...mergedEntries[idx], ...le };
            }
          }
        }
      });
      state.entries = mergedEntries;

      state.users = data.users || [...DEFAULT_USERS];
      if (data.categories) saveCategories(data.categories);

      // Thuật toán gộp thông minh (Smart Merge) cho Advances (Tạm ứng)
      const serverAdvances = data.advances || [];
      const localAdvances = JSON.parse(localStorage.getItem('tc_advances') || '[]');
      const mergedAdvances = [...serverAdvances];
      localAdvances.forEach(le => {
        const se = serverAdvances.find(x => x.id === le.id);
        if (!se) {
          if (le._unsynced) {
            mergedAdvances.push(le);
          }
        } else {
          if (le.invoice && le.invoice.startsWith('data:') && !se.invoice) {
            const idx = mergedAdvances.findIndex(x => x.id === se.id);
            if (idx !== -1) {
              mergedAdvances[idx].invoice = le.invoice;
            }
          }
          if (le.settlementInvoice && le.settlementInvoice.startsWith('data:') && !se.settlementInvoice) {
            const idx = mergedAdvances.findIndex(x => x.id === se.id);
            if (idx !== -1) {
              mergedAdvances[idx].settlementInvoice = le.settlementInvoice;
            }
          }
          if (le._unsynced) {
            const idx = mergedAdvances.findIndex(x => x.id === se.id);
            if (idx !== -1) {
              mergedAdvances[idx] = { ...mergedAdvances[idx], ...le };
            }
          }
        }
      });
      state.advances = mergedAdvances;

      // Thuật toán gộp thông minh (Smart Merge) cho Debts (Công nợ)
      const serverDebts = data.debts || [];
      const localDebts = JSON.parse(localStorage.getItem('tc_debts') || '[]');
      const mergedDebts = [...serverDebts];
      localDebts.forEach(le => {
        const se = serverDebts.find(x => x.id === le.id);
        if (!se) {
          if (le._unsynced) {
            mergedDebts.push(le);
          }
        } else {
          if (le._unsynced) {
            const idx = mergedDebts.findIndex(x => x.id === se.id);
            if (idx !== -1) {
              mergedDebts[idx] = { ...mergedDebts[idx], ...le };
            }
          }
        }
      });
      state.debts = mergedDebts;

      // Thuật toán gộp thông minh cho Accounts (Tài khoản)
      const serverAccounts = data.accounts || [];
      const localAccounts = window.getAccounts ? window.getAccounts() : [];
      const mergedAccounts = [...serverAccounts];
      localAccounts.forEach(le => {
        const se = serverAccounts.find(x => x.id === le.id);
        if (!se) {
          if (le._unsynced) {
            mergedAccounts.push(le);
          }
        } else {
          if (le._unsynced) {
            const idx = mergedAccounts.findIndex(x => x.id === se.id);
            if (idx !== -1) {
              mergedAccounts[idx] = { ...mergedAccounts[idx], ...le };
            }
          }
        }
      });
      state.accounts = mergedAccounts;
      if (window.saveAccounts) window.saveAccounts(state.accounts);

      // Đồng bộ thông minh cho Audit Logs
      const serverAuditLogs = data.auditLogs || [];
      const localAuditLogs = JSON.parse(localStorage.getItem('tc_audit_logs') || '[]');
      const auditLogMap = new Map();
      serverAuditLogs.forEach(log => {
        auditLogMap.set(log.timestamp, log);
      });
      localAuditLogs.forEach(log => {
        if (!auditLogMap.has(log.timestamp)) {
          auditLogMap.set(log.timestamp, log);
        }
      });
      state.auditLogs = Array.from(auditLogMap.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 1000);

      // Thuật toán gộp cho Fleet Vehicles
      const serverFleetVehicles = data.fleetVehicles || [];
      const localFleetVehicles = JSON.parse(localStorage.getItem('tc_fleet_vehicles') || '[]');
      const mergedFleetVehicles = [...serverFleetVehicles];
      localFleetVehicles.forEach(le => {
        const se = serverFleetVehicles.find(x => x.id === le.id);
        if (!se) {
          if (le._unsynced) mergedFleetVehicles.push(le);
        } else if (le._unsynced) {
          const idx = mergedFleetVehicles.findIndex(x => x.id === se.id);
          if (idx !== -1) mergedFleetVehicles[idx] = { ...mergedFleetVehicles[idx], ...le };
        }
      });
      state.fleetVehicles = mergedFleetVehicles;

      // Thuật toán gộp cho Fleet Drivers
      const serverFleetDrivers = data.fleetDrivers || [];
      const localFleetDrivers = JSON.parse(localStorage.getItem('tc_fleet_drivers') || '[]');
      const mergedFleetDrivers = [...serverFleetDrivers];
      localFleetDrivers.forEach(le => {
        const se = serverFleetDrivers.find(x => x.id === le.id);
        if (!se) {
          if (le._unsynced) mergedFleetDrivers.push(le);
        } else if (le._unsynced) {
          const idx = mergedFleetDrivers.findIndex(x => x.id === se.id);
          if (idx !== -1) mergedFleetDrivers[idx] = { ...mergedFleetDrivers[idx], ...le };
        }
      });
      state.fleetDrivers = mergedFleetDrivers;

      // Thuật toán gộp cho Fleet Routes
      const serverFleetRoutes = data.fleetRoutes || [];
      const localFleetRoutes = JSON.parse(localStorage.getItem('tc_fleet_routes') || '[]');
      const mergedFleetRoutes = [...serverFleetRoutes];
      localFleetRoutes.forEach(le => {
        const se = serverFleetRoutes.find(x => x.id === le.id);
        if (!se) {
          if (le._unsynced) mergedFleetRoutes.push(le);
        } else if (le._unsynced) {
          const idx = mergedFleetRoutes.findIndex(x => x.id === se.id);
          if (idx !== -1) mergedFleetRoutes[idx] = { ...mergedFleetRoutes[idx], ...le };
        }
      });
      state.fleetRoutes = mergedFleetRoutes;

      // Thuật toán gộp cho Fleet Trips
      const serverFleetTrips = data.fleetTrips || [];
      const localFleetTrips = JSON.parse(localStorage.getItem('tc_fleet_trips') || '[]');
      const mergedFleetTrips = [...serverFleetTrips];
      localFleetTrips.forEach(le => {
        const se = serverFleetTrips.find(x => x.id === le.id);
        if (!se) {
          if (le._unsynced) mergedFleetTrips.push(le);
        } else {
          if (le.invoice && le.invoice.startsWith('data:') && !se.invoice) {
            const idx = mergedFleetTrips.findIndex(x => x.id === se.id);
            if (idx !== -1) mergedFleetTrips[idx].invoice = le.invoice;
          }
          if (le._unsynced) {
            const idx = mergedFleetTrips.findIndex(x => x.id === se.id);
            if (idx !== -1) mergedFleetTrips[idx] = { ...mergedFleetTrips[idx], ...le };
          }
        }
      });
      state.fleetTrips = mergedFleetTrips;

      // Thuật toán gộp cho System Settings
      const serverSettings = data.systemSettings || [];
      const localSettings = JSON.parse(localStorage.getItem('tc_system_settings') || '[]');
      const mergedSettings = [...serverSettings];
      localSettings.forEach(le => {
        const se = serverSettings.find(x => x.key === le.key);
        if (!se) {
          if (le._unsynced) mergedSettings.push(le);
        } else if (le._unsynced) {
          const idx = mergedSettings.findIndex(x => x.key === se.key);
          if (idx !== -1) mergedSettings[idx] = { ...mergedSettings[idx], ...le };
        }
      });
      state.systemSettings = mergedSettings;
      localStorage.setItem('tc_system_settings', JSON.stringify(state.systemSettings));

      localStorage.setItem('tc_users', JSON.stringify(state.users));
      localStorage.setItem('tc_entries', JSON.stringify(state.entries));
      localStorage.setItem('tc_advances', JSON.stringify(state.advances));
      localStorage.setItem('tc_debts', JSON.stringify(state.debts));
      localStorage.setItem('tc_audit_logs', JSON.stringify(state.auditLogs));
      localStorage.setItem('tc_fleet_vehicles', JSON.stringify(state.fleetVehicles));
      localStorage.setItem('tc_fleet_drivers', JSON.stringify(state.fleetDrivers));
      localStorage.setItem('tc_fleet_routes', JSON.stringify(state.fleetRoutes));
      localStorage.setItem('tc_fleet_trips', JSON.stringify(state.fleetTrips));
    } else {
      state.users = JSON.parse(localStorage.getItem('tc_users') || 'null') || [...DEFAULT_USERS];
      state.entries = JSON.parse(localStorage.getItem('tc_entries') || '[]');
      state.advances = JSON.parse(localStorage.getItem('tc_advances') || '[]');
      state.debts = JSON.parse(localStorage.getItem('tc_debts') || '[]');
      state.auditLogs = JSON.parse(localStorage.getItem('tc_audit_logs') || '[]');
      state.accounts = window.getAccounts ? window.getAccounts() : [];
      state.fleetVehicles = JSON.parse(localStorage.getItem('tc_fleet_vehicles') || '[]');
      state.fleetDrivers = JSON.parse(localStorage.getItem('tc_fleet_drivers') || '[]');
      state.fleetRoutes = JSON.parse(localStorage.getItem('tc_fleet_routes') || '[]');
      state.fleetTrips = JSON.parse(localStorage.getItem('tc_fleet_trips') || '[]');
      state.systemSettings = JSON.parse(localStorage.getItem('tc_system_settings') || '[]');
    }
  } catch (err) {
    console.warn("Cloud load failed, using local storage:", err);
    state.users = JSON.parse(localStorage.getItem('tc_users') || 'null') || [...DEFAULT_USERS];
    state.entries = JSON.parse(localStorage.getItem('tc_entries') || '[]');
    state.advances = JSON.parse(localStorage.getItem('tc_advances') || '[]');
    state.debts = JSON.parse(localStorage.getItem('tc_debts') || '[]');
    state.auditLogs = JSON.parse(localStorage.getItem('tc_audit_logs') || '[]');
    state.accounts = window.getAccounts ? window.getAccounts() : [];
    state.fleetVehicles = JSON.parse(localStorage.getItem('tc_fleet_vehicles') || '[]');
    state.fleetDrivers = JSON.parse(localStorage.getItem('tc_fleet_drivers') || '[]');
    state.fleetRoutes = JSON.parse(localStorage.getItem('tc_fleet_routes') || '[]');
    state.fleetTrips = JSON.parse(localStorage.getItem('tc_fleet_trips') || '[]');
    state.systemSettings = JSON.parse(localStorage.getItem('tc_system_settings') || '[]');
  } finally {
    if (loadingEl) loadingEl.remove();
    
    // Chuẩn hóa định dạng ngày tháng phòng ngừa múi giờ ISO và tự động sửa chữa dữ liệu lỗi
    if (state.entries) {
      state.entries.forEach(e => {
        e.date = normalizeDate(e.date);
      });
    }
    if (state.advances) {
      state.advances.forEach(a => {
        a.date = normalizeDate(a.date);
      });
    }
    if (state.debts) {
      state.debts.forEach(d => {
        d.dueDate = normalizeDate(d.dueDate);
      });
    }

    // Tự động gán STT cố định cho chứng từ cũ (Auto-Migration)
    if (state.entries && state.entries.length > 0) {
      let needsMigration = false;
      let maxSTT = 0;
      state.entries.forEach(e => {
        if (e.stt) {
          const val = Number(e.stt);
          if (!isNaN(val) && val > maxSTT) maxSTT = val;
        } else {
          needsMigration = true;
        }
      });
      if (needsMigration) {
        const sorted = [...state.entries].sort((a, b) => {
          const d = (a.date || '').localeCompare(b.date || '');
          if (d !== 0) return d;
          const c = (a.createdAt || '').localeCompare(b.createdAt || '');
          if (c !== 0) return c;
          return (a.id || '').localeCompare(b.id || '');
        });
        sorted.forEach(e => {
          if (!e.stt || isNaN(Number(e.stt))) {
            maxSTT++;
            e.stt = maxSTT;
          }
        });
        saveData();
        if (SCRIPT_URL && SCRIPT_URL.startsWith('http')) {
          window.sendToCloud({
            action: 'restoreAll',
            entries: state.entries,
            users: state.users,
            categories: getCategories(),
            advances: state.advances,
            debts: state.debts,
            auditLogs: state.auditLogs
          });
        }
      }
    }

    rebuildIndexes();
  }
}

function saveData() {
  localStorage.setItem('tc_users', JSON.stringify(state.users));
  localStorage.setItem('tc_entries', JSON.stringify(state.entries));
  localStorage.setItem('tc_advances', JSON.stringify(state.advances));
  localStorage.setItem('tc_debts', JSON.stringify(state.debts));
  localStorage.setItem('tc_audit_logs', JSON.stringify(state.auditLogs));
  localStorage.setItem('tc_fleet_vehicles', JSON.stringify(state.fleetVehicles));
  localStorage.setItem('tc_fleet_drivers', JSON.stringify(state.fleetDrivers));
  localStorage.setItem('tc_fleet_routes', JSON.stringify(state.fleetRoutes));
  localStorage.setItem('tc_fleet_trips', JSON.stringify(state.fleetTrips));
  localStorage.setItem('tc_system_settings', JSON.stringify(state.systemSettings));
  if (window.saveAccounts) window.saveAccounts(state.accounts);
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
    return ['view', 'add', 'edit', 'invoice', 'cats', 'fleet_view', 'fleet_edit'].includes(perm);
  }
  if (state.currentUser.role === 'accountant') {
    return ['view', 'add', 'edit', 'approve', 'cats', 'reports', 'advances_edit', 'debts_edit', 'fleet_view', 'fleet_edit', 'fleet_salary'].includes(perm);
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

function triggerViewUpdate() {
  const activeLi = document.querySelector('.sidebar-menu li.active');
  if (activeLi) {
    const page = activeLi.dataset.page;
    if (page === 'dashboard') renderDashboard();
    if (page === 'journal') updateJournalView();
    if (page === 'advances') renderAdvances();
    if (page === 'debts') renderDebts();
    if (page === 'categories') renderCategoryPage();
    if (page === 'reports') {
      if (typeof generateReport === 'function') generateReport();
    }
    if (page === 'fleet') {
      if (typeof renderFleetPage === 'function') renderFleetPage();
    }
    if (page === 'audit') renderAuditLogs();
    if (page === 'settings') renderSettings();
  }
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
  
  window.sendToCloud({ action: 'saveAuditLog', auditLog: newLog });
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
  fleet: 'Quản lý Đội Xe & Lái Xe',
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
  const menuFleet = $('menuFleet');
  const menuAudit = $('menuAudit');
  const menuSettings = $('menuSettings');
  
  [menuDashboard, menuJournal, menuAdvances, menuDebts, menuCategories, menuReports, menuFleet, menuAudit, menuSettings].forEach(m => {
    if (m) m.classList.remove('hidden');
  });

  if (!hasPermission('fleet_view')) {
    if (menuFleet) menuFleet.classList.add('hidden');
  }

  if (role === 'staff') {
    if (menuJournal) menuJournal.classList.add('hidden');
    if (menuDebts) menuDebts.classList.add('hidden');
    if (menuCategories) menuCategories.classList.add('hidden');
    if (menuReports) menuReports.classList.add('hidden');
    if (menuSettings) menuSettings.classList.add('hidden');
    if (menuAudit) menuAudit.classList.add('hidden');
    
    const activeLi = document.querySelector('.sidebar-menu li.active');
    if (activeLi && ['journal', 'debts', 'categories', 'reports', 'settings', 'audit', 'fleet'].includes(activeLi.dataset.page)) {
      if (menuDashboard) menuDashboard.click();
    }
  } else if (role === 'treasurer') {
    if (menuCategories) menuCategories.classList.add('hidden');
    if (menuReports) menuReports.classList.add('hidden');
    if (menuSettings) menuSettings.classList.add('hidden');
    if (menuAudit) menuAudit.classList.add('hidden');
    
    const activeLi = document.querySelector('.sidebar-menu li.active');
    if (activeLi && ['categories', 'reports', 'settings', 'audit', 'fleet'].includes(activeLi.dataset.page)) {
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
    
    const settingsActions = $('settingsHeaderActions');
    if (settingsActions) {
      if (page === 'settings') {
        settingsActions.classList.remove('hidden');
        settingsActions.style.display = 'flex';
      } else {
        settingsActions.classList.add('hidden');
        settingsActions.style.display = 'none';
      }
    }
    
    if (page === 'dashboard') renderDashboard();
    if (page === 'journal') updateJournalView();
    if (page === 'advances') renderAdvances();
    if (page === 'debts') renderDebts();
    if (page === 'categories') renderCategoryPage();
    if (page === 'reports') initReportPage();
    if (page === 'fleet') renderFleetPage();
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

// Click Close Sidebar button to close mobile sidebar
const closeSidebarBtn = $('btnCloseSidebar');
if (closeSidebarBtn) {
  closeSidebarBtn.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.remove('mobile-open');
    const overlay = $('sidebarOverlay');
    if (overlay) overlay.classList.remove('active');
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
/* ===== ACCOUNTS & FUNDS BALANCES CALCULATIONS ===== */
function getAccountBalances() {
  const accounts = window.getAccounts ? window.getAccounts() : [];
  const balances = {};
  accounts.forEach(acc => {
    balances[acc.name] = Number(acc.initialBalance) || 0;
  });

  state.entries.forEach(e => {
    const amt = Number(e.amount) || 0;
    if (e.type === 'thu') {
      if (balances[e.account] !== undefined) {
        balances[e.account] += amt;
      }
    } else if (e.type === 'chi') {
      if (balances[e.account] !== undefined) {
        balances[e.account] -= amt;
      }
    } else if (e.type === 'transfer') {
      if (balances[e.account] !== undefined) {
        balances[e.account] -= amt;
      }
      if (balances[e.toAccount] !== undefined) {
        balances[e.toAccount] += amt;
      }
    }
  });

  return balances;
}

function renderAccountsGrid() {
  const accounts = window.getAccounts ? window.getAccounts() : [];
  const balances = getAccountBalances();
  const grid = $('accountsBalanceGrid');
  if (!grid) return;

  const gradientClasses = [
    'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
    'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    'linear-gradient(135deg, #8a2387 0%, #e94057 100%, #f27121 100%)',
    'linear-gradient(135deg, #da22ff 0%, #9114ff 100%)'
  ];

  grid.innerHTML = accounts.map((acc, idx) => {
    const currentBalance = balances[acc.name] || 0;
    const gradient = gradientClasses[idx % gradientClasses.length];
    const isNegative = currentBalance < 0;

    return `
      <div class="stat-card" style="background:${gradient};color:#fff;border:none;box-shadow:0 8px 20px rgba(0,0,0,0.15);position:relative;overflow:hidden;padding:18px">
        <div style="position:absolute;top:-10px;right:-10px;font-size:5rem;opacity:0.07;color:#fff"><i class="fas fa-wallet"></i></div>
        <div class="stat-info" style="z-index:2">
          <small style="opacity:0.8;font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;font-weight:600;display:block;margin-bottom:4px">${acc.name}</small>
          <h3 style="font-size:1.4rem;font-weight:700;margin:0;letter-spacing:-0.5px;color:#fff">${fmt(currentBalance)}</h3>
          <span style="font-size:0.7rem;opacity:0.75;display:block;margin-top:6px;font-weight:300"><i class="fas fa-info-circle" style="margin-right:3px"></i>${acc.desc || 'Tài khoản quỹ'}</span>
        </div>
      </div>
    `;
  }).join('');
}

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

  // Render accounts balance grid
  renderAccountsGrid();

  // Recent
  const recent = [...state.entries].sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    if (d !== 0) return d;
    const c = (b.createdAt || '').localeCompare(a.createdAt || '');
    if (c !== 0) return c;
    return b.id.localeCompare(a.id);
  }).slice(0, 8);
  
  $('recentTable').innerHTML = recent.map(e => {
    let typeBadge = `<span class="badge badge-${e.type}">${e.type === 'thu' ? '▲ Thu' : '▼ Chi'}</span>`;
    let amountSign = e.type === 'thu' ? '+' : '-';
    let amountColor = e.type === 'thu' ? 'var(--green)' : 'var(--red)';
    let reasonText = e.reason;

    if (e.type === 'transfer') {
      typeBadge = `<span class="badge badge-transfer" style="background:rgba(102,126,234,.2);color:var(--primary)">⇄ Chuyển quỹ</span>`;
      amountSign = '';
      amountColor = 'var(--text)';
      reasonText = `<span style="color:var(--primary);font-weight:500">[${e.account} ➔ ${e.toAccount}]</span> ${e.reason}`;
    }

    return `
      <tr>
        <td>${formatDate(e.date)}</td>
        <td>${typeBadge}</td>
        <td style="color:${amountColor};font-weight:600">${amountSign}${fmt(e.amount)}</td>
        <td>${reasonText}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:30px">Chưa có giao dịch nào</td></tr>';

  renderCharts();
}

function formatDate(d) {
  if (!d) return '';
  const dateStr = d.includes('T') ? d.split('T')[0] : d;
  const parts = dateStr.split('-');
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
  const filterAcc = $('filterAccount')?.value || 'all';
  const startDate = $('filterStartDate')?.value || '';
  const endDate = $('filterEndDate')?.value || '';

  // Populate Accounts dropdown if present
  const filterAccEl = $('filterAccount');
  if (filterAccEl) {
    const currentAccSelection = filterAccEl.value;
    const accounts = window.getAccounts ? window.getAccounts() : [];
    let optionsHtml = '<option value="all">Tất cả tài khoản</option>';
    accounts.forEach(acc => {
      optionsHtml += `<option value="${acc.name}" ${currentAccSelection === acc.name ? 'selected' : ''}>${acc.name}</option>`;
    });
    filterAccEl.innerHTML = optionsHtml;
  }

  // Hiển thị/ẩn nút xóa bộ lọc ngày
  const btnClear = $('btnClearDates');
  if (btnClear) {
    btnClear.style.display = (startDate || endDate) ? 'flex' : 'none';
  }

  let list = [...state.entries];
  if (filter !== 'all') list = list.filter(e => e.type === filter);
  if (filterCat !== 'all') list = list.filter(e => e.category === filterCat);
  if (filterAcc !== 'all') list = list.filter(e => e.account === filterAcc || e.toAccount === filterAcc);
  if (startDate) list = list.filter(e => e.date >= startDate);
  if (endDate) list = list.filter(e => e.date <= endDate);
  if (search) list = list.filter(e => e.reason.toLowerCase().includes(search) || e.category.toLowerCase().includes(search));
  list.sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    if (d !== 0) return d;
    const c = (b.createdAt || '').localeCompare(a.createdAt || '');
    if (c !== 0) return c;
    return b.id.localeCompare(a.id);
  });

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

    return `
      <tr>
        <td>${e.stt || '-'}</td>
        <td>${formatDate(e.date)}</td>
        <td>
          ${e.type === 'transfer'
            ? `<span class="badge badge-transfer" style="background:rgba(102,126,234,.2);color:var(--primary)">⇄ Chuyển</span><span style="font-size:0.75rem;color:var(--text2);display:block;margin-top:2px;font-weight:500">${e.account || '-'} ➔ ${e.toAccount || '-'}</span>`
            : `<span class="badge badge-${e.type}">${e.type === 'thu' ? '▲ Thu' : '▼ Chi'}</span><span style="font-size:0.72rem;color:var(--text2);display:block;margin-top:2px;opacity:0.8"><i class="fas fa-wallet" style="margin-right:2px;font-size:0.65rem;opacity:0.6"></i>${e.account || 'Tiền mặt'}</span>`
          }
        </td>
        <td>${e.category}</td>
        <td style="color:${e.type === 'transfer' ? 'var(--text)' : (e.type === 'thu' ? 'var(--green)' : 'var(--red)')};font-weight:600">
          ${e.type === 'transfer' ? '' : (e.type === 'thu' ? '+' : '-')}${fmt(e.amount)}
        </td>
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
$('filterAccount')?.addEventListener('change', () => {
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
        <option value="transfer" ${entry && entry.type === 'transfer' ? 'selected' : ''}>⇄ Chuyển quỹ nội bộ</option>
      </select>
    </div>
    <div class="form-group">
      <label>Ngày</label>
      <input type="date" id="fDate" value="${entry ? entry.date : today()}">
    </div>
    <div class="form-group" id="fCatGroup">
      <label>Danh mục</label>
      <select id="fCat">${window.getCatOptionsHtml(entry ? entry.type : 'thu', entry ? entry.category : '')}</select>
    </div>
    <div class="form-group" id="fAccountGroup">
      <label>Tài khoản / Quỹ</label>
      <select id="fAccount">${window.getAccountOptionsHtml(entry ? entry.account : '')}</select>
    </div>
    <div class="form-group" id="fToAccountGroup" style="display:none">
      <label>Đến tài khoản / Quỹ nhận</label>
      <select id="fToAccount">${window.getAccountOptionsHtml(entry ? entry.toAccount : '')}</select>
    </div>
    <div class="form-group" id="fDriverGroup" style="display:${entry && entry.type === 'chi' ? 'block' : 'none'}">
      <label>Lái xe thanh toán (nếu có)</label>
      <select id="fDriverId">
        <option value="">-- Không có / Không áp dụng --</option>
        ${state.fleetDrivers.map(d => `<option value="${d.id}" ${entry && entry.driverId === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}
      </select>
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
  updateCatOptions();

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
  const catGroup = $('fCatGroup');
  const accGroup = $('fAccountGroup');
  const toAccGroup = $('fToAccountGroup');
  const drvGroup = $('fDriverGroup');
  
  if (drvGroup) drvGroup.style.display = type === 'chi' ? 'block' : 'none';
  
  if (type === 'transfer') {
    if (catGroup) catGroup.style.display = 'none';
    if (accGroup) {
      accGroup.querySelector('label').textContent = 'Từ tài khoản / Quỹ chuyển';
      accGroup.style.display = 'block';
    }
    if (toAccGroup) toAccGroup.style.display = 'block';
  } else {
    if (catGroup) catGroup.style.display = 'block';
    if (accGroup) {
      accGroup.querySelector('label').textContent = 'Tài khoản / Quỹ';
      accGroup.style.display = 'block';
    }
    if (toAccGroup) toAccGroup.style.display = 'none';
    
    const entry = state.editingId ? state.entries.find(e => e.id === state.editingId) : null;
    $('fCat').innerHTML = window.getCatOptionsHtml(type, entry ? entry.category : '');
  }
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
  const rawDate = $('fDate').value;
  const date = normalizeDate(rawDate);
  const account = $('fAccount').value;
  const toAccount = type === 'transfer' ? $('fToAccount').value : '';
  const category = type === 'transfer' ? 'Chuyển quỹ nội bộ' : $('fCat').value;
  const amount = parseInt($('fAmount').value.replace(/\D/g, '')) || 0;
  const reason = $('fReason').value.trim();
  const driverId = type === 'chi' && $('fDriverId') ? $('fDriverId').value : '';

  if (!date || !amount || amount <= 0 || !reason) { toast('Vui lòng điền đầy đủ thông tin!', 'error'); return; }
  if (type === 'transfer' && account === toAccount) { toast('Tài khoản chuyển và tài khoản nhận phải khác nhau!', 'error'); return; }

  const invoice = state.selectedInvoice || '';
  let entry;
  if (state.editingId) {
    const idx = state.entries.findIndex(e => e.id === state.editingId);
    if (idx !== -1) {
      const oldEntry = { ...state.entries[idx] };
      state.entries[idx] = { ...state.entries[idx], type, date, category, amount, reason, invoice, account, toAccount, driverId, _unsynced: true };
      entry = state.entries[idx];
      
      let auditDetail = `Tài khoản ${state.currentUser.username} sửa chứng từ STT ${entry.stt || '-'} (Trước: ${oldEntry.type === 'thu' ? 'Thu' : (oldEntry.type === 'chi' ? 'Chi' : 'Chuyển quỹ')}, ${fmt(oldEntry.amount)}, lý do: ${oldEntry.reason} -> Sau: ${type === 'thu' ? 'Thu' : (type === 'chi' ? 'Chi' : 'Chuyển quỹ')}, ${fmt(amount)}, lý do: ${reason})`;
      writeAuditLog('Sửa giao dịch', auditDetail);
    }
    toast('Đã cập nhật giao dịch!');
  } else {
    const newStt = getNextSTT();
    entry = { id: uid(), type, date, category, amount, reason, invoice, createdBy: state.currentUser.username, createdAt: new Date().toISOString(), stt: newStt, account, toAccount, driverId, _unsynced: true };
    state.entries.push(entry);
    
    let auditDetail = `Tài khoản ${state.currentUser.username} thêm chứng từ mới STT ${newStt} (${type === 'thu' ? 'Thu' : (type === 'chi' ? 'Chi' : 'Chuyển quỹ')}, số tiền: ${fmt(amount)}, lý do: ${reason})`;
    writeAuditLog('Thêm giao dịch', auditDetail);
    
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
  
  // Chuẩn hóa và bảo vệ ngày tránh bị lỗi múi giờ hoặc định dạng
  state.entries[idx].date = normalizeDate(state.entries[idx].date);
  
  const oldStatus = state.entries[idx].approvalStatus || 'pending';
  state.entries[idx].approvalStatus = status;
  state.entries[idx]._unsynced = true;
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
  
  const statusLabels = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
  const nowStr = new Date().toLocaleString('vi-VN');
  writeAuditLog('Phê duyệt hóa đơn', `Tài khoản ${state.currentUser.username} thay đổi trạng thái phê duyệt chứng từ STT ${state.entries[idx].stt || '-'} từ [${statusLabels[oldStatus]}] sang [${statusLabels[status]}]. Thời gian xác nhận: ${nowStr}`);
  
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
  
  // Chuẩn hóa và bảo vệ ngày tránh bị lỗi múi giờ hoặc định dạng
  state.entries[idx].date = normalizeDate(state.entries[idx].date);
  
  state.entries[idx].auditStatus = newStatus;
  state.entries[idx].auditNote = newNote;
  state.entries[idx]._unsynced = true;
  saveData();
  
  // Ghi nhận lịch sử audit trail chi tiết
  const statusLabels = { pending: 'Chờ kiểm soát', valid: 'Hợp lệ', invalid: 'Không hợp lệ' };
  const nowStr = new Date().toLocaleString('vi-VN');
  const actionDetails = `Người kiểm soát [Tên đăng nhập: ${state.currentUser.username}] xác nhận giao dịch STT ${state.entries[idx].stt || '-'} (${state.entries[idx].type === 'thu' ? 'Thu' : 'Chi'}, số tiền: ${fmt(state.entries[idx].amount)}) là [${statusLabels[newStatus]}]. Xác nhận lúc: ${nowStr}. Ghi chú kiểm soát: "${newNote || 'Không có ghi chú'}"`;
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
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  if (!confirm(`Bạn có chắc muốn xoá giao dịch STT ${entry.stt || '-'}?`)) return;
  
  // Ghi nhận audit log chi tiết khi xóa
  writeAuditLog('Xóa giao dịch', `Tài khoản ${state.currentUser.username} xóa chứng từ STT ${entry.stt || '-'} (${entry.type === 'thu' ? 'Thu' : 'Chi'}, số tiền: ${fmt(entry.amount)}, lý do: ${entry.reason || 'Không có lý do'})`);
  
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
  const sorted = list.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const c = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });
  const data = sorted.map((e, i) => ({
    'STT': e.stt || (i + 1),
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
          date = normalizeDate(rawDate);
        }
        const typeRaw = (r['Loại'] || r['loại'] || r['Type'] || '').toString().toLowerCase();
        const type = typeRaw.includes('thu') || typeRaw.includes('income') ? 'thu' : 'chi';
        const amount = parseInt(r['Số tiền'] || r['số tiền'] || r['Amount'] || r['amount'] || 0);
        const reason = r['Lý do'] || r['lý do'] || r['Reason'] || r['Ghi chú'] || '';
        const category = r['Danh mục'] || r['danh mục'] || r['Category'] || (type === 'thu' ? 'Thu khác' : 'Chi khác');
        if (date && amount > 0) {
          state.entries.push({ id: uid(), type, date, category: String(category), amount, reason: String(reason), createdBy: state.currentUser.username, createdAt: new Date().toISOString(), stt: getNextSTT() });
          count++;
        }
      });
      saveData();
      window.sendToCloud({
        action: 'restoreAll',
        entries: state.entries,
        users: state.users,
        categories: getCategories(),
        advances: state.advances,
        debts: state.debts,
        auditLogs: state.auditLogs
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
  let list = [...state.entries];
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);
  list.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const c = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });

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
  renderAccountsSettings();
  renderFleetSalarySettings();
}

function renderFleetSalarySettings() {
  if (!hasPermission('users')) return;
  
  if ($('sVipBonus2')) $('sVipBonus2').value = getSetting('vip_bonus_2', '100000');
  if ($('sVipBonus3')) $('sVipBonus3').value = getSetting('vip_bonus_3', '300000');
  if ($('sVipBonus4')) $('sVipBonus4').value = getSetting('vip_bonus_4', '300000');
  
  const tbody = $('fleetDriversSettingsTable');
  if (!tbody) return;
  
  tbody.innerHTML = state.fleetDrivers.map(d => {
    return `
      <tr data-driver-id="${d.id}">
        <td><strong>${d.name}</strong></td>
        <td>
          <input type="number" class="drv-salary-input" value="${d.baseSalary || 0}" style="width:120px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg1);color:var(--text)">
        </td>
        <td>
          <input type="number" class="drv-allowance-input" value="${d.allowance || 0}" style="width:120px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg1);color:var(--text)">
        </td>
        <td>
          <span style="font-size:0.82rem;color:var(--text2)">${d.notes || '-'}</span>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:20px">Chưa có lái xe</td></tr>';
}

function saveFleetSalarySettings() {
  if (!hasPermission('users')) return toast('Bạn không có quyền chỉnh sửa cài đặt!', 'error');
  
  const vip2 = parseFloat($('sVipBonus2').value) || 0;
  const vip3 = parseFloat($('sVipBonus3').value) || 0;
  const vip4 = parseFloat($('sVipBonus4').value) || 0;
  
  const settings = {
    vip_bonus_2: vip2,
    vip_bonus_3: vip3,
    vip_bonus_4: vip4
  };
  
  for (let k in settings) {
    const idx = state.systemSettings.findIndex(s => s.key === k);
    if (idx !== -1) {
      state.systemSettings[idx].value = String(settings[k]);
      state.systemSettings[idx]._unsynced = true;
    } else {
      state.systemSettings.push({ key: k, value: String(settings[k]), desc: '', _unsynced: true });
    }
  }
  
  const rows = document.querySelectorAll('#fleetDriversSettingsTable tr[data-driver-id]');
  rows.forEach(row => {
    const drvId = row.dataset.driverId;
    const salary = parseFloat(row.querySelector('.drv-salary-input').value) || 0;
    const allowance = parseFloat(row.querySelector('.drv-allowance-input').value) || 0;
    
    const idx = state.fleetDrivers.findIndex(d => d.id === drvId);
    if (idx !== -1) {
      state.fleetDrivers[idx].baseSalary = salary;
      state.fleetDrivers[idx].allowance = allowance;
      state.fleetDrivers[idx]._unsynced = true;
      
      window.sendToCloud({ action: 'saveFleetDriver', driver: state.fleetDrivers[idx] });
    }
  });
  
  saveData();
  window.sendToCloud({ action: 'saveSystemSettings', settings });
  writeAuditLog('Cập nhật cấu hình Đội xe', `Cập nhật cấu hình thưởng VIP và bảng lương của lái xe`);
  toast('Đã lưu cấu hình Đội xe và đồng bộ đám mây thành công!');
  renderSettings();
}

/* ===== ACCOUNTS SETTINGS & CRUD FUNCTIONS ===== */
function renderAccountsSettings() {
  if (!hasPermission('users')) return;
  const tbody = $('accountsTable');
  if (!tbody) return;
  const accounts = window.getAccounts ? window.getAccounts() : [];
  
  tbody.innerHTML = accounts.map((acc, i) => {
    return `
      <tr>
        <td><strong>${acc.name}</strong></td>
        <td style="color:var(--green);font-weight:600">${fmt(acc.initialBalance || 0)}</td>
        <td><span style="color:var(--text2);font-size:0.85rem">${acc.desc || '-'}</span></td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="showEditAccountForm('${acc.id}')" title="Sửa tài khoản"><i class="fas fa-edit"></i></button>
          ${acc.id !== 'cash' ? `<button class="btn btn-danger btn-sm" onclick="deleteAccount('${acc.id}')" title="Xóa tài khoản"><i class="fas fa-trash-alt"></i></button>` : ''}
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:20px">Chưa có tài khoản</td></tr>';
}

window.showAddAccountForm = function() {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  openModal('Thêm tài khoản / quỹ mới', `
    <div class="form-group">
      <label>Tên tài khoản / quỹ</label>
      <input type="text" id="fAccName" placeholder="Ví dụ: Vietcombank, Quỹ phụ...">
    </div>
    <div class="form-group">
      <label>Số dư đầu kỳ (₫)</label>
      <input type="text" id="fAccBalance" placeholder="Nhập số dư đầu kỳ">
    </div>
    <div class="form-group">
      <label>Mô tả / Ghi chú</label>
      <input type="text" id="fAccDesc" placeholder="Mô tả tài khoản...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveNewAccount()">Thêm tài khoản</button>
    </div>
  `);
  
  const fAmt = $('fAccBalance');
  if (fAmt) {
    fAmt.addEventListener('input', function () {
      const clean = this.value.replace(/\D/g, '');
      this.value = clean ? new Intl.NumberFormat('vi-VN').format(parseInt(clean)) : '';
    });
  }
};

window.saveNewAccount = function() {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  const name = $('fAccName').value.trim();
  const balance = parseInt($('fAccBalance').value.replace(/\D/g, '')) || 0;
  const desc = $('fAccDesc').value.trim();
  
  if (!name) return toast('Vui lòng điền tên tài khoản!', 'error');
  
  if (state.accounts.some(acc => acc.name.toLowerCase() === name.toLowerCase())) {
    return toast('Tên tài khoản đã tồn tại!', 'error');
  }
  
  const acc = {
    id: 'acc_' + Date.now().toString(36),
    name,
    initialBalance: balance,
    desc,
    _unsynced: true
  };
  
  state.accounts.push(acc);
  saveData();
  window.sendToCloud({ action: 'saveAccount', account: acc });
  
  writeAuditLog('Thêm tài khoản', `Tài khoản ${state.currentUser.username} thêm tài khoản/quỹ mới: ${name} (Số dư đầu: ${fmt(balance)})`);
  
  closeModal();
  renderSettings();
  renderDashboard();
  toast('Đã thêm tài khoản mới!');
};

window.showEditAccountForm = function(id) {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  const acc = state.accounts.find(x => x.id === id);
  if (!acc) return;
  
  openModal('Sửa tài khoản / quỹ', `
    <div class="form-group">
      <label>Tên tài khoản / quỹ</label>
      <input type="text" id="fAccName" value="${acc.name}">
    </div>
    <div class="form-group">
      <label>Số dư đầu kỳ (₫)</label>
      <input type="text" id="fAccBalance" value="${formatThousand(acc.initialBalance || 0)}">
    </div>
    <div class="form-group">
      <label>Mô tả / Ghi chú</label>
      <input type="text" id="fAccDesc" value="${acc.desc || ''}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="updateAccount('${id}')">Cập nhật</button>
    </div>
  `);
  
  const fAmt = $('fAccBalance');
  if (fAmt) {
    fAmt.addEventListener('input', function () {
      const clean = this.value.replace(/\D/g, '');
      this.value = clean ? new Intl.NumberFormat('vi-VN').format(parseInt(clean)) : '';
    });
  }
};

window.updateAccount = function(id) {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  const acc = state.accounts.find(x => x.id === id);
  if (!acc) return;
  
  const name = $('fAccName').value.trim();
  const balance = parseInt($('fAccBalance').value.replace(/\D/g, '')) || 0;
  const desc = $('fAccDesc').value.trim();
  
  if (!name) return toast('Tên tài khoản không được để trống!', 'error');
  
  if (state.accounts.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
    return toast('Tên tài khoản đã tồn tại ở tài khoản khác!', 'error');
  }
  
  const oldName = acc.name;
  acc.name = name;
  acc.initialBalance = balance;
  acc.desc = desc;
  acc._unsynced = true;
  
  state.entries.forEach(e => {
    if (e.account === oldName) e.account = name;
    if (e.toAccount === oldName) e.toAccount = name;
  });
  
  saveData();
  window.sendToCloud({ action: 'saveAccount', account: acc });
  
  writeAuditLog('Sửa tài khoản', `Tài khoản ${state.currentUser.username} sửa tài khoản/quỹ: ${oldName} -> ${name}`);
  
  closeModal();
  renderSettings();
  renderDashboard();
  updateJournalView();
  toast('Đã cập nhật tài khoản!');
};

window.deleteAccount = function(id) {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  const idx = state.accounts.findIndex(x => x.id === id);
  if (idx === -1) return;
  const acc = state.accounts[idx];
  
  if (acc.id === 'cash') {
    return toast('Không thể xóa tài khoản tiền mặt mặc định!', 'error');
  }
  
  if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản "${acc.name}"? Các giao dịch liên quan sẽ tự động chuyển về tài khoản "Tiền mặt".`)) return;
  
  const name = acc.name;
  
  state.entries.forEach(e => {
    if (e.account === name) e.account = 'Tiền mặt';
    if (e.toAccount === name) e.toAccount = 'Tiền mặt';
  });
  
  state.accounts.splice(idx, 1);
  saveData();
  window.sendToCloud({ action: 'deleteAccount', name: name });
  
  writeAuditLog('Xóa tài khoản', `Tài khoản ${state.currentUser.username} xóa tài khoản/quỹ: ${name}`);
  
  renderSettings();
  renderDashboard();
  updateJournalView();
  toast('Đã xóa tài khoản!');
};

window.editUserPermissions = function (username) {
  const u = state.users.find(x => x.username === username);
  if (!u) return;

  let activePerms = [];
  if (u.permissions) {
    activePerms = typeof u.permissions === 'string' ? u.permissions.split(',') : u.permissions;
  } else {
    if (u.role === 'admin') activePerms = ['view', 'add', 'edit', 'delete', 'invoice', 'approve', 'users', 'cats', 'reports', 'advances_edit', 'debts_edit', 'fleet_view', 'fleet_edit', 'fleet_salary'];
    else if (u.role === 'audit') activePerms = ['view', 'approve'];
    else if (u.role === 'editor') activePerms = ['view', 'add', 'edit', 'invoice', 'cats', 'fleet_view', 'fleet_edit'];
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
        { key: 'reports', label: 'Báo cáo P&L', desc: 'Quyền xem báo cáo P&L chuyên sâu và dự báo dòng tiền.' },
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
    },
    {
      title: '🚚 Quyền Quản lý Đội xe & Lái xe',
      color: '#3b82f6',
      perms: [
        { key: 'fleet_view', label: 'Xem quản lý đội xe', desc: 'Xem danh sách xe, lái xe, lịch trình và báo cáo tiêu hao nhiên liệu.' },
        { key: 'fleet_edit', label: 'Cập nhật đội xe', desc: 'Thêm, sửa, xóa thông tin xe, lái xe, phân công chuyến đi và ghi nhận dầu.' },
        { key: 'fleet_salary', label: 'Tính lương lái xe', desc: 'Xem và tính lương cho lái xe theo chuyến và lương cơ bản.' }
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

$('btnAddAccount')?.addEventListener('click', () => {
  showAddAccountForm();
});

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
    permissions = 'view,add,edit,delete,invoice,approve,users,cats,reports,advances_edit,debts_edit,fleet_view,fleet_edit,fleet_salary';
    label = 'Quản trị viên';
  } else if (role === 'accountant') {
    permissions = 'view,add,edit,approve,cats,reports,advances_edit,debts_edit,fleet_view,fleet_edit,fleet_salary';
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
  const sorted = [...state.entries].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const c = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });
  const entryData = sorted.map((e, i) => ({
    'STT': e.stt || (i + 1),
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
            const rawDate = r['Date_raw'] || r['Ngày'] || '';
            let date = '';
            if (typeof rawDate === 'number') {
              const d = XLSX.SSF.parse_date_code(rawDate);
              date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
            } else {
              date = normalizeDate(rawDate);
            }
            
            // Khôi phục trạng thái kiểm soát (auditStatus) từ tiếng Việt
            let auditStatus = 'pending';
            const auditRaw = r['Kiểm soát'] || '';
            if (auditRaw === 'Hợp lệ') auditStatus = 'valid';
            else if (auditRaw === 'Không hợp lệ') auditStatus = 'invalid';
            
            return {
              id: r['ID'] || uid(),
              type: typeRaw.includes('thu') ? 'thu' : 'chi',
              date,
              category: r['Danh mục'] || 'Khác',
              amount: parseInt(r['Số tiền'] || 0),
              reason: r['Lý do'] || '',
              createdBy: r['Người tạo'] || 'imported',
              createdAt: r['Ngày tạo'] || new Date().toISOString(),
              approvalStatus: r['Trạng thái duyệt'] === 'Đã duyệt' ? 'approved' : (r['Trạng thái duyệt'] === 'Từ chối' ? 'rejected' : ''),
              auditStatus,
              auditNote: r['Ghi chú kiểm soát'] || '',
              stt: Number(r['STT']) || null
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
        categories: getCategories(),
        advances: state.advances,
        debts: state.debts,
        auditLogs: state.auditLogs
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
$('btnGenDemo')?.addEventListener('click', () => {
  if (!hasPermission('users')) return toast('Bạn không có quyền!', 'error');
  if (!confirm('Tạo 1000 mẫu dữ liệu demo? Dữ liệu hiện tại sẽ được giữ nguyên.')) return;
  const demos = generateDemoEntries(1000);
  state.entries = state.entries.concat(demos);
  saveData();
  window.sendToCloud({
    action: 'restoreAll',
    entries: state.entries,
    users: state.users,
    categories: getCategories(),
    advances: state.advances,
    debts: state.debts,
    auditLogs: state.auditLogs
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
  const btnNew = $('btnNewAdvance');
  if (btnNew) {
    if (hasPermission('advances_submit')) {
      btnNew.style.display = 'inline-block';
    } else {
      btnNew.style.display = 'none';
    }
  }
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
  list.sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    if (d !== 0) return d;
    const c = (b.createdAt || '').localeCompare(a.createdAt || '');
    if (c !== 0) return c;
    return b.id.localeCompare(a.id);
  });

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
  if (!hasPermission('advances_submit')) {
    toast('Bạn không có quyền tạo đề xuất tạm ứng!', 'error');
    return;
  }
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
  if (!hasPermission('advances_submit')) {
    toast('Bạn không có quyền tạo đề xuất tạm ứng!', 'error');
    return;
  }
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
    settlementInvoice: null,
    _unsynced: true
  };

  state.advances.push(newAdv);
  saveData();
  window.sendToCloud({ action: 'saveAdvance', advance: newAdv });
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
  adv._unsynced = true;
  
  const journalEntry = {
    id: uid(),
    type: 'chi',
    date: today(),
    category: 'Chi khác',
    amount: adv.amount,
    reason: `[Tạm ứng] Chi tiền tạm ứng cho nhân viên ${adv.employee} - Lý do: ${adv.reason}`,
    createdBy: state.currentUser.username,
    createdAt: new Date().toISOString(),
    approvalStatus: 'approved',
    stt: getNextSTT(),
    _unsynced: true
  };
  
  state.entries.push(journalEntry);
  rebuildIndexes();
  saveData();
  
  // Đồng bộ đám mây
  window.sendToCloud({ action: 'saveEntry', entry: journalEntry });
  window.sendToCloud({ action: 'saveAdvance', advance: adv });
  
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
  state.selectedSetInvoiceFile = null;
  const settleFile = $('settleInvoiceFile');
  if (settleFile) {
    settleFile.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = function(event) {
        state.selectedSetInvoice = event.target.result;
        const base64Data = event.target.result.split(',')[1];
        state.selectedSetInvoiceFile = {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64: base64Data,
          size: file.size
        };
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

  const isSelf = state.currentUser && state.currentUser.username === adv.employee;
  const isAccountantOrAdmin = hasPermission('advances_edit');
  if (!isSelf && !isAccountantOrAdmin) {
    toast('Bạn không có quyền quyết toán đề xuất này!', 'error');
    return;
  }

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
  adv._unsynced = true;

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
    approvalStatus: 'approved',
    stt: getNextSTT(),
    _unsynced: true
  };
  state.entries.push(expenseEntry);
  window.sendToCloud({ action: 'saveEntry', entry: expenseEntry, fileData: state.selectedSetInvoiceFile });

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
      approvalStatus: 'approved',
      stt: getNextSTT(),
      _unsynced: true
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
      approvalStatus: 'approved',
      stt: getNextSTT(),
      _unsynced: true
    };
    state.entries.push(refundEntry);
    window.sendToCloud({ action: 'saveEntry', entry: refundEntry });
  }

  rebuildIndexes();
  saveData();
  window.sendToCloud({ action: 'saveAdvance', advance: adv, fileData: state.selectedSetInvoiceFile });
  
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
  window.sendToCloud({ action: 'deleteAdvance', id });
  
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
  list.sort((a, b) => {
    const d = a.dueDate.localeCompare(b.dueDate);
    if (d !== 0) return d;
    const c = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });

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
    paymentDate: null,
    _unsynced: true
  };

  state.debts.push(newDebt);
  saveData();
  window.sendToCloud({ action: 'saveDebt', debt: newDebt });
  
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
  debt._unsynced = true;
  
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
    approvalStatus: 'approved',
    stt: getNextSTT(),
    _unsynced: true
  };

  state.entries.push(journalEntry);
  rebuildIndexes();
  saveData();
  
  // Đồng bộ đám mây
  window.sendToCloud({ action: 'saveEntry', entry: journalEntry });
  window.sendToCloud({ action: 'saveDebt', debt });
  
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
  window.sendToCloud({ action: 'deleteDebt', id });
  
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
    createdAt: new Date().toISOString(),
    stt: getNextSTT(),
    _unsynced: true
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
    createdAt: new Date().toISOString(),
    stt: getNextSTT(),
    _unsynced: true
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

  const list = [...state.entries].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const c = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });
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



/* ===== EVENT WIRING & ADAPTER CORES ===== */
function wireUpAdvancedModules() {
  $('btnNewAdvance')?.addEventListener('click', () => {
    submitAdvanceProposal();
  });
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
    window.sendToCloud({ action: 'clearAuditLogs' });
    renderAuditLogs();
    toast('Đã xóa sạch nhật ký kiểm toán hệ thống thành công!', 'info');
  });
}


/* ===== INIT ===== */
async function runPolling() {
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
  }
  if (state.currentUser) {
    await loadData(true);
    triggerViewUpdate();
  }
  const delay = document.visibilityState === 'visible' ? 4000 : 30000;
  pollingTimeout = setTimeout(runPolling, delay);
}

(async function () {
  await loadData();
  initLogin();
  initTheme();
  window.populateFilterCategories();
  wireUpAdvancedModules();
  initFleetModule();
  
  // Thiết lập tự động đồng bộ hóa thời gian thực (background adaptive polling)
  runPolling();
})();
// -------------------------------------------------------------
// MODULE QUẢN LÝ ĐỘI XE & LÁI XE (FLEET MANAGEMENT MODULE)
// -------------------------------------------------------------

function getSetting(key, defaultValue) {
  if (!state.systemSettings) return defaultValue;
  const item = state.systemSettings.find(s => s.key === key);
  return item ? item.value : defaultValue;
}
function getSettingNumber(key, defaultValue) {
  return Number(getSetting(key, defaultValue)) || 0;
}

let fleetActiveTab = 'trips';
let fleetTripsPage = 1;
const fleetTripsLimit = 15;
let fleetTripInvoiceFile = null;

function initFleetModule() {
  // Đăng ký sự kiện chuyển Tab nội bộ
  document.querySelectorAll('.fleet-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fleet-tab-btn').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      
      const tab = btn.dataset.tab;
      fleetActiveTab = tab;
      
      document.querySelectorAll('.fleet-tab-content').forEach(c => c.classList.remove('active'));
      const activeContent = $('fleetTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
      if (activeContent) activeContent.classList.add('active');
      
      renderFleetActiveTab();
    });
  });

  // Thiết lập sự kiện click cho các nút thêm mới
  $('btnAddFleetTrip')?.addEventListener('click', showAddTripForm);
  $('btnAddFleetVehicle')?.addEventListener('click', showAddVehicleForm);
  $('btnAddFleetDriver')?.addEventListener('click', showAddDriverForm);
  $('btnAddFleetRoute')?.addEventListener('click', showAddRouteForm);
  
  // Bộ lọc chuyến đi
  $('tripSearchInput')?.addEventListener('input', () => { fleetTripsPage = 1; renderFleetTrips(); });
  $('tripFilterStart')?.addEventListener('change', () => { fleetTripsPage = 1; renderFleetTrips(); });
  $('tripFilterEnd')?.addEventListener('change', () => { fleetTripsPage = 1; renderFleetTrips(); });
  $('tripFilterDriver')?.addEventListener('change', () => { fleetTripsPage = 1; renderFleetTrips(); });
  $('tripFilterVehicle')?.addEventListener('change', () => { fleetTripsPage = 1; renderFleetTrips(); });

  // Bộ lọc báo cáo
  $('btnGenFleetReport')?.addEventListener('click', generateFleetReport);
  $('btnExportFleetReport')?.addEventListener('click', exportFleetReport);
  $('btnPrintFleetReport')?.addEventListener('click', printFleetReport);

  // Gán ngày mặc định cho bộ lọc báo cáo (Tháng hiện tại)
  if ($('fltReportStart')) {
    const todayDate = new Date();
    const firstDay = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
    $('fltReportStart').value = firstDay.toISOString().slice(0, 10);
    $('fltReportEnd').value = todayDate.toISOString().slice(0, 10);
  }
}

function renderFleetPage() {
  if (!hasPermission('fleet_view')) {
    toast('Bạn không có quyền truy cập trang này!', 'error');
    const menuDashboard = document.querySelector('.sidebar-menu li[data-page="dashboard"]');
    if (menuDashboard) menuDashboard.click();
    return;
  }
  
  // Nạp dữ liệu các bộ lọc dropdown
  populateFleetFilters();
  
  // Vẽ dữ liệu cho tab đang hoạt động
  renderFleetActiveTab();
}

function renderFleetActiveTab() {
  if (fleetActiveTab === 'trips') renderFleetTrips();
  if (fleetActiveTab === 'vehicles') renderFleetVehicles();
  if (fleetActiveTab === 'drivers') renderFleetDrivers();
  if (fleetActiveTab === 'routes') renderFleetRoutes();
  if (fleetActiveTab === 'reports') generateFleetReport();
}

function populateFleetFilters() {
  const drvSelect = $('tripFilterDriver');
  if (drvSelect) {
    const prev = drvSelect.value;
    drvSelect.innerHTML = '<option value="all">Tất cả lái xe</option>' + 
      state.fleetDrivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    drvSelect.value = prev || 'all';
  }

  const vehSelect = $('tripFilterVehicle');
  if (vehSelect) {
    const prev = vehSelect.value;
    vehSelect.innerHTML = '<option value="all">Tất cả xe</option>' + 
      state.fleetVehicles.map(v => `<option value="${v.id}">${v.plate}</option>`).join('');
    vehSelect.value = prev || 'all';
  }
}

// Hàm tính dầu định mức của chuyến đi
function getTripFuelNorm(trip) {
  // 1. Ưu tiên định mức dầu cố định theo Tuyến đường cấu hình
  const route = state.fleetRoutes.find(r => r.id === trip.routeId);
  if (route && Number(route.fuelNorm) > 0) {
    return Number(route.fuelNorm);
  }
  // 2. Nếu không có, tự động tính bằng: Số km * Định mức tiêu chuẩn xe / 100
  const vehicle = state.fleetVehicles.find(v => v.id === trip.vehicleId);
  if (vehicle && Number(vehicle.fuelNorm) > 0) {
    return Number(trip.kmActual) * (Number(vehicle.fuelNorm) / 100);
  }
  return 0;
}

// -------------------------------------------------------------
// RENDER TABS
// -------------------------------------------------------------

// 1. TAB LỊCH TRÌNH & NHIÊN LIỆU
function renderFleetTrips() {
  const tbody = $('fleetTripsTable');
  if (!tbody) return;

  const search = $('tripSearchInput')?.value.toLowerCase().trim() || '';
  const start = $('tripFilterStart')?.value || '';
  const end = $('tripFilterEnd')?.value || '';
  const driverId = $('tripFilterDriver')?.value || 'all';
  const vehicleId = $('tripFilterVehicle')?.value || 'all';

  let filtered = [...state.fleetTrips];

  // Áp dụng bộ lọc
  if (search) {
    filtered = filtered.filter(t => {
      const drv = state.fleetDrivers.find(d => d.id === t.driverId);
      const veh = state.fleetVehicles.find(v => v.id === t.vehicleId);
      return (drv && drv.name.toLowerCase().includes(search)) || 
             (veh && veh.plate.toLowerCase().includes(search)) || 
             (t.startPoint && t.startPoint.toLowerCase().includes(search)) ||
             (t.endPoint && t.endPoint.toLowerCase().includes(search)) ||
             (t.notes && t.notes.toLowerCase().includes(search));
    });
  }
  if (start) filtered = filtered.filter(t => t.date >= start);
  if (end) filtered = filtered.filter(t => t.date <= end);
  if (driverId !== 'all') filtered = filtered.filter(t => t.driverId === driverId);
  if (vehicleId !== 'all') filtered = filtered.filter(t => t.vehicleId === vehicleId);

  // Sắp xếp ngày mới nhất lên đầu
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  // Phân trang
  const total = filtered.length;
  const totalPages = Math.ceil(total / fleetTripsLimit) || 1;
  if (fleetTripsPage > totalPages) fleetTripsPage = totalPages;
  const startIdx = (fleetTripsPage - 1) * fleetTripsLimit;
  const paginated = filtered.slice(startIdx, startIdx + fleetTripsLimit);

  const canEdit = hasPermission('fleet_edit');
  
  tbody.innerHTML = paginated.map((t, idx) => {
    const drv = state.fleetDrivers.find(d => d.id === t.driverId);
    const veh = state.fleetVehicles.find(v => v.id === t.vehicleId);
    const drvName = drv ? drv.name : 'Chưa rõ';
    const vehPlate = veh ? veh.plate : 'Chưa rõ';
    
    const kmActual = Number(t.kmActual) || 0;
    const fuelActual = Number(t.fuelActual) || 0;
    
    // Tính nhiên liệu định mức và chênh lệch chênh lệch
    const fuelNorm = Number(t.fuelNorm) || getTripFuelNorm(t);
    const diff = fuelActual - fuelNorm;
    
    let diffHtml = '';
    if (diff > 0) {
      diffHtml = `<span class="badge-fuel-warning" title="Vượt định mức tiêu hao"><i class="fas fa-exclamation-triangle"></i> Vượt ${diff.toFixed(1)}L</span>`;
    } else {
      diffHtml = `<span class="badge-fuel-safe" title="Tiết kiệm dầu"><i class="fas fa-check"></i> -${Math.abs(diff).toFixed(1)}L</span>`;
    }

    const allowance = Number(t.allowance) || 0;
    const expense = Number(t.expense) || 0;
    
    // Chứng từ ảnh
    let invoiceHtml = '-';
    if (t.invoice) {
      if (t.invoice.startsWith('data:')) {
        invoiceHtml = `<a href="javascript:void(0)" onclick="showTripInvoiceZoom('${t.id}')" style="color:var(--yellow)"><i class="fas fa-file-image"></i> Chưa đồng bộ</a>`;
      } else {
        invoiceHtml = `<a href="${t.invoice}" target="_blank" style="color:var(--primary)"><i class="fas fa-receipt"></i> Xem hóa đơn</a>`;
      }
    }

    const globalIdx = startIdx + idx + 1;
    
    return `
      <tr>
        <td>${globalIdx}</td>
        <td>${t.date}</td>
        <td><strong>${drvName}</strong></td>
        <td><span style="font-family:monospace;background:rgba(255,255,255,0.05);padding:4px 8px;border-radius:6px">${vehPlate}</span></td>
        <td>${t.startPoint} ➔ ${t.endPoint}</td>
        <td>${fmtThousands(kmActual)} km</td>
        <td>${fuelActual.toFixed(1)} L</td>
        <td>${fuelNorm.toFixed(1)} L</td>
        <td>${diffHtml}</td>
        <td style="color:var(--green)">${fmtThousands(allowance)} ₫</td>
        <td style="color:var(--red)">${fmtThousands(expense)} ₫</td>
        <td>${invoiceHtml}</td>
        <td>
          ${canEdit ? `
            <button class="btn btn-primary btn-sm" onclick="showEditTripForm('${t.id}')" title="Sửa"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="deleteFleetTrip('${t.id}')" title="Xóa"><i class="fas fa-trash"></i></button>
          ` : '-'}
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="13" style="text-align:center;color:var(--text2);padding:30px">Chưa có dữ liệu chuyến đi nào</td></tr>`;

  // Vẽ nút phân trang
  renderFleetPagination(totalPages);
}

function renderFleetPagination(totalPages) {
  const pagEl = $('fleetTripsPagination');
  if (!pagEl) return;
  if (totalPages <= 1) {
    pagEl.innerHTML = '';
    return;
  }
  
  pagEl.innerHTML = `
    <button class="btn btn-secondary btn-sm" ${fleetTripsPage === 1 ? 'disabled' : ''} onclick="changeFleetTripsPage(${fleetTripsPage - 1})">
      <i class="fas fa-chevron-left"></i> Trước
    </button>
    <span class="pagination-info" style="color:var(--text2);font-size:0.85rem">Trang <strong>${fleetTripsPage}</strong> / ${totalPages}</span>
    <button class="btn btn-secondary btn-sm" ${fleetTripsPage === totalPages ? 'disabled' : ''} onclick="changeFleetTripsPage(${fleetTripsPage + 1})">
      Sau <i class="fas fa-chevron-right"></i>
    </button>
  `;
}

window.changeFleetTripsPage = function(p) {
  fleetTripsPage = p;
  renderFleetTrips();
};

// 2. TAB QUẢN LÝ XE
function renderFleetVehicles() {
  const tbody = $('fleetVehiclesTable');
  if (!tbody) return;

  const canEdit = hasPermission('fleet_edit');
  
  tbody.innerHTML = state.fleetVehicles.map((v, idx) => {
    const fuelNorm = Number(v.fuelNorm) || 0;
    const statusClass = v.status === 'Bảo dưỡng' ? 'badge-unpaid' : 'badge-settled';
    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong style="font-family:monospace;background:rgba(255,255,255,0.05);padding:4px 8px;border-radius:6px">${v.plate}</strong></td>
        <td>${v.model || 'Chưa rõ'}</td>
        <td>${fuelNorm} L/100km</td>
        <td><span class="badge ${statusClass}">${v.status || 'Hoạt động'}</span></td>
        <td><span style="font-size:0.85rem;color:var(--text2)">${v.notes || '-'}</span></td>
        <td>
          ${canEdit ? `
            <button class="btn btn-primary btn-sm" onclick="showEditVehicleForm('${v.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="deleteFleetVehicle('${v.id}')"><i class="fas fa-trash"></i></button>
          ` : '-'}
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:30px">Chưa có xe nào được thiết lập</td></tr>`;
}

// 3. TAB QUẢN LÝ LÁI XE
function renderFleetDrivers() {
  const tbody = $('fleetDriversTable');
  if (!tbody) return;

  const canEdit = hasPermission('fleet_edit');
  
  tbody.innerHTML = state.fleetDrivers.map((d, idx) => {
    const baseSalary = Number(d.baseSalary) || 0;
    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${d.name}</strong></td>
        <td>${d.phone || '-'}</td>
        <td style="color:var(--blue);font-weight:600">${fmtThousands(baseSalary)} ₫</td>
        <td><span style="font-size:0.85rem;color:var(--text2)">${d.notes || '-'}</span></td>
        <td>
          ${canEdit ? `
            <button class="btn btn-primary btn-sm" onclick="showEditDriverForm('${d.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="deleteFleetDriver('${d.id}')"><i class="fas fa-trash"></i></button>
          ` : '-'}
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:30px">Chưa có tài xế nào được thiết lập</td></tr>`;
}

// 4. TAB TUYẾN ĐƯỜNG
function renderFleetRoutes() {
  const tbody = $('fleetRoutesTable');
  if (!tbody) return;

  const canEdit = hasPermission('fleet_edit');
  
  tbody.innerHTML = state.fleetRoutes.map((r, idx) => {
    const dist = Number(r.distance) || 0;
    const fuel = Number(r.fuelNorm) || 0;
    const fuelText = fuel > 0 ? `${fuel} L` : 'Tính theo định mức xe';
    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${r.name}</strong></td>
        <td>${r.startPoint}</td>
        <td>${r.endPoint}</td>
        <td>${dist} km</td>
        <td><span class="badge badge-paid">${fuelText}</span></td>
        <td>
          ${canEdit ? `
            <button class="btn btn-primary btn-sm" onclick="showEditRouteForm('${r.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="deleteFleetRoute('${r.id}')"><i class="fas fa-trash"></i></button>
          ` : '-'}
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:30px">Chưa có tuyến đường nào được thiết lập</td></tr>`;
}

// Hỗ trợ vẽ select dropdown
function getVehicleOptionsHtml(selectedId) {
  return state.fleetVehicles.map(v => `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${v.plate} - ${v.model} (${v.fuelNorm}L/100km)</option>`).join('');
}

function getDriverOptionsHtml(selectedId) {
  return state.fleetDrivers.map(d => `<option value="${d.id}" ${d.id === selectedId ? 'selected' : ''}>${d.name} (${d.phone})</option>`).join('');
}

function getRouteOptionsHtml(selectedId) {
  return '<option value="">-- Chọn tuyến mẫu (hoặc điền tự do bên dưới) --</option>' + 
    state.fleetRoutes.map(r => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${r.name} (${r.distance}km - ${r.fuelNorm > 0 ? r.fuelNorm + 'L' : 'Dầu xe'})</option>`).join('');
}

// -------------------------------------------------------------
// CRUD THỦ TỤC & PHƯƠNG THỨC LƯU
// -------------------------------------------------------------

// QUẢN LÝ XE (VEHICLES)
function showAddVehicleForm() {
  openModal('Thêm xe mới', `
    <div class="form-group">
      <label>Biển số xe *</label>
      <input type="text" id="fVehPlate" placeholder="Ví dụ: 29C-123.45">
    </div>
    <div class="form-group">
      <label>Loại xe / Tải trọng</label>
      <input type="text" id="fVehModel" placeholder="Ví dụ: Xe tải 5 tấn, 3 chân...">
    </div>
    <div class="form-group">
      <label>Định mức dầu tiêu chuẩn (Lít/100km) *</label>
      <input type="number" id="fVehFuel" step="0.1" value="15">
    </div>
    <div class="form-group">
      <label>Trạng thái vận hành</label>
      <select id="fVehStatus">
        <option value="Hoạt động">Hoạt động</option>
        <option value="Bảo dưỡng">Bảo dưỡng</option>
      </select>
    </div>
    <div class="form-group">
      <label>Ghi chú</label>
      <input type="text" id="fVehNotes" placeholder="Ghi chú về kiểm định, bảo hiểm...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveFleetVehicle()"><i class="fas fa-save"></i> Thêm xe</button>
    </div>
  `);
}

function showEditVehicleForm(id) {
  const v = state.fleetVehicles.find(x => x.id === id);
  if (!v) return;

  openModal('Sửa thông tin xe', `
    <div class="form-group">
      <label>Biển số xe *</label>
      <input type="text" id="fVehPlate" value="${v.plate}">
    </div>
    <div class="form-group">
      <label>Loại xe / Tải trọng</label>
      <input type="text" id="fVehModel" value="${v.model || ''}">
    </div>
    <div class="form-group">
      <label>Định mức dầu tiêu chuẩn (Lít/100km) *</label>
      <input type="number" id="fVehFuel" step="0.1" value="${v.fuelNorm}">
    </div>
    <div class="form-group">
      <label>Trạng thái vận hành</label>
      <select id="fVehStatus">
        <option value="Hoạt động" ${v.status === 'Hoạt động' ? 'selected' : ''}>Hoạt động</option>
        <option value="Bảo dưỡng" ${v.status === 'Bảo dưỡng' ? 'selected' : ''}>Bảo dưỡng</option>
      </select>
    </div>
    <div class="form-group">
      <label>Ghi chú</label>
      <input type="text" id="fVehNotes" value="${v.notes || ''}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveFleetVehicle('${v.id}')"><i class="fas fa-save"></i> Cập nhật</button>
    </div>
  `);
}

function saveFleetVehicle(editingId = null) {
  const plate = $('fVehPlate').value.trim();
  const model = $('fVehModel').value.trim();
  const fuelNorm = parseFloat($('fVehFuel').value) || 0;
  const status = $('fVehStatus').value;
  const notes = $('fVehNotes').value.trim();

  if (!plate || fuelNorm <= 0) {
    toast('Vui lòng nhập biển số xe và định mức nhiên liệu hợp lệ!', 'error');
    return;
  }

  const id = editingId || 'v_' + Date.now();
  const vehicle = { id, plate, model, fuelNorm, status, notes };

  if (editingId) {
    const idx = state.fleetVehicles.findIndex(x => x.id === editingId);
    if (idx !== -1) {
      state.fleetVehicles[idx] = { ...vehicle, _unsynced: true };
    }
  } else {
    vehicle._unsynced = true;
    state.fleetVehicles.push(vehicle);
  }

  saveData();
  window.sendToCloud({ action: 'saveFleetVehicle', vehicle });
  closeModal();
  renderFleetVehicles();
  toast('Đã lưu thông tin xe!');
}

function deleteFleetVehicle(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa xe này?')) return;
  state.fleetVehicles = state.fleetVehicles.filter(x => x.id !== id);
  saveData();
  window.sendToCloud({ action: 'deleteFleetVehicle', id });
  renderFleetVehicles();
  toast('Đã xóa xe!');
}

// QUẢN LÝ LÁI XE (DRIVERS)
function showAddDriverForm() {
  openModal('Thêm tài xế mới', `
    <div class="form-group">
      <label>Họ và tên lái xe *</label>
      <input type="text" id="fDrvName" placeholder="Ví dụ: Nguyễn Văn A">
    </div>
    <div class="form-group">
      <label>Số điện thoại liên hệ</label>
      <input type="text" id="fDrvPhone" placeholder="Ví dụ: 0912345678">
    </div>
    <div class="form-group">
      <label>Lương cơ bản hàng tháng *</label>
      <input type="number" id="fDrvSalary" value="8000000" step="100000">
    </div>
    <div class="form-group">
      <label>Chi phí hỗ trợ riêng (Nước, điện thoại...) *</label>
      <input type="number" id="fDrvAllowance" value="500000" step="50000">
    </div>
    <div class="form-group">
      <label>Ghi chú thêm</label>
      <input type="text" id="fDrvNotes" placeholder="Nhập bằng lái, hạn khám sức khỏe...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveFleetDriver()"><i class="fas fa-save"></i> Lưu tài xế</button>
    </div>
  `);
}

function showEditDriverForm(id) {
  const d = state.fleetDrivers.find(x => x.id === id);
  if (!d) return;

  openModal('Sửa thông tin lái xe', `
    <div class="form-group">
      <label>Họ và tên lái xe *</label>
      <input type="text" id="fDrvName" value="${d.name}">
    </div>
    <div class="form-group">
      <label>Số điện thoại liên hệ</label>
      <input type="text" id="fDrvPhone" value="${d.phone || ''}">
    </div>
    <div class="form-group">
      <label>Lương cơ bản hàng tháng *</label>
      <input type="number" id="fDrvSalary" value="${d.baseSalary}" step="100000">
    </div>
    <div class="form-group">
      <label>Chi phí hỗ trợ riêng (Nước, điện thoại...) *</label>
      <input type="number" id="fDrvAllowance" value="${d.allowance || 0}" step="50000">
    </div>
    <div class="form-group">
      <label>Ghi chú thêm</label>
      <input type="text" id="fDrvNotes" value="${d.notes || ''}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveFleetDriver('${d.id}')"><i class="fas fa-save"></i> Cập nhật</button>
    </div>
  `);
}

function saveFleetDriver(editingId = null) {
  const name = $('fDrvName').value.trim();
  const phone = $('fDrvPhone').value.trim();
  const baseSalary = parseFloat($('fDrvSalary').value) || 0;
  const allowance = parseFloat($('fDrvAllowance').value) || 0;
  const notes = $('fDrvNotes').value.trim();

  if (!name || baseSalary < 0 || allowance < 0) {
    toast('Vui lòng điền họ tên lái xe, lương cơ bản và hỗ trợ riêng hợp lệ!', 'error');
    return;
  }

  const id = editingId || 'd_' + Date.now();
  const driver = { id, name, phone, baseSalary, notes, allowance };

  if (editingId) {
    const idx = state.fleetDrivers.findIndex(x => x.id === editingId);
    if (idx !== -1) {
      state.fleetDrivers[idx] = { ...driver, _unsynced: true };
    }
  } else {
    driver._unsynced = true;
    state.fleetDrivers.push(driver);
  }

  saveData();
  window.sendToCloud({ action: 'saveFleetDriver', driver });
  closeModal();
  renderFleetDrivers();
  toast('Đã lưu thông tin tài xế!');
}

function deleteFleetDriver(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa lái xe này?')) return;
  state.fleetDrivers = state.fleetDrivers.filter(x => x.id !== id);
  saveData();
  window.sendToCloud({ action: 'deleteFleetDriver', id });
  renderFleetDrivers();
  toast('Đã xóa lái xe!');
}

// TUYẾN ĐƯỜNG (ROUTES)
function showAddRouteForm() {
  openModal('Thêm tuyến đường mới', `
    <div class="form-group">
      <label>Tên tuyến đường vận chuyển *</label>
      <input type="text" id="fRotName" placeholder="Ví dụ: Kho A - Nhà máy B">
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Điểm đi *</label>
        <input type="text" id="fRotStart" placeholder="Nhập điểm đi">
      </div>
      <div>
        <label>Điểm đến *</label>
        <input type="text" id="fRotEnd" placeholder="Nhập điểm đến">
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Khoảng cách tiêu chuẩn (Km) *</label>
        <input type="number" id="fRotDist" value="100" min="1">
      </div>
      <div>
        <label>Định mức dầu tuyến cố định (Lít)</label>
        <input type="number" id="fRotFuel" value="0" placeholder="Nhập dầu định mức (nếu có)">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveFleetRoute()"><i class="fas fa-save"></i> Lưu tuyến đường</button>
    </div>
  `);
}

function showEditRouteForm(id) {
  const r = state.fleetRoutes.find(x => x.id === id);
  if (!r) return;

  openModal('Sửa tuyến đường', `
    <div class="form-group">
      <label>Tên tuyến đường vận chuyển *</label>
      <input type="text" id="fRotName" value="${r.name}">
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Điểm đi *</label>
        <input type="text" id="fRotStart" value="${r.startPoint}">
      </div>
      <div>
        <label>Điểm đến *</label>
        <input type="text" id="fRotEnd" value="${r.endPoint}">
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Khoảng cách tiêu chuẩn (Km) *</label>
        <input type="number" id="fRotDist" value="${r.distance}" min="1">
      </div>
      <div>
        <label>Định mức dầu tuyến cố định (Lít)</label>
        <input type="number" id="fRotFuel" value="${r.fuelNorm || 0}">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveFleetRoute('${r.id}')"><i class="fas fa-save"></i> Cập nhật</button>
    </div>
  `);
}

function saveFleetRoute(editingId = null) {
  const name = $('fRotName').value.trim();
  const startPoint = $('fRotStart').value.trim();
  const endPoint = $('fRotEnd').value.trim();
  const distance = parseFloat($('fRotDist').value) || 0;
  const fuelNorm = parseFloat($('fRotFuel').value) || 0;

  if (!name || !startPoint || !endPoint || distance <= 0) {
    toast('Vui lòng nhập đầy đủ thông tin bắt buộc!', 'error');
    return;
  }

  const id = editingId || 'r_' + Date.now();
  const route = { id, name, startPoint, endPoint, distance, fuelNorm };

  if (editingId) {
    const idx = state.fleetRoutes.findIndex(x => x.id === editingId);
    if (idx !== -1) {
      state.fleetRoutes[idx] = { ...route, _unsynced: true };
    }
  } else {
    route._unsynced = true;
    state.fleetRoutes.push(route);
  }

  saveData();
  window.sendToCloud({ action: 'saveFleetRoute', route });
  closeModal();
  renderFleetRoutes();
  toast('Đã lưu thông tin cung đường!');
}

function deleteFleetRoute(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa tuyến đường này?')) return;
  state.fleetRoutes = state.fleetRoutes.filter(x => x.id !== id);
  saveData();
  window.sendToCloud({ action: 'deleteFleetRoute', id });
  renderFleetRoutes();
  toast('Đã xóa tuyến đường!');
}

// PHÂN CÔNG CHUYẾN ĐI & KÊ KHAI (TRIPS)
function showAddTripForm() {
  if (state.fleetVehicles.length === 0 || state.fleetDrivers.length === 0) {
    toast('Vui lòng tạo danh sách Xe và Lái xe trước!', 'error');
    return;
  }

  fleetTripInvoiceFile = null;

  openModal('Ghi nhận Chuyến đi mới', `
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div>
        <label>Ngày vận hành *</label>
        <input type="date" id="fTripDate" value="${today()}">
      </div>
      <div>
        <label>Xe chỉ định *</label>
        <select id="fTripVehicleId">
          ${getVehicleOptionsHtml('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;margin-top:20px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;margin-bottom:0">
          <input type="checkbox" id="fTripIsVip" style="width:18px;height:18px;cursor:pointer">
          <strong>Chuyến VIP</strong>
        </label>
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Lái xe phân công *</label>
        <select id="fTripDriverId">
          ${getDriverOptionsHtml('')}
        </select>
      </div>
      <div>
        <label>Chọn cung đường mẫu</label>
        <select id="fTripRouteId" onchange="onTripRouteTemplateChange()">
          ${getRouteOptionsHtml('')}
        </select>
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Điểm đi thực tế *</label>
        <input type="text" id="fTripStart" placeholder="Kho khởi hành">
      </div>
      <div>
        <label>Điểm đến thực tế *</label>
        <input type="text" id="fTripEnd" placeholder="Nơi trả hàng">
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Số km thực tế đã đi *</label>
        <input type="number" id="fTripKm" value="100" min="1">
      </div>
      <div>
        <label>Số dầu thực tế đã đổ (Lít) *</label>
        <input type="number" id="fTripFuelActual" step="0.1" value="15" min="0">
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Phụ cấp chuyến (xin ứng/thanh toán) *</label>
        <input type="number" id="fTripAllowance" value="100000" min="0" step="10000">
      </div>
      <div>
        <label>Chi phí chuyến đi phát sinh (Cầu đường...)</label>
        <input type="number" id="fTripExpense" value="0" min="0" step="10000">
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Khoản cộng lương khác (+)</label>
        <input type="number" id="fTripSalaryAdd" value="0" min="0" step="10000" placeholder="Thưởng chuyến, OT...">
      </div>
      <div>
        <label>Khoản trừ lương khác (-)</label>
        <input type="number" id="fTripSalarySub" value="0" min="0" step="10000" placeholder="Phạt dầu vượt định mức...">
      </div>
    </div>
    <div class="form-group">
      <label>Ảnh hóa đơn / Chứng từ chi phí</label>
      <input type="file" id="fTripInvoice" accept="image/*" onchange="onTripInvoiceSelected(event)" style="border:none;padding:5px 0">
      <div id="fTripInvoicePreview" style="margin-top:8px"></div>
    </div>
    <div class="form-group">
      <label>Ghi chú chi tiết chuyến đi</label>
      <input type="text" id="fTripNotes" placeholder="Nhập ghi chú thêm...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveFleetTrip()"><i class="fas fa-save"></i> Ghi nhận chuyến</button>
    </div>
  `);

  window.onTripRouteTemplateChange = function() {
    const routeId = $('fTripRouteId').value;
    if (!routeId) return;
    const r = state.fleetRoutes.find(x => x.id === routeId);
    if (r) {
      $('fTripStart').value = r.startPoint;
      $('fTripEnd').value = r.endPoint;
      $('fTripKm').value = r.distance;
    }
  };

  window.onTripInvoiceSelected = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
      fleetTripInvoiceFile = {
        base64: event.target.result.split(',')[1],
        mimeType: file.type,
        name: file.name
      };
      $('fTripInvoicePreview').innerHTML = `<img src="${event.target.result}" style="max-height:100px;border-radius:8px;box-shadow:var(--shadow)">`;
    };
    reader.readAsDataURL(file);
  };
}

function showEditTripForm(id) {
  const t = state.fleetTrips.find(x => x.id === id);
  if (!t) return;

  fleetTripInvoiceFile = null;

  openModal('Sửa thông tin chuyến đi', `
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div>
        <label>Ngày vận hành *</label>
        <input type="date" id="fTripDate" value="${t.date}">
      </div>
      <div>
        <label>Xe chỉ định *</label>
        <select id="fTripVehicleId">
          ${getVehicleOptionsHtml(t.vehicleId)}
        </select>
      </div>
      <div style="display:flex;align-items:center;margin-top:20px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;margin-bottom:0">
          <input type="checkbox" id="fTripIsVip" style="width:18px;height:18px;cursor:pointer" ${t.isVip ? 'checked' : ''}>
          <strong>Chuyến VIP</strong>
        </label>
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Lái xe phân công *</label>
        <select id="fTripDriverId">
          ${getDriverOptionsHtml(t.driverId)}
        </select>
      </div>
      <div>
        <label>Chọn cung đường mẫu</label>
        <select id="fTripRouteId" onchange="onTripRouteTemplateChange()">
          ${getRouteOptionsHtml(t.routeId)}
        </select>
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Điểm đi thực tế *</label>
        <input type="text" id="fTripStart" value="${t.startPoint}">
      </div>
      <div>
        <label>Điểm đến thực tế *</label>
        <input type="text" id="fTripEnd" value="${t.endPoint}">
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Số km thực tế đã đi *</label>
        <input type="number" id="fTripKm" value="${t.kmActual}" min="1">
      </div>
      <div>
        <label>Số dầu thực tế đã đổ (Lít) *</label>
        <input type="number" id="fTripFuelActual" step="0.1" value="${t.fuelActual}">
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Phụ cấp chuyến (₫) *</label>
        <input type="number" id="fTripAllowance" value="${t.allowance || 0}">
      </div>
      <div>
        <label>Chi phí chuyến đi phát sinh (₫)</label>
        <input type="number" id="fTripExpense" value="${t.expense || 0}">
      </div>
    </div>
    <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Các khoản cộng khác (+) (₫)</label>
        <input type="number" id="fTripSalaryAdd" value="${t.salaryAdd || 0}">
      </div>
      <div>
        <label>Các khoản trừ khác (-) (₫)</label>
        <input type="number" id="fTripSalarySub" value="${t.salarySub || 0}">
      </div>
    </div>
    <div class="form-group">
      <label>Ảnh hóa đơn / Chứng từ chi phí</label>
      <input type="file" id="fTripInvoice" accept="image/*" onchange="onTripInvoiceSelected(event)" style="border:none;padding:5px 0">
      <div id="fTripInvoicePreview" style="margin-top:8px">
        ${t.invoice ? `<img src="${t.invoice}" style="max-height:100px;border-radius:8px;box-shadow:var(--shadow)">` : ''}
      </div>
    </div>
    <div class="form-group">
      <label>Ghi chú chi tiết chuyến đi</label>
      <input type="text" id="fTripNotes" value="${t.notes || ''}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="saveFleetTrip('${t.id}')"><i class="fas fa-save"></i> Cập nhật</button>
    </div>
  `);

  window.onTripRouteTemplateChange = function() {
    const routeId = $('fTripRouteId').value;
    if (!routeId) return;
    const r = state.fleetRoutes.find(x => x.id === routeId);
    if (r) {
      $('fTripStart').value = r.startPoint;
      $('fTripEnd').value = r.endPoint;
      $('fTripKm').value = r.distance;
    }
  };

  window.onTripInvoiceSelected = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
      fleetTripInvoiceFile = {
        base64: event.target.result.split(',')[1],
        mimeType: file.type,
        name: file.name
      };
      $('fTripInvoicePreview').innerHTML = `<img src="${event.target.result}" style="max-height:100px;border-radius:8px;box-shadow:var(--shadow)">`;
    };
    reader.readAsDataURL(file);
  };
}

function saveFleetTrip(editingId = null) {
  const date = normalizeDate($('fTripDate').value);
  const vehicleId = $('fTripVehicleId').value;
  const driverId = $('fTripDriverId').value;
  const routeId = $('fTripRouteId').value;
  const startPoint = $('fTripStart').value.trim();
  const endPoint = $('fTripEnd').value.trim();
  const kmActual = parseFloat($('fTripKm').value) || 0;
  const fuelActual = parseFloat($('fTripFuelActual').value) || 0;
  const allowance = parseFloat($('fTripAllowance').value) || 0;
  const expense = parseFloat($('fTripExpense').value) || 0;
  const salaryAdd = parseFloat($('fTripSalaryAdd').value) || 0;
  const salarySub = parseFloat($('fTripSalarySub').value) || 0;
  const notes = $('fTripNotes').value.trim();
  const isVip = $('fTripIsVip') ? $('fTripIsVip').checked : false;

  if (!vehicleId || !driverId || !startPoint || !endPoint || kmActual <= 0 || fuelActual < 0) {
    toast('Vui lòng nhập đầy đủ các trường thông tin bắt buộc!', 'error');
    return;
  }

  const id = editingId || 't_' + Date.now();
  const oldTrip = editingId ? state.fleetTrips.find(x => x.id === editingId) : null;
  const invoice = oldTrip ? oldTrip.invoice : '';

  const trip = {
    id, date, driverId, vehicleId, routeId, startPoint, endPoint,
    kmActual, fuelActual, fuelNorm: 0, allowance, expense,
    salaryAdd, salarySub, notes, invoice, isVip
  };

  // Tính ngay dầu định mức tại client để cập nhật giao diện lập tức
  trip.fuelNorm = getTripFuelNorm(trip);

  if (fleetTripInvoiceFile) {
    trip.invoice = 'data:' + fleetTripInvoiceFile.mimeType + ';base64,' + fleetTripInvoiceFile.base64;
  }

  if (editingId) {
    const idx = state.fleetTrips.findIndex(x => x.id === editingId);
    if (idx !== -1) {
      state.fleetTrips[idx] = { ...trip, _unsynced: true };
    }
  } else {
    trip._unsynced = true;
    state.fleetTrips.push(trip);
  }

  saveData();
  
  const payload = { action: 'saveFleetTrip', trip };
  if (fleetTripInvoiceFile) {
    payload.fileData = {
      base64: fleetTripInvoiceFile.base64,
      mimeType: fleetTripInvoiceFile.mimeType,
      name: fleetTripInvoiceFile.name
    };
  }

  window.sendToCloud(payload);
  closeModal();
  renderFleetTrips();
  toast('Đã lưu thông tin chuyến đi!');
}

function deleteFleetTrip(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa chuyến đi này?')) return;
  state.fleetTrips = state.fleetTrips.filter(x => x.id !== id);
  saveData();
  window.sendToCloud({ action: 'deleteFleetTrip', id });
  renderFleetTrips();
  toast('Đã xóa chuyến đi khỏi hệ thống!');
}

function showTripInvoiceZoom(id) {
  const t = state.fleetTrips.find(x => x.id === id);
  if (!t || !t.invoice) return;
  
  openModal('Hóa đơn chứng từ chi tiết', `
    <div style="text-align:center;padding:10px">
      <img src="${t.invoice}" style="max-width:100%;max-height:70vh;border-radius:12px;box-shadow:var(--shadow)">
    </div>
  `);
}

// -------------------------------------------------------------
// TAB 5: BÁO CÁO & TÍNH LƯƠNG
// -------------------------------------------------------------
function toggleFleetReportView() {
  const type = $('fltReportType').value;
  document.querySelectorAll('.fleet-report-view').forEach(v => v.classList.remove('active'));
  
  if (type === 'salary') $('fleetReportSalaryView').classList.add('active');
  if (type === 'fuel_summary') $('fleetReportFuelView').classList.add('active');
  if (type === 'operational_summary') $('fleetReportOperationalView').classList.add('active');
  
  generateFleetReport();
}

function generateFleetReport() {
  const type = $('fltReportType').value;
  const start = $('fltReportStart').value;
  const end = $('fltReportEnd').value;

  if (!start || !end) {
    toast('Vui lòng chọn phạm vi ngày để xuất báo cáo!', 'error');
    return;
  }

  // Lọc danh sách chuyến đi theo kỳ chọn
  const rangeTrips = state.fleetTrips.filter(t => t.date >= start && t.date <= end);

  if (type === 'salary') {
    renderFleetSalaryReport(rangeTrips);
  } else if (type === 'fuel_summary') {
    renderFleetFuelReport(rangeTrips);
  } else if (type === 'operational_summary') {
    renderFleetOperationalReport(rangeTrips);
  }
}

// 1. VẼ BÁO CÁO LƯƠNG
function renderFleetSalaryReport(trips) {
  const tbody = $('fleetSalaryReportTable');
  if (!tbody) return;

  if (state.fleetDrivers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:20px">Không có dữ liệu lái xe nào được thiết lập</td></tr>`;
    return;
  }

  // Lấy các mức cấu hình thưởng VIP
  const bonus2 = getSettingNumber('vip_bonus_2', 100000);
  const bonus3 = getSettingNumber('vip_bonus_3', 300000);
  const bonus4 = getSettingNumber('vip_bonus_4', 300000);

  tbody.innerHTML = state.fleetDrivers.map((driver, idx) => {
    // Chuyến của lái xe trong khoảng thời gian đang lọc
    const drvTrips = trips.filter(t => t.driverId === driver.id);
    
    // Nhóm các chuyến đi theo ngày để tính thưởng chuyến VIP hằng ngày
    const tripsByDate = {};
    drvTrips.forEach(t => {
      if (!tripsByDate[t.date]) {
        tripsByDate[t.date] = [];
      }
      tripsByDate[t.date].push(t);
    });

    let vipBonusTotal = 0;
    for (const date in tripsByDate) {
      // Đếm số chuyến VIP trong ngày này
      const vipTripsInDay = tripsByDate[date].filter(t => t.isVip || t.isVip === 'true');
      const vipCount = vipTripsInDay.length;
      
      if (vipCount >= 2) vipBonusTotal += bonus2; // chuyến thứ hai
      if (vipCount >= 3) vipBonusTotal += bonus3; // chuyến thứ ba
      if (vipCount >= 4) vipBonusTotal += (vipCount - 3) * bonus4; // chuyến thứ tư trở đi
    }

    const baseSalary = Number(driver.baseSalary) || 0;
    const allowanceVal = Number(driver.allowance) || 0; // Hỗ trợ riêng nước, điện thoại từ cấu hình lái xe

    // Chi phí sửa chữa lái xe đã chi (Mục 4) lấy từ Nhật ký chung hạng mục chi có liên kết lái xe này
    const repairCostSum = state.entries
      .filter(e => e.type === 'chi' && e.driverId === driver.id)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    // Tính lương lái xe A = 1 + 2 + 3 (Cơ bản + Thưởng chuyến + Hỗ trợ riêng)
    const netSalaryA = baseSalary + vipBonusTotal + allowanceVal;

    // Tổng quyết toán cuối tháng B = A + 4 (Lương lái xe + Chi phí sửa chữa)
    const totalSettlementB = netSalaryA + repairCostSum;

    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${driver.name}</strong></td>
        <td>${fmtThousands(baseSalary)} ₫</td>
        <td>
          <div style="font-weight:600;color:var(--green)">${fmtThousands(vipBonusTotal)} ₫</div>
          <div style="font-size:0.75rem;color:var(--text2)">(${drvTrips.filter(t => t.isVip || t.isVip === 'true').length} chuyến VIP)</div>
        </td>
        <td>${fmtThousands(allowanceVal)} ₫</td>
        <td style="color:var(--blue);font-weight:700">${fmtThousands(netSalaryA)} ₫</td>
        <td style="color:var(--orange);font-weight:600">${fmtThousands(repairCostSum)} ₫</td>
        <td style="color:var(--green);font-weight:800;font-size:1.02rem">${fmtThousands(totalSettlementB)} ₫</td>
      </tr>
    `;
  }).join('');
}

// 2. VẼ BÁO CÁO TIÊU HAO NHIÊN LIỆU
function renderFleetFuelReport(trips) {
  const tbody = $('fleetFuelReportTable');
  if (!tbody) return;

  const groupBy = $('fltReportGroupBy').value;

  // Gom nhóm dữ liệu
  const groups = {};
  trips.forEach(t => {
    let key = '';
    let name = '';
    if (groupBy === 'date') {
      key = t.date;
      name = t.date;
    } else if (groupBy === 'driver') {
      key = t.driverId;
      const drv = state.fleetDrivers.find(d => d.id === t.driverId);
      name = drv ? drv.name : 'Chưa rõ';
    } else if (groupBy === 'vehicle') {
      key = t.vehicleId;
      const veh = state.fleetVehicles.find(v => v.id === t.vehicleId);
      name = veh ? veh.plate : 'Chưa rõ';
    } else if (groupBy === 'route') {
      key = t.routeId || (t.startPoint + ' ➔ ' + t.endPoint);
      const rot = state.fleetRoutes.find(r => r.id === t.routeId);
      name = rot ? rot.name : (t.startPoint + ' ➔ ' + t.endPoint);
    }

    if (!groups[key]) {
      groups[key] = { name, tripsCount: 0, km: 0, fuelActual: 0, fuelNorm: 0 };
    }
    groups[key].tripsCount++;
    groups[key].km += Number(t.kmActual) || 0;
    groups[key].fuelActual += Number(t.fuelActual) || 0;
    groups[key].fuelNorm += Number(t.fuelNorm) || getTripFuelNorm(t);
  });

  const list = Object.values(groups);
  
  tbody.innerHTML = `
    <thead>
      <tr>
        <th>STT</th>
        <th>${groupBy === 'date' ? 'Ngày vận hành' : groupBy === 'driver' ? 'Họ tên Lái xe' : groupBy === 'vehicle' ? 'Biển số xe' : 'Tuyến vận chuyển'}</th>
        <th>Tổng số chuyến</th>
        <th>Tổng Km thực tế</th>
        <th>Nhiên liệu thực tế đổ</th>
        <th>Nhiên liệu định mức</th>
        <th>Hao hụt chênh lệch</th>
        <th>Đánh giá kiểm soát</th>
      </tr>
    </thead>
    <tbody>
      ${list.map((g, idx) => {
        const diff = g.fuelActual - g.fuelNorm;
        let warningHtml = '';
        if (diff > 0) {
          warningHtml = `<span class="badge-fuel-warning" style="font-size:0.8rem;padding:3px 6px"><i class="fas fa-exclamation-triangle"></i> Hao hụt +${diff.toFixed(1)}L</span>`;
        } else {
          warningHtml = `<span class="badge-fuel-safe" style="font-size:0.8rem;padding:3px 6px"><i class="fas fa-check"></i> Tiết kiệm -${Math.abs(diff).toFixed(1)}L</span>`;
        }
        return `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${g.name}</strong></td>
            <td><span class="badge badge-paid">${g.tripsCount} chuyến</span></td>
            <td>${fmtThousands(g.km)} km</td>
            <td>${g.fuelActual.toFixed(1)} L</td>
            <td>${g.fuelNorm.toFixed(1)} L</td>
            <td style="color:${diff > 0 ? 'var(--red)' : 'var(--green)'};font-weight:600">${diff > 0 ? '+' : ''}${diff.toFixed(1)} L</td>
            <td>${warningHtml}</td>
          </tr>
        `;
      }).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:20px">Không có dữ liệu phù hợp trong kỳ</td></tr>`}
    </tbody>
  `;
}

// 3. VẼ BÁO CÁO VẬN HÀNH TỔNG HỢP
function renderFleetOperationalReport(trips) {
  const tbody = $('fleetOperationalReportTable');
  if (!tbody) return;

  const totalTrips = trips.length;
  const totalKm = trips.reduce((sum, t) => sum + (Number(t.kmActual) || 0), 0);
  const totalFuel = trips.reduce((sum, t) => sum + (Number(t.fuelActual) || 0), 0);
  const totalFuelNorm = trips.reduce((sum, t) => sum + (Number(t.fuelNorm) || getTripFuelNorm(t)), 0);
  const fuelDiff = totalFuel - totalFuelNorm;
  
  const totalAllowance = trips.reduce((sum, t) => sum + (Number(t.allowance) || 0), 0);
  const totalExpense = trips.reduce((sum, t) => sum + (Number(t.expense) || 0), 0);
  const totalAdd = trips.reduce((sum, t) => sum + (Number(t.salaryAdd) || 0), 0);
  const totalSub = trips.reduce((sum, t) => sum + (Number(t.salarySub) || 0), 0);

  const dataRows = [
    { name: 'Tổng số chuyến đi đã phân công', value: `${totalTrips} chuyến`, desc: 'Tổng số lượt xe xuất kho chỉ định.' },
    { name: 'Tổng quãng đường vận chuyển tích lũy', value: `${fmtThousands(totalKm)} km`, desc: 'Tổng số km thực tế đi.' },
    { name: 'Tổng dầu thực tế đã cấp', value: `${totalFuel.toFixed(1)} L`, desc: 'Tổng số lít dầu thực tế đổ trong kỳ.' },
    { name: 'Tổng dầu định mức cho phép tiêu hao', value: `${totalFuelNorm.toFixed(1)} L`, desc: 'Hạn mức dầu tiêu hao tiêu chuẩn.' },
    { 
      name: 'Chênh lệch dầu kiểm soát', 
      value: `<span style="color:${fuelDiff > 0 ? 'var(--red)' : 'var(--green)'};font-weight:700">${fuelDiff > 0 ? 'Vượt định mức +' : 'Tiết kiệm dầu -'}${Math.abs(fuelDiff).toFixed(1)} L</span>`, 
      desc: fuelDiff > 0 ? '⚠️ Cần kiểm tra thiết bị hao hụt hoặc lái xe.' : '✔️ Lái xe tiết kiệm dầu đạt chỉ tiêu.' 
    },
    { name: 'Tổng phụ cấp chuyến tính lương', value: `${fmtThousands(totalAllowance)} ₫`, desc: 'Tổng chi phí hỗ trợ chuyến.' },
    { name: 'Tổng chi phí dọc đường phát sinh', value: `${fmtThousands(totalExpense)} ₫`, desc: 'Tổng tiền vé cầu đường, sửa chữa phát sinh.' },
    { name: 'Tổng các khoản cộng thưởng lương', value: `${fmtThousands(totalAdd)} ₫`, desc: 'Cộng lương thưởng, làm thêm giờ.' },
    { name: 'Tổng các khoản trừ phạt lương', value: `${fmtThousands(totalSub)} ₫`, desc: 'Khấu trừ phạt dầu hoặc sự vụ phát sinh.' }
  ];

  tbody.innerHTML = dataRows.map((r, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${r.name}</strong></td>
      <td style="font-size:1.05rem;font-weight:600">${r.value}</td>
      <td style="color:var(--text2);font-size:0.85rem">${r.desc}</td>
    </tr>
  `).join('');
}

// -------------------------------------------------------------
// XUẤT EXCEL
// -------------------------------------------------------------
function exportFleetReport() {
  const type = $('fltReportType').value;
  const start = $('fltReportStart').value;
  const end = $('fltReportEnd').value;
  
  if (state.fleetTrips.length === 0) {
    toast('Không có dữ liệu trong khoảng thời gian này để xuất!', 'error');
    return;
  }

  const rangeTrips = state.fleetTrips.filter(t => t.date >= start && t.date <= end);
  const wb = XLSX.utils.book_new();

  if (type === 'salary') {
    const bonus2 = getSettingNumber('vip_bonus_2', 100000);
    const bonus3 = getSettingNumber('vip_bonus_3', 300000);
    const bonus4 = getSettingNumber('vip_bonus_4', 300000);

    const salaryData = state.fleetDrivers.map((driver, idx) => {
      const drvTrips = rangeTrips.filter(t => t.driverId === driver.id);
      
      // Tính toán thưởng chuyến VIP lũy tiến
      const tripsByDate = {};
      drvTrips.forEach(t => {
        if (!tripsByDate[t.date]) tripsByDate[t.date] = [];
        tripsByDate[t.date].push(t);
      });

      let vipBonusTotal = 0;
      for (const date in tripsByDate) {
        const vipTripsInDay = tripsByDate[date].filter(t => t.isVip || t.isVip === 'true');
        const vipCount = vipTripsInDay.length;
        if (vipCount >= 2) vipBonusTotal += bonus2;
        if (vipCount >= 3) vipBonusTotal += bonus3;
        if (vipCount >= 4) vipBonusTotal += (vipCount - 3) * bonus4;
      }

      const baseSalary = Number(driver.baseSalary) || 0;
      const allowanceVal = Number(driver.allowance) || 0;
      
      const repairCostSum = state.entries
        .filter(e => e.type === 'chi' && e.driverId === driver.id)
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      const netSalaryA = baseSalary + vipBonusTotal + allowanceVal;
      const totalSettlementB = netSalaryA + repairCostSum;

      return {
        'STT': idx + 1,
        'Họ và tên lái xe': driver.name,
        'Lương cơ bản (1)': baseSalary,
        'Thưởng chuyến VIP (2)': vipBonusTotal,
        'Hỗ trợ riêng (3)': allowanceVal,
        'Lương lái xe (A=1+2+3)': netSalaryA,
        'Sửa chữa đã chi (4)': repairCostSum,
        'Tổng quyết toán (B=A+4)': totalSettlementB
      };
    });

    const ws = XLSX.utils.json_to_sheet(salaryData);
    ws['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 20 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, 'QuyetToanLuong_LaiXe');
    downloadExcel(wb, `QuyetToanLuong_LaiXe_${start}_to_${end}.xlsx`);

  } else if (type === 'fuel_summary') {
    const groupBy = $('fltReportGroupBy').value;
    const groups = {};
    rangeTrips.forEach(t => {
      let key = '';
      let name = '';
      if (groupBy === 'date') { key = t.date; name = t.date; }
      else if (groupBy === 'driver') {
        key = t.driverId;
        const drv = state.fleetDrivers.find(d => d.id === t.driverId);
        name = drv ? drv.name : 'Chưa rõ';
      } else if (groupBy === 'vehicle') {
        key = t.vehicleId;
        const veh = state.fleetVehicles.find(v => v.id === t.vehicleId);
        name = veh ? veh.plate : 'Chưa rõ';
      } else if (groupBy === 'route') {
        key = t.routeId || (t.startPoint + ' ➔ ' + t.endPoint);
        const rot = state.fleetRoutes.find(r => r.id === t.routeId);
        name = rot ? rot.name : (t.startPoint + ' ➔ ' + t.endPoint);
      }

      if (!groups[key]) {
        groups[key] = { name, tripsCount: 0, km: 0, fuelActual: 0, fuelNorm: 0 };
      }
      groups[key].tripsCount++;
      groups[key].km += Number(t.kmActual) || 0;
      groups[key].fuelActual += Number(t.fuelActual) || 0;
      groups[key].fuelNorm += Number(t.fuelNorm) || getTripFuelNorm(t);
    });

    const fuelData = Object.values(groups).map((g, idx) => {
      const diff = g.fuelActual - g.fuelNorm;
      return {
        'STT': idx + 1,
        'Đối tượng nhóm': g.name,
        'Số chuyến': g.tripsCount,
        'Tổng Km thực tế': g.km,
        'Nhiên liệu tiêu thụ (Lít)': g.fuelActual,
        'Nhiên liệu định mức (Lít)': g.fuelNorm,
        'Chênh lệch dầu thực tế (Lít)': diff,
        'Đánh giá kiểm soát': diff > 0 ? '⚠️ Hao hụt' : '✔️ Tiết kiệm dầu'
      };
    });

    const ws = XLSX.utils.json_to_sheet(fuelData);
    ws['!cols'] = [{ wch: 6 }, { wch: 25 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'TieuHao_NhienLieu');
    downloadExcel(wb, `BaoCaoNhienLieu_${start}_to_${end}.xlsx`);

  } else if (type === 'operational_summary') {
    const totalTrips = rangeTrips.length;
    const totalKm = rangeTrips.reduce((sum, t) => sum + (Number(t.kmActual) || 0), 0);
    const totalFuel = rangeTrips.reduce((sum, t) => sum + (Number(t.fuelActual) || 0), 0);
    const totalFuelNorm = rangeTrips.reduce((sum, t) => sum + (Number(t.fuelNorm) || getTripFuelNorm(t)), 0);
    const fuelDiff = totalFuel - totalFuelNorm;
    
    const totalAllowance = rangeTrips.reduce((sum, t) => sum + (Number(t.allowance) || 0), 0);
    const totalExpense = rangeTrips.reduce((sum, t) => sum + (Number(t.expense) || 0), 0);
    const totalAdd = rangeTrips.reduce((sum, t) => sum + (Number(t.salaryAdd) || 0), 0);
    const totalSub = rangeTrips.reduce((sum, t) => sum + (Number(t.salarySub) || 0), 0);

    const opData = [
      { 'STT': 1, 'Chỉ số vận hành': 'Tổng số chuyến đi đã thực hiện', 'Giá trị tổng': totalTrips, 'Ghi chú chi tiết': 'Số lượng chuyến chỉ định' },
      { 'STT': 2, 'Chỉ số vận hành': 'Tổng quãng đường vận hành (km)', 'Giá trị tổng': totalKm, 'Ghi chú chi tiết': 'Số km thực tế tích lũy' },
      { 'STT': 3, 'Chỉ số vận hành': 'Tổng lượng nhiên liệu đã đổ (Lít)', 'Giá trị tổng': totalFuel, 'Ghi chú chi tiết': 'Tổng số dầu thực tế đã cấp' },
      { 'STT': 4, 'Chỉ số vận hành': 'Tổng nhiên liệu định mức cho phép (Lít)', 'Giá trị tổng': totalFuelNorm, 'Ghi chú chi tiết': 'Hạn mức dầu tiêu chuẩn' },
      { 'STT': 5, 'Chỉ số vận hành': 'Chênh lệch hao hụt nhiên liệu (Lít)', 'Giá trị tổng': fuelDiff, 'Ghi chú chi tiết': fuelDiff > 0 ? '⚠️ Hao hụt' : '✔️ Tiết kiệm dầu' },
      { 'STT': 6, 'Chỉ số vận hành': 'Tổng chi phí phụ cấp chuyến đi (đ)', 'Giá trị tổng': totalAllowance, 'Ghi chú chi tiết': 'Phụ cấp chuyến' },
      { 'STT': 7, 'Chỉ số vận hành': 'Tổng chi phí chuyến đi phát sinh (đ)', 'Giá trị tổng': totalExpense, 'Ghi chú chi tiết': 'Chi phí phát sinh dọc đường' },
      { 'STT': 8, 'Chỉ số vận hành': 'Tổng các khoản cộng thưởng lái xe (đ)', 'Giá trị tổng': totalAdd, 'Ghi chú chi tiết': 'Cộng thưởng ngoài giờ' },
      { 'STT': 9, 'Chỉ số vận hành': 'Tổng các khoản trừ phạt lái xe (đ)', 'Giá trị tổng': totalSub, 'Ghi chú chi tiết': 'Trừ phạt dầu vượt định mức hoặc vi phạm' }
    ];

    const ws = XLSX.utils.json_to_sheet(opData);
    ws['!cols'] = [{ wch: 6 }, { wch: 35 }, { wch: 16 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, 'BaoCao_VanHanh');
    downloadExcel(wb, `BaoCaoVanHanh_TongHop_${start}_to_${end}.xlsx`);
  }

  toast('Đã kết xuất báo cáo Excel thành công!');
}

// -------------------------------------------------------------
// PRINT PDF / IN BÁO CÁO
// -------------------------------------------------------------
function printFleetReport() {
  const type = $('fltReportType').value;
  const start = $('fltReportStart').value;
  const end = $('fltReportEnd').value;
  
  if (!start || !end) {
    toast('Vui lòng chọn thời gian báo cáo hợp lệ!', 'error');
    return;
  }

  const rangeTrips = state.fleetTrips.filter(t => t.date >= start && t.date <= end);
  
  let reportTitle = '';
  let tableHeaders = '';
  let tableRows = '';

  if (type === 'salary') {
    const bonus2 = getSettingNumber('vip_bonus_2', 100000);
    const bonus3 = getSettingNumber('vip_bonus_3', 300000);
    const bonus4 = getSettingNumber('vip_bonus_4', 300000);

    reportTitle = 'BÁO CÁO QUYẾT TOÁN LƯƠNG LÁI XE CHI TIẾT';
    tableHeaders = `
      <tr>
        <th>STT</th>
        <th>Họ và tên lái xe</th>
        <th>Lương cơ bản (1)</th>
        <th>Thưởng chuyến VIP (2)</th>
        <th>Hỗ trợ riêng (3)</th>
        <th>Lương lái xe (A=1+2+3)</th>
        <th>Sửa chữa đã chi (4)</th>
        <th>Tổng quyết toán (B=A+4)</th>
      </tr>
    `;
    tableRows = state.fleetDrivers.map((driver, idx) => {
      const drvTrips = rangeTrips.filter(t => t.driverId === driver.id);
      
      // Tính toán thưởng chuyến VIP lũy tiến
      const tripsByDate = {};
      drvTrips.forEach(t => {
        if (!tripsByDate[t.date]) tripsByDate[t.date] = [];
        tripsByDate[t.date].push(t);
      });

      let vipBonusTotal = 0;
      for (const date in tripsByDate) {
        const vipTripsInDay = tripsByDate[date].filter(t => t.isVip || t.isVip === 'true');
        const vipCount = vipTripsInDay.length;
        if (vipCount >= 2) vipBonusTotal += bonus2;
        if (vipCount >= 3) vipBonusTotal += bonus3;
        if (vipCount >= 4) vipBonusTotal += (vipCount - 3) * bonus4;
      }

      const baseSalary = Number(driver.baseSalary) || 0;
      const allowanceVal = Number(driver.allowance) || 0;
      
      const repairCostSum = state.entries
        .filter(e => e.type === 'chi' && e.driverId === driver.id)
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      const netSalaryA = baseSalary + vipBonusTotal + allowanceVal;
      const totalSettlementB = netSalaryA + repairCostSum;

      return `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${driver.name}</strong></td>
          <td>${fmtThousands(baseSalary)} ₫</td>
          <td>${fmtThousands(vipBonusTotal)} ₫ (${drvTrips.filter(t => t.isVip || t.isVip === 'true').length} chuyến VIP)</td>
          <td>${fmtThousands(allowanceVal)} ₫</td>
          <td style="font-weight:bold">${fmtThousands(netSalaryA)} ₫</td>
          <td style="color:var(--orange)">${fmtThousands(repairCostSum)} ₫</td>
          <td style="font-weight:bold;color:var(--green)">${fmtThousands(totalSettlementB)} ₫</td>
        </tr>
      `;
    }).join('');

  } else if (type === 'fuel_summary') {
    const groupBy = $('fltReportGroupBy').value;
    const groupByText = groupBy === 'date' ? 'Ngày vận hành' : groupBy === 'driver' ? 'Họ tên Lái xe' : groupBy === 'vehicle' ? 'Biển số xe' : 'Tuyến vận chuyển';
    
    reportTitle = `BÁO CÁO TIÊU HAO NHIÊN LIỆU (NHÓM THEO: ${groupByText.toUpperCase()})`;
    tableHeaders = `
      <tr>
        <th>STT</th>
        <th>${groupByText}</th>
        <th>Số chuyến đi</th>
        <th>Tổng quãng đường (Km)</th>
        <th>Dầu thực tế tiêu thụ</th>
        <th>Dầu định mức quy định</th>
        <th>Hao hụt chênh lệch (Lít)</th>
        <th>Đánh giá kiểm soát</th>
      </tr>
    `;

    const groups = {};
    rangeTrips.forEach(t => {
      let key = '';
      let name = '';
      if (groupBy === 'date') { key = t.date; name = t.date; }
      else if (groupBy === 'driver') {
        key = t.driverId;
        const drv = state.fleetDrivers.find(d => d.id === t.driverId);
        name = drv ? drv.name : 'Chưa rõ';
      } else if (groupBy === 'vehicle') {
        key = t.vehicleId;
        const veh = state.fleetVehicles.find(v => v.id === t.vehicleId);
        name = veh ? veh.plate : 'Chưa rõ';
      } else if (groupBy === 'route') {
        key = t.routeId || (t.startPoint + ' ➔ ' + t.endPoint);
        const rot = state.fleetRoutes.find(r => r.id === t.routeId);
        name = rot ? rot.name : (t.startPoint + ' ➔ ' + t.endPoint);
      }

      if (!groups[key]) {
        groups[key] = { name, tripsCount: 0, km: 0, fuelActual: 0, fuelNorm: 0 };
      }
      groups[key].tripsCount++;
      groups[key].km += Number(t.kmActual) || 0;
      groups[key].fuelActual += Number(t.fuelActual) || 0;
      groups[key].fuelNorm += Number(t.fuelNorm) || getTripFuelNorm(t);
    });

    tableRows = Object.values(groups).map((g, idx) => {
      const diff = g.fuelActual - g.fuelNorm;
      return `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${g.name}</strong></td>
          <td>${g.tripsCount} chuyến</td>
          <td>${fmtThousands(g.km)} km</td>
          <td>${g.fuelActual.toFixed(1)} L</td>
          <td>${g.fuelNorm.toFixed(1)} L</td>
          <td style="color:${diff > 0 ? '#ff3b30' : '#34c759'};font-weight:bold">${diff > 0 ? '+' : ''}${diff.toFixed(1)} L</td>
          <td>${diff > 0 ? '⚠️ Hao hụt' : '✔️ Tiết kiệm'}</td>
        </tr>
      `;
    }).join('');

  } else if (type === 'operational_summary') {
    reportTitle = 'BÁO CÁO VẬN HÀNH VÀ CHI PHÍ TỔNG HỢP';
    tableHeaders = `
      <tr>
        <th>STT</th>
        <th>Chỉ số Vận hành & Chi phí</th>
        <th>Giá trị tổng cộng</th>
        <th>Nội dung chi tiết / Ghi chú</th>
      </tr>
    `;

    const totalTrips = rangeTrips.length;
    const totalKm = rangeTrips.reduce((sum, t) => sum + (Number(t.kmActual) || 0), 0);
    const totalFuel = rangeTrips.reduce((sum, t) => sum + (Number(t.fuelActual) || 0), 0);
    const totalFuelNorm = rangeTrips.reduce((sum, t) => sum + (Number(t.fuelNorm) || getTripFuelNorm(t)), 0);
    const fuelDiff = totalFuel - totalFuelNorm;
    
    const totalAllowance = rangeTrips.reduce((sum, t) => sum + (Number(t.allowance) || 0), 0);
    const totalExpense = rangeTrips.reduce((sum, t) => sum + (Number(t.expense) || 0), 0);
    const totalAdd = rangeTrips.reduce((sum, t) => sum + (Number(t.salaryAdd) || 0), 0);
    const totalSub = rangeTrips.reduce((sum, t) => sum + (Number(t.salarySub) || 0), 0);

    const rows = [
      { name: 'Tổng số chuyến đi đã thực hiện', val: `${totalTrips} chuyến`, desc: 'Lượt xe xuất phát ghi nhận trong kỳ' },
      { name: 'Tổng quãng đường vận chuyển thực tế', val: `${fmtThousands(totalKm)} km`, desc: 'Tích lũy km thực tế theo chuyến' },
      { name: 'Tổng lượng nhiên liệu đã đổ', val: `${totalFuel.toFixed(1)} L`, desc: 'Số dầu thực tế đã đổ theo hóa đơn' },
      { name: 'Tổng nhiên liệu định mức tiêu chuẩn', val: `${totalFuelNorm.toFixed(1)} L`, desc: 'Hạn mức nhiên liệu định mức cho phép' },
      { name: 'Chênh lệch hao hụt nhiên liệu', val: `${fuelDiff > 0 ? 'Vượt hạn mức +' : 'Tiết kiệm -'}${Math.abs(fuelDiff).toFixed(1)} L`, desc: fuelDiff > 0 ? '⚠️ Hao hụt cần rà soát' : '✔️ Mức tiêu hao tối ưu đạt chuẩn' },
      { name: 'Tổng chi phí phụ cấp chuyến đi', val: `${fmtThousands(totalAllowance)} ₫`, desc: 'Tổng chi phụ cấp chuyến của lái xe' },
      { name: 'Tổng chi phí chuyến đi phát sinh', val: `${fmtThousands(totalExpense)} ₫`, desc: 'Phí cầu đường, sửa chữa bảo dưỡng dọc đường' },
      { name: 'Tổng các khoản cộng lương lái xe', val: `${fmtThousands(totalAdd)} ₫`, desc: 'Cộng lương thưởng thêm ngoài giờ' },
      { name: 'Tổng các khoản trừ phạt lương lái xe', val: `${fmtThousands(totalSub)} ₫`, desc: 'Trừ phạt hao hụt dầu hoặc lỗi sự vụ' }
    ];

    tableRows = rows.map((r, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${r.name}</strong></td>
        <td style="font-weight:bold">${r.val}</td>
        <td>${r.desc}</td>
      </tr>
    `).join('');
  }

  // Khởi tạo cửa sổ in ẩn để người dùng Save as PDF qua Browser
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head>
        <title>In Báo Cáo Đội Xe</title>
        <style>
          body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #333;
            padding: 30px;
            background: #fff;
          }
          .header {
            text-align: center;
            margin-bottom: 25px;
            border-bottom: 2px solid #333;
            padding-bottom: 15px;
          }
          .header h1 {
            margin: 0 0 5px 0;
            font-size: 20px;
            font-weight: bold;
          }
          .header p {
            margin: 0;
            font-size: 13px;
            color: #666;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
          }
          th, td {
            border: 1px solid #333;
            padding: 10px 12px;
            text-align: left;
            font-size: 12px;
          }
          th {
            background-color: #f5f5f5;
            font-weight: bold;
          }
          tr:nth-child(even) td {
            background-color: #fafafa;
          }
          .footer {
            margin-top: 40px;
            display: flex;
            justify-content: space-between;
            font-size: 12px;
          }
          .footer-section {
            text-align: center;
            width: 200px;
          }
          .footer-section .sig {
            margin-top: 60px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>HỆ THỐNG QUẢN LÝ TÀI CHÍNH NỘI BỘ PREMIUM</h1>
          <h2>${reportTitle}</h2>
          <p>Thời gian báo cáo: Từ ngày ${start} đến ngày ${end}</p>
          <p>Ngày in báo cáo: ${new Date().toLocaleDateString('vi-VN')}</p>
        </div>
        
        <table>
          <thead>
            ${tableHeaders}
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>

        <div class="footer">
          <div class="footer-section">
            <p>Người lập biểu báo</p>
            <p class="sig">${state.currentUser ? state.currentUser.label : 'Kế toán viên'}</p>
          </div>
          <div class="footer-section">
            <p>Ban kiểm soát</p>
            <p class="sig">(Ký và ghi rõ họ tên)</p>
          </div>
          <div class="footer-section">
            <p>Giám đốc phê duyệt</p>
            <p class="sig">(Ký tên và đóng dấu)</p>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// Hàm format số hàng ngàn tiện ích
function fmtThousands(n) {
  if (n === null || n === undefined) return '0';
  return new Intl.NumberFormat('vi-VN').format(n);
}

// Đăng ký các hàm toàn cục cho thẻ HTML gọi
window.renderFleetPage = renderFleetPage;
window.renderFleetActiveTab = renderFleetActiveTab;
window.saveFleetVehicle = saveFleetVehicle;
window.deleteFleetVehicle = deleteFleetVehicle;
window.saveFleetDriver = saveFleetDriver;
window.deleteFleetDriver = deleteFleetDriver;
window.saveFleetRoute = saveFleetRoute;
window.deleteFleetRoute = deleteFleetRoute;
window.saveFleetTrip = saveFleetTrip;
window.deleteFleetTrip = deleteFleetTrip;
window.showTripInvoiceZoom = showTripInvoiceZoom;
window.toggleFleetReportView = toggleFleetReportView;
window.generateFleetReport = generateFleetReport;
window.initFleetModule = initFleetModule;
