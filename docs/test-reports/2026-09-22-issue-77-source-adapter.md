# #77 배포 소스 분리 검증

- 원본 앱: `567e47b272bf831385456bc15fb19103ff4b9fb4`
- 앱 tree: `9b8fd852e1c3ef8e60813f12340cc85d8612f095`
- 범위: 로컬 배포 준비 도구. GitHub monorepo 및 운영 데이터 무변경. 별도 이슈 브랜치이며 merge 없음.

| TC | 실행 | 결과 |
|---|---|---|
| TC-DEPLOY-077-01 | committed bytes만 추출, dirty/untracked 보존, provenance 검증 | PASS |
| TC-DEPLOY-077-02 | 운영 project_id export 거부 | PASS |
| TC-DEPLOY-077-03 | 추적된 .env.local 거부 | PASS |
| TC-DEPLOY-077-04 | symlink 거부 | PASS |
| TC-DEPLOY-077-05 | 실제 앱 커밋 export | PASS, 143개 파일 개별 SHA256 대조 |
| TC-DEPLOY-077-06 | 추출 디렉터리 npm ci / typecheck / build | PASS |
| TC-DEPLOY-077-07 | 기존 Sites 공식 source open → save → deploy | BLOCKED, 기존 remote root manifest 없음 |

자동 테스트: `node --test scripts/prepare-sites-source.test.mjs` (4/4). 각 테스트의 새 임시 fixture와 export만 종료 시 정리했다. 실제 추출 결과물은 재검토용 로컬 임시 디렉터리에 유지한다. 도구는 사용자 디렉터리 삭제 기능이 없다.

추출 앱의 전체 npm test는 실행하지 않았다. monorepo workflow 참조 테스트는 원본 CI에서 검증하며 export에서는 typecheck/build를 검증한다. 설치 개발 의존성의 기존 audit10건, 빌드의 native config 향후 변경·큰 chunk·route 분류 경고는 그대로이며 이번 범위에서 무관한 업그레이드는 하지 않았다.

판정: 로컬 준비 도구 검증 PASS. #77 전체 완료 및 Staging 실제 배포는 BLOCKED. 기존 Sites version15, 원격 history, Supabase/Storage/환경변수는 변경하지 않았다. 플랫폼 bootstrap 제약을 이 도구가 해결했다고 주장하지 않는다.
