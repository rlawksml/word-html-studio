# 책방 소식 입력 사용자 가이드

책방 정보 입력자가 HTML이나 CSS를 몰라도 월별 소식과 사진을 등록할 수 있도록 만든
실제 운영 화면 기반 A4 가이드입니다.

- 완성본: [동네책방_소식입력_사용가이드.pdf](동네책방_소식입력_사용가이드.pdf)
- 웹 공개본: [`apps/web/public/guides/bookstore-news-input-guide.pdf`](../../apps/web/public/guides/bookstore-news-input-guide.pdf)
- 생성 스크립트: [`scripts/generate_user_guide_pdf.py`](../../scripts/generate_user_guide_pdf.py)
- 화면 자료: [`assets/`](assets/)

## 가이드 범위

1. 소식 입력 화면 접속
2. 발행 월과 책방 선택
3. 처음 참여한 책방의 기본정보 등록
4. 필수·선택 소식 항목 작성
5. 여러 날짜와 일정 안내 구분
6. 여러 사진 첨부와 순서 변경
7. 자동 저장·임시 저장·지난달 불러오기
8. 작성 내용 미리보기
9. 책방별 입력 마무리와 월 전체 완료 내용 공유
10. 마지막 체크리스트와 자주 묻는 질문

작업 암호는 PDF와 저장소에 넣지 않습니다. 운영 담당자가 별도로 전달합니다.

## PDF 다시 만들기

macOS의 `AppleGothic.ttf`와 Python `reportlab`, `Pillow`가 필요합니다.

```bash
python3 scripts/generate_user_guide_pdf.py
```

결과는 `docs/guides/동네책방_소식입력_사용가이드.pdf`에 덮어쓰고 웹 공개 자산
`apps/web/public/guides/bookstore-news-input-guide.pdf`에도 복사합니다. 화면 구조가
바뀌면 먼저 `assets/`의 스크린샷을 현재 운영 화면으로 교체한 뒤 PDF를 다시 만듭니다.

## 검수 기준

- A4 12쪽과 페이지 번호가 유지되는지 확인
- 암호·API 키·환경변수가 노출되지 않았는지 확인
- 필수 항목이 `소식 제목`, `상세 내용` 두 가지로 안내되는지 확인
- 실제 버튼 이름과 가이드 문구가 일치하는지 확인
- PDF를 PNG로 렌더링해 글자 잘림, 겹침, 깨진 한글이 없는지 확인
