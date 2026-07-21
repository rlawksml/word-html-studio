# Supabase 연결 가이드

이 프로젝트는 Supabase Auth를 사용하지 않습니다. 방문자는 서버 API를 통해 소식을 읽고, 입력자와 HTML 편집자는 기존 작업 암호를 입력한 세션에서만 서버 API에 저장을 요청합니다. Supabase의 `service_role` 키는 서버에서만 사용합니다.

## 1. Supabase 프로젝트 만들기

1. Supabase Dashboard에서 새 프로젝트를 만듭니다.
2. 프로젝트 지역은 실제 사용자가 주로 접속하는 곳과 가까운 지역을 선택합니다.
3. 프로젝트가 준비되면 SQL Editor를 엽니다.

## 2. Database와 Storage 준비

SQL Editor에서 아래 파일의 전체 내용을 한 번 실행합니다.

```text
apps/web/supabase/migrations/202607210001_initial_workspace.sql
```

이 SQL은 다음 항목을 만듭니다.

- `bookstores`: 변경이 적은 책방 기본정보
- `submissions`: 월별 소식, 일정, 입력·게시 상태
- `replace_bookstore_news_workspace`: 자동 저장용 교체 함수
- `bookstore-news` Storage bucket
- 원본 경로 `originals/발행월/책방/소식/파일`
- 미리보기 경로 `previews/발행월/책방/소식/파일`

Database 테이블은 RLS를 켜고 공개 역할의 직접 접근을 막습니다. Storage bucket은 방문자 미리보기와 HTML 작업자의 원본 다운로드를 위해 읽기만 공개하며 업로드·삭제는 서버의 service role로 처리합니다.

## 3. 로컬 환경변수 연결

`apps/web/.env.example`을 참고해 `apps/web/.env.local`에 다음 값을 입력합니다.

```dotenv
SUPABASE_URL=https://프로젝트-참조.supabase.co
SUPABASE_SERVICE_ROLE_KEY=서버용-service-role-key
```

`SUPABASE_SERVICE_ROLE_KEY`는 GitHub에 올리거나 브라우저에서 사용하는 `NEXT_PUBLIC_` 변수로 만들면 안 됩니다.

## 4. 연결 확인

1. 개발 서버를 다시 시작합니다.
2. 첫 방문자 화면이 오류 없이 빈 달력으로 열리는지 확인합니다.
3. `소식 입력`에서 책방 한 곳을 등록합니다.
4. 다른 브라우저나 시크릿 창에서 같은 책방이 보이는지 확인합니다.
5. 사진을 올린 뒤 방문자 화면은 미리보기, HTML 편집자는 원본 ZIP을 받는지 확인합니다.

## 5. 배포 연결

배포 환경에도 같은 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`를 서버 환경변수로 등록한 뒤 새 버전을 배포합니다. 연결 전에는 현재 운영 주소를 교체하지 않습니다.

## Cloudflare 이전 대비

화면은 Supabase를 직접 호출하지 않고 `/api/workspace`와 `/api/images`만 사용합니다. 향후 Cloudflare로 이전할 때 이 두 서버 모듈을 D1·R2 구현으로 교체하고, Database 레코드와 `originals/`, `previews/` 경로를 그대로 복사합니다.
