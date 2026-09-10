import { Router } from "express";
import Conversation from "../models/Conversation.js";
import Lead from "../models/Lead.js";
import { getOpenAIClient } from "../services/openaiClient.js";

const router = Router();

const ROLE_LABELS = { user: "Khách", assistant: "AI", staff: "Nhân viên" };

function extractText(response) {
  if (response.output_text) return response.output_text.trim();
  const messageItem = response.output?.find((item) => item.type === "message");
  const textPart = messageItem?.content?.find((part) => part.type === "output_text");
  return textPart?.text?.trim() || "";
}

router.get("/list", async (req, res, next) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });

    const [conversations, leads] = await Promise.all([
      Conversation.find({ companyId }).sort({ updatedAt: -1 }).lean(),
      Lead.find({ companyId }).lean(),
    ]);

    const leadByKey = new Map(leads.map((l) => [l.customerKey, l]));

    const summaries = conversations.map((c) => {
      const last = c.messages[c.messages.length - 1];
      return {
        customerKey: c.customerKey,
        messageCount: c.messages.length,
        lastMessage: last ? last.content : "",
        lastMessageRole: last ? last.role : null,
        lastMessageAt: last ? last.createdAt : c.updatedAt,
        stage: leadByKey.get(c.customerKey)?.stage || null,
        mode: c.mode || "ai",
      };
    });

    res.json(summaries);
  } catch (err) {
    next(err);
  }
});

// Nhân viên tiếp nhận ("human") hoặc trả lại cho AI ("ai") một hội thoại.
router.patch("/mode", async (req, res, next) => {
  try {
    const { companyId, customerKey, mode } = req.body;
    if (!companyId || !customerKey?.trim()) {
      return res.status(400).json({ error: "Thiếu companyId hoặc customerKey" });
    }
    if (!["ai", "human"].includes(mode)) {
      return res.status(400).json({ error: "mode không hợp lệ (chỉ nhận 'ai' hoặc 'human')" });
    }

    const key = customerKey.trim();
    const conversation = await Conversation.findOneAndUpdate(
      { companyId, customerKey: key },
      { $setOnInsert: { companyId, customerKey: key }, $set: { mode } },
      { new: true, upsert: true }
    );

    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

// Nhân viên gửi tin nhắn trực tiếp cho khách (không qua AI) — dùng khi hội thoại đang ở mode "human".
router.post("/staff-message", async (req, res, next) => {
  try {
    const { companyId, customerKey, message, staffName } = req.body;
    if (!companyId || !customerKey?.trim()) {
      return res.status(400).json({ error: "Thiếu companyId hoặc customerKey" });
    }
    if (!message?.trim()) return res.status(400).json({ error: "message không được rỗng" });

    const key = customerKey.trim();
    const conversation = await Conversation.findOneAndUpdate(
      { companyId, customerKey: key },
      {
        $setOnInsert: { companyId, customerKey: key },
        $push: {
          messages: {
            role: "staff",
            content: message.trim(),
            staffName: staffName?.trim() || "",
          },
        },
      },
      { new: true, upsert: true }
    );

    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

// Tóm tắt hội thoại bằng AI — dùng khi nhân viên tiếp nhận một hội thoại dài, để không phải đọc
// lại từ đầu. Có cache trong DB (summary + summaryMessageCount): nếu số tin nhắn không đổi kể từ
// lần tóm tắt trước, trả lại bản cũ ngay, không gọi AI lại (trừ khi truyền force: true).
router.post("/summarize", async (req, res, next) => {
  try {
    const { companyId, customerKey, force } = req.body;
    if (!companyId || !customerKey?.trim()) {
      return res.status(400).json({ error: "Thiếu companyId hoặc customerKey" });
    }
    const key = customerKey.trim();

    const [conversation, lead] = await Promise.all([
      Conversation.findOne({ companyId, customerKey: key }),
      Lead.findOne({ companyId, customerKey: key }).lean(),
    ]);

    if (!conversation || conversation.messages.length === 0) {
      return res.json({ summary: "Chưa có tin nhắn nào để tóm tắt.", updatedAt: null });
    }

    if (!force && conversation.summary && conversation.summaryMessageCount === conversation.messages.length) {
      return res.json({ summary: conversation.summary, updatedAt: conversation.summaryUpdatedAt, cached: true });
    }

    const transcript = conversation.messages
      .map((m) => `${ROLE_LABELS[m.role] || m.role}${m.staffName ? " (" + m.staffName + ")" : ""}: ${m.content}`)
      .join("\n");

    const leadInfo = lead
      ? `Nhu cầu: ${lead.needType || "chưa rõ"}; Ngân sách: ${lead.budget || "chưa rõ"}; ` +
        `SĐT: ${lead.phone || "chưa có"}; Giai đoạn: ${lead.stage || "chưa rõ"}.`
      : "";

    const instructions =
      "Bạn là trợ lý tóm tắt hội thoại tư vấn bán hàng. Đọc đoạn hội thoại giữa Khách, AI và Nhân viên bên dưới, " +
      "rồi viết một bản tóm tắt ngắn gọn bằng tiếng Việt (tối đa 5-6 câu, có thể dùng gạch đầu dòng) gồm: " +
      "khách đang cần gì, đã có thông tin gì (ngân sách, SĐT, khu vực...), những vướng mắc/phản đối chưa giải quyết, " +
      "và việc cần làm tiếp theo. Không lặp lại nguyên văn tin nhắn, chỉ tóm ý.";

    const openai = getOpenAIClient();
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const response = await openai.responses.create({
      model,
      instructions,
      input: [{ role: "user", content: `${leadInfo}\n\nHội thoại:\n${transcript}` }],
    });

    const summary = extractText(response) || "Không tạo được tóm tắt.";

    conversation.summary = summary;
    conversation.summaryUpdatedAt = new Date();
    conversation.summaryMessageCount = conversation.messages.length;
    await conversation.save();

    res.json({ summary, updatedAt: conversation.summaryUpdatedAt, cached: false });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { companyId, customerKey } = req.query;
    if (!companyId || !customerKey) {
      return res.status(400).json({ error: "Thiếu companyId hoặc customerKey" });
    }

    const conversation = await Conversation.findOne({ companyId, customerKey });
    res.json(conversation || { companyId, customerKey, messages: [] });
  } catch (err) {
    next(err);
  }
});

router.delete("/", async (req, res, next) => {
  try {
    const { companyId, customerKey } = req.query;
    if (!companyId || !customerKey) {
      return res.status(400).json({ error: "Thiếu companyId hoặc customerKey" });
    }
    await Conversation.deleteOne({ companyId, customerKey });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
