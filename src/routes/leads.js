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

// Nhân viên tự sửa phiếu khách bằng tay — dùng khi hội thoại đang ở mode "human" (AI không chạy
// nên không tool nào tự trích thông tin ngoài SĐT). Chỉ ghi đè các trường thực sự được gửi lên.
const EDITABLE_FIELDS = ["needType", "budget", "spaceInfo", "concerns", "phone", "area", "stage"];

router.patch("/", async (req, res, next) => {
  try {
    const { companyId, customerKey, ...rest } = req.body;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!customerKey?.trim()) return res.status(400).json({ error: "Thiếu customerKey (định danh khách)" });

    const update = {};
    for (const field of EDITABLE_FIELDS) {
      if (rest[field] !== undefined) update[field] = rest[field];
    }

    const key = customerKey.trim();
    const lead = await Lead.findOneAndUpdate(
      { companyId, customerKey: key },
      { $set: update, $setOnInsert: { companyId, customerKey: key } },
      { new: true, upsert: true, runValidators: true }
    );

    res.json(lead);
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
