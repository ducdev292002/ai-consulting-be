import { Router } from "express";
import multer from "multer";
import Company from "../models/Company.js";
import KnowledgeDoc, { DOC_SOURCES } from "../models/KnowledgeDoc.js";
import KnowledgeChunk from "../models/KnowledgeChunk.js";
import { extractTextFromFile } from "../services/extractText.js";
import { fetchUrlAsText } from "../services/fetchUrl.js";
import { crawlWebsite } from "../services/crawlSite.js";
import { cleanKnowledgeContent } from "../services/contentCleaning.js";
import { indexDocument } from "../services/embeddings.js";
import { startProgressStream } from "../services/streamProgress.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router = Router();

const normalizeSource = (value) => (DOC_SOURCES.includes(value) ? value : "company");

async function createAndIndex({ companyId, productId, source, title, content, sourceUrl }) {
  const doc = await KnowledgeDoc.create({
    companyId,
    productId: productId || null,
    source: normalizeSource(source),
    title,
    content,
    sourceUrl: sourceUrl || "",
  });

  let chunkCount = 0;
  let indexError = null;
  try {
    chunkCount = await indexDocument({ doc });
    doc.chunkCount = chunkCount;
    await doc.save();
  } catch (err) {
    indexError = err.message;
  }

  return { doc: doc.toObject(), chunkCount, indexError };
}

router.get("/", async (req, res, next) => {
  try {
    if (!req.query.companyId) return res.status(400).json({ error: "Thiếu companyId" });
    const filter = { companyId: req.query.companyId };
    if (req.query.productId) filter.productId = req.query.productId;
    const docs = await KnowledgeDoc.find(filter).sort({ createdAt: 1 });
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

// Tạo trực tiếp — dùng cho nhập tay (đã tin tưởng, không cần AI làm sạch)
// VÀ dùng để LƯU một đề xuất đã được duyệt từ /upload, /from-url, /crawl.
router.post("/", async (req, res, next) => {
  try {
    const { companyId, productId, source, title, content, sourceUrl } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: "Thiếu tiêu đề hoặc nội dung" });
    }

    const result = await createAndIndex({ companyId, productId, source, title, content, sourceUrl });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// Tải file → trích text → AI LÀM SẠCH (lọc rác, đề xuất tiêu đề/loại) → trả về ĐỀ XUẤT, CHƯA LƯU.
// Frontend cho người dùng xem/sửa rồi mới gọi POST "/" để lưu thật.
router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.body.companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!req.file) return res.status(400).json({ error: "Thiếu file để tải lên" });

    const rawText = await extractTextFromFile({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });
    if (!rawText) {
      return res.status(400).json({ error: "Không trích xuất được nội dung văn bản từ file" });
    }

    const company = await Company.findById(req.body.companyId).lean();
    const suggestedTitle = req.body.title?.trim() || req.file.originalname.replace(/\.[^.]+$/, "");

    const stream = startProgressStream(res);
    try {
      const cleaned = await cleanKnowledgeContent({
        rawText,
        suggestedTitle,
        company,
        onProgress: (p) => stream.progress(p),
      });

      stream.done({
        proposal: {
          title: cleaned.title || suggestedTitle,
          category: req.body.source && DOC_SOURCES.includes(req.body.source) ? req.body.source : cleaned.category,
          content: cleaned.content,
          sourceUrl: "",
          productId: req.body.productId || null,
          useful: cleaned.useful,
          skipReason: cleaned.skipReason,
        },
      });
    } catch (err) {
      stream.error(err.message);
    }
  } catch (err) {
    next(err);
  }
});

// Lấy nội dung 1 URL → AI làm sạch → trả về ĐỀ XUẤT, CHƯA LƯU.
router.post("/from-url", async (req, res, next) => {
  try {
    const { companyId, productId, url, source, title } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!url?.trim()) return res.status(400).json({ error: "Thiếu URL" });

    const fetched = await fetchUrlAsText(url.trim());
    const company = await Company.findById(companyId).lean();
    const cleaned = await cleanKnowledgeContent({
      rawText: fetched.text,
      suggestedTitle: title?.trim() || fetched.title,
      sourceUrl: url.trim(),
      company,
    });

    const existing = await KnowledgeDoc.findOne({ companyId, sourceUrl: url.trim() }).select("_id").lean();

    res.json({
      proposal: {
        title: cleaned.title || fetched.title,
        category: source && DOC_SOURCES.includes(source) ? source : cleaned.category,
        content: cleaned.content,
        sourceUrl: url.trim(),
        productId: productId || null,
        useful: cleaned.useful,
        skipReason: cleaned.skipReason,
        existingDocId: existing?._id || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Quét 1 website: tìm các trang cùng domain, tải + trích nội dung (đã lọc boilerplate lặp
// giữa các trang), rồi AI LÀM SẠCH từng trang. Trả về danh sách ĐỀ XUẤT, CHƯA LƯU gì cả —
// người dùng chọn/sửa rồi mới lưu, tránh lưu tràn lan thông tin không liên quan.
router.post("/crawl", async (req, res, next) => {
  try {
    const { companyId, startUrl, maxPages } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!startUrl?.trim()) return res.status(400).json({ error: "Thiếu startUrl" });

    const [{ pages, errors, totalDiscovered }, company] = await Promise.all([
      crawlWebsite({ startUrl: startUrl.trim(), maxPages: Number(maxPages) || 15 }),
      Company.findById(companyId).lean(),
    ]);

    const stream = startProgressStream(res);
    try {
      const proposals = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        try {
          const cleaned = await cleanKnowledgeContent({
            rawText: page.text,
            suggestedTitle: page.title,
            sourceUrl: page.url,
            company,
          });
          const existing = await KnowledgeDoc.findOne({ companyId, sourceUrl: page.url }).select("_id").lean();

          proposals.push({
            url: page.url,
            title: cleaned.title || page.title,
            category: cleaned.category,
            content: cleaned.content,
            useful: cleaned.useful,
            skipReason: cleaned.skipReason,
            existingDocId: existing?._id || null,
          });
        } catch (err) {
          errors.push({ url: page.url, error: `Lỗi làm sạch: ${err.message}` });
        }
        stream.progress({ done: i + 1, total: pages.length });
      }

      stream.done({ totalDiscovered, pagesFetched: pages.length, proposals, errors });
    } catch (err) {
      stream.error(err.message);
    }
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reindex", async (req, res, next) => {
  try {
    const doc = await KnowledgeDoc.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Không tìm thấy tài liệu" });

    const chunkCount = await indexDocument({ doc });
    doc.chunkCount = chunkCount;
    await doc.save();

    res.json({ doc: doc.toObject(), chunkCount });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const doc = await KnowledgeDoc.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ error: "Không tìm thấy tài liệu" });

    let chunkCount = doc.chunkCount;
    let indexError = null;
    if (req.body.content !== undefined) {
      try {
        chunkCount = await indexDocument({ doc });
        doc.chunkCount = chunkCount;
        await doc.save();
      } catch (err) {
        indexError = err.message;
      }
    }

    res.json({ doc: doc.toObject(), chunkCount, indexError });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const doc = await KnowledgeDoc.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: "Không tìm thấy tài liệu" });
    await KnowledgeChunk.deleteMany({ docId: doc._id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
