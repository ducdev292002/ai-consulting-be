import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./db.js";
import Company from "./models/Company.js";
import Product from "./models/Product.js";
import KnowledgeDoc from "./models/KnowledgeDoc.js";
import KnowledgeChunk from "./models/KnowledgeChunk.js";
import CompetitorPrice from "./models/CompetitorPrice.js";
import Script from "./models/Script.js";
import Lead from "./models/Lead.js";
import Order from "./models/Order.js";
import Conversation from "./models/Conversation.js";
import { indexDocument } from "./services/embeddings.js";

const SHARED_SCRIPTS = [
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
    situation: "Nhu cầu khách vượt hoặc lệch khỏi những gì công ty có",
    content:
      "Nếu không có sản phẩm nào thực sự khớp (ngân sách quá thấp, yêu cầu công ty không đáp ứng được), nói thật với khách và gợi ý hướng khác. Không đẩy sản phẩm không phù hợp chỉ để có đơn.",
  },
  {
    stage: "objection",
    name: "Xử lý từ chối vì giá",
    situation: "Khách nói đắt hoặc so sánh với nơi khác",
    content:
      "Gọi compareWithMarket trước để lấy số liệu thật. Không hạ giá ngay. So sánh giá trị (chất liệu, bảo hành, hậu mãi) gắn với nhu cầu khách đã kể. Nếu hệ thống chưa có dữ liệu đối thủ thì dùng tìm kiếm web để tra giá thị trường rồi mới so sánh.",
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
];

async function seedCompany({ company, products, docs, competitors }) {
  const created = await Company.create(company);

  const productMap = {};
  for (const p of products) {
    const doc = await Product.create({ ...p, companyId: created._id });
    productMap[p.name] = doc;
  }

  for (const d of docs) {
    const knowledgeDoc = await KnowledgeDoc.create({
      companyId: created._id,
      productId: d.productName ? productMap[d.productName]?._id || null : null,
      source: d.source,
      title: d.title,
      content: d.content,
      sourceUrl: d.sourceUrl || "",
    });

    try {
      const chunkCount = await indexDocument({ doc: knowledgeDoc });
      knowledgeDoc.chunkCount = chunkCount;
      await knowledgeDoc.save();
    } catch (err) {
      console.warn(`[seed] Không tạo embedding cho "${d.title}": ${err.message}`);
    }
  }

  for (const c of competitors) {
    await CompetitorPrice.create({
      ...c,
      companyId: created._id,
      productId: c.productName2 ? productMap[c.productName2]?._id || null : null,
    });
  }

  for (const s of SHARED_SCRIPTS) {
    await Script.create({ ...s, companyId: created._id });
  }

  console.log(`[seed] Đã tạo công ty "${created.name}"`);
  return created;
}

