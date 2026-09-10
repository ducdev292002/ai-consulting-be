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

// AI đôi khi hỏi khách "có muốn em tạo đơn hàng không" rồi khi khách xác nhận ngắn gọn ("có",
// "chốt", "mua"...) lại LẶP LẠI mô tả sản phẩm thay vì thực sự gọi createOrder — prompt không đủ
// tin cậy để ép hành vi này 100% (đã thấy lặp lại nhiều lần dù đã nhấn mạnh trong hướng dẫn).
// An toàn phía server: nếu tin nhắn ngay trước của AI có đề nghị tạo đơn, khách xác nhận ngắn gọn,
// AI lượt này KHÔNG gọi createOrder, và đang chỉ có ĐÚNG 1 sản phẩm trong ngữ cảnh gần nhất (để
// tránh đoán nhầm khi có nhiều sản phẩm) — tự tạo đơn thay và ghi đè câu trả lời bằng xác nhận đơn.
const ORDER_OFFER_PATTERN =
  /(tạo (đơn|đơn hàng)|lên đơn|đặt mua|đặt hàng|chốt đơn|xác nhận (đơn|mua)|tiến hành đặt)/i;
const ORDER_CONFIRM_PATTERN =
  /^(có|okay?|ok|đồng ý|dc|được|chốt|chốt đơn|chốt luôn|mua|mua luôn|mua đi|đặt hàng|đặt mua|xác nhận|uh|ừ|ừm|vâng|dạ|yes)( ạ| nhé| nha| đi| luôn)?[.!]*$/i;
