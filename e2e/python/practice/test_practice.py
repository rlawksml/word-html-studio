"""직접 바꿔 보며 배우는 연습 TC.

기본 회귀 suite에는 포함되지 않습니다. ``practice_runner.py test`` 또는 ``demo``로만
실행하며, 처음 받은 상태에서도 통과하도록 TODO는 안전한 작은 변경으로 안내합니다.
"""

from playwright.sync_api import Page, expect


def test_practice_search_and_open_news(app_page: Page) -> None:
    """검색 → 소식 열기 → 내용 확인 → 닫기의 한 흐름을 연습합니다."""
    # 1) 사용자가 보는 placeholder로 검색 입력창을 찾습니다.
    search = app_page.get_by_placeholder("책방이나 소식을 검색해 보세요")

    # 2) fill은 사람의 키보드 입력처럼 검색어를 채웁니다.
    search.fill("E2E")

    # 3) CSS 대신 버튼의 역할(role)과 보이는 이름(name)으로 찾습니다.
    news_button = app_page.get_by_role("button", name="E2E 공개 소식", exact=True)
    expect(news_button).to_be_visible()
    news_button.click()

    # 4) expect는 결과가 나타날 때까지 기다린 뒤 검증합니다.
    dialog = app_page.get_by_role("dialog", name="E2E 공개 소식")
    expect(dialog).to_contain_text("로컬 mock 상세 내용")

    # 5) 마지막으로 상세 창을 닫고 실제로 사라졌는지 확인합니다.
    app_page.get_by_role("button", name="상세 소식 닫기").click()
    expect(dialog).to_be_hidden()

    # TODO 1: 검색어를 "E2E"에서 "공개"로 바꾼 뒤 다시 실행해 보세요.
    # TODO 2: 위 to_contain_text의 기대 문장을 "로컬 mock"으로 줄여 보세요.
    # TODO 3: 일부러 "없는 문장"으로 바꿔 FAIL을 보고, 원래대로 되돌리세요.
