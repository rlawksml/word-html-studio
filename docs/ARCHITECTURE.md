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

`hooks/use-workspace-persistence.ts`는 책방과 월별 소식의 변경을 감지해 1.2초 후 레코드 단위로 저장합니다. 요청을 한 줄로 직렬화하고 서버의 `updated_at`과 브라우저가 마지막으로 읽은 값을 비교합니다. 값이 달라진 요청은 `409 Conflict`로 멈추며 사용자가 최신 Workspace를 다시 불러오기 전에는 자동 저장을 반복하지 않습니다.

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
    → lib/html-generators        # 개별·통합 inline CSS HTML
    → lib/workspace-formatters   # 팩토리·날짜·안전한 URL·상태 표시
    → lib/workspace-types        # 공용 데이터 타입

improvements page
  → lib/improvements-client      # 공개 접수·목록과 작업자 상태 변경 요청
  → lib/improvement-export      # Markdown·JSON 통합본 생성

Next.js API
  → app/api/session/route        # 역할별 암호와 세션 발급
  → app/api/workspace/route      # Database 전체 읽기 전용
  → app/api/bookstores/route     # 책방 하나 저장 + 낙관적 충돌 검사
  → app/api/submissions/route    # 월별 소식 하나 저장 + 역할별 필드 제한
  → app/api/images/route         # Storage 업로드·삭제·다운로드 경계
  → app/api/presence/route       # 책방·월·통합본 편집 임대 갱신과 해제
  → app/api/improvements/route   # 공개 개선사항 접수·목록, 작업자 상태 변경
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
- 개선사항 제목·내용은 공개 접수를 허용하지만 상태·예정일 변경은 기존 작업자 세션을 요구하며, Supabase 테이블에는 RLS를 적용합니다.

## 이후 확장

기존 `.docx` 가져오기가 필요해지면 UI 계층에 직접 파서를 넣지 않고 별도 `converter` 모듈을 추가합니다. 파서는 Word 내용을 현재 `Workspace` 구조로 변환하고, 기존 입력 화면에서 사용자가 결과를 확인·수정하도록 연결합니다.
