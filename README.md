# Word HTML Studio

동네 책방 작성자가 웹 폼으로 소식을 등록하고, 발행 담당자가 검토해 개별 HTML과 월간 통합 HTML을 생성하는 웹 애플리케이션입니다.

> 제품 방향이 Word 변환 도구에서 구조화된 소식 수집·검토·발행 서비스로 변경되었습니다. Word 가져오기는 향후 기존 문서 호환 기능으로 검토합니다.

## 제품 형태 결정

첫 버전은 **웹 서비스 프로토타입**으로 만듭니다.

- 브라우저 UI라서 템플릿 편집, 여러 파일 업로드, 미리보기를 구현하기 쉽습니다.
- 작성자와 발행 담당자가 같은 구조화 데이터를 공유할 수 있습니다.
- Word 해석과 AI 요약 없이도 안정적인 HTML을 생성합니다.
- 현재 프로토타입 데이터는 브라우저에 저장되며, 운영 버전에서는 로그인과 서버 저장소를 추가합니다.

## 핵심 흐름

1. 책방 작성자가 기본 정보와 여러 소식을 웹 폼에 작성합니다.
2. 발행 담당자가 접수함에서 내용을 미리보고 수정 요청 또는 승인합니다.
3. 승인된 책방의 핵심 소식을 선택해 월간 통합본을 구성합니다.
4. 개별 HTML과 통합 HTML을 inline CSS 형태로 다운로드합니다.

일반 사용자는 HTML/CSS를 작성하지 않습니다. 폼에 내용을 채우면 저장된 템플릿으로 자동 렌더링됩니다.

기존 작성자들이 보내는 Word도 그대로 받을 수 있습니다. 프로그램이 공통 필드와 소식 경계를 자동으로 찾고, 애매한 항목만 변환 전에 사용자에게 확인받습니다. 실제 네 문서의 편차 분석은 [다중 Word 비교 분석](docs/MULTI_DOC_ANALYSIS.md)에 정리되어 있습니다.

## 권장 기술 스택

- UI: Next.js + TypeScript + Tailwind CSS
- API/변환 엔진: Python 3.12 + FastAPI
- Word 파싱: `python-docx`, 필요 시 `mammoth`
- HTML 처리: `Jinja2`, `BeautifulSoup4`, `premailer`, `bleach`
- 작업 처리: MVP는 FastAPI background task, 확장 시 Redis + Celery
- 저장: MVP는 SQLite와 로컬 파일 시스템
- 배포: Docker Compose

Python을 변환 엔진으로 선택한 이유는 Word, HTML, 문서 분석 라이브러리 생태계가 성숙했기 때문입니다. 프론트엔드와 변환 로직을 분리해 향후 CLI나 데스크톱 앱에서도 같은 엔진을 재사용합니다.

## 중요한 설계 원칙

- LLM이 HTML 전체를 자유 생성하지 않고, 먼저 Word를 JSON 중간 모델로 정규화합니다.
- 템플릿에는 `{{ document.title }}`, `{{ sections }}`처럼 명시적인 슬롯을 둡니다.
- 동일 입력과 설정으로 재실행 가능한 결과를 목표로 하며 모델명과 프롬프트 버전을 기록합니다.
- API 키와 원본 문서는 Git에 저장하지 않습니다.
- 외부 LLM 전송 여부를 작업마다 표시하고, 필요하면 완전 로컬 모드를 지원합니다.
- 최종 HTML은 스크립트 제거, 태그 검증, inline CSS 변환 후 출력합니다.

## 예상 결과물

```text
result.zip
├── individual/
│   ├── 문서-A.html
│   └── 문서-B.html
├── combined.html
├── assets/
└── report.json
```

## 저장소 구조

```text
apps/
├── web/                 # 업로드, 템플릿 편집기, 미리보기 UI
└── api/                 # Word 파싱, 매핑, 렌더링 API
docs/
├── PRODUCT.md           # 요구사항과 범위
├── ARCHITECTURE.md      # 처리 파이프라인과 데이터 설계
└── WORD_AUTHORING_GUIDE.md # 비개발자용 Word 작성법
examples/templates/      # 샘플 HTML 템플릿
TODO.md                  # 구현 단계와 완료 조건
```

## 다음 단계

실제 Word 파일 2~3개와 현재 사용하는 개별/통합 HTML 템플릿을 받아 문서 구조와 필드 매핑 규칙을 확정합니다. 민감정보가 있다면 익명화된 예시도 충분합니다.

## 프로토타입 실행

```bash
cd apps/web
npm run dev
```

브라우저에서 `http://localhost:3000`을 열면 작성자 폼과 발행 관리 화면을 체험할 수 있습니다.

## 상태

브라우저 저장 방식의 인터랙티브 프로토타입이 구현되었습니다. 운영 MVP 구현 순서는 [TODO.md](TODO.md)를 참고하세요.
