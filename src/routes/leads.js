import { Router } from "express";
import Lead from "../models/Lead.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { companyId, customerKey } = req.query;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });

    if (customerKey) {
      const lead = await Lead.findOne({ companyId, customerKey });
      return res.json(lead || null);
    }

    const leads = await Lead.find({ companyId }).sort({ updatedAt: -1 });
    res.json(leads);
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
    await Lead.deleteOne({ companyId, customerKey });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
