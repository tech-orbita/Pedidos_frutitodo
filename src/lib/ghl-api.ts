import type { CrmContact } from "@/types/orders";

/* Direct calls to the GHL (LeadConnector) API with the sub-account's Private Integration
   token. Used for what the operator waits on, such as sending a quote, so the panel can
   report the real outcome instead of trusting a relay. */

const DEFAULT_BASE_URL = "https://services.leadconnectorhq.com";
const TIMEOUT_MS = 10_000;

export class GhlApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "GhlApiError";
  }
}

type GhlConfig = { token: string; baseUrl: string; messageType: string };

function getConfig(): GhlConfig | null {
  const token = process.env.GHL_API_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    baseUrl: (process.env.GHL_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ""),
    messageType: process.env.GHL_MESSAGE_TYPE?.trim() || "WhatsApp",
  };
}

export function isGhlApiConfigured(): boolean {
  return getConfig() !== null;
}

async function request(config: GhlConfig, path: string, init: { method: string; version: string; body?: unknown }) {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Version: init.version,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new GhlApiError(
      error instanceof Error && error.name === "TimeoutError" ? "GHL no respondió a tiempo" : "No fue posible conectar con GHL",
      null,
    );
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = typeof body?.message === "string" ? body.message : Array.isArray(body?.message) ? body.message.join(", ") : "";
    throw new GhlApiError(detail ? `GHL rechazó el envío: ${detail}` : `GHL respondió ${response.status}`, response.status);
  }
  return body ?? {};
}

export type SentMessage = { messageId: string | null; conversationId: string | null };

type RawContact = {
  id?: unknown;
  name?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  address1?: unknown;
  city?: unknown;
  customFields?: unknown;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Searches the sub-account CRM. The private token stays on the server, never in the iframe. */
export async function searchCrmContacts(locationId: string, query: string): Promise<CrmContact[]> {
  const config = getConfig();
  if (!config) throw new GhlApiError("Falta configurar GHL_API_TOKEN", null);
  const params = new URLSearchParams({ locationId, limit: "20" });
  if (query.trim()) params.set("query", query.trim());
  const [body, fieldsBody] = await Promise.all([
    request(config, `/contacts/?${params}`, { method: "GET", version: "2021-07-28" }),
    request(config, `/locations/${encodeURIComponent(locationId)}/customFields`, { method: "GET", version: "2021-07-28" }),
  ]);
  const contacts = Array.isArray(body.contacts) ? (body.contacts as RawContact[]) : [];
  const addressKey = process.env.GHL_CF_DIRECCION?.trim() || "direccion_de_envio";
  const documentKey = process.env.GHL_CF_CEDULA?.trim() || "documento_de_identidad";

  const fieldDefinitions = Array.isArray(fieldsBody.customFields)
    ? (fieldsBody.customFields as Array<Record<string, unknown>>)
    : [];
  const idsForKey = (key: string) => {
    const normalized = key.replace(/^contact\./, "");
    return new Set([
      normalized,
      ...fieldDefinitions
        .filter((field) => [field.fieldKey, field.key, field.name].some((value) => asText(value).replace(/^contact\./, "") === normalized))
        .map((field) => asText(field.id))
        .filter(Boolean),
    ]);
  };

  const customValue = (contact: RawContact, key: string) => {
    if (!Array.isArray(contact.customFields)) return "";
    const aliases = idsForKey(key);
    const match = (contact.customFields as Array<Record<string, unknown>>).find((field) =>
      [field.key, field.fieldKey, field.id].some(
        (candidate) => aliases.has(asText(candidate).replace(/^contact\./, "")),
      ),
    );
    return asText(match?.value ?? match?.fieldValue ?? match?.field_value);
  };

  return contacts
    .map((contact) => {
      const name = asText(contact.name) || [asText(contact.firstName), asText(contact.lastName)].filter(Boolean).join(" ");
      const topAddress = [asText(contact.address1), asText(contact.city)].filter(Boolean).join(", ");
      return {
        id: asText(contact.id),
        name,
        phone: asText(contact.phone),
        document: customValue(contact, documentKey) || null,
        address: customValue(contact, addressKey) || topAddress || null,
      };
    })
    .filter((contact) => contact.id && (contact.name || contact.phone));
}

/** Sends a message into the contact's conversation (WhatsApp by default). Throws GhlApiError. */
export async function sendContactMessage(contactId: string, message: string): Promise<SentMessage> {
  const config = getConfig();
  if (!config) throw new GhlApiError("Falta configurar GHL_API_TOKEN", null);
  const body = await request(config, "/conversations/messages", {
    method: "POST",
    version: "2021-04-15",
    body: { type: config.messageType, contactId, message },
  });
  return {
    messageId: typeof body.messageId === "string" ? body.messageId : null,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
  };
}

/** Best effort: a CRM field that fails to update must never fail the action that caused it. */
export async function updateContactCustomFields(
  contactId: string,
  fields: Array<{ key: string; value: string }>,
): Promise<void> {
  const config = getConfig();
  if (!config || !fields.length) return;
  try {
    await request(config, `/contacts/${encodeURIComponent(contactId)}`, {
      method: "PUT",
      version: "2021-07-28",
      body: { customFields: fields.map((field) => ({ key: field.key, field_value: field.value })) },
    });
  } catch (error) {
    console.error("GHL contact update failed", error instanceof Error ? error.message : "Unknown error");
  }
}

/** Removing the handoff tag re-enables the GHL AI workflow after an operator resolves help. */
export async function removeContactTags(contactId: string, tags: string[]): Promise<void> {
  const config = getConfig();
  if (!config) throw new GhlApiError("Falta configurar GHL_API_TOKEN", null);
  await request(config, `/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: "DELETE",
    version: "v3",
    body: { tags },
  });
}
