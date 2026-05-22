// GOOGLE APPS SCRIPT: HỆ THỐNG KẾ TOÁN NỘI BỘ PREMIUM
// Cập nhật: Hỗ trợ kiểm soát soát xét (auditStatus, auditNote), tự động nâng cấp cấu trúc cột CSDL online

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    initDatabase(ss);
    
    var data = {
      entries: getSheetData(ss.getSheetByName("entries")),
      users: getSheetData(ss.getSheetByName("users")),
      categories: getCategoriesData(ss.getSheetByName("categories"))
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
      result = restoreAll(ss, payload.entries, payload.users, payload.categories);
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
  // 1. Tạo hoặc kiểm tra sheet 'entries'
  var entriesSheet = ss.getSheetByName("entries");
  var entriesHeaders = ["id", "type", "date", "category", "amount", "reason", "createdBy", "createdAt", "invoice", "auditStatus", "auditNote", "stt"];
  if (!entriesSheet) {
    entriesSheet = ss.insertSheet("entries");
    entriesSheet.appendRow(entriesHeaders);
    // Format hàng tiêu đề
    entriesSheet.getRange(1, 1, 1, entriesHeaders.length).setFontWeight("bold").setBackground("#d9ead3");
  } else {
    // Tự động nâng cấp cột nếu thiếu cột kiểm soát (auditStatus, auditNote)
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
      if (header === "amount" || header === "stt") {
        obj[header] = Number(val) || 0;
      } else if (val instanceof Date) {
        if (header === "date" || header === "dueDate") {
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
  var invoiceColIdx = headers.indexOf("invoice");
  
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
    } else if (header === "amount") {
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
        // Cần duyệt ngược để tránh lệch chỉ số khi xoá hàng
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
function restoreAll(ss, entries, users, categories) {
  try {
    // 1. Đồng bộ Entries (Nhật Ký Chung)
    if (entries && Array.isArray(entries)) {
      var sheet = ss.getSheetByName("entries");
      if (sheet.getLastRow() >= 2) {
        sheet.deleteRows(2, sheet.getLastRow() - 1);
      }
      var headers = ["id", "type", "date", "category", "amount", "reason", "createdBy", "createdAt", "invoice", "auditStatus", "auditNote", "stt"];
      
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
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
