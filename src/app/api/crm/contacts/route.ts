import { describeError, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { searchCrmContacts } from "@/lib/ghl-api";
import { getPanelAccess } from "@/lib/panel-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access || access.role !== "operator") return unauthorized();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || "";
    return noStoreJson({ contacts: await searchCrmContacts(access.ghlLocationId, query) });
  } catch (error) {
    console.error("CRM contact search failed", describeError(error));
    return serverError();
  }
}
