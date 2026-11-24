# 다른 컴퓨터·AI 환경에서 재개

## 최초 복제

```sh
git clone https://github.com/rlawksml/word-html-studio.git
cd word-html-studio
git fetch origin
git switch --track origin/codex/m5-cross-environment-handoff
```

이미 해당 로컬 브랜치가 있으면 `git switch codex/m5-cross-environment-handoff`를 사용한다. 기존 변경이 있으면 먼저 보존하며 reset·clean으로 정리하지 않는다. 이 문서는 문서 추가 브랜치에 있고, main/develop이 현재 운영 최신 소스라는 뜻이 아니다. PR #95와 STATUS.md를 확인한다.

## 읽을 순서

AGENTS.md → STATUS.md → docs/RELEASE_FLOW.md → README.md → TODO.md. 기능 수정 시 docs/ARCHITECTURE.md와 해당 기능 문서를 읽는다. 오래된 README의 Sites 운영 설명과 최신 릴리스 문서가 다르면 날짜·근거를 대조하고 현재 운영 Worker 기준을 따른다.

Node.js 최소 버전과 scripts는 apps/web/package.json, 고정 버전은 package-lock.json을 기준으로 한다. 현재 Node.js >=22.13.0이 명시돼 있다. 준비가 승인된 환경에서는 apps/web에서 `npm ci`로 설치한다. 이번 이관에서는 설치나 실행을 검증하지 않았다. Mac/Windows에서 환경 변수 구문 차이가 있을 수 있으므로 명령 실패를 숨기지 않는다.

## 환경과 데이터 경계

- `.env.local`은 이관하지 않는다. 새 기기에서 승인된 staging 설정만 별도 보안 경로로 공급한다. 변수 이름은 저장소의 예시·설정 문서를 참고하며 실제 값을 채팅·문서·Git에 적지 않는다.
- 운영 데이터·사진 백업은 Git 소스와 별개다. clone은 DB/Storage를 복원하거나 복사하지 않는다.
- 기존 운영 DB/Storage는 테스트·초기화·삭제하지 않는다. 실제 DB 테스트는 대상이 별도 staging임을 확인하고 승인된 절차로만 실행한다.
- GitHub·Cloudflare·Supabase·브라우저 로그인 및 AI 도구 연결은 새 환경에서 별도로 확인한다. 채팅 기억·로그인·로컬 자동화는 clone으로 이동하지 않는다.
- 작업 시작 시 `git status --short --branch`, `git fetch origin`, 대상 브랜치의 `git pull --ff-only`를 확인한다. 결과와 검증·미완료·다음 행동을 문서에 남긴 뒤 해당 작업 파일만 커밋·push한다. 충돌은 근거를 보존해 해결하며 강제 푸시는 하지 않는다.
- 원격 branch 보호와 기존 릴리스 흐름을 유지한다. PR #95나 이 문서 PR을 자동으로 병합하지 않는다. 배포는 별도 승인 사항이다.

## 새 AI에 전달할 요청

> 이 저장소 AGENTS.md, STATUS.md, docs/CROSS_ENVIRONMENT.md, docs/RELEASE_FLOW.md와 TODO.md를 읽어줘. 원격 브랜치·PR 상태와 미커밋 변경을 확인하고 현재 운영본·개발본·검증 전 후보를 구분해서 설명해줘. 운영 DB와 사진을 보존하며 내가 요청한 범위만 이어서 작업해줘. main/develop을 운영 최신본이라고 가정하지 말고, 종료할 때 변경·검증·남은 일과 원격 동기화 결과를 기록해줘.

## 2026-11-24 이관 검증

별도 빈 폴더에서 `de89a5c430cb1f2ec08e463ae1f00c116b589958`의 인계 브랜치 clone 성공. 추적 파일 343개 SHA-256 불일치 0개, 로컬·원격 커밋 일치, 기존 PUBLIC 설정 유지. 앱 설치·실행·기능 테스트·운영 재검증은 이번 문서 변경에서 수행하지 않았다. 기존 main/develop·PR #95·운영 배포는 변경하지 않았다.
