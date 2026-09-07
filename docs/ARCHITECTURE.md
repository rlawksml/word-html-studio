# 애플리케이션 아키텍처

현재 제품은 Word 변환 파이프라인이 아니라, 책방 소식을 구조화해 입력하고 공개하며 HTML로 발행하는 Next.js 웹 서비스입니다.

## 화면 계층: Atomic Design

```text
app/page.tsx
  → components/templates/StudioPage
    → components/organisms/{Visitor,Input,Html}Workspace
      → components/molecules/*
        → components/atoms/*
```

- `atoms`: 브랜드 버튼, 작업 상태 배지, 책 모양 로딩 표시처럼 더 작게 나누는 의미가 없는 UI
- `molecules`: 헤더, 달력, 소식 편집 카드, 상세 모달, 초기 저장소 로딩 화면처럼 하나의 목적을 가진 UI 묶음
- `organisms`: 방문자·입력자·HTML 편집자 작업 화면
- `templates`: 역할별 화면과 공통 피드백을 조립하는 페이지 골격
- `app/page.tsx`: Next.js 라우트 진입만 담당하며 업무 로직을 포함하지 않음

`/improvements`와 `/help`는 세 역할의 월간 업무 상태와 독립된 보조 페이지입니다. 각각
`ImprovementsWorkspace`, `HelpWorkspace` organism을 직접 조합하며, 공통 브랜드와 도움
메뉴는 `UtilityPageHeader` molecule을 사용합니다.

Atomic Design은 파일 수를 늘리는 목표가 아닙니다. 독립적으로 이해·검증·재사용할 수 있는 화면 단위에서만 분리하고, 단 한 곳에서만 쓰이는 작은 마크업은 상위 컴포넌트에 유지합니다.

## 상태와 업무 흐름

`hooks/use-studio-controller.ts`가 다음 애플리케이션 흐름을 조정합니다.

- 작업자 세션 복원과 역할 전환
- 월·책방·소식 선택 상태
- 작성 중 이탈 방지와 사진·완료·발행 명령
- 소식·사진·통합본 순서 변경
- 사진 업로드와 ZIP 생성
- 입력 완료와 게시 완료 상태 변경

최초 세션 확인과 데이터 로드는 `hooks/use-workspace-initialization.ts`로 분리합니다. 이 hook은 한 요청을 12초로 제한하고 2초·4초 간격을 두어 최대 3번 확인하므로 전체 자동 시도는 1분 안에 끝납니다. 8초 이상 지연되면 사용자가 직접 다시 시도할 수 있습니다. 연결은 성공했지만 책방이 0개이면 오류로 막지 않고 입력자가 첫 책방을 등록할 수 있습니다.

`hooks/use-workspace-persistence.ts`는 책방과 월별 소식의 변경을 감지해 1.2초 후 레코드 단위로 저장합니다. 요청을 한 줄로 직렬화하고 서버의 `updated_at`과 브라우저가 마지막으로 읽은 값을 비교합니다. 책방 관리 저장은 이 hook의 명시적 저장 명령을 호출해 서버 응답을 받은 뒤에만 UI에 반영합니다. 뒤로가기는 effect가 ref를 갱신하기를 기다리지 않고 controller가 넘긴 마지막 Submission 스냅샷을 저장합니다. 입력 마무리는 `lib/submission-completion.ts`에서 동기 ref의 최신 스냅샷을 완료본으로 만들고, 한글 IME 조합을 확정한 다음 서버 응답의 본문 fingerprint까지 비교합니다. 제목·상세·선택 입력이 다르면 목록으로 이동하지 않고 작성 중 상태와 탭 복구본을 유지합니다. 값이 실제로 달라진 요청은 해당 레코드만 `409 Conflict`로 멈추고, 다른 레코드의 자동 저장은 계속합니다.

`lib/submission-draft.ts`는 자동 저장 요청이 시작되기 전 새로고침·탭 내 이동에 대비한 보조 복구 계층입니다. Supabase가 원본 데이터이고 `sessionStorage`는 같은 탭의 최신 입력만 잠시 보관합니다. 서버의 `updated_at`이 복구본과 달라지면 다른 작업자의 최신 내용을 우선하고 오래된 복구본을 폐기합니다. 브라우저 저장 한도나 사생활 보호 설정으로 복구본을 쓰지 못해도 Supabase 저장 흐름은 중단하지 않습니다.

`lib/workspace-client.ts`는 순간적인 5xx·429와 네트워크 단절을 최대 3회 짧게 재시도합니다. 첫 저장의 응답만 유실되어 재시도가 `409`가 된 경우 서버의 최신 내용이 요청 내용과 같은지 비교해 최신 버전을 이어받습니다. 사진 PUT은 45초 전송 제한 안에서 기존 서명으로 먼저 재시도하고, 연결이 끊기거나 서명이 무효하면 controller가 새 경로와 서명을 발급받아 다시 전송합니다. 업로드 중에는 다른 저장·이동을 막아 Storage 파일과 DB의 사진 메타데이터가 분리되지 않게 합니다. HEIC/HEIF 변환기는 일반 방문자 번들에 넣지 않고 해당 사진을 선택했을 때만 불러옵니다.

`lib/supabase-server.ts`는 Cloudflare Worker와 Supabase의 순간적인 시계 오차에서만 발생하는 `PGRST303 / JWT issued at future`를 구분합니다. 이 오류는 Database·Storage 인증 전에 요청이 거부된 경우이므로 서버에서 최대 3회 재시도합니다. 일반 5xx나 쓰기 타임아웃은 중복 실행 여부가 불명확하므로 서버 재시도 대상에 넣지 않습니다.

`hooks/use-editing-presence.ts`는 입력자가 같은 책방·월을 열거나 HTML 편집자가 같은 개별 소식·통합본을 열었을 때 1분마다 짧은 편집 임대를 갱신합니다. 입력자는 편집 화면 진입 전에 임대를 확보하며, 다른 사용자가 보유 중이면 목록에 머뭅니다. 임대는 3분 뒤 자동 만료되고 DB에는 원본 세션 ID가 아닌 해시만 저장됩니다. 실제 저장에도 기존 `updated_at` 충돌 검사를 함께 적용합니다.

화면 컴포넌트는 controller가 제공하는 값과 명령만 사용합니다. Supabase나 서버 세션의 구현 세부사항을 UI에 직접 넣지 않습니다.

## 도메인과 인프라 경계

```text
components
  → hooks/use-studio-controller
    → hooks/use-workspace-initialization # 최초 세션·데이터 확인과 재시도
    → hooks/use-workspace-persistence    # 레코드 변경 감지·직렬 저장·충돌 처리
    → hooks/use-editing-presence         # 실제 편집 대상의 짧은 임대·동시 작업 안내
    → lib/workspace-client       # 브라우저 ↔ Next.js API
    → lib/submission-draft       # 같은 탭의 저장 전 입력 복구
    → lib/html-generators        # 개별·통합 inline CSS HTML
    → lib/workspace-formatters   # 팩토리·날짜·안전한 URL·상태 표시
    → lib/workspace-types        # 공용 데이터 타입

improvements page
  → lib/improvements-client      # 공개 버그·개선 접수·목록과 HTML 편집자 상태 변경 요청
  → lib/improvement-export      # Markdown·JSON 통합본 생성

Next.js API
  → app/api/session/route        # 역할별 암호와 세션 발급
  → app/api/workspace/route      # Database 전체 읽기 전용
  → app/api/bookstores/route     # 책방 하나 저장 + 낙관적 충돌 검사
  → app/api/submissions/route    # 월별 소식 하나 저장 + 역할별 필드 제한
  → app/api/images/route         # Storage 업로드·삭제·다운로드 경계
  → app/api/presence/route       # 책방·월·통합본 편집 임대 갱신과 해제
  → app/api/improvements/route   # 공개 버그·개선 접수·목록, HTML 편집자 상태 변경
    → lib/workspace-validation   # 요청 크기·필드·URL·Storage 경로 검증
    → lib/workspace-records      # Supabase 행 ↔ Workspace 변환
    → lib/workspace-session      # HttpOnly 쿠키 + 탭 sessionId 검증
    → lib/supabase-server        # 서버 전용 admin client
      → Supabase Database / Storage
```

이 경계 덕분에 향후 Supabase Database/Storage를 Cloudflare D1/R2로 옮겨도 화면 컴포넌트를 다시 작성하지 않아도 됩니다.

## 스타일 구조

`app/globals.css`는 로딩 순서를 선언하는 진입 파일입니다.

1. `styles/foundations.css`: 토큰, reset, 공통 버튼·입력·상단 바
2. `styles/startup-loading.css`: 최초 저장소 연결·지연·오류 전체 화면
3. `styles/visitor.css`: 방문자 달력·카드·상세 화면
4. `styles/input.css`: 입력 대시보드·소식 편집·책방 관리
5. `styles/html-editor.css`: 개별/통합 HTML 작업 화면
6. `styles/feedback.css`: 접속·이탈 모달과 toast
7. `styles/utility-pages.css`: 개선사항·도움말 페이지와 공통 도움 메뉴
8. `styles/responsive.css`: 마지막에 적용되는 모바일/태블릿 재정의

역할별 스타일은 다른 역할의 선택자를 추가하지 않습니다. 두 화면 이상이 공유하는 규칙은 `foundations.css`로 승격합니다.

## 보안과 데이터 원칙

- `SUPABASE_SECRET_KEY`와 작업 암호는 서버 환경변수에만 둡니다.
- UI는 `/api/workspace`, `/api/bookstores`, `/api/submissions`, `/api/images`, `/api/session`, `/api/improvements`만 호출합니다.
- 입력자와 HTML 편집자의 저장 권한을 필드 수준으로 나누고 `updated_at`이 일치할 때만 수정합니다.
- 작업 암호의 반복 실패를 짧은 시간 동안 제한합니다.
- 편집 임대는 세션 해시만 저장하고 3분 뒤 자동 만료되므로 별도 세션 청소 작업이 필요하지 않습니다.
- 원본 사진은 비공개, 모바일 미리보기는 공개 버킷으로 분리합니다.
- 사용자 입력 링크와 생성 HTML은 허용된 URL scheme만 사용합니다.
- 공개 방문자는 데이터를 읽을 수 있지만 수정 API는 작업자 세션을 요구합니다.
- 버그는 제목·발생 위치·내용, 개선은 제목·내용·이유를 공개 접수합니다. 상태·예정일 변경과 내보내기는 HTML 편집자 세션만 허용하며, Supabase 테이블에는 RLS를 적용합니다.

## 이후 확장

기존 `.docx` 가져오기가 필요해지면 UI 계층에 직접 파서를 넣지 않고 별도 `converter` 모듈을 추가합니다. 파서는 Word 내용을 현재 `Workspace` 구조로 변환하고, 기존 입력 화면에서 사용자가 결과를 확인·수정하도록 연결합니다.
