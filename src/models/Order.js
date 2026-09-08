import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    name: { type: String, required: true },
    qty: { type: Number, default: 1 },
    price: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    customerKey: { type: String, required: true, trim: true },
    items: { type: [orderItemSchema], default: [] },
    total: { type: Number, default: 0 },
    deliveryArea: { type: String, default: "" },
    note: { type: String, default: "" },
    status: { type: String, enum: ["draft", "confirmed"], default: "draft" },
  },
  { timestamps: true }
);

export default mongoose.model("Order", orderSchema);