// Khách CHỦ ĐỘNG tuyên bố muốn mua/chốt mà không cần AI hỏi trước (VD: "chốt mẫu này đi", "lấy
// cái này", "mua em này luôn") — chỉ áp dụng cho tin nhắn NGẮN (dưới 40 ký tự) để tránh nhầm với
// câu hỏi/nhận xét dài hơn có chứa chữ "chốt"/"mua" nhưng không mang nghĩa xác nhận mua.
const PURCHASE_INTENT_PATTERN = /(chốt)|((lấy|mua|đặt)\s*(mẫu|cái|em|sản phẩm)?\s*này)/i;

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// AI đôi khi CẢM ƠN khách vì đã để lại SĐT (xác nhận bằng lời) nhưng lại quên gọi tool updateLead
// để thực sự lưu số đó vào phiếu khách — giống lỗi đã gặp với createOrder, prompt không đủ tin
// cậy để ép 100%. An toàn phía server: tự tách số điện thoại VN hợp lệ ra khỏi tin nhắn khách,
// nếu AI lượt này không lưu SĐT qua updateLead thì tự gọi lưu thay.
function extractVietnamesePhone(text) {
  const cleaned = String(text || "").replace(/[\s.\-]/g, "");
  const match = cleaned.match(/(0\d{9,10})/);
  return match ? match[1] : null;
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

// Sinh câu trả lời AI cho 1 lượt chat.
// appendUserMessage=true (dùng ở POST /): message là tin mới của khách, cần đẩy vào convo.messages.
// appendUserMessage=false (dùng ở POST /resume, /suggest): message là tin khách ĐÃ có sẵn ở cuối
// convo.messages (gửi lúc mode="human" nên chưa được AI trả lời) — không đẩy thêm.
// persist=false (dùng ở POST /suggest): KHÔNG ghi câu trả lời vào convo.messages / lưu hội thoại —
// chỉ trả về như một GỢI Ý để nhân viên xem, chỉnh sửa rồi tự quyết định có gửi hay không.
async function generateAiReply({
  companyId,
  key,
  company,
  lead,
  scripts,
  existingOrders,
  convo,
  message,
  appendUserMessage,
  persist = true,
}) {
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

  // Lịch sử gửi cho AI luôn lấy từ convo.messages HIỆN TẠI (đã gồm tin nhắn mới nhất của khách,
  // dù được đẩy thêm ở đây hay đã có sẵn từ trước lúc mode="human"). OpenAI chỉ chấp nhận role
  // "user"/"assistant" — tin nhắn role "staff" được quy về "assistant" nhưng gắn nhãn rõ ràng, để
  // khi hội thoại được trả lại cho AI, AI đọc được đã có nhân viên nói gì và không lặp lại/mâu thuẫn.
  if (appendUserMessage) {
    convo.messages.push({ role: "user", content: message.trim() });
  }

  // Tin nhắn gần nhất của AI/nhân viên TRƯỚC câu khách vừa gửi — dùng để nhận diện AI có vừa hỏi
  // "có muốn tạo đơn không" hay không (fallback tạo đơn bên dưới).
  let priorAssistantMessage = null;
  for (let i = convo.messages.length - 2; i >= 0; i--) {
    if (convo.messages[i].role === "assistant" || convo.messages[i].role === "staff") {
      priorAssistantMessage = convo.messages[i];
      break;
    }
  }

  const input = convo.messages.map((m) => ({
    role: m.role === "staff" ? "assistant" : m.role,
    content:
      m.role === "staff" ? `[Nhân viên${m.staffName ? " " + m.staffName : ""} đã trả lời khách]: ${m.content}` : m.content,
  }));

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

  const phoneSavedThisTurn = toolCallLog.some((t) => t.name === "updateLead" && t.args?.phone);
  if (!phoneSavedThisTurn) {
    const extractedPhone = extractVietnamesePhone(message);
    if (extractedPhone && extractedPhone !== (lead?.phone || "")) {
      try {
        await runByName("updateLead", { phone: extractedPhone });
        toolCallLog.push({ name: "updateLead", args: { phone: extractedPhone } });
      } catch {
        // bỏ qua — chỉ là lớp an toàn bổ sung, không chặn phản hồi chính nếu lỗi
      }
    }
  }

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

  let orderFallbackReply = null;
  const alreadyMadeOrderThisTurn = toolCallLog.some((t) => t.name === "createOrder");
  const trimmedMessage = message.trim();
  const isAnsweringOrderOffer =
    Boolean(priorAssistantMessage) &&
    ORDER_OFFER_PATTERN.test(priorAssistantMessage.content) &&
    ORDER_CONFIRM_PATTERN.test(trimmedMessage);
  // "chốt"/"mua"/"lấy" đứng trong câu HỎI (VD "chốt được giá tốt hơn không?") không phải xác nhận
  // mua — loại các câu có "không"/"?"/"ko" ra khỏi diện được coi là tuyên bố mua chủ động.
  const looksLikeQuestion = /(không|ko\b|\?)/i.test(trimmedMessage);
  const isProactivePurchaseIntent =
    trimmedMessage.length <= 40 && !looksLikeQuestion && PURCHASE_INTENT_PATTERN.test(trimmedMessage);
  if (
    !alreadyMadeOrderThisTurn &&
    !(existingOrders && existingOrders.length > 0) &&
    (isAnsweringOrderOffer || isProactivePurchaseIntent)
  ) {
    const orderCandidates = lastSearchedProducts.length > 0 ? lastSearchedProducts : convo.lastProductContext;
    if (orderCandidates?.length === 1) {
      const candidate = orderCandidates[0];
      try {
        const orderResult = await runByName("createOrder", { items: [{ productId: candidate.productId, qty: 1 }] });
        if (orderResult?.orderId) {
          toolCallLog.push({ name: "createOrder", args: { items: [{ productId: candidate.productId, qty: 1 }] } });
          orderFallbackReply = `Dạ em đã lên đơn ${candidate.name} cho anh/chị rồi ạ, bên em sẽ liên hệ xác nhận và giao hàng sớm nhất nhé!`;
        }
      } catch {
        // bỏ qua — chỉ là lớp an toàn bổ sung, không chặn phản hồi chính nếu lỗi
      }
    }
  }

  const reply = orderFallbackReply || extractReply(response);
  const segments = splitIntoSegments(reply);

  if (persist) {
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
  }

  let [updatedLead, latestOrder] = await Promise.all([
    Lead.findOne({ companyId, customerKey: key }).lean(),
    Order.findOne({ companyId, customerKey: key }).sort({ createdAt: -1 }).lean(),
  ]);

  const PROGRESS_FIELDS = ["needType", "budget", "spaceInfo", "phone", "area", "stage"];
  const hasNewData = PROGRESS_FIELDS.some((f) => (updatedLead?.[f] || "") !== (lead?.[f] || ""));
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

  return {
    reply: segments.join("\n"),
    toolCalls: toolCallLog,
    lead: updatedLead,
    order: latestOrder,
    messages: convo.messages,
    instructions,
  };
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

    // Nhân viên đã tiếp nhận hội thoại này ("mode: human") — AI tạm dừng trả lời tự động, chỉ
    // ghi nhận tin nhắn khách để nhân viên xem, còn trả lời thủ công qua route /conversations/staff-message.
    if (convo.mode === "human") {
      convo.messages.push({ role: "user", content: message.trim() });
      await convo.save();
      const [currentLead, latestOrder] = await Promise.all([
        Lead.findOne({ companyId, customerKey: key }).lean(),
        Order.findOne({ companyId, customerKey: key }).sort({ createdAt: -1 }).lean(),
      ]);
      return res.json({
        reply: null,
        aiPaused: true,
        toolCalls: [],
        lead: currentLead,
        order: latestOrder,
        messages: convo.messages,
      });
    }

    const result = await generateAiReply({
      companyId,
      key,
      company,
      lead,
      scripts,
      existingOrders,
      convo,
      message,
      appendUserMessage: true,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Trả lời NGAY tin nhắn khách đang "treo" (gửi lúc hội thoại ở mode "human", chưa được AI trả
// lời) — dùng khi nhân viên vừa bấm "Trả lại cho AI" và muốn AI xử lý luôn thay vì chờ khách
// nhắn thêm 1 tin mới. Không làm gì nếu tin cuối cùng không phải của khách (đã có người trả lời).
router.post("/resume", async (req, res, next) => {
  try {
    const { companyId, customerKey } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!customerKey?.trim()) return res.status(400).json({ error: "Thiếu customerKey (định danh khách)" });

    const key = customerKey.trim();
    const company = await Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: "Không tìm thấy công ty" });

    const convo = await Conversation.findOne({ companyId, customerKey: key });
    const lastMessage = convo?.messages?.[convo.messages.length - 1];

    if (!convo || !lastMessage || lastMessage.role !== "user") {
      return res.json({ resumed: false, messages: convo?.messages || [] });
    }

    const [scripts, lead, existingOrders] = await Promise.all([
      Script.find({ $or: [{ companyId: null }, { companyId }] }).lean(),
      Lead.findOne({ companyId, customerKey: key }).lean(),
      Order.find({ companyId, customerKey: key }).sort({ createdAt: -1 }).lean(),
    ]);

    const result = await generateAiReply({
      companyId,
      key,
      company,
      lead,
      scripts,
      existingOrders,
      convo,
      message: lastMessage.content,
      appendUserMessage: false,
    });
    res.json({ ...result, resumed: true });
  } catch (err) {
    next(err);
  }
});

// Gợi ý câu trả lời cho nhân viên khi hội thoại đang ở mode "human" — chạy AI như bình thường
// (tìm sản phẩm, tra tri thức...) nhưng KHÔNG gửi cho khách, chỉ trả về nội dung để nhân viên xem,
// chỉnh sửa hoặc gửi thẳng. Không làm gì nếu tin cuối cùng không phải của khách (đã được trả lời).
// Có cache trong DB (suggestion + suggestionMessageCount): nếu số tin nhắn không đổi kể từ lần gợi
// ý trước, trả lại bản cũ ngay, KHÔNG gọi lại AI — tránh tốn token mỗi lần mở lại hội thoại/chuyển
// mode mà khách chưa nhắn gì thêm. Truyền force:true (nút "Làm mới") để bắt buộc soạn lại.
router.post("/suggest", async (req, res, next) => {
  try {
    const { companyId, customerKey, force } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!customerKey?.trim()) return res.status(400).json({ error: "Thiếu customerKey (định danh khách)" });

    const key = customerKey.trim();
    const company = await Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: "Không tìm thấy công ty" });

    const convo = await Conversation.findOne({ companyId, customerKey: key });
    const lastMessage = convo?.messages?.[convo.messages.length - 1];

    if (!convo || !lastMessage || lastMessage.role !== "user") {
      return res.json({ suggestion: "", available: false });
    }

    if (!force && convo.suggestion && convo.suggestionMessageCount === convo.messages.length) {
      return res.json({ suggestion: convo.suggestion, available: true, cached: true });
    }

    const [scripts, lead, existingOrders] = await Promise.all([
      Script.find({ $or: [{ companyId: null }, { companyId }] }).lean(),
      Lead.findOne({ companyId, customerKey: key }).lean(),
      Order.find({ companyId, customerKey: key }).sort({ createdAt: -1 }).lean(),
    ]);

    const result = await generateAiReply({
      companyId,
      key,
      company,
      lead,
      scripts,
      existingOrders,
      convo,
      message: lastMessage.content,
      appendUserMessage: false,
      persist: false,
    });

    convo.suggestion = result.reply;
    convo.suggestionMessageCount = convo.messages.length;
    await convo.save();

    res.json({
      suggestion: result.reply,
      available: true,
      cached: false,
      toolCalls: result.toolCalls,
      lead: result.lead,
      order: result.order,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
