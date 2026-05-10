export const detectSubscriptions = (transactions) => {
    const map = {};
    transactions.forEach((t) => {
        const key = t.description;
        const group = map[key] ?? [];
        group.push(t);
        map[key] = group;
    });
    return Object.keys(map).filter((k) => {
        const group = map[k];
        return (group?.length ?? 0) >= 3;
    });
};
//# sourceMappingURL=subscriptions.js.map