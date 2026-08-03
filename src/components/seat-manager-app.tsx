"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { FALLBACK_HALLS, FALLBACK_SESSIONS } from "@/lib/hall-catalog";
import type { Hall, HallId, Session } from "@/lib/hall-catalog";

type SeatStatus = "distributed" | "entered" | "empty" | "onsite";
type SeatRange = readonly [number, number] | null;
type RowConfig = { row: string; blocks: SeatRange[] };
type Floor = "1층" | "2층";
type Seat = { id: string; row: string; number: number; status: SeatStatus };
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

const STATUS: SeatStatus[] = ["distributed", "entered", "empty", "onsite"];
const STATUS_LABEL: Record<SeatStatus, string> = { distributed: "배부 완료", entered: "입장 완료", empty: "미입장", onsite: "현장 배정" };
const SEAT_W = 29;
const SEAT_H = 18;
const SEAT_GAP = 2;

function seatStatus(rowIndex: number, seatNumber: number): SeatStatus {
  if ((rowIndex * 11 + seatNumber) % 17 === 0) return "onsite";
  if ((rowIndex * 7 + seatNumber) % 9 === 0) return "entered";
  if ((rowIndex * 5 + seatNumber) % 13 === 0) return "empty";
  return "distributed";
}

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
  onSelect: (seat: Seat) => void;
};

function SvgSeat({ row, number, rowIndex, x, y, angle = 0, width = SEAT_W, height = SEAT_H, selectedId, queryId, onSelect }: SvgSeatProps) {
  const id = `${row}-${String(number).padStart(2, "0")}`;
  const status = seatStatus(rowIndex, number);
  const selected = selectedId === id;
  const searched = queryId === id;
  const activate = () => onSelect({ id, row, number, status });

  return (
    <g
      className={`svg-seat svg-seat--${status} ${selected ? "is-selected" : ""} ${searched ? "is-searched" : ""}`}
      transform={`translate(${x} ${y}) rotate(${angle} ${width / 2} ${height / 2})`}
      role="button"
      tabIndex={0}
      aria-label={`${id} ${STATUS_LABEL[status]}`}
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

function SvgSeatBlock({ range, row, rowIndex, x, y, align = "start", width = SEAT_W, height = SEAT_H, gap = SEAT_GAP, selectedId, queryId, onSelect }: SvgSeatBlockProps) {
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
      onSelect={onSelect}
    />
  ));
}

type SeatMapSvgProps = Pick<SvgSeatProps, "selectedId" | "queryId" | "onSelect">;

function FirstFloorSvg({ selectedId, queryId, onSelect }: SeatMapSvgProps) {
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
              <SvgSeatBlock range={config.blocks[0]} row={config.row} rowIndex={rowIndex} x={230} y={y} align="end" selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
              <SvgSeatBlock range={config.blocks[1]} row={config.row} rowIndex={rowIndex} x={525} y={y} align="end" selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
              <SvgSeatBlock range={config.blocks[2]} row={config.row} rowIndex={rowIndex} x={595} y={y} selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
              <SvgSeatBlock range={config.blocks[3]} row={config.row} rowIndex={rowIndex} x={890} y={y} selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
            </g>
          );
        })}
      </g>

      <g className="lobby-mark">
        <text x="560" y="590">로비</text>
      </g>
    </svg>
  );
}

