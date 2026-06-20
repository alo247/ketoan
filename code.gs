// GOOGLE APPS SCRIPT: HỆ THỐNG KẾ TOÁN NỘI BỘ PREMIUM
// Cập nhật: Hỗ trợ kiểm soát soát xét (auditStatus, auditNote), tự động nâng cấp cấu trúc cột CSDL online
// Bổ sung: Đồng bộ đám mây thời gian thực chéo thiết bị cho Tạm ứng (advances), Công nợ (debts), Audit Logs (auditLogs)

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    initDatabase(ss);
    
    var data = {
      entries: getSheetData(ss.getSheetByName("entries")),
      users: getSheetData(ss.getSheetByName("users")),
      categories: getCategoriesData(ss.getSheetByName("categories")),
      advances: getSheetData(ss.getSheetByName("advances")),
      debts: getSheetData(ss.getSheetByName("debts")),
      auditLogs: getSheetData(ss.getSheetByName("auditLogs")),
      accounts: getSheetData(ss.getSheetByName("accounts")),
      fleetVehicles: getSheetData(ss.getSheetByName("fleetVehicles")),
      fleetDrivers: getSheetData(ss.getSheetByName("fleetDrivers")),
      fleetRoutes: getSheetData(ss.getSheetByName("fleetRoutes")),
      fleetTrips: getSheetData(ss.getSheetByName("fleetTrips")),
      systemSettings: getSheetData(ss.getSheetByName("systemSettings"))
    };
    
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    initDatabase(ss);
    
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var result = { success: true };
    
    if (action === "saveEntry") {
      result = saveEntry(ss, payload.entry, payload.fileData);
    } else if (action === "deleteEntry") {
      result = deleteEntry(ss, payload.id);
    } else if (action === "saveUser") {
      result = saveUser(ss, payload.user);
    } else if (action === "deleteUser") {
      result = deleteUser(ss, payload.username);
    } else if (action === "saveCat") {
      result = saveCat(ss, payload.type, payload.name);
    } else if (action === "updateCat") {
      result = updateCat(ss, payload.type, payload.idx, payload.name, payload.oldName);
    } else if (action === "deleteCat") {
      result = deleteCat(ss, payload.type, payload.idx);
    } else if (action === "clearJournal") {
      result = clearJournal(ss);
    } else if (action === "restoreAll") {
      result = restoreAll(ss, payload.entries, payload.users, payload.categories, payload.advances, payload.debts, payload.auditLogs, payload.accounts, payload.fleetVehicles, payload.fleetDrivers, payload.fleetRoutes, payload.fleetTrips, payload.systemSettings);
    } else if (action === "saveAdvance") {
      result = saveAdvance(ss, payload.advance, payload.fileData);
    } else if (action === "deleteAdvance") {
      result = deleteAdvance(ss, payload.id);
    } else if (action === "saveDebt") {
      result = saveDebt(ss, payload.debt);
    } else if (action === "deleteDebt") {
      result = deleteDebt(ss, payload.id);
    } else if (action === "saveAuditLog") {
      result = saveAuditLog(ss, payload.auditLog);
    } else if (action === "clearAuditLogs") {
      result = clearAuditLogs(ss);
    } else if (action === "saveAccount") {
      result = saveAccount(ss, payload.account);
    } else if (action === "deleteAccount") {
      result = deleteAccount(ss, payload.name);
    } else if (action === "saveFleetVehicle") {
      result = saveFleetVehicle(ss, payload.vehicle);
    } else if (action === "deleteFleetVehicle") {
      result = deleteFleetVehicle(ss, payload.id);
    } else if (action === "saveFleetDriver") {
      result = saveFleetDriver(ss, payload.driver);
    } else if (action === "deleteFleetDriver") {
      result = deleteFleetDriver(ss, payload.id);
    } else if (action === "saveFleetRoute") {
      result = saveFleetRoute(ss, payload.route);
    } else if (action === "deleteFleetRoute") {
      result = deleteFleetRoute(ss, payload.id);
    } else if (action === "saveFleetTrip") {
      result = saveFleetTrip(ss, payload.trip, payload.fileData);
    } else if (action === "deleteFleetTrip") {
      result = deleteFleetTrip(ss, payload.id);
    } else if (action === "saveSystemSettings") {
      result = saveSystemSettings(ss, payload.settings);
    } else {
      result = { success: false, error: "Hành động không hợp lệ: " + action };
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// -------------------------------------------------------------
// KHỞI TẠO VÀ CẬP NHẬT CẤU TRÚC SHEET (DATABASE AUTO-UPGRADE)
// -------------------------------------------------------------
function initDatabase(ss) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("db_initialized_v7"); // Nâng cấp phiên bản db_initialized lên v7
  if (cached === "true") {
    return; // Đã khởi tạo cấu trúc CSDL trực tuyến, bỏ qua để tăng tốc tối đa
  }

  // 1. Tạo hoặc kiểm tra sheet 'entries'
  var entriesSheet = ss.getSheetByName("entries");
  var entriesHeaders = ["id", "type", "date", "category", "amount", "reason", "createdBy", "createdAt", "invoice", "auditStatus", "auditNote", "stt", "account", "toAccount", "driverId"];
  if (!entriesSheet) {
    entriesSheet = ss.insertSheet("entries");
    entriesSheet.appendRow(entriesHeaders);
    // Format hàng tiêu đề
    entriesSheet.getRange(1, 1, 1, entriesHeaders.length).setFontWeight("bold").setBackground("#d9ead3");
  } else {
    // Tự động nâng cấp cột nếu thiếu cột
    var currentHeaders = entriesSheet.getRange(1, 1, 1, entriesSheet.getLastColumn()).getValues()[0];
    var updated = false;
    for (var i = 0; i < entriesHeaders.length; i++) {
      var header = entriesHeaders[i];
      if (currentHeaders.indexOf(header) === -1) {
        entriesSheet.getRange(1, entriesSheet.getLastColumn() + 1).setValue(header)
          .setFontWeight("bold").setBackground("#d9ead3");
        updated = true;
      }
    }
  }

  // 2. Tạo hoặc kiểm tra sheet 'users'
  var usersSheet = ss.getSheetByName("users");
  var usersHeaders = ["username", "password", "role", "label", "permissions"];
  if (!usersSheet) {
    usersSheet = ss.insertSheet("users");
    usersSheet.appendRow(usersHeaders);
    usersSheet.getRange(1, 1, 1, usersHeaders.length).setFontWeight("bold").setBackground("#fce5cd");
    
    // Thêm các tài khoản mặc định
    usersSheet.appendRow(["admin", "admin123", "admin", "Quản trị viên", ""]);
    usersSheet.appendRow(["accountant", "accountant123", "accountant", "Kế toán", "view,add,edit,approve,cats,reports,advances_edit,debts_edit"]);
    usersSheet.appendRow(["treasurer", "treasurer123", "treasurer", "Thủ quỹ", "view,advances_pay,debts_pay"]);
    usersSheet.appendRow(["staff", "staff123", "staff", "Nhân viên", "view_self_advances,advances_submit"]);
    usersSheet.appendRow(["audit", "audit123", "audit", "Ban kiểm soát", "view,approve"]);
    usersSheet.appendRow(["viewer", "viewer123", "viewer", "Chỉ xem", ""]);
  }

  // 3. Tạo hoặc kiểm tra sheet 'categories'
  var catsSheet = ss.getSheetByName("categories");
  var catsHeaders = ["type", "name"];
  if (!catsSheet) {
    catsSheet = ss.insertSheet("categories");
    catsSheet.appendRow(catsHeaders);
    catsSheet.getRange(1, 1, 1, catsHeaders.length).setFontWeight("bold").setBackground("#c9daf8");
    
    // Thêm danh mục mặc định
    var defaultCats = [
      ["thu", "Doanh thu bán hàng"], ["thu", "Dịch vụ"], ["thu", "Đầu tư"], ["thu", "Lãi ngân hàng"], ["thu", "Thu khác"],
      ["chi", "Nguyên vật liệu"], ["chi", "Nhân công"], ["chi", "Thuê mặt bằng"], ["chi", "Điện nước"], 
      ["chi", "Vận chuyển"], ["chi", "Marketing"], ["chi", "Thiết bị"], ["chi", "Chi khác"]
    ];
    for (var j = 0; j < defaultCats.length; j++) {
      catsSheet.appendRow(defaultCats[j]);
    }
  }

  // 4. Tạo hoặc kiểm tra sheet 'advances' (Tạm ứng)
  var advSheet = ss.getSheetByName("advances");
  var advHeaders = ["id", "employee", "amount", "date", "reason", "status", "invoice", "settledAmount", "settledDate", "settlementInvoice"];
  if (!advSheet) {
    advSheet = ss.insertSheet("advances");
    advSheet.appendRow(advHeaders);
    advSheet.getRange(1, 1, 1, advHeaders.length).setFontWeight("bold").setBackground("#d9ead3");
  }

  // 5. Tạo hoặc kiểm tra sheet 'debts' (Công nợ)
  var debtsSheet = ss.getSheetByName("debts");
  var debtsHeaders = ["id", "type", "partner", "amount", "dueDate", "reason", "status", "paymentDate"];
  if (!debtsSheet) {
    debtsSheet = ss.insertSheet("debts");
    debtsSheet.appendRow(debtsHeaders);
    debtsSheet.getRange(1, 1, 1, debtsHeaders.length).setFontWeight("bold").setBackground("#c9daf8");
  }

  // 6. Tạo hoặc kiểm tra sheet 'auditLogs' (Nhật ký kiểm toán)
  var auditSheet = ss.getSheetByName("auditLogs");
  var auditHeaders = ["timestamp", "username", "role", "action", "details"];
  if (!auditSheet) {
    auditSheet = ss.insertSheet("auditLogs");
    auditSheet.appendRow(auditHeaders);
    auditSheet.getRange(1, 1, 1, auditHeaders.length).setFontWeight("bold").setBackground("#f3f4f6");
  }

  // 7. Tạo hoặc kiểm tra sheet 'accounts' (Đa quỹ)
  var accountsSheet = ss.getSheetByName("accounts");
  var accountsHeaders = ["id", "name", "initialBalance", "desc"];
  if (!accountsSheet) {
    accountsSheet = ss.insertSheet("accounts");
    accountsSheet.appendRow(accountsHeaders);
    accountsSheet.getRange(1, 1, 1, accountsHeaders.length).setFontWeight("bold").setBackground("#d9ead3");
    // Thêm tài khoản mặc định
    accountsSheet.appendRow(["cash", "Tiền mặt", 0, "Quỹ tiền mặt tại két"]);
    accountsSheet.appendRow(["vcb", "Vietcombank", 0, "Tài khoản Vietcombank"]);
    accountsSheet.appendRow(["mbb", "MB Bank", 0, "Tài khoản MB Bank"]);
  }

  // 8. Tạo hoặc kiểm tra sheet 'fleetVehicles' (Danh sách xe)
  var fVehiclesSheet = ss.getSheetByName("fleetVehicles");
  var fVehiclesHeaders = ["id", "plate", "model", "fuelNorm", "status", "notes"];
  if (!fVehiclesSheet) {
    fVehiclesSheet = ss.insertSheet("fleetVehicles");
    fVehiclesSheet.appendRow(fVehiclesHeaders);
    fVehiclesSheet.getRange(1, 1, 1, fVehiclesHeaders.length).setFontWeight("bold").setBackground("#d9ead3");
  }

  // 9. Tạo hoặc kiểm tra sheet 'fleetDrivers' (Danh sách lái xe)
  var fDriversSheet = ss.getSheetByName("fleetDrivers");
  var fDriversHeaders = ["id", "name", "phone", "baseSalary", "notes", "allowance"];
  if (!fDriversSheet) {
    fDriversSheet = ss.insertSheet("fleetDrivers");
    fDriversSheet.appendRow(fDriversHeaders);
    fDriversSheet.getRange(1, 1, 1, fDriversHeaders.length).setFontWeight("bold").setBackground("#fce5cd");
  } else {
    var currentHeaders = fDriversSheet.getRange(1, 1, 1, fDriversSheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < fDriversHeaders.length; i++) {
      var header = fDriversHeaders[i];
      if (currentHeaders.indexOf(header) === -1) {
        fDriversSheet.getRange(1, fDriversSheet.getLastColumn() + 1).setValue(header)
          .setFontWeight("bold").setBackground("#fce5cd");
      }
    }
  }

  // 10. Tạo hoặc kiểm tra sheet 'fleetRoutes' (Cung đường)
  var fRoutesSheet = ss.getSheetByName("fleetRoutes");
  var fRoutesHeaders = ["id", "name", "startPoint", "endPoint", "distance", "fuelNorm"];
  if (!fRoutesSheet) {
    fRoutesSheet = ss.insertSheet("fleetRoutes");
    fRoutesSheet.appendRow(fRoutesHeaders);
    fRoutesSheet.getRange(1, 1, 1, fRoutesHeaders.length).setFontWeight("bold").setBackground("#c9daf8");
  }

  // 11. Tạo hoặc kiểm tra sheet 'fleetTrips' (Chuyến đi & Nhiên liệu)
  var fTripsSheet = ss.getSheetByName("fleetTrips");
  var fTripsHeaders = ["id", "date", "driverId", "vehicleId", "routeId", "startPoint", "endPoint", "kmActual", "fuelActual", "fuelNorm", "allowance", "revenue", "expense", "salaryAdd", "salarySub", "notes", "invoice", "isVip"];
  if (!fTripsSheet) {
    fTripsSheet = ss.insertSheet("fleetTrips");
    fTripsSheet.appendRow(fTripsHeaders);
    fTripsSheet.getRange(1, 1, 1, fTripsHeaders.length).setFontWeight("bold").setBackground("#d9ead3");
  } else {
    var currentHeaders = fTripsSheet.getRange(1, 1, 1, fTripsSheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < fTripsHeaders.length; i++) {
      var header = fTripsHeaders[i];
      if (currentHeaders.indexOf(header) === -1) {
        fTripsSheet.getRange(1, fTripsSheet.getLastColumn() + 1).setValue(header)
          .setFontWeight("bold").setBackground("#d9ead3");
      }
    }
  }

  // 12. Tạo hoặc kiểm tra sheet 'systemSettings' (Cài đặt hệ thống)
  var settingsSheet = ss.getSheetByName("systemSettings");
  var settingsHeaders = ["key", "value", "desc"];
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet("systemSettings");
    settingsSheet.appendRow(settingsHeaders);
    settingsSheet.getRange(1, 1, 1, settingsHeaders.length).setFontWeight("bold").setBackground("#f3f4f6");
    // Thêm các cấu hình thưởng chuyến VIP mặc định
    settingsSheet.appendRow(["vip_bonus_2", "100000", "Thưởng chuyến VIP thứ 2 trong ngày"]);
    settingsSheet.appendRow(["vip_bonus_3", "300000", "Thưởng chuyến VIP thứ 3 trong ngày"]);
    settingsSheet.appendRow(["vip_bonus_4", "300000", "Thưởng chuyến VIP thứ 4 trong ngày"]);
  }

  // Lưu trạng thái đã khởi tạo cấu trúc CSDL vào Cache trong 6 giờ (21600 giây)
  cache.put("db_initialized_v7", "true", 21600);
}

