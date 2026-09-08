import mongoose from "mongoose";

const competitorPriceSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    competitorName: { type: String, required: true, trim: true },
    productName: { type: String, required: true, trim: true },
    price: { type: Number, default: 0 },
    source: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("CompetitorPrice", competitorPriceSchema);
