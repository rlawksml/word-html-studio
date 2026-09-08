import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalizeAccessCode,
  accessCodesMatch,
} from "../lib/access-code-normalization.mjs";

test("한글·영문 자판으로 입력한 같은 키 조합을 동일하게 판정한다", () => {
  assert.equal(canonicalizeAccessCode("dkssud"), canonicalizeAccessCode("안녕"));
  assert.equal(accessCodesMatch("dkssud", "안녕"), true);
  assert.equal(accessCodesMatch("  안녕  ", "dkssud"), true);
});

test("겹받침·복합 모음·쌍자음의 실제 두벌식 키 조합을 보존한다", () => {
  assert.equal(canonicalizeAccessCode("값왜까"), "rkqtdhoRk");
  assert.equal(accessCodesMatch("rkqtdhoRk", "값왜까"), true);
});

test("다른 암호와 영문 대소문자는 계속 구분한다", () => {
  assert.equal(accessCodesMatch("dkssud", "안녕하세요"), false);
  assert.equal(accessCodesMatch("DKSSUD", "안녕"), false);
  assert.equal(accessCodesMatch("", ""), false);
});

test("서버 인증 경계에서만 자판 정규화를 사용하고 실제 암호를 포함하지 않는다", async () => {
  const serverLibrary = await readFile(new URL("../lib/supabase-server.ts", import.meta.url), "utf8");
  assert.match(serverLibrary, /canonicalizeAccessCode/);
  assert.doesNotMatch(serverLibrary, /wlrhkstjrk|지관서가/);
});