// -------------------------------------------------------------
// HÀM ĐỌC DỮ LIỆU TỪ SHEET SANG JSON
// -------------------------------------------------------------
function getSheetData(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var data = [];
  
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var header = headers[c];
      var val = values[r][c];
      // Chuẩn hóa kiểu dữ liệu số và ngày tháng
      if (header === "amount" || header === "stt" || header === "settledAmount") {
        obj[header] = Number(val) || 0;
      } else if (val instanceof Date) {
        if (header === "date" || header === "dueDate" || header === "settledDate" || header === "paymentDate") {
          var yyyy = val.getFullYear();
          var mm = String(val.getMonth() + 1).padStart(2, '0');
          var dd = String(val.getDate()).padStart(2, '0');
          obj[header] = yyyy + "-" + mm + "-" + dd;
        } else {
          obj[header] = val.toISOString();
        }
      } else {
        obj[header] = val;
      }
    }
    data.push(obj);
  }
  return data;
}

function getCategoriesData(sheet) {
  var raw = getSheetData(sheet);
  var result = { thu: [], chi: [] };
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (item.type === "thu" || item.type === "chi") {
      result[item.type].push(item.name);
    }
  }
  return result;
}

// -------------------------------------------------------------
// CÁC HÀM XỬ LÝ ACTION TỪ FRONTEND
// -------------------------------------------------------------

