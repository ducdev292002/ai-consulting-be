import { Router } from "express";
import multer from "multer";
import KnowledgeDoc, { DOC_SOURCES } from "../models/KnowledgeDoc.js";
import KnowledgeChunk from "../models/KnowledgeChunk.js";
import { extractTextFromFile } from "../services/extractText.js";
import { fetchUrlAsText } from "../services/fetchUrl.js";
import { indexDocument } from "../services/embeddings.js";

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

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.body.companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!req.file) return res.status(400).json({ error: "Thiếu file để tải lên" });

    const content = await extractTextFromFile({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });

    if (!content) {
      return res.status(400).json({ error: "Không trích xuất được nội dung văn bản từ file" });
    }

    const result = await createAndIndex({
      companyId: req.body.companyId,
      productId: req.body.productId,
      source: req.body.source,
      title: req.body.title?.trim() || req.file.originalname.replace(/\.[^.]+$/, ""),
      content,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/from-url", async (req, res, next) => {
  try {
    const { companyId, productId, url, source, title } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!url?.trim()) return res.status(400).json({ error: "Thiếu URL" });

    const fetched = await fetchUrlAsText(url.trim());

    const result = await createAndIndex({
      companyId,
      productId,
      source: source || "web",
      title: title?.trim() || fetched.title,
      content: fetched.text,
      sourceUrl: url.trim(),
    });

    res.status(201).json(result);
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
