# Supabase 연결 가이드

이 프로젝트는 Supabase Auth를 사용하지 않습니다. 작업 암호는 서버 API가 확인하고, 성공하면 HttpOnly 서명 쿠키와 현재 탭의 임의 세션 ID를 함께 사용하는 작업 세션을 발급합니다. `SUPABASE_SECRET_KEY`와 작업 암호는 서버 환경변수에만 둡니다.

## 1. Database와 Storage 준비

새 프로젝트는 SQL Editor에서 아래 파일을 순서대로 한 번씩 실행합니다.

```text
apps/web/supabase/migrations/202607210001_initial_workspace.sql
apps/web/supabase/migrations/202607220001_secure_media_and_flexible_fields.sql
apps/web/supabase/migrations/202607220002_editing_leases.sql
apps/web/supabase/migrations/202607240001_improvement_requests.sql
apps/web/supabase/migrations/202607240002_improvement_request_types.sql
```

아래 migration 설명은 초기 설치/이전 설계입니다. 현재 운영 프로젝트에 SQL을 실행하라는
지시가 아니며, 실제 대상·백업·호환성 검토와 별도 승인이 필요합니다. 다섯 번째 파일은
이전 네 파일 위에 버그·개선 유형·위치/사용 경로·이유 필드를 추가하는 설계입니다.

네 번째 마이그레이션은 공개 개선사항 접수와 진행 상태·예정일 관리를 위한 테이블을
추가합니다. `anon`, `authenticated`의 직접 접근은 허용하지 않고 서버 API만 사용합니다.

세 번째 마이그레이션은 같은 책방·월 또는 통합본을 열어둔 다른 작업자가 있는지
확인하는 3분 편집 임대를 추가합니다. 원본 세션 ID는 저장하지 않으며, 만료된 행은
다음 작업자가 덮어쓰므로 별도 청소 작업이 필요하지 않습니다.

두 번째 마이그레이션은 다음을 수행합니다.

- 책방의 추가 연락처·여러 링크 필드 추가
- 월별 운영 안내 필드 추가
- 자동 저장 함수 갱신
- 비공개 `bookstore-news-originals` 버킷 생성
- 공개 `bookstore-news-previews` 버킷 생성
- 이전 단일 `bookstore-news` 버킷이 있으면 비공개로 전환

Database 테이블은 RLS를 사용하며 `anon`, `authenticated`의 직접 접근을 허용하지 않습니다. 업로드·삭제와 원본 다운로드는 서버의 Secret Key와 작업 세션을 모두 거칩니다.

## 2. 환경변수

`apps/web/.env.example`을 참고해 로컬의 `apps/web/.env.local`과 배포 환경에 다음 값을 등록합니다.

```dotenv
SUPABASE_URL=https://프로젝트-참조.supabase.co
SUPABASE_SECRET_KEY=서버용-sb_secret-key
WORKSPACE_SESSION_SECRET=충분히-긴-무작위-문자열
INPUT_ACCESS_CODES=입력자-암호,입력자-암호의-다른-자판값
HTML_ACCESS_CODES=편집자-암호,편집자-암호의-다른-자판값
```

`WORKSPACE_SESSION_SECRET`이 없으면 서버는 `SUPABASE_SECRET_KEY`를 서명 키로 대신 사용하지만, 운영 환경에서는 별도 값을 권장합니다. 모든 비밀값은 `NEXT_PUBLIC_` 접두사를 붙이지 않으며 GitHub에 커밋하지 않습니다.

## 3. 연결 확인

1. 개발 서버를 다시 시작합니다.
2. 방문자 화면이 오류 없이 열리는지 확인합니다.
3. 입력자 암호로 접속해 책방·소식·사진을 저장합니다.
4. 새로고침 후 역할과 데이터가 유지되는지 확인합니다.
5. 다른 탭에서는 작업 화면이 자동으로 열리지 않는지 확인합니다.
6. 방문자 상세에는 축소 미리보기만 표시되는지 확인합니다.
7. HTML 편집자만 원본 사진 ZIP을 받을 수 있는지 확인합니다.
8. 다른 브라우저에서 같은 책방·월을 열었을 때 동시 작업 안내가 표시되는지 확인합니다.
9. Supabase Storage에서 원본 버킷이 `Private`, 미리보기 버킷이 `Public`인지 확인합니다.
10. 개선사항 페이지에서 버그와 개선을 각각 접수하고 HTML 편집자 세션에서만 상태와 예정일을 변경합니다.

