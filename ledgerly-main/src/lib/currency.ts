const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED ",
};

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[(code || "INR").toUpperCase()] ?? `${code} `;
}

export function formatCurrency(amount: number, currencyCode = "INR"): string {
  const sym = getCurrencySymbol(currencyCode);
  const locale = currencyCode.toUpperCase() === "INR" ? "en-IN" : "en-US";
  const formatted = Number(amount || 0).toLocaleString(locale);
  return `${sym}${formatted}`;
}

export function formatCurrencyPDF(amount: number, currencyCode = "INR"): string {
  const code = (currencyCode || "INR").toUpperCase();
  const locale = code === "INR" ? "en-IN" : "en-US";
  const formatted = Number(amount || 0).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (code === "INR") return `Rs. ${formatted}`;
  const map: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", AED: "AED " };
  const sym = map[code] ?? `${code} `;
  return `${sym}${formatted}`;
}
