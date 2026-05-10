export const categorize = (desc) => {
    const d = desc.toLowerCase();
    if (d.includes("amazon"))
        return "Shopping";
    if (d.includes("uber"))
        return "Travel";
    if (d.includes("netflix"))
        return "Entertainment";
    if (d.includes("restaurant"))
        return "Food";
    return "Other";
};
//# sourceMappingURL=categorize.js.map