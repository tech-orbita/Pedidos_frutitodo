import { describe, expect, it } from "vitest";
import {
  helpRequestIngestSchema,
  ingestOrderSchema,
  manualOrderSchema,
  orderEditSchema,
  quoteRequestSchema,
} from "@/lib/schemas";

const validOrder = {
  sourceEventId: "order_12345678",
  locationId: "location-123",
  contactId: "contact-123",
  customer: { name: "María Pérez", phone: "+57 300 123 4567" },
  delivery: { type: "domicilio", address: "Calle 10 # 20-30" },
  items: [{ name: "Aguacate Hass", quantity: 1.5, unit: "kg" }],
  notes: "Llamar al llegar",
};

describe("ingestOrderSchema", () => {
  it("accepts a complete deterministic order", () => {
    expect(ingestOrderSchema.parse(validOrder)).toMatchObject(validOrder);
  });

  it("parses the GHL long-text products field", () => {
    const parsed = ingestOrderSchema.parse({
      ...validOrder,
      items: JSON.stringify(validOrder.items),
    });
    expect(parsed.items).toEqual(validOrder.items);
  });

  it("allows delivery without an address so dispatch can contact the client", () => {
    const parsed = ingestOrderSchema.safeParse({
      ...validOrder,
      delivery: { type: "domicilio", address: "" },
    });
    expect(parsed.success).toBe(true);
  });

  it("allows pickup without an address", () => {
    const parsed = ingestOrderSchema.safeParse({
      ...validOrder,
      delivery: { type: "recogida" },
    });
    expect(parsed.success).toBe(true);
  });

  it("defaults missing delivery data to an address-pending delivery", () => {
    const withoutDelivery = Object.fromEntries(Object.entries(validOrder).filter(([key]) => key !== "delivery"));
    expect(ingestOrderSchema.parse(withoutDelivery).delivery).toEqual({ type: "domicilio" });
  });

  it("rejects empty, negative or oversized product lists", () => {
    expect(ingestOrderSchema.safeParse({ ...validOrder, items: [] }).success).toBe(false);
    expect(
      ingestOrderSchema.safeParse({ ...validOrder, items: [{ name: "Arroz", quantity: -1 }] }).success,
    ).toBe(false);
    expect(
      ingestOrderSchema.safeParse({ ...validOrder, items: Array.from({ length: 101 }, () => validOrder.items[0]) }).success,
    ).toBe(false);
  });
});

describe("ingestOrderSchema optional fields", () => {
  it("accepts the document, payment method and conversation from n8n", () => {
    const parsed = ingestOrderSchema.parse({
      ...validOrder,
      conversationId: "61PklkWIorEaDwT7KFAN",
      paymentMethod: "Transferencia",
      customer: { ...validOrder.customer, document: "1020304050" },
    });
    expect(parsed.customer.document).toBe("1020304050");
    expect(parsed.paymentMethod).toBe("Transferencia");
    expect(parsed.conversationId).toBe("61PklkWIorEaDwT7KFAN");
  });

  it("treats the empty strings GHL sends for unfilled fields as absent", () => {
    const parsed = ingestOrderSchema.parse({
      ...validOrder,
      conversationId: "",
      paymentMethod: "  ",
      customer: { ...validOrder.customer, document: "" },
    });
    expect(parsed.customer.document).toBeUndefined();
    expect(parsed.paymentMethod).toBeUndefined();
    expect(parsed.conversationId).toBeUndefined();
  });
});

describe("manualOrderSchema", () => {
  const manual = {
    requestId: "11111111-1111-4111-8111-111111111111",
    customer: { name: "Don Luis", phone: "3001234567" },
    delivery: { type: "recogida" },
    items: [{ name: "Tomate chonto", quantity: 2, unit: "lb" }],
    rawOrderText: "2 lb de tomate chonto",
  };

  it("accepts a phone order without a GHL contact", () => {
    expect(manualOrderSchema.safeParse(manual).success).toBe(true);
  });

  it("allows delivery without an address", () => {
    expect(manualOrderSchema.safeParse({ ...manual, delivery: { type: "domicilio" } }).success).toBe(true);
  });
});

describe("orderEditSchema", () => {
  const edit = {
    requestId: "22222222-2222-4222-8222-222222222222",
    operator: "Isabel",
    customer: { name: "Don Luis", phone: "3001234567", document: "123456" },
    delivery: { type: "domicilio", address: "Calle 5 # 10-20" },
    paymentMethod: "Efectivo",
    items: [{ name: "Tomate chonto", quantity: 2, unit: "lb" }],
    rawOrderText: "2 lb de tomate chonto",
    notes: "Sin bolsa",
  };

  it("accepts all editable order fields", () => {
    expect(orderEditSchema.parse(edit)).toMatchObject(edit);
  });

  it("allows missing delivery addresses on edits", () => {
    expect(orderEditSchema.safeParse({ ...edit, delivery: { type: "domicilio" } }).success).toBe(true);
    expect(orderEditSchema.safeParse({ ...edit, delivery: { type: "recogida" } }).success).toBe(true);
  });
});

describe("helpRequestIngestSchema", () => {
  it("needs only the location and the contact", () => {
    expect(helpRequestIngestSchema.safeParse({ locationId: "location-123", contactId: "contact-1" }).success).toBe(true);
  });

  it("rejects a request without a contact", () => {
    expect(helpRequestIngestSchema.safeParse({ locationId: "location-123", contactId: "" }).success).toBe(false);
  });
});

describe("quoteRequestSchema", () => {
  const request = {
    requestId: "11111111-1111-4111-8111-111111111111",
    lines: [{ name: "PECHUGA", quantity: "1,5".replace(",", "."), unit: "lb", unitPrice: 12000 }],
  };

  it("defaults to saving a draft that also updates catalog prices", () => {
    const parsed = quoteRequestSchema.parse(request);
    expect(parsed.send).toBe(false);
    expect(parsed.updateCatalogPrices).toBe(true);
    expect(parsed.deliveryFee).toBe(0);
    expect(parsed.lines[0].quantity).toBe(1.5);
  });

  it("rejects an empty quote and negative prices", () => {
    expect(quoteRequestSchema.safeParse({ ...request, lines: [] }).success).toBe(false);
    expect(
      quoteRequestSchema.safeParse({ ...request, lines: [{ name: "X", quantity: 1, unitPrice: -1 }] }).success,
    ).toBe(false);
  });
});
