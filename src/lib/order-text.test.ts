import { describe, expect, it } from "vitest";
import { orderItemsToText, parseOrderText } from "./order-text";

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
