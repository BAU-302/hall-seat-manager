import { SeatManagerApp } from "@/components/seat-manager-app";
import { FALLBACK_HALLS, FALLBACK_SESSIONS } from "@/lib/hall-catalog";
import { loadPublicCatalog } from "@/lib/supabase/public-catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let halls = FALLBACK_HALLS;
  let sessions = FALLBACK_SESSIONS;
  let dataSource: "supabase" | "fallback" = "fallback";

  try {
    const catalog = await loadPublicCatalog();
    halls = catalog.halls;
    sessions = catalog.sessions;
    dataSource = "supabase";
  } catch (error) {
    console.error("Supabase public catalog load failed", error);
  }

  return <SeatManagerApp initialHalls={halls} initialSessions={sessions} dataSource={dataSource} />;
}
