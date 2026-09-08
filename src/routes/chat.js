import { Router } from "express";
import Company from "../models/Company.js";
import Script from "../models/Script.js";
import Lead from "../models/Lead.js";
import Order from "../models/Order.js";
import Conversation from "../models/Conversation.js";
import { buildInstructions } from "../services/promptBuilder.js";
import { buildSalesTools } from "../services/salesTools.js";
import { getOpenAIClient } from "../services/openaiClient.js";

const router = Router();

const MAX_TOOL_ROUNDS = 6;
const WEB_SEARCH_ENABLED = process.env.ENABLE_WEB_SEARCH !== "false";

function extractReply(response) {
  if (response.output_text) return response.output_text.trim();

  const messageItem = response.output?.find((item) => item.type === "message");
  const textPart = messageItem?.content?.find((part) => part.type === "output_text");
  return textPart?.text?.trim() || "(không có phản hồi)";
}

router.post("/", async (req, res, next) => {
  try {
    const { companyId, customerKey, message } = req.body;

    if (!companyId) return res.status(400).json({ error: "Thiếu companyId" });
    if (!customerKey?.trim()) return res.status(400).json({ error: "Thiếu customerKey (định danh khách)" });
    if (!message?.trim()) return res.status(400).json({ error: "message không được rỗng" });

    const company = await Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: "Không tìm thấy công ty" });

    const key = customerKey.trim();

    const [scripts, lead, conversation] = await Promise.all([
      Script.find({ companyId }).lean(),
      Lead.findOne({ companyId, customerKey: key }).lean(),
      Conversation.findOne({ companyId, customerKey: key }),
    ]);

    const convo = conversation || new Conversation({ companyId, customerKey: key, messages: [] });

    const instructions = buildInstructions({ company, lead, scripts });
    const { definitions, runByName } = buildSalesTools({ companyId, customerKey: key });

    const tools = definitions.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    if (WEB_SEARCH_ENABLED) tools.push({ type: "web_search" });

    const input = [
      ...convo.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message.trim() },
    ];

    const openai = getOpenAIClient();
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const toolCallLog = [];

    let response = await openai.responses.create({ model, instructions, input, tools });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const functionCalls = (response.output || []).filter((item) => item.type === "function_call");
      const usedWebSearch = (response.output || []).some((item) => item.type === "web_search_call");
      if (usedWebSearch) toolCallLog.push({ name: "web_search", args: {} });

      if (functionCalls.length === 0) break;

      input.push(...response.output);

      for (const call of functionCalls) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = {};
        }

        const result = await runByName(call.name, args);
        toolCallLog.push({ name: call.name, args });

        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }

      response = await openai.responses.create({ model, instructions, input, tools });
    }

    const reply = extractReply(response);

    convo.messages.push({ role: "user", content: message.trim() });
    convo.messages.push({
      role: "assistant",
      content: reply,
      toolCalls: toolCallLog.map((t) => t.name),
    });
    await convo.save();

    const [updatedLead, latestOrder] = await Promise.all([
      Lead.findOne({ companyId, customerKey: key }).lean(),
      Order.findOne({ companyId, customerKey: key }).sort({ createdAt: -1 }).lean(),
    ]);

    res.json({
      reply,
      toolCalls: toolCallLog,
      lead: updatedLead,
      order: latestOrder,
      messages: convo.messages,
      instructions,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
