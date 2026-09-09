import { getOpenAIClient } from "./openaiClient.js";
import { chunkText } from "./textChunking.js";

const SCHEMA = {
  name: "extracted_products",
  schema: {
    type: "object",
    properties: {
      products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            category: { type: "string", description: "Ngành hàng, để rỗng nếu không rõ" },
            sku: { type: "string", description: "Mã sản phẩm nếu có, để rỗng nếu không có" },
            price: { type: "number", description: "Giá niêm yết (VNĐ). Để 0 nếu không tìm thấy trong tài liệu, KHÔNG suy đoán." },
            priceAfterDiscount: {
              type: ["number", "null"],
              description: "Giá sau giảm nếu tài liệu có nêu, null nếu không có",
            },
            size: { type: "string" },
            material: { type: "string" },
            description: { type: "string", description: "Mô tả/giới thiệu sản phẩm (nếu tài liệu có đoạn văn giới thiệu), để rỗng nếu không có" },
            specs: { type: "string", description: "Thông số kỹ thuật khác" },
            bestFor: { type: "array", items: { type: "string" }, description: "Chỉ điền nếu tài liệu gợi ý rõ, để trống nếu không chắc" },
            notFor: { type: "array", items: { type: "string" }, description: "Chỉ điền nếu tài liệu gợi ý rõ, để trống nếu không chắc" },
            usp: { type: "array", items: { type: "string" } },
            stock: { type: "number", description: "Số lượng tồn kho, 0 nếu không đề cập" },
          },
          required: [
            "name",
            "category",
            "sku",
            "price",
            "priceAfterDiscount",
            "size",
            "material",
            "description",
            "specs",
            "bestFor",
            "notFor",
            "usp",
            "stock",
          ],
          additionalProperties: false,
        },
      },
      skipped: {
        type: "array",
        items: {
          type: "object",
          properties: {
            excerpt: { type: "string" },
            reason: { type: "string" },
          },
          required: ["excerpt", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["products", "skipped"],
    additionalProperties: false,
  },
  strict: true,
};

async function extractProductsFromChunk({ chunk, company, existingProducts }) {
  const openai = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const instructions = [
    "Bạn xử lý tài liệu (bảng giá, catalogue, file Excel...) để tách thành danh sách SẢN PHẨM có cấu trúc, nhập vào hệ thống quản lý bán hàng.",
    "QUAN TRỌNG NHẤT: chỉ lấy đúng số liệu/thông tin CÓ THẬT trong tài liệu — TUYỆT ĐỐI không suy đoán hay bịa giá, thông số, hoặc mô tả không có trong nguồn. Nếu một trường không có thông tin, để trống ('' hoặc 0 hoặc mảng rỗng), không đoán mò.",
    "Mỗi dòng/mục sản phẩm khác nhau trong tài liệu tách thành 1 object riêng.",
    "Văn bản có thể là MỘT PHẦN của tài liệu dài hơn (bị cắt đoạn) — cứ tách hết các sản phẩm nhận diện được trong đoạn này, không cần lo về phần trước/sau.",
    "bestFor/notFor: CHỈ điền khi tài liệu có gợi ý rõ ràng đối tượng phù hợp/không phù hợp (VD ghi chú, mô tả công dụng) — không tự suy ra từ tên sản phẩm.",
    "Đưa vào 'skipped' các dòng không đủ thông tin để tạo thành 1 sản phẩm rõ ràng (VD: chỉ có tên không có gì khác, dòng tiêu đề/ghi chú không phải sản phẩm thật).",
    company?.name ? `Công ty: ${company.name}` : "",
    existingProducts?.length
      ? `Sản phẩm đã có trong hệ thống (nếu trùng tên chính xác thì vẫn tách ra bình thường, hệ thống sẽ để người dùng tự quyết định lúc duyệt): ${existingProducts.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: chunk },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error("AI không trả về kết quả tách sản phẩm");

  const parsed = JSON.parse(raw);
  return { products: parsed.products || [], skipped: parsed.skipped || [] };
}

export async function extractProductsFromText({ text, company, existingProducts, onProgress }) {
  const chunks = chunkText(text);

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    results.push(await extractProductsFromChunk({ chunk: chunks[i], company, existingProducts }));
    onProgress?.({ done: i + 1, total: chunks.length });
  }

  return {
    products: results.flatMap((r) => r.products),
    skipped: results.flatMap((r) => r.skipped),
  };
}
