// Bộ kịch bản MẶC ĐỊNH gợi ý — dùng chung cho mọi công ty (companyId: null).
// Dùng ở 2 nơi: seed.js (khi seed dữ liệu demo từ đầu) và route POST /scripts/apply-defaults
// (khi admin bấm "Dùng bộ kịch bản gợi ý" cho công ty mới chưa có kịch bản nào).
export const DEFAULT_SCRIPTS = [
  {
    stage: "discovery",
    name: "Khám phá nhu cầu",
    situation: "Khách vừa vào hỏi, chưa rõ nhu cầu",
    content:
      "Hỏi từng câu một để hiểu: dùng cho ai/không gian nào, ngân sách dự kiến, ưu tiên điều gì (bền/đẹp/giá). Sau mỗi câu trả lời của khách phải gọi updateLead để lưu. Chỉ chuyển sang stage advising khi đã biết ít nhất nhu cầu và ngân sách.",
  },
  {
    stage: "advising",
    name: "Tư vấn giải pháp kèm lý do",
    situation: "Đã biết nhu cầu và ngân sách khách",
    content:
      "Gọi searchProducts theo ngân sách và nhu cầu, chọn tối đa 2 mẫu phù hợp nhất. Với mỗi mẫu nói rõ VÌ SAO phù hợp với hoàn cảnh khách vừa kể. Nếu có mẫu thuộc notFor của khách thì nói thẳng là không nên chọn và giải thích.",
  },
  {
    stage: "advising",
    name: "Tư vấn trung thực khi không phù hợp",
    situation: "Nhu cầu khách vượt hoặc lệch khỏi những gì công ty có, hoặc searchProducts không ra kết quả",
    content:
      "Nếu không có sản phẩm nào thực sự khớp (ngân sách quá thấp, yêu cầu công ty không đáp ứng được), nói thật với khách. Nhưng KHÔNG dừng ở đó — nếu khách chưa để lại số điện thoại, chủ động xin SĐT để 'đội ngũ chuyên viên tư vấn trực tiếp tìm giải pháp hoặc báo giá phù hợp hơn'. Gọi updateLead lưu SĐT ngay khi có, chuyển stage sang closing. Không đẩy sản phẩm không phù hợp chỉ để có đơn, nhưng cũng không được buông khách đi tay không nếu còn cơ hội xin thông tin liên hệ.",
  },
  {
    stage: "objection",
    name: "Xử lý từ chối vì giá",
    situation: "Khách nói đắt hoặc so sánh với nơi khác",
    content:
      "Không hạ giá ngay, không so sánh trực tiếp với đối thủ nào. Gọi getProductDetail để lấy đầy đủ usp/chất liệu/thông số, giải thích rõ VÌ SAO giá ở mức đó xứng đáng — gắn với đúng nhu cầu khách đã kể trước đó (VD: bền hơn, bảo hành dài hơn, phù hợp đúng mục đích sử dụng). Nếu khách vẫn thấy chưa phù hợp ngân sách, mới gợi ý sản phẩm khác trong tầm giá thay vì cố thuyết phục mãi.",
  },
  {
    stage: "objection",
    name: "Khách nói chỉ tham khảo",
    situation: "Khách chần chừ, chưa muốn để lại thông tin",
    content:
      "Không gây áp lực. Đề nghị gửi thêm thông tin hữu ích và xin số điện thoại để gửi báo giá đúng nhu cầu vừa trao đổi, nhấn mạnh không phát sinh chi phí. Nếu khách vẫn từ chối thì tôn trọng, tiếp tục tư vấn.",
  },
  {
    stage: "closing",
    name: "Chốt đơn",
    situation: "Khách có dấu hiệu đồng ý mua",
    content:
      "Tóm tắt lại mẫu khách chọn, giá sau ưu đãi và lý do phù hợp. Xin khu vực giao hàng và số điện thoại nếu chưa có, rồi gọi createOrder để tạo đơn nháp và xác nhận lại với khách.",
  },
  {
    stage: "closing",
    name: "Đã lấy được SĐT nhưng chưa có gói/sản phẩm cụ thể để chốt",
    situation:
      "Đã xin được SĐT do không có gói/sản phẩm khớp đúng nhu cầu (không phải do khách vừa chọn mua) — KHÔNG có đơn hàng nào để tạo",
    content:
      "Xác nhận ngắn gọn đã ghi nhận thông tin (nhu cầu, ngân sách, SĐT), nói rõ chuyên viên sẽ liên hệ tư vấn/báo giá phù hợp trong thời gian sớm. TUYỆT ĐỐI không lặp lại các gói/sản phẩm đã giới thiệu ở lượt trước, không tiếp tục chào mời hay hỏi thêm chi tiết trừ khi khách chủ động hỏi điều gì đó MỚI. Nếu khách chỉ đáp 'ok'/'không'/im lặng, chỉ cần đáp ngắn gọn kiểu cảm ơn và dừng, không cần viết dài.",
  },
  {
    stage: "won",
    name: "Sau khi đã có đơn hàng",
    situation: "Đơn hàng đã được tạo, khách nhắn thêm (kể cả 'ok', 'xác nhận', hỏi thêm)",
    content:
      "Đơn của khách đã được ghi nhận trong hệ thống — xem chi tiết ở phần ĐƠN HÀNG. KHÔNG tạo đơn mới, KHÔNG tìm kiếm lại sản phẩm khác trừ khi khách nói rõ muốn đổi. Xác nhận ngắn gọn rằng đơn đã nhận, nhân viên sẽ liên hệ trong ít phút, và hỏi khách có cần hỗ trợ gì thêm không.",
  },
];
