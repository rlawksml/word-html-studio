# Supabase 연결 가이드

이 프로젝트는 Supabase Auth를 사용하지 않습니다. 작업 암호는 서버 API가 확인하고, 성공하면 HttpOnly 서명 쿠키와 현재 탭의 임의 세션 ID를 함께 사용하는 작업 세션을 발급합니다. `SUPABASE_SECRET_KEY`와 작업 암호는 서버 환경변수에만 둡니다.

## 1. Database와 Storage 준비

새 프로젝트는 SQL Editor에서 아래 파일을 순서대로 한 번씩 실행합니다.

```text
apps/web/supabase/migrations/202607210001_initial_workspace.sql
apps/web/supabase/migrations/202607220001_secure_media_and_flexible_fields.sql
```

첫 번째 마이그레이션을 이미 적용했다면 두 번째 파일만 추가로 실행합니다. 두 번째 마이그레이션은 다음을 수행합니다.

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
8. Supabase Storage에서 원본 버킷이 `Private`, 미리보기 버킷이 `Public`인지 확인합니다.

공개 미리보기는 모바일 속도를 위해 CDN에 최대 5분 캐시됩니다. 사진을 삭제하면 Storage에서는 즉시 제거되지만 이미 열린 공개 URL은 캐시가 만료될 때까지 잠시 보일 수 있습니다.

## 4. 기존 단일 버킷 자료가 있을 때

현재 운영 데이터가 없는 초기 프로젝트는 새 버킷으로 바로 시작하면 됩니다. 이전 `bookstore-news` 버킷에 파일이 이미 있다면 배포 전 다음을 별도 수행해야 합니다.

1. `originals/` 객체를 `bookstore-news-originals`로 복사
2. `previews/` 객체를 `bookstore-news-previews`로 복사
3. Database의 객체 경로는 그대로 유지
4. 원본·미리보기 다운로드를 확인한 뒤 이전 버킷 정리

## Cloudflare 이전 대비

화면은 Supabase를 직접 호출하지 않고 `/api/workspace`, `/api/images`, `/api/session`만 사용합니다. 향후 Cloudflare로 이전할 때 Database 모듈을 D1으로, 두 Storage 버킷을 R2의 private/public 전달 방식으로 교체하고 객체 경로를 그대로 복사합니다.
