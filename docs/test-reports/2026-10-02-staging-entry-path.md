# #77 스테이징 진입점 경로 검증

## 원인과 변경

Wrangler 4.129.1은 main을 basename으로 업로드하지만 추가 모듈은 base_dir 상대 이름을 유지한다. 기존 worker/staging-entry.mjs의 ../dist import가 원격 루트 밖을 가리켜 code10021이 발생했다. 앱 루트 staging-entry.mjs로 이동하고 ./dist 및 ./worker imports로 통일했다. 공개 URL, secret, DB 및 운영 설정은 변경하지 않았다.

## TC 및 결과

- 전체 앱 회귀(build 포함): 87/87 PASS.
- 스테이징 config/gate/assets/Miniflare/업로드 구조: 36/36 PASS.
- CF-STAGE-05: main basename 및 import 경계/파일 존재 확인.
- STAGE-UPLOAD-01: 실제 Wrangler dry-run outdir entry에서 application/gate/assets 파일 해결 PASS. 테스트 생성 임시 디렉터리만 finally에서 정리.
- lint, typecheck, dry-run, diff-check PASS.
- 사전 원격 조회: 배포 목록 비어 있음, secret list Worker not found.
- 독립 안전 검토: 비공개 artifact bootstrap만 조건부 GO. 전체 공개/DB 통합은 NO-GO.

운영 데이터·DB·Storage·사용자 세션 변경 없음. 테스트는 로컬 합성 fixture만 사용. 원격 결과는 후속 기록하며 실제 로그인/DB/브라우저 TC는 BLOCKED로 유지한다.