async function seed() {
  await connectDB();

  await Promise.all([
    Company.deleteMany({}),
    Product.deleteMany({}),
    KnowledgeDoc.deleteMany({}),
    KnowledgeChunk.deleteMany({}),
    CompetitorPrice.deleteMany({}),
    Script.deleteMany({}),
    Lead.deleteMany({}),
    Order.deleteMany({}),
    Conversation.deleteMany({}),
  ]);

  await seedCompany({
    company: {
      name: "Savisofa",
      website: "https://savisofa.vn",
      intro:
        "Savisofa thiết kế và thi công nội thất da bò Ý cao cấp, có xưởng sản xuất riêng, chuyên sofa và giường da thiết kế theo không gian.",
      usp: [
        "Da bò Ý nhập khẩu 100%",
        "Bảo hành lên tới 10 năm",
        "Miễn phí thiết kế 3D theo không gian nhà",
        "Có xưởng sản xuất riêng nên giá tốt",
      ],
      brandVoice: "Thân thiện, lịch sự, gọi khách là anh/chị",
    },
    products: [
      {
        category: "Sofa",
        name: "Sofa da bò Ý Milano 3 chỗ",
        sku: "SF-MIL-3",
        price: 32000000,
        priceAfterDiscount: 27200000,
        size: "2m2 x 95cm",
        material: "Da bò Ý nguyên tấm",
        specs: "Khung gỗ sồi tự nhiên, đệm mút D40 cao cấp, chân inox mạ vàng",
        bestFor: ["phòng khách rộng trên 20m2", "nhà ưu tiên độ bền lâu dài", "gia đình không có thú nuôi"],
        notFor: ["nhà có mèo hoặc chó nuôi trong nhà", "ngân sách dưới 20 triệu", "căn hộ nhỏ dưới 15m2"],
        usp: ["Da bò Ý nguyên tấm", "Bảo hành khung 10 năm", "Càng dùng càng lên màu đẹp"],
        stock: 5,
      },
      {
        category: "Sofa",
        name: "Sofa góc L da công nghiệp Aria",
        sku: "SF-ARI-L",
        price: 15000000,
        priceAfterDiscount: 12750000,
        size: "2m4 x 1m6 (góc L)",
        material: "Da công nghiệp Microfiber chống xước",
        specs: "Khung gỗ thông sấy, đệm mút D35, bọc da microfiber chống xước và dễ vệ sinh",
        bestFor: ["căn hộ nhỏ", "nhà có trẻ nhỏ", "nhà có thú nuôi", "ngân sách 12-16 triệu"],
        notFor: ["khách muốn da thật 100%", "phòng khách rất rộng trên 30m2"],
        usp: ["Chống xước tốt", "Dễ vệ sinh", "Tận dụng góc tường tiết kiệm diện tích"],
        stock: 12,
      },
      {
        category: "Giường",
        name: "Giường da bò Ý Verona 1m8",
        sku: "GD-VER-18",
        price: 28000000,
        priceAfterDiscount: null,
        size: "1m8 x 2m",
        material: "Da bò Ý",
        specs: "Đầu giường bọc da cao 1m1, khung gỗ sồi, có hộc kéo tuỳ chọn",
        bestFor: ["phòng ngủ master trên 18m2", "khách muốn đồng bộ với sofa da"],
        notFor: ["phòng ngủ nhỏ dưới 12m2", "ngân sách dưới 20 triệu"],
        usp: ["Thiết kế riêng theo không gian", "Bảo hành 10 năm"],
        stock: 3,
      },
    ],
    docs: [
      {
        source: "product",
        productName: "Sofa da bò Ý Milano 3 chỗ",
        title: "Catalogue Sofa Milano 3 chỗ",
        content:
          "Sofa da bò Ý Milano 3 chỗ là mẫu bán chạy nhất của Savisofa. Kích thước 2m2 x 95cm, cao 85cm, chiều sâu chỗ ngồi 60cm. Da bò Ý nguyên tấm dày 1.2-1.4mm, thuộc thảo mộc, không pha PU. Khung gỗ sồi tự nhiên sấy ở 12% độ ẩm chống mối mọt và cong vênh. Đệm mút D40 mật độ cao giữ form trên 8 năm không xẹp. Chân inox mạ vàng chịu lực 400kg. Có 6 màu da: nâu cognac, đen, xám tro, kem, đỏ burgundy, xanh navy. Thời gian đặt hàng theo màu ngoài kho là 21-25 ngày. Lưu ý quan trọng: da bò thật dễ bị mèo hoặc chó cào xước và vết xước trên da thật không thể phục hồi hoàn toàn, nên không khuyến nghị cho gia đình nuôi thú trong nhà.",
      },
      {
        source: "product",
        productName: "Sofa góc L da công nghiệp Aria",
        title: "Catalogue Sofa góc L Aria",
        content:
          "Sofa góc L Aria kích thước 2m4 x 1m6, phần góc có thể đổi trái/phải khi đặt hàng. Bọc da công nghiệp Microfiber: bề mặt chống xước cấp độ 4, chống thấm nước, lau bằng khăn ẩm là sạch, phù hợp gia đình có trẻ nhỏ hoặc thú nuôi. Khung gỗ thông sấy, đệm mút D35. Bảo hành khung 5 năm, bọc 2 năm. Có sẵn 4 màu trong kho: ghi sáng, ghi đậm, nâu, kem — giao trong 3-5 ngày. Hạn chế: da công nghiệp không có độ mềm và mùi đặc trưng như da bò thật, độ bền bề mặt khoảng 5-7 năm tuỳ sử dụng, thấp hơn da bò Ý.",
      },
      {
        source: "policy",
        title: "Chính sách bảo hành, đổi trả và giao hàng",
        content:
          "Bảo hành khung gỗ 10 năm cho dòng da bò Ý, 5 năm cho dòng da công nghiệp. Bảo hành bọc da 2 năm với lỗi bong tróc, nứt do vật liệu. Không bảo hành các hư hỏng do vật nuôi cào, vật sắc nhọn, hoá chất tẩy rửa mạnh. Đổi trả trong 7 ngày nếu lỗi sản xuất, hoàn 100%. Giao hàng và lắp đặt miễn phí nội thành Hà Nội và TP.HCM; các tỉnh khác tính phí theo khoảng cách. Hỗ trợ trả góp 0% lãi suất 6 tháng qua thẻ tín dụng cho đơn từ 10 triệu. Miễn phí thiết kế 3D không gian trước khi khách quyết định.",
      },
      {
        source: "industry",
        title: "Kiến thức ngành: phân biệt da bò thật và da công nghiệp",
        content:
          "Da bò thật (full grain, top grain) có lỗ chân lông không đều, mùi da đặc trưng, càng dùng càng lên màu bóng đẹp gọi là patina, tuổi thọ 15-20 năm nếu bảo dưỡng đúng. Da công nghiệp (PU, PVC, Microfiber) có hoa văn in đều nhau, không có mùi da, tuổi thọ trung bình 5-7 năm, dễ bong tróc bề mặt sau 3-5 năm với PU giá rẻ nhưng Microfiber cao cấp thì bền và chống xước tốt hơn da thật. Cách phân biệt nhanh: nhỏ một giọt nước lên bề mặt, da thật hút ẩm và thẫm màu nhẹ, da công nghiệp đọng thành hạt. Bảo dưỡng da thật: lau bụi hàng tuần bằng khăn mềm, dùng dung dịch dưỡng da 3-6 tháng một lần, tránh ánh nắng trực tiếp.",
      },
    ],
    competitors: [
      {
        competitorName: "Đối thủ A (chuỗi nội thất lớn)",
        productName: "Sofa da 3 chỗ nhập khẩu",
        productName2: "Sofa da bò Ý Milano 3 chỗ",
        price: 29000000,
        source: "Khảo sát showroom 08/2026",
        note: "Da bò Ý nhưng chỉ mặt tiếp xúc, phần hông và lưng dùng da PU. Bảo hành 3 năm. Không có thiết kế 3D miễn phí.",
      },
      {
        competitorName: "Đối thủ B (xưởng nhỏ)",
        productName: "Sofa da 3 chỗ",
        productName2: "Sofa da bò Ý Milano 3 chỗ",
        price: 18000000,
        source: "Khảo sát website 08/2026",
        note: "Da công nghiệp cao cấp, không phải da bò. Khung gỗ công nghiệp. Bảo hành 1 năm, không có chính sách đổi trả.",
      },
      {
        competitorName: "Đối thủ A (chuỗi nội thất lớn)",
        productName: "Sofa góc L da microfiber",
        productName2: "Sofa góc L da công nghiệp Aria",
        price: 16500000,
        source: "Khảo sát showroom 08/2026",
        note: "Chất liệu tương đương nhưng giá cao hơn 3.7 triệu, bảo hành bọc chỉ 1 năm.",
      },
    ],
  });

  await seedCompany({
    company: {
      name: "TechZone Điện máy",
      website: "https://techzone.vn",
      intro:
        "TechZone phân phối laptop và thiết bị công nghệ chính hãng, tập trung tư vấn đúng nhu cầu sử dụng thay vì bán theo cấu hình cao nhất.",
      usp: [
        "Hàng chính hãng có hoá đơn VAT",
        "Bảo hành tại chỗ 24 tháng",
        "Đổi mới trong 15 ngày nếu lỗi nhà sản xuất",
        "Miễn phí cài đặt phần mềm chuyên ngành",
      ],
      brandVoice: "Nhiệt tình, thẳng thắn, giải thích rõ thông số theo nhu cầu thực tế",
    },
    products: [
      {
        category: "Laptop",
        name: "Laptop Vega Air 14",
        sku: "LT-VEGA-A14",
        price: 18500000,
        priceAfterDiscount: 16900000,
        size: "14 inch, 1.2kg",
        material: "Vỏ nhôm",
        specs: "CPU 8 lõi tiết kiệm điện, RAM 16GB, SSD 512GB, pin 18 giờ, màn 2K",
        bestFor: ["dân văn phòng", "sinh viên", "người cần pin lâu và máy nhẹ", "ngân sách 15-19 triệu"],
        notFor: ["chơi game nặng", "dựng video 4K", "cần card đồ hoạ rời"],
        usp: ["Pin 18 giờ", "Chỉ 1.2kg", "Máy chạy êm không quạt"],
        stock: 20,
      },
      {
        category: "Laptop",
        name: "Laptop Vega Pro 16 RTX",
        sku: "LT-VEGA-P16",
        price: 42000000,
        priceAfterDiscount: 39500000,
        size: "16 inch, 2.3kg",
        material: "Vỏ hợp kim magie",
        specs: "CPU 16 lõi, RAM 32GB, SSD 1TB, card RTX rời 12GB, màn 4K chuẩn màu 100% DCI-P3",
        bestFor: ["dựng video 4K", "thiết kế 3D", "chơi game nặng", "ngân sách trên 35 triệu"],
        notFor: ["chỉ dùng văn phòng cơ bản", "cần máy nhẹ mang đi nhiều", "ngân sách dưới 30 triệu"],
        usp: ["Card RTX 12GB", "Màn 4K chuẩn màu", "RAM 32GB nâng cấp được tới 64GB"],
        stock: 6,
      },
    ],
    docs: [
      {
        source: "product",
        productName: "Laptop Vega Air 14",
        title: "Thông số chi tiết Vega Air 14",
        content:
          "Vega Air 14 dùng CPU 8 lõi kiến trúc tiết kiệm điện, điểm benchmark đa lõi tương đương laptop văn phòng cao cấp nhưng TDP chỉ 15W nên không cần quạt, máy chạy hoàn toàn im lặng. RAM 16GB hàn trên bo mạch, KHÔNG nâng cấp được — đây là hạn chế cần nói rõ với khách có nhu cầu dùng lâu dài 5 năm. SSD 512GB chuẩn NVMe, có thể thay thế bằng thanh 2TB. Màn 14 inch 2K độ sáng 400 nit, dùng ngoài trời hơi khó đọc. Pin 18 giờ đo ở tác vụ văn phòng, thực tế 12-14 giờ. Không có card đồ hoạ rời nên không phù hợp render video hoặc game 3D nặng; chơi game nhẹ và xem phim 4K thì mượt.",
      },
      {
        source: "product",
        productName: "Laptop Vega Pro 16 RTX",
        title: "Thông số chi tiết Vega Pro 16 RTX",
        content:
          "Vega Pro 16 RTX dùng CPU 16 lõi hiệu năng cao kèm card RTX rời 12GB VRAM, render video 4H timeline nhanh gấp khoảng 4 lần so với máy không card rời. RAM 32GB hai khe, nâng cấp tối đa 64GB. SSD 1TB, còn một khe M.2 trống. Màn 16 inch 4K phủ 100% DCI-P3, đã cân màu sẵn tại nhà máy, phù hợp làm nghề thiết kế in ấn và dựng phim. Nhược điểm cần nói thật với khách: máy nặng 2.3kg cộng sạc 0.6kg nên không phù hợp mang đi lại nhiều; pin chỉ 4-5 giờ tác vụ nhẹ và khoảng 1.5 giờ khi render; quạt chạy khá ồn khi tải nặng.",
      },
      {
        source: "policy",
        title: "Chính sách bảo hành và đổi mới TechZone",
        content:
          "Bảo hành chính hãng 24 tháng tại chỗ cho laptop: kỹ thuật viên tới tận nơi trong nội thành trong 48 giờ. Đổi mới máy trong 15 ngày đầu nếu có lỗi nhà sản xuất. Pin và sạc bảo hành 12 tháng. Không bảo hành lỗi do vào nước, rơi vỡ, hoặc tự tháo máy. Hỗ trợ trả góp 0% qua thẻ tín dụng kỳ hạn 6-12 tháng. Miễn phí cài đặt phần mềm chuyên ngành (Adobe, AutoCAD, SolidWorks) và chuyển dữ liệu từ máy cũ. Xuất hoá đơn VAT cho khách doanh nghiệp.",
      },
    ],
    competitors: [
      {
        competitorName: "Sàn thương mại điện tử",
        productName: "Vega Air 14 (hàng nhập khẩu)",
        productName2: "Laptop Vega Air 14",
        price: 15900000,
        source: "Khảo sát 08/2026",
        note: "Giá rẻ hơn 1 triệu nhưng là hàng nhập khẩu không chính hãng, bảo hành do shop tự bảo hành 12 tháng, không hoá đơn VAT, không có bảo hành tại chỗ.",
      },
      {
        competitorName: "Chuỗi điện máy lớn",
        productName: "Vega Pro 16 RTX",
        productName2: "Laptop Vega Pro 16 RTX",
        price: 41000000,
        source: "Khảo sát 08/2026",
        note: "Giá cao hơn 1.5 triệu, bảo hành 24 tháng nhưng phải mang máy tới trung tâm, không có bảo hành tại chỗ và không miễn phí cài phần mềm chuyên ngành.",
      },
    ],
  });

  console.log("[seed] Hoàn tất");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