공개 미리보기는 모바일 속도를 위해 CDN에 최대 5분 캐시됩니다. #88 준비 소스는 소식에서 참조를 제거하더라도 Storage 파일은 물리 삭제하지 않습니다. 저장 응답 유실로 실제 반영 여부가 불명확할 때 성공 파일을 지우지 않기 위한 보수적 정책입니다. 알려진 공개 URL의 접근 철회는 보장하지 않으며, 기간 정리·안전한 GC는 별도 설계·승인 대상입니다.

## 4. 실제 통합 테스트

기존 자동 생성·정리 suite는 안전한 ownership adapter가 없어 **하드 차단**했습니다. 활성 flag나 유효한 프로젝트 설정도 이를 해제하지 못합니다. `test:integration:local`은 환경파일·SDK·Worker·HTTP 전에 고정 오류로 종료합니다. 현재 자동 검증과 별도 승인된 실제 UI 작업을 구분합니다.

```bash
cd apps/web
node --test tests/supabase-cleanup-guard.test.mjs tests/integration-safety-block.test.mjs
```

위 두 파일은 무키 합성 차단·mock-only cleanup 정책 검증입니다. caller의 receipt/부재 확인 모델은 실제 소유권·원자성·TOCTOU 검증이 아니며 실제 DB 삭제 권한을 만들지 않습니다. 위 명령 역시 OS 격리 조건을 충족한 환경에서만 실행하고, 현재 준비 브랜치에서는 수동 source-policy CI를 사용합니다.

CI의 legacy 실연결 job도 고정 비활성화했습니다. Secret 추가나 workflow 입력으로 실제 통합 suite를 실행할 수 있다고 안내하지 않습니다. Stage2 ledger6·SDK adapter12는 가짜 키와 mock fetch만 사용하며 `cleanup()`·Storage를 지원하지 않습니다. ledger와 observer의 순수17TC는 재검증했지만 SDK12·브라우저5·실DB 전체 검증은 별도입니다.

2026-11-04의 실제 신규 QA 보관형 검증과 외부 편집기 사용자 확인은 [과거 증거 색인](test-reports/2026-11-05-historical-evidence-index.md)으로 추적합니다. 당시 보관 자료를 이번 테스트의 생성/정리 대상으로 재사용하지 않습니다. 새 QA·실제 SQL·DB/Storage 작업은 별도 승인이 필요합니다.

운영 데이터로 통합 테스트를 실행하지 않습니다. 개발·복구 훈련용 프로젝트는 운영과 분리하고, 백업·복원 절차와 Staging 대상 보호장치는 [Supabase 무손실 백업·복구 Runbook](BACKUP_RESTORE.md)을 따릅니다.

## 5. 기존 단일 버킷 자료가 있을 때

아래는 초기 이전 설계이며 현재 서비스에 그대로 실행할 작업 목록이 아닙니다. 기존 버킷·사진이 있으면 독립 백업·참조 검증과 별도 승인부터 확인합니다. 이번 준비 작업에서는 복사·정리하지 않습니다.

1. `originals/` 객체를 `bookstore-news-originals`로 복사
2. `previews/` 객체를 `bookstore-news-previews`로 복사
3. Database의 객체 경로는 그대로 유지
4. 원본·미리보기 다운로드를 확인한 뒤 이전 버킷 정리

## Cloudflare 이전 대비

화면은 Supabase를 직접 호출하지 않고 `/api/workspace`, `/api/images`, `/api/session`, `/api/presence`만 사용합니다. 향후 Cloudflare로 이전할 때 Database 모듈을 D1으로, 두 Storage 버킷을 R2의 private/public 전달 방식으로 교체하고 객체 경로를 그대로 복사합니다.