function saveEntry(ss, entry, fileData) {
  var sheet = ss.getSheetByName("entries");
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id' trong CSDL!" };
  
  // 1. Upload hóa đơn lên Google Drive nếu có file đính kèm gửi lên
  var invoiceUrl = entry.invoice || "";
  var driveError = false;
  
  if (fileData && fileData.base64) {
    try {
      var folder = getOrCreateFolder("KeToan_HoaDon");
      var decoded = Utilities.base64Decode(fileData.base64);
      var blob = Utilities.newBlob(decoded, fileData.mimeType, fileData.name);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      invoiceUrl = file.getUrl();
      entry.invoice = invoiceUrl;
    } catch (e) {
      Logger.log("Lỗi tải Drive: " + e.toString());
      driveError = true;
    }
  }
  
  // Chuẩn bị mảng giá trị cho hàng dữ liệu theo thứ tự cột động
  var rowValues = [];
  for (var c = 0; c < headers.length; c++) {
    var header = headers[c];
    var val = entry[header];
    if (val === undefined || val === null) {
      rowValues.push("");
    } else if (header === "amount" || header === "stt") {
      rowValues.push(Number(val) || 0);
    } else {
      rowValues.push(val);
    }
  }
  
  // 2. Tìm hàng cũ để cập nhật hoặc thêm mới
  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (data[r][idColIdx] === entry.id) {
      targetRow = r + 1; // Hàng thứ r+1 trong sheet (1-indexed)
      break;
    }
  }
  
  if (targetRow !== -1) {
    // Cập nhật hàng hiện có
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    // Thêm hàng mới
    sheet.appendRow(rowValues);
  }
  
  return { success: true, invoiceUrl: invoiceUrl, driveError: driveError };
}

