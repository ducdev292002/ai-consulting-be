import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

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

  if (ext === "txt" || ext === "md" || mimetype?.startsWith("text/")) {
    return buffer.toString("utf-8").trim();
  }

  throw Object.assign(new Error(`Định dạng file .${ext} chưa được hỗ trợ (chỉ hỗ trợ pdf, docx, txt, md)`), {
    status: 400,
  });
}
