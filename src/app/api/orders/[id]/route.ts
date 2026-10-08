import type { Json } from "@/types/database";
import { describeError, invalidPayload, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { payloadHash, rowToOrder } from "@/lib/order-utils";
import { getPanelAccess } from "@/lib/panel-auth";
import { actionRequestSchema, orderEditSchema } from "@/lib/schemas";
import type { IngestOrderInput } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const EDITABLE_STATUSES = ["pending", "printed"] as const;

function unavailableOrder() {
  return noStoreJson(
    {
      error: "order_not_editable",
      message: "Solo puedes modificar pedidos nuevos o en preparación",
    },
    { status: 409 },
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getPanelAccess(request);
    if (!access || access.role !== "operator") return unauthorized();
    const { id } = await context.params;

    const parsed = orderEditSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);
    const input = parsed.data;
    const supabase = getSupabaseAdmin();

    const { data: current, error: currentError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .eq("location_id", access.locationId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return noStoreJson({ error: "not_found", message: "Pedido no encontrado" }, { status: 404 });
    if (!EDITABLE_STATUSES.includes(current.status as (typeof EDITABLE_STATUSES)[number])) return unavailableOrder();

    const normalizedItems = input.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      ...(item.unit ? { unit: item.unit } : {}),
    }));
    const itemsChanged = JSON.stringify(current.items) !== JSON.stringify(normalizedItems);
    const hashInput: IngestOrderInput = {
      sourceEventId: current.source_event_id,
      locationId: access.ghlLocationId,
      contactId: current.ghl_contact_id || "",
      conversationId: current.conversation_id,
      customer: input.customer,
      delivery: input.delivery,
      paymentMethod: input.paymentMethod,
      items: normalizedItems,
      rawOrderText: input.rawOrderText,
      notes: input.notes,
    };
    const now = new Date().toISOString();
    const searchText = [
      current.source_event_id,
      current.ghl_contact_id,
      input.customer.name,
      input.customer.phone,
      input.customer.document,
      input.delivery.address,
      JSON.stringify(normalizedItems),
      input.rawOrderText,
      input.notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const { data: saved, error: saveError } = await supabase
      .from("orders")
      .update({
        customer_name: input.customer.name,
        customer_phone: input.customer.phone,
        customer_document: input.customer.document || null,
        payment_method: input.paymentMethod || null,
        delivery_type: input.delivery.type,
        delivery_address: input.delivery.type === "domicilio" ? input.delivery.address || null : null,
        items: normalizedItems as unknown as Json,
        raw_order_text: input.rawOrderText,
        notes: input.notes || null,
        payload_hash: payloadHash(hashInput),
        search_text: searchText,
        status: "pending",
        last_amended_at: now,
        amendment_count: current.amendment_count + 1,
        ...(itemsChanged
          ? {
              quote: null,
              quoted_total: null,
              quoted_at: null,
              quote_sent_by: null,
              quote_message_id: null,
              quote_request_id: null,
            }
          : {}),
      })
      .eq("id", current.id)
      .eq("location_id", access.locationId)
      .eq("updated_at", current.updated_at)
      .in("status", EDITABLE_STATUSES)
      .select("*")
      .maybeSingle();
    if (saveError) throw saveError;
    if (!saved) return unavailableOrder();

    return noStoreJson({
      order: rowToOrder(saved),
      returnedToPending: current.status === "printed",
      quoteCleared: itemsChanged && current.quote !== null,
    });
  } catch (error) {
    console.error("Order edit failed", describeError(error));
    return serverError();
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getPanelAccess(request);
    if (!access || access.role !== "operator") return unauthorized();
    const { id } = await context.params;
    const parsed = actionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);

    const supabase = getSupabaseAdmin();
    const { data: current, error: currentError } = await supabase
      .from("orders")
      .select("id, status, updated_at")
      .eq("id", id)
      .eq("location_id", access.locationId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return noStoreJson({ error: "not_found", message: "Pedido no encontrado" }, { status: 404 });
    if (!EDITABLE_STATUSES.includes(current.status as (typeof EDITABLE_STATUSES)[number])) return unavailableOrder();

    const { data: deleted, error: deleteError } = await supabase
      .from("orders")
      .delete()
      .eq("id", current.id)
      .eq("location_id", access.locationId)
      .eq("updated_at", current.updated_at)
      .in("status", EDITABLE_STATUSES)
      .select("id")
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) return unavailableOrder();

    return noStoreJson({ deleted: true, id: deleted.id });
  } catch (error) {
    console.error("Order deletion failed", describeError(error));
    return serverError();
  }
}