function deleteEntry(ss, id) {
  var sheet = ss.getSheetByName("entries");
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id'!" };
  
  var values = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === id) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Giao dịch không tồn tại trên Cloud!" };
}

function saveUser(ss, user) {
  var sheet = ss.getSheetByName("users");
  var headers = ["username", "password", "role", "label", "permissions"];
  var values = sheet.getDataRange().getValues();
  
  var rowValues = [user.username, user.password, user.role, user.label, user.permissions || ""];
  
  // Tìm user cũ
  var targetRow = -1;
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === user.username) {
      targetRow = r + 1;
      break;
    }
  }
  
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return { success: true };
}

function deleteUser(ss, username) {
  var sheet = ss.getSheetByName("users");
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === username) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Người dùng không tồn tại!" };
}

function saveCat(ss, type, name) {
  var sheet = ss.getSheetByName("categories");
  sheet.appendRow([type, name]);
  return { success: true };
}

function updateCat(ss, type, idx, name, oldName) {
  var sheet = ss.getSheetByName("categories");
  var values = sheet.getDataRange().getValues();
  var count = 0;
  
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === type) {
      if (count === idx) {
        sheet.getRange(r + 1, 2).setValue(name);
        
        // Đồng thời cập nhật cả các danh mục con nếu danh mục gốc thay đổi
        if (!oldName.includes(" > ")) {
          for (var i = 1; i < values.length; i++) {
            var cName = values[i][1];
            if (values[i][0] === type && cName.startsWith(oldName + " > ")) {
              var newSubName = cName.replace(oldName + " > ", name + " > ");
              sheet.getRange(i + 1, 2).setValue(newSubName);
            }
          }
        }
        return { success: true };
      }
      count++;
    }
  }
  return { success: false, error: "Không tìm thấy danh mục để cập nhật!" };
}

function deleteCat(ss, type, idx) {
  var sheet = ss.getSheetByName("categories");
  var values = sheet.getDataRange().getValues();
  var count = 0;
  
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === type) {
      if (count === idx) {
        var targetCat = values[r][1];
        sheet.deleteRow(r + 1);
        
        // Tự động xoá toàn bộ danh mục con đi kèm
        var valuesAfterDelete = sheet.getDataRange().getValues();
        for (var i = valuesAfterDelete.length - 1; i >= 1; i--) {
          if (valuesAfterDelete[i][0] === type && valuesAfterDelete[i][1].startsWith(targetCat + " > ")) {
            sheet.deleteRow(i + 1);
          }
        }
        return { success: true };
      }
      count++;
    }
  }
  return { success: false, error: "Không tìm thấy danh mục để xoá!" };
}

function clearJournal(ss) {
  var sheet = ss.getSheetByName("entries");
  if (sheet.getLastRow() >= 2) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  return { success: true };
}

