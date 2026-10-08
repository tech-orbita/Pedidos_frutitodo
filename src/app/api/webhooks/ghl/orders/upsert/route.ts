import type { Json } from "@/types/database";
import { describeError, invalidPayload, noStoreJson, serverError } from "@/lib/api-response";
import { formatOrderNumber, payloadHash } from "@/lib/order-utils";
import { ingestOrderSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readWebhookJson } from "@/lib/webhook-request";

export const runtime = "nodejs";

/**
 * One endpoint for every extraction requested by the GHL agent. The app, not the agent,
 * decides whether the same-day list creates a new order or replaces the active order.
 */
export async function POST(request: Request) {
  try {
    const read = await readWebhookJson(request);
    if (!read.ok) return read.response;
    const parsed = ingestOrderSchema.safeParse(read.body);
    if (!parsed.success) return invalidPayload(parsed.error);
    const input = parsed.data;
    const supabase = getSupabaseAdmin();

    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("id")
      .eq("ghl_location_id", input.locationId)
      .eq("is_active", true)
      .maybeSingle();
    if (locationError) throw locationError;
    if (!location) return noStoreJson({ error: "unknown_location", message: "La ubicación no está provisionada" }, { status: 422 });

    const rpcInput = {
      p_location_id: location.id,
      p_ghl_contact_id: input.contactId,
      p_source_event_id: input.sourceEventId,
      p_customer_name: input.customer.name,
      p_customer_phone: input.customer.phone,
      p_delivery_type: input.delivery.type,
      p_delivery_address: input.delivery.address || "",
      p_items: input.items as unknown as Json,
      p_notes: input.notes || "",
      p_payload_hash: payloadHash(input),
      p_customer_document: input.customer.document || null,
      p_payment_method: input.paymentMethod || null,
      p_conversation_id: input.conversationId || null,
    };

    const { data: amended, error: amendError } = await supabase.rpc("amend_order", rpcInput);
    if (amendError) throw amendError;
    const amendment = amended?.[0];

    if (amendment && (amendment.outcome === "amended" || amendment.outcome === "duplicate")) {
      if (amendment.outcome === "amended" && input.rawOrderText) {
        const { error } = await supabase
          .from("orders")
          .update({ raw_order_text: input.rawOrderText })
          .eq("id", amendment.order_id)
          .eq("location_id", location.id);
        if (error) throw error;
      }
      return noStoreJson({
        accepted: true,
        mode: amendment.outcome === "duplicate" ? "duplicate" : "updated",
        needsReprint: amendment.needs_reprint,
        order: { id: amendment.order_id, number: formatOrderNumber(amendment.display_sequence), status: "pending" },
      });
    }

    const { data: created, error: createError } = await supabase.rpc("ingest_order", {
      p_location_id: location.id,
      p_source_event_id: input.sourceEventId,
      p_ghl_contact_id: input.contactId,
      p_customer_name: input.customer.name,
      p_customer_phone: input.customer.phone,
      p_delivery_type: input.delivery.type,
      p_delivery_address: input.delivery.address || "",
      p_items: input.items as unknown as Json,
      p_notes: input.notes || "",
      p_payload_hash: payloadHash(input),
      p_customer_document: input.customer.document || null,
      p_payment_method: input.paymentMethod || null,
      p_conversation_id: input.conversationId || null,
      p_source: "ai",
    });
    if (createError) throw createError;
    const result = created?.[0];
    if (!result) throw new Error("ingest_order returned no result");
    if (result.payload_conflict) {
      return noStoreJson({ error: "idempotency_conflict", message: "El identificador ya existe con datos diferentes" }, { status: 409 });
    }
    if (result.was_created && input.rawOrderText) {
      const { error } = await supabase
        .from("orders")
        .update({ raw_order_text: input.rawOrderText })
        .eq("id", result.order_id)
        .eq("location_id", location.id);
      if (error) throw error;
    }

    return noStoreJson(
      {
        accepted: true,
        mode: result.was_created ? "created" : "duplicate",
        order: { id: result.order_id, number: formatOrderNumber(result.display_sequence), status: "pending" },
      },
      { status: result.was_created ? 201 : 200 },
    );
  } catch (error) {
    console.error("Automatic order upsert failed", describeError(error));
    return serverError();
  }
}
