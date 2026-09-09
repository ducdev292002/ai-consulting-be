import ExcelJS from "exceljs";

// Nhiều nền tảng (VD xuất từ WooCommerce) cho ra file Excel có SẴN cột rõ ràng cho tên,
// giá, danh mục... Khi nhận diện được đúng các cột này, đọc trực tiếp theo cột sẽ CHÍNH XÁC
// TUYỆT ĐỐI (không qua AI, không có rủi ro cắt cụt văn bản dài hay AI suy đoán/bịa số liệu).
// Chỉ khi KHÔNG nhận diện được cấu trúc cột quen thuộc mới rơi về nhánh AI đọc văn bản tự do.
const HEADER_ALIASES = {
  name: ["tên sản phẩm", "tên", "name", "product name"],
  sku: ["sku", "mã sản phẩm", "mã sku"],
  price: ["giá niêm yết", "giá gốc", "giá", "price", "regular price"],
  priceAfterDiscount: ["giá khuyến mãi", "giá sale", "sale price"],
  category: ["danh mục", "category", "ngành hàng"],
  stock: ["số lượng tồn", "tồn kho", "stock", "số lượng"],
  imageUrl: ["ảnh đại diện", "hình ảnh", "image", "ảnh"],
  sourceUrl: ["link sản phẩm", "link", "url", "product url"],
  shortDesc: ["mô tả ngắn", "short description"],
  fullDesc: ["mô tả đầy đủ", "mô tả", "description", "mô tả chi tiết"],
  size: ["kích thước (dxrxc)", "kích thước", "size", "dimensions"],
  weight: ["cân nặng", "trọng lượng", "weight"],
};

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase();
}

// ExcelJS trả giá trị ô KHÔNG phải lúc nào cũng là string thuần — ô có hyperlink (thường gặp ở
// cột ảnh/link sản phẩm) trả về { text, hyperlink }, ô rich text trả về { richText: [...] },
// ô công thức trả về { formula, result }. Nếu chỉ String(v) trực tiếp sẽ ra "[object Object]"
// (ảnh/link không hiển thị được) — nên phải bóc tách đúng định dạng trước.
function cellToText(v, { preferHyperlink = false } = {}) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (preferHyperlink && v.hyperlink) return String(v.hyperlink).trim();
    if (v.text != null) return String(v.text).trim();
    if (v.richText) return v.richText.map((r) => r.text).join("").trim();
    if (v.hyperlink) return String(v.hyperlink).trim();
    if (v.result != null) return String(v.result).trim();
    if (v instanceof Date) return v.toISOString();
    return "";
  }
  return String(v).trim();
}

const URL_FIELDS = new Set(["imageUrl", "sourceUrl"]);

function detectColumnMap(headerRow) {
  const map = {};
  headerRow.forEach((cell, idx) => {
    const norm = normalizeHeader(cell);
    if (!norm) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm) && map[field] === undefined) {
        map[field] = idx;
      }
    }
  });
  return map;
}

// Nhiều file export có cột kỹ thuật để giá trị "rác" (VD "xx", "x", "-", "n/a") khi không có
// dữ liệu thật thay vì để trống — coi các giá trị này là RỖNG để không đè lên thông tin hữu
// ích hơn (VD lấy được từ mô tả) hoặc hiện ra như dữ liệu thật gây hiểu nhầm.
const JUNK_VALUES = new Set(["xx", "x", "-", "--", "n/a", "na", "chưa có", "không có", "không rõ"]);
function meaningful(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  return JUNK_VALUES.has(v.toLowerCase()) ? "" : v;
}

function parseNumber(value) {
  if (value == null || value === "") return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

// Nhiều mô tả ngắn có dạng dòng "Nhãn: Giá trị" (Chất liệu, Màu sắc, Bảo hành...) —
// tách trực tiếp thay vì để AI đọc lại và có nguy cơ diễn giải sai.
function parseLabeledLines(text) {
  const result = {};
  if (!text) return result;
  const lines = String(text).split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*([^:]{2,30}):\s*(.+)$/);
    if (match) {
      const label = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (!result[label]) result[label] = value;
    }
  }
  return result;
}

export async function parseProductsExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;

  const headerRow = sheet.getRow(1).values.slice(1).map((v) => cellToText(v));
  const columnMap = detectColumnMap(headerRow);

  // Bắt buộc phải nhận diện được ít nhất cột tên sản phẩm — nếu không thì đây không phải
  // định dạng bảng sản phẩm quen thuộc, để nhánh AI xử lý như văn bản tự do.
  if (columnMap.name === undefined) return null;

  const getCell = (rowValues, field) => {
    const idx = columnMap[field];
    if (idx === undefined) return "";
    return cellToText(rowValues[idx], { preferHyperlink: URL_FIELDS.has(field) });
  };

  const products = [];
  const skipped = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values.slice(1).map((v) => (v == null ? "" : v));

    const name = getCell(values, "name");
    if (!name) {
      const rawExcerpt = values.map((v) => cellToText(v)).join(" | ").slice(0, 200);
      if (rawExcerpt.trim()) skipped.push({ excerpt: rawExcerpt, reason: "Không có tên sản phẩm" });
      return;
    }

    const shortDesc = getCell(values, "shortDesc");
    const fullDesc = getCell(values, "fullDesc");
    const labeled = parseLabeledLines(shortDesc) || {};

    const specParts = [];
    const weight = getCell(values, "weight");
    if (weight) specParts.push(`Cân nặng: ${weight}`);
    if (labeled["bảo hành"]) specParts.push(`Bảo hành: ${labeled["bảo hành"]}`);
    if (labeled["màu sắc"]) specParts.push(`Màu sắc: ${labeled["màu sắc"]}`);
    if (labeled["nhà sản xuất"]) specParts.push(`Nhà sản xuất: ${labeled["nhà sản xuất"]}`);
    if (labeled["số lượng"]) specParts.push(`Số lượng: ${labeled["số lượng"]}`);
    if (labeled["tình trạng hàng"]) specParts.push(`Tình trạng hàng: ${labeled["tình trạng hàng"]}`);

    products.push({
      name,
      category: getCell(values, "category"),
      sku: getCell(values, "sku"),
      price: parseNumber(getCell(values, "price")),
      priceAfterDiscount: getCell(values, "priceAfterDiscount") ? parseNumber(getCell(values, "priceAfterDiscount")) : null,
      size: meaningful(getCell(values, "size")) || labeled["kích thước"] || "",
      material: labeled["chất liệu"] || "",
      specs: specParts.join("\n"),
      bestFor: [],
      notFor: [],
      usp: [],
      stock: parseNumber(getCell(values, "stock")),
      imageUrl: getCell(values, "imageUrl"),
      sourceUrl: getCell(values, "sourceUrl"),
      description: fullDesc || shortDesc,
    });
  });

  return { products, skipped };
}