// -------------------------------------------------------------
// ĐỒNG BỘ MỚI: TẠM ỨNG (advances)
// -------------------------------------------------------------
function saveAdvance(ss, advance, fileData) {
  var sheet = ss.getSheetByName("advances");
  var headers = ["id", "employee", "amount", "date", "reason", "status", "invoice", "settledAmount", "settledDate", "settlementInvoice"];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id' trong advances!" };
  
  // Upload hóa đơn hoàn ứng lên Google Drive nếu có file đính kèm gửi lên
  var invoiceUrl = advance.settlementInvoice || "";
  var driveError = false;
  
  if (fileData && fileData.base64) {
    try {
      var folder = getOrCreateFolder("KeToan_HoaDon");
      var decoded = Utilities.base64Decode(fileData.base64);
      var blob = Utilities.newBlob(decoded, fileData.mimeType, fileData.name);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      invoiceUrl = file.getUrl();
      advance.settlementInvoice = invoiceUrl;
    } catch (e) {
      Logger.log("Lỗi tải Drive hoàn ứng: " + e.toString());
      driveError = true;
    }
  }
  
  var rowValues = [];
  for (var c = 0; c < headers.length; c++) {
    var header = headers[c];
    var val = advance[header];
    if (val === undefined || val === null) {
      rowValues.push("");
    } else if (header === "amount" || header === "settledAmount") {
      rowValues.push(Number(val) || 0);
    } else {
      rowValues.push(val);
    }
  }
  
  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (data[r][idColIdx] === advance.id) {
      targetRow = r + 1;
      break;
    }
  }
  
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  
  return { success: true, invoiceUrl: invoiceUrl, driveError: driveError };
}

function deleteAdvance(ss, id) {
  var sheet = ss.getSheetByName("advances");
  var headers = ["id", "employee", "amount", "date", "reason", "status", "invoice", "settledAmount", "settledDate", "settlementInvoice"];
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id'!" };
  
  var values = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === id) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Tạm ứng không tồn tại trên Cloud!" };
}

// -------------------------------------------------------------
// ĐỒNG BỘ MỚI: CÔNG NỢ (debts)
// -------------------------------------------------------------
function saveDebt(ss, debt) {
  var sheet = ss.getSheetByName("debts");
  var headers = ["id", "type", "partner", "amount", "dueDate", "reason", "status", "paymentDate"];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id' trong debts!" };
  
  var rowValues = [];
  for (var c = 0; c < headers.length; c++) {
    var header = headers[c];
    var val = debt[header];
    if (val === undefined || val === null) {
      rowValues.push("");
    } else if (header === "amount") {
      rowValues.push(Number(val) || 0);
    } else {
      rowValues.push(val);
    }
  }
  
  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (data[r][idColIdx] === debt.id) {
      targetRow = r + 1;
      break;
    }
  }
  
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return { success: true };
}

function deleteDebt(ss, id) {
  var sheet = ss.getSheetByName("debts");
  var headers = ["id", "type", "partner", "amount", "dueDate", "reason", "status", "paymentDate"];
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id'!" };
  
  var values = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === id) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Công nợ không tồn tại trên Cloud!" };
}

// -------------------------------------------------------------
// ĐỒNG BỘ MỚI: AUDIT LOGS (auditLogs)
// -------------------------------------------------------------
function saveAuditLog(ss, auditLog) {
  var sheet = ss.getSheetByName("auditLogs");
  var headers = ["timestamp", "username", "role", "action", "details"];
  
  var rowValues = [];
  for (var c = 0; c < headers.length; c++) {
    var header = headers[c];
    var val = auditLog[header];
    rowValues.push(val === undefined || val === null ? "" : val);
  }
  
  sheet.appendRow(rowValues);
  
  // Giới hạn 1000 logs trên Cloud để tránh phình to trang tính
  if (sheet.getLastRow() > 1001) {
    sheet.deleteRow(2);
  }
  
  return { success: true };
}

function clearAuditLogs(ss) {
  var sheet = ss.getSheetByName("auditLogs");
  if (sheet.getLastRow() >= 2) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  return { success: true };
}

