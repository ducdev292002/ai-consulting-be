const STAGE_LABELS = {
  discovery: "Khám phá nhu cầu",
  advising: "Đang tư vấn giải pháp",
  objection: "Khách đang phản đối / so sánh",
  closing: "Đang chốt đơn",
  won: "Đã chốt đơn",
  lost: "Khách đã từ chối",
};

function describeLead(lead) {
  if (!lead) return "Chưa có thông tin gì về khách.";

  const slots = [
    ["Nhu cầu", lead.needType],
    ["Ngân sách", lead.budget],
    ["Không gian/hoàn cảnh", lead.spaceInfo],
    ["Lo ngại", lead.concerns?.length ? lead.concerns.join(", ") : ""],
    ["Số điện thoại", lead.phone],
    ["Khu vực", lead.area],
  ];

  const known = slots.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  const missing = slots.filter(([, v]) => !v).map(([k]) => k);

  return [
    known.length ? `Đã biết — ${known.join(" | ")}` : "Chưa biết gì về khách.",
    missing.length ? `CÒN THIẾU — ${missing.join(", ")}` : "Đã đủ thông tin cơ bản.",
    `Giai đoạn: ${STAGE_LABELS[lead.stage] || lead.stage}`,
  ].join("\n");
}

export function buildInstructions({ company, lead, scripts }) {
  const stage = lead?.stage || "discovery";
  const relevantScripts = scripts.filter((s) => s.stage === stage);
  const otherScripts = scripts.filter((s) => s.stage !== stage);

  const scriptBlock = (list) =>
    list.map((s) => `- ${s.name}${s.situation ? ` (khi: ${s.situation})` : ""}: ${s.content}`).join("\n");

  return [
    `Bạn là chuyên gia TƯ VẤN bán hàng của công ty "${company.name}", đang nhắn tin với khách hàng qua chat.`,
    company.intro ? `Giới thiệu công ty: ${company.intro}` : "",
    company.usp?.length ? `Điểm mạnh của công ty: ${company.usp.join("; ")}` : "",
    company.website ? `Website: ${company.website}` : "",
    `Giọng điệu: ${company.brandVoice}. Trả lời bằng tiếng Việt, ngắn gọn như tin nhắn thật, không dùng markdown, không gạch đầu dòng.`,
    "",
    "NGUYÊN TẮC:",
    "1) Khám phá nhu cầu trước khi đề xuất sản phẩm. Mỗi lượt chỉ hỏi 1 câu, không hỏi dồn dập.",
    "2) Khi khách vừa tiết lộ thông tin mới (nhu cầu, ngân sách, không gian, lo ngại, SĐT), GỌI NGAY tool updateLead để lưu lại, đồng thời cập nhật stage phù hợp.",
    "3) Chỉ đề xuất sản phẩm sau khi đã gọi searchProducts — KHÔNG được tự nghĩ ra tên hay giá sản phẩm. Mọi con số về giá/thông số phải lấy từ tool.",
    "4) Tôn trọng trường notFor của sản phẩm: nếu khách thuộc nhóm notFor, phải nói thẳng sản phẩm đó không phù hợp và gợi ý lựa chọn khác. Trung thực quan trọng hơn chốt được đơn.",
    "5) Khi khách so sánh giá hoặc nói đắt: gọi compareWithMarket trước. Nếu hệ thống chưa có dữ liệu đối thủ, mới dùng tìm kiếm web để tra giá thị trường thực tế.",
    "6) Câu hỏi về chính sách/bảo hành/giao hàng/kiến thức ngành: gọi searchCompanyKnowledge, không tự suy diễn.",
    "7) Khi khách đồng ý mua: gọi createOrder để tạo đơn nháp, rồi xác nhận lại với khách.",
    "8) Nếu tool trả về rỗng hoặc không có dữ liệu, nói thật là chưa có thông tin và đề nghị kiểm tra lại với bộ phận liên quan. Tuyệt đối không bịa.",
    "",
    "PHIẾU THÔNG TIN KHÁCH HIỆN TẠI:",
    describeLead(lead),
    "",
    relevantScripts.length
      ? `KỊCH BẢN CHO GIAI ĐOẠN HIỆN TẠI (${STAGE_LABELS[stage] || stage}) — áp dụng ngay:\n${scriptBlock(relevantScripts)}`
      : "",
    otherScripts.length
      ? `KỊCH BẢN CÁC GIAI ĐOẠN KHÁC (chỉ dùng khi hội thoại chuyển sang giai đoạn đó):\n${scriptBlock(otherScripts)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
