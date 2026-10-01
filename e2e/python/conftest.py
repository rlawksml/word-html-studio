from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import Page, Route

from safety import require_loopback_base_url


@pytest.fixture(scope="session")
def safe_base_url() -> str:
    # 이 fixture가 page.goto보다 먼저 평가되므로 잘못된 대상에는 요청 자체가 없습니다.
    return require_loopback_base_url(os.getenv("E2E_BASE_URL", "http://localhost:3000"))


@pytest.fixture(scope="session")
def mock_workspace() -> dict:
    now = datetime.now(timezone(timedelta(hours=9)))
    month = now.strftime("%Y-%m")
    date = f"{month}-15"
    timestamp = now.isoformat()
    return {
        "bookstores": [{
            "id": 1, "updatedAt": timestamp, "sortOrder": 0,
            "name": "E2E 동네책방", "region": "로컬 테스트", "address": "", "hours": "",
            "phone": "", "sns": "", "website": "", "introduction": "읽기 전용 fixture",
            "contacts": [], "links": [],
        }],
        "submissions": [{
            "id": 11, "bookstoreId": 1, "month": month, "status": "completed",
            "updatedAt": timestamp, "completedAt": timestamp, "publishedAt": "", "publishedUrl": "",
            "monthlyNotice": "", "news": [{
                "id": 101, "title": "E2E 공개 소식", "description": "로컬 mock 상세 내용",
                "dates": [date], "scheduleRange": None, "scheduleText": "", "regular": False,
                "displayLabel": "", "deadline": "", "place": "", "fee": "",
                "applicationInfo": "", "applyUrl": "", "extraFields": [], "links": [],
                "images": [], "includeInDigest": True,
            }],
        }],
    }


@pytest.fixture
def app_page(page: Page, safe_base_url: str, mock_workspace: dict) -> Page:
    observed_mutations: list[str] = []
    allowed_origin = urlsplit(safe_base_url)

    def api_route(route: Route) -> None:
        request = route.request
        path = request.url.split("?", 1)[0]
        if path.endswith("/api/workspace") and request.method == "GET":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(mock_workspace))
            return
        if path.endswith("/api/session") and request.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"ok":true}')
            return
        if path.endswith("/api/session") and request.method == "GET":
            route.fulfill(status=401, content_type="application/json", body='{"message":"mock only"}')
            return
        if path.endswith("/api/presence") and request.method == "POST":
            # HTML 화면이 자동으로 확인하는 편집 임대도 브라우저 안에서만 응답합니다.
            route.fulfill(
                status=200,
                content_type="application/json",
                body='{"owned":true,"activeRole":"html","expiresAt":"2099-01-01T00:00:00Z"}',
            )
            return
        if path.endswith("/api/presence") and request.method == "DELETE":
            route.fulfill(status=204, body="")
            return
        observed_mutations.append(f"{request.method} {path}")
        route.abort("blockedbyclient")

    def network_guard(route: Route) -> None:
        request_url = urlsplit(route.request.url)
        if (request_url.scheme, request_url.hostname, request_url.port) != (
            allowed_origin.scheme,
            allowed_origin.hostname,
            allowed_origin.port,
        ):
            observed_mutations.append(f"EXTERNAL {request_url.scheme}://{request_url.hostname}")
            route.abort("blockedbyclient")
            return
        if request_url.path.startswith("/api/"):
            api_route(route)
            return
        route.continue_()

    page.route("**/*", network_guard)
    page.goto(safe_base_url, wait_until="domcontentloaded")
    page.get_by_placeholder("책방이나 소식을 검색해 보세요").wait_for()
    yield page
    assert not observed_mutations, f"예상하지 않은 상태 변경 API 요청: {observed_mutations}"
