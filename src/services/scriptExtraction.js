import { getOpenAIClient } from "./openaiClient.js";
import { LEAD_STAGES } from "../models/Lead.js";

const STAGE_GUIDE = [
  "discovery = khách mới nhắn/chưa rõ nhu cầu, đang khám phá",
  "advising = đã biết nhu cầu cơ bản, đang tư vấn giải pháp cụ thể",
  "objection = khách phản đối, so sánh, chần chừ, từ chối để lại thông tin",
  "closing = đang chốt đơn hoặc xin số điện thoại/thông tin liên hệ",
  "won = khách đã để lại thông tin / đã chốt xong, cần xác nhận",
  "lost = khách đã từ chối hẳn, không còn quan tâm",
].join("\n");

const SCHEMA = {
  name: "extracted_scripts",
  schema: {
    type: "object",
    properties: {
      scripts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Tên ngắn gọn của kịch bản" },
            stage: { type: "string", enum: LEAD_STAGES },
            situation: { type: "string", description: "1 câu mô tả tình huống áp dụng" },
            content: {
              type: "string",
              description: "Hướng dẫn cho AI, diễn giải chiến lược — không chép nguyên văn lời thoại mẫu",
            },
          },
          required: ["name", "stage", "situation", "content"],
          additionalProperties: false,
        },
      },
      skipped: {
        type: "array",
        items: {
          type: "object",
          properties: {
            excerpt: { type: "string", description: "Trích đoạn ngắn bị bỏ qua" },
            reason: { type: "string", description: "Vì sao không đưa vào kịch bản" },
          },
          required: ["excerpt", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["scripts", "skipped"],
    additionalProperties: false,
  },
  strict: true,
};

export async function extractScriptsFromText({ text, company, existingScripts }) {
  const openai = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const instructions = [
    "Bạn là chuyên gia phân tích kịch bản bán hàng cho hệ thống AI tư vấn bán hàng qua chat.",
    "Cho văn bản kịch bản dưới đây (có thể lộn xộn: gồm cả lời thoại mẫu, ghi chú chiến lược, hoặc nội dung quảng cáo), hãy tách thành các KỊCH BẢN HỘI THOẠI cụ thể mà AI có thể áp dụng đúng 1 tình huống trong 1 lượt chat.",
    "",
    "Với mỗi kịch bản tách được:",
    "- name: tên ngắn gọn",
    "- stage: chọn ĐÚNG 1 giai đoạn phù hợp nhất theo hướng dẫn sau:",
    STAGE_GUIDE,
    "- situation: 1 câu mô tả khi nào áp dụng",
    "- content: diễn giải thành HƯỚNG DẪN chiến lược cho AI (nói AI nên làm gì/nhấn mạnh gì) — KHÔNG chép nguyên văn lời thoại mẫu kèm icon/emoji, vì AI sẽ tự paraphrase theo giọng điệu công ty mỗi lượt chat.",
    "",
    "Đưa vào mục 'skipped' (kèm lý do) các đoạn KHÔNG phải kịch bản hội thoại cụ thể, ví dụ:",
    "- Nội dung quảng cáo/ads, câu chữ dùng để chạy quảng cáo Facebook/TikTok",
    "- Ghi chú chiến lược tổng quát không gắn 1 tình huống hội thoại cụ thể",
    "- Yêu cầu cần hạ tầng kỹ thuật hệ thống hiện chưa có (VD: tự động nhắn tin theo thời gian chờ, theo dõi số tin nhắn khách đã xem, tích hợp nền tảng nhắn tin ngoài)",
    "- Trùng lặp với thông tin công ty đã biết bên dưới",
    "",
    `Công ty: ${company?.name || "(chưa rõ)"}`,
    company?.intro ? `Giới thiệu: ${company.intro}` : "",
    company?.usp?.length ? `USP đã có sẵn (không tạo kịch bản trùng nội dung này): ${company.usp.join("; ")}` : "",
    existingScripts?.length
      ? `Kịch bản đã có sẵn trong hệ thống (không tạo trùng tên/nội dung): ${existingScripts.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: text.slice(0, 20000) },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error("AI không trả về kết quả tách kịch bản");

  const parsed = JSON.parse(raw);
  return { scripts: parsed.scripts || [], skipped: parsed.skipped || [] };
}
