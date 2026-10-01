import re

import pytest
from playwright.sync_api import Page, expect


@pytest.mark.smoke
def test_visitor_can_open_and_close_public_news(app_page: Page) -> None:
    """방문자가 소식 상세 창을 열고 닫는 가장 기본적인 흐름을 확인합니다."""
    # get_by_role은 CSS 구조가 아니라 사용자가 인식하는 버튼 이름으로 요소를 찾습니다.
    app_page.get_by_role("button", name="E2E 공개 소식", exact=True).click()
    dialog = app_page.get_by_role("dialog", name="E2E 공개 소식")
    expect(dialog).to_be_visible()
    expect(dialog).to_contain_text("로컬 mock 상세 내용")
    app_page.get_by_role("button", name="상세 소식 닫기").click()
    expect(dialog).to_be_hidden()


@pytest.mark.smoke
def test_visitor_search_button_flow_is_read_only(app_page: Page) -> None:
    """검색어에 따라 소식 버튼이 숨겨지고 다시 나타나는지 확인합니다."""
    search = app_page.get_by_placeholder("책방이나 소식을 검색해 보세요")
    news_button = app_page.get_by_role("button", name="E2E 공개 소식", exact=True)
    search.fill("없는 책방")
    expect(news_button).to_be_hidden()
    search.fill("E2E")
    expect(news_button).to_be_visible()


@pytest.mark.auth
@pytest.mark.parametrize(
    ("entry_button", "dialog_name", "submit_button", "heading"),
    [
        ("소식 입력", "소식 입력 접속", "소식 입력으로 이동", "책방 소식 입력"),
        ("HTML 편집", "HTML 편집 접속", "HTML 편집으로 이동", "HTML 편집"),
    ],
)
def test_mock_role_login_and_safe_ui_click(
    app_page: Page, entry_button: str, dialog_name: str, submit_button: str, heading: str
) -> None:
    """두 역할의 동일한 로그인 흐름과 로그인 후 대표 버튼 하나를 확인합니다.

    parametrize 덕분에 아래 테스트 코드를 한 번만 작성해도 입력자와 HTML 편집자
    두 경우가 각각 독립된 테스트로 실행됩니다. 실제 암호나 실제 세션은 사용하지 않습니다.
    """
    app_page.get_by_role("button", name=entry_button, exact=True).click()
    dialog = app_page.get_by_role("dialog", name=dialog_name)
    dialog.get_by_label("작업 암호").fill("local-mock-placeholder")
    dialog.get_by_role("button", name=submit_button).click()
    expect(app_page.get_by_role("heading", name=heading, exact=True).first).to_be_visible()

    # 역할별로 로그인 다음 화면에서 발표하기 좋은 안전한 버튼 하나만 클릭합니다.
    if heading == "책방 소식 입력":
        app_page.get_by_role("button", name="다음 달 →").click()
        expect(app_page.get_by_role("heading", name="책방 소식 입력", exact=True)).to_be_visible()
    else:
        app_page.get_by_role("button", name=re.compile("통합본 만들기")).click()
        expect(app_page.get_by_role("heading", name="통합본 수록 순서")).to_be_visible()
