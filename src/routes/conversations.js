import { Router } from "express";
import Conversation from "../models/Conversation.js";

const router = Router();

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