// -------------------------------------------------------------
// THƯ MỤC LƯU FILE HÓA ĐƠN
// -------------------------------------------------------------
function getOrCreateFolder(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

// -------------------------------------------------------------
// ĐỒNG BỘ TOÀN BỘ CƠ SỞ DỮ LIỆU (RESTORE ALL)
// -------------------------------------------------------------
function restoreAll(ss, entries, users, categories, advances, debts, auditLogs, accounts, fleetVehicles, fleetDrivers, fleetRoutes, fleetTrips, systemSettings) {
  try {
    // 1. Đồng bộ Entries (Nhật Ký Chung)
    if (entries && Array.isArray(entries)) {
      var sheet = ss.getSheetByName("entries");
      if (sheet.getLastRow() >= 2) {
        sheet.deleteRows(2, sheet.getLastRow() - 1);
      }
      var headers = ["id", "type", "date", "category", "amount", "reason", "createdBy", "createdAt", "invoice", "auditStatus", "auditNote", "stt", "account", "toAccount", "driverId"];
      
      var rowsToAppend = [];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var rowValues = [];
        for (var c = 0; c < headers.length; c++) {
          var header = headers[c];
          var val = entry[header];
          if (val === undefined || val === null) {
            rowValues.push("");
          } else if (header === "amount" || header === "stt") {
            rowValues.push(Number(val) || 0);
          } else {
            rowValues.push(val);
          }
        }
        rowsToAppend.push(rowValues);
      }
      if (rowsToAppend.length > 0) {
        sheet.getRange(2, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
      }
    }

    // 2. Đồng bộ Users (Danh sách người dùng)
    if (users && Array.isArray(users)) {
      var uSheet = ss.getSheetByName("users");
      if (uSheet.getLastRow() >= 2) {
        uSheet.deleteRows(2, uSheet.getLastRow() - 1);
      }
      var uHeaders = ["username", "password", "role", "label", "permissions"];
      var uRows = [];
      for (var j = 0; j < users.length; j++) {
        var u = users[j];
        uRows.push([u.username, u.password, u.role, u.label, u.permissions || ""]);
      }
      if (uRows.length > 0) {
        uSheet.getRange(2, 1, uRows.length, uHeaders.length).setValues(uRows);
      }
    }

    // 3. Đồng bộ Categories (Danh mục)
    if (categories && typeof categories === "object") {
      var catSheet = ss.getSheetByName("categories");
      if (catSheet.getLastRow() >= 2) {
        catSheet.deleteRows(2, catSheet.getLastRow() - 1);
      }
      var catRows = [];
      if (categories.thu && Array.isArray(categories.thu)) {
        for (var k = 0; k < categories.thu.length; k++) {
          catRows.push(["thu", categories.thu[k]]);
        }
      }
      if (categories.chi && Array.isArray(categories.chi)) {
        for (var m = 0; m < categories.chi.length; m++) {
          catRows.push(["chi", categories.chi[m]]);
        }
      }
      if (catRows.length > 0) {
        catSheet.getRange(2, 1, catRows.length, 2).setValues(catRows);
      }
    }

    // 4. Đồng bộ Advances (Tạm ứng)
    if (advances && Array.isArray(advances)) {
      var advSheet = ss.getSheetByName("advances");
      if (advSheet.getLastRow() >= 2) {
        advSheet.deleteRows(2, advSheet.getLastRow() - 1);
      }
      var advHeaders = ["id", "employee", "amount", "date", "reason", "status", "invoice", "settledAmount", "settledDate", "settlementInvoice"];
      var advRows = [];
      for (var a = 0; a < advances.length; a++) {
        var adv = advances[a];
        var rowValues = [];
        for (var c = 0; c < advHeaders.length; c++) {
          var header = advHeaders[c];
          var val = adv[header];
          if (val === undefined || val === null) {
            rowValues.push("");
          } else if (header === "amount" || header === "settledAmount") {
            rowValues.push(Number(val) || 0);
          } else {
            rowValues.push(val);
          }
        }
        advRows.push(rowValues);
      }
      if (advRows.length > 0) {
        advSheet.getRange(2, 1, advRows.length, advHeaders.length).setValues(advRows);
      }
    }

    // 5. Đồng bộ Debts (Công nợ)
    if (debts && Array.isArray(debts)) {
      var debtsSheet = ss.getSheetByName("debts");
      if (debtsSheet.getLastRow() >= 2) {
        debtsSheet.deleteRows(2, debtsSheet.getLastRow() - 1);
      }
      var debtsHeaders = ["id", "type", "partner", "amount", "dueDate", "reason", "status", "paymentDate"];
      var debtsRows = [];
      for (var d = 0; d < debts.length; d++) {
        var debt = debts[d];
        var rowValues = [];
        for (var c = 0; c < debtsHeaders.length; c++) {
          var header = debtsHeaders[c];
          var val = debt[header];
          if (val === undefined || val === null) {
            rowValues.push("");
          } else if (header === "amount") {
            rowValues.push(Number(val) || 0);
          } else {
            rowValues.push(val);
          }
        }
        debtsRows.push(rowValues);
      }
      if (debtsRows.length > 0) {
        debtsSheet.getRange(2, 1, debtsRows.length, debtsHeaders.length).setValues(debtsRows);
      }
    }

    // 6. Đồng bộ Audit Logs (Nhật ký kiểm toán)
    if (auditLogs && Array.isArray(auditLogs)) {
      var auditSheet = ss.getSheetByName("auditLogs");
      if (auditSheet.getLastRow() >= 2) {
        auditSheet.deleteRows(2, auditSheet.getLastRow() - 1);
      }
      var auditHeaders = ["timestamp", "username", "role", "action", "details"];
      var auditRows = [];
      for (var l = 0; l < auditLogs.length; l++) {
        var log = auditLogs[l];
        var rowValues = [];
        for (var c = 0; c < auditHeaders.length; c++) {
          var header = auditHeaders[c];
          var val = log[header];
          rowValues.push(val === undefined || val === null ? "" : val);
        }
        auditRows.push(rowValues);
      }
      if (auditRows.length > 0) {
        var slicedRows = auditRows.slice(-1000);
        auditSheet.getRange(2, 1, slicedRows.length, auditHeaders.length).setValues(slicedRows);
      }
    }

    // 7. Đồng bộ Accounts (Danh sách tài khoản & quỹ)
    if (accounts && Array.isArray(accounts)) {
      var accSheet = ss.getSheetByName("accounts");
      if (accSheet.getLastRow() >= 2) {
        accSheet.deleteRows(2, accSheet.getLastRow() - 1);
      }
      var accHeaders = ["id", "name", "initialBalance", "desc"];
      var accRows = [];
      for (var ac = 0; ac < accounts.length; ac++) {
        var acc = accounts[ac];
        accRows.push([
          acc.id || "",
          acc.name || "",
          Number(acc.initialBalance) || 0,
          acc.desc || ""
        ]);
      }
      if (accRows.length > 0) {
        accSheet.getRange(2, 1, accRows.length, accHeaders.length).setValues(accRows);
      }
    }

    // 8. Đồng bộ Fleet Vehicles
    if (fleetVehicles && Array.isArray(fleetVehicles)) {
      var fVehSheet = ss.getSheetByName("fleetVehicles");
      if (fVehSheet.getLastRow() >= 2) {
        fVehSheet.deleteRows(2, fVehSheet.getLastRow() - 1);
      }
      var fVehHeaders = ["id", "plate", "model", "fuelNorm", "status", "notes"];
      var fVehRows = [];
      for (var fv = 0; fv < fleetVehicles.length; fv++) {
        var v = fleetVehicles[fv];
        fVehRows.push([
          v.id || "",
          v.plate || "",
          v.model || "",
          Number(v.fuelNorm) || 0,
          v.status || "Hoạt động",
          v.notes || ""
        ]);
      }
      if (fVehRows.length > 0) {
        fVehSheet.getRange(2, 1, fVehRows.length, fVehHeaders.length).setValues(fVehRows);
      }
    }

    // 9. Đồng bộ Fleet Drivers
    if (fleetDrivers && Array.isArray(fleetDrivers)) {
      var fDrvSheet = ss.getSheetByName("fleetDrivers");
      if (fDrvSheet.getLastRow() >= 2) {
        fDrvSheet.deleteRows(2, fDrvSheet.getLastRow() - 1);
      }
      var fDrvHeaders = ["id", "name", "phone", "baseSalary", "notes", "allowance"];
      var fDrvRows = [];
      for (var fd = 0; fd < fleetDrivers.length; fd++) {
        var d = fleetDrivers[fd];
        fDrvRows.push([
          d.id || "",
          d.name || "",
          d.phone || "",
          Number(d.baseSalary) || 0,
          d.notes || "",
          Number(d.allowance) || 0
        ]);
      }
      if (fDrvRows.length > 0) {
        fDrvSheet.getRange(2, 1, fDrvRows.length, fDrvHeaders.length).setValues(fDrvRows);
      }
    }

    // 10. Đồng bộ Fleet Routes
    if (fleetRoutes && Array.isArray(fleetRoutes)) {
      var fRotSheet = ss.getSheetByName("fleetRoutes");
      if (fRotSheet.getLastRow() >= 2) {
        fRotSheet.deleteRows(2, fRotSheet.getLastRow() - 1);
      }
      var fRotHeaders = ["id", "name", "startPoint", "endPoint", "distance", "fuelNorm"];
      var fRotRows = [];
      for (var fr = 0; fr < fleetRoutes.length; fr++) {
        var r = fleetRoutes[fr];
        fRotRows.push([
          r.id || "",
          r.name || "",
          r.startPoint || "",
          r.endPoint || "",
          Number(r.distance) || 0,
          Number(r.fuelNorm) || 0
        ]);
      }
      if (fRotRows.length > 0) {
        fRotSheet.getRange(2, 1, fRotRows.length, fRotHeaders.length).setValues(fRotRows);
      }
    }

    // 11. Đồng bộ Fleet Trips
    if (fleetTrips && Array.isArray(fleetTrips)) {
      var fTrpSheet = ss.getSheetByName("fleetTrips");
      if (fTrpSheet.getLastRow() >= 2) {
        fTrpSheet.deleteRows(2, fTrpSheet.getLastRow() - 1);
      }
      var fTrpHeaders = ["id", "date", "driverId", "vehicleId", "routeId", "startPoint", "endPoint", "kmActual", "fuelActual", "fuelNorm", "allowance", "revenue", "expense", "salaryAdd", "salarySub", "notes", "invoice", "isVip"];
      var fTrpRows = [];
      for (var ft = 0; ft < fleetTrips.length; ft++) {
        var t = fleetTrips[ft];
        var rowValues = [];
        for (var c = 0; c < fTrpHeaders.length; c++) {
          var header = fTrpHeaders[c];
          var val = t[header];
          if (val === undefined || val === null) {
            rowValues.push("");
          } else if (["kmActual", "fuelActual", "fuelNorm", "allowance", "revenue", "expense", "salaryAdd", "salarySub"].includes(header)) {
            rowValues.push(Number(val) || 0);
          } else {
            rowValues.push(val);
          }
        }
        fTrpRows.push(rowValues);
      }
      if (fTrpRows.length > 0) {
        fTrpSheet.getRange(2, 1, fTrpRows.length, fTrpHeaders.length).setValues(fTrpRows);
      }
    }

    // 12. Đồng bộ System Settings
    if (systemSettings && Array.isArray(systemSettings)) {
      var setSheet = ss.getSheetByName("systemSettings");
      if (setSheet.getLastRow() >= 2) {
        setSheet.deleteRows(2, setSheet.getLastRow() - 1);
      }
      var setHeaders = ["key", "value", "desc"];
      var setRows = [];
      for (var s = 0; s < systemSettings.length; s++) {
        var setting = systemSettings[s];
        setRows.push([
          setting.key || "",
          String(setting.value || ""),
          setting.desc || ""
        ]);
      }
      if (setRows.length > 0) {
        setSheet.getRange(2, 1, setRows.length, setHeaders.length).setValues(setRows);
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// -------------------------------------------------------------
// ĐỒNG BỘ MỚI: TÀI KHOẢN & QUỸ (accounts)
// -------------------------------------------------------------
function saveAccount(ss, account) {
  var sheet = ss.getSheetByName("accounts");
  var headers = ["id", "name", "initialBalance", "desc"];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id' trong accounts!" };
  
  var rowValues = [
    account.id || "",
    account.name || "",
    Number(account.initialBalance) || 0,
    account.desc || ""
  ];
  
  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (data[r][idColIdx] === account.id) {
      targetRow = r + 1;
      break;
    }
  }
  
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return { success: true };
}

function deleteAccount(ss, name) {
  var sheet = ss.getSheetByName("accounts");
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][1] === name) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Tài khoản không tồn tại trên Cloud!" };
}

// -------------------------------------------------------------
// ĐỒNG BỘ MỚI: QUẢN LÝ ĐỘI XE (fleetVehicles)
// -------------------------------------------------------------
function saveFleetVehicle(ss, vehicle) {
  var sheet = ss.getSheetByName("fleetVehicles");
  var headers = ["id", "plate", "model", "fuelNorm", "status", "notes"];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id' trong fleetVehicles!" };
  
  var rowValues = [
    vehicle.id || "",
    vehicle.plate || "",
    vehicle.model || "",
    Number(vehicle.fuelNorm) || 0,
    vehicle.status || "Hoạt động",
    vehicle.notes || ""
  ];
  
  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (data[r][idColIdx] === vehicle.id) {
      targetRow = r + 1;
      break;
    }
  }
  
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return { success: true };
}

function deleteFleetVehicle(ss, id) {
  var sheet = ss.getSheetByName("fleetVehicles");
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === id) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Xe không tồn tại trên Cloud!" };
}

