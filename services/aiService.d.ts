import "dotenv/config";
export type Transaction = {
    date: string;
    description: string;
    amount: number;
    category: string;
};
export declare const extractTransactionsAI: (text: string) => Promise<Transaction[]>;
export declare const generateInsights: (transactions: Transaction[]) => Promise<string>;
//# sourceMappingURL=aiService.d.ts.map