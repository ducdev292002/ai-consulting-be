import { Router } from "express";
import multer from "multer";
import Product from "../models/Product.js";
import Company from "../models/Company.js";
import { crudRouter } from "./crudFactory.js";
import { extractTextFromFile } from "../services/extractText.js";
import { extractProductsFromText } from "../services/productExtraction.js";
import { parseProductsExcel } from "../services/productExcelParser.js";
import { startProgressStream } from "../services/streamProgress.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router = Router();

// Tải file (bảng giá Excel/CSV, catalogue PDF/DOCX...) → AI tách thành từng sản phẩm có
// cấu trúc. KHÔNG lưu vào DB — chỉ trả về đề xuất để admin duyệt/sửa rồi mới lưu qua
// POST "/" (endpoint CRUD sản phẩm bình thường bên dưới).
router.post("/extract", upload.single("file"), async (req, res, next) => {
  try {
    const { companyId } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!req.file) return res.status(400).json({ error: "Thiếu file để tải lên" });

    const ext = req.file.originalname.split(".").pop().toLowerCase();
    const isExcel =
      ext === "xlsx" ||
      ext === "xls" ||
      req.file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      req.file.mimetype === "application/vnd.ms-excel";

    // File Excel có cột rõ ràng (VD export từ WooCommerce: Tên sản phẩm, Giá niêm yết, Danh mục...)
    // đọc TRỰC TIẾP theo cột — chính xác tuyệt đối, không qua AI nên không có rủi ro cắt cụt
    // hay suy đoán sai giá/thông số. Chỉ khi không nhận diện được cấu trúc cột mới rơi về AI.
    if (isExcel) {
      const structured = await parseProductsExcel(req.file.buffer);
      if (structured) {
        return res.json(structured);
      }
    }

    const text = await extractTextFromFile({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });
    if (!text) return res.status(400).json({ error: "Không trích xuất được nội dung văn bản từ file" });

    const [company, existing] = await Promise.all([
      Company.findById(companyId).lean(),
      Product.find({ companyId }).select("name").lean(),
    ]);

    const stream = startProgressStream(res);
    try {
      const result = await extractProductsFromText({
        text,
        company,
        existingProducts: existing.map((p) => p.name),
        onProgress: (p) => stream.progress(p),
      });
      stream.done(result);
    } catch (err) {
      stream.error(err.message);
    }
  } catch (err) {
    next(err);
  }
});

router.use("/", crudRouter(Product, { companyScoped: true }));

export default router;
