import { Router } from "express";
import multer from "multer";
import Script from "../models/Script.js";
import Company from "../models/Company.js";
import { extractTextFromFile } from "../services/extractText.js";
import { extractScriptsFromText } from "../services/scriptExtraction.js";
import { startProgressStream } from "../services/streamProgress.js";
import { DEFAULT_SCRIPTS } from "../data/defaultScripts.js";

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

    const stream = startProgressStream(res);
    try {
      const result = await extractScriptsFromText({
        text,
        company,
        existingScripts: existing.map((s) => s.name),
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

// Áp dụng bộ kịch bản gợi ý sẵn làm kịch bản RIÊNG cho 1 công ty cụ thể (companyId của công ty đó,
// KHÔNG phải companyId: null) — dùng khi công ty mới chưa có kịch bản nào để AI chạy được luôn.
// Chỉ tạo những kịch bản (stage + name) công ty đó CHƯA có (kể cả đã có sẵn từ bộ mặc định chung),
// để bấm nhiều lần không bị trùng.
router.post("/apply-defaults", async (req, res, next) => {
  try {
    const { companyId } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });

    const existing = await Script.find({ $or: [{ companyId: null }, { companyId }] })
      .select("stage name")
      .lean();
    const existingKeys = new Set(existing.map((s) => `${s.stage}::${s.name}`));

    const toCreate = DEFAULT_SCRIPTS.filter((s) => !existingKeys.has(`${s.stage}::${s.name}`));
    if (toCreate.length > 0) {
      await Script.insertMany(toCreate.map((s) => ({ ...s, companyId })));
    }

    res.json({ created: toCreate.length, skipped: DEFAULT_SCRIPTS.length - toCreate.length });
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
