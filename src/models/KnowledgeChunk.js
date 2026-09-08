import mongoose from "mongoose";

const knowledgeChunkSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    docId: { type: mongoose.Schema.Types.ObjectId, ref: "KnowledgeDoc", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    docTitle: { type: String, default: "" },
    source: { type: String, default: "company" },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("KnowledgeChunk", knowledgeChunkSchema);
