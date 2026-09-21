# 동네책방 소식 스튜디오 다중 에이전트 운영 가이드

이 문서는 Codex가 기획, 이슈 분석, 개발, 테스트, 사용성 검증과 최종 리뷰를 역할별로 분리하면서도 하나의 변경을 안전하게 완성하기 위한 기준이다.

## 사용자가 에이전트 이름을 적어야 하나요?

보통은 적지 않아도 된다. 저장소의 `AGENTS.md`가 요청 성격에 맞는 역할을 자동으로 선택하도록 지시한다. 사용자는 다음 세 가지만 명확하게 적으면 된다.

1. 원하는 결과
2. 바꾸면 안 되는 범위 또는 데이터
3. 분석만 필요한지, 수정·검증·PR까지 필요한지

에이전트 자동 선택은 작업 권한을 늘리지 않는다. “확인해줘”, “분석해줘”, “리뷰해줘”는 읽기 전용 단계에서 멈춘다. “수정해줘”는 코드와 검증을 허용하지만 자동으로 merge나 배포까지 허용하지 않는다. GitHub 반영, merge, Staging 배포와 Production 배포는 사용자가 요청한 범위가 각각 확인돼야 한다.

예를 들면 다음 정도로 충분하다.

```text
GitHub 이슈 #74를 한 건만 처리해줘.
먼저 원인을 분석하고, 수정한 뒤 관련 TC와 회귀 테스트를 진행해.
기존 Supabase 데이터와 Production은 변경하지 말고 결과를 Issue와 PR에 남겨줘.
```

위 예시는 수정과 Issue·PR 기록을 명시했으므로 주 에이전트가 `issue_analyst → feature_developer → qa_validator → release_reviewer` 순서로 처리하고, 마지막 Git 작업은 주 에이전트가 수행한다. 분석만 요청했다면 `issue_analyst` 결과를 전달하고 종료한다.

## 역할

| 역할 | 기본 모델 | 기본 sandbox | 의도한 수정 범위 | 사용 시점 |
|---|---|---|---|---|
| `issue_analyst` | GPT-5.6 Sol high | read-only | 없음 | 버그·Issue의 재현, 원인, 영향과 TC 분석 |
| `product_planner` | GPT-5.6 Terra high | read-only | 없음 | 요구사항·범위·완료 기준 정리 |
| `ux_designer` | GPT-5.6 Terra high | read-only | 없음 | 비개발자·모바일 사용 흐름과 문구 검토 |
| `safety_architect` | GPT-5.6 Sol xhigh | read-only | 없음 | DB·Storage·세션·동시 편집·롤백 설계 |
| `feature_developer` | GPT-5.6 Sol high | workspace-write | 승인된 코드·직접 관련 테스트 | 승인된 단일 변경 구현 |
| `qa_validator` | GPT-5.6 Terra high | workspace-write | 테스트·보고서 | TC·회귀·Staging 통합 검증과 판정 |
| `usability_tester` | GPT-5.6 Terra high | read-only | 없음 | 데스크톱·모바일 브라우저 사용성 확인 |
| `release_reviewer` | GPT-5.6 Sol xhigh | read-only | 없음 | 독립 코드·데이터 안전·배포 리뷰 |
| `astra_release_reviewer` | GPT-6 Astra xhigh | read-only | 없음 | Astra가 노출된 환경의 고위험 최종 리뷰 |
| `docs_curator` | GPT-5.6 Luna medium | workspace-write | 지정된 문서 | 검증된 결과와 문서 상태 동기화 |

`workspace-write`는 특정 폴더만 허용하는 권한이 아니라 작업 공간 전체에 쓸 수 있는 sandbox다. 표의 “의도한 수정 범위”는 에이전트 지침이며 파일시스템이 강제하는 경계가 아니다. 따라서 주 에이전트가 실행 전후 diff를 확인하고 범위를 벗어난 변경을 승인하지 않는다. 현재 세션에서 사용자가 선택한 권한 설정이 에이전트 파일의 기본 sandbox보다 우선할 수 있다는 점도 함께 고려한다.

GPT-6 Astra가 API에 존재하더라도 모든 Codex 실행 환경에서 하위 에이전트 모델로 제공된다는 뜻은 아니다. 현재 세션의 모델 목록에 Astra가 없으면 `release_reviewer`가 최종 리뷰를 담당한다.

## 주 에이전트만 할 수 있는 일

