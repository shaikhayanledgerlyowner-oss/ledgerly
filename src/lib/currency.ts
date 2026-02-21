// ✅ Currency symbol map
const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED ",
  // add more as needed
};

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[(code || "INR").toUpperCase()] ?? `${code} `;
}

/**
 * Format number with currency symbol for UI display
 * e.g. formatCurrency(1000, "INR") => "₹1,000"
 */
export function formatCurrency(amount: number, currencyCode = "INR"): string {
  const sym = getCurrencySymbol(currencyCode);
  const locale = currencyCode.toUpperCase() === "INR" ? "en-IN" : "en-US";
  const formatted = Number(amount || 0).toLocaleString(locale);
  return `${sym}${formatted}`;
}

/**
 * PDF-safe currency format (no ₹ symbol — jsPDF doesn't support it)
 * e.g. formatCurrencyPDF(1000, "INR") => "Rs. 1,000.00"
 */
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
