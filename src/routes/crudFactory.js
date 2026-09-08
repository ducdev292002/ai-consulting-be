import { Router } from "express";

export function crudRouter(Model, { companyScoped = false } = {}) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const filter = {};
      if (companyScoped) {
        if (!req.query.companyId) return res.status(400).json({ error: "Thiếu companyId" });
        filter.companyId = req.query.companyId;
      }
      const items = await Model.find(filter).sort({ createdAt: 1 });
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      if (companyScoped && !req.body.companyId) {
        return res.status(400).json({ error: "Thiếu companyId" });
      }
      const item = await Model.create(req.body);
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!item) return res.status(404).json({ error: "Không tìm thấy bản ghi" });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const item = await Model.findByIdAndDelete(req.params.id);
      if (!item) return res.status(404).json({ error: "Không tìm thấy bản ghi" });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
