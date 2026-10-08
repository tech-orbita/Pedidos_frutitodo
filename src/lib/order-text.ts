import type { OrderItem } from "@/types/orders";

const UNIT_ALIASES: Array<[RegExp, string]> = [
  [/^(?:kg|kilo|kilos|kilogramo|kilogramos)$/i, "kg"],
  [/^(?:lb|libra|libras)$/i, "lb"],
  [/^(?:g|gr|gramo|gramos)$/i, "g"],
  [/^(?:und|unidad|unidades)$/i, "unidad"],
  [/^(?:docena|docenas)$/i, "docena"],
  [/^(?:paquete|paquetes|paq)$/i, "paquete"],
  [/^(?:bulto|bultos)$/i, "bulto"],
  [/^(?:caja|cajas)$/i, "caja"],
];

function numericValue(value: string): number {
  const compact = value.replace(/\s/g, "");
  if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) return Number(compact.replace(/\./g, ""));
  if (/^\d{1,3}(?:,\d{3})+$/.test(compact)) return Number(compact.replace(/,/g, ""));
  return Number(compact.replace(",", "."));
}

function cleanLine(value: string): string {
  return value.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

/**
 * Turns a pasted WhatsApp list into operational lines without replacing the original
 * wording. `rawText` is what the panel and ticket display; the parsed fields only support
 * searching and quoting. Colombian "5 mil de papa" is represented as 5,000 pesos.
 */
export function parseOrderText(value: string): OrderItem[] {
  const lines = value
    .split(/\r?\n|;+/)
    .flatMap((line) => (line.includes(",") && !/\d,\d/.test(line) ? line.split(",") : [line]))
    .map(cleanLine)
    .filter(Boolean);

  return lines.map((rawText) => {
    const withDe = rawText.match(/^\$?\s*([\d.,]+)\s*(mil|k)?\s*(?:pesos?)?\s+de\s+(.+)$/i);
    if (withDe) {
      let amount = numericValue(withDe[1]);
      const suffix = withDe[2]?.toLowerCase();
      if (suffix && amount < 1000) amount *= 1000;
      const unit = UNIT_ALIASES.find(([pattern]) => pattern.test(suffix || ""))?.[1];
      const monetary = !unit && (Boolean(suffix) || amount >= 1000 || rawText.trim().startsWith("$"));
      return {
        name: withDe[3].trim(),
        quantity: amount,
        ...(monetary ? { unit: "COP", quantityKind: "amount" as const } : unit ? { unit } : {}),
        rawText,
      };
    }

    const measured = rawText.match(/^([\d.,]+)\s*([A-Za-záéíóúñ.]+)\s+(.+)$/i);
    if (measured) {
      const unit = UNIT_ALIASES.find(([pattern]) => pattern.test(measured[2].replace(/\.$/, "")))?.[1];
      if (unit) return { name: measured[3].replace(/^de\s+/i, "").trim(), quantity: numericValue(measured[1]), unit, rawText };
    }

    return { name: rawText, quantity: 1, rawText };
  });
}

export function orderItemsToText(items: OrderItem[]): string {
  return items
    .map((item) => item.rawText?.trim() || `${item.quantity}${item.unit ? ` ${item.unit}` : ""} ${item.name}`.trim())
    .join("\n");
}

export type OrderTextSource = { rawOrderText: string | null; items: OrderItem[] };

export type OrderLineDiff = {
  lines: Array<{ text: string; added: boolean }>;
  removed: string[];
};

/** The lines a picker reads: the customer's own text when present, otherwise the parsed items. */
export function orderLines(order: OrderTextSource): string[] {
  const text = order.rawOrderText?.trim() || orderItemsToText(order.items);
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function comparableLine(line: string): string {
  return cleanLine(line)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Compares the order with what the last printed ticket said, so a reprinted annex highlights
 * exactly what the picker does not have yet. Matching is per line and tolerant to case,
 * accents and bullets; a changed quantity shows as one new line and one removed line.
 */
export function diffOrderLines(printed: OrderTextSource | null, current: OrderTextSource): OrderLineDiff {
  const currentLines = orderLines(current);
  if (!printed) return { lines: currentLines.map((text) => ({ text, added: false })), removed: [] };

  const pending = new Map<string, string[]>();
  for (const line of orderLines(printed)) {
    const key = comparableLine(line);
    pending.set(key, [...(pending.get(key) || []), line]);
  }
  const lines = currentLines.map((text) => {
    const matches = pending.get(comparableLine(text));
    if (!matches?.length) return { text, added: true };
    matches.shift();
    return { text, added: false };
  });
  return { lines, removed: [...pending.values()].flat() };
}
