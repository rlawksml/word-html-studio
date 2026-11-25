# 프로젝트 현황

마지막 갱신: 2026-11-25

## 현재 버전

| 환경 | 버전 | commit | Worker |
|---|---|---|---|
| 운영 (main) | `1.1.0-rc.1` | `2bf2166` | `bookstore-news-studio-v11` |
| 스테이징 (develop) | v1.2 준비 | `0340775` | `bookstore-news-studio-staging` (ver `5e2753e5`) |

## v1.2 이슈 상태

| 이슈 | 제목 | 상태 |
|---|---|---|
| #97 | 생성 HTML·ZIP의 escape 누락과 사진 파일명 규칙 통일 | ✅ develop 병합·스테이징 배포 |
| #98 | 해를 넘기는 날짜와 잘못된 월의 표시 보완 | ✅ develop 병합·스테이징 배포 |
| #99 | 소식 표시 라벨의 상태별 색 구분 | ✅ develop 병합·스테이징 배포 |
| #100 | HTML·사진 ZIP 생성을 controller에서 분리 | ✅ develop 병합·스테이징 배포 |

## 스테이징 검증 결과 (2026-11-25)

- 대상: develop `0340775` → `bookstore-news-studio-staging` ver `5e2753e5`
- 앱 테스트: **284/284 PASS**
- 스테이징 Worker 테스트: **36/36 PASS**
- 브라우저 UI 확인: **BLOCKED** (workers_dev: false, 라우트 없음 — Cloudflare error 1042)
- 상세: [`docs/test-reports/2026-11-25-0340775-v1.2-staging-deploy.md`](docs/test-reports/2026-11-25-0340775-v1.2-staging-deploy.md)

## 다음 행동

1. **[필수] 스테이징 브라우저 확인**: workers_dev 활성화 또는 라우트 설정 승인 후 `/__staging/login` 경유 UI 확인
   - HTML 미리보기 다이얼로그, 복사 버튼, 사진 ZIP 다운로드, 방문자 라벨 육안 확인
2. **[필수] develop → main PR 생성**: 브라우저 확인 완료 후 릴리스 PR 작성 (`release(v1.2.0): ...`)
3. **[필수] 운영 배포 승인**: main 병합 후 `bookstore-news-studio-v11` 배포 (별도 사용자 승인 필요)

## 참고

- 운영 Worker 변경·main 병합·DB 마이그레이션은 각각 별도 명시적 승인이 필요하다.
- 스테이징 Supabase: `kriyjyyudngtibrtkylf` / 운영 차단: `kdigttaghqubfjsmbngl` 설정 유지.
- 릴리스 절차 상세: [`docs/RELEASE_FLOW.md`](docs/RELEASE_FLOW.md)
