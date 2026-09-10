import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "staff"], required: true },
    // Tên nhân viên đã gửi tin (chỉ có ý nghĩa khi role = "staff").
    staffName: { type: String, default: "" },
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
    // "ai": AI tự động trả lời (mặc định). "human": nhân viên đã tiếp nhận, AI tạm dừng trả lời
    // tự động cho tới khi được chuyển lại — nhân viên gửi tin nhắn qua route riêng (role "staff").
    mode: { type: String, enum: ["ai", "human"], default: "ai" },
    messages: { type: [messageSchema], default: [] },
    // Bản tóm tắt hội thoại do AI tạo (theo yêu cầu, không tự động) — kèm số tin nhắn tại thời
    // điểm tóm tắt để nhận biết đã "cũ" (có tin nhắn mới sau đó) hay chưa, tránh gọi AI thừa.
    summary: { type: String, default: "" },
    summaryUpdatedAt: { type: Date, default: null },
    summaryMessageCount: { type: Number, default: 0 },
    // Gợi ý trả lời (nhân viên) do AI soạn — cache theo số tin nhắn tại thời điểm soạn, để mở lại
    // hội thoại hoặc bật/tắt mode không gọi lại AI vô ích nếu khách chưa nhắn gì thêm.
    suggestion: { type: String, default: "" },
    suggestionMessageCount: { type: Number, default: 0 },
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