// -------------------------------------------------------------
// ĐỒNG BỘ MỚI: QUẢN LÝ LÁI XE (fleetDrivers)
// -------------------------------------------------------------
function saveFleetDriver(ss, driver) {
  var sheet = ss.getSheetByName("fleetDrivers");
  var headers = ["id", "name", "phone", "baseSalary", "notes"];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id' trong fleetDrivers!" };
  
  var rowValues = [
    driver.id || "",
    driver.name || "",
    driver.phone || "",
    Number(driver.baseSalary) || 0,
    driver.notes || ""
  ];
  
  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (data[r][idColIdx] === driver.id) {
      targetRow = r + 1;
      break;
    }
  }
  
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return { success: true };
}

function deleteFleetDriver(ss, id) {
  var sheet = ss.getSheetByName("fleetDrivers");
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === id) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Lái xe không tồn tại trên Cloud!" };
}

// -------------------------------------------------------------
// ĐỒNG BỘ MỚI: TUYẾN ĐƯỜNG (fleetRoutes)
// -------------------------------------------------------------
function saveFleetRoute(ss, route) {
  var sheet = ss.getSheetByName("fleetRoutes");
  var headers = ["id", "name", "startPoint", "endPoint", "distance", "fuelNorm"];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id' trong fleetRoutes!" };
  
  var rowValues = [
    route.id || "",
    route.name || "",
    route.startPoint || "",
    route.endPoint || "",
    Number(route.distance) || 0,
    Number(route.fuelNorm) || 0
  ];
  
  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (data[r][idColIdx] === route.id) {
      targetRow = r + 1;
      break;
    }
  }
  
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return { success: true };
}

