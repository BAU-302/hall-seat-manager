import "server-only";

import type { Hall, HallId, Session, SessionTone } from "@/lib/hall-catalog";
import { createClient } from "@/lib/supabase/server";

type HallRow = {
  code: string;
  name: string;
  floor_summary: string;
  capacity: number;
  note: string;
};

type SessionRow = {
  id: number;
  event_id: number;
  session_code: string;
  hall_id: number;
  round_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  events: { name: string } | { name: string }[] | null;
};

const STATUS: Record<string, { label: string; tone: SessionTone }> = {
  scheduled: { label: "예정", tone: "neutral" },
  allocation: { label: "배분 진행", tone: "ready" },
  entry_ready: { label: "입장 준비", tone: "ready" },
  entry_open: { label: "입장 진행", tone: "live" },
  ended: { label: "종료", tone: "neutral" },
  cancelled: { label: "취소", tone: "neutral" },
};

function dateParts(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    date: `${year}. ${month}. ${day}.`,
    shortDate: `${month}월 ${day}일`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export async function loadPublicCatalog(): Promise<{ halls: Hall[]; sessions: Session[] }> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const [{ data: hallData, error: hallError }, { data: sessionData, error: sessionError }, allocationResult] = await Promise.all([
    supabase.from("halls").select("id, code, name, floor_summary, capacity, note").eq("is_active", true).order("display_order"),
    supabase.from("event_sessions").select("id, event_id, session_code, hall_id, round_name, starts_at, ends_at, status, events!inner(name)").order("starts_at"),
    authData.user
      ? supabase.from("session_seats").select("session_id, allocation_status, admission_status")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (hallError) throw hallError;
  if (sessionError) throw sessionError;
  if (allocationResult.error) throw allocationResult.error;

  const allocationRows = allocationResult.data ?? [];

  const rows = (hallData ?? []) as Array<HallRow & { id: number }>;
  const hallCodeById = new Map(rows.map((hall) => [hall.id, hall.code as HallId]));
  const halls = rows.map((hall) => ({
    id: hall.code as HallId,
    name: hall.name,
    floors: hall.floor_summary,
    capacity: hall.capacity,
    note: `등록 행사 ${new Set(((sessionData ?? []) as SessionRow[]).filter((session) => session.hall_id === hall.id).map((session) => session.event_id)).size}건`,
  }));

  const sessions = ((sessionData ?? []) as SessionRow[]).flatMap((session) => {
    const hallId = hallCodeById.get(session.hall_id);
    if (!hallId) return [];
    const start = dateParts(session.starts_at);
    const end = dateParts(session.ends_at);
    const status = STATUS[session.status] ?? STATUS.scheduled;
    const event = Array.isArray(session.events) ? session.events[0] : session.events;
    return [{
      id: session.session_code,
      sessionId: session.id,
      eventId: session.event_id,
      hallId,
      date: start.date,
      shortDate: start.shortDate,
      time: start.time,
      endTime: end.time,
      event: event?.name ?? "이름 없는 행사",
      round: session.round_name,
      status: status.label,
      statusTone: status.tone,
      distributed: allocationRows.filter((seat) => seat.session_id === session.id && seat.allocation_status === "distributed").length,
      entered: allocationRows.filter((seat) => seat.session_id === session.id && seat.admission_status === "entered").length,
    } satisfies Session];
  });

  return { halls, sessions };
}
