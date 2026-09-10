import { Router } from "express";
import Lead, { LEAD_STAGES } from "../models/Lead.js";
import Order from "../models/Order.js";
import Conversation from "../models/Conversation.js";

const router = Router();

// Gộp mọi số liệu tổng quan cho 1 công ty trong 1 lần gọi (phễu lead, doanh thu/đơn hàng,
// AI vs nhân viên, hoạt động hội thoại) — dữ liệu ở quy mô demo nên tính trực tiếp bằng JS
// sau khi load, không cần pipeline aggregate phức tạp.
router.get("/", async (req, res, next) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });

    const [leads, orders, conversations] = await Promise.all([
      Lead.find({ companyId }).lean(),
      Order.find({ companyId }).lean(),
      Conversation.find({ companyId }).lean(),
    ]);

    const leadFunnel = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0]));
    for (const lead of leads) {
      if (leadFunnel[lead.stage] !== undefined) leadFunnel[lead.stage] += 1;
    }

    const ordersByStatus = { draft: 0, confirmed: 0 };
    let totalRevenue = 0;
    const productTotals = new Map();
    for (const order of orders) {
      if (ordersByStatus[order.status] !== undefined) ordersByStatus[order.status] += 1;
      totalRevenue += order.total || 0;
      for (const item of order.items || []) {
        const key = item.name || "Không rõ tên";
        const current = productTotals.get(key) || { name: key, qty: 0, revenue: 0 };
        current.qty += item.qty || 0;
        current.revenue += (item.price || 0) * (item.qty || 0);
        productTotals.set(key, current);
      }
    }
    const topProducts = [...productTotals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    const conversationsByMode = { ai: 0, human: 0 };
    const messagesByRole = { user: 0, assistant: 0, staff: 0 };
    let totalMessages = 0;
    for (const convo of conversations) {
      const mode = convo.mode === "human" ? "human" : "ai";
      conversationsByMode[mode] += 1;
      for (const msg of convo.messages || []) {
        totalMessages += 1;
        if (messagesByRole[msg.role] !== undefined) messagesByRole[msg.role] += 1;
      }
    }

    // Số hội thoại MỚI theo từng ngày trong 14 ngày gần nhất (theo createdAt) — dựng biểu đồ đơn giản.
    const DAYS = 14;
    const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
    const dailyCounts = new Map();
    const today = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dailyCounts.set(dayKey(d), 0);
    }
    for (const convo of conversations) {
      const key = dayKey(convo.createdAt);
      if (dailyCounts.has(key)) dailyCounts.set(key, dailyCounts.get(key) + 1);
    }
    const dailyNewConversations = [...dailyCounts.entries()].map(([date, count]) => ({ date, count }));

    res.json({
      leadFunnel,
      totalLeads: leads.length,
      orders: {
        totalOrders: orders.length,
        totalRevenue,
        ordersByStatus,
        topProducts,
      },
      conversations: {
        totalConversations: conversations.length,
        totalMessages,
        messagesByRole,
        conversationsByMode,
        dailyNewConversations,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
