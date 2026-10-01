import pytest

from safety import UnsafeBaseUrl, require_loopback_base_url


@pytest.mark.parametrize("url", [
    "https://bookstore-news-studio.rlawksml.chatgpt.site/",
    "https://bookstore-news-studio-staging.rlawksml.chatgpt.site/",
    "http://example.com:3000",
    "http://localhost.evil.example:3000",
    "http://bookstore-news-studio.rlawksml.chatgpt.site:3000",
    "http://bookstore-news-studio.rlawksml.chatgpt.site.evil.example:3000",
    "http://user:secret@localhost:3000",
    "https://localhost:3000",
    "http://127.0.0.1",
    "file:///tmp/app",
])
def test_remote_or_ambiguous_base_url_is_rejected(url: str) -> None:
    with pytest.raises(UnsafeBaseUrl):
        require_loopback_base_url(url)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:3000/",
    "http://localhost:3000",
    "http://[::1]:3000",
])
def test_explicit_loopback_base_url_is_allowed(url: str) -> None:
    assert require_loopback_base_url(url).startswith(("http://127.0.0.1", "http://localhost", "http://[::1]"))
