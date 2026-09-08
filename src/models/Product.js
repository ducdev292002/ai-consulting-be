import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    category: { type: String, default: "", trim: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: "" },
    price: { type: Number, default: 0 },
    priceAfterDiscount: { type: Number, default: null },
    size: { type: String, default: "" },
    material: { type: String, default: "" },
    specs: { type: String, default: "" },
    bestFor: { type: [String], default: [] },
    notFor: { type: [String], default: [] },
    usp: { type: [String], default: [] },
    stock: { type: Number, default: 0 },
    imageUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Product", productSchema);
