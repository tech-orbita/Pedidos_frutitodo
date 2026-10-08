import { describe, expect, it } from "vitest";
import { diffOrderLines, orderItemsToText, parseOrderText } from "./order-text";

describe("parseOrderText", () => {
  it("preserves every pasted line verbatim", () => {
    const text = "Papa capira bien grande\nQueso costeño suave";
    expect(orderItemsToText(parseOrderText(text))).toBe(text);
  });

  it.each([
    ["5 mil de papa", 5000],
    ["$7.000 de queso", 7000],
    ["5000mil de papa", 5000],
    ["7000 de queso", 7000],
  ])("accepts %s as a quantity by value", (text, amount) => {
    expect(parseOrderText(text)[0]).toMatchObject({ quantity: amount, unit: "COP", quantityKind: "amount", rawText: text });
  });

  it("still understands physical quantities", () => {
    expect(parseOrderText("2 libras de papa")[0]).toMatchObject({ name: "papa", quantity: 2, unit: "lb" });
  });
});

describe("diffOrderLines", () => {
  const printed = { rawOrderText: "2 kg de arroz\n3 lb de tomate", items: [] };

  it("marks only the annexed lines as new", () => {
    const current = { rawOrderText: "2 kg de arroz\n3 lb de tomate\n2 pechugas blancas", items: [] };
    expect(diffOrderLines(printed, current)).toEqual({
      lines: [
        { text: "2 kg de arroz", added: false },
        { text: "3 lb de tomate", added: false },
        { text: "2 pechugas blancas", added: true },
      ],
      removed: [],
    });
  });

  it("ignores case, accents and bullets but reports changed and removed lines", () => {
    const current = { rawOrderText: "- 2 KG DE ARRÓZ\n5 lb de tomate", items: [] };
    expect(diffOrderLines(printed, current)).toEqual({
      lines: [
        { text: "- 2 KG DE ARRÓZ", added: false },
        { text: "5 lb de tomate", added: true },
      ],
      removed: ["3 lb de tomate"],
    });
  });

  it("highlights nothing before the first print", () => {
    const diff = diffOrderLines(null, { rawOrderText: null, items: [{ name: "papa", quantity: 2, unit: "lb" }] });
    expect(diff).toEqual({ lines: [{ text: "2 lb papa", added: false }], removed: [] });
  });
});
