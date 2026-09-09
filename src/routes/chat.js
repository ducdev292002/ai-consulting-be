import { Router } from "express";
import Company from "../models/Company.js";
import Script from "../models/Script.js";
import Lead from "../models/Lead.js";
import Order from "../models/Order.js";
import Conversation from "../models/Conversation.js";
import { buildInstructions } from "../services/promptBuilder.js";
import { buildSalesTools } from "../services/salesTools.js";
import { getOpenAIClient } from "../services/openaiClient.js";

const router = Router();

const MAX_TOOL_ROUNDS = 6;
const WEB_SEARCH_ENABLED = process.env.ENABLE_WEB_SEARCH !== "false";

function extractReply(response) {
  if (response.output_text) return response.output_text.trim();

  const messageItem = response.output?.find((item) => item.type === "message");
  const textPart = messageItem?.content?.find((part) => part.type === "output_text");
  return textPart?.text?.trim() || "(không có phản hồi)";
}

// AI được yêu cầu ngăn cách các ý bằng "|||" để mô phỏng cách người thật nhắn nhiều tin
// nhắn ngắn liên tiếp thay vì 1 đoạn văn dài khó đọc trên điện thoại.
// Chỉ dựa vào prompt để tránh 2 đoạn liên tiếp nói trùng ý (VD hỏi lại ngân sách 2 lần) không
// đủ tin cậy — lọc thêm 1 lớp an toàn: nếu 1 đoạn có tỉ lệ từ khoá trùng cao với đoạn TRƯỚC ĐÓ
// (đã xuất hiện trong cùng lượt trả lời này), coi là lặp ý và bỏ đoạn đó đi.
function dedupeSegments(segments) {
  const seenWordSets = [];
  return segments.filter((segment) => {
    const words = new Set(
      normalizeForMatch(segment)
        .split(/\W+/)
        .filter((w) => w.length > 2)
    );
    const isDuplicate = seenWordSets.some((prev) => {
      const overlap = [...words].filter((w) => prev.has(w)).length;
      const smaller = Math.min(words.size, prev.size) || 1;
      return overlap / smaller > 0.6;
    });
    seenWordSets.push(words);
    return !isDuplicate;
  });
}

function splitIntoSegments(reply) {
  const segments = reply
    .split("|||")
    .map((s) => s.trim())
    .filter(Boolean);
  return dedupeSegments(segments);
}

// AI đôi khi né gọi shareProductImage dù khách đã hỏi thẳng xem ảnh (nhất là hội thoại dài,
// nhiều chỉ dẫn) — thực tế test cho thấy prompt không đủ tin cậy để ép hành vi này 100%.
// An toàn phía server: nếu tin nhắn khách rõ ràng là xin xem ảnh mà AI chưa gửi ảnh nào, tự
// gọi shareProductImage cho sản phẩm khớp nhất trong kết quả searchProducts của lượt này.
const IMAGE_REQUEST_PATTERN =
  /(ảnh thật|xem ảnh|cho xem (ảnh|hình)|gửi ảnh|hình ảnh thật|xem hình|coi ảnh|cho coi ảnh|có ảnh|hình thật)/i;

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function pickBestProductMatch(products, message) {
  if (!products?.length) return null;
  const normMessage = normalizeForMatch(message);
  const withOverlap = products.map((p) => {
    const normName = normalizeForMatch(p.name);
    const nameWords = normName.split(/\s+/).filter((w) => w.length > 2);
    const overlap = nameWords.filter((w) => normMessage.includes(w)).length;
    return { p, overlap };
  });
  withOverlap.sort((a, b) => b.overlap - a.overlap);
  return withOverlap[0].overlap > 0 ? withOverlap[0].p : products[0];
}

