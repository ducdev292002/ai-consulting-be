import { Router } from "express";
import Order from "../models/Order.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { companyId, customerKey } = req.query;
    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });

    const filter = { companyId };
    if (customerKey) filter.customerKey = customerKey;

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!order) return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
