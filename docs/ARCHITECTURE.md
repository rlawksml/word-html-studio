# 아키텍처

## 처리 파이프라인

```text
DOCX 업로드
  -> 파일 검증/격리
  -> Word 구조 추출
  -> 중간 문서 모델(JSON)
  -> 규칙 기반 필드 매핑
  -> 선택적 LLM 보정
  -> 개별 템플릿 렌더링
  -> 통합 템플릿 렌더링
  -> HTML 정제 + CSS inline 변환
  -> 미리보기/ZIP 출력
```

LLM을 파서로 직접 사용하지 않는 것이 핵심입니다. 결정론적 추출 결과를 먼저 만들고, 의미 분류가 모호한 블록만 구조화된 JSON으로 보정하면 비용, 재현성, 개인정보 위험을 줄일 수 있습니다.

## 주요 컴포넌트

### Web

- 파일 업로드와 순서 변경
- 템플릿 코드 편집 및 미리보기
- 작업 진행률, 오류, 누락 필드 표시
- 결과 비교 및 다운로드

### API

- 업로드 세션과 작업 수명주기 관리
- 템플릿 CRUD와 버전 관리
- 변환 파이프라인 실행
- 결과 및 리포트 패키징

### Converter Core

- `DocxReader`: WordprocessingML과 관계 파일에서 구조/이미지 추출
- `Normalizer`: Word 스타일을 의미 블록으로 정규화
- `Mapper`: 사용자 규칙으로 블록을 템플릿 필드에 연결
- `LlmAdapter`: OpenAI/Gemini를 공통 구조화 출력 인터페이스로 추상화
- `Renderer`: 개별/통합 Jinja2 템플릿 렌더링
- `Sanitizer`: 위험 태그와 속성 제거
- `CssInliner`: `<style>` 규칙을 요소별 `style` 속성으로 변환
- `Packager`: 파일명 충돌을 처리하고 ZIP/리포트 생성

## 중간 문서 모델 예시

```json
{
  "source_name": "sample.docx",
  "title": "문서 제목",
  "metadata": {},
  "blocks": [
    {"id": "b1", "type": "heading", "level": 1, "text": "개요"},
    {"id": "b2", "type": "paragraph", "runs": [{"text": "본문", "bold": false}]},
    {"id": "b3", "type": "table", "rows": []}
  ],
  "assets": [],
  "warnings": []
}
```

이 모델은 LLM 공급자와 HTML 템플릿에서 독립적이어야 합니다. 각 블록에는 원본 위치를 추적할 ID를 부여해 누락과 오류를 사용자에게 설명합니다.

## 통합 HTML 전략

각 문서의 완성 HTML을 문자열로 이어 붙이지 않습니다. 개별 렌더링에 사용한 정규화 데이터와 렌더링 결과를 `documents[]`로 통합 템플릿에 전달합니다. 통합 템플릿은 표지, 목차, 공통 헤더/푸터, 문서 사이 구분을 담당합니다.

## API 초안

```text
POST   /api/templates
GET    /api/templates
PUT    /api/templates/{template_id}
POST   /api/jobs                         multipart: docx[], template_id, options
GET    /api/jobs/{job_id}
GET    /api/jobs/{job_id}/preview/{document_id}
POST   /api/jobs/{job_id}/documents/{document_id}/retry
GET    /api/jobs/{job_id}/download
```

## 보안과 개인정보

- `.docx`만 허용하고 확장자와 MIME, ZIP 내부 구조를 함께 검사합니다.
- macro를 실행하지 않으며 외부 관계 링크를 자동으로 가져오지 않습니다.
- 압축 해제 크기와 파일 수를 제한해 zip bomb을 방지합니다.
- 사용자 HTML에서 script, event handler, 위험 URL scheme을 제거합니다.
- 원본과 결과에는 TTL을 적용하고 사용자가 즉시 삭제할 수 있게 합니다.
- LLM 전송 데이터와 공급자를 작업 전에 명시합니다.

## 결정이 필요한 항목

- 결과 HTML의 주 사용처에 따른 허용 태그/CSS 범위
- 이미지 패키징 방식
- 통합 템플릿의 목차와 페이지 구분 규칙
- Word의 헤더/푸터, 각주, 텍스트 상자 지원 우선순위
- LLM 사용이 필수인지 선택인지, 조직의 데이터 반출 정책

