import { describeError, invalidPayload, noStoreJson, serverError } from "@/lib/api-response";
import { orderLines } from "@/lib/order-text";
import { formatOrderNumber, startOfTodayInBogota } from "@/lib/order-utils";
import { orderContextSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readWebhookJson } from "@/lib/webhook-request";
import type { OrderItem } from "@/types/orders";

export const runtime = "nodejs";

/**
 * Tells n8n where the customer's current order stands before it reads the chat:
 * - `openOrder`: today's order that has not been dispatched. Anything the customer asks for
 *   is an annex to it, even while it is being prepared.
 * - `since`: only GHL messages after this instant are new. For an open order it is the last
 *   message already read into it; otherwise the later of midnight in Bogota and the last
 *   dispatch, so a dispatched order is never read, or summed, again.
 */
export async function POST(request: Request) {
  try {
    const read = await readWebhookJson(request);
    if (!read.ok) return read.response;
    const parsed = orderContextSchema.safeParse(read.body);
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

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("display_sequence, status, items, raw_order_text, received_at, first_printed_at, dispatched_at, last_amended_at, context_until")
      .eq("location_id", location.id)
      .eq("ghl_contact_id", input.contactId)
      .order("received_at", { ascending: false })
      .limit(20);
    if (ordersError) throw ordersError;

    const today = startOfTodayInBogota();
    const open = orders.find(
      (order) => order.status !== "dispatched" && new Date(order.received_at) >= new Date(today),
    );
    if (open) {
      return noStoreJson({
        openOrder: {
          number: formatOrderNumber(open.display_sequence),
          inPreparation: Boolean(open.first_printed_at),
          text: orderLines({ rawOrderText: open.raw_order_text, items: open.items as OrderItem[] }).join("\n"),
        },
        since: open.context_until || open.last_amended_at || open.received_at,
      });
    }

    const lastDispatch = orders
      .map((order) => order.dispatched_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .at(-1);
    return noStoreJson({
      openOrder: null,
      since: lastDispatch && new Date(lastDispatch) > new Date(today) ? lastDispatch : today,
    });
  } catch (error) {
    console.error("Order context lookup failed", describeError(error));
    return serverError();
  }
}
