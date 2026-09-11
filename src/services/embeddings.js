import KnowledgeChunk from "../models/KnowledgeChunk.js";
import { getOpenAIClient } from "./openaiClient.js";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

export function chunkText(text) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= CHUNK_SIZE) return [clean];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);

    if (end < clean.length) {
      // Ưu tiên cắt tại ranh giới ĐOẠN VĂN (\n\n), rồi tới CUỐI CÂU (. ! ?), rồi mới tới
      // xuống dòng đơn — tránh cắt ngang giữa 1 câu/1 ý làm giảm chất lượng tra cứu sau này
      // (bản cũ chỉ cắt theo dòng đơn, dễ đứt giữa câu dài).
      const searchZoneStart = start + CHUNK_SIZE / 2;
      const paraBreak = clean.lastIndexOf("\n\n", end);

      let sentenceBreak = -1;
      const zone = clean.slice(searchZoneStart, end);
      const sentenceEnds = [...zone.matchAll(/[.!?]\s/g)];
      if (sentenceEnds.length > 0) {
        const last = sentenceEnds[sentenceEnds.length - 1];
        sentenceBreak = searchZoneStart + last.index + 1;
      }

      const lineBreak = clean.lastIndexOf("\n", end);

      if (paraBreak > searchZoneStart) end = paraBreak;
      else if (sentenceBreak > searchZoneStart) end = sentenceBreak;
      else if (lineBreak > searchZoneStart) end = lineBreak;
    }

    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter(Boolean);
}

export async function embedTexts(texts) {
  const openai = getOpenAIClient();
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function indexDocument({ doc }) {
  await KnowledgeChunk.deleteMany({ docId: doc._id });

  const pieces = chunkText(doc.content);
  if (pieces.length === 0) return 0;

  const vectors = await embedTexts(pieces);

  await KnowledgeChunk.insertMany(
    pieces.map((text, i) => ({
      companyId: doc.companyId,
      docId: doc._id,
      productId: doc.productId || null,
      docTitle: doc.title,
      source: doc.source,
      text,
      embedding: vectors[i],
    }))
  );

  return pieces.length;
}

// Query ngắn/viết tắt (VD "crm") thường cho điểm cosine không đáng tin cậy — đoạn
// đúng chứa nguyên văn từ khoá có thể xếp hạng thấp hơn đoạn chỉ "gần nghĩa" chung
// chung. Cộng thêm điểm cho đoạn nào chứa nguyên văn các từ trong query để bù lại.
const KEYWORD_BOOST_WEIGHT = 0.25;

function keywordOverlapRatio(query, text) {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return 0;

  const lowerText = text.toLowerCase();
  const matched = tokens.filter((t) => lowerText.includes(t)).length;
  return matched / tokens.length;
}

function normalizeForDedup(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Các đoạn tri thức liền kề của cùng 1 tài liệu bị chồng lấn CHUNK_OVERLAP ký tự — khi cả 2 đoạn
// cùng khớp query, kết quả trả về dễ có 2 đoạn gần như trùng nội dung, tốn chỗ và khiến AI đọc
// lặp thông tin. Chỉ giữ đoạn điểm cao hơn nếu 2 đoạn có tỉ lệ từ trùng nhau quá cao.
function dedupePassages(sortedResults, limit) {
  const kept = [];
  const seenWordSets = [];
  for (const item of sortedResults) {
    const words = new Set(
      normalizeForDedup(item.text)
        .split(/\W+/)
        .filter((w) => w.length > 2)
    );
    const isDuplicate = seenWordSets.some((prev) => {
      const overlap = [...words].filter((w) => prev.has(w)).length;
      const smaller = Math.min(words.size, prev.size) || 1;
      return overlap / smaller > 0.75;
    });
    if (!isDuplicate) {
      kept.push(item);
      seenWordSets.push(words);
      if (kept.length >= limit) break;
    }
  }
  return kept;
}

export async function searchKnowledge({ companyId, query, productId, limit = 5 }) {
  const filter = { companyId };
  if (productId) filter.productId = productId;

  const chunks = await KnowledgeChunk.find(filter).lean();
  if (chunks.length === 0) return [];

  const [queryVector] = await embedTexts([query]);

  const sorted = chunks
    .map((c) => {
      const semanticScore = cosineSimilarity(queryVector, c.embedding);
      const keywordScore = keywordOverlapRatio(query, c.text);
      return {
        docTitle: c.docTitle,
        source: c.source,
        text: c.text,
        score: semanticScore + KEYWORD_BOOST_WEIGHT * keywordScore,
      };
    })
    .sort((a, b) => b.score - a.score);

  return dedupePassages(sorted, limit);
}
