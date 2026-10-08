import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const locationId = argument("location-id");
const locationName = argument("name") || "Frutitodo";
const role = argument("role") || "operator";
if (!locationId) {
  throw new Error("Usage: npm run provision:location -- --location-id <GHL_LOCATION_ID> [--name Frutitodo] [--role operator|courier]");
}
if (!['operator', 'courier'].includes(role)) throw new Error("--role must be operator or courier");

/* Overridable so a domain move does not mean editing this script. */
const panelBaseUrl = process.env.PANEL_BASE_URL?.trim() || "https://pedidos-frutitodo-eight.vercel.app";

const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const token = randomBytes(32).toString("base64url");
const tokenHash = createHmac("sha256", required("EMBED_TOKEN_PEPPER")).update(token).digest("hex");

const values = role === "courier"
  ? { courier_token_hash: tokenHash }
  : { embed_token_hash: tokenHash };
const { data: existing, error: readError } = await supabase
  .from("locations")
  .select("id")
  .eq("ghl_location_id", locationId)
  .maybeSingle();
if (readError) throw readError;
if (role === "courier" && !existing) throw new Error("Provision the operator location before creating a courier account");
const query = existing
  ? supabase.from("locations").update({ ...values, name: locationName, is_active: true }).eq("id", existing.id)
  : supabase.from("locations").insert({ ghl_location_id: locationId, name: locationName, ...values, is_active: true });
const { error } = await query;

if (error) throw error;

/* The trailing newline matters: PowerShell drops an unterminated final line, which
   silently swallowed the one value this script exists to hand over. */
process.stdout.write(
  [
    `${role === "courier" ? "Courier account" : "Location"} provisioned successfully.`,
    "Supabase stores only the hash, so copy the token now; it cannot be read back later.",
    "Paste this link into the GHL custom menu link:",
    `${panelBaseUrl}/panel?location=${locationId}&token=${token}`,
    "",
  ].join("\n"),
);