- 작업 브랜치 생성과 범위 확정
- `git add`, commit, push
- GitHub Issue 댓글과 상태 변경
- PR 생성, 갱신, ready 전환과 merge
- Staging·Production 배포 결정
- 여러 에이전트 결과의 충돌 해결과 최종 사용자 보고

이 목록은 주 에이전트가 자동으로 실행할 수 있는 권한 목록이 아니다. 현재 사용자 요청 또는 저장소의 명시적인 운영 합의가 허용한 단계만 수행한다. 특히 merge, Staging 배포와 Production 배포는 서로 별도의 결정으로 취급한다.

하위 에이전트는 자신이 담당한 분석·구현·검증 결과만 반환한다. 여러 에이전트가 같은 작업 트리에서 동시에 코드를 고치지 않도록 쓰기 에이전트는 원칙적으로 한 명씩 실행한다.

## 요청별 자동 흐름

### 버그 또는 GitHub Issue

```text
issue_analyst
  → 주 에이전트가 범위 확정
  → feature_developer
  → qa_validator
  → 필요 시 usability_tester
  → release_reviewer 또는 astra_release_reviewer
  → 주 에이전트가 Issue 기록·commit·PR
```

이 전체 흐름은 사용자가 수정·검증·GitHub 반영까지 요청했을 때만 적용한다. 분석 요청은 첫 단계에서 멈추고, 수정 요청에 GitHub 반영 허가가 없다면 검증 결과와 로컬 diff까지만 전달한다. 버그 여러 개를 한꺼번에 수정하지 않는다. 한 건을 허용된 단계까지 끝낸 뒤 다음 이슈로 이동한다.

### 새 기능 또는 큰 UX 변경

```text
product_planner + ux_designer
  → 데이터 경계가 있으면 safety_architect
  → feature_developer
  → qa_validator + usability_tester
  → release_reviewer
  → 주 에이전트가 commit·PR
```

기획과 UX처럼 읽기 중심 작업은 독립적이면 병렬로 진행할 수 있다. 코드 수정은 충돌을 피하기 위해 순차 진행한다.

### DB·사진·인증·동시 편집·배포

`safety_architect`의 사전 검토와 `release_reviewer`의 사후 검토를 생략하지 않는다. 기존 데이터 백업, 이전 버전 호환, 롤백 가능성, Staging 분리와 테스트 데이터 정리 증거가 없으면 Production 판정은 `NO-GO`다.

검토 결과가 GO여도 배포 요청을 대신하지 않는다. Staging과 Production 배포는 사용자의 명시적인 실행 요청이 있을 때만 진행한다.

## 사용자가 직접 역할을 지정하고 싶을 때

필요한 경우에만 자연어로 추가한다.

```text
이번에는 수정하지 말고 이슈 분석 에이전트로 원인과 TC만 정리해줘.
```

```text
모바일 사용성이 중요하니 UX와 사용성 테스트를 별도로 진행해줘.
```

```text
Astra가 현재 사용 가능하면 최종 릴리스 리뷰에 포함해줘.
```

```text
코드는 수정하되 커밋과 PR은 만들지 마.
```

명시적으로 지정한 지시가 자동 역할 선택보다 우선한다.

## 동시 실행 기준

프로젝트 설정은 주 에이전트 외 최대 세 개의 하위 에이전트를 허용한다. 슬롯 수를 채우기 위해 불필요한 에이전트를 실행하지 않는다.

- 병렬 권장: 코드 탐색, 이슈 근거 수집, 기획, UX 검토, 테스트 계획
- 순차 권장: 코드 수정, 테스트 파일 수정, 문서 수정, Git 작업, 배포
- 금지: 여러 에이전트의 동시 commit·push·merge, Production 데이터 쓰기, 기존 사용자 데이터로 쓰기 테스트

## 커밋과 Issue 기록 단위

- 한 Issue는 하나의 브랜치와 검토 가능한 커밋 범위로 유지한다.
- 커밋 메시지는 이슈 번호와 실제 변경을 연결한다. 예: `fix: #74 자동 저장 중 마지막 입력 누락 방지`
- Issue에는 분석, 수정, 목표 TC, 회귀 테스트, Staging 확인과 남은 위험을 순서대로 남긴다.
- 자동 테스트 성공만으로 Production을 승인하지 않는다. 변경 위험에 맞는 브라우저·API·DB 검증과 롤백 조건을 함께 확인한다.
