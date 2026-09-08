import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    website: { type: String, default: "" },
    intro: { type: String, default: "" },
    usp: { type: [String], default: [] },
    brandVoice: { type: String, default: "Thân thiện, chuyên nghiệp" },
  },
  { timestamps: true }
);

export default mongoose.model("Company", companySchema);
