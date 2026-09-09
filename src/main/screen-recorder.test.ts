import { describe, expect, it } from "vitest";
import {
  buildAvcDecoderConfigurationRecord,
  convertAnnexBToLengthPrefixed
} from "./screen-recorder";

// 真实形态的最小 Annex-B 片段：起始码 + NAL 头 + 载荷
const SPS = Uint8Array.from([0x67, 0x64, 0x00, 0x28, 0xac, 0xd9]);
const PPS = Uint8Array.from([0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0]);
const ANNEX_B = Uint8Array.from([
  0x00, 0x00, 0x00, 0x01, ...SPS,
  0x00, 0x00, 0x00, 0x01, ...PPS
]);

describe("buildAvcDecoderConfigurationRecord", () => {
  it("wraps SPS/PPS with lengths in avcC layout", () => {
    const record = buildAvcDecoderConfigurationRecord(SPS, PPS);
    expect(record[0]).toBe(0x01);
    expect(record[1]).toBe(0x64); // profile
    expect(record[4]).toBe(0xff); // 4 字节长度前缀
    expect(record[5]).toBe(0xe1); // 1 个 SPS
    expect(record[6]).toBe(0);
    expect(record[7]).toBe(SPS.length);
    expect(Array.from(record.slice(8, 8 + SPS.length))).toEqual([
      ...SPS
    ]);
    const ppsLengthAt = 8 + SPS.length;
    expect(record[ppsLengthAt]).toBe(0x01);
    expect(record[ppsLengthAt + 1]).toBe(0);
    expect(record[ppsLengthAt + 2]).toBe(PPS.length);
    expect(Array.from(record.slice(ppsLengthAt + 3))).toEqual([...PPS]);
  });
});

describe("convertAnnexBToLengthPrefixed", () => {
  it("replaces start codes with 4-byte big-endian lengths", () => {
    const avcc = convertAnnexBToLengthPrefixed(ANNEX_B);
    // 4 字节起始码被 4 字节长度前缀等长替换，总长不变
    expect(avcc.length).toBe(ANNEX_B.length);
    expect(Array.from(avcc.slice(0, 4))).toEqual([
      0, 0, 0, SPS.length
    ]);
    expect(Array.from(avcc.slice(4, 4 + SPS.length))).toEqual([...SPS]);
    expect(Array.from(avcc.slice(4 + SPS.length, 8 + SPS.length))).toEqual([
      0, 0, 0, PPS.length
    ]);
    expect(Array.from(avcc.slice(8 + SPS.length))).toEqual([...PPS]);
  });
});
