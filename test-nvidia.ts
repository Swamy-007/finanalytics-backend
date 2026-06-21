import { extractTransactionsAI, generateInsights } from "./services/aiService.js";
import "dotenv/config";

const testText = `
APPLE CARD STATEMENT
Date: 2024-01-15 to 2024-02-14

Transaction History:
Apple Pay - KROGER LIVONIA MI 09/15 $45.67
Starbucks Coffee #1234 - 09/16 $8.50
Amazon - Digital Purchase 09/18 $29.99
Whole Foods Market - 09/20 $87.23
Shell Gas Station - 09/21 $52.40
Netflix Subscription - 09/25 $15.99
`;

async function test() {
  try {
    console.log("🧪 Testing NVIDIA API Integration...\n");
    
    console.log("📝 Testing extractTransactionsAI...");
    const transactions = await extractTransactionsAI(testText);
    console.log("✅ Transactions extracted:", JSON.stringify(transactions, null, 2));
    
    console.log("\n📊 Testing generateInsights...");
    const insights = await generateInsights(transactions);
    console.log("✅ Insights generated:", insights);
    
    console.log("\n✨ All tests passed! NVIDIA API is working correctly.");
  } catch (error) {
    console.error("❌ Test failed:", error);
    if (error instanceof Error && 'response' in error) {
      const axiosError = error as any;
      console.error("\n📋 Response Status:", axiosError.response?.status);
      console.error("📋 Response Data:", axiosError.response?.data);
    }
    process.exit(1);
  }
}

test();
