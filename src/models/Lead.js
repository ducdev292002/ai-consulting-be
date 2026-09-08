import mongoose from "mongoose";

export const LEAD_STAGES = ["discovery", "advising", "objection", "closing", "won", "lost"];

const leadSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    customerKey: { type: String, required: true, trim: true },
    needType: { type: String, default: "" },
    budget: { type: String, default: "" },
    spaceInfo: { type: String, default: "" },
    concerns: { type: [String], default: [] },
    phone: { type: String, default: "" },
    area: { type: String, default: "" },
    stage: { type: String, enum: LEAD_STAGES, default: "discovery" },
  },
  { timestamps: true }
);

leadSchema.index({ companyId: 1, customerKey: 1 }, { unique: true });

export default mongoose.model("Lead", leadSchema);
