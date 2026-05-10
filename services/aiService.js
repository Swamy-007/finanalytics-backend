import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
let openai;
let googleGenAI;
console.log("OpenAI openai Service..." + openai);
console.log("GoogleGenAI googleGenAI Service..." + googleGenAI);
const getOpenAI = () => {
    console.log("Initializing openai Service...");
    const apiKey = process.env.OPENAI_API_KEY;
    console.log("$$$$$$Using OpenAI API Key:", apiKey ? "****" + apiKey.slice(-4) : "Not Set");
    if (!openai) {
        if (!apiKey) {
            throw new Error("***********OPENAI_API_KEY is required to use the AI services. Set it in your environment before starting the server.");
        }
        openai = new OpenAI({ apiKey });
    }
    return openai;
};
const getGemini = () => {
    console.log("Initializing Gemini Service...");
    const apiKey = process.env.GEMINI_API_KEY;
    console.log("$$$$$$Using Gemini API Key:", apiKey ? "****" + apiKey.slice(-4) : "Not Set");
    if (!googleGenAI) {
        if (!apiKey) {
            throw new Error("***********GEMINI_API_KEY is required to use the AI services. Set it in your environment before starting the server.");
        }
        googleGenAI = new GoogleGenAI({ apiKey });
    }
    return googleGenAI;
};
export const extractTransactionsAI = async (text) => {
    const prompt = `
Extract credit card transactions and handle parse errors gracefully.
apply category based on description ex:AplPay KROGER LIVONIA MI 09/15 $45.67 => category: Groceries
Unexpected token should be treated as parse errors.    
don't read Personal info like name, account number, etc. Skip invalid transactions and return empty array if none found.
handle various formats and return a JSON array with:
skil invalid transactions and return empty array if none found.
Return JSON array:
date, description, amount, category
`;
    /*  const res = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt + text }],
      });
       const content = res.choices[0]?.message?.content ?? "[]";
      return JSON.parse(content);*/
    const response = await getGemini().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt + text
    });
    console.log("response.text:", response.text);
    var responseText1 = response.text || "";
    const cleaned = responseText1.replace(/```json/gi, '').replace(/```/g, '').trim();
    console.log("Cleaned response text:", cleaned);
    return response.text ? JSON.parse(cleaned) : [];
};
export const generateInsights = async (transactions) => {
    const prompt = `
Analyze transactions and give:
- top categories
- saving tips
- unusual spending
- don't include currnet credit card monthly payments if any
`;
    /*
      const res = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: prompt + JSON.stringify(transactions) },
        ],
      });
    
      return res.choices[0]?.message?.content ?? "";
    }; */
    const response = await getGemini().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt + JSON.stringify(transactions)
    });
    console.log("Insights response.text:", response.text);
    return response.text || "";
};
//# sourceMappingURL=aiService.js.map