-- SQL 생성 테이블에 적용된 프로젝트 기본 권한을 최소 권한으로 축소한다.
revoke all on public.session_group_colors from anon, authenticated;
revoke all on sequence public.session_group_colors_id_seq from anon, authenticated;
grant select on public.session_group_colors to authenticated;
