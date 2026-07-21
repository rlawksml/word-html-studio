# 동네책방 소식 스튜디오

동네책방의 월간 소식을 폼으로 입력하고, 방문자에게 달력으로 공개하며, 개별·통합 inline CSS HTML을 만드는 웹 서비스입니다.

제품 방향은 **Word 변환기**가 아니라 **소식 입력·공개·HTML 발행 서비스**입니다. Word를 작성할 줄 아는 사람이 HTML/CSS를 몰라도 한 화면에서 한 책방씩 작성할 수 있도록 설계했습니다.

## 현재 구현된 프로토타입

- 방문자: 지관서가 동네책방 페이지 바로가기, 책방·소식 수 요약, 책방별 색상 일정과 툴팁을 갖춘 모바일 달력, 제목 중심 카드, 소식·사진 상세 화면, 디바운스 검색
- 정보 입력자: 항상 보이는 3단계 안내, 월별 진행률, 한 책방씩 작성, 이번 달 운영 안내, 일정 문구·신청 방법·자유 항목·여러 링크, 여러 소식·날짜·사진과 소식·사진 드래그 정렬
- 저장: 1.2초 뒤 자동 임시 저장과 수동 임시 저장, 지난달 내용 복사, 작성 중 이탈 경고와 임시 저장
- 완료: 누락된 필수 항목으로 자동 이동, 책방별 입력 완료, 수정 시 자동으로 작성 중 전환, 책방별 소식 제목이 담긴 월 전체 완료 내용 복사
- HTML 편집자: 입력 완료 자료만 열람, 개별 HTML 복사·미리보기, 사진 ZIP과 HTML+사진 ZIP
- 통합본: 포함 소식 선택, 책방 순서 드래그 변경, 책방·지역·소식 제목 중심 통합 HTML 복사·미리보기
- 게시: 선택적 게시 URL 저장, 게시 완료·재게시 상태 표시

방문자 헤더의 `소식 입력` 또는 `HTML 편집` 버튼을 먼저 선택한 뒤 서버 환경변수에 등록한 역할별 암호를 입력합니다. 실제 작업 암호는 공개 저장소와 브라우저 코드에 포함하지 않습니다. 방문자는 암호 없이 바로 이용합니다.

한글·영문 자판 중 어느 상태로 입력해도 같은 역할로 접속됩니다. 암호는 서버에서만 확인합니다. 작업 상태는 HttpOnly 서명 쿠키와 현재 탭의 임의 세션 ID를 함께 사용하므로 새로고침에는 유지되고, 탭을 닫거나 로그아웃하면 작업 API 접근이 끝납니다.

## 데이터에 관한 중요 안내

공용 저장소는 **Supabase**를 사용하며 기존 브라우저 `localStorage`의 샘플·임시 데이터는 가져오지 않습니다. Supabase가 연결되면 빈 운영 데이터에서 책방을 새로 등록해 시작합니다.

- Supabase Database: 책방 기본정보, 월별 소식, 일정과 작업 상태
- Supabase Storage: 비공개 원본 사진 버킷과 공개 모바일 미리보기 버킷
- 로그인: Supabase Auth는 도입하지 않고 현재의 입력자·HTML 편집자 작업 암호와 세션 방식을 유지

원본 사진은 HTML 편집자의 세션 검증 다운로드용으로 비공개 보관하고 방문자 화면에는 작은 미리보기만 사용합니다. 입력 내용은 공개 소식이므로 별도의 사용자 계정 체계는 만들지 않습니다. 공개 방문자는 원본 경로를 받거나 데이터를 변경할 수 없습니다.

Database와 Storage 요청은 서버 API를 통해 처리합니다. `SUPABASE_SECRET_KEY`는 브라우저나 GitHub에 노출하지 않고 로컬·배포 환경변수에만 저장합니다. 초기 연결 방법은 [Supabase 연결 가이드](docs/SUPABASE_SETUP.md)를 따릅니다.

향후 Cloudflare 중심 구조가 더 적합해지면 Database를 D1으로, Storage를 R2로 이전할 수 있습니다. 이를 위해 화면에서 Supabase를 직접 호출하는 코드를 분산시키지 않고 데이터·사진 저장 모듈을 분리하며, DB에는 영구 공개 URL 대신 이식 가능한 사진 경로를 저장합니다. 월별 데이터와 사진 백업도 유지해 특정 서비스에 종속되지 않도록 설계합니다.

## 처음 코드를 읽는 순서

