# Word HTML Studio

정형화된 Word 문서(`.docx`) 여러 개를 사용자가 정의한 HTML 템플릿에 맞춰 변환하고, 개별 HTML과 통합 HTML을 한 번에 생성하는 로컬 우선 웹 애플리케이션입니다.

## 제품 형태 결정

첫 버전은 **로컬에서 실행하는 웹 앱**으로 만듭니다.

- 브라우저 UI라서 템플릿 편집, 여러 파일 업로드, 미리보기를 구현하기 쉽습니다.
- 서버를 사용자 PC에서 실행하면 원본 문서를 외부 저장소에 올리지 않아도 됩니다.
- 이후 Docker 또는 클라우드에 배포해 팀용 웹 서비스로 확장할 수 있습니다.
- 데스크톱 실행파일이 필요해지면 같은 웹 UI를 Tauri로 감싸 재사용할 수 있습니다.

## 핵심 흐름

1. 사용자가 HTML 템플릿과 필드 규칙을 저장합니다.
2. 여러 `.docx` 파일을 드래그 앤 드롭으로 업로드합니다.
3. 서버가 문단, 제목, 표, 이미지와 스타일 정보를 구조화된 중간 데이터로 추출합니다.
4. 규칙 기반 매핑을 먼저 적용하고, 불확실한 부분만 선택한 LLM(OpenAI 또는 Gemini)에 맡깁니다.
5. 생성된 HTML을 허용 목록으로 정제하고 모든 CSS를 inline style로 변환합니다.
6. 파일별 HTML, 전체 통합 HTML, 변환 리포트를 ZIP으로 내려받습니다.

일반 사용자는 HTML/CSS를 작성하지 않습니다. 관리자가 만든 템플릿을 선택하고, [Word 작성 가이드](docs/WORD_AUTHORING_GUIDE.md)에 따라 Word의 기본 스타일을 사용해 문서를 작성하면 됩니다.

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

## 상태

현재는 제품 결정 및 설계 단계입니다. 실행 가능한 MVP 구현 순서는 [TODO.md](TODO.md)를 참고하세요.