function deleteFleetRoute(ss, id) {
  var sheet = ss.getSheetByName("fleetRoutes");
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === id) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Tuyến đường không tồn tại trên Cloud!" };
}

// -------------------------------------------------------------
// ĐỒNG BỘ MỚI: CHUYẾN ĐI (fleetTrips)
// -------------------------------------------------------------
function saveFleetTrip(ss, trip, fileData) {
  var sheet = ss.getSheetByName("fleetTrips");
  var headers = ["id", "date", "driverId", "vehicleId", "routeId", "startPoint", "endPoint", "kmActual", "fuelActual", "fuelNorm", "allowance", "revenue", "expense", "salaryAdd", "salarySub", "notes", "invoice"];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  var idColIdx = headers.indexOf("id");
  if (idColIdx === -1) return { success: false, error: "Không tìm thấy cột 'id' trong fleetTrips!" };
  
  var invoiceUrl = trip.invoice || "";
  var driveError = false;
  
  if (fileData && fileData.base64) {
    try {
      var folder = getOrCreateFolder("KeToan_HoaDon");
      var decoded = Utilities.base64Decode(fileData.base64);
      var blob = Utilities.newBlob(decoded, fileData.mimeType, fileData.name);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      invoiceUrl = file.getUrl();
      trip.invoice = invoiceUrl;
    } catch (e) {
      Logger.log("Lỗi tải Drive hóa đơn chuyến đi: " + e.toString());
      driveError = true;
    }
  }
  
  var rowValues = [];
  for (var c = 0; c < headers.length; c++) {
    var header = headers[c];
    var val = trip[header];
    if (val === undefined || val === null) {
      rowValues.push("");
    } else if (["kmActual", "fuelActual", "fuelNorm", "allowance", "revenue", "expense", "salaryAdd", "salarySub"].includes(header)) {
      rowValues.push(Number(val) || 0);
    } else {
      rowValues.push(val);
    }
  }
  
  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (data[r][idColIdx] === trip.id) {
      targetRow = r + 1;
      break;
    }
  }
  
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return { success: true, invoiceUrl: invoiceUrl, driveError: driveError };
}

function deleteFleetTrip(ss, id) {
  var sheet = ss.getSheetByName("fleetTrips");
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === id) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Chuyến đi không tồn tại trên Cloud!" };
}

function saveSystemSettings(ss, settings) {
  var sheet = ss.getSheetByName("systemSettings");
  var headers = ["key", "value", "desc"];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  
  for (var k in settings) {
    var found = false;
    for (var r = 1; r < data.length; r++) {
      if (data[r][0] === k) {
        sheet.getRange(r + 1, 2).setValue(String(settings[k]));
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([k, String(settings[k]), ""]);
    }
  }
  return { success: true };
}
