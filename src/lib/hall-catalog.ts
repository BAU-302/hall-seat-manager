export type HallId = "haeun" | "art" | "yerang";

export type Hall = {
  id: HallId;
  name: string;
  floors: string;
  capacity: number;
  note: string;
};

export type SessionTone = "neutral" | "ready" | "live";

export type Session = {
  id: string;
  sessionId: number;
  eventId: number;
  hallId: HallId;
  date: string;
  shortDate: string;
  time: string;
  endTime: string;
  event: string;
  round: string;
  status: string;
  statusTone: SessionTone;
  distributed: number;
  entered: number;
};

export const FALLBACK_HALLS: Hall[] = [
  { id: "haeun", name: "하은홀", floors: "1층 · 2층", capacity: 694, note: "등록 행사 0건" },
  { id: "art", name: "아트홀", floors: "1층", capacity: 370, note: "등록 행사 0건" },
  { id: "yerang", name: "예랑홀", floors: "1층", capacity: 200, note: "등록 행사 0건" },
];

export const FALLBACK_SESSIONS: Session[] = [];
