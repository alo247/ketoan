/* ===== DEMO DATA GENERATOR & CATEGORY MANAGEMENT ===== */

const DEMO_REASONS = {
  thu: {
    'Doanh thu bán hàng': ['Bán hàng online Shopee','Bán hàng tại cửa hàng','Đơn hàng sỉ','Bán lẻ cuối tuần','Đơn hàng Lazada','Bán hàng TikTok Shop','Đơn hàng đại lý','Bán hàng livestream','Thanh toán đơn hàng cũ','Thu hồi công nợ khách'],
    'Dịch vụ': ['Phí tư vấn','Dịch vụ sửa chữa','Phí bảo trì','Dịch vụ thiết kế','Dịch vụ vận chuyển','Phí gia công','Hợp đồng dịch vụ tháng','Phí đào tạo','Dịch vụ cho thuê','Phí hỗ trợ kỹ thuật'],
    'Đầu tư': ['Cổ tức cổ phiếu','Lãi đầu tư BĐS','Thu từ hợp tác kinh doanh','Lãi quỹ đầu tư','Bán cổ phần','Thu nhập thụ động','Lãi trái phiếu','Thu cho thuê nhà'],
    'Lãi ngân hàng': ['Lãi tiết kiệm VCB','Lãi gửi kỳ hạn','Lãi tài khoản MB','Lãi tiết kiệm Techcombank','Lãi tiết kiệm online'],
    'Thu khác': ['Bán thanh lý tài sản','Thu phạt hợp đồng','Hoàn tiền bảo hiểm','Thu hồi đặt cọc','Thưởng đối tác','Hỗ trợ chính phủ','Thu nhập phụ','Tiền thưởng']
  },
  chi: {
    'Nguyên vật liệu': ['Mua nguyên liệu sản xuất','Nhập hàng hoá bán','Mua bao bì đóng gói','Phụ liệu sản xuất','Mua vật tư tiêu hao','Nhập kho hàng tháng','Mua linh kiện','Nguyên liệu thực phẩm','Hóa chất sản xuất','Vật liệu xây dựng'],
    'Nhân công': ['Lương nhân viên tháng','Thưởng nhân viên','BHXH nhân viên','Phụ cấp ăn trưa','Phụ cấp đi lại','Chi phí tuyển dụng','Đào tạo nhân viên','Tiền làm thêm giờ','Phúc lợi nhân viên','Lương thời vụ'],
    'Thuê mặt bằng': ['Tiền thuê cửa hàng','Tiền thuê kho','Tiền thuê văn phòng','Phí quản lý toà nhà','Tiền đặt cọc mặt bằng','Phí bảo trì chung cư'],
    'Điện nước': ['Tiền điện tháng','Tiền nước tháng','Tiền internet','Tiền điện thoại','Phí gas','Tiền cáp truyền hình'],
    'Vận chuyển': ['Phí ship hàng','Xăng dầu xe tải','Phí vận chuyển Grab','Phí giao hàng GHN','Bảo dưỡng xe','Phí cầu đường','Vé máy bay công tác','Taxi công tác'],
    'Marketing': ['Quảng cáo Facebook','Quảng cáo Google','In ấn tờ rơi','Tổ chức sự kiện','Chi phí KOL','SEO website','Quảng cáo TikTok','Email marketing','Banner quảng cáo','Thiết kế poster'],
    'Thiết bị': ['Mua máy tính mới','Mua máy in','Sửa chữa thiết bị','Mua điều hoà','Nâng cấp server','Mua bàn ghế','Mua phần mềm','Thiết bị bảo hộ'],
    'Chi khác': ['Tiếp khách đối tác','Quà tặng khách hàng','Phí ngân hàng','Thuế GTGT','Thuế thu nhập','Phí luật sư','Bảo hiểm tài sản','Văn phòng phẩm','Phí giấy phép','Chi phí phát sinh']
  }
};

function generateDemoEntries(count) {
  const entries = [];
  const cats = getCategories();
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(Math.random() * 365);
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    const date = d.toISOString().slice(0, 10);
    const type = Math.random() < 0.55 ? 'thu' : 'chi';
    const catList = cats[type];
    const category = catList[Math.floor(Math.random() * catList.length)];
    const reasons = DEMO_REASONS[type][category] || [`${type === 'thu' ? 'Thu' : 'Chi'} - ${category}`];
    const reason = reasons[Math.floor(Math.random() * reasons.length)];
    let amount;
    if (type === 'thu') {
      amount = (Math.floor(Math.random() * 200) + 5) * 100000;
    } else {
      amount = (Math.floor(Math.random() * 100) + 1) * 100000;
    }
    entries.push({
      id: uid(),
      type, date, category, amount, reason,
      createdBy: 'admin',
      createdAt: d.toISOString()
    });
  }
  return entries;
}

