#!/usr/bin/env python3
"""Generate the bookstore news input user guide PDF.

The guide intentionally omits worker passwords. It uses screenshots of the
current production UI and explains only the information-entry workflow.
"""

from __future__ import annotations

from pathlib import Path
import shutil
from typing import Iterable

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "docs" / "guides" / "assets"
OUTPUT = ROOT / "docs" / "guides" / "동네책방_소식입력_사용가이드.pdf"
PUBLIC_OUTPUT = ROOT / "apps" / "web" / "public" / "guides" / "bookstore-news-input-guide.pdf"

PAGE_W, PAGE_H = A4
MARGIN = 42
CONTENT_W = PAGE_W - MARGIN * 2

INK = colors.HexColor("#252824")
MUTED = colors.HexColor("#6F746F")
LINE = colors.HexColor("#D9DAD5")
PAPER = colors.HexColor("#F5F5F2")
WARM = colors.HexColor("#EEE8D8")
WARM_DARK = colors.HexColor("#7A6745")
WHITE = colors.white
ACCENT = colors.HexColor("#B55A47")
GREEN = colors.HexColor("#506A57")

FONT_PATH = "/System/Library/Fonts/Supplemental/AppleGothic.ttf"
pdfmetrics.registerFont(TTFont("Guide", FONT_PATH))


def style(
    size: float,
    *,
    color=INK,
    leading: float | None = None,
    align=TA_LEFT,
    bold: bool = False,
) -> ParagraphStyle:
    return ParagraphStyle(
        f"s-{size}-{color}-{align}-{bold}",
        fontName="Guide",
        fontSize=size,
        leading=leading or size * 1.55,
        textColor=color,
        alignment=align,
        wordWrap="CJK",
        spaceAfter=0,
        spaceBefore=0,
    )


def draw_para(
    c: canvas.Canvas,
    text: str,
    x: float,
    y_top: float,
    width: float,
    *,
    size: float = 10,
    color=INK,
    leading: float | None = None,
    align=TA_LEFT,
    bold: bool = False,
    max_height: float = 400,
) -> float:
    if bold:
        text = f"<b>{text}</b>"
    paragraph = Paragraph(text, style(size, color=color, leading=leading, align=align, bold=bold))
    _, height = paragraph.wrap(width, max_height)
    paragraph.drawOn(c, x, y_top - height)
    return height


def draw_page_header(c: canvas.Canvas, section: str, title: str, page_no: int) -> float:
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(MUTED)
    c.setFont("Guide", 7.5)
    c.drawString(MARGIN, PAGE_H - 32, "JIGWANSEOGA  |  BOOKSTORE NEWS STUDIO")
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 32, section)
    c.setStrokeColor(LINE)
    c.line(MARGIN, PAGE_H - 42, PAGE_W - MARGIN, PAGE_H - 42)
    draw_para(c, title, MARGIN, PAGE_H - 66, CONTENT_W, size=23, leading=30, bold=True)
    c.setFillColor(MUTED)
    c.setFont("Guide", 7.5)
    c.drawString(MARGIN, 24, "동네책방 소식 입력 사용자 가이드  |  초안 v0.1")
    c.drawRightString(PAGE_W - MARGIN, 24, str(page_no))
    return PAGE_H - 108


def draw_tag(c: canvas.Canvas, text: str, x: float, y: float, *, fill=WARM, color=WARM_DARK) -> float:
    padding_x = 9
    height = 20
    width = pdfmetrics.stringWidth(text, "Guide", 8) + padding_x * 2
    c.setFillColor(fill)
    c.roundRect(x, y - height, width, height, 3, fill=1, stroke=0)
    c.setFillColor(color)
    c.setFont("Guide", 8)
    c.drawCentredString(x + width / 2, y - 13.5, text)
    return width


