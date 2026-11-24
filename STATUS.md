# 현재 상태와 작업 재개 — 2026-11-24 KST

- 저장소: https://github.com/rlawksml/word-html-studio (PUBLIC). 새 저장소를 만들지 않고 기존 이력을 유지한다.
- 확인 시점 GitHub main: 3affe71109f5c51a497c92c6bd7bdba8b679c6c5, develop: 10fae105dd45009c7815b3569e6688fc94dd96d8. 원래 로컬 develop은 깨끗하고 원격과 일치했다.
- 주의: main/develop과 현재 운영 v1.1 소스는 다르다. 이전 운영 점검 기록의 v1.1 공개 버전은 1.1.0-rc.1 / 2bf2166이다. 이번 문서 작업에서는 실제 배포 버전을 새로 조회하지 않았다.
- GitHub PR #95: codex/m5-release-flow (130be32508eaa2f8ff9af714d062e5ca4df45a08) → develop, OPEN. 운영 v1.1 기준과 릴리스 절차 정합화용이다. 아직 병합 완료 상태가 아니다.
- 이 인계 문서의 작업 브랜치: codex/m5-cross-environment-handoff. PR #95의 head에서 시작해 인계 문서만 추가했다. 다른 컴퓨터에서는 이 브랜치를 먼저 읽되 제품 변경의 기준은 docs/RELEASE_FLOW.md와 실제 원격 PR 상태를 확인한다.
- 별도 staging-workspace에는 다른 작업의 미커밋 파일이 남아 있다. 이번 동기화에 포함하거나 덮어쓰지 않았다. 그 폴더의 전체 변경이 GitHub에 있다고 가정하지 않는다.
- 다음 행동: AGENTS.md → 이 문서 → docs/CROSS_ENVIRONMENT.md → docs/RELEASE_FLOW.md → TODO.md. 필요한 작업 브랜치를 확인하고 사용자 요청 범위만 진행한다.
- 이번 작업: 재개 문서만 추가. 설치·서버 실행·앱 테스트·PR #95 병합·운영 배포·DB/Storage 조작 없음.
