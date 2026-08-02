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
  { id: "haeun", name: "하은홀", floors: "1층 · 2층", capacity: 694, note: "등록 행사 1건" },
  { id: "art", name: "아트홀", floors: "1층", capacity: 370, note: "등록 행사 1건" },
  { id: "yerang", name: "예랑홀", floors: "1층", capacity: 200, note: "등록 행사 1건" },
];

export const FALLBACK_SESSIONS: Session[] = [
  { id: "haeun-20260815-1400", hallId: "haeun", date: "2026. 8. 15.", shortDate: "8월 15일", time: "14:00", endTime: "16:00", event: "2026 여름음악회", round: "1회차", status: "종료", statusTone: "neutral", distributed: 0, entered: 0 },
  { id: "haeun-20260815-1900", hallId: "haeun", date: "2026. 8. 15.", shortDate: "8월 15일", time: "19:00", endTime: "21:00", event: "2026 여름음악회", round: "2회차", status: "입장 준비", statusTone: "ready", distributed: 0, entered: 0 },
  { id: "art-20260820-1000", hallId: "art", date: "2026. 8. 20.", shortDate: "8월 20일", time: "10:00", endTime: "12:00", event: "신입생 오리엔테이션", round: "오전 회차", status: "입장 진행", statusTone: "live", distributed: 0, entered: 0 },
  { id: "art-20260820-1400", hallId: "art", date: "2026. 8. 20.", shortDate: "8월 20일", time: "14:00", endTime: "16:00", event: "신입생 오리엔테이션", round: "오후 회차", status: "배분 진행", statusTone: "ready", distributed: 0, entered: 0 },
  { id: "yerang-20260822-1100", hallId: "yerang", date: "2026. 8. 22.", shortDate: "8월 22일", time: "11:00", endTime: "13:00", event: "학부모 설명회", round: "1회차", status: "입장 준비", statusTone: "ready", distributed: 0, entered: 0 },
];
