import mongoose from "mongoose";
import { LEAD_STAGES } from "./Lead.js";

const scriptSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    stage: { type: String, enum: LEAD_STAGES, default: "discovery" },
    name: { type: String, required: true, trim: true },
    situation: { type: String, default: "" },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("Script", scriptSchema);
