/**
 * mv-protection-curves.test.ts — vitest suite for the MV protection curve core.
 * Mirrors the Python reference test plan; asserts identical numbers.
 *
 * Run inside the monorepo:  pnpm --filter @esite/shared test
 */
import { describe, it, expect } from "vitest";
import {
  IEC_CONSTANTS,
  IEEE_CONSTANTS,
  iecTime,
  ieeeTime,
  thermalTime,
  solveIecTms,
  solveIeeeTd,
  snapToStep,
  gradeVerdict,
  achievedMargin,
  CurveError,
  type IecCurve,
  type IeeeCurve,
} from "./mv-protection-curves";

const iecRef = (k: number, a: number, M: number, tms: number) =>
  (tms * k) / (Math.pow(M, a) - 1);
const ieeeRef = (A: number, B: number, p: number, M: number, td: number) =>
  td * (A / (Math.pow(M, p) - 1) + B);

describe("IEC 60255 closed-form anchors", () => {
  for (const curve of Object.keys(IEC_CONSTANTS) as IecCurve[]) {
    const { k, alpha } = IEC_CONSTANTS[curve];
    for (const M of [1.5, 2, 5, 10, 20]) {
      for (const tms of [0.1, 0.5, 1]) {
        it(`${curve} M=${M} TMS=${tms}`, () => {
          expect(iecTime(curve, M, tms)).toBeCloseTo(iecRef(k, alpha, M, tms), 9);
        });
      }
    }
  }
  it("textbook values @ M=2, TMS=1", () => {
    expect(iecTime("SI", 2, 1)).toBeCloseTo(10.0287, 3);
    expect(iecTime("VI", 2, 1)).toBeCloseTo(13.5, 6);
    expect(iecTime("EI", 2, 1)).toBeCloseTo(26.6667, 3);
    expect(iecTime("LTI", 2, 1)).toBeCloseTo(120, 6);
  });
});

describe("IEEE C37.112 closed-form anchors", () => {
  for (const curve of Object.keys(IEEE_CONSTANTS) as IeeeCurve[]) {
    const { A, B, p } = IEEE_CONSTANTS[curve];
    for (const M of [1.5, 2, 5, 10, 20]) {
      for (const td of [0.5, 1, 5]) {
        it(`${curve} M=${M} TD=${td}`, () => {
          expect(ieeeTime(curve, M, td)).toBeCloseTo(ieeeRef(A, B, p, M, td), 9);
        });
      }
    }
  }
});

describe("monotonicity & physicality", () => {
  for (const curve of Object.keys(IEC_CONSTANTS) as IecCurve[]) {
    it(`IEC ${curve} decreases with M`, () => {
      const t = [1.5, 2, 5, 10, 20].map((M) => iecTime(curve, M, 1));
      for (let i = 0; i < t.length - 1; i++) expect(t[i]).toBeGreaterThan(t[i + 1]);
    });
  }
  for (const badM of [1, 0.9, 0.5]) {
    it(`blocked at M=${badM}`, () => {
      expect(() => iecTime("SI", badM, 1)).toThrow(CurveError);
    });
  }
});

describe("linearity in TMS/TD", () => {
  it("IEC linear in TMS", () =>
    expect(iecTime("SI", 5, 2)).toBeCloseTo(2 * iecTime("SI", 5, 1), 9));
  it("IEEE linear in TD", () =>
    expect(ieeeTime("VI", 5, 4)).toBeCloseTo(4 * ieeeTime("VI", 5, 1), 9));
});

describe("solver inverse property", () => {
  for (const curve of Object.keys(IEC_CONSTANTS) as IecCurve[]) {
    for (const M of [2, 5, 12]) {
      it(`IEC round-trip ${curve} M=${M}`, () => {
        const tms = solveIecTms(curve, M, 0.6);
        expect(iecTime(curve, M, tms)).toBeCloseTo(0.6, 9);
      });
    }
  }
  for (const curve of Object.keys(IEEE_CONSTANTS) as IeeeCurve[]) {
    for (const M of [2, 5, 12]) {
      it(`IEEE round-trip ${curve} M=${M}`, () => {
        const td = solveIeeeTd(curve, M, 0.6);
        expect(ieeeTime(curve, M, td)).toBeCloseTo(0.6, 9);
      });
    }
  }
});

describe("snapToStep never erodes below raw", () => {
  for (const raw of [0.123, 0.2001, 0.55, 1.337]) {
    it(`snap ${raw}`, () => {
      const s = snapToStep(raw, 0.01, 0.02, 2.0);
      expect(s).toBeGreaterThanOrEqual(raw - 1e-9);
    });
  }
});

describe("grading round-trip (worked example)", () => {
  it("achieves >= 0.3 s margin after snapping", () => {
    const tDown = iecTime("SI", 2000 / 100, 0.1); // downstream Is=100A, TMS=0.1
    const Mup = 2000 / 300; // upstream Is=300A
    const tmsUp = snapToStep(solveIecTms("SI", Mup, tDown + 0.3), 0.01, 0.02, 2.0);
    const tUp = iecTime("SI", Mup, tmsUp);
    const pair = { gradingCurrentA: 2000, downstreamTimeS: tDown, upstreamTimeS: tUp };
    expect(achievedMargin(pair)).toBeGreaterThanOrEqual(0.3);
    expect(gradeVerdict(pair, 0.3)).toBe("ok");
  });
});

describe("thermal model", () => {
  it("trips faster at higher current", () =>
    expect(thermalTime(600, 4, 1)).toBeLessThan(thermalTime(600, 2, 1)));
  it("blocks below threshold", () =>
    expect(() => thermalTime(600, 1, 1)).toThrow(CurveError));
});
