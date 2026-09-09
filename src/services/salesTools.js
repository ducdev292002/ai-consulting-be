import mongoose from "mongoose";
import Product from "../models/Product.js";
import KnowledgeDoc from "../models/KnowledgeDoc.js";
import Lead, { LEAD_STAGES } from "../models/Lead.js";
import Order from "../models/Order.js";
import { searchKnowledge } from "./embeddings.js";

const isValidId = (id) => mongoose.isValidObjectId(id);

const formatProduct = (p) => ({
  productId: String(p._id),
  name: p.name,
  category: p.category,
  price: p.price,
  priceAfterDiscount: p.priceAfterDiscount,
  size: p.size,
  material: p.material,
  bestFor: p.bestFor,
  notFor: p.notFor,
  usp: p.usp,
  stock: p.stock,
});

export function buildSalesTools({ companyId, customerKey }) {
  const definitions = [
    {
      name: "searchProducts",
      description:
        "Tìm sản phẩm của công ty theo nhu cầu khách. Dùng sau khi đã biết ngân sách hoặc loại sản phẩm khách cần. Trả về danh sách sản phẩm kèm bestFor/notFor để tư vấn đúng.",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Từ khoá tên sản phẩm hoặc ngành hàng, VD: sofa, giường" },
          maxPrice: { type: "number", description: "Ngân sách tối đa của khách (VNĐ)" },
          minPrice: { type: "number", description: "Ngân sách tối thiểu (VNĐ)" },
        },
        required: [],
      },
      run: async ({ keyword, maxPrice, minPrice }) => {
        const filter = { companyId };
        if (keyword) {
          filter.$or = [
            { name: new RegExp(keyword, "i") },
            { category: new RegExp(keyword, "i") },
            { material: new RegExp(keyword, "i") },
          ];
        }
        if (maxPrice || minPrice) {
          filter.price = {};
          if (maxPrice) filter.price.$lte = maxPrice;
          if (minPrice) filter.price.$gte = minPrice;
        }
        const products = await Product.find(filter).limit(10).lean();
        return { count: products.length, products: products.map(formatProduct) };
      },
    },
    {
      name: "getProductDetail",
      description:
        "Lấy chi tiết một sản phẩm kèm các tài liệu riêng của sản phẩm đó (catalogue, thông số, hướng dẫn). Dùng khi khách hỏi sâu về một sản phẩm cụ thể.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string", description: "ID sản phẩm lấy từ searchProducts" },
        },
        required: ["productId"],
      },
      run: async ({ productId }) => {
        if (!isValidId(productId)) {
          return { error: "productId không hợp lệ. Hãy gọi searchProducts trước để lấy đúng productId thật." };
        }
        const product = await Product.findOne({ _id: productId, companyId }).lean();
        if (!product) return { error: "Không tìm thấy sản phẩm" };
        const docs = await KnowledgeDoc.find({ companyId, productId }).select("title content source").lean();
        return {
          product: { ...formatProduct(product), specs: product.specs },
          documents: docs.map((d) => ({ title: d.title, source: d.source, content: d.content.slice(0, 3000) })),
        };
      },
    },
    {
      name: "searchCompanyKnowledge",
      description:
        "Tìm trong tri thức của công ty (giới thiệu công ty, chính sách bảo hành/đổi trả/giao hàng, kiến thức ngành, tài liệu lấy từ web). Dùng khi khách hỏi về chính sách, quy trình, hoặc kiến thức chuyên môn.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Câu hỏi hoặc chủ đề cần tra cứu" },
        },
        required: ["query"],
      },
      run: async ({ query }) => {
        const results = await searchKnowledge({ companyId, query, limit: 5 });
        return {
          count: results.length,
          passages: results.map((r) => ({ title: r.docTitle, source: r.source, text: r.text })),
        };
      },
    },
    {
      name: "updateLead",
      description:
        "Ghi lại thông tin khách vừa tiết lộ (nhu cầu, ngân sách, không gian, lo ngại, SĐT, khu vực) và cập nhật giai đoạn hội thoại. Gọi ngay khi khách cung cấp thông tin mới.",
      parameters: {
        type: "object",
        properties: {
          needType: { type: "string", description: "Loại sản phẩm khách cần" },
          budget: { type: "string", description: "Ngân sách khách nói" },
          spaceInfo: { type: "string", description: "Thông tin không gian/hoàn cảnh sử dụng" },
          concerns: { type: "array", items: { type: "string" }, description: "Các lo ngại của khách" },
          phone: { type: "string", description: "Số điện thoại khách để lại" },
          area: { type: "string", description: "Khu vực/địa chỉ khách" },
          stage: { type: "string", enum: LEAD_STAGES, description: "Giai đoạn hội thoại hiện tại" },
        },
        required: [],
      },
      run: async (args) => {
        const update = {};
        for (const [key, value] of Object.entries(args)) {
          if (value !== undefined && value !== null && value !== "") update[key] = value;
        }
        const lead = await Lead.findOneAndUpdate(
          { companyId, customerKey },
          { $set: update, $setOnInsert: { companyId, customerKey } },
          { new: true, upsert: true }
        ).lean();
        return { saved: true, lead };
      },
    },
    {
      name: "createOrder",
      description:
        "Tạo đơn hàng nháp khi khách đã đồng ý mua. Chỉ gọi khi khách xác nhận muốn chốt sản phẩm cụ thể.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "Danh sách sản phẩm khách chốt",
            items: {
              type: "object",
              properties: {
                productId: { type: "string" },
                qty: { type: "number" },
              },
              required: ["productId"],
            },
          },
          deliveryArea: { type: "string", description: "Khu vực giao hàng" },
          note: { type: "string", description: "Ghi chú thêm của khách" },
        },
        required: ["items"],
      },
      run: async ({ items, deliveryArea, note }) => {
        const resolved = [];
        const invalidIds = [];

        for (const item of items || []) {
          if (!isValidId(item.productId)) {
            invalidIds.push(item.productId);
            continue;
          }
          const product = await Product.findOne({ _id: item.productId, companyId }).lean();
          if (!product) {
            invalidIds.push(item.productId);
            continue;
          }
          const price = product.priceAfterDiscount ?? product.price;
          resolved.push({
            productId: product._id,
            name: product.name,
            qty: item.qty || 1,
            price,
          });
        }

        if (resolved.length === 0) {
          return {
            error:
              "Không có sản phẩm hợp lệ để tạo đơn. productId phải lấy từ kết quả searchProducts, không được tự đặt.",
            invalidIds,
          };
        }

        const total = resolved.reduce((sum, i) => sum + i.price * i.qty, 0);
        const order = await Order.create({
          companyId,
          customerKey,
          items: resolved,
          total,
          deliveryArea: deliveryArea || "",
          note: note || "",
        });

        await Lead.findOneAndUpdate(
          { companyId, customerKey },
          { $set: { stage: "won" }, $setOnInsert: { companyId, customerKey } },
          { upsert: true }
        );

        return { orderId: String(order._id), items: resolved, total, status: order.status };
      },
    },
  ];

  const runByName = async (name, args) => {
    const tool = definitions.find((t) => t.name === name);
    if (!tool) return { error: `Tool ${name} không tồn tại` };
    return tool.run(args || {});
  };

  return { definitions, runByName };
}
