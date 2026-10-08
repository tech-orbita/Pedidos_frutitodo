import { getServerEnv } from "@/lib/env";
import { hashEmbedToken, readBearerToken, safeEqual } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type PanelAccess = {
  locationId: string;
  ghlLocationId: string;
  locationName: string;
  role: "operator" | "courier";
};

export async function getPanelAccess(request: Request): Promise<PanelAccess | null> {
  const token = readBearerToken(request);
  const ghlLocationId = request.headers.get("x-location-id")?.trim();
  if (!token || !ghlLocationId) return null;

  const tokenHash = hashEmbedToken(token, getServerEnv().embedTokenPepper);
  const { data, error } = await getSupabaseAdmin()
    .from("locations")
    .select("id, ghl_location_id, name, embed_token_hash, courier_token_hash")
    .eq("ghl_location_id", ghlLocationId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const role = safeEqual(data.embed_token_hash, tokenHash)
    ? "operator"
    : data.courier_token_hash && safeEqual(data.courier_token_hash, tokenHash)
      ? "courier"
      : null;
  if (!role) return null;
  return { locationId: data.id, ghlLocationId: data.ghl_location_id, locationName: data.name, role };
}
