import { describe, expect, it } from "vitest";
import { colombianHolidays, deliverySchedule, formatScheduledDay } from "@/lib/delivery-schedule";

describe("colombianHolidays", () => {
  it("matches the official 2026 calendar", () => {
    expect([...colombianHolidays(2026)].sort()).toEqual([
      "2026-01-01",
      "2026-01-12",
      "2026-03-23",
      "2026-04-02",
      "2026-04-03",
      "2026-05-01",
      "2026-05-18",
      "2026-06-08",
      "2026-06-15",
      "2026-06-29",
      "2026-07-20",
      "2026-08-07",
      "2026-08-17",
      "2026-10-12",
      "2026-11-02",
      "2026-11-16",
      "2026-12-08",
      "2026-12-25",
    ]);
  });
});

describe("deliverySchedule", () => {
  it("keeps an order before 7pm for the same day", () => {
    // Tuesday 13 Oct 2026, 6:59pm in Bogota.
    expect(deliverySchedule("2026-10-13T23:59:00Z")).toEqual({
      scheduledFor: "2026-10-13",
      afterCutoff: false,
      cutoffHour: 19,
    });
  });

  it("moves an order from 7pm on to the next day", () => {
    expect(deliverySchedule("2026-10-14T00:00:00Z")).toEqual({
      scheduledFor: "2026-10-14",
      afterCutoff: true,
      cutoffHour: 19,
    });
  });

  it("cuts off at 2pm on a holiday", () => {
    // Monday 12 Oct 2026 is Día de la Raza.
    expect(deliverySchedule("2026-10-12T18:59:00Z").afterCutoff).toBe(false);
    expect(deliverySchedule("2026-10-12T19:00:00Z")).toEqual({
      scheduledFor: "2026-10-13",
      afterCutoff: true,
      cutoffHour: 14,
    });
  });

  it("uses Bogota's day, not UTC's, right after midnight", () => {
    // 00:30 Wednesday in Bogota: early-morning orders go out that same day.
    expect(deliverySchedule("2026-10-14T05:30:00Z")).toEqual({
      scheduledFor: "2026-10-14",
      afterCutoff: false,
      cutoffHour: 19,
    });
  });
});

describe("formatScheduledDay", () => {
  it("names the day in Spanish", () => {
    expect(formatScheduledDay("2026-10-13")).toBe("martes, 13 de octubre");
  });
});
