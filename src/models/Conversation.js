import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    toolCalls: { type: [String], default: [] },
    images: {
      type: [
        {
          url: { type: String, required: true },
          name: { type: String, default: "" },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true, _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    customerKey: { type: String, required: true, trim: true },
    messages: { type: [messageSchema], default: [] },
    // Ghi nhớ kết quả searchProducts gần nhất qua NHIỀU lượt chat (không chỉ lượt hiện tại) —
    // dùng làm nguồn dự phòng khi khách hỏi xem ảnh ở 1 lượt sau đó mà AI không gọi lại
    // searchProducts (chỉ trả lời dựa vào ngữ cảnh cũ, không có productId mới để dùng).
    lastProductContext: {
      type: [
        {
          productId: { type: String, required: true },
          name: { type: String, default: "" },
          hasImage: { type: Boolean, default: false },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

conversationSchema.index({ companyId: 1, customerKey: 1 }, { unique: true });

export default mongoose.model("Conversation", conversationSchema);