def draw_card(
    c: canvas.Canvas,
    x: float,
    y_top: float,
    width: float,
    height: float,
    *,
    fill=WHITE,
    stroke=LINE,
    radius: float = 6,
) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(x, y_top - height, width, height, radius, fill=1, stroke=1)


def draw_number(c: canvas.Canvas, number: int, x: float, y: float, *, fill=INK) -> None:
    c.setFillColor(fill)
    c.circle(x, y, 10, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont("Guide", 8)
    c.drawCentredString(x, y - 2.7, str(number))


def draw_numbered_list(
    c: canvas.Canvas,
    items: Iterable[str],
    x: float,
    y_top: float,
    width: float,
    *,
    gap: float = 9,
    size: float = 9.5,
) -> float:
    y = y_top
    for index, text in enumerate(items, 1):
        draw_number(c, index, x + 10, y - 10)
        height = draw_para(c, text, x + 29, y, width - 29, size=size, leading=size * 1.55)
        y -= max(height, 20) + gap
    return y


def draw_bullets(
    c: canvas.Canvas,
    items: Iterable[str],
    x: float,
    y_top: float,
    width: float,
    *,
    size: float = 9.5,
    gap: float = 7,
    color=INK,
) -> float:
    y = y_top
    for text in items:
        c.setFillColor(ACCENT)
        c.circle(x + 4, y - 7, 2.2, fill=1, stroke=0)
        height = draw_para(c, text, x + 14, y, width - 14, size=size, color=color)
        y -= height + gap
    return y


def draw_screenshot(
    c: canvas.Canvas,
    filename: str,
    x: float,
    y_top: float,
    width: float,
    height: float,
    *,
    crop: tuple[float, float, float, float] | None = None,
) -> None:
    path = ASSET_DIR / filename
    image = ImageReader(path)
    img_w, img_h = image.getSize()
    if crop:
        from PIL import Image

        with Image.open(path) as source:
            left = int(source.width * crop[0])
            upper = int(source.height * crop[1])
            right = int(source.width * crop[2])
            lower = int(source.height * crop[3])
            cropped = source.crop((left, upper, right, lower)).convert("RGB")
            cache_path = ASSET_DIR / f".crop-{filename}"
            cropped.save(cache_path, "JPEG", quality=92)
        image = ImageReader(cache_path)
        img_w, img_h = image.getSize()

    c.setFillColor(colors.HexColor("#D8D8D4"))
    c.roundRect(x + 4, y_top - height - 4, width, height, 5, fill=1, stroke=0)
    c.saveState()
    path_builder = c.beginPath()
    path_builder.roundRect(x, y_top - height, width, height, 5)
    c.clipPath(path_builder, stroke=0)
    c.drawImage(image, x, y_top - height, width, height, preserveAspectRatio=False, mask="auto")
    c.restoreState()
    c.setStrokeColor(colors.HexColor("#CBCBC7"))
    c.roundRect(x, y_top - height, width, height, 5, fill=0, stroke=1)


def draw_two_column_table(
    c: canvas.Canvas,
    rows: list[tuple[str, str]],
    x: float,
    y_top: float,
    width: float,
    *,
    left_width: float = 130,
) -> float:
    y = y_top
    for index, (label, value) in enumerate(rows):
        row_h = max(
            draw_measure(value, width - left_width - 24, size=9),
            draw_measure(label, left_width - 20, size=9),
        ) + 18
        fill = WHITE if index % 2 == 0 else colors.HexColor("#F0F0ED")
        c.setFillColor(fill)
        c.rect(x, y - row_h, width, row_h, fill=1, stroke=0)
        c.setStrokeColor(LINE)
        c.rect(x, y - row_h, width, row_h, fill=0, stroke=1)
        draw_para(c, label, x + 10, y - 9, left_width - 20, size=9, color=WARM_DARK, bold=True)
        draw_para(c, value, x + left_width + 4, y - 9, width - left_width - 14, size=9)
        y -= row_h
    return y


def draw_measure(text: str, width: float, *, size: float = 9) -> float:
    paragraph = Paragraph(text, style(size))
    _, height = paragraph.wrap(width, 400)
    return height


def draw_tip(c: canvas.Canvas, title: str, text: str, x: float, y_top: float, width: float) -> float:
    text_h = draw_measure(text, width - 30, size=9)
    box_h = text_h + 48
    draw_card(c, x, y_top, width, box_h, fill=WARM, stroke=WARM)
    draw_para(c, title, x + 15, y_top - 13, width - 30, size=9, color=WARM_DARK, bold=True)
    draw_para(c, text, x + 15, y_top - 31, width - 30, size=9, color=INK)
    return box_h


def draw_qr(c: canvas.Canvas, url: str, x: float, y: float, size: float) -> None:
    widget = qr.QrCodeWidget(url)
    bounds = widget.getBounds()
    drawing = Drawing(size, size, transform=[size / (bounds[2] - bounds[0]), 0, 0, size / (bounds[3] - bounds[1]), 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, c, x, y)


def page_cover(c: canvas.Canvas) -> None:
    c.setFillColor(INK)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setStrokeColor(colors.HexColor("#464A45"))
    for offset in (42, 58, 74):
        c.line(offset, 0, offset, PAGE_H)
    c.setFillColor(WARM)
    c.rect(MARGIN, PAGE_H - 106, 56, 56, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("Guide", 25)
    c.drawCentredString(MARGIN + 28, PAGE_H - 86, "止")
    c.setFillColor(WHITE)
    c.setFont("Guide", 10)
    c.drawString(MARGIN + 72, PAGE_H - 72, "止觀書架")
    c.setFillColor(colors.HexColor("#BFC3BD"))
    c.setFont("Guide", 7.5)
    c.drawString(MARGIN + 72, PAGE_H - 89, "동네책방 소식 스튜디오")

    draw_para(c, "동네책방 소식 입력<br/>사용자 가이드", MARGIN, PAGE_H - 202, CONTENT_W - 40, size=34, color=WHITE, leading=47, bold=True)
    draw_para(
        c,
        "Word 문서를 만들듯 편안하게,<br/>한 책방씩 소식과 사진을 입력하는 방법",
        MARGIN,
        PAGE_H - 316,
        CONTENT_W - 80,
        size=13,
        color=colors.HexColor("#D3D6D1"),
        leading=22,
    )

    c.setFillColor(WARM)
    c.roundRect(MARGIN, 210, CONTENT_W, 92, 8, fill=1, stroke=0)
    draw_para(c, "이 가이드는 책방 정보 입력자를 위한 문서입니다.", MARGIN + 18, 283, CONTENT_W - 150, size=11, color=INK, bold=True)
    draw_para(
        c,
        "HTML이나 CSS를 몰라도 괜찮습니다. 별표(*)가 붙은 두 항목만 반드시 작성하고, 나머지는 필요한 내용만 골라 입력하면 됩니다.",
        MARGIN + 18,
        258,
        CONTENT_W - 150,
        size=9.5,
        color=INK,
    )
    draw_qr(c, "https://bookstore-news-studio.rlawksml.chatgpt.site/", PAGE_W - MARGIN - 72, 220, 60)

    c.setFillColor(colors.HexColor("#AEB2AD"))
    c.setFont("Guide", 8)
    c.drawString(MARGIN, 92, "초안 v0.1  |  2026.07")
    c.drawString(MARGIN, 72, "실제 서비스 화면 기준")
    c.showPage()


def page_quick_start(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "QUICK START", "3분 안에 전체 흐름 보기", 2)
    draw_para(c, "처음에는 아래 여섯 단계만 기억하세요.", MARGIN, y, CONTENT_W, size=11, color=MUTED)
    y -= 36
    steps = [
        ("1", "소식 입력 접속", "첫 화면 오른쪽 위의 <b>소식 입력</b>을 누르고 관리자가 알려준 작업 암호를 입력합니다."),
        ("2", "발행 월 선택", "이번 소식을 게시할 연도와 월을 확인합니다. 현재 날짜와 같지 않아도 직접 선택할 수 있습니다."),
        ("3", "책방 선택", "목록에서 작성할 책방을 한 곳 선택합니다. 처음 참여한 책방만 <b>책방 관리</b>에서 등록합니다."),
        ("4", "소식 작성", "소식 제목과 상세 내용은 필수입니다. 날짜, 사진, 장소 등은 필요한 경우에만 추가합니다."),
        ("5", "미리보기와 저장", "내용은 자동 저장됩니다. <b>작성 내용 미리보기</b>로 실제 게시 모습을 확인합니다."),
        ("6", "입력 마무리", "해당 책방 작성을 끝냈다면 <b>입력 마무리</b>를 누릅니다. 모든 책방이 끝나면 완료 내용을 복사해 공유합니다."),
    ]
    card_h = 82
    for index, (num, title, body) in enumerate(steps):
        col = index % 2
        row = index // 2
        x = MARGIN + col * (CONTENT_W / 2 + 6)
        top = y - row * (card_h + 12)
        width = CONTENT_W / 2 - 6
        draw_card(c, x, top, width, card_h)
        draw_number(c, int(num), x + 22, top - 24, fill=WARM_DARK)
        draw_para(c, title, x + 42, top - 14, width - 54, size=11, bold=True)
        draw_para(c, body, x + 16, top - 43, width - 32, size=8.8, color=MUTED, leading=13)
    draw_tip(
        c,
        "가장 중요한 원칙",
        "한 화면에서 한 책방씩 작성합니다. 필수는 소식 제목과 상세 내용 두 가지이며, 빈 선택 항목은 최종 HTML에 표시되지 않습니다.",
        MARGIN,
        y - 3 * (card_h + 12) - 6,
        CONTENT_W,
    )
    c.showPage()


def page_access(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "STEP 1", "소식 입력 화면에 접속하기", 3)
    draw_screenshot(c, "02-access.jpg", MARGIN, y, CONTENT_W, 270)
    y -= 290
    y = draw_numbered_list(
        c,
        [
            "첫 화면 오른쪽 위에서 <b>소식 입력</b>을 누릅니다.",
            "작업 암호를 입력합니다. 한글 자판과 영문 자판 상태를 따로 신경 쓰지 않아도 됩니다.",
            "<b>소식 입력으로 이동</b>을 누릅니다. 새로고침해도 현재 탭에서는 접속 상태가 유지됩니다.",
        ],
        MARGIN,
        y,
        CONTENT_W,
    )
    draw_tip(
        c,
        "암호 안내",
        "이 PDF에는 암호를 적지 않습니다. 운영 담당자에게 받은 암호를 사용하세요. 공용 PC에서는 작업 후 반드시 로그아웃하고 탭을 닫습니다.",
        MARGIN,
        y - 6,
        CONTENT_W,
    )
    c.showPage()


def page_dashboard(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "STEP 2", "발행 월과 책방 선택하기", 4)
    draw_screenshot(c, "03-input-dashboard.jpg", MARGIN, y, CONTENT_W, 270)
    y -= 290
    draw_numbered_list(
        c,
        [
            "<b>발행 월</b>에서 이전 달 또는 다음 달로 이동합니다. 소식을 실제로 게시할 월을 직접 확인하세요.",
            "<b>이번 달 작업 진행률</b>에서 전체 책방 중 완료한 책방 수를 봅니다.",
            "작성할 책방 카드를 누릅니다. 카드에는 소식 수, 사진 수, 현재 상태가 표시됩니다.",
            "모든 책방을 마친 뒤 <b>완료 내용 공유하기</b>를 누르면 메신저용 문구가 복사됩니다.",
            "처음 참여한 책방을 등록하거나 고정 정보를 바꿀 때만 <b>책방 관리</b>를 사용합니다.",
        ],
        MARGIN,
        y,
        CONTENT_W,
        gap=7,
        size=9,
    )
    c.showPage()


def page_bookstore(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "FIRST USE", "책방 기본정보는 한 번만 등록", 5)
    draw_screenshot(c, "04-bookstore-manage.jpg", MARGIN, y, CONTENT_W, 270)
    y -= 290
    draw_two_column_table(
        c,
        [
            ("필수", "<b>책방 이름, 지역</b> - 책방을 구분하고 방문자 화면과 통합본에 표시합니다."),
            ("선택", "주소, 책방 소개, 영업시간, 대표 연락처, 대표 SNS, 홈페이지"),
            ("추가 가능", "책방지기 연락처, 블로그, 두 번째 SNS처럼 항목을 여러 개 추가할 수 있습니다."),
        ],
        MARGIN,
        y,
        CONTENT_W,
        left_width=82,
    )
    draw_tip(
        c,
        "언제 수정하나요?",
        "주소, 연락처, 영업시간처럼 평소 바뀌지 않는 정보만 이곳에서 관리합니다. 임시 휴무처럼 이번 달에만 달라지는 내용은 소식 작성 화면의 '이번 달 운영 안내'에 적습니다.",
        MARGIN,
        y - 112,
        CONTENT_W,
    )
    c.showPage()


def page_write(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "STEP 3", "소식 제목과 상세 내용 작성하기", 6)
    draw_screenshot(c, "05-news-editor.jpg", MARGIN, y, CONTENT_W, 270)
    y -= 290
    draw_two_column_table(
        c,
        [
            ("소식 제목 *", "방문자 카드와 통합본에 그대로 표시됩니다. 행사명이나 전시명을 짧고 분명하게 적습니다."),
            ("상세 내용 *", "Word에 쓰던 설명을 자연스러운 문장과 문단으로 붙여 넣습니다. 현재는 글자색이나 굵기 설정이 필요하지 않습니다."),
            ("이번 달 운영 안내", "임시 휴무, 이전, 월 한정 영업시간처럼 해당 월에만 달라지는 내용이 있을 때만 작성합니다."),
        ],
        MARGIN,
        y,
        CONTENT_W,
        left_width=115,
    )
    draw_tip(
        c,
        "소식이 여러 개인 경우",
        "화면 아래의 '소식 하나 더 추가'를 누릅니다. 소식 카드 왼쪽의 손잡이를 끌거나 위아래 버튼을 눌러 최종 표시 순서를 바꿀 수 있습니다.",
        MARGIN,
        y - 142,
        CONTENT_W,
    )
    c.showPage()


def page_fields(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "FIELDS", "무엇을 어디에 적으면 될까요?", 7)
    draw_tag(c, "필수 2개", MARGIN, y)
    draw_para(c, "소식 제목, 상세 내용", MARGIN + 82, y - 2, CONTENT_W - 82, size=11, bold=True)
    y -= 42
    draw_two_column_table(
        c,
        [
            ("행사 날짜", "달력에 표시할 실제 날짜입니다. 하루 또는 여러 날짜를 추가할 수 있습니다."),
            ("일정 안내", "사람이 읽기 쉬운 문장으로 시간, 기간, 휴무 등을 적습니다. 예: 7월 3일 오후 7시-9시"),
            ("정기", "반복 모임이면 체크합니다. 달력에 모든 반복 날짜가 필요하다면 행사 날짜에도 각각 추가합니다."),
            ("신청 마감일", "마감일이 정해져 있을 때만 입력합니다."),
            ("표시 라벨", "신청 중, 신청 마감, 행사 종료, 신규 모집, 상시 운영 중 하나를 선택할 수 있습니다."),
            ("장소 / 참가비", "값이 있을 때만 표시됩니다. 무료이면 '무료'라고 적어도 됩니다."),
            ("신청 방법", "인스타그램 DM, 전화, 문자, 현장 신청처럼 링크가 아닌 신청 방식을 적습니다."),
            ("추가 항목", "대상, 정원, 선정 도서, 준비물 등 소식마다 필요한 정보를 항목명과 내용으로 추가합니다."),
            ("관련 링크", "신청 페이지, 소개 글, SNS 등의 주소를 여러 개 넣을 수 있습니다."),
        ],
        MARGIN,
        y,
        CONTENT_W,
        left_width=106,
    )
    draw_tip(c, "선택 항목은 비워도 됩니다", "내용이 없는 선택 항목은 방문자 화면과 HTML 결과에 빈 줄로 나타나지 않습니다.", MARGIN, 84, CONTENT_W)
    c.showPage()


def page_dates(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "DATES", "날짜와 일정은 이렇게 구분하세요", 8)
    draw_card(c, MARGIN, y, CONTENT_W, 150, fill=WHITE)
    draw_tag(c, "달력용", MARGIN + 18, y - 18, fill=colors.HexColor("#E6ECE7"), color=GREEN)
    draw_para(c, "행사 날짜", MARGIN + 18, y - 52, 150, size=15, bold=True)
    draw_para(
        c,
        "방문자가 달력에서 날짜를 누를 수 있게 만드는 값입니다. 여러 날에 열리는 행사라면 필요한 날짜를 모두 추가합니다.",
        MARGIN + 18,
        y - 82,
        CONTENT_W / 2 - 38,
        size=9.5,
        color=MUTED,
    )
    c.setStrokeColor(LINE)
    c.line(PAGE_W / 2, y - 18, PAGE_W / 2, y - 132)
    draw_tag(c, "설명용", PAGE_W / 2 + 18, y - 18)
    draw_para(c, "일정 안내", PAGE_W / 2 + 18, y - 52, 150, size=15, bold=True)
    draw_para(
        c,
        "시간, 기간, 요일, 휴무처럼 사람이 읽어야 하는 내용을 한 줄로 적습니다. 달력 날짜와 함께 보여주는 설명입니다.",
        PAGE_W / 2 + 18,
        y - 82,
        CONTENT_W / 2 - 38,
        size=9.5,
        color=MUTED,
    )
    y -= 176
    draw_para(c, "작성 예시", MARGIN, y, CONTENT_W, size=13, bold=True)
    y -= 28
    examples = [
        ("하루 행사", "행사 날짜: 2026-07-04<br/>일정 안내: 7월 4일(토) 오후 2시-4시"),
        ("여러 날짜", "행사 날짜: 7월 4일, 7월 11일, 7월 18일<br/>일정 안내: 7월 매주 토요일 오후 2시"),
        ("기간 전시", "행사 날짜: 대표 일정 또는 주요 날짜를 추가<br/>일정 안내: 6월 13일-8월 16일, 월요일과 화요일 휴무"),
        ("날짜 없는 소식", "굿즈 출시나 공간 안내처럼 날짜가 없다면 행사 날짜를 비워도 됩니다."),
    ]
    for title, body in examples:
        draw_card(c, MARGIN, y, CONTENT_W, 70, fill=WHITE)
        draw_para(c, title, MARGIN + 16, y - 15, 100, size=10, color=WARM_DARK, bold=True)
        draw_para(c, body, MARGIN + 120, y - 14, CONTENT_W - 136, size=9, leading=14)
        y -= 80
    c.showPage()


def page_photos(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "PHOTOS", "사진 여러 장 첨부하고 순서 정하기", 9)
    draw_screenshot(c, "06-optional-fields.jpg", MARGIN, y, CONTENT_W, 270)
    y -= 290
    draw_numbered_list(
        c,
        [
            "<b>사진 첨부하기</b>를 눌러 여러 장을 선택하거나, 사진 파일을 점선 영역으로 끌어다 놓습니다.",
            "사진 카드의 번호가 HTML에 들어갈 순서입니다. 사진을 끌거나 좌우 화살표로 순서를 바꿉니다.",
            "사진 설명은 선택입니다. 작품명, 인물, 장소처럼 방문자가 알아야 할 정보가 있을 때 적습니다.",
            "사진 한 장은 <b>20MB 이하</b>를 권장합니다. 업로드가 끝나기 전에 페이지를 닫지 마세요.",
        ],
        MARGIN,
        y,
        CONTENT_W,
        gap=8,
        size=9.2,
    )
    draw_tip(
        c,
        "사진이 어떻게 사용되나요?",
        "원본은 HTML 편집자의 다운로드용으로 보관하고, 방문자 화면에는 빠른 모바일 미리보기 사진이 표시됩니다.",
        MARGIN,
        106,
        CONTENT_W,
    )
    c.showPage()


def page_save_preview(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "SAVE & PREVIEW", "자동 저장, 임시 저장, 미리보기", 10)
    draw_screenshot(c, "07-preview.jpg", MARGIN, y, CONTENT_W, 270)
    y -= 292
    draw_two_column_table(
        c,
        [
            ("자동 저장", "입력 후 잠시 기다리면 자동으로 저장됩니다. 화면의 '자동 저장됨' 또는 '모든 내용이 저장되었습니다' 문구를 확인합니다."),
            ("임시 저장", "사진 업로드 뒤나 페이지를 나가기 전에 지금 즉시 저장하고 싶을 때 누릅니다."),
            ("지난달 불러오기", "지난달 제목과 본문을 복사합니다. 날짜, 일정, 신청 정보, 참가비, 사진은 새 달에 맞게 비워집니다."),
            ("미리보기", "입력 완료 전에도 실제 개별 HTML과 같은 모습으로 확인할 수 있습니다."),
        ],
        MARGIN,
        y,
        CONTENT_W,
        left_width=110,
    )
    draw_tip(
        c,
        "페이지를 나가려 할 때",
        "작성 중 로고, 책방 목록, 로그아웃을 누르면 안내창이 나타납니다. '계속 작성' 또는 '임시 저장 후 나가기'를 선택하세요.",
        MARGIN,
        y - 166,
        CONTENT_W,
    )
    c.showPage()


def page_finish(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "STEP 4", "입력 마무리와 완료 내용 공유", 11)
    draw_screenshot(c, "03-input-dashboard.jpg", MARGIN, y, CONTENT_W, 270)
    y -= 290
    draw_numbered_list(
        c,
        [
            "책방 작성 화면 아래에서 <b>입력 마무리</b>를 누릅니다.",
            "필수 항목이 비어 있으면 해당 입력칸으로 자동 이동합니다. 제목과 상세 내용을 채운 뒤 다시 누릅니다.",
            "목록에서 상태가 <b>입력 완료</b>로 바뀌었는지 확인합니다.",
            "이번 달 책방을 모두 마쳤다면 <b>완료 내용 공유하기</b>를 눌러 복사된 문구를 메신저에 붙여 넣습니다.",
        ],
        MARGIN,
        y,
        CONTENT_W,
        gap=7,
        size=9.2,
    )
    draw_card(c, MARGIN, 128, CONTENT_W, 92, fill=colors.HexColor("#292C2A"), stroke=colors.HexColor("#292C2A"))
    draw_para(c, "메신저 공유 문구 예시", MARGIN + 16, 110, CONTENT_W - 32, size=8.5, color=colors.HexColor("#D5D7D3"), bold=True)
    draw_para(
        c,
        "2026년 7월 동네책방 소식 입력을 완료했습니다.<br/>총 2개 책방, 3가지 소식이 업로드되었습니다.<br/>- 책방 A: 소식 제목 1, 소식 제목 2<br/>- 책방 B: 소식 제목 3",
        MARGIN + 16,
        91,
        CONTENT_W - 32,
        size=8.5,
        color=WHITE,
        leading=13,
    )
    c.showPage()


def page_faq(c: canvas.Canvas) -> None:
    y = draw_page_header(c, "CHECKLIST", "마지막 확인과 자주 묻는 질문", 12)
    draw_para(c, "입력 마무리 전 체크", MARGIN, y, CONTENT_W, size=13, bold=True)
    y -= 28
    checks = [
        "발행 월이 맞나요?",
        "소식 제목과 상세 내용이 모두 있나요?",
        "달력에 보여야 할 날짜를 빠뜨리지 않았나요?",
        "사진이 모두 업로드되고 원하는 순서로 정렬됐나요?",
        "신청 방법, 마감일, 장소, 참가비가 필요한 경우 입력했나요?",
        "작성 내용 미리보기에서 오탈자와 사진 순서를 확인했나요?",
        "입력 마무리 후 목록 상태가 입력 완료로 바뀌었나요?",
    ]
    for item in checks:
        c.setStrokeColor(MUTED)
        c.rect(MARGIN, y - 11, 11, 11, fill=0, stroke=1)
        draw_para(c, item, MARGIN + 20, y, CONTENT_W - 20, size=9.5)
        y -= 25

    y -= 8
    draw_para(c, "자주 묻는 질문", MARGIN, y, CONTENT_W, size=13, bold=True)
    y -= 26
    faqs = [
        ("저장됐는지 모르겠어요.", "화면 상단이나 하단의 저장 상태를 확인하고, 불안하면 임시 저장을 누르세요."),
        ("사진 업로드가 안 돼요.", "한 장이 20MB 이하인지 확인하고, 네트워크 연결 후 다시 시도하세요."),
        ("완료 후 수정할 수 있나요?", "가능합니다. 다만 상태가 작성 중 또는 재게시 필요로 표시될 수 있으므로 다시 입력 마무리를 확인하세요."),
        ("다른 사람이 편집 중이라고 나와요.", "해당 책방에는 들어갈 수 없습니다. 상대방이 나가면 바로, 비정상 종료라면 약 3분 뒤 다시 시도하세요."),
        ("HTML을 몰라도 되나요?", "네. 입력자는 폼 작성과 사진 첨부, 미리보기, 입력 마무리까지만 하면 됩니다."),
    ]
    for question, answer in faqs:
        draw_para(c, f"Q. {question}", MARGIN, y, CONTENT_W, size=9.5, color=WARM_DARK, bold=True)
        answer_h = draw_para(c, f"A. {answer}", MARGIN + 18, y - 19, CONTENT_W - 18, size=8.8, color=MUTED)
        y -= answer_h + 29

    draw_card(c, MARGIN, 111, CONTENT_W, 76, fill=WHITE)
    draw_qr(c, "https://bookstore-news-studio.rlawksml.chatgpt.site/", MARGIN + 12, 44, 54)
    draw_para(c, "서비스 바로가기", MARGIN + 82, 94, CONTENT_W - 94, size=10.5, bold=True)
    draw_para(
        c,
        "https://bookstore-news-studio.rlawksml.chatgpt.site/",
        MARGIN + 82,
        74,
        CONTENT_W - 94,
        size=7.5,
        color=MUTED,
    )
    c.linkURL(
        "https://bookstore-news-studio.rlawksml.chatgpt.site/",
        (MARGIN, 35, PAGE_W - MARGIN, 111),
        relative=0,
    )
    c.showPage()


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("동네책방 소식 입력 사용자 가이드")
    c.setAuthor("지관서가 동네책방 소식 스튜디오")
    page_cover(c)
    page_quick_start(c)
    page_access(c)
    page_dashboard(c)
    page_bookstore(c)
    page_write(c)
    page_fields(c)
    page_dates(c)
    page_photos(c)
    page_save_preview(c)
    page_finish(c)
    page_faq(c)
    c.save()
    PUBLIC_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OUTPUT, PUBLIC_OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()
