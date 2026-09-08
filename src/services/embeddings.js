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
      const breakPoint = clean.lastIndexOf("\n", end);
      if (breakPoint > start + CHUNK_SIZE / 2) end = breakPoint;
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

export async function searchKnowledge({ companyId, query, productId, limit = 5 }) {
  const filter = { companyId };
  if (productId) filter.productId = productId;

  const chunks = await KnowledgeChunk.find(filter).lean();
  if (chunks.length === 0) return [];

  const [queryVector] = await embedTexts([query]);

  return chunks
    .map((c) => ({
      docTitle: c.docTitle,
      source: c.source,
      text: c.text,
      score: cosineSimilarity(queryVector, c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
