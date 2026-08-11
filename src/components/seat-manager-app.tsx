"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { User } from "@supabase/supabase-js";
import Image from "next/image";
import { FALLBACK_HALLS, FALLBACK_SESSIONS } from "@/lib/hall-catalog";
import type { Hall, HallId, Session } from "@/lib/hall-catalog";
import { createClient } from "@/lib/supabase/client";

type SeatStatus = "distributed" | "entered" | "empty" | "onsite" | "blocked";
type SeatRange = readonly [number, number] | null;
type RowConfig = { row: string; blocks: SeatRange[] };
type Floor = "1층" | "2층";
type Seat = { id: string; row: string; number: number; status: SeatStatus; recipient?: string | null };
type SeatMapState = { status: SeatStatus; recipient: string | null; seatId?: number };
type RealtimeStatus = "connecting" | "live" | "offline";
type SeatZone = { id: string; label: string; floorCode: string; rowStart: string; rowEnd: string; numberStart: number; numberEnd: number; description: string };
type MenuId = "dashboard" | "seats" | "allocation" | "entry" | "scan" | "generate" | "reassign" | "history" | "events";
type Activity = readonly [string, string, string, string];

const ROWS_1F: RowConfig[] = [
  { row: "A", blocks: [null, [7, 14], [15, 22], null] },
  { row: "B", blocks: [[1, 6], [7, 14], [15, 22], null] },
  { row: "C", blocks: [[1, 6], [7, 14], [15, 22], [23, 26]] },
  { row: "D", blocks: [[3, 6], [7, 14], [15, 22], [23, 26]] },
  { row: "E", blocks: [[3, 6], [7, 14], [15, 22], [23, 26]] },
  { row: "F", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "G", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "H", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "I", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "J", blocks: [[3, 6], [7, 14], [15, 22], [23, 26]] },
  { row: "K", blocks: [[3, 6], [7, 14], [15, 22], [23, 26]] },
  { row: "L", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "M", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "N", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "O", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "P", blocks: [[3, 6], [7, 14], [15, 22], [23, 26]] },
  { row: "Q", blocks: [[2, 6], [7, 14], [15, 22], [23, 27]] },
  { row: "R", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "S", blocks: [[1, 6], [7, 14], [15, 22], [23, 28]] },
  { row: "T", blocks: [null, [7, 14], [15, 22], null] },
];

const ROWS_2F: RowConfig[] = [
  { row: "A", blocks: [[4, 9], [10, 14], [21, 25], [26, 31]] },
  { row: "B", blocks: [[3, 9], [10, 25], [26, 32]] },
  { row: "C", blocks: [[1, 9], [10, 25], [26, 34]] },
  { row: "D", blocks: [[1, 9], [10, 25], [26, 34]] },
  { row: "E", blocks: [[1, 9], [10, 25], [26, 34]] },
  { row: "F", blocks: [[1, 9], [10, 25], [26, 34]] },
];

const STATUS: SeatStatus[] = ["distributed", "entered", "empty", "onsite", "blocked"];
const STATUS_LABEL: Record<SeatStatus, string> = { distributed: "배부 완료", entered: "입장 완료", empty: "미배분", onsite: "현장 확보", blocked: "사용 제외" };
const SEAT_W = 29;
const SEAT_H = 18;
const SEAT_GAP = 2;

const EMPTY_SEAT_STATE: SeatMapState = { status: "empty", recipient: null };

const SEAT_ZONES: SeatZone[] = [
  { id: "1F-1", label: "1존", floorCode: "1F", rowStart: "A", rowEnd: "K", numberStart: 1, numberEnd: 6, description: "앞쪽 좌측" },
  { id: "1F-2", label: "2존", floorCode: "1F", rowStart: "A", rowEnd: "K", numberStart: 7, numberEnd: 14, description: "앞쪽 중앙 좌측" },
  { id: "1F-3", label: "3존", floorCode: "1F", rowStart: "A", rowEnd: "K", numberStart: 15, numberEnd: 22, description: "앞쪽 중앙 우측" },
  { id: "1F-4", label: "4존", floorCode: "1F", rowStart: "A", rowEnd: "K", numberStart: 23, numberEnd: 28, description: "앞쪽 우측" },
  { id: "1F-5", label: "5존", floorCode: "1F", rowStart: "L", rowEnd: "T", numberStart: 1, numberEnd: 6, description: "뒤쪽 좌측" },
  { id: "1F-6", label: "6존", floorCode: "1F", rowStart: "L", rowEnd: "T", numberStart: 7, numberEnd: 14, description: "뒤쪽 중앙 좌측" },
  { id: "1F-7", label: "7존", floorCode: "1F", rowStart: "L", rowEnd: "T", numberStart: 15, numberEnd: 22, description: "뒤쪽 중앙 우측" },
  { id: "1F-8", label: "8존", floorCode: "1F", rowStart: "L", rowEnd: "T", numberStart: 23, numberEnd: 28, description: "뒤쪽 우측" },
  { id: "2F-1", label: "1존", floorCode: "2F", rowStart: "A", rowEnd: "F", numberStart: 1, numberEnd: 9, description: "좌측" },
  { id: "2F-2", label: "2존", floorCode: "2F", rowStart: "A", rowEnd: "F", numberStart: 10, numberEnd: 25, description: "중앙" },
  { id: "2F-3", label: "3존", floorCode: "2F", rowStart: "A", rowEnd: "F", numberStart: 26, numberEnd: 34, description: "우측" },
];

function numbersIn(range: SeatRange): number[] {
  if (!range) return [];
  return Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index);
}

type SvgSeatProps = {
  row: string;
  number: number;
  rowIndex: number;
  x: number;
  y: number;
  angle?: number;
  width?: number;
  height?: number;
  selectedId?: string;
  queryId?: string;
  seatState: (row: string, number: number) => SeatMapState;
  onSelect: (seat: Seat) => void;
};

function SvgSeat({ row, number, rowIndex, x, y, angle = 0, width = SEAT_W, height = SEAT_H, selectedId, queryId, seatState, onSelect }: SvgSeatProps) {
  void rowIndex;
  const id = `${row}-${String(number).padStart(2, "0")}`;
  const { status, recipient } = seatState(row, number);
  const selected = selectedId === id;
  const searched = queryId === id;
  const activate = () => onSelect({ id, row, number, status, recipient });

  return (
    <g
      className={`svg-seat svg-seat--${status} ${selected ? "is-selected" : ""} ${searched ? "is-searched" : ""}`}
      transform={`translate(${x} ${y}) rotate(${angle} ${width / 2} ${height / 2})`}
      role="button"
      tabIndex={0}
      aria-label={`${id} ${STATUS_LABEL[status]}${recipient ? ` ${recipient}` : ""}`}
      aria-pressed={selected}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      <rect width={width} height={height} rx="3" />
      <text x={width / 2} y={height / 2 + 0.4}>{id}</text>
    </g>
  );
}

type SvgSeatBlockProps = Omit<SvgSeatProps, "number"> & {
  range: SeatRange;
  align?: "start" | "end";
  gap?: number;
};

function SvgSeatBlock({ range, row, rowIndex, x, y, align = "start", width = SEAT_W, height = SEAT_H, gap = SEAT_GAP, selectedId, queryId, seatState, onSelect }: SvgSeatBlockProps) {
  const numbers = numbersIn(range);
  const pitch = width + gap;
  const startX = align === "end" ? x - (numbers.length * pitch - gap) : x;
  return numbers.map((number, index) => (
    <SvgSeat
      key={`${row}-${number}`}
      row={row}
      number={number}
      rowIndex={rowIndex}
      x={startX + index * pitch}
      y={y}
      width={width}
      height={height}
      selectedId={selectedId}
      queryId={queryId}
      seatState={seatState}
      onSelect={onSelect}
    />
  ));
}

type SeatMapSvgProps = Pick<SvgSeatProps, "selectedId" | "queryId" | "seatState" | "onSelect">;

function FirstFloorSvg({ selectedId, queryId, seatState, onSelect }: SeatMapSvgProps) {
  return (
    <svg className="hall-map-svg hall-map-svg--one" viewBox="0 0 1120 600" role="img" aria-label="하은홀 1층 506석 좌석 배치도">
      <g className="map-architecture">
        <path d="M290 12H830V48H1100V552H925V580H195V552H20V48H290Z" />
        <path className="stage-line" d="M310 22V58 Q560 86 810 58V22" />
        <text className="map-title" x="560" y="43">무대</text>
        <text className="map-subtitle" x="560" y="57">STAGE</text>
      </g>

      <g className="seat-layer">
        {ROWS_1F.map((config, rowIndex) => {
          const y = 88 + rowIndex * 21 + (rowIndex >= 11 ? 24 : 0);
          return (
            <g key={config.row} className={`floor-row floor-row--${config.row}`}>
              <SvgSeatBlock range={config.blocks[0]} row={config.row} rowIndex={rowIndex} x={230} y={y} align="end" selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
              <SvgSeatBlock range={config.blocks[1]} row={config.row} rowIndex={rowIndex} x={525} y={y} align="end" selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
              <SvgSeatBlock range={config.blocks[2]} row={config.row} rowIndex={rowIndex} x={595} y={y} selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
              <SvgSeatBlock range={config.blocks[3]} row={config.row} rowIndex={rowIndex} x={890} y={y} selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
            </g>
          );
        })}
      </g>

    </svg>
  );
}

function SecondFloorSvg({ selectedId, queryId, seatState, onSelect }: SeatMapSvgProps) {
  const width = 27;
  const height = 20;
  const gap = 2;
  return (
    <svg className="hall-map-svg hall-map-svg--two" viewBox="0 0 1120 500" role="img" aria-label="하은홀 2층 188석 좌석 배치도">
      <g className="map-architecture">
        <path d="M280 12H840V50H1112V455H900V475H220V455H8V50H280Z" />
        <path className="balcony-front-line" d="M30 118H1090" />
      </g>

      <g className="seat-layer">
        {ROWS_2F.map((config, rowIndex) => {
          const y = 166 + rowIndex * 32;
          const leftEdge = 282;
          const rightEdge = 838;
          return (
            <g key={config.row} className={`floor-row floor-row--${config.row}`}>
              <SvgSeatBlock range={config.blocks[0]} row={config.row} rowIndex={rowIndex} x={leftEdge} y={y} align="end" width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
              {config.row === "A" ? (
                <>
                  <SvgSeatBlock range={config.blocks[1]} row={config.row} rowIndex={rowIndex} x={485} y={y} align="end" width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
                  <SvgSeatBlock range={config.blocks[2]} row={config.row} rowIndex={rowIndex} x={635} y={y} width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
                  <g className="control-desk-svg"><rect x="513" y={y - 3} width="94" height="23" rx="4" /><text x="560" y={y + 7}>CONTROL DESK</text></g>
                  <SvgSeatBlock range={config.blocks[3]} row={config.row} rowIndex={rowIndex} x={rightEdge} y={y} width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
                </>
              ) : (
                <>
                  <SvgSeatBlock range={config.blocks[1]} row={config.row} rowIndex={rowIndex} x={329} y={y} width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
                  <SvgSeatBlock range={config.blocks[2]} row={config.row} rowIndex={rowIndex} x={rightEdge} y={y} width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} seatState={seatState} onSelect={onSelect} />
                </>
              )}
            </g>
          );
        })}
      </g>

      <g className="broadcast-mark">
        <rect x="425" y="373" width="270" height="52" rx="7" />
        <text x="560" y="396">방송실</text>
        <text className="map-subtitle" x="560" y="412">BROADCAST STUDIO</text>
      </g>
    </svg>
  );
}

const MENU: Array<[MenuId, string]> = [
  ["dashboard", "운영 현황"],
  ["seats", "좌석 현황"],
  ["allocation", "좌석 배분"],
  ["entry", "입장 관리"],
  ["scan", "QR 스캔"],
  ["generate", "QR 생성"],
  ["reassign", "현장 재배정"],
  ["history", "처리 이력"],
  ["events", "행사 관리"],
];
const ENTRANCE_MENU_IDS=new Set<MenuId>(["dashboard","seats","entry","scan","history"]);
const ROLE_LABEL:Record<string,string>={super_admin:"최고 관리자",event_manager:"운영 매니저",entrance_staff:"입장 직원"};

type CatalogContextValue = {
  halls: Hall[];
  sessions: Session[];
  dataSource: "supabase" | "fallback";
  user: User | null;
  profile: { displayName: string; role: string } | null;
  accessibleHallCodes: HallId[] | null;
  requestAuth: () => void;
  signOut: () => Promise<void>;
};

const CatalogContext = createContext<CatalogContextValue>({
  halls: FALLBACK_HALLS,
  sessions: FALLBACK_SESSIONS,
  dataSource: "fallback",
  user: null,
  profile: null,
  accessibleHallCodes: null,
  requestAuth: () => undefined,
  signOut: async () => undefined,
});

function useCatalog() {
  return useContext(CatalogContext);
}

const RECENT: Activity[] = [];

function recentForHall(hall: Hall): Activity[] {
  void hall;
  return RECENT;
}

function BrandLockup() {
  return <div className="brand brand--large"><span>하</span><div><strong>하은홀</strong><small>현장 운영 시스템</small></div></div>;
}

function AuthControl() {
  const { user, profile, requestAuth, signOut } = useCatalog();
  if (!user) return <button className="ghost-button" onClick={requestAuth}>직원 로그인</button>;
  const name = profile?.displayName || user.email?.split("@")[0] || "직원";
  return <div className="selection-user"><span className="user-avatar">{name.slice(0, 1)}</span><div><strong>{name}</strong><small>{ROLE_LABEL[profile?.role||""]||"현장 운영 직원"}</small></div><button className="text-button" onClick={() => void signOut()}>로그아웃</button></div>;
}

function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const displayName = String(data.get("displayName") ?? "").trim();
    const supabase = createClient();
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
    if (result.error) {
      setMessage(result.error.message);
    } else if (result.data.session) {
      const { error } = await supabase.rpc("claim_initial_admin");
      if (error) setMessage(error.message);
      else {
        onClose();
        window.location.reload();
      }
    } else {
      setMessage("확인 메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.");
    }
    setBusy(false);
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="context-modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><div className="modal-heading"><div><p className="eyebrow">내부 직원 전용</p><h2 id="auth-title">{mode === "login" ? "직원 로그인" : "직원 계정 만들기"}</h2><p>첫 계정만 최고 관리자가 되며, 이후 계정은 관리자가 역할과 운영 홀을 지정합니다.</p></div><button className="modal-close" onClick={onClose}>닫기</button></div><form className="auth-form" onSubmit={submit}>{mode === "signup" && <label className="form-field"><span>이름</span><input name="displayName" placeholder="예: 김하은" required /></label>}<label className="form-field"><span>이메일</span><input name="email" type="email" autoComplete="email" required /></label><label className="form-field"><span>비밀번호</span><input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required /></label>{message && <div className="notice notice--error">{message}</div>}<button className="primary-button" disabled={busy}>{busy ? "처리 중…" : mode === "login" ? "로그인" : "계정 만들기"}</button></form><button className="auth-switch" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(""); }}>{mode === "login" ? "처음 사용하시나요? 계정 만들기" : "이미 계정이 있나요? 로그인"}</button></section></div>;
}

