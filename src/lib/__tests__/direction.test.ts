import { describe, it, expect } from "vitest";
import { computeDirection, sentimentFor, describeDirection, DIRECTION_ARROW } from "../direction";

describe("computeDirection", () => {
  it("is up when current > prior", () => {
    expect(computeDirection(11.08, 11.04)).toBe("up");
  });

  it("is down when current < prior", () => {
    expect(computeDirection(11.04, 11.08)).toBe("down");
  });

  it("is flat when current equals prior", () => {
    expect(computeDirection(14.0, 14.0)).toBe("flat");
  });

  it("never disagrees with the arithmetic sign — arrow always matches the numeric movement", () => {
    for (const [current, prior] of [[100, 99], [99, 100], [0.001, 0], [-5, -3], [-3, -5]]) {
      const direction = computeDirection(current, prior);
      const diff = current - prior;
      if (diff > 0) expect(direction).toBe("up");
      if (diff < 0) expect(direction).toBe("down");
      if (diff === 0) expect(direction).toBe("flat");
    }
  });
});

describe("sentimentFor", () => {
  it("higherIsPositive: up is positive, down is negative (e.g. an equity index)", () => {
    expect(sentimentFor("up", "higherIsPositive")).toBe("positive");
    expect(sentimentFor("down", "higherIsPositive")).toBe("negative");
  });

  it("higherIsNegative: up is negative, down is positive (e.g. inflation, USD/GHS)", () => {
    expect(sentimentFor("up", "higherIsNegative")).toBe("negative");
    expect(sentimentFor("down", "higherIsNegative")).toBe("positive");
  });

  it("neutral polarity is always neutral regardless of direction (e.g. Treasury yields, policy rate)", () => {
    expect(sentimentFor("up", "neutral")).toBe("neutral");
    expect(sentimentFor("down", "neutral")).toBe("neutral");
  });

  it("flat is always neutral regardless of polarity", () => {
    expect(sentimentFor("flat", "higherIsPositive")).toBe("neutral");
    expect(sentimentFor("flat", "higherIsNegative")).toBe("neutral");
  });
});

describe("describeDirection", () => {
  it("USD/GHS rising is presented as negative (cedi weakened)", () => {
    const result = describeDirection(11.08, 11.04, "higherIsNegative");
    expect(result.direction).toBe("up");
    expect(result.sentiment).toBe("negative");
    expect(result.arrow).toBe("▲");
  });

  it("USD/GHS falling is presented as positive (cedi strengthened)", () => {
    const result = describeDirection(11.0, 11.08, "higherIsNegative");
    expect(result.direction).toBe("down");
    expect(result.sentiment).toBe("positive");
    expect(result.arrow).toBe("▼");
  });

  it("inflation rising is negative, falling is positive", () => {
    expect(describeDirection(5.0, 4.6, "higherIsNegative").sentiment).toBe("negative");
    expect(describeDirection(4.6, 5.3, "higherIsNegative").sentiment).toBe("positive");
  });

  it("Treasury/policy-rate movements are always neutral, in both directions", () => {
    expect(describeDirection(5.47, 5.63, "neutral").sentiment).toBe("neutral");
    expect(describeDirection(5.63, 5.47, "neutral").sentiment).toBe("neutral");
  });

  it("respects an epsilon for 'no meaningful change'", () => {
    const result = describeDirection(11.0001, 11.0, "higherIsNegative", 0.01);
    expect(result.direction).toBe("flat");
    expect(result.sentiment).toBe("neutral");
    expect(result.arrow).toBe(DIRECTION_ARROW.flat);
  });
});
