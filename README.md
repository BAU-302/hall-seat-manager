# 홀 좌석 현장 운영 시스템

하은홀·아트홀·예랑홀의 행사별 좌석 배분, 입장, QR 발급 및 처리 이력을 관리하는 모바일·태블릿 현장 운영 앱입니다.

## 기술 구성

- Next.js App Router
- TypeScript
- Supabase PostgreSQL, Auth, Realtime
- 반응형 SVG 좌석 배치도

## 로컬 실행

1. `.env.example`을 참고해 `.env.local`에 Supabase 공개 환경 변수를 입력합니다.
2. `pnpm install`
3. `pnpm dev`

DB 비밀번호, Secret key, Service Role key는 로컬 환경 파일이나 저장소에 넣지 않습니다.

상세 구조는 [docs/architecture.md](docs/architecture.md)를 참고하세요.
