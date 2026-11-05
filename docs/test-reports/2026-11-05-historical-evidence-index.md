# 과거 검증 자료 색인 — 원문 비공개 보존

## 범위와 공개 원칙

이 표는 **당시 보고서에 기록된 결과**이며 현재 코드나 서비스의 재검증 결과가 아니다. 2026-11-03~04 보고서11개(947줄)와 합성 캡처1개를 독립 검토자가 끝까지 읽고 확인했다. 원본은 그대로 유지하며 기존 비공개 로컬 source checkpoint의 `untracked.tar`에도12개 경로가 있음을 주 에이전트가 확인했다. 이는 DB/Storage 또는 다른 장치 백업이 아니다.

원문에 QA 식별자·Storage prefix·임시 manifest/ZIP·개인 로컬 경로·계정 관련 세부 정보가 있어 공개 Git에는 원문과 캡처를 올리지 않는다. 아래에는 파일명·해시·필요한 역사 요약만 남긴다. 실제 키/쿠키/사용자 업무 본문은 검토 범위에서 발견하지 못했지만 완전한 비밀정보 탐지나 이미지 메타데이터 검사까지 보장하지는 않는다.

파일명은 비공개 원본의 상대 경로이며 공개 링크가 아니다. 해시는 현재 원문 파일의 무결성 식별자일 뿐, 당시 테스트의 재현 또는 현재 PASS를 증명하지 않는다. 참조된 실제 ZIP·입력 이미지·감사 manifest·로그·당시 exact source/dist가 함께 보관됐는지는 별도 확인이 필요하다.

## 당시 결과와 한계

| `docs/test-reports/` 아래 원본 | 당시 기록 | 현재 해석의 한계 |
|---|---|---|
| `2026-11-03-restart-checklist.md` | 로컬 앱87/87·Worker36/36, 설정·접속 준비 | 당시 환경 기록. 전체 P0/릴리스 검증 아님 |
| `2026-11-03-staging-route-enable.md` | 승인된 staging 경로 활성화 후 비인증 GET7/7 | 로그인·DB 정상 증거 아님 |
| `2026-11-04-2b42464f-post-deploy.md` | staging 배포 모듈23/23·비인증 GET8/8 대조 | 그 시점 인증 후 P0 미검증 |
| `2026-11-04-cleanup-safety-stage1.md` | 합성 차단·삭제 보호16개 및 기본100개 | 16개 중복 합산 금지. 실제 삭제/원자성 증거 아님 |
| `2026-11-04-html-copy-browser.md` | 최초 합성 복사4PASS/1FAIL | 최초 실패를 후속 성공으로 덮어쓰지 않음 |
| `2026-11-04-html-copy-observer-fix.md` | 후속 합성 브라우저5/5·observer11·기본129 | OS clipboard·실서버·새 build·장기 누수 검증 아님 |
| `2026-11-04-retain-only-stage2.md` | retain-only SDK mock18/18·기본118 | 실제 DB/Storage·삭제 adapter 검증 아님 |
| `2026-11-04-retained-staging-uat.md` | 승인된 신규 QA 보관형 상위 UAT14, 기존 행 지문 불변 보고 | 외부 편집기1건은 사용자 확인. 자동 clipboard·동시성·대용량·장기 메모리 미검증 |
| `2026-11-04-staging-origin-fix-pre-deploy.md` | 로컬 앱87/87·Worker36/36·native form8사례 | 당시 미배포 합성 검증. 숫자 중복 합산 금지 |
| `2026-11-04-staging-role-check.md` | 사용자 직접 로그인 뒤 역할 UI5건 | 세션 폐기·저장·사진·전체 API 검증 아님 |
| `2026-11-04-preprod-progress.md` | 준비-only rollback17TC와 미완료 게이트 | 현재 진행 상태로 재사용 금지. 전체 NO-GO |
| `assets/2026-11-04-real-html-lines.png` | 합성 QA 줄바꿈 미리보기 캡처 | 비공개 유지. 독립 복사/DB 성공 증거로 확대하지 않음 |

자동 검증·사용자 확인·미실행을 분리한다. 최초 실패·후속 관측 도구 보완·별도 실제 UAT를 구분하되 이들 모두의 단일 시간순서를 추정하지 않는다. 이후 제품/검증 소스가 달라졌으므로 위 숫자를 이번 합본의 전체 회귀 수에 더하지 않는다.

## SHA-256 — 주·독립 검토자 대조

```text
80a8326d3b4977ddfb5692a94b6b9ec2c56c17f74fc76a6b3e3d4220e6cb0b02  2026-11-03-restart-checklist.md
dff443eeba46391803d631ce04f338e0c94ccf8fb974b307f55b160f55e7e73a  2026-11-03-staging-route-enable.md
c7cead0b0e0a957d5304337c78f1e4f83e53246efbe05537e47a5355c45df9a8  2026-11-04-2b42464f-post-deploy.md
1c799a34539167dddc634b46294dbdeea9b52c31e02b1fbd44df70b6af468465  2026-11-04-cleanup-safety-stage1.md
a92e181329f365332a055997aff528bd6f1cf615661f239d4f6c895e16f5f70b  2026-11-04-html-copy-browser.md
78fa47103637ad4735c7fe945b8c8813e2e4d481a362a8cbdc0282f07d11513a  2026-11-04-html-copy-observer-fix.md
3beb97ef310ef78b2f007b3ea09c581337c4280f1c26e69ddf4205185e0cec5f  2026-11-04-retain-only-stage2.md
33b289d8576dee1ea41a42f4caa92c2541fcfa5ee18a0350ef069d9db5451a85  2026-11-04-retained-staging-uat.md
d85a605bed743c93a40298409c0f967536c72f183b95220d4b1e2b66434380ee  2026-11-04-staging-origin-fix-pre-deploy.md
4ac220fd4dbb8fa9f1a5377a5220e0caea4c17459727688ac47fba03c0c3e5bd  2026-11-04-staging-role-check.md
24490a0cb87804bb8b1164a909deeb6c81d8ef7a2c2f85989bef771642bc7b08  2026-11-04-preprod-progress.md
d77d18794ac594ec89f1a26f27f356f917573e267bc8234bd828bf7e19b534cb  assets/2026-11-04-real-html-lines.png
```

현재 검증 결과가 아닌 과거 기록의 색인이다.
