import { getOpenAIClient } from "./openaiClient.js";
import { DOC_SOURCES } from "../models/KnowledgeDoc.js";
import { chunkText } from "./textChunking.js";

const SCHEMA = {
  name: "cleaned_knowledge",
  schema: {
    type: "object",
    properties: {
      useful: {
        type: "boolean",
        description: "Nội dung có đáng lưu làm tri thức tư vấn bán hàng không",
      },
      title: { type: "string", description: "Tiêu đề ngắn gọn, phản ánh đúng nội dung" },
      category: { type: "string", enum: DOC_SOURCES },
      content: {
        type: "string",
        description: "Nội dung đã làm sạch — chỉ giữ thông tin thật sự hữu ích cho tư vấn bán hàng",
      },
      skipReason: { type: "string", description: "Lý do không hữu ích, để trống nếu useful=true" },
    },
    required: ["useful", "title", "category", "content", "skipReason"],
    additionalProperties: false,
  },
  strict: true,
};

async function cleanKnowledgeChunk({ chunk, suggestedTitle, sourceUrl, company }) {
  const openai = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const instructions = [
    "Bạn xử lý nội dung thô lấy từ file hoặc trang web để nạp vào hệ thống tri thức cho AI tư vấn bán hàng.",
    "Nhiệm vụ LÀM SẠCH nội dung — loại bỏ hoàn toàn:",
    "- Menu điều hướng / breadcrumb còn sót lại",
    "- Banner cookie, popup, thông báo pháp lý chung",
    "- Nút mạng xã hội, nút chia sẻ, lời kêu gọi hành động lặp lại không mang thông tin (VD: 'Liên hệ ngay', 'Gọi hotline' lặp nhiều lần)",
    "- Thông tin liên hệ/footer lặp lại (địa chỉ, hotline) trừ khi đó chính là nội dung chính cần lưu",
    "- Nội dung không liên quan tới sản phẩm/dịch vụ/chính sách/kiến thức ngành của công ty",
    "Giữ lại ĐẦY ĐỦ thông tin thật có giá trị: mô tả sản phẩm/dịch vụ, chính sách, thông số kỹ thuật, USP, kiến thức chuyên môn, câu chuyện thương hiệu thật.",
    "",
    "Nếu SAU KHI loại bỏ rác, nội dung còn lại không có giá trị tư vấn bán hàng nào (VD: trang chỉ có form liên hệ trống, trang lỗi 404, trang danh sách tin tức không có nội dung cụ thể, trang tuyển dụng, trang chính sách cookie...), đặt useful=false kèm skipReason ngắn gọn giải thích vì sao.",
    "Đề xuất title ngắn gọn phản ánh đúng nội dung (không phải tên file/URL), và category phù hợp nhất:",
    "- company: giới thiệu/thông tin chung về công ty",
    "- policy: chính sách, quy trình, bảo hành, đổi trả, giao hàng",
    "- industry: kiến thức chuyên môn/ngành, không nói riêng về công ty",
    "- product: mô tả một sản phẩm/dịch vụ cụ thể",
    "- web: khác, không rõ nhóm nào ở trên",
    company?.name ? `Công ty đang xử lý tri thức: ${company.name}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userContent = [
    suggestedTitle ? `Tiêu đề gốc: ${suggestedTitle}` : "",
    sourceUrl ? `URL nguồn: ${sourceUrl}` : "",
    "Nội dung thô cần làm sạch (có thể chỉ là MỘT PHẦN của tài liệu dài hơn bị cắt đoạn):",
    chunk,
  ]
    .filter(Boolean)
    .join("\n\n");

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error("AI không trả về kết quả làm sạch nội dung");
  return JSON.parse(raw);
}

export async function cleanKnowledgeContent({ rawText, suggestedTitle, sourceUrl, company, onProgress }) {
  const chunks = chunkText(rawText);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    results.push(await cleanKnowledgeChunk({ chunk: chunks[i], suggestedTitle, sourceUrl, company }));
    onProgress?.({ done: i + 1, total: chunks.length });
  }

  const usefulResults = results.filter((r) => r.useful);
  if (usefulResults.length === 0) {
    return results[0] || { useful: false, title: "", category: "web", content: "", skipReason: "Không có nội dung hữu ích" };
  }

  return {
    useful: true,
    title: usefulResults[0].title,
    category: usefulResults[0].category,
    content: usefulResults.map((r) => r.content).join("\n\n"),
    skipReason: "",
  };
}
