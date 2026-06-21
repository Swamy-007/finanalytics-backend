import "dotenv/config";

import axios from 'axios';

const invokeUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
const stream = false;

const headers = {
  Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
  Accept: stream ? "text/event-stream" : "application/json"
};

const prompt_nvidia = `
Extract credit card transactions and handle parse errors gracefully.
Apply category based on description ex: AplPay KROGER LIVONIA MI 09/15 $45.67 => category: Groceries
Unexpected tokens should be treated as parse errors.    
Don't read Personal info like name, account number, etc. Skip invalid transactions and return an empty array if none are found.
Handle various formats and return a JSON array with: date, description, amount, category.
Return ONLY a valid JSON array.
`;

const payload = {
  model: "google/gemma-4-31b-it",
  messages: [{ role: "user", content: prompt_nvidia }],
  max_tokens: 16384,
  temperature: 1.0,
  top_p: 0.95,
  stream,
  chat_template_kwargs: { enable_thinking: true },
};



export type Transaction = {
  date: string;
  description: string;
  amount: number;
  category: string;
};

export const extractTransactionsAI = async (
  text: string
): Promise<Transaction[]> => {
  const prompt = `
Extract credit card transactions and handle parse errors gracefully.
Apply category based on description ex: AplPay KROGER LIVONIA MI 09/15 $45.67 => category: Groceries
Unexpected tokens should be treated as parse errors.    
Don't read Personal info like name, account number, etc. Skip invalid transactions and return an empty array if none are found.
Handle various formats and return a JSON array with: date, description, amount, category.
Return ONLY a valid JSON array.
`;

  const requestPayload = {
    model: "google/gemma-4-31b-it",
    messages: [{ role: "user", content: prompt + text }],
    max_tokens: 16384,
    temperature: 1.0,
    top_p: 0.95,
    stream: false,
    chat_template_kwargs: { enable_thinking: true },
  };

  try {
    const response = await axios.post(invokeUrl, requestPayload, {
      headers: headers,
      responseType: 'json'
    });

    const responseText = response.data.choices?.[0]?.message?.content || "";
    const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

    return cleaned ? JSON.parse(cleaned) : [];
  } catch (error) {
    console.error("Failed to call NVIDIA API:", error);
    return [];
  }
};

export const generateInsights = async (
  transactions: Transaction[]
): Promise<string> => {
  const prompt = `
Analyze transactions and give:
- You are a financial assistant providing insights based on credit card transactions.
- Top categories
- Saving tips
- Unusual spending
- Prediction of next month's spending based on current month trends.
- Don't include current credit card monthly payments if any.
`;

  const requestPayload = {
    model: "google/gemma-4-31b-it",
    messages: [{ role: "user", content: prompt + JSON.stringify(transactions) }],
    max_tokens: 16384,
    temperature: 1.0,
    top_p: 0.95,
    stream: false,
    chat_template_kwargs: { enable_thinking: true },
  };

  try {
    const response = await axios.post(invokeUrl, requestPayload, {
      headers: headers,
      responseType: 'json'
    });

    return response.data.choices?.[0]?.message?.content || "";
  } catch (error) {
    console.error("Failed to call NVIDIA API:", error);
    return "";
  }
};