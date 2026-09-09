import { Router } from "express";
import Conversation from "../models/Conversation.js";
import Lead from "../models/Lead.js";

const router = Router();

router.get("/list", async (req, res, next) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });

    const [conversations, leads] = await Promise.all([
      Conversation.find({ companyId }).sort({ updatedAt: -1 }).lean(),
      Lead.find({ companyId }).lean(),
    ]);

    const leadByKey = new Map(leads.map((l) => [l.customerKey, l]));

    const summaries = conversations.map((c) => {
      const last = c.messages[c.messages.length - 1];
      return {
        customerKey: c.customerKey,
        messageCount: c.messages.length,
        lastMessage: last ? last.content : "",
        lastMessageRole: last ? last.role : null,
        lastMessageAt: last ? last.createdAt : c.updatedAt,
        stage: leadByKey.get(c.customerKey)?.stage || null,
      };
    });

    res.json(summaries);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { companyId, customerKey } = req.query;
    if (!companyId || !customerKey) {
      return res.status(400).json({ error: "Thiếu companyId hoặc customerKey" });
    }

    const conversation = await Conversation.findOne({ companyId, customerKey });
    res.json(conversation || { companyId, customerKey, messages: [] });
  } catch (err) {
    next(err);
  }
});

router.delete("/", async (req, res, next) => {
  try {
    const { companyId, customerKey } = req.query;
    if (!companyId || !customerKey) {
      return res.status(400).json({ error: "Thiếu companyId hoặc customerKey" });
    }
    await Conversation.deleteOne({ companyId, customerKey });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