function NewEventModal({ hall, onClose }: { hall: Hall; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const date = String(data.get("date"));
    const start = String(data.get("start"));
    const end = String(data.get("end"));
    const supabase = createClient();
    const { error } = await supabase.rpc("create_event_with_session", {
      p_hall_code: hall.id,
      p_event_name: String(data.get("eventName") ?? ""),
      p_round_name: String(data.get("roundName") ?? ""),
      p_starts_at: new Date(`${date}T${start}:00+09:00`).toISOString(),
      p_ends_at: new Date(`${date}T${end}:00+09:00`).toISOString(),
      p_description: String(data.get("description") ?? ""),
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    onClose();
    window.location.reload();
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="context-modal event-form-modal" role="dialog" aria-modal="true" aria-labelledby="event-form-title"><div className="modal-heading"><div><p className="eyebrow">{hall.name}</p><h2 id="event-form-title">새 행사·회차 등록</h2><p>등록 즉시 이 홀의 행사 목록에 반영됩니다.</p></div><button className="modal-close" onClick={onClose}>닫기</button></div><form className="auth-form" onSubmit={submit}><label className="form-field"><span>행사명</span><input name="eventName" required placeholder="예: 2026 정기 연주회" /></label><div className="form-row"><label className="form-field"><span>회차명</span><input name="roundName" required placeholder="예: 1회차" /></label><label className="form-field"><span>행사 날짜</span><input name="date" type="date" required /></label></div><div className="form-row"><label className="form-field"><span>시작 시간</span><input name="start" type="time" required /></label><label className="form-field"><span>종료 시간</span><input name="end" type="time" required /></label></div><label className="form-field"><span>메모</span><input name="description" placeholder="선택 입력" /></label>{message && <div className="notice notice--error">{message}</div>}<button className="primary-button" disabled={busy}>{busy ? "등록 중…" : "행사 등록"}</button></form></section></div>;
}

function HallSelectView({ onSelect }: { onSelect: (hall: Hall) => void }) {
  const { halls, sessions, dataSource, profile, accessibleHallCodes } = useCatalog();
  const visibleHalls=profile&&profile.role!=="super_admin"?halls.filter((hall)=>accessibleHallCodes?.includes(hall.id)):halls;
  return <main className="selection-shell">
    <header className="selection-topbar"><BrandLockup/><AuthControl/></header>
    <section className="selection-content">
      <div className="selection-intro"><p className="eyebrow">오늘의 현장 운영</p><h1>운영할 홀을 선택하세요</h1><p>홀을 선택하면 해당 홀에 등록된 행사와 회차만 표시됩니다.</p></div>
      <div className="hall-card-grid">
        {visibleHalls.map((hall,index)=><button className="hall-card" key={hall.id} onClick={()=>onSelect(hall)}>
          <span className="hall-index">0{index+1}</span><div><strong>{hall.name}</strong><p>{hall.floors}</p></div><div className="hall-capacity"><strong>{hall.capacity}</strong><span>석</span></div><small>등록 행사 {new Set(sessions.filter((session) => session.hallId === hall.id).map((session) => session.eventId)).size}건</small><em>행사 조회</em>
        </button>)}
        {!visibleHalls.length&&profile&&<div className="empty-state event-empty"><strong>배정된 홀이 없습니다</strong><p>최고 관리자에게 운영할 홀 권한을 요청해 주세요.</p></div>}
      </div>
      <aside className="selection-note"><strong>{dataSource === "supabase" ? "Supabase 데이터 연결됨" : "오프라인 미리보기"}</strong><span>선택한 홀의 행사·좌석·입장·QR 정보만 독립적으로 관리합니다.</span></aside>
    </section>
  </main>;
}

function EventSelectView({ hall, onBack, onSelect }: { hall: Hall; onBack: () => void; onSelect: (session: Session) => void }) {
  const { sessions: allSessions, user, profile, requestAuth } = useCatalog();
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState("");
  const sessions=allSessions.filter(item=>item.hallId===hall.id);
  const dates=[...new Set(sessions.map(item=>item.shortDate))];
  return <main className="selection-shell">
    <header className="selection-topbar"><BrandLockup/><button className="ghost-button" onClick={onBack}>전체 홀로</button></header>
    <section className="selection-content selection-content--events">
      <div className="event-select-heading"><div><p className="eyebrow">{hall.floors} · {hall.capacity}석</p><h1>{hall.name} 행사 선택</h1><p>운영하거나 조회할 날짜와 회차를 선택하세요.</p></div><div className="date-chips">{dates.map((date,index)=><button className={index===0?'active':''} key={date}>{date}</button>)}</div></div>
      <div className="event-list">
        {!sessions.length && <div className="empty-state event-empty"><strong>등록된 행사가 없습니다</strong><p>직원 로그인 후 첫 행사와 회차를 직접 등록해 주세요.</p></div>}
        {sessions.map(session=><article className="event-card" key={session.id}>
          <div className="event-time"><strong>{session.time}</strong><span>{session.endTime} 종료</span></div>
          <div className="event-main"><div><span className={`session-status session-status--${session.statusTone}`}>{session.status}</span><h2>{session.event}</h2><p>{session.round} · {session.date}</p></div><div className="event-stats"><span>배부 <strong>{session.distributed}</strong></span><span>입장 <strong>{session.entered}</strong></span></div></div>
          <div className="event-actions"><button className="primary-button" onClick={()=>onSelect(session)}>{session.status==='종료'?'내역 보기':'운영 시작'}</button>{profile?.role === "super_admin" && <button className="danger-link" onClick={async () => { if (!window.confirm(`'${session.event}' 행사를 영구 삭제할까요?\n배분·입장 이력이 있으면 삭제되지 않습니다.`)) return; const { error } = await createClient().rpc("delete_unused_event", { p_event_id: session.eventId }); if (error) setMessage(error.message); else window.location.reload(); }}>영구 삭제</button>}</div>
        </article>)}
      </div>
      {message && <div className="notice notice--error">{message}</div>}
      {profile?.role!=="entrance_staff"&&<button className="new-event-card" onClick={() => user ? setCreateOpen(true) : requestAuth()}>새 행사 또는 회차 등록</button>}
    </section>
    {createOpen && <NewEventModal hall={hall} onClose={() => setCreateOpen(false)}/>}
  </main>;
}

function OperationContextBar({ hall, session, realtimeStatus, onHome, onHall, onChange }: { hall: Hall; session: Session; realtimeStatus: RealtimeStatus; onHome: () => void; onHall: () => void; onChange: () => void }) {
  return <header className="operation-context">
    <nav aria-label="현재 운영 위치"><button onClick={onHome}>전체 홀</button><span>›</span><button onClick={onHall}>{hall.name}</button><span>›</span><strong>{session.date} {session.time}</strong></nav>
    <div className="operation-event"><span className={`session-status session-status--${session.statusTone}`}>{session.status}</span><strong>{session.event} {session.round}</strong><span className={`realtime-state realtime-state--${realtimeStatus}`}>{realtimeStatus==="live"?"실시간 연동":realtimeStatus==="connecting"?"연결 중":"오프라인"}</span></div>
    <button className="change-context-button" onClick={onChange}>홀·행사 변경</button>
  </header>;
}

function ChangeContextModal({ currentHall, currentSession, onClose, onApply }: { currentHall: Hall; currentSession: Session; onClose: () => void; onApply: (hall: Hall, session: Session) => void }) {
  const { halls: allHalls, sessions, profile, accessibleHallCodes } = useCatalog();
  const halls=profile&&profile.role!=="super_admin"?allHalls.filter((hall)=>accessibleHallCodes?.includes(hall.id)):allHalls;
  const [hallId,setHallId]=useState(currentHall.id);
  const available=sessions.filter(item=>item.hallId===hallId);
  const [sessionId,setSessionId]=useState(currentSession.id);
  const chooseHall=(id: HallId)=>{setHallId(id);setSessionId(sessions.find(item=>item.hallId===id)?.id??'');};
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="context-modal" role="dialog" aria-modal="true" aria-labelledby="context-modal-title">
      <div className="modal-heading"><div><p className="eyebrow">운영 대상 전환</p><h2 id="context-modal-title">홀·행사 변경</h2><p>선택한 회차를 기준으로 모든 메뉴의 정보가 바뀝니다.</p></div><button className="modal-close" onClick={onClose}>닫기</button></div>
      <div className="modal-section"><strong>홀</strong><div className="hall-tabs">{halls.map(hall=><button className={hallId===hall.id?'active':''} key={hall.id} onClick={()=>chooseHall(hall.id)}>{hall.name}<small>{hall.capacity}석</small></button>)}</div></div>
      <div className="modal-section"><strong>행사·회차</strong><div className="modal-session-list">{available.map(session=><button className={sessionId===session.id?'active':''} key={session.id} onClick={()=>setSessionId(session.id)}><span>{session.shortDate}<strong>{session.time}</strong></span><div><strong>{session.event}</strong><small>{session.round} · {session.status}</small></div></button>)}</div></div>
      <div className="modal-footer"><button className="ghost-button" onClick={onClose}>취소</button><button className="primary-button" onClick={()=>{const target=sessions.find(item=>item.id===sessionId);const targetHall=target?halls.find(item=>item.id===target.hallId):undefined;if(target&&targetHall)onApply(targetHall,target);}}>선택한 행사로 이동</button></div>
    </section>
  </div>;
}

function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  const { dataSource } = useCatalog();
  return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div><div className="connection"><span />{dataSource === "supabase" ? "Supabase 연결됨" : "미리보기 데이터"}</div></header>;
}

type SessionStats = {
  distributed: number;
  entered: number;
  held: number;
  blocked: number;
  floorEntered: Record<string, number>;
};

function DashboardView({ onNavigate, hall, session, stats }: { onNavigate: (menu: MenuId) => void; hall: Hall; session: Session; stats: SessionStats | null }) {
  const { profile }=useCatalog();
  const capacity=hall.capacity;
  const distributed=stats?.distributed??session.distributed;
  const entered=stats?.entered??session.entered;
  const held=stats?.held??0;
  const blocked=stats?.blocked??0;
  const operational=Math.max(capacity-blocked,0);
  const unused=Math.max(operational-distributed-held,0);
  const waiting=Math.max(distributed-entered,0);
  const enteredRate=distributed?`${Math.round(entered/distributed*100)}%`:'0%';
  const recent=recentForHall(hall);
  return <div className="view view--dashboard">
    <PageHeader eyebrow={`${hall.name} · ${session.date} ${session.time}`} title="운영 현황" description={`${session.event} ${session.round}의 좌석과 입장 현황입니다.`} />
    <section className="metric-grid metric-grid--operations">
      {[["운영 가능",operational,`전체 ${capacity} · 제외 ${blocked}`],["배부 완료",distributed,`${operational?Math.round(distributed/operational*100):0}%`],["현장 확보",held,`${unused}석 배정 가능`],["입장 완료",entered,enteredRate],["미입장",waiting,"배부 기준"],["사용 제외",blocked,"운영 정원 제외"]].map(([label,value,rate],index)=><article className={`metric-card metric-card--${index}`} key={label}><span>{label}</span><strong>{value}<small>석</small></strong><em>{rate}</em></article>)}
    </section>
    <section className="dashboard-grid">
      <article className="content-card progress-card"><div className="section-title"><div><h2>{hall.id==='haeun'?'층별 입장 현황':'입장 현황'}</h2><p>현재 선택 회차의 실시간 DB 기준</p></div><button className="text-button" onClick={()=>onNavigate('seats')}>좌석표 보기</button></div>{hall.id==='haeun'?<><div className="floor-progress"><strong>1층</strong><div><i style={{width:`${Math.round((stats?.floorEntered["1F"]??0)/506*100)}%`}} /></div><span>{stats?.floorEntered["1F"]??0} / 506</span></div><div className="floor-progress"><strong>2층</strong><div><i style={{width:`${Math.round((stats?.floorEntered["2F"]??0)/188*100)}%`}} /></div><span>{stats?.floorEntered["2F"]??0} / 188</span></div></>:<div className="floor-progress"><strong>1층</strong><div><i style={{width:enteredRate}} /></div><span>{entered} / {distributed}</span></div>}<p className="unused-copy">현재 배정 가능 {unused}석 · 입장률은 배부 완료 좌석 기준입니다.</p></article>
      <article className="content-card quick-card"><div className="section-title"><div><h2>빠른 실행</h2><p>현장 업무를 바로 시작하세요.</p></div></div><div className="quick-actions">{profile?.role!=="entrance_staff"&&<button onClick={()=>onNavigate('allocation')}>새 좌석 배분</button>}<button onClick={()=>onNavigate('entry')}>수동 입장</button><button onClick={()=>onNavigate('scan')}>QR 빠른 스캔</button>{profile?.role!=="entrance_staff"&&<button onClick={()=>onNavigate('generate')}>QR 생성</button>}</div></article>
      <article className="content-card recent-card"><div className="section-title"><div><h2>최근 입장 내역</h2><p>{hall.name}에서 방금 처리된 좌석입니다.</p></div><button className="text-button" onClick={()=>onNavigate('history')}>전체 보기</button></div>{recent.length ? <div className="activity-list">{recent.map(item=><div key={item[0]}><time>{item[0]}</time><strong>{item[1]}</strong><span>{item[2]}</span><em>{item[3]}</em></div>)}</div> : <div className="compact-empty">아직 처리된 입장 기록이 없습니다.</div>}</article>
    </section>
  </div>;
}

type AllocationSeat = {
  id: number;
  seatCode: string;
  floorCode: string;
  floorName: string;
  row: string;
  number: number;
  label: string;
};

type AllocationRecord = {
  seat_id: number;
  ticket_code: string | null;
  allocation_status: string;
  admission_status: string;
  assignee_name: string | null;
  group_name: string | null;
  contact: string | null;
  note: string;
  allocated_at: string | null;
  admitted_at: string | null;
  entrance_name: string | null;
};

type ManagedAllocation = { seat: AllocationSeat; record: AllocationRecord };

async function fetchAllocationData(hallId: HallId, sessionId: number, canReadAllocations: boolean) {
  const supabase=createClient();
  const [{data:seatData,error:seatError},{data:allocationData,error:allocationError}]=await Promise.all([
    supabase.from("seats").select("id, seat_code, row_label, seat_number, hall_floors!inner(floor_code, name, halls!inner(code))").eq("is_active",true).order("seat_number"),
    canReadAllocations
      ? supabase.from("session_seats").select("seat_id, ticket_code, allocation_status, admission_status, assignee_name, group_name, contact, note, allocated_at, admitted_at, entrance_name").eq("session_id",sessionId)
      : Promise.resolve({data:[],error:null}),
  ]);
  if(seatError||allocationError)throw (seatError??allocationError);
  const seats=((seatData??[]) as Array<{id:number;seat_code:string;row_label:string;seat_number:number;hall_floors:unknown}>).flatMap((seat)=>{
    const floorRaw=Array.isArray(seat.hall_floors)?seat.hall_floors[0]:seat.hall_floors;
    if(!floorRaw||typeof floorRaw!=="object")return [];
    const floor=floorRaw as {floor_code:string;name:string;halls:unknown};
    const hallRaw=Array.isArray(floor.halls)?floor.halls[0]:floor.halls;
    if(!hallRaw||typeof hallRaw!=="object"||(hallRaw as {code:string}).code!==hallId)return [];
    return [{id:seat.id,seatCode:seat.seat_code,floorCode:floor.floor_code,floorName:floor.name,row:seat.row_label,number:seat.seat_number,label:`${floor.floor_code}-${seat.row_label}-${String(seat.seat_number).padStart(2,"0")}`}];
  });
  seats.sort((a,b)=>a.floorCode.localeCompare(b.floorCode)||a.row.localeCompare(b.row)||a.number-b.number);
  return {seats,records:(allocationData??[]) as AllocationRecord[]};
}

async function fetchSessionStats(sessionId: number) {
  const {data,error}=await createClient().from("session_seats").select("allocation_status, admission_status, seats!inner(hall_floors!inner(floor_code))").eq("session_id",sessionId);
  if(error)throw error;
  const records=(data??[]) as Array<{allocation_status:string;admission_status:string;seats:unknown}>;
  const floorEntered:Record<string,number>={};
  records.forEach((record)=>{
    if(record.admission_status!=="entered")return;
    const seatRaw=Array.isArray(record.seats)?record.seats[0]:record.seats;
    if(!seatRaw||typeof seatRaw!=="object")return;
    const floorRaw=Array.isArray((seatRaw as {hall_floors:unknown}).hall_floors)?(seatRaw as {hall_floors:unknown[]}).hall_floors[0]:(seatRaw as {hall_floors:unknown}).hall_floors;
    if(!floorRaw||typeof floorRaw!=="object")return;
    const code=String((floorRaw as {floor_code:string}).floor_code);
    floorEntered[code]=(floorEntered[code]??0)+1;
  });
  return {
    distributed:records.filter((record)=>record.allocation_status==="distributed").length,
    entered:records.filter((record)=>record.admission_status==="entered").length,
    held:records.filter((record)=>record.allocation_status==="held").length,
    blocked:records.filter((record)=>record.allocation_status==="blocked").length,
    floorEntered,
  };
}

function useSessionRealtime(sessionId: number | null, userId: string | null) {
  const [status,setStatus]=useState<RealtimeStatus>(userId?"connecting":"offline");
  const [connectedSessionId,setConnectedSessionId]=useState<number|null>(null);
  const [revision,setRevision]=useState(0);
  const [stats,setStats]=useState<(SessionStats&{sessionId:number})|null>(null);
  useEffect(()=>{
    if(!sessionId||!userId)return;
    const supabase=createClient();
    let debounceTimer:ReturnType<typeof setTimeout>|null=null;
    const refresh=()=>{
      if(debounceTimer)clearTimeout(debounceTimer);
      debounceTimer=setTimeout(()=>{
        setRevision((current)=>current+1);
        void fetchSessionStats(sessionId).then((next)=>setStats({sessionId,...next})).catch(()=>{});
      },120);
    };
    const channel=supabase.channel(`session-${sessionId}-${userId.slice(0,8)}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"session_seats",filter:`session_id=eq.${sessionId}`},refresh)
      .subscribe((nextStatus)=>{
        if(nextStatus==="SUBSCRIBED"){setConnectedSessionId(sessionId);setStatus("live");refresh();}
        else if(nextStatus==="CHANNEL_ERROR"||nextStatus==="TIMED_OUT"||nextStatus==="CLOSED")setStatus("offline");
      });
    const refreshWhenVisible=()=>{if(document.visibilityState==="visible")refresh();};
    const handleOnline=()=>{setStatus("connecting");refresh();};
    const handleOffline=()=>setStatus("offline");
    document.addEventListener("visibilitychange",refreshWhenVisible);
    window.addEventListener("online",handleOnline);
    window.addEventListener("offline",handleOffline);
    const fallbackPoll=window.setInterval(()=>{if(document.visibilityState==="visible"&&navigator.onLine)refresh();},15000);
    return()=>{
      if(debounceTimer)clearTimeout(debounceTimer);
      window.clearInterval(fallbackPoll);
      document.removeEventListener("visibilitychange",refreshWhenVisible);
      window.removeEventListener("online",handleOnline);
      window.removeEventListener("offline",handleOffline);
      void supabase.removeChannel(channel);
    };
  },[sessionId,userId]);
  return {status:!sessionId||!userId?"offline":connectedSessionId===sessionId?status:"connecting",revision,stats} as const;
}

function AllocationView({ hall, session, onStats, revision }: { hall: Hall; session: Session; onStats: (distributed: number, entered: number) => void; revision: number }) {
  const { user, requestAuth } = useCatalog();
  const [workflowMode,setWorkflowMode]=useState<"allocate"|"manage">("allocate");
  const [recipientType,setRecipientType]=useState<"group"|"individual"|"onsite"|"blocked">("group");
  const [exclusionAction,setExclusionAction]=useState<"block"|"unblock">("block");
  const [groupName,setGroupName]=useState("");
  const [assigneeName,setAssigneeName]=useState("");
  const [contact,setContact]=useState("");
  const [note,setNote]=useState("");
  const [seats,setSeats]=useState<AllocationSeat[]>([]);
  const [allocated,setAllocated]=useState<Map<number,AllocationRecord>>(new Map());
  const [floorCode,setFloorCode]=useState("1F");
  const [row,setRow]=useState("A");
  const [selectionMode,setSelectionMode]=useState<"row"|"zone">("zone");
  const [rangeRowStart,setRangeRowStart]=useState("A");
  const [rangeRowEnd,setRangeRowEnd]=useState("K");
  const [rangeNumberStart,setRangeNumberStart]=useState(8);
  const [rangeNumberEnd,setRangeNumberEnd]=useState(14);
  const [picked,setPicked]=useState<number[]>([]);
  const [busy,setBusy]=useState(false);
  const [releaseBusy,setReleaseBusy]=useState(false);
  const [managementQuery,setManagementQuery]=useState("");
  const [releasePicked,setReleasePicked]=useState<number[]>([]);
  const [releaseReason,setReleaseReason]=useState("");
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState<{tone:"success"|"error";text:string}|null>(null);

  const loadAllocationData=async()=>{
    setLoading(true);
    try{
      const result=await fetchAllocationData(hall.id,session.sessionId,true);
      setSeats(result.seats);
      setAllocated(new Map(result.records.filter((item)=>item.allocation_status!=="available").map((item)=>[item.seat_id,item])));
      onStats(result.records.filter((item)=>item.allocation_status==="distributed").length,result.records.filter((item)=>item.admission_status==="entered").length);
    }catch(error){
      setMessage({tone:"error",text:error instanceof Error?error.message:"좌석 정보를 불러오지 못했습니다."});
      setLoading(false);
      return;
    }
    setLoading(false);
  };

  useEffect(()=>{
    let active=true;
    void fetchAllocationData(hall.id,session.sessionId,Boolean(user)).then((result)=>{
      if(!active)return;
      setSeats(result.seats);
      setAllocated(new Map(result.records.filter((item)=>item.allocation_status!=="available").map((item)=>[item.seat_id,item])));
      setLoading(false);
    }).catch((error:unknown)=>{
      if(!active)return;
      setMessage({tone:"error",text:error instanceof Error?error.message:"좌석 정보를 불러오지 못했습니다."});
      setLoading(false);
    });
    return()=>{active=false;};
  },[hall.id,session.sessionId,user,revision]);

  const floors=[...new Map(seats.map((seat)=>[seat.floorCode,seat.floorName])).entries()].sort(([left],[right])=>left.localeCompare(right));
  const rows=[...new Set(seats.filter((seat)=>seat.floorCode===floorCode).map((seat)=>seat.row))].sort((a,b)=>a.localeCompare(b));
  const visibleSeats=seats.filter((seat)=>seat.floorCode===floorCode&&seat.row===row).sort((a,b)=>a.number-b.number);
  const zones=SEAT_ZONES.filter((zone)=>zone.floorCode===floorCode);
  const pickedSeats=picked.map((id)=>seats.find((seat)=>seat.id===id)).filter((seat):seat is AllocationSeat=>Boolean(seat)).sort((left,right)=>left.floorCode.localeCompare(right.floorCode)||left.row.localeCompare(right.row)||left.number-right.number);
  const chooseFloor=(nextFloor:string)=>{
    setFloorCode(nextFloor);
    const firstRow=[...new Set(seats.filter((seat)=>seat.floorCode===nextFloor).map((seat)=>seat.row))].sort((a,b)=>a.localeCompare(b))[0]??"A";
    setRow(firstRow);
    setRangeRowStart(firstRow);
    setRangeRowEnd(nextFloor==="1F"?"K":"F");
    setRangeNumberStart(nextFloor==="1F"?8:1);
    setRangeNumberEnd(nextFloor==="1F"?14:9);
  };
  const seatsInBounds=(rowStart:string,rowEnd:string,numberStart:number,numberEnd:number)=>seats.filter((seat)=>seat.floorCode===floorCode&&seat.row>=rowStart&&seat.row<=rowEnd&&seat.number>=numberStart&&seat.number<=numberEnd);
  const availableFrom=(candidates:AllocationSeat[])=>candidates.filter((seat)=>recipientType==="blocked"&&exclusionAction==="unblock"?allocated.get(seat.id)?.allocation_status==="blocked":!allocated.has(seat.id));
  const toggleCandidates=(candidates:AllocationSeat[])=>{
    const available=availableFrom(candidates);
    const allSelected=available.length>0&&available.every((seat)=>picked.includes(seat.id));
    setPicked((current)=>allSelected?current.filter((id)=>!available.some((seat)=>seat.id===id)):[...new Set([...current,...available.map((seat)=>seat.id)])]);
  };
  const rangeRows=[rangeRowStart,rangeRowEnd].sort((a,b)=>a.localeCompare(b));
  const rangeNumbers=[rangeNumberStart,rangeNumberEnd].sort((a,b)=>a-b);
  const customRangeSeats=seatsInBounds(rangeRows[0],rangeRows[1],rangeNumbers[0],rangeNumbers[1]);
  const customRangeAvailable=availableFrom(customRangeSeats);
  const maxSeatNumber=floorCode==="1F"?28:34;
  const pickedPreview=pickedSeats.slice(0,12).map((seat)=>`${seat.floorName} ${seat.row}-${String(seat.number).padStart(2,"0")}`).join(", ");
  const managedAllocations=seats.flatMap((seat)=>{const record=allocated.get(seat.id);return record&&["distributed","held"].includes(record.allocation_status)?[{seat,record} satisfies ManagedAllocation]:[];}).sort((left,right)=>left.seat.floorCode.localeCompare(right.seat.floorCode)||left.seat.row.localeCompare(right.seat.row)||left.seat.number-right.seat.number);
  const normalizedManagementQuery=managementQuery.trim().toLowerCase().replace(/\s+/g,"");
  const filteredManagedAllocations=managedAllocations.filter(({seat,record})=>!normalizedManagementQuery||[seat.label,`${seat.row}-${seat.number}`,record.group_name,record.assignee_name,record.contact].filter(Boolean).some((value)=>String(value).toLowerCase().replace(/\s+/g,"").includes(normalizedManagementQuery)));
  const managementGroups=[...filteredManagedAllocations.reduce((groups,item)=>{const held=item.record.allocation_status==="held";const recipient=item.record.group_name||item.record.assignee_name||"대상 미입력";const key=`${held?"onsite":item.record.group_name?"group":"individual"}:${recipient}`;const current=groups.get(key)??{key,recipient,type:held?"현장 확보":item.record.group_name?"단체":"개인",items:[] as ManagedAllocation[]};current.items.push(item);groups.set(key,current);return groups;},new Map<string,{key:string;recipient:string;type:string;items:ManagedAllocation[]}>()).values()];
  const selectVisibleAvailable=()=>setPicked((current)=>[...new Set([...current,...availableFrom(visibleSeats).map((seat)=>seat.id)])]);

  const submit=async()=>{
    if(!user){requestAuth();return;}
    if(!picked.length){setMessage({tone:"error",text:"배분할 좌석을 선택해 주세요."});return;}
    if(recipientType==="individual"&&!assigneeName.trim()){setMessage({tone:"error",text:"개인 이름을 입력해 주세요."});return;}
    if(recipientType==="group"&&!groupName.trim()){setMessage({tone:"error",text:"단체명을 입력해 주세요."});return;}
    setBusy(true);setMessage(null);
    const {data,error}=recipientType==="onsite"
      ? await createClient().rpc("reserve_onsite_session_seats",{p_session_code:session.id,p_seat_ids:picked,p_note:note.trim()||"현장 운영용 사전 확보"})
      : recipientType==="blocked"
        ? await createClient().rpc("set_session_seat_block_status",{p_session_code:session.id,p_seat_ids:picked,p_blocked:exclusionAction==="block",p_reason:note.trim()||(exclusionAction==="block"?"좌석 사용 제외 설정":"좌석 사용 제외 해제")})
        : await createClient().rpc("allocate_session_seats",{p_session_code:session.id,p_seat_ids:picked,p_recipient_type:recipientType,p_assignee_name:assigneeName.trim()||null,p_group_name:recipientType==="group"?groupName.trim():null,p_contact:contact.trim()||null,p_note:note.trim()});
    if(error){setMessage({tone:"error",text:error.message});setBusy(false);return;}
    const count=Number(data??picked.length);
    setPicked([]);
    setMessage({tone:"success",text:recipientType==="onsite"?`현장 운영 좌석 ${count}석을 확보했습니다.`:recipientType==="blocked"?`좌석 ${count}석의 사용 제외를 ${exclusionAction==="block"?"설정":"해제"}했습니다.`:`좌석 ${count}석이 실제 DB에 배분되었습니다.`});
    await loadAllocationData();
    setBusy(false);
  };

  const releaseSelected=async()=>{
    if(!user){requestAuth();return;}
    if(!releasePicked.length){setMessage({tone:"error",text:"배분을 취소할 좌석을 선택해 주세요."});return;}
    const enteredCount=releasePicked.filter((seatId)=>allocated.get(seatId)?.admission_status==="entered").length;
    if(enteredCount){setMessage({tone:"error",text:"입장 완료 좌석은 배분을 취소할 수 없습니다."});return;}
    if(!window.confirm(`선택한 ${releasePicked.length}석의 배분을 취소할까요?\n취소 이력은 보존되며 좌석은 다시 배분할 수 있습니다.`))return;
    setReleaseBusy(true);setMessage(null);
    const {data,error}=await createClient().rpc("release_session_seats",{
      p_session_code:session.id,
      p_seat_ids:releasePicked,
      p_reason:releaseReason.trim()||"배분 관리 화면에서 취소",
    });
    if(error){setMessage({tone:"error",text:error.message});setReleaseBusy(false);return;}
    const count=Number(data??releasePicked.length);
    setReleasePicked([]);setReleaseReason("");
    setMessage({tone:"success",text:`좌석 ${count}석의 배분이 취소되어 다시 선택할 수 있습니다.`});
    await loadAllocationData();
    setReleaseBusy(false);
  };

  if(hall.id!=="haeun")return <div className="view"><PageHeader eyebrow="사전 배부" title="좌석 배분" description={`${hall.name} 실제 좌석 도면 등록 후 사용할 수 있습니다.`}/><div className="empty-state content-card"><strong>{hall.name} 좌석 원본이 아직 없습니다</strong><p>좌석 도면을 등록하기 전에는 임의 좌석을 생성하지 않습니다.</p></div></div>;

  return <div className="view"><PageHeader eyebrow={`${hall.name} · ${session.event}`} title="좌석 배분" description={workflowMode==="allocate"?"개인 또는 단체에 실제 좌석을 배분합니다.":"배분된 좌석을 검색하고 일부 또는 전체를 취소합니다."} />
    <div className="qr-mode-tabs allocation-workflow-tabs"><button type="button" className={workflowMode==="allocate"?"active":""} onClick={()=>setWorkflowMode("allocate")}>새 좌석 배분</button><button type="button" className={workflowMode==="manage"?"active":""} onClick={()=>setWorkflowMode("manage")}>배분 관리 <span>{managedAllocations.length}</span></button></div>
    {message&&<div className={`notice notice--${message.tone}`}>{message.text}</div>}
    {workflowMode==="manage"?<section className="content-card allocation-management"><div className="management-toolbar"><div><h2>배분 내역</h2><p>좌석번호·단체명·개인명·연락처로 검색할 수 있습니다.</p></div><label className="management-search"><span>배분 검색</span><input aria-label="배분 검색" value={managementQuery} onChange={(event)=>setManagementQuery(event.target.value)} placeholder="예: A-07 또는 학생지원처"/></label><div className="management-actions"><strong>{filteredManagedAllocations.length}석</strong><button type="button" className="secondary-button" onClick={()=>setReleasePicked((current)=>{const targets=filteredManagedAllocations.filter((item)=>item.record.admission_status!=="entered").map((item)=>item.seat.id);return targets.length>0&&targets.every((id)=>current.includes(id))?current.filter((id)=>!targets.includes(id)):[...new Set([...current,...targets])];})}>검색 결과 전체 선택</button><button type="button" className="secondary-button" onClick={()=>setReleasePicked([])}>선택 해제</button></div></div>{!user?<div className="compact-empty">직원 로그인 후 실제 배분 내역을 관리할 수 있습니다.</div>:loading?<div className="compact-empty">배분 내역을 불러오는 중입니다.</div>:managementGroups.length?<div className="allocation-group-list">{managementGroups.map((group)=>{const releasable=group.items.filter((item)=>item.record.admission_status!=="entered");const allSelected=releasable.length>0&&releasable.every((item)=>releasePicked.includes(item.seat.id));return <article key={group.key} className="allocation-group-card"><header><div><span>{group.type}</span><strong>{group.recipient}</strong><small>{group.items[0]?.record.contact||"연락처 없음"}</small></div><div><strong>{group.items.length}석</strong><button type="button" className={allSelected?"active":""} disabled={!releasable.length} onClick={()=>setReleasePicked((current)=>allSelected?current.filter((id)=>!releasable.some((item)=>item.seat.id===id)):[...new Set([...current,...releasable.map((item)=>item.seat.id)])])}>{allSelected?"단체 선택 해제":"단체 전체 선택"}</button></div></header><div className="managed-seat-grid">{group.items.map(({seat,record})=>{const selected=releasePicked.includes(seat.id);const entered=record.admission_status==="entered";return <button type="button" key={seat.id} className={selected?"active":""} disabled={entered} onClick={()=>setReleasePicked((current)=>selected?current.filter((id)=>id!==seat.id):[...current,seat.id])}><strong>{seat.floorName} {seat.row}-{String(seat.number).padStart(2,"0")}</strong><small>{entered?"입장 완료 · 취소 불가":selected?"취소 대상으로 선택됨":"배분 완료"}</small></button>})}</div></article>})}</div>:<div className="compact-empty">검색 조건에 맞는 배분 좌석이 없습니다.</div>}<footer className="release-bar"><div><span>취소 선택</span><strong>{releasePicked.length}석</strong></div><label><span>취소 사유</span><input aria-label="취소 사유" value={releaseReason} onChange={(event)=>setReleaseReason(event.target.value)} placeholder="예: 단체 요청으로 좌석 회수" maxLength={500}/></label><button type="button" className="danger-button" disabled={releaseBusy||!releasePicked.length} onClick={()=>void releaseSelected()}>{releaseBusy?"취소 처리 중…":`선택한 ${releasePicked.length}석 배분 취소`}</button></footer></section>:<section className="split-layout allocation-layout"><article className="content-card form-card"><div className="section-title"><div><h2>운영 목적</h2><p>일반 배부·현장 확보·사용 제외를 같은 방식으로 지정합니다.</p></div><span className="step-badge">1</span></div><div className="segmented allocation-purpose-tabs"><button type="button" className={recipientType==="group"?"active":""} onClick={()=>{setRecipientType("group");setPicked([]);}}>단체</button><button type="button" className={recipientType==="individual"?"active":""} onClick={()=>{setRecipientType("individual");setPicked([]);}}>개인</button><button type="button" className={recipientType==="onsite"?"active":""} onClick={()=>{setRecipientType("onsite");setPicked([]);}}>현장 확보</button><button type="button" className={recipientType==="blocked"?"active":""} onClick={()=>{setRecipientType("blocked");setPicked([]);}}>사용 제외</button></div>{recipientType==="group"?<><label className="form-field"><span>단체명 *</span><input value={groupName} onChange={(event)=>setGroupName(event.target.value)} placeholder="단체명을 입력하세요"/></label><label className="form-field"><span>담당자</span><input value={assigneeName} onChange={(event)=>setAssigneeName(event.target.value)} placeholder="담당자 이름"/></label></>:recipientType==="individual"?<label className="form-field"><span>개인 이름 *</span><input value={assigneeName} onChange={(event)=>setAssigneeName(event.target.value)} placeholder="이름을 입력하세요"/></label>:recipientType==="onsite"?<div className="qr-generation-note"><strong>현장 배정용 좌석</strong><p>구역·열·범위로 미리 확보하고 현장에서 관람객에게 안내합니다.</p></div>:<><div className="segmented"><button type="button" className={exclusionAction==="block"?"active":""} onClick={()=>{setExclusionAction("block");setPicked([]);}}>제외 설정</button><button type="button" className={exclusionAction==="unblock"?"active":""} onClick={()=>{setExclusionAction("unblock");setPicked([]);}}>제외 해제</button></div><div className="qr-generation-note"><strong>회차별 사용 제외</strong><p>기둥·파손·스태프석처럼 배분할 수 없는 좌석을 회색으로 표시합니다.</p></div></>} {recipientType!=="onsite"&&recipientType!=="blocked"&&<label className="form-field"><span>연락처</span><input value={contact} onChange={(event)=>setContact(event.target.value)} placeholder="010-0000-0000"/></label>}<label className="form-field"><span>{recipientType==="blocked"?"설정 사유":"메모"}</span><input value={note} onChange={(event)=>setNote(event.target.value)} placeholder={recipientType==="blocked"?"예: 기둥 인접 좌석":"현장 전달사항을 입력하세요"}/></label></article>
      <article className="content-card form-card allocation-seat-card">
        <div className="section-title"><div><h2>실제 좌석 선택</h2><p>구역 또는 열을 선택하면 결번과 배분 완료 좌석은 자동 제외됩니다.</p></div><span className="step-badge">2</span></div>
        <div className="segmented allocation-mode-tabs"><button type="button" className={selectionMode==="zone"?"active":""} onClick={()=>setSelectionMode("zone")}>구역 선택</button><button type="button" className={selectionMode==="row"?"active":""} onClick={()=>setSelectionMode("row")}>열별 선택</button></div>
        <div className="inline-controls"><select aria-label="층" value={floorCode} onChange={(event)=>chooseFloor(event.target.value)}>{floors.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select>{selectionMode==="row"&&<><select aria-label="열" value={row} onChange={(event)=>setRow(event.target.value)}>{rows.map((label)=><option key={label} value={label}>{label}열</option>)}</select><button type="button" className="secondary-button" onClick={selectVisibleAvailable}>현재 열 전체 선택</button></>}<button type="button" className="secondary-button" onClick={()=>setPicked([])}>전체 선택 해제</button></div>
        {loading?<div className="compact-empty">좌석 정보를 불러오는 중입니다.</div>:selectionMode==="zone"?<>
          <div className={`zone-grid zone-grid--${floorCode==="1F"?"eight":"three"}`}>{zones.map((zone)=>{const candidates=seatsInBounds(zone.rowStart,zone.rowEnd,zone.numberStart,zone.numberEnd);const available=availableFrom(candidates);const selectedCount=available.filter((seat)=>picked.includes(seat.id)).length;const unavailableCount=candidates.length-available.length;const fullySelected=available.length>0&&selectedCount===available.length;return <button type="button" key={zone.id} className={`zone-card ${fullySelected?"active":""}`} disabled={!available.length} onClick={()=>toggleCandidates(candidates)}><span>{zone.description}</span><strong>{zone.label}</strong><small>{zone.rowStart}~{zone.rowEnd}열 · {zone.numberStart}~{zone.numberEnd}번</small><em>{selectedCount?`${selectedCount}/${available.length}석 선택`:`${available.length}석 선택 가능`}{unavailableCount?` · ${unavailableCount}석 제외`:""}</em></button>})}</div>
          <section className="range-builder" aria-label="사용자 지정 좌석 범위"><div><strong>사용자 지정 범위</strong><span>예: A~K열, 8~14번</span></div><label><span>시작 열</span><select aria-label="범위 시작 열" value={rangeRowStart} onChange={(event)=>setRangeRowStart(event.target.value)}>{rows.map((label)=><option key={label} value={label}>{label}</option>)}</select></label><label><span>끝 열</span><select aria-label="범위 끝 열" value={rangeRowEnd} onChange={(event)=>setRangeRowEnd(event.target.value)}>{rows.map((label)=><option key={label} value={label}>{label}</option>)}</select></label><label><span>시작 번호</span><select aria-label="범위 시작 번호" value={rangeNumberStart} onChange={(event)=>setRangeNumberStart(Number(event.target.value))}>{Array.from({length:maxSeatNumber},(_,index)=>index+1).map((number)=><option key={number} value={number}>{number}</option>)}</select></label><label><span>끝 번호</span><select aria-label="범위 끝 번호" value={rangeNumberEnd} onChange={(event)=>setRangeNumberEnd(Number(event.target.value))}>{Array.from({length:maxSeatNumber},(_,index)=>index+1).map((number)=><option key={number} value={number}>{number}</option>)}</select></label><button type="button" className="secondary-button" disabled={!customRangeAvailable.length} onClick={()=>toggleCandidates(customRangeSeats)}>{customRangeAvailable.length}석 범위 추가</button><small>총 {customRangeSeats.length}석 · 배분 완료 {customRangeSeats.length-customRangeAvailable.length}석 자동 제외</small></section>
        </>:<div className="seat-picker seat-picker--allocation">{visibleSeats.map((seat)=>{const record=allocated.get(seat.id);const selectable=availableFrom([seat]).length>0;const selected=picked.includes(seat.id);return <button type="button" key={seat.id} disabled={!selectable} title={record?(record.allocation_status==="blocked"?"사용 제외":record.group_name||record.assignee_name||"배분 완료"):seat.label} className={`${selected?"picked":""} ${!selectable?"is-unavailable":""}`} onClick={()=>setPicked((current)=>current.includes(seat.id)?current.filter((id)=>id!==seat.id):[...current,seat.id])}>{seat.row}-{String(seat.number).padStart(2,"0")}<small>{selectable?(recipientType==="blocked"&&exclusionAction==="unblock"?"제외 해제":"선택 가능"):record?.allocation_status==="blocked"?"사용 제외":"배분 완료"}</small></button>})}</div>}
        <div className="selection-summary"><span>선택 좌석</span><strong>{picked.length}석</strong><p>{pickedPreview||"좌석을 선택하세요"}{pickedSeats.length>12?` 외 ${pickedSeats.length-12}석`:""}</p></div><button className="primary-button" disabled={busy||loading||!picked.length} onClick={()=>void submit()}>{busy?"DB에 저장 중…":recipientType==="onsite"?`선택한 ${picked.length}석 현장 확보`:recipientType==="blocked"?`선택한 ${picked.length}석 제외 ${exclusionAction==="block"?"설정":"해제"}`:`선택한 ${picked.length}석 배분`}</button>
      </article></section>}
  </div>;
}

function EntryView({ hall, session, onStats, revision }: { hall: Hall; session: Session; onStats: (distributed: number, entered: number) => void; revision: number }) {
  const { user, requestAuth }=useCatalog();
  const [seats,setSeats]=useState<AllocationSeat[]>([]);
  const [records,setRecords]=useState<Map<number,AllocationRecord>>(new Map());
  const [query,setQuery]=useState("");
  const [mode,setMode]=useState<"admit"|"undo">("admit");
  const [picked,setPicked]=useState<number[]>([]);
  const [entrance,setEntrance]=useState("정문");
  const [reason,setReason]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<{tone:"success"|"error";text:string}|null>(null);
  const load=async()=>{setLoading(true);try{const result=await fetchAllocationData(hall.id,session.sessionId,Boolean(user));setSeats(result.seats);setRecords(new Map(result.records.map((record)=>[record.seat_id,record])));onStats(result.records.filter((record)=>record.allocation_status==="distributed").length,result.records.filter((record)=>record.admission_status==="entered").length);}catch(error){setMessage({tone:"error",text:error instanceof Error?error.message:"입장 정보를 불러오지 못했습니다."});}setLoading(false);};
  useEffect(()=>{let active=true;void fetchAllocationData(hall.id,session.sessionId,Boolean(user)).then((result)=>{if(!active)return;setSeats(result.seats);setRecords(new Map(result.records.map((record)=>[record.seat_id,record])));onStats(result.records.filter((record)=>record.allocation_status==="distributed").length,result.records.filter((record)=>record.admission_status==="entered").length);setLoading(false);}).catch((error:unknown)=>{if(!active)return;setMessage({tone:"error",text:error instanceof Error?error.message:"입장 정보를 불러오지 못했습니다."});setLoading(false);});return()=>{active=false;};},[hall.id,session.sessionId,user,revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const distributed=seats.flatMap((seat)=>{const record=records.get(seat.id);return record?.allocation_status==="distributed"?[{seat,record} satisfies ManagedAllocation]:[];});
  const normalized=query.trim().toLowerCase().replace(/\s+/g,"");
  const filtered=distributed.filter(({seat,record})=>!normalized||[seat.label,`${seat.row}-${seat.number}`,`${seat.floorName}${seat.row}${seat.number}`,record.group_name,record.assignee_name,record.contact].filter(Boolean).some((value)=>String(value).toLowerCase().replace(/\s+/g,"").includes(normalized)));
  const groups=[...filtered.reduce((result,item)=>{const recipient=item.record.group_name||item.record.assignee_name||"대상 미입력";const key=`${item.record.group_name?"group":"individual"}:${recipient}`;const current=result.get(key)??{key,recipient,type:item.record.group_name?"단체":"개인",items:[] as ManagedAllocation[]};current.items.push(item);result.set(key,current);return result;},new Map<string,{key:string;recipient:string;type:string;items:ManagedAllocation[]}>()).values()];
  const eligible=(item:ManagedAllocation)=>mode==="admit"?item.record.admission_status==="not_entered":item.record.admission_status==="entered";
  const recent=distributed.filter((item)=>item.record.admission_status==="entered"&&item.record.admitted_at).sort((left,right)=>String(right.record.admitted_at).localeCompare(String(left.record.admitted_at))).slice(0,8);
  const selectedItems=distributed.filter((item)=>picked.includes(item.seat.id));
  const changeMode=(next:"admit"|"undo")=>{setMode(next);setPicked([]);setMessage(null);};
  const toggleGroup=(items:ManagedAllocation[])=>{const ids=items.filter(eligible).map((item)=>item.seat.id);const allSelected=ids.length>0&&ids.every((id)=>picked.includes(id));setPicked((current)=>allSelected?current.filter((id)=>!ids.includes(id)):[...new Set([...current,...ids])]);};
  const submit=async()=>{if(!user){requestAuth();return;}if(!picked.length){setMessage({tone:"error",text:mode==="admit"?"입장 처리할 좌석을 선택해 주세요.":"입장을 취소할 좌석을 선택해 주세요."});return;}if(mode==="undo"&&!window.confirm(`선택한 ${picked.length}석의 입장 처리를 취소할까요?\n취소 이력은 감사 로그에 보존됩니다.`))return;setBusy(true);setMessage(null);const response=await createClient().rpc("operate_session_admissions",{p_session_code:session.id,p_seat_ids:picked,p_mode:mode,p_entrance_name:entrance.trim()||"정문",p_reason:reason.trim()||"입장 관리 화면에서 취소"});if(response.error){setMessage({tone:"error",text:response.error.message});setBusy(false);return;}const count=Number(response.data??picked.length);setPicked([]);setReason("");setMessage({tone:"success",text:mode==="admit"?`${count}석의 입장이 완료되었습니다.`:`${count}석의 입장이 취소되었습니다.`});await load();setBusy(false);};
  if(hall.id!=="haeun")return <div className="view"><PageHeader eyebrow="입장 운영" title="입장 관리" description={`${hall.name} 좌석 도면 등록 후 사용할 수 있습니다.`}/><div className="empty-state content-card"><strong>좌석 도면 준비 중</strong><p>실제 좌석이 등록되면 입장 검색과 처리를 사용할 수 있습니다.</p></div></div>;
  return <div className="view"><PageHeader eyebrow={`${hall.name} · ${session.event}`} title="입장 관리" description="좌석번호·이름·단체명으로 검색하고, 좌석별 또는 단체 전체를 한 번에 처리합니다." />
    <div className="qr-mode-tabs allocation-workflow-tabs"><button type="button" className={mode==="admit"?"active":""} onClick={()=>changeMode("admit")}>입장 처리</button><button type="button" className={mode==="undo"?"active":""} onClick={()=>changeMode("undo")}>입장 취소</button></div>
    {message&&<p className={`allocation-message allocation-message--${message.tone}`} role="status">{message.text}</p>}{!user&&<button type="button" className="auth-notice" onClick={requestAuth}>실제 입장 데이터를 보려면 직원 로그인이 필요합니다. 로그인하기</button>}
    <section className="entry-management-layout"><article className="content-card entry-search-card"><div className="section-title"><div><h2>배분 좌석 검색</h2><p>A-07, 개인 이름 또는 단체명을 입력하세요.</p></div><span className="step-badge">{filtered.length}석</span></div><div className="big-search"><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="좌석 · 이름 · 단체명 검색" aria-label="입장 좌석 검색"/><button type="button" onClick={()=>setQuery("")}>{query?"초기화":"검색"}</button></div>
      {loading?<div className="compact-empty">입장 데이터를 불러오는 중입니다.</div>:!distributed.length?<div className="empty-state"><strong>배분된 좌석이 없습니다</strong><p>좌석 배분을 먼저 완료하면 이곳에 입장 대상이 표시됩니다.</p></div>:!groups.length?<div className="compact-empty">검색 조건에 맞는 좌석이 없습니다.</div>:<div className="entry-group-list">{groups.map((group)=>{const eligibleItems=group.items.filter(eligible);return <article key={group.key} className="entry-group"><header><div><span>{group.type}</span><strong>{group.recipient}</strong><small>전체 {group.items.length}석 · 입장 {group.items.filter((item)=>item.record.admission_status==="entered").length}석</small></div><button type="button" disabled={!eligibleItems.length} onClick={()=>toggleGroup(group.items)}>{eligibleItems.length?`${eligibleItems.length}석 전체 선택`:mode==="admit"?"입장 완료":"취소 대상 없음"}</button></header><div className="entry-seat-grid">{group.items.map((item)=>{const canPick=eligible(item);const selected=picked.includes(item.seat.id);return <button type="button" key={item.seat.id} disabled={!canPick} className={`${selected?"picked":""} ${item.record.admission_status==="entered"?"is-entered":""}`} onClick={()=>setPicked((current)=>current.includes(item.seat.id)?current.filter((id)=>id!==item.seat.id):[...current,item.seat.id])}><strong>{item.seat.row}-{String(item.seat.number).padStart(2,"0")}</strong><small>{item.seat.floorName} · {item.record.admission_status==="entered"?"입장 완료":"미입장"}</small></button>})}</div></article>})}</div>}
    </article><aside className="entry-side"><article className="content-card entry-action-card"><div className="section-title"><div><h2>{mode==="admit"?"입장 확정":"입장 취소 확인"}</h2><p>선택한 좌석의 상태를 한 번에 변경합니다.</p></div></div><div className="entry-selected-summary"><span>선택 좌석</span><strong>{picked.length}석</strong><p>{selectedItems.slice(0,8).map((item)=>`${item.seat.row}-${String(item.seat.number).padStart(2,"0")}`).join(", ")||"좌석을 선택하세요"}{selectedItems.length>8?` 외 ${selectedItems.length-8}석`:""}</p></div>{mode==="admit"?<label className="form-field"><span>입구</span><input value={entrance} maxLength={100} onChange={(event)=>setEntrance(event.target.value)} placeholder="예: 정문"/></label>:<label className="form-field"><span>취소 사유</span><input value={reason} maxLength={500} onChange={(event)=>setReason(event.target.value)} placeholder="예: 중복 처리"/></label>}<button type="button" className={mode==="admit"?"primary-button":"danger-button"} disabled={busy||loading||!picked.length} onClick={()=>void submit()}>{busy?"DB 처리 중…":mode==="admit"?`선택한 ${picked.length}석 입장`:`선택한 ${picked.length}석 입장 취소`}</button></article>
      <article className="content-card recent-entry-card"><div className="section-title"><div><h2>최근 입장</h2><p>현재 회차의 실제 처리 내역입니다.</p></div><span className="step-badge">{recent.length}</span></div>{recent.length?<div className="recent-entry-list">{recent.map((item)=><div key={item.seat.id}><div><strong>{item.seat.row}-{String(item.seat.number).padStart(2,"0")}</strong><span>{item.record.group_name||item.record.assignee_name||"대상 미입력"}</span></div><small>{new Date(String(item.record.admitted_at)).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} · {item.record.entrance_name||"입구 미지정"}</small></div>)}</div>:<div className="compact-empty">아직 입장 처리된 좌석이 없습니다.</div>}</article></aside></section>
  </div>;
}

type TicketAdmissionResult = { status:"admitted"|"onsite_admitted"; seat_id: number; seat_code: string; floor_name: string; assignee_name: string | null; group_name: string | null; entrance_name: string; admitted_at: string };
type OnsiteTicketConfirmation = { status:"onsite_confirmation_required"; ticketCode:string; seat_id:number; seat_code:string; floor_name:string; entrance_name:string };

function ScanView({ hall, session, onStats }: { hall: Hall; session: Session; onStats: (distributed: number, entered: number) => void }) {
  const { user, requestAuth }=useCatalog();
  const videoRef=useRef<HTMLVideoElement>(null);
  const controlsRef=useRef<{stop:()=>void}|null>(null);
  const processingRef=useRef(false);
  const lastCodeRef=useRef<{code:string;at:number}|null>(null);
  const [cameraActive,setCameraActive]=useState(false);
  const [manualCode,setManualCode]=useState("");
  const [entrance,setEntrance]=useState("정문");
  const [result,setResult]=useState<TicketAdmissionResult|null>(null);
  const [pendingOnsite,setPendingOnsite]=useState<OnsiteTicketConfirmation|null>(null);
  const [message,setMessage]=useState<{tone:"success"|"error"|"warning";text:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [continuous,setContinuous]=useState(true);
  const [scanAlert,setScanAlert]=useState<string|null>(null);
  const stopCamera=()=>{controlsRef.current?.stop();controlsRef.current=null;setCameraActive(false);};
  useEffect(()=>()=>{controlsRef.current?.stop();},[]);
  const refreshStats=async()=>{const current=await fetchAllocationData(hall.id,session.sessionId,true);onStats(current.records.filter((record)=>record.allocation_status==="distributed").length,current.records.filter((record)=>record.admission_status==="entered").length);};
  const processTicket=async(rawCode:string)=>{const code=rawCode.trim();const now=Date.now();if(processingRef.current||!code)return;if(lastCodeRef.current?.code===code&&now-lastCodeRef.current.at<2500)return;if(!navigator.onLine){stopCamera();setScanAlert("네트워크가 끊어져 스캔을 중지했습니다. 연결 후 다시 시작해 주세요.");return;}if(!user){requestAuth();return;}lastCodeRef.current={code,at:now};processingRef.current=true;setBusy(true);setMessage(null);setPendingOnsite(null);const {data,error}=await createClient().rpc("operate_session_ticket",{p_session_code:session.id,p_ticket_code:code,p_entrance_name:entrance.trim()||"정문"});if(error){stopCamera();setMessage({tone:"error",text:error.message});setScanAlert(error.message);processingRef.current=false;setBusy(false);return;}const checked=data as TicketAdmissionResult|Omit<OnsiteTicketConfirmation,"ticketCode">;setManualCode("");if(checked.status==="onsite_confirmation_required"){stopCamera();setPendingOnsite({...checked,ticketCode:code});setMessage({tone:"warning",text:`${checked.seat_code}은 미배정 좌석입니다. 현장 배정 후 입장할지 확인해 주세요.`});processingRef.current=false;setBusy(false);return;}const admitted=checked as TicketAdmissionResult;setResult(admitted);setMessage({tone:"success",text:`${admitted.seat_code} 좌석 입장이 완료되었습니다.`});if("vibrate" in navigator)navigator.vibrate(70);try{await refreshStats();}catch{setMessage({tone:"success",text:`${admitted.seat_code} 입장은 완료되었습니다. 현황은 화면을 새로고침하면 반영됩니다.`});}processingRef.current=false;setBusy(false);if(!continuous)stopCamera();};
  const confirmOnsite=async()=>{if(!pendingOnsite||processingRef.current)return;processingRef.current=true;setBusy(true);setMessage(null);const {data,error}=await createClient().rpc("confirm_onsite_ticket",{p_session_code:session.id,p_ticket_code:pendingOnsite.ticketCode,p_entrance_name:entrance.trim()||"정문",p_assignee_name:"현장 입장"});if(error){setMessage({tone:"error",text:error.message});processingRef.current=false;setBusy(false);return;}const admitted=data as TicketAdmissionResult;setPendingOnsite(null);setResult(admitted);setMessage({tone:"success",text:`${admitted.seat_code}을 현장 배정하고 입장 처리했습니다.`});try{await refreshStats();}catch{setMessage({tone:"success",text:`${admitted.seat_code} 현장 입장은 완료되었습니다. 현황은 새로고침하면 반영됩니다.`});}processingRef.current=false;setBusy(false);};
  const undoLast=async()=>{if(!result||busy)return;if(!window.confirm(`${result.seat_code}의 방금 입장을 취소할까요?`))return;setBusy(true);const {error}=await createClient().rpc("operate_session_admissions",{p_session_code:session.id,p_seat_ids:[result.seat_id],p_mode:"undo",p_entrance_name:entrance.trim()||"정문",p_reason:"QR 스캔 최근 입장 취소"});if(error){setMessage({tone:"error",text:error.message});setScanAlert(error.message);}else{setMessage({tone:"success",text:`${result.seat_code} 입장을 취소했습니다.`});setResult(null);await refreshStats();}setBusy(false);};
  const startCamera=async()=>{if(!user){requestAuth();return;}if(!navigator.mediaDevices?.getUserMedia){setMessage({tone:"error",text:"이 브라우저에서는 카메라를 사용할 수 없습니다. 아래 코드 입력을 이용해 주세요."});return;}setMessage(null);setResult(null);setPendingOnsite(null);try{const { BrowserQRCodeReader }=await import("@zxing/browser");if(!videoRef.current)return;const reader=new BrowserQRCodeReader();controlsRef.current=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:"environment"}}},videoRef.current,(scanResult)=>{if(scanResult&&!processingRef.current)void processTicket(scanResult.getText());});setCameraActive(true);}catch(error){stopCamera();setMessage({tone:"error",text:error instanceof Error&&error.name==="NotAllowedError"?"카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용해 주세요.":"카메라를 시작하지 못했습니다. 코드 직접 입력을 이용해 주세요."});}};
  if(hall.id!=="haeun")return <div className="view"><PageHeader eyebrow="모바일 우선 기능" title="QR 스캔" description={`${hall.name} 좌석 도면과 티켓이 등록된 후 사용할 수 있습니다.`}/><div className="empty-state content-card"><strong>QR 운영 준비 중</strong><p>실제 좌석 등록 후 QR 입장을 연결합니다.</p></div></div>;
  return <div className="view view--scan"><PageHeader eyebrow={`${hall.name} · ${session.event}`} title="QR 빠른 입장" description="배정 좌석은 연속 처리하고, 미배정·중복·오류만 확인 화면에서 멈춥니다." />
    <div className="scan-quick-toolbar"><button type="button" className={`quick-admission-toggle ${continuous?"active":""}`} onClick={()=>setContinuous((value)=>!value)}><span>연속 스캔</span><strong>{continuous?"활성화":"비활성화"}</strong></button>{result&&<button type="button" className="recent-undo" disabled={busy} onClick={()=>void undoLast()}>최근 입장 취소 · {result.seat_code}</button>}</div>
    {message&&<p className={`allocation-message allocation-message--${message.tone}`} role="status">{message.text}</p>}{!user&&<button type="button" className="auth-notice" onClick={requestAuth}>QR 입장 처리는 직원 로그인이 필요합니다. 로그인하기</button>}
    <section className="scan-layout scan-layout--live"><article className="scanner-card"><div className={`camera-preview ${cameraActive?"is-active":""}`}><video ref={videoRef} muted playsInline aria-label="QR 스캔 카메라"/><div className="scan-corners"><span/><span/><span/><span/></div><p>{cameraActive?"QR을 사각형 안에 맞춰 주세요":"카메라를 시작해 주세요"}</p></div><button type="button" className={cameraActive?"secondary-button":"primary-button"} onClick={()=>cameraActive?stopCamera():void startCamera()}>{cameraActive?"카메라 중지":"QR 카메라 시작"}</button><p className="helper-text">연속 스캔에서는 성공 후 카메라가 유지됩니다. 같은 QR은 2.5초 동안 중복 인식하지 않습니다.</p><form className="manual-ticket-form" onSubmit={(event)=>{event.preventDefault();void processTicket(manualCode);}}><label className="form-field"><span>카메라 사용이 어려울 때</span><input value={manualCode} maxLength={300} onChange={(event)=>setManualCode(event.target.value)} placeholder="티켓 코드 직접 입력"/></label><button className="secondary-button" disabled={busy||!manualCode.trim()}>{busy?"확인 중…":"코드 확인"}</button></form></article>
      <article className="content-card scan-result"><div className="section-title"><div><h2>입장 확인</h2><p>배정 상태를 확인한 뒤 조건에 맞는 방식으로 처리합니다.</p></div></div>{result?<div className="scan-success"><span>{result.status==="onsite_admitted"?"현장 배정 · 입장 완료":"입장 완료"}</span><strong>{result.seat_code}</strong><h3>{result.group_name||result.assignee_name||"배부 대상 미입력"}</h3><dl><div><dt>층</dt><dd>{result.floor_name}</dd></div><div><dt>입구</dt><dd>{result.entrance_name}</dd></div><div><dt>처리 시각</dt><dd>{new Date(result.admitted_at).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}</dd></div></dl><button type="button" className="primary-button" onClick={()=>{setResult(null);setMessage(null);void startCamera();}}>다음 QR 스캔</button></div>:pendingOnsite?<div className="onsite-confirmation"><span>미배정 좌석</span><strong>{pendingOnsite.seat_code}</strong><h3>이 좌석을 현장 배정으로 입장 처리할까요?</h3><dl><div><dt>층</dt><dd>{pendingOnsite.floor_name}</dd></div><div><dt>배정 구분</dt><dd>현장 입장</dd></div><div><dt>입구</dt><dd>{entrance.trim()||"정문"}</dd></div></dl><p>입장을 누르면 좌석 배정과 입장 처리가 동시에 기록됩니다.</p><div><button type="button" className="secondary-button" disabled={busy} onClick={()=>{setPendingOnsite(null);setMessage(null);void startCamera();}}>취소·다시 스캔</button><button type="button" className="primary-button" disabled={busy} onClick={()=>void confirmOnsite()}>{busy?"처리 중…":"현장 배정 후 입장"}</button></div></div>:<div className="empty-state"><strong>QR을 기다리고 있습니다</strong><p>배정된 QR은 바로 입장 처리되고, 미배정 QR은 확인 화면이 표시됩니다.</p></div>}<label className="form-field scan-entrance"><span>현재 입구</span><input value={entrance} maxLength={100} disabled={cameraActive||busy||Boolean(pendingOnsite)} onChange={(event)=>setEntrance(event.target.value)} placeholder="예: 정문"/></label></article></section>
    {scanAlert&&<div className="scan-alert-backdrop" role="presentation"><section className="scan-alert" role="alertdialog" aria-modal="true"><strong>QR 처리 확인</strong><p>{scanAlert}</p><button className="primary-button" onClick={()=>{setScanAlert(null);setMessage(null);void startCamera();}}>확인하고 스캔 재개</button></section></div>}
  </div>;
}

type QrTarget = { seat: AllocationSeat; ticketCode: string; allocated: boolean };

function downloadBrowserFile(content: Blob|string, fileName: string) {
  const link=document.createElement("a");
  link.href=typeof content==="string"?content:URL.createObjectURL(content);
  link.download=fileName;document.body.appendChild(link);link.click();link.remove();
  if(typeof content!=="string")setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

function safeFilePart(value:string){return value.replace(/[\\/:*?"<>|]/g,"-").replace(/\s+/g,"_").slice(0,80);}

function GenerateView({ hall, session, revision }: { hall: Hall; session: Session; revision: number }) {
  const { user, requestAuth }=useCatalog();
  const [mode,setMode]=useState<"single"|"group"|"all">("single");
  const [seats,setSeats]=useState<AllocationSeat[]>([]);
  const [records,setRecords]=useState<Map<number,AllocationRecord>>(new Map());
  const [selectedSeatId,setSelectedSeatId]=useState(0);
  const [selectedGroup,setSelectedGroup]=useState("");
  const [preview,setPreview]=useState("");
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [message,setMessage]=useState<{tone:"success"|"error";text:string}|null>(null);
  useEffect(()=>{let active=true;void fetchAllocationData(hall.id,session.sessionId,Boolean(user)).then((data)=>{if(!active)return;setSeats(data.seats);setRecords(new Map(data.records.map((record)=>[record.seat_id,record])));setSelectedSeatId((current)=>current||data.seats[0]?.id||0);}).catch((error:unknown)=>{if(active)setMessage({tone:"error",text:error instanceof Error?error.message:"좌석 정보를 불러오지 못했습니다."});});return()=>{active=false;};},[hall.id,session.sessionId,user,revision]);
  const groups=[...new Set([...records.values()].filter((record)=>record.allocation_status==="distributed"&&record.group_name).map((record)=>String(record.group_name)))].sort((a,b)=>a.localeCompare(b));
  const effectiveGroup=selectedGroup||groups[0]||"";
  const toTarget=(seat:AllocationSeat):QrTarget=>{const record=records.get(seat.id);return {seat,ticketCode:record?.ticket_code||`${session.id}:${seat.seatCode}`,allocated:record?.allocation_status==="distributed"};};
  const targets:QrTarget[]=mode==="single"?seats.filter((seat)=>seat.id===selectedSeatId).map(toTarget):mode==="group"?seats.filter((seat)=>records.get(seat.id)?.group_name===effectiveGroup&&records.get(seat.id)?.allocation_status==="distributed").map(toTarget):seats.map(toTarget);
  const resetMode=(next:"single"|"group"|"all")=>{setMode(next);setPreview("");setProgress(0);setMessage(null);};
  const createPreview=async()=>{if(!user){requestAuth();return;}const target=targets[0];if(!target){setMessage({tone:"error",text:"QR을 생성할 좌석이 없습니다."});return;}setBusy(true);setMessage(null);try{const QRCode=await import("qrcode");const url=await QRCode.toDataURL(target.ticketCode,{width:512,margin:2,errorCorrectionLevel:"M",color:{dark:"#24212a",light:"#ffffff"}});setPreview(url);setMessage({tone:"success",text:`${target.seat.label} QR 미리보기가 생성되었습니다.`});}catch{setMessage({tone:"error",text:"QR 이미지를 생성하지 못했습니다."});}setBusy(false);};
  const downloadSingle=async()=>{if(!user){requestAuth();return;}if(!preview)await createPreview();const target=targets[0];if(!target)return;const QRCode=await import("qrcode");const url=preview||await QRCode.toDataURL(target.ticketCode,{width:1024,margin:2,errorCorrectionLevel:"M"});downloadBrowserFile(url,`[${safeFilePart(hall.name)}][${safeFilePart(target.seat.floorName)}-${target.seat.row}-${String(target.seat.number).padStart(2,"0")}].png`);};
  const downloadZip=async()=>{if(!user){requestAuth();return;}if(!targets.length){setMessage({tone:"error",text:"ZIP으로 생성할 좌석이 없습니다."});return;}setBusy(true);setProgress(0);setMessage(null);try{const [{default:JSZip},QRCode]=await Promise.all([import("jszip"),import("qrcode")]);const zip=new JSZip();for(let index=0;index<targets.length;index+=1){const target=targets[index];const dataUrl=await QRCode.toDataURL(target.ticketCode,{width:512,margin:2,errorCorrectionLevel:"M"});const fileName=`[${safeFilePart(hall.name)}][${safeFilePart(target.seat.floorName)}-${target.seat.row}-${String(target.seat.number).padStart(2,"0")}].png`;zip.file(`${safeFilePart(target.seat.floorName)}/${fileName}`,dataUrl.split(",")[1],{base64:true});if(index%10===0||index===targets.length-1)setProgress(Math.round((index+1)/targets.length*80));}const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE"},(metadata)=>setProgress(80+Math.round(metadata.percent*.2)));const scope=mode==="group"?effectiveGroup:"전체좌석";downloadBrowserFile(blob,`[${safeFilePart(hall.name)}][${safeFilePart(session.event)}][${safeFilePart(scope)}].zip`);setProgress(100);setMessage({tone:"success",text:`좌석별 QR ${targets.length}개를 ZIP으로 만들었습니다.`});}catch{setMessage({tone:"error",text:"QR ZIP 파일을 생성하지 못했습니다."});}setBusy(false);};
  if(hall.id!=="haeun")return <div className="view"><PageHeader eyebrow={`${hall.name} QR`} title="QR 생성" description="실제 좌석 도면 등록 후 사용할 수 있습니다."/><div className="empty-state content-card"><strong>좌석 도면 준비 중</strong><p>실제 좌석이 등록되면 좌석별 QR을 생성합니다.</p></div></div>;
  const firstTarget=targets[0];
  return <div className="view"><PageHeader eyebrow={`${hall.name} · ${session.date} ${session.time}`} title="QR 생성" description="현재 회차의 개별·단체·전체 좌석 QR을 PNG 또는 ZIP으로 내려받습니다." />
    <div className="qr-mode-tabs">{([['single','개별 생성'],['group','단체 생성'],['all','전체 좌석 생성']] as const).map(([id,label])=><button className={mode===id?'active':''} key={id} onClick={()=>resetMode(id)}>{label}</button>)}</div>{message&&<p className={`allocation-message allocation-message--${message.tone}`} role="status">{message.text}</p>}{!user&&<button type="button" className="auth-notice" onClick={requestAuth}>QR 생성은 행사 관리자 로그인이 필요합니다. 로그인하기</button>}
    <section className="split-layout qr-generation-layout"><article className="content-card form-card"><div className="section-title"><div><h2>{mode==="single"?"개별 좌석 QR":mode==="group"?"단체별 QR 묶음":"홀 전체 좌석 QR"}</h2><p>QR 안에는 현재 행사 회차와 좌석을 식별하는 티켓 코드가 들어갑니다.</p></div><span className="step-badge">{targets.length}</span></div>
      {mode==="single"&&<label className="form-field"><span>좌석 선택</span><select value={selectedSeatId} onChange={(event)=>{setSelectedSeatId(Number(event.target.value));setPreview("");}}>{seats.map((seat)=><option key={seat.id} value={seat.id}>{seat.floorName} {seat.row}-{String(seat.number).padStart(2,"0")} {records.get(seat.id)?.allocation_status==="distributed"?"· 배분 완료":"· 미배분"}</option>)}</select></label>}
      {mode==="group"&&<label className="form-field"><span>단체 선택</span><select value={effectiveGroup} onChange={(event)=>{setSelectedGroup(event.target.value);setPreview("");}}>{groups.map((group)=><option key={group}>{group}</option>)}</select></label>}
      {mode==="all"&&<div className="bulk-summary"><div><span>홀</span><strong>{hall.name}</strong></div><div><span>행사</span><strong>{session.event}</strong></div><div><span>생성 대상</span><strong>{targets.length}석</strong></div><div><span>분류</span><strong>층별 폴더</strong></div></div>}
      <div className="qr-generation-note"><strong>{mode==="single"&&firstTarget?.allocated?"바로 스캔 가능":mode==="group"?"배분 완료 좌석만 포함":"미배정 좌석은 현장 확인 필요"}</strong><p>{mode==="all"?"미리 인쇄할 수 있으며, 미배정 좌석은 스캔 후 직원이 확인해야 현장 배정과 입장이 함께 처리됩니다.":"현재 회차에만 사용할 수 있는 QR입니다."}</p></div>
      {busy&&mode!=="single"&&<div className="qr-progress"><span style={{width:`${progress}%`}}/><strong>{progress}%</strong></div>}
      {mode==="single"?<><button className="secondary-button" disabled={busy||!firstTarget} onClick={()=>void createPreview()}>{busy?"QR 생성 중…":"QR 미리보기 생성"}</button><button className="primary-button" disabled={busy||!firstTarget} onClick={()=>void downloadSingle()}>PNG 다운로드</button></>:<button className="primary-button" disabled={busy||!targets.length} onClick={()=>void downloadZip()}>{busy?`QR 생성 중 ${progress}%`:`QR ${targets.length}개 ZIP 다운로드`}</button>}
    </article><article className="content-card ticket-preview qr-ticket-preview"><span className="ticket-label">{hall.name} · {session.event}</span>{preview&&firstTarget?<><Image src={preview} alt={`${firstTarget.seat.label} QR 코드`} width={270} height={270} unoptimized/><h2>{firstTarget.seat.floorName} {firstTarget.seat.row}-{String(firstTarget.seat.number).padStart(2,"0")}</h2><strong>{firstTarget.allocated?records.get(firstTarget.seat.id)?.group_name||records.get(firstTarget.seat.id)?.assignee_name||"배분 완료":"미배분 좌석"}</strong><p>이 QR을 휴대폰 QR 스캔 화면에서 확인할 수 있습니다.</p></>:<div className="empty-state"><strong>{mode==="single"?"QR 미리보기":"ZIP 다운로드 준비"}</strong><p>{mode==="single"?"좌석을 선택하고 미리보기를 생성하세요.":`좌석별 PNG ${targets.length}개가 층별 폴더로 만들어집니다.`}</p></div>}</article></section>
  </div>;
}

function ReassignView({ hall,session,revision,onStats }: { hall:Hall;session:Session;revision:number;onStats:(distributed:number,entered:number)=>void }) {
  const {user,requestAuth}=useCatalog();
  const [seats,setSeats]=useState<AllocationSeat[]>([]);
  const [records,setRecords]=useState<Map<number,AllocationRecord>>(new Map());
  const [fromId,setFromId]=useState(0);
  const [toId,setToId]=useState(0);
  const [filterFloor,setFilterFloor]=useState("1F");
  const [filterRow,setFilterRow]=useState("A");
  const [query,setQuery]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState<{tone:"success"|"error";text:string}|null>(null);
  const load=async()=>{setLoading(true);try{const result=await fetchAllocationData(hall.id,session.sessionId,Boolean(user));setSeats(result.seats);setRecords(new Map(result.records.map((item)=>[item.seat_id,item])));onStats(result.records.filter((item)=>item.allocation_status==="distributed").length,result.records.filter((item)=>item.admission_status==="entered").length);}catch(error){setMessage({tone:"error",text:error instanceof Error?error.message:"좌석 정보를 불러오지 못했습니다."});}setLoading(false);};
  useEffect(()=>{let active=true;void fetchAllocationData(hall.id,session.sessionId,Boolean(user)).then((result)=>{if(!active)return;setSeats(result.seats);setRecords(new Map(result.records.map((item)=>[item.seat_id,item])));onStats(result.records.filter((item)=>item.allocation_status==="distributed").length,result.records.filter((item)=>item.admission_status==="entered").length);setLoading(false);}).catch((error:unknown)=>{if(!active)return;setMessage({tone:"error",text:error instanceof Error?error.message:"좌석 정보를 불러오지 못했습니다."});setLoading(false);});return()=>{active=false;};},[hall.id,session.sessionId,user,revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const assigned=seats.filter((seat)=>records.get(seat.id)?.allocation_status==="distributed");
  const available=seats.filter((seat)=>!records.has(seat.id)||records.get(seat.id)?.allocation_status==="available");
  const floors=[...new Set(seats.map((seat)=>seat.floorCode))];
  const rows=[...new Set(seats.filter((seat)=>seat.floorCode===filterFloor).map((seat)=>seat.row))].sort();
  const normalized=query.trim().toLowerCase().replace(/\s+/g,"");
  const matches=(seat:AllocationSeat)=>seat.floorCode===filterFloor&&seat.row===filterRow&&(!normalized||[seat.label,`${seat.row}-${seat.number}`,records.get(seat.id)?.group_name,records.get(seat.id)?.assignee_name].filter(Boolean).some((value)=>String(value).toLowerCase().replace(/\s+/g,"").includes(normalized)));
  const assignedVisible=assigned.filter(matches);
  const availableVisible=available.filter(matches);
  const submitReassign=async()=>{if(!user){requestAuth();return;}if(!fromId||!toId){setMessage({tone:"error",text:"기존 좌석과 새 좌석을 모두 선택해 주세요."});return;}if(!window.confirm("좌석을 변경해도 이미 인쇄된 QR은 그대로 사용할 수 있습니다. 재배정할까요?"))return;setBusy(true);setMessage(null);const {data,error}=await createClient().rpc("reassign_session_seat",{p_session_code:session.id,p_from_seat_id:fromId,p_to_seat_id:toId,p_reason:reason.trim()||"현장 좌석 변경"});if(error)setMessage({tone:"error",text:error.message});else{const result=data as {from_seat_code:string;to_seat_code:string;ticket_code_preserved:boolean};setMessage({tone:"success",text:`${result.from_seat_code} → ${result.to_seat_code} 재배정 완료 · 기존 인쇄 QR 유지`});setFromId(0);setToId(0);setReason("");await load();}setBusy(false);};
  if(hall.id!=="haeun")return <div className="view"><PageHeader eyebrow={`${hall.name} 관리자 권한`} title="현장 좌석 운영" description="실제 좌석 도면 등록 후 사용할 수 있습니다."/><div className="empty-state content-card"><strong>좌석 도면 준비 중</strong></div></div>;
  return <div className="view"><PageHeader eyebrow={`${hall.name} · ${session.event}`} title="현장 좌석 재배정" description="이미 인쇄한 QR은 그대로 유지하면서 실제 관람 좌석만 변경합니다."/>
    {message&&<p className={`allocation-message allocation-message--${message.tone}`} role="status">{message.text}</p>}
    <section className="content-card reassign-filter"><div className="inline-controls"><select aria-label="층" value={filterFloor} onChange={(event)=>{const next=event.target.value;setFilterFloor(next);setFilterRow("A");setFromId(0);setToId(0);}}>{floors.map((item)=><option key={item}>{item}</option>)}</select><select aria-label="열" value={filterRow} onChange={(event)=>{setFilterRow(event.target.value);setFromId(0);setToId(0);}}>{rows.map((item)=><option key={item}>{item}열</option>)}</select><input aria-label="재배정 좌석 검색" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="좌석·단체·이름 검색"/></div><small>층과 열을 먼저 고정한 뒤 좌석 또는 배부 대상을 빠르게 찾을 수 있습니다.</small></section>
    <section className="split-layout reassign-layout"><article className="content-card form-card"><div className="section-title"><div><h2>기존 배정 좌석</h2><p>입장 여부와 관계없이 좌석 위치만 옮기며 QR 식별값은 유지됩니다.</p></div><span className="step-badge">1</span></div><label className="form-field"><span>변경할 좌석</span><select value={fromId} onChange={(event)=>setFromId(Number(event.target.value))}><option value={0}>좌석을 선택하세요</option>{assignedVisible.map((seat)=>{const record=records.get(seat.id);return <option key={seat.id} value={seat.id}>{seat.floorName} {seat.row}-{String(seat.number).padStart(2,"0")} · {record?.group_name||record?.assignee_name||"배분 완료"}{record?.admission_status==="entered"?" · 입장 완료":""}</option>})}</select></label><div className="qr-generation-note"><strong>인쇄 QR 유지</strong><p>재배정 후에도 기존 티켓 QR을 스캔하면 새 좌석으로 조회되어 입장 처리됩니다.</p></div></article><article className="content-card form-card"><div className="section-title"><div><h2>새 좌석 선택</h2><p>같은 필터 안의 미배정 좌석만 선택할 수 있습니다.</p></div><span className="step-badge">2</span></div><label className="form-field"><span>새 좌석</span><select value={toId} onChange={(event)=>setToId(Number(event.target.value))}><option value={0}>좌석을 선택하세요</option>{availableVisible.map((seat)=><option key={seat.id} value={seat.id}>{seat.floorName} {seat.row}-{String(seat.number).padStart(2,"0")}</option>)}</select></label><label className="form-field"><span>재배정 사유</span><input value={reason} onChange={(event)=>setReason(event.target.value)} maxLength={500} placeholder="예: 시야 확보를 위한 현장 변경"/></label><button className="primary-button" disabled={busy||loading||!fromId||!toId} onClick={()=>void submitReassign()}>{busy?"재배정 중…":"QR 유지하고 좌석 재배정"}</button></article></section>
  </div>;
}

function HistoryView({ hall, session }: { hall: Hall; session: Session }) {
  const recent=recentForHall(hall);
  const history: Array<readonly [string, string, string, string, string]> = recent.map(([time, user, target, action]) => [time, user, target, action, "완료"] as const);
  return <div className="view"><PageHeader eyebrow={`${hall.name} 감사 로그`} title="처리 이력" description="현재 행사 회차의 입장·배분·취소·재배정 기록입니다." /><section className="content-card"><div className="section-title"><div><h2>회차 처리 내역</h2><p>{session.date} {session.time} · {session.event}</p></div><div className="filter-chips"><button className="active">전체</button><button>입장</button><button>배분</button><button>취소</button></div></div><div className="history-table"><div className="history-head"><span>시간</span><span>담당자</span><span>대상</span><span>처리</span><span>상태</span></div>{history.map((item,index)=><div key={`${item[0]}-${index}`}><span>{item[0]}</span><strong>{item[1]}</strong><span>{item[2]}</span><span>{item[3]}</span><em>{item[4]}</em></div>)}</div></section></div>;
}

function EventManagementView({ hall, onChangeContext }: { hall: Hall; onChangeContext: () => void }) {
  const { sessions: allSessions } = useCatalog();
  const sessions=allSessions.filter(item=>item.hallId===hall.id);
  return <div className="view"><PageHeader eyebrow={`${hall.name} 관리자 기능`} title="행사 관리" description="행사와 날짜·시간별 운영 회차를 등록하고 관리합니다."/><section className="content-card"><div className="section-title"><div><h2>{hall.name} 등록 행사</h2><p>같은 홀의 시간이 겹치는 회차는 등록할 수 없습니다.</p></div><button className="primary-button">새 행사 등록</button></div><div className="management-list">{sessions.map(session=><article key={session.id}><div className="management-date"><strong>{session.shortDate}</strong><span>{session.time}~{session.endTime}</span></div><div><span className={`session-status session-status--${session.statusTone}`}>{session.status}</span><h3>{session.event}</h3><p>{session.round} · 배부 {session.distributed}석 · 입장 {session.entered}석</p></div><button className="secondary-button" onClick={onChangeContext}>운영 화면으로</button></article>)}</div></section></div>;
}

type StaffPermission = { userId:string; displayName:string; role:"event_manager"|"entrance_staff"; hallCodes:HallId[] };

function StaffSettingsModal({ onClose }: { onClose:()=>void }) {
  const { halls }=useCatalog();
  const [staff,setStaff]=useState<StaffPermission[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState("");
  const [message,setMessage]=useState<{tone:"success"|"error";text:string}|null>(null);
  useEffect(()=>{let active=true;const client=createClient();void Promise.all([client.from("profiles").select("user_id, display_name, role").neq("role","super_admin").order("created_at"),client.from("staff_hall_access").select("user_id, halls!inner(code)")]).then(([profilesResult,accessResult])=>{if(!active)return;if(profilesResult.error||accessResult.error){setMessage({tone:"error",text:(profilesResult.error??accessResult.error)?.message||"직원 권한을 불러오지 못했습니다."});setLoading(false);return;}const accessByUser=new Map<string,HallId[]>();((accessResult.data??[]) as Array<{user_id:string;halls:unknown}>).forEach((item)=>{const hallRaw=Array.isArray(item.halls)?item.halls[0]:item.halls;if(!hallRaw||typeof hallRaw!=="object")return;const code=(hallRaw as {code:HallId}).code;accessByUser.set(item.user_id,[...(accessByUser.get(item.user_id)??[]),code]);});setStaff(((profilesResult.data??[]) as Array<{user_id:string;display_name:string;role:string}>).map((item)=>({userId:item.user_id,displayName:item.display_name,role:item.role==="event_manager"?"event_manager":"entrance_staff",hallCodes:accessByUser.get(item.user_id)??[]})));setLoading(false);});return()=>{active=false;};},[]);
  const update=(userId:string,changes:Partial<StaffPermission>)=>setStaff((current)=>current.map((item)=>item.userId===userId?{...item,...changes}:item));
  const toggleHall=(item:StaffPermission,hallCode:HallId)=>update(item.userId,{hallCodes:item.hallCodes.includes(hallCode)?item.hallCodes.filter((code)=>code!==hallCode):[...item.hallCodes,hallCode]});
  const save=async(item:StaffPermission)=>{setSaving(item.userId);setMessage(null);const {error}=await createClient().rpc("configure_staff_access",{p_user_id:item.userId,p_role:item.role,p_hall_codes:item.hallCodes});if(error)setMessage({tone:"error",text:error.message});else setMessage({tone:"success",text:`${item.displayName} 직원의 권한을 저장했습니다.`});setSaving("");};
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}><section className="context-modal staff-settings-modal" role="dialog" aria-modal="true" aria-labelledby="staff-settings-title"><div className="modal-heading"><div><p className="eyebrow">최고 관리자 전용</p><h2 id="staff-settings-title">직원 권한 설정</h2><p>입장 직원과 운영 매니저를 여러 명 지정할 수 있습니다. 직원 권한을 다시 설정하는 최종 권한은 최고 관리자에게만 있습니다.</p></div><button className="modal-close" onClick={onClose}>닫기</button></div>{message&&<p className={`allocation-message allocation-message--${message.tone}`} role="status">{message.text}</p>}{loading?<div className="compact-empty">직원 정보를 불러오는 중입니다.</div>:!staff.length?<div className="empty-state"><strong>설정할 직원이 없습니다</strong><p>직원이 계정을 만든 후 이 화면에서 역할과 홀을 지정할 수 있습니다.</p></div>:<div className="staff-permission-list">{staff.map((item)=><article key={item.userId}><div className="staff-permission-name"><span className="user-avatar">{item.displayName.slice(0,1)}</span><div><strong>{item.displayName}</strong><small>{ROLE_LABEL[item.role]}</small></div></div><div className="staff-capabilities"><label><input type="checkbox" checked readOnly/><span><strong>QR 빠른 입장</strong><small>배정 입장 · 미배정 현장 확인</small></span></label><label><input type="checkbox" checked={item.role==="event_manager"} onChange={(event)=>update(item.userId,{role:event.target.checked?"event_manager":"entrance_staff"})}/><span><strong>운영 매니저 권한</strong><small>행사 등록 · 좌석 배정 · QR 생성 · 운영 관리</small></span></label></div><fieldset><legend>운영 홀</legend>{halls.map((hall)=><label key={hall.id}><input type="checkbox" checked={item.hallCodes.includes(hall.id)} onChange={()=>toggleHall(item,hall.id)}/>{hall.name}</label>)}</fieldset><button className="primary-button" disabled={saving===item.userId} onClick={()=>void save(item)}>{saving===item.userId?"저장 중…":"권한 저장"}</button></article>)}</div>}</section></div>;
}

type SeatMapViewProps = {
  floor: Floor;
  setFloor: Dispatch<SetStateAction<Floor>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  selected: Seat | null;
  setSelected: Dispatch<SetStateAction<Seat | null>>;
  confirmed: boolean;
  setConfirmed: Dispatch<SetStateAction<boolean>>;
  hall: Hall;
  session: Session;
  onStats: (distributed: number, entered: number) => void;
  revision: number;
  realtimeStatus: RealtimeStatus;
};

function SeatMapView({ floor,setFloor,query,setQuery,selected,setSelected,setConfirmed,hall,session,onStats,revision,realtimeStatus }: SeatMapViewProps) {
  const { user,profile,requestAuth } = useCatalog();
  const [seatStates,setSeatStates]=useState<Map<string,SeatMapState>>(new Map());
  const [stateLoading,setStateLoading]=useState(Boolean(user));
  const [admissionBusy,setAdmissionBusy]=useState(false);
  const [quickAdmission,setQuickAdmission]=useState(false);
  const [message,setMessage]=useState<{tone:"success"|"error";text:string}|null>(null);
  const [mapScale,setMapScale]=useState(1);
  const [recentAdmission,setRecentAdmission]=useState<{seat:Seat;seatId:number}|null>(null);
  const canManage=profile?.role==="super_admin"||profile?.role==="event_manager";
  useEffect(()=>{
    if(hall.id!=="haeun"||!user)return;
    let active=true;
    void fetchAllocationData(hall.id,session.sessionId,true).then(({seats,records})=>{
      if(!active)return;
      const recordsBySeat=new Map(records.map((record)=>[record.seat_id,record]));
      const next=new Map<string,SeatMapState>();
      seats.forEach((seat)=>{
        const record=recordsBySeat.get(seat.id);
        next.set(`${seat.floorCode}-${seat.row}-${seat.number}`,{
          status:!record||record.allocation_status==="available"?"empty":record.admission_status==="entered"?"entered":record.allocation_status==="blocked"?"blocked":record.allocation_status==="distributed"?"distributed":"onsite",
          recipient:record?.group_name||record?.assignee_name||null,
          seatId:seat.id,
        });
      });
      setSeatStates(next);
      setStateLoading(false);
    }).catch(()=>{if(active)setStateLoading(false);});
    return()=>{active=false;};
  },[hall.id,session.sessionId,user,revision]);
  if(hall.id!=='haeun')return <div className="view"><PageHeader eyebrow={`${hall.name} · 1층`} title="좌석 현황" description="좌석 배치도 등록 전 레이아웃입니다."/><section className="content-card pending-seat-plan"><strong>{hall.name} 좌석 도면 준비 중</strong><p>실제 좌석 배치도를 받으면 복도·결번·좌석번호를 동일한 방식으로 반영합니다.</p><div><span>예상 규모</span><strong>{hall.capacity}석</strong></div></section></div>;
  const rows=floor==='1층'?ROWS_1F:ROWS_2F;
  const floorCode=floor==='1층'?"1F":"2F";
  const resolveSeatState=(rowLabel:string,seatNumber:number)=>seatStates.get(`${floorCode}-${rowLabel}-${seatNumber}`)??EMPTY_SEAT_STATE;
  const numberedSeatCount=rows.reduce((total,row)=>total+row.blocks.reduce((sum,range)=>sum+(range?range[1]-range[0]+1:0),0),0);
  const seatCount=floor==='1층'?506:numberedSeatCount;
  const queryId=query.trim().toUpperCase().replace(/\s+/g,'').replace(/^([A-T])-?(\d{1,2})$/,(_match: string,row: string,number: string)=>`${row}-${String(Number(number)).padStart(2,'0')}`);
  const selectedState=selected?resolveSeatState(selected.row,selected.number):null;
  const connected=Boolean(user&&realtimeStatus!=="offline");
  const refreshStats=async()=>{try{const stats=await fetchSessionStats(session.sessionId);onStats(stats.distributed,stats.entered);}catch{/* 실시간 재조회가 통계를 보완합니다. */}};
  const selectFloor=(label: Floor)=>{setFloor(label);setQuery('');setConfirmed(false);setSelected(null);setMessage(null);setMapScale(1);};
  const handleSearch=(event: FormEvent<HTMLFormElement>)=>{event.preventDefault();rows.forEach((config)=>config.blocks.forEach((range)=>{if(!range)return;const [start,end]=range;for(let number=start;number<=end;number+=1){const id=`${config.row}-${String(number).padStart(2,'0')}`;if(id===queryId){const state=resolveSeatState(config.row,number);setSelected({id,row:config.row,number,status:state.status,recipient:state.recipient});setConfirmed(false);}}}));};
  const admitSeat=async(target:Seat,targetState:SeatMapState)=>{
    if(!user){requestAuth();return;}
    if(!targetState.seatId||targetState.status==="entered"||targetState.status==="blocked")return;
    if(realtimeStatus==="offline"){setMessage({tone:"error",text:"네트워크 연결을 확인한 뒤 다시 시도해 주세요."});return;}
    setAdmissionBusy(true);
    setMessage(null);
    const {data,error}=await createClient().rpc("admit_session_seat",{p_session_code:session.id,p_seat_id:targetState.seatId,p_entrance_name:quickAdmission?"태블릿 빠른 입장":"태블릿 좌석표"});
    if(error){setMessage({tone:"error",text:error.message});setAdmissionBusy(false);return;}
    const key=`${floorCode}-${target.row}-${target.number}`;
    setSeatStates((current)=>{const next=new Map(current);next.set(key,{...targetState,status:"entered",recipient:targetState.recipient||"현장 입장"});return next;});
    setSelected({...target,status:"entered",recipient:targetState.recipient||"현장 입장"});
    setConfirmed(true);
    setRecentAdmission({seat:{...target,status:"entered",recipient:targetState.recipient||"현장 입장"},seatId:targetState.seatId});
    setMessage({tone:"success",text:`${floor} ${target.id} 좌석의 입장이 완료되었습니다.${targetState.status==="empty"?" 미배정 좌석은 현장 입장으로 기록했습니다.":""}`});
    await refreshStats();
    void data;
    setAdmissionBusy(false);
  };
  const undoAdmission=async(target:Seat,seatId:number)=>{
    if(!connected)return;
    if(!window.confirm(`${floor} ${target.id} 좌석의 입장 처리를 취소할까요?\n취소 이력은 보존됩니다.`))return;
    setAdmissionBusy(true);setMessage(null);
    const {error}=await createClient().rpc("operate_session_admissions",{p_session_code:session.id,p_seat_ids:[seatId],p_mode:"undo",p_entrance_name:"태블릿 좌석표",p_reason:"좌석 현황에서 입장 취소"});
    if(error){setMessage({tone:"error",text:error.message});setAdmissionBusy(false);return;}
    const key=`${floorCode}-${target.row}-${target.number}`;
    setSeatStates((current)=>{const next=new Map(current);const before=current.get(key);next.set(key,{...before,status:"distributed",recipient:before?.recipient??target.recipient??null,seatId});return next;});
    setSelected({...target,status:"distributed"});setRecentAdmission(null);setMessage({tone:"success",text:`${floor} ${target.id} 좌석의 입장을 취소했습니다.`});await refreshStats();setAdmissionBusy(false);
  };
  const releaseSelected=async()=>{
    if(!selected||!selectedState?.seatId||!canManage)return;
    if(!window.confirm(`${floor} ${selected.id} 좌석의 ${selectedState.status==="onsite"?"현장 확보":"배분"}를 취소할까요?`))return;
    setAdmissionBusy(true);setMessage(null);
    const {error}=await createClient().rpc("release_session_seats",{p_session_code:session.id,p_seat_ids:[selectedState.seatId],p_reason:"좌석 현황에서 배분 취소"});
    if(error){setMessage({tone:"error",text:error.message});setAdmissionBusy(false);return;}
    const key=`${floorCode}-${selected.row}-${selected.number}`;setSeatStates((current)=>{const next=new Map(current);next.set(key,{status:"empty",recipient:null,seatId:selectedState.seatId});return next;});setSelected({...selected,status:"empty",recipient:null});setMessage({tone:"success",text:`${floor} ${selected.id} 좌석을 미배분 상태로 되돌렸습니다.`});await refreshStats();setAdmissionBusy(false);
  };
  const unblockSelected=async()=>{
    if(!selected||!selectedState?.seatId||!canManage)return;
    setAdmissionBusy(true);setMessage(null);
    const {error}=await createClient().rpc("set_session_seat_block_status",{p_session_code:session.id,p_seat_ids:[selectedState.seatId],p_blocked:false,p_reason:"좌석 현황에서 사용 제외 해제"});
    if(error){setMessage({tone:"error",text:error.message});setAdmissionBusy(false);return;}
    const key=`${floorCode}-${selected.row}-${selected.number}`;setSeatStates((current)=>{const next=new Map(current);next.set(key,{status:"empty",recipient:null,seatId:selectedState.seatId});return next;});setSelected({...selected,status:"empty",recipient:null});setMessage({tone:"success",text:`${floor} ${selected.id} 좌석의 사용 제외를 해제했습니다.`});await refreshStats();setAdmissionBusy(false);
  };
  const primaryAction=async()=>{if(!selected||!selectedState?.seatId)return;if(selectedState.status==="entered")await undoAdmission(selected,selectedState.seatId);else if(selectedState.status==="blocked")await unblockSelected();else await admitSeat(selected,selectedState);};
  const handleMapSeat=(seat:Seat)=>{const state=resolveSeatState(seat.row,seat.number);setSelected(seat);setConfirmed(false);setMessage(null);if(quickAdmission&&!admissionBusy&&["empty","distributed","onsite"].includes(state.status))void admitSeat(seat,state);};
  const primaryLabel=!user?"직원 로그인 필요":realtimeStatus==="offline"?"연결 확인 필요":selectedState?.status==="entered"?"입장 취소":selectedState?.status==="blocked"?(canManage?"사용 제외 해제":"사용 제외 좌석"):selectedState?.status==="empty"?"현장 배정 후 입장":selectedState?.status==="onsite"?"확보 좌석 입장":"선택 좌석 입장";
  return <div className="view view--seats"><PageHeader eyebrow="실시간 좌석 운영" title={`${floor} 좌석 현황`} description={!user?"직원 로그인 후 실제 배분 상태를 확인할 수 있습니다.":stateLoading?"배분 상태를 불러오는 중입니다.":`${session.event} 배분 상태가 반영되었습니다.`} />
    <section className="toolbar" aria-label="좌석 도구"><div className="floor-tabs">{(['1층','2층'] as Floor[]).map(label=><button key={label} className={floor===label?'active':''} onClick={()=>selectFloor(label)}>{label}</button>)}</div><button type="button" className={`quick-admission-toggle ${quickAdmission?"active":""}`} aria-pressed={quickAdmission} disabled={!user||realtimeStatus==="offline"} onClick={()=>{setQuickAdmission((current)=>!current);setMessage(null);}}><span>빠른 입장</span><strong>{quickAdmission?"활성화":"비활성화"}</strong></button><form className="search" onSubmit={handleSearch}><label htmlFor="seat-search">좌석 검색</label><input id="seat-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="예: C-12"/><button>찾기</button></form><div className="map-zoom-controls" aria-label="좌석표 확대"><button type="button" onClick={()=>setMapScale((value)=>Math.max(1,value-.25))}>−</button><strong>{Math.round(mapScale*100)}%</strong><button type="button" onClick={()=>setMapScale((value)=>Math.min(2.5,value+.25))}>＋</button><button type="button" onClick={()=>setMapScale(1)}>맞춤</button></div>{recentAdmission&&<button type="button" className="recent-undo" onClick={()=>void undoAdmission(recentAdmission.seat,recentAdmission.seatId)}>방금 입장 취소</button>}<div className="legend">{STATUS.map(status=><span key={status}><i className={`dot dot--${status}`}/>{STATUS_LABEL[status]}</span>)}</div></section>
    <section className={`map-panel map-panel--${floor==='1층'?'one':'two'}`} onWheel={(event)=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();setMapScale((value)=>Math.min(2.5,Math.max(1,value+(event.deltaY<0?.15:-.15))));}}><div className="seat-map-canvas" style={{width:`${mapScale*100}%`,height:`${mapScale*100}%`}}>{floor==='1층'?<FirstFloorSvg selectedId={selected?.id} queryId={queryId} seatState={resolveSeatState} onSelect={handleMapSeat}/>:<SecondFloorSvg selectedId={selected?.id} queryId={queryId} seatState={resolveSeatState} onSelect={handleMapSeat}/>}</div></section>
    <footer className="selection-bar"><div className={`selection-message selection-message--${message?.tone??"idle"}`} role="status">{message?<><strong>{message.tone==="success"?"처리 완료":"확인 필요"}</strong><span>{message.text}</span></>:<><strong>{quickAdmission?"빠른 입장 활성화":"좌석 상태 안내"}</strong><span>{quickAdmission?"입장 가능한 좌석을 누르면 즉시 처리됩니다. 취소는 버튼으로만 가능합니다.":"좌석을 선택하면 가능한 처리 버튼이 표시됩니다."}</span></>}</div><div className="seat-total"><strong>{seatCount}</strong><span>도면 표기 {floor} 좌석</span></div><div className="selection-copy"><span>{quickAdmission?"빠른 입장 좌석":"선택 좌석"}</span><strong>{selected?.id??'좌석을 선택하세요'}</strong>{selectedState&&<em className={`state state--${selectedState.status}`}>{STATUS_LABEL[selectedState.status]}</em>}{selectedState?.recipient&&<small className="selection-recipient">{selectedState.recipient}</small>}</div><div className="selection-actions">{canManage&&selectedState&&["distributed","onsite"].includes(selectedState.status)&&<button className="secondary-button" disabled={admissionBusy||selectedState.status==="entered"} onClick={()=>void releaseSelected()}>{selectedState.status==="onsite"?"확보 해제":"배분 취소"}</button>}<button className={`confirm ${selectedState?.status==="entered"?"confirm--danger":""}`} disabled={quickAdmission||admissionBusy||!selectedState?.seatId||!connected||(selectedState.status==="blocked"&&!canManage)} onClick={()=>void primaryAction()}>{admissionBusy?"처리 중…":quickAdmission?"좌석 클릭으로 즉시 입장":primaryLabel}</button></div></footer>
  </div>;
}

function SeatManagerAppInner() {
  const { user, profile } = useCatalog();
  const [hall,setHall]=useState<Hall | null>(null);
  const [session,setSession]=useState<Session | null>(null);
  const [changeOpen,setChangeOpen]=useState(false);
  const [staffOpen,setStaffOpen]=useState(false);
  const [active,setActive]=useState<MenuId>('dashboard');
  const [floor, setFloor] = useState<Floor>("1층");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Seat | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const realtime=useSessionRealtime(session?.sessionId??null,user?.id??null);
  const realtimeStatus=realtime.status;
  const revision=realtime.revision;
  const resetTransient=()=>{setFloor('1층');setQuery('');setSelected(null);setConfirmed(false);};
  const openHall=(nextHall: Hall)=>{setHall(nextHall);setSession(null);};
  const openSession=(nextSession: Session)=>{setSession(nextSession);setActive('dashboard');resetTransient();};
  const changeContext=(nextHall: Hall,nextSession: Session)=>{setHall(nextHall);setSession(nextSession);setActive('dashboard');setChangeOpen(false);resetTransient();};
  const goHome=()=>{setHall(null);setSession(null);setChangeOpen(false);};
  if(!hall)return <HallSelectView onSelect={openHall}/>;
  if(!session)return <EventSelectView hall={hall} onBack={goHome} onSelect={openSession}/>;
  const visibleMenu=profile?.role==="entrance_staff"?MENU.filter(([id])=>ENTRANCE_MENU_IDS.has(id)):MENU;
  const updateStats=(distributed:number,entered:number)=>setSession((current)=>current?{...current,distributed,entered}:current);
  const dashboardSession=realtime.stats?.sessionId===session.sessionId?{...session,distributed:realtime.stats.distributed,entered:realtime.stats.entered}:session;
  const render=()=>{if(active==='dashboard')return <DashboardView onNavigate={setActive} hall={hall} session={dashboardSession} stats={realtime.stats?.sessionId===session.sessionId?realtime.stats:null}/>;if(active==='allocation')return <AllocationView hall={hall} session={session} revision={revision} onStats={updateStats}/>;if(active==='entry')return <EntryView hall={hall} session={session} revision={revision} onStats={updateStats}/>;if(active==='scan')return <ScanView hall={hall} session={session} onStats={updateStats}/>;if(active==='generate')return <GenerateView hall={hall} session={session} revision={revision}/>;if(active==='reassign')return <ReassignView hall={hall} session={session} revision={revision} onStats={updateStats}/>;if(active==='history')return <HistoryView hall={hall} session={session}/>;if(active==='events')return <EventManagementView hall={hall} onChangeContext={()=>setChangeOpen(true)}/>;return <SeatMapView {...{floor,setFloor,query,setQuery,selected,setSelected,confirmed,setConfirmed,hall,session,revision,realtimeStatus}} onStats={updateStats}/>;};
  const operatorName = profile?.displayName || user?.email?.split("@")[0] || "로그인 필요";
  return <main className="tablet-shell"><aside className="sidebar"><button className="brand-button" onClick={goHome} aria-label="전체 홀 선택으로"><BrandLockup/></button><div className="sidebar-context"><span>현재 운영</span><strong>{hall.name}</strong><small>{session.time} · {session.round}</small></div><nav aria-label="주요 메뉴">{visibleMenu.map(([id,label],index)=><button key={id} className={active===id?'active':''} onClick={()=>setActive(id)}><span>{String(index+1).padStart(2,'0')}</span>{label}</button>)}</nav><div className="sidebar-bottom"><div><span className="user-avatar">{operatorName.slice(0,1)}</span><p><strong>{operatorName}</strong><small>{ROLE_LABEL[profile?.role||""]||"현장 운영 직원"}</small></p></div><button onClick={()=>profile?.role==="super_admin"?setStaffOpen(true):goHome()}>{profile?.role==="super_admin"?"직원 권한 설정":"홀 선택"}</button></div></aside><section className="workspace workspace--context"><OperationContextBar hall={hall} session={session} realtimeStatus={realtimeStatus} onHome={goHome} onHall={()=>setSession(null)} onChange={()=>setChangeOpen(true)}/><div className="workspace-content">{render()}</div></section>{changeOpen&&<ChangeContextModal currentHall={hall} currentSession={session} onClose={()=>setChangeOpen(false)} onApply={changeContext}/>} {staffOpen&&<StaffSettingsModal onClose={()=>setStaffOpen(false)}/>}</main>;
}

export function SeatManagerApp({ initialHalls = FALLBACK_HALLS, initialSessions = FALLBACK_SESSIONS, dataSource = "fallback" }: { initialHalls?: Hall[]; initialSessions?: Session[]; dataSource?: "supabase" | "fallback" }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ displayName: string; role: string } | null>(null);
  const [accessibleHallCodes,setAccessibleHallCodes]=useState<HallId[]|null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    let active = true;
    const loadProfile = async (nextUser: User | null) => {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) { setProfile(null); setAccessibleHallCodes(null); return; }
      const { data } = await supabase.from("profiles").select("display_name, role").eq("user_id", nextUser.id).maybeSingle();
      if(!active)return;
      setProfile(data ? { displayName: data.display_name, role: data.role } : null);
      if(data?.role==="super_admin"){setAccessibleHallCodes(null);return;}
      const {data:accessData}=await supabase.from("staff_hall_access").select("halls!inner(code)").eq("user_id",nextUser.id);
      if(active)setAccessibleHallCodes(((accessData??[]) as Array<{halls:unknown}>).flatMap((item)=>{const raw=Array.isArray(item.halls)?item.halls[0]:item.halls;return raw&&typeof raw==="object"?[(raw as {code:HallId}).code]:[];}));
    };
    void supabase.auth.getUser().then(({ data }) => loadProfile(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { void loadProfile(session?.user ?? null); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [supabase]);
  const signOut = async () => { await supabase.auth.signOut(); window.location.reload(); };
  return <CatalogContext.Provider value={{ halls: initialHalls, sessions: initialSessions, dataSource, user, profile, accessibleHallCodes, requestAuth: () => setAuthOpen(true), signOut }}><SeatManagerAppInner />{authOpen && <AuthModal onClose={() => setAuthOpen(false)}/>}</CatalogContext.Provider>;
}
