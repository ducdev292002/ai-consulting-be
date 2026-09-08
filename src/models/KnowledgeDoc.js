import mongoose from "mongoose";

export const DOC_SOURCES = ["product", "company", "web", "policy", "industry"];

const knowledgeDocSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null, index: true },
    source: { type: String, enum: DOC_SOURCES, default: "company" },
    title: { type: String, required: true, trim: true },
    sourceUrl: { type: String, default: "" },
    content: { type: String, required: true },
    chunkCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("KnowledgeDoc", knowledgeDocSchema);