Next.js나 이 프로젝트가 익숙하지 않다면 다음 순서로 읽는 것이 가장 빠릅니다.

1. [app/layout.tsx](apps/web/app/layout.tsx): 모든 페이지가 공유하는 HTML 골격과 메타데이터
2. [app/page.tsx](apps/web/app/page.tsx): `/` 주소의 진입점
3. [StudioPage.tsx](apps/web/components/templates/StudioPage.tsx): 현재 역할에 맞는 화면을 선택하는 template
4. `components/organisms`: 방문자·입력자·HTML 편집자의 실제 작업 화면
5. [use-studio-controller.ts](apps/web/hooks/use-studio-controller.ts): 세 역할이 공유하는 상태와 사용자 명령
6. [workspace-types.ts](apps/web/lib/workspace-types.ts): 책방·월별 소식·사진의 표준 데이터 구조
7. [workspace-client.ts](apps/web/lib/workspace-client.ts): 브라우저에서 Next.js API를 호출하는 함수
8. `app/api`: 서버에서 세션을 검증하고 Supabase Database·Storage를 호출하는 Route Handler

전체 데이터 흐름은 다음과 같습니다.

```text
page.tsx
  → StudioPage
    → 역할별 Workspace 컴포넌트
      → useStudioController
        → workspace-client
          → /api/session, /api/workspace, /api/images
            → workspace-session, supabase-server
              → Supabase Database / Storage
```

### 기능별 수정 위치

| 바꾸려는 기능 | 먼저 볼 파일 |
|---|---|
| 방문자 달력·검색·소식 카드 | `components/organisms/VisitorWorkspace.tsx`, `components/molecules/NewsCalendar.tsx` |
| 책방 목록과 월별 진행률 | `components/organisms/InputWorkspace.tsx` |
| 소식 입력 폼과 사진 순서 | `components/molecules/NewsEditorCard.tsx` |
| 개별·통합 HTML 화면 | `components/organisms/HtmlWorkspace.tsx` |
| inline CSS HTML 결과 | `lib/html-generators.ts` |
| 자동 저장·완료·ZIP | `hooks/use-studio-controller.ts` |
| 공용 데이터 읽기·저장 | `app/api/workspace/route.ts` |
| 사진 업로드·삭제·원본 다운로드 | `app/api/images/route.ts` |
| 작업 암호와 탭 세션 | `app/api/session/route.ts`, `lib/workspace-session.ts` |
| 화면 스타일 | `styles/foundations.css`와 역할별 CSS 파일 |

코드 주석은 문법이나 JSX 내용을 그대로 번역하지 않고, 파일의 책임과 보안·저장·상태 전환의 이유를 설명합니다. 기능을 옮기거나 경계를 변경할 때 관련 주석과 위 표도 함께 수정합니다.

## 실행과 검증

Node.js 22.13 이상이 필요합니다.

```bash
cd apps/web
npm install
npm run dev
```

```bash
npm run lint
npm test
npm run build
```

로컬 주소는 `http://localhost:3000`입니다.

## 문서

- [사용자 흐름](docs/USER_FLOW.md)
- [현재 애플리케이션 아키텍처](docs/ARCHITECTURE.md)
- [Supabase 연결 가이드](docs/SUPABASE_SETUP.md)
- [제품 요구사항](docs/PRODUCT.md)
- [입력 항목 분류](docs/FIELD_REQUIREMENTS.md)
- [실제 Word 4개 비교 분석](docs/MULTI_DOC_ANALYSIS.md)
- [Word 작성 가이드](docs/WORD_AUTHORING_GUIDE.md)
- [구현 일정](TODO.md)

## 저장소 구조

```text
apps/web/app/          # Next.js 라우트와 서버 API
apps/web/components/   # Atomic Design UI (atoms → molecules → organisms → templates)
apps/web/hooks/        # 화면 상태와 사용자 작업 흐름
apps/web/lib/          # HTML 생성, 저장소 통신, 도메인 타입·포맷
apps/web/styles/       # 공통·역할별·반응형 CSS 모듈
apps/web/tests/        # 렌더링·보안·구조 회귀 테스트
docs/                  # 제품·분석·사용자 흐름 문서
examples/templates/    # 기존 inline CSS HTML 예시
TODO.md                # 구현 단계와 완료 조건
```

기존 Word 파일 가져오기는 운영 MVP 이후의 호환 기능으로 남겨 둡니다. 구조화 폼만으로 처리하기 어려운 기존 자료가 충분히 쌓였을 때 규칙 기반 파서를 먼저 검토합니다.