router.post("/", async (req, res, next) => {
  try {
    const { companyId, customerKey, message } = req.body;

    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!customerKey?.trim()) return res.status(400).json({ error: "Thiếu customerKey (định danh khách)" });
    if (!message?.trim()) return res.status(400).json({ error: "message không được rỗng" });

    const company = await Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: "Không tìm thấy công ty" });

    const key = customerKey.trim();

    const [scripts, lead, conversation, existingOrders] = await Promise.all([
      Script.find({ $or: [{ companyId: null }, { companyId }] }).lean(),
      Lead.findOne({ companyId, customerKey: key }).lean(),
      Conversation.findOne({ companyId, customerKey: key }),
      Order.find({ companyId, customerKey: key }).sort({ createdAt: -1 }).lean(),
    ]);

    const convo = conversation || new Conversation({ companyId, customerKey: key, messages: [] });

    const NO_PROGRESS_THRESHOLD = 2;
    const forceDriftFallback = (lead?.noProgressStreak || 0) >= NO_PROGRESS_THRESHOLD && !lead?.phone;

    let instructions = buildInstructions({ company, lead, scripts, orders: existingOrders });
    if (forceDriftFallback) {
      instructions +=
        "\n\nCHÚ Ý BẮT BUỘC CHO LƯỢT NÀY: cuộc trò chuyện đã trôi nhiều lượt liên tiếp mà không có thông tin " +
        "mới nào từ khách (chưa rõ nhu cầu/ngân sách, chưa có SĐT). Câu trả lời NÀY BẮT BUỘC phải chứa một câu " +
        "với nghĩa tương đương: 'do em là tư vấn viên AI nên không nắm hết được tình huống cụ thể của anh/chị, " +
        "anh/chị để lại số điện thoại để bên em cử nhân viên tư vấn trực tiếp hỗ trợ kỹ hơn nhé' — phải nói rõ " +
        "mình LÀ AI, không được né tránh cụm này. Không lặp lại y nguyên các câu đã nói trước đó.";
    }
    const { definitions, runByName } = buildSalesTools({ companyId, customerKey: key });

    const tools = definitions.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    if (WEB_SEARCH_ENABLED) tools.push({ type: "web_search" });

    const input = [
      ...convo.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message.trim() },
    ];

    const openai = getOpenAIClient();
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const toolCallLog = [];
    const sharedImages = [];
    let lastSearchedProducts = [];

    let response = await openai.responses.create({ model, instructions, input, tools });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const functionCalls = (response.output || []).filter((item) => item.type === "function_call");
      const usedWebSearch = (response.output || []).some((item) => item.type === "web_search_call");
      if (usedWebSearch) toolCallLog.push({ name: "web_search", args: {} });

      if (functionCalls.length === 0) break;

      input.push(...response.output);

      for (const call of functionCalls) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = {};
        }

        let result;
        try {
          result = await runByName(call.name, args);
        } catch (toolErr) {
          result = { error: `Tool ${call.name} lỗi: ${toolErr.message}` };
        }
        toolCallLog.push({ name: call.name, args });
        if (call.name === "shareProductImage" && result?.shared && result?.imageUrl) {
          sharedImages.push({ url: result.imageUrl, name: result.name || "" });
        }
        if (call.name === "searchProducts" && Array.isArray(result?.products) && result.products.length) {
          lastSearchedProducts = result.products;
        }
        console.log(
          `[chat] ${key} -> ${call.name}(${JSON.stringify(args)}) = ${JSON.stringify(result).slice(0, 300)}`
        );

        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }

      response = await openai.responses.create({ model, instructions, input, tools });
    }

    // Nếu lượt này có gọi searchProducts, cập nhật lại ngữ cảnh sản phẩm nhớ theo hội thoại.
    // Nếu không, vẫn giữ ngữ cảnh từ lượt trước (để dùng cho fallback ảnh bên dưới).
    if (lastSearchedProducts.length > 0) {
      convo.lastProductContext = lastSearchedProducts.map((p) => ({
        productId: p.productId,
        name: p.name,
        hasImage: p.hasImage,
      }));
    }
    const productContextForFallback = lastSearchedProducts.length > 0 ? lastSearchedProducts : convo.lastProductContext;

    if (
      sharedImages.length === 0 &&
      productContextForFallback?.length > 0 &&
      IMAGE_REQUEST_PATTERN.test(message)
    ) {
      const bestMatch = pickBestProductMatch(productContextForFallback, message);
      if (bestMatch?.hasImage) {
        try {
          const fallbackResult = await runByName("shareProductImage", { productId: bestMatch.productId });
          if (fallbackResult?.shared && fallbackResult?.imageUrl) {
            sharedImages.push({ url: fallbackResult.imageUrl, name: fallbackResult.name || "" });
            toolCallLog.push({ name: "shareProductImage", args: { productId: bestMatch.productId } });
          }
        } catch {
          // bỏ qua — chỉ là lớp an toàn bổ sung, không chặn phản hồi chính nếu lỗi
        }
      }
    }

    const reply = extractReply(response);
    const segments = splitIntoSegments(reply);

    convo.messages.push({ role: "user", content: message.trim() });
    segments.forEach((segment, i) => {
      const isLast = i === segments.length - 1;
      convo.messages.push({
        role: "assistant",
        content: segment,
        toolCalls: isLast ? toolCallLog.map((t) => t.name) : [],
        images: isLast ? sharedImages : [],
      });
    });
    await convo.save();

    let [updatedLead, latestOrder] = await Promise.all([
      Lead.findOne({ companyId, customerKey: key }).lean(),
      Order.findOne({ companyId, customerKey: key }).sort({ createdAt: -1 }).lean(),
    ]);

    const PROGRESS_FIELDS = ["needType", "budget", "spaceInfo", "phone", "area", "stage"];
    const hasNewData = PROGRESS_FIELDS.some(
      (f) => (updatedLead?.[f] || "") !== (lead?.[f] || "")
    );
    const hasNewConcern = (updatedLead?.concerns?.length || 0) > (lead?.concerns?.length || 0);
    const madeOrder = toolCallLog.some((t) => t.name === "createOrder");
    const progressed = hasNewData || hasNewConcern || madeOrder;

    if (updatedLead) {
      const nextStreak = progressed ? 0 : (updatedLead.noProgressStreak || 0) + 1;
      if (nextStreak !== updatedLead.noProgressStreak) {
        updatedLead = await Lead.findOneAndUpdate(
          { companyId, customerKey: key },
          { $set: { noProgressStreak: nextStreak } },
          { new: true }
        ).lean();
      }
    }

    res.json({
      reply: segments.join("\n"),
      toolCalls: toolCallLog,
      lead: updatedLead,
      order: latestOrder,
      messages: convo.messages,
      instructions,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