/* ===== CATEGORY CRUD ===== */
function getCategories() {
  const saved = JSON.parse(localStorage.getItem('tc_categories') || 'null');
  if (saved) return saved;
  return {
    thu: ['Doanh thu bán hàng', 'Dịch vụ', 'Đầu tư', 'Lãi ngân hàng', 'Thu khác'],
    chi: ['Nguyên vật liệu', 'Nhân công', 'Thuê mặt bằng', 'Điện nước', 'Vận chuyển', 'Marketing', 'Thiết bị', 'Chi khác']
  };
}
function saveCategories(cats) { localStorage.setItem('tc_categories', JSON.stringify(cats)); }

function renderCategoryPage() {
  const cats = getCategories();
  const adm = hasPermission('cats');
  ['thu', 'chi'].forEach(type => {
    const tbody = $(type === 'thu' ? 'catThuTable' : 'catChiTable');
    if (!tbody) return;
    tbody.innerHTML = cats[type].map((c, i) => `<tr>
      <td>${i + 1}</td><td>${c}</td>
      <td>${adm ? `<button class="btn btn-primary btn-sm" onclick="showEditCatForm('${type}',${i})"><i class="fas fa-edit"></i></button> <button class="btn btn-danger btn-sm" onclick="deleteCat('${type}',${i})"><i class="fas fa-trash"></i></button>` : '-'}</td>
    </tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:20px">Chưa có danh mục</td></tr>';
  });
}

window.showAddCatForm = function(type) {
  if (!hasPermission('cats')) return toast('Bạn không có quyền!', 'error');
  openModal('Thêm danh mục ' + (type === 'thu' ? 'Thu' : 'Chi'), `
    <div class="form-group"><label>Tên danh mục</label><input type="text" id="fCatName" placeholder="Nhập tên danh mục"></div>
    <div class="modal-actions"><button class="btn btn-primary" onclick="saveCat('${type}')">Thêm</button></div>
  `);
};
window.showEditCatForm = function(type, idx) {
  if (!hasPermission('cats')) return;
  const cats = getCategories();
  const old = cats[type][idx];
  openModal('Sửa danh mục', `
    <div class="form-group"><label>Tên danh mục</label><input type="text" id="fCatName" value="${old}"></div>
    <div class="modal-actions"><button class="btn btn-primary" onclick="updateCat('${type}',${idx})">Cập nhật</button></div>
  `);
};
window.saveCat = function(type) {
  if (!hasPermission('cats')) return toast('Bạn không có quyền!', 'error');
  const name = $('fCatName').value.trim();
  if (!name) return toast('Nhập tên danh mục!', 'error');
  const cats = getCategories();
  if (cats[type].includes(name)) return toast('Danh mục đã tồn tại!', 'error');
  cats[type].push(name);
  saveCategories(cats);
  if (window.sendToCloud) window.sendToCloud({ action: 'saveCat', type, name });
  closeModal();
  renderCategoryPage();
  toast('Đã thêm danh mục!');
};
window.updateCat = function(type, idx) {
  if (!hasPermission('cats')) return toast('Bạn không có quyền!', 'error');
  const name = $('fCatName').value.trim();
  if (!name) return toast('Nhập tên danh mục!', 'error');
  const cats = getCategories();
  const oldName = cats[type][idx];
  cats[type][idx] = name;
  saveCategories(cats);
  // Update existing entries with old category name
  state.entries.forEach(e => { if (e.type === type && e.category === oldName) e.category = name; });
  saveData();
  if (window.sendToCloud) window.sendToCloud({ action: 'updateCat', type, idx, name, oldName });
  closeModal();
  renderCategoryPage();
  toast('Đã cập nhật danh mục!');
};
window.deleteCat = function(type, idx) {
  if (!hasPermission('cats')) return toast('Bạn không có quyền!', 'error');
  if (!confirm('Xoá danh mục này?')) return;
  const cats = getCategories();
  cats[type].splice(idx, 1);
  saveCategories(cats);
  if (window.sendToCloud) window.sendToCloud({ action: 'deleteCat', type, idx });
  renderCategoryPage();
  toast('Đã xoá danh mục!');
};