function SecondFloorSvg({ selectedId, queryId, onSelect }: SeatMapSvgProps) {
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
              <SvgSeatBlock range={config.blocks[0]} row={config.row} rowIndex={rowIndex} x={leftEdge} y={y} align="end" width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
              {config.row === "A" ? (
                <>
                  <SvgSeatBlock range={config.blocks[1]} row={config.row} rowIndex={rowIndex} x={485} y={y} align="end" width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
                  <SvgSeatBlock range={config.blocks[2]} row={config.row} rowIndex={rowIndex} x={635} y={y} width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
                  <g className="control-desk-svg"><rect x="513" y={y - 3} width="94" height="23" rx="4" /><text x="560" y={y + 7}>CONTROL DESK</text></g>
                  <SvgSeatBlock range={config.blocks[3]} row={config.row} rowIndex={rowIndex} x={rightEdge} y={y} width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
                </>
              ) : (
                <>
                  <SvgSeatBlock range={config.blocks[1]} row={config.row} rowIndex={rowIndex} x={329} y={y} width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
                  <SvgSeatBlock range={config.blocks[2]} row={config.row} rowIndex={rowIndex} x={rightEdge} y={y} width={width} height={height} gap={gap} selectedId={selectedId} queryId={queryId} onSelect={onSelect} />
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

type CatalogContextValue = {
  halls: Hall[];
  sessions: Session[];
  dataSource: "supabase" | "fallback";
};

const CatalogContext = createContext<CatalogContextValue>({
  halls: FALLBACK_HALLS,
  sessions: FALLBACK_SESSIONS,
  dataSource: "fallback",
});

function useCatalog() {
  return useContext(CatalogContext);
}

const RECENT: Activity[] = [
  ["19:28:42", "김하은", "1층 R-21", "입장 완료"],
  ["19:28:17", "이준호", "1층 F-22", "입장 완료"],
  ["19:27:55", "박서연", "2층 C-18", "QR 입장"],
  ["19:27:33", "최민수", "1층 A-21", "입장 완료"],
];

function recentForHall(hall: Hall): Activity[] {
  if(hall.id==='haeun')return RECENT;
  if(hall.id==='art')return [["10:28:42","김하은","1층 R-21","입장 완료"],["10:28:17","이준호","1층 F-22","입장 완료"],["10:27:55","박서연","1층 C-18","QR 입장"],["10:27:33","최민수","1층 A-21","입장 완료"]];
  return [["10:48:42","김하은","1층 H-12","입장 완료"],["10:48:17","이준호","1층 F-08","입장 완료"],["10:47:55","박서연","1층 C-18","QR 입장"],["10:47:33","최민수","1층 A-11","입장 완료"]];
}

function BrandLockup() {
  return <div className="brand brand--large"><span>하</span><div><strong>하은홀</strong><small>현장 운영 시스템</small></div></div>;
}

function HallSelectView({ onSelect }: { onSelect: (hall: Hall) => void }) {
  const { halls, dataSource } = useCatalog();
  return <main className="selection-shell">
    <header className="selection-topbar"><BrandLockup/><div className="selection-user"><span className="user-avatar">김</span><div><strong>김하은</strong><small>현장 운영 담당자</small></div></div></header>
    <section className="selection-content">
      <div className="selection-intro"><p className="eyebrow">오늘의 현장 운영</p><h1>운영할 홀을 선택하세요</h1><p>홀을 선택하면 해당 홀에 등록된 행사와 회차만 표시됩니다.</p></div>
      <div className="hall-card-grid">
        {halls.map((hall,index)=><button className="hall-card" key={hall.id} onClick={()=>onSelect(hall)}>
          <span className="hall-index">0{index+1}</span><div><strong>{hall.name}</strong><p>{hall.floors}</p></div><div className="hall-capacity"><strong>{hall.capacity}</strong><span>석</span></div><small>{hall.note}</small><em>행사 조회</em>
        </button>)}
      </div>
      <aside className="selection-note"><strong>{dataSource === "supabase" ? "Supabase 데이터 연결됨" : "오프라인 미리보기"}</strong><span>선택한 홀의 행사·좌석·입장·QR 정보만 독립적으로 관리합니다.</span></aside>
    </section>
  </main>;
}

function EventSelectView({ hall, onBack, onSelect }: { hall: Hall; onBack: () => void; onSelect: (session: Session) => void }) {
  const { sessions: allSessions } = useCatalog();
  const sessions=allSessions.filter(item=>item.hallId===hall.id);
  const dates=[...new Set(sessions.map(item=>item.shortDate))];
  return <main className="selection-shell">
    <header className="selection-topbar"><BrandLockup/><button className="ghost-button" onClick={onBack}>전체 홀로</button></header>
    <section className="selection-content selection-content--events">
      <div className="event-select-heading"><div><p className="eyebrow">{hall.floors} · {hall.capacity}석</p><h1>{hall.name} 행사 선택</h1><p>운영하거나 조회할 날짜와 회차를 선택하세요.</p></div><div className="date-chips">{dates.map((date,index)=><button className={index===0?'active':''} key={date}>{date}</button>)}</div></div>
      <div className="event-list">
        {sessions.map(session=><article className="event-card" key={session.id}>
          <div className="event-time"><strong>{session.time}</strong><span>{session.endTime} 종료</span></div>
          <div className="event-main"><div><span className={`session-status session-status--${session.statusTone}`}>{session.status}</span><h2>{session.event}</h2><p>{session.round} · {session.date}</p></div><div className="event-stats"><span>배부 <strong>{session.distributed}</strong></span><span>입장 <strong>{session.entered}</strong></span></div></div>
          <button className="primary-button" onClick={()=>onSelect(session)}>{session.status==='종료'?'내역 보기':'운영 시작'}</button>
        </article>)}
      </div>
      <button className="new-event-card">새 행사 또는 회차 등록</button>
    </section>
  </main>;
}

function OperationContextBar({ hall, session, onHome, onHall, onChange }: { hall: Hall; session: Session; onHome: () => void; onHall: () => void; onChange: () => void }) {
  return <header className="operation-context">
    <nav aria-label="현재 운영 위치"><button onClick={onHome}>전체 홀</button><span>›</span><button onClick={onHall}>{hall.name}</button><span>›</span><strong>{session.date} {session.time}</strong></nav>
    <div className="operation-event"><span className={`session-status session-status--${session.statusTone}`}>{session.status}</span><strong>{session.event} {session.round}</strong></div>
    <button className="change-context-button" onClick={onChange}>홀·행사 변경</button>
  </header>;
}

function ChangeContextModal({ currentHall, currentSession, onClose, onApply }: { currentHall: Hall; currentSession: Session; onClose: () => void; onApply: (hall: Hall, session: Session) => void }) {
  const { halls, sessions } = useCatalog();
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

function DashboardView({ onNavigate, hall, session }: { onNavigate: (menu: MenuId) => void; hall: Hall; session: Session }) {
  const capacity=hall.capacity;
  const unused=Math.max(capacity-session.distributed,0);
  const waiting=Math.max(session.distributed-session.entered,0);
  const enteredRate=capacity?`${Math.round(session.entered/capacity*100)}%`:'0%';
  const recent=recentForHall(hall);
  return <div className="view view--dashboard">
    <PageHeader eyebrow={`${hall.name} · ${session.date} ${session.time}`} title="운영 현황" description={`${session.event} ${session.round}의 좌석과 입장 현황입니다.`} />
    <section className="metric-grid">
      {[["전체 좌석",capacity,"100%"],["배부 완료",session.distributed,`${Math.round(session.distributed/capacity*100)}%`],["입장 완료",session.entered,enteredRate],["미입장",waiting,`${Math.round(waiting/capacity*100)}%`]].map(([label,value,rate],index)=><article className={`metric-card metric-card--${index}`} key={label}><span>{label}</span><strong>{value}<small>석</small></strong><em>{rate}</em></article>)}
    </section>
    <section className="dashboard-grid">
      <article className="content-card progress-card"><div className="section-title"><div><h2>{hall.id==='haeun'?'층별 입장 진행률':'입장 진행률'}</h2><p>현재 선택 회차의 실시간 기준</p></div><button className="text-button" onClick={()=>onNavigate('seats')}>좌석표 보기</button></div>{hall.id==='haeun'?<><div className="floor-progress"><strong>1층</strong><div><i style={{width:'65%'}} /></div><span>329 / 506</span></div><div className="floor-progress"><strong>2층</strong><div><i style={{width:'58%'}} /></div><span>109 / 188</span></div></>:<div className="floor-progress"><strong>1층</strong><div><i style={{width:enteredRate}} /></div><span>{session.entered} / {capacity}</span></div>}<p className="unused-copy">현재 미배분 좌석 {unused}석</p></article>
      <article className="content-card quick-card"><div className="section-title"><div><h2>빠른 실행</h2><p>현장 업무를 바로 시작하세요.</p></div></div><div className="quick-actions"><button onClick={()=>onNavigate('allocation')}>새 좌석 배분</button><button onClick={()=>onNavigate('scan')}>QR 빠른 스캔</button><button onClick={()=>onNavigate('generate')}>QR 생성</button><button onClick={()=>onNavigate('reassign')}>빈 좌석 재배정</button></div></article>
      <article className="content-card recent-card"><div className="section-title"><div><h2>최근 입장 내역</h2><p>{hall.name}에서 방금 처리된 좌석입니다.</p></div><button className="text-button" onClick={()=>onNavigate('history')}>전체 보기</button></div><div className="activity-list">{recent.map(item=><div key={item[0]}><time>{item[0]}</time><strong>{item[1]}</strong><span>{item[2]}</span><em>{item[3]}</em></div>)}</div></article>
    </section>
  </div>;
}

function FormField({ label, placeholder, defaultValue }: { label: string; placeholder?: string; defaultValue?: string }) {
  return <label className="form-field"><span>{label}</span><input placeholder={placeholder} defaultValue={defaultValue} /></label>;
}

function AllocationView() {
  const [done,setDone]=useState(false);
  const [picked,setPicked]=useState(['C-12','C-13']);
  const choices=['C-10','C-11','C-12','C-13','C-14','C-15'];
  return <div className="view"><PageHeader eyebrow="사전 배부" title="좌석 배분" description="개인 또는 단체에 여러 좌석을 한 번에 배분합니다." />
    {done && <div className="notice notice--success">C열 좌석 {picked.length}석이 ‘행복지역아동센터’에 배분되었습니다.</div>}
    <section className="split-layout"><article className="content-card form-card"><div className="section-title"><div><h2>배부 대상 정보</h2><p>연락처는 선택 입력입니다.</p></div><span className="step-badge">1</span></div><div className="segmented"><button className="active">단체</button><button>개인</button></div><FormField label="단체명" defaultValue="행복지역아동센터"/><div className="form-row"><FormField label="담당자" defaultValue="김하은"/><FormField label="연락처" placeholder="010-0000-0000"/></div><FormField label="메모" placeholder="현장 전달사항을 입력하세요"/></article>
      <article className="content-card form-card"><div className="section-title"><div><h2>좌석 선택</h2><p>선택 좌석은 배분 전에 다시 확인합니다.</p></div><span className="step-badge">2</span></div><div className="inline-controls"><select aria-label="층"><option>1층</option><option>2층</option></select><select aria-label="열"><option>C열</option><option>D열</option></select><button className="secondary-button">연속 좌석 찾기</button></div><div className="seat-picker">{choices.map(id=><button key={id} className={picked.includes(id)?'picked':''} onClick={()=>setPicked(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id])}>{id}</button>)}</div><div className="selection-summary"><span>선택 좌석</span><strong>{picked.length}석</strong><p>{picked.join(', ') || '좌석을 선택하세요'}</p></div><button className="primary-button" disabled={!picked.length} onClick={()=>setDone(true)}>좌석 {picked.length}석 배분 완료</button></article></section>
  </div>;
}

function EntryView() {
  const [entered,setEntered]=useState(false);
  return <div className="view"><PageHeader eyebrow="중앙입구 · 담당자 김하은" title="입장 관리" description="좌석번호나 배부 대상을 검색해 빠르게 입장 처리합니다." />
    <section className="split-layout split-layout--entry"><article className="content-card form-card"><div className="section-title"><div><h2>좌석 빠른 검색</h2><p>C-12, 1 C 12, 이름 또는 단체명</p></div></div><div className="big-search"><input defaultValue="C-12" aria-label="입장 좌석 검색"/><button>검색</button></div><div className="result-card"><div className="seat-token">C-12</div><div><strong>1층 C열 12번</strong><p>행복지역아동센터 · 배부 완료</p></div><em>{entered?'입장 완료':'미입장'}</em></div><button className="primary-button" onClick={()=>setEntered(true)}>{entered?'입장 완료 처리됨':'입장 확인'}</button>{entered&&<button className="undo-button" onClick={()=>setEntered(false)}>방금 처리 취소</button>}</article>
      <article className="content-card"><div className="section-title"><div><h2>최근 처리</h2><p>실수 시 즉시 취소할 수 있습니다.</p></div></div><div className="activity-list activity-list--stack">{RECENT.slice(0,3).map(item=><div key={item[0]}><time>{item[0]}</time><strong>{item[1]}</strong><span>{item[2]}</span><em>{item[3]}</em></div>)}</div></article></section>
  </div>;
}

function GeneratedQr({ value }: { value: string }) {
  const [source,setSource]=useState('');
  useEffect(()=>{let active=true;QRCode.toDataURL(value,{width:420,margin:2,errorCorrectionLevel:'M',color:{dark:'#221e26',light:'#ffffff'}}).then(url=>{if(active)setSource(url)});return()=>{active=false};},[value]);
  return source?<Image className="qr-code" src={source} alt="하은홀 입장용 QR 코드" width={210} height={210} unoptimized/>:null;
}

function ScanView() {
  const [scanned,setScanned]=useState(false);
  return <div className="view"><PageHeader eyebrow="모바일 우선 기능" title="QR 스캔" description="QR은 좌석표와 분리된 전용 화면에서 빠르게 처리합니다." />
    <section className="scan-layout"><article className="scanner-card"><div className="camera-preview"><div className="scan-corners"><span/><span/><span/><span/></div><p>{scanned?'QR을 인식했습니다':'QR을 프레임 안에 맞춰주세요'}</p></div><button className="primary-button" onClick={()=>setScanned(true)}>{scanned?'다시 스캔':'스캔 시뮬레이션'}</button><p className="helper-text">실제 구현 시 모바일 카메라 권한과 HTTPS 환경을 사용합니다.</p></article><article className="content-card scan-result"><div className="section-title"><div><h2>스캔 결과</h2><p>처리 전 배부 대상과 좌석을 확인합니다.</p></div></div>{scanned?<><div className="result-card result-card--large"><div className="seat-token">C-12</div><div><strong>행복지역아동센터</strong><p>1층 C열 12번 · 미입장</p></div></div><button className="primary-button">QR 입장 확인</button></>:<div className="empty-state"><strong>대기 중</strong><p>QR을 인식하면 이곳에 좌석 정보가 표시됩니다.</p></div>}</article></section>
  </div>;
}

function GenerateView({ hall, session }: { hall: Hall; session: Session }) {
  const [generated,setGenerated]=useState(false);
  const [mode,setMode]=useState('single');
  const resetMode=(next: string)=>{setMode(next);setGenerated(false);};
  return <div className="view"><PageHeader eyebrow={`${hall.name} · ${session.date} ${session.time}`} title="QR 생성" description="현재 회차의 개별·단체·전체 좌석 티켓을 생성합니다." />
    <div className="qr-mode-tabs">{[['single','개별 생성'],['group','단체 생성'],['all','전체 좌석 생성']].map(([id,label])=><button className={mode===id?'active':''} key={id} onClick={()=>resetMode(id)}>{label}</button>)}</div>
    {mode==='all'?<section className="split-layout"><article className="content-card form-card"><div className="section-title"><div><h2>현재 회차 전체 좌석</h2><p>행사에서 사용하는 좌석별 티켓을 한 번에 만듭니다.</p></div><span className="step-badge">{hall.capacity}</span></div><div className="bulk-summary"><div><span>홀</span><strong>{hall.name}</strong></div><div><span>행사</span><strong>{session.event} {session.round}</strong></div><div><span>생성 대상</span><strong>{hall.capacity}석</strong></div><div><span>파일 형식</span><strong>완성 티켓 PNG · ZIP</strong></div></div><label className="check-row"><input type="checkbox" defaultChecked/> 현재 회차에서 사용하는 전체 좌석</label><label className="check-row"><input type="checkbox" defaultChecked/> 층별 폴더로 분류</label><button className="primary-button" onClick={()=>setGenerated(true)}>전체 좌석 QR 생성 및 ZIP 준비</button></article><article className="content-card bulk-preview"><span className="ticket-label">다운로드 미리보기</span><div className="zip-file"><strong>[{hall.name}][{session.date.replaceAll('. ','-').replace('.','')}_{session.time.replace(':','')}][{session.event}]</strong><span>전체티켓.zip</span></div><div className="file-tree"><strong>{hall.name}/</strong><span>1층/[{hall.name}][1층-A-01].png</span>{hall.id==='haeun'&&<span>2층/[{hall.name}][2층-A-04].png</span>}<span>… 좌석별 PNG 총 {hall.capacity}개</span></div>{generated&&<div className="notice notice--success">미리보기용 생성 준비가 완료되었습니다.</div>}<button className="secondary-button" disabled={!generated}>ZIP 다운로드</button></article></section>:<section className="split-layout"><article className="content-card form-card"><div className="section-title"><div><h2>{mode==='group'?'단체 QR 정보':'개별 QR 정보'}</h2><p>현재 선택된 홀과 회차가 자동 적용됩니다.</p></div></div>{mode==='group'&&<FormField label="배부 대상" defaultValue="행복지역아동센터"/>}<FormField label="좌석" defaultValue={mode==='group'?'1층 C-12, C-13':'1층 C-12'}/><FormField label="회차" defaultValue={`${session.date} ${session.time}`}/><button className="primary-button" onClick={()=>setGenerated(true)}>좌석별 QR 생성하기</button></article><article className="content-card ticket-preview"><span className="ticket-label">{hall.name} 모바일 입장권</span>{generated?<><GeneratedQr value={`${session.id}-${mode}-C12`}/><h2>{mode==='group'?'행복지역아동센터':session.event}</h2><strong>{mode==='group'?'1층 C-12 · C-13':'1층 C-12'}</strong><p>입구에서 QR을 보여주세요.</p><button className="secondary-button">이미지 저장</button></>:<div className="empty-state"><strong>QR 미리보기</strong><p>좌석 정보를 확인한 뒤 생성 버튼을 눌러주세요.</p></div>}</article></section>}
  </div>;
}

function ReassignView({ hall }: { hall: Hall }) {
  const [choice,setChoice]=useState('R-21');
  const seats=hall.id==='haeun'?[['R-21','배부 없음'],['P-03','배부 없음'],['2F-F-27','회수 가능']]:[['R-21','배부 없음'],['P-03','배부 없음'],['F-27','회수 가능']];
  return <div className="view"><PageHeader eyebrow={`${hall.name} 관리자 권한`} title="현장 재배정" description="현재 행사 회차의 미입장 또는 회수 가능한 좌석을 배정합니다." /><section className="content-card"><div className="section-title"><div><h2>사용 가능한 좌석</h2><p>기존 배부 기록은 삭제하지 않고 이력에 보존됩니다.</p></div><div className="filter-chips"><button className="active">1층</button><button>미입장</button><button>회수 가능</button></div></div><div className="reassign-list">{seats.map(([id,state])=><button className={choice===id?'active':''} key={id} onClick={()=>setChoice(id)}><i/><strong>{id}</strong><span>{state}</span></button>)}</div><div className="reassign-footer"><FormField label="대기자 이름 또는 메모" placeholder="선택 입력"/><button className="primary-button">{choice} 현장 배정</button></div></section></div>;
}

function HistoryView({ hall, session }: { hall: Hall; session: Session }) {
  const recent=recentForHall(hall);
  const history: Array<readonly [string, string, string, string, string]> = [
    ...recent.map(([time, user, target, action]) => [time, user, target, action, "완료"] as const),
    [session.time, "관리자", "1층 R-21", "현장 재배정", "완료"],
  ];
  return <div className="view"><PageHeader eyebrow={`${hall.name} 감사 로그`} title="처리 이력" description="현재 행사 회차의 입장·배분·취소·재배정 기록입니다." /><section className="content-card"><div className="section-title"><div><h2>회차 처리 내역</h2><p>{session.date} {session.time} · {session.event}</p></div><div className="filter-chips"><button className="active">전체</button><button>입장</button><button>배분</button><button>취소</button></div></div><div className="history-table"><div className="history-head"><span>시간</span><span>담당자</span><span>대상</span><span>처리</span><span>상태</span></div>{history.map((item,index)=><div key={`${item[0]}-${index}`}><span>{item[0]}</span><strong>{item[1]}</strong><span>{item[2]}</span><span>{item[3]}</span><em>{item[4]}</em></div>)}</div></section></div>;
}

function EventManagementView({ hall, onChangeContext }: { hall: Hall; onChangeContext: () => void }) {
  const { sessions: allSessions } = useCatalog();
  const sessions=allSessions.filter(item=>item.hallId===hall.id);
  return <div className="view"><PageHeader eyebrow={`${hall.name} 관리자 기능`} title="행사 관리" description="행사와 날짜·시간별 운영 회차를 등록하고 관리합니다."/><section className="content-card"><div className="section-title"><div><h2>{hall.name} 등록 행사</h2><p>같은 홀의 시간이 겹치는 회차는 등록할 수 없습니다.</p></div><button className="primary-button">새 행사 등록</button></div><div className="management-list">{sessions.map(session=><article key={session.id}><div className="management-date"><strong>{session.shortDate}</strong><span>{session.time}~{session.endTime}</span></div><div><span className={`session-status session-status--${session.statusTone}`}>{session.status}</span><h3>{session.event}</h3><p>{session.round} · 배부 {session.distributed}석 · 입장 {session.entered}석</p></div><button className="secondary-button" onClick={onChangeContext}>운영 화면으로</button></article>)}</div></section></div>;
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
};

function SeatMapView({ floor,setFloor,query,setQuery,selected,setSelected,confirmed,setConfirmed,hall }: SeatMapViewProps) {
  if(hall.id!=='haeun')return <div className="view"><PageHeader eyebrow={`${hall.name} · 1층`} title="좌석 현황" description="좌석 배치도 등록 전 레이아웃입니다."/><section className="content-card pending-seat-plan"><strong>{hall.name} 좌석 도면 준비 중</strong><p>실제 좌석 배치도를 받으면 복도·결번·좌석번호를 동일한 방식으로 반영합니다.</p><div><span>예상 규모</span><strong>{hall.capacity}석</strong></div></section></div>;
  const rows=floor==='1층'?ROWS_1F:ROWS_2F;
  const numberedSeatCount=rows.reduce((total,row)=>total+row.blocks.reduce((sum,range)=>sum+(range?range[1]-range[0]+1:0),0),0);
  const seatCount=floor==='1층'?506:numberedSeatCount;
  const queryId=query.trim().toUpperCase().replace(/\s+/g,'').replace(/^([A-T])-?(\d{1,2})$/,(_match: string,row: string,number: string)=>`${row}-${String(Number(number)).padStart(2,'0')}`);
  const selectFloor=(label: Floor)=>{setFloor(label);setQuery('');setConfirmed(false);setSelected(label==='1층'?{id:'C-12',row:'C',number:12,status:'distributed'}:{id:'C-18',row:'C',number:18,status:'distributed'});};
  const handleSearch=(event: FormEvent<HTMLFormElement>)=>{event.preventDefault();rows.forEach((config,rowIndex)=>config.blocks.forEach((range)=>{if(!range)return;const [start,end]=range;for(let number=start;number<=end;number+=1){const id=`${config.row}-${String(number).padStart(2,'0')}`;if(id===queryId){setSelected({id,row:config.row,number,status:seatStatus(rowIndex,number)});setConfirmed(false);}}}));};
  return <div className="view view--seats"><PageHeader eyebrow="실시간 좌석 운영" title={`${floor} 좌석 현황`} />
    <section className="toolbar" aria-label="좌석 도구"><div className="floor-tabs">{(['1층','2층'] as Floor[]).map(label=><button key={label} className={floor===label?'active':''} onClick={()=>selectFloor(label)}>{label}</button>)}</div><form className="search" onSubmit={handleSearch}><label htmlFor="seat-search">좌석 검색</label><input id="seat-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="예: C-12"/><button>찾기</button></form><div className="legend">{STATUS.map(status=><span key={status}><i className={`dot dot--${status}`}/>{STATUS_LABEL[status]}</span>)}</div></section>
    <section className={`map-panel map-panel--${floor==='1층'?'one':'two'}`}>{floor==='1층'?<FirstFloorSvg selectedId={selected?.id} queryId={queryId} onSelect={seat=>{setSelected(seat);setConfirmed(false)}}/>:<SecondFloorSvg selectedId={selected?.id} queryId={queryId} onSelect={seat=>{setSelected(seat);setConfirmed(false)}}/>}</section>
    <footer className="selection-bar"><div className="seat-total"><strong>{seatCount}</strong><span>도면 표기 {floor} 좌석</span></div><div className="selection-copy"><span>선택 좌석</span><strong>{selected?.id??'좌석을 선택하세요'}</strong>{selected&&<em className={`state state--${confirmed?'entered':selected.status}`}>{confirmed?'입장 완료':STATUS_LABEL[selected.status]}</em>}</div><button className="confirm" disabled={!selected} onClick={()=>setConfirmed(true)}>{confirmed?'입장 완료':'입장 확인'}</button></footer>
  </div>;
}

function SeatManagerAppInner() {
  const [hall,setHall]=useState<Hall | null>(null);
  const [session,setSession]=useState<Session | null>(null);
  const [changeOpen,setChangeOpen]=useState(false);
  const [active,setActive]=useState<MenuId>('dashboard');
  const [floor, setFloor] = useState<Floor>("1층");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Seat | null>({ id: "C-12", row: "C", number: 12, status: "distributed" });
  const [confirmed, setConfirmed] = useState(false);
  const resetTransient=()=>{setFloor('1층');setQuery('');setSelected({id:'C-12',row:'C',number:12,status:'distributed'});setConfirmed(false);};
  const openHall=(nextHall: Hall)=>{setHall(nextHall);setSession(null);};
  const openSession=(nextSession: Session)=>{setSession(nextSession);setActive('dashboard');resetTransient();};
  const changeContext=(nextHall: Hall,nextSession: Session)=>{setHall(nextHall);setSession(nextSession);setActive('dashboard');setChangeOpen(false);resetTransient();};
  const goHome=()=>{setHall(null);setSession(null);setChangeOpen(false);};
  if(!hall)return <HallSelectView onSelect={openHall}/>;
  if(!session)return <EventSelectView hall={hall} onBack={goHome} onSelect={openSession}/>;
  const render=()=>{if(active==='dashboard')return <DashboardView onNavigate={setActive} hall={hall} session={session}/>;if(active==='allocation')return <AllocationView/>;if(active==='entry')return <EntryView/>;if(active==='scan')return <ScanView/>;if(active==='generate')return <GenerateView hall={hall} session={session}/>;if(active==='reassign')return <ReassignView hall={hall}/>;if(active==='history')return <HistoryView hall={hall} session={session}/>;if(active==='events')return <EventManagementView hall={hall} onChangeContext={()=>setChangeOpen(true)}/>;return <SeatMapView {...{floor,setFloor,query,setQuery,selected,setSelected,confirmed,setConfirmed,hall}}/>;};
  return <main className="tablet-shell"><aside className="sidebar"><button className="brand-button" onClick={goHome} aria-label="전체 홀 선택으로"><BrandLockup/></button><div className="sidebar-context"><span>현재 운영</span><strong>{hall.name}</strong><small>{session.time} · {session.round}</small></div><nav aria-label="주요 메뉴">{MENU.map(([id,label])=><button key={id} className={active===id?'active':''} onClick={()=>setActive(id)}><span>{String(MENU.findIndex(item=>item[0]===id)+1).padStart(2,'0')}</span>{label}</button>)}</nav><div className="sidebar-bottom"><div><span className="user-avatar">김</span><p><strong>김하은</strong><small>중앙입구 담당자</small></p></div><button>시스템 설정</button></div></aside><section className="workspace workspace--context"><OperationContextBar hall={hall} session={session} onHome={goHome} onHall={()=>setSession(null)} onChange={()=>setChangeOpen(true)}/><div className="workspace-content">{render()}</div></section>{changeOpen&&<ChangeContextModal currentHall={hall} currentSession={session} onClose={()=>setChangeOpen(false)} onApply={changeContext}/>}</main>;
}

export function SeatManagerApp({ initialHalls = FALLBACK_HALLS, initialSessions = FALLBACK_SESSIONS, dataSource = "fallback" }: { initialHalls?: Hall[]; initialSessions?: Session[]; dataSource?: "supabase" | "fallback" }) {
  return <CatalogContext.Provider value={{ halls: initialHalls, sessions: initialSessions, dataSource }}><SeatManagerAppInner /></CatalogContext.Provider>;
}
