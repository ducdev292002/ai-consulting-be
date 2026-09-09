import { Router } from "express";
import multer from "multer";
import Script from "../models/Script.js";
import Company from "../models/Company.js";
import { extractTextFromFile } from "../services/extractText.js";
import { extractScriptsFromText } from "../services/scriptExtraction.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router = Router();

// Trả về kịch bản mặc định (companyId = null) GỘP với kịch bản riêng của công ty.
// Nếu không truyền companyId, chỉ trả về kịch bản mặc định (dùng cho màn quản lý mặc định chung).
router.get("/", async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const filter = companyId ? { $or: [{ companyId: null }, { companyId }] } : { companyId: null };
    const scripts = await Script.find(filter).sort({ stage: 1, createdAt: 1 });
    res.json(scripts);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    // companyId rỗng/không gửi => tạo kịch bản mặc định dùng chung cho mọi công ty
    const payload = { ...req.body, companyId: req.body.companyId || null };
    const script = await Script.create(payload);
    res.status(201).json(script);
  } catch (err) {
    next(err);
  }
});

// Tải file kịch bản (pdf/docx/txt/md...) → AI tách thành từng kịch bản có cấu trúc.
// KHÔNG lưu vào DB — chỉ trả về đề xuất để admin duyệt/sửa rồi mới lưu qua POST "/".
router.post("/extract", upload.single("file"), async (req, res, next) => {
  try {
    const { companyId } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!req.file) return res.status(400).json({ error: "Thiếu file để tải lên" });

    const text = await extractTextFromFile({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });
    if (!text) return res.status(400).json({ error: "Không trích xuất được nội dung văn bản từ file" });

    const [company, existing] = await Promise.all([
      Company.findById(companyId).lean(),
      Script.find({ $or: [{ companyId: null }, { companyId }] }).select("name").lean(),
    ]);

    const result = await extractScriptsFromText({
      text,
      company,
      existingScripts: existing.map((s) => s.name),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const script = await Script.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!script) return res.status(404).json({ error: "Không tìm thấy kịch bản" });
    res.json(script);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const script = await Script.findByIdAndDelete(req.params.id);
    if (!script) return res.status(404).json({ error: "Không tìm thấy kịch bản" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
