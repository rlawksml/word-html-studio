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

Atomic Design은 파일 수를 늘리는 목표가 아닙니다. 독립적으로 이해·검증·재사용할 수 있는 화면 단위에서만 분리하고, 단 한 곳에서만 쓰이는 작은 마크업은 상위 컴포넌트에 유지합니다.

## 상태와 업무 흐름

`hooks/use-studio-controller.ts`가 다음 애플리케이션 흐름을 한곳에서 조정합니다.

- 작업자 세션 복원과 역할 전환
- 월·책방·소식 선택 상태
- 자동/수동 저장과 작성 중 이탈 방지
- 소식·사진·통합본 순서 변경
- 사진 업로드와 ZIP 생성
- 입력 완료와 게시 완료 상태 변경

최초 세션 확인과 데이터 로드는 `hooks/use-workspace-initialization.ts`로 분리합니다. 이 hook은 한 요청을 12초로 제한하고 2초·4초 간격을 두어 최대 3번 확인하므로 전체 자동 시도는 1분 안에 끝납니다. 8초 이상 지연되면 사용자가 직접 다시 시도할 수 있고, 책방 데이터가 비어 있으면 정상 화면 대신 원인 안내를 표시합니다.

화면 컴포넌트는 controller가 제공하는 값과 명령만 사용합니다. Supabase나 서버 세션의 구현 세부사항을 UI에 직접 넣지 않습니다.

## 도메인과 인프라 경계

```text
components
  → hooks/use-studio-controller
    → hooks/use-workspace-initialization # 최초 세션·데이터 확인과 재시도
    → lib/workspace-client       # 브라우저 ↔ Next.js API
    → lib/html-generators        # 개별·통합 inline CSS HTML
    → lib/workspace-formatters   # 팩토리·날짜·안전한 URL·상태 표시
    → lib/workspace-types        # 공용 데이터 타입

Next.js API
  → app/api/session/route        # 역할별 암호와 세션 발급
  → app/api/workspace/route      # Database 읽기·일괄 저장 경계
  → app/api/images/route         # Storage 업로드·삭제·다운로드 경계
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
7. `styles/responsive.css`: 마지막에 적용되는 모바일/태블릿 재정의

역할별 스타일은 다른 역할의 선택자를 추가하지 않습니다. 두 화면 이상이 공유하는 규칙은 `foundations.css`로 승격합니다.

## 보안과 데이터 원칙

- `SUPABASE_SECRET_KEY`와 작업 암호는 서버 환경변수에만 둡니다.
- UI는 `/api/workspace`, `/api/images`, `/api/session`만 호출합니다.
- 원본 사진은 비공개, 모바일 미리보기는 공개 버킷으로 분리합니다.
- 사용자 입력 링크와 생성 HTML은 허용된 URL scheme만 사용합니다.
- 공개 방문자는 데이터를 읽을 수 있지만 수정 API는 작업자 세션을 요구합니다.

## 이후 확장

기존 `.docx` 가져오기가 필요해지면 UI 계층에 직접 파서를 넣지 않고 별도 `converter` 모듈을 추가합니다. 파서는 Word 내용을 현재 `Workspace` 구조로 변환하고, 기존 입력 화면에서 사용자가 결과를 확인·수정하도록 연결합니다.
