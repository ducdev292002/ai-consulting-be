import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import ExcelJS from "exceljs";

async function extractXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets = [];
  workbook.eachSheet((sheet) => {
    const rows = [];
    sheet.eachRow((row) => {
      const cells = row.values.slice(1).map((v) => (v == null ? "" : String(v).trim()));
      if (cells.some(Boolean)) rows.push(cells.join(" | "));
    });
    if (rows.length > 0) sheets.push(`# ${sheet.name}\n${rows.join("\n")}`);
  });

  return sheets.join("\n\n");
}

export async function extractTextFromFile({ buffer, mimetype, originalname }) {
  const ext = originalname.split(".").pop().toLowerCase();

  if (mimetype === "application/pdf" || ext === "pdf") {
    const result = await pdfParse(buffer);
    return result.text.trim();
  }

  if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  if (
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel" ||
    ext === "xlsx" ||
    ext === "xls"
  ) {
    return (await extractXlsx(buffer)).trim();
  }

  if (ext === "csv" || mimetype === "text/csv") {
    return buffer.toString("utf-8").trim();
  }

  if (ext === "txt" || ext === "md" || mimetype?.startsWith("text/")) {
    return buffer.toString("utf-8").trim();
  }

  throw Object.assign(
    new Error(`Định dạng file .${ext} chưa được hỗ trợ (chỉ hỗ trợ pdf, docx, xlsx, csv, txt, md)`),
    { status: 400 }
  );
}
