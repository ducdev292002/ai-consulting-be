import OpenAI from "openai";

let client = null;

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw Object.assign(new Error("Server chưa cấu hình OPENAI_API_KEY"), { status: 500 });
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}
