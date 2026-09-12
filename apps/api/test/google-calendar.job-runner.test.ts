import { describe, expect, it, mock } from "bun:test";
import { CryptoService } from "../src/crypto/crypto.service.js";
import type { GoogleCalendarConfig } from "../src/google-calendar/google-calendar.config.js";
import { GoogleCalendarJobRunner } from "../src/google-calendar/google-calendar.job-runner.js";
import type { GoogleCalendarRepository } from "../src/google-calendar/google-calendar.repository.js";
import type { GoogleCalendarService } from "../src/google-calendar/google-calendar.service.js";
import { GoogleCalendarJobsController } from "../src/google-calendar/google-calendar-jobs.controller.js";
import type { GoogleCalendarPublicationService } from "../src/google-calendar/google-calendar-publication.service.js";

describe("Calendar worker execution", () => {
  it("awaits durable publication, recovers stale work on every batch, and sanitizes failures", async () => {
    const jobs = [
      {
        id: "job",
        connectionId: "connection",
        jobType: "publish_session",
        payload: {},
      },
    ];
    const repo = {
      recoverStaleJobs: mock(async () => {}),
      enqueueDueRenewals: mock(async () => {}),
      claimNextJob: mock(async () => jobs.shift()),
      completeJob: mock(async () => {}),
      failJob: mock(async () => {}),
    };
    const run = mock(async () => {
      throw new Error("provider secret body");
    });
    const worker = new GoogleCalendarJobRunner(
      { enabled: true, serverless: true } as GoogleCalendarConfig,
      repo as unknown as GoogleCalendarRepository,
      {} as GoogleCalendarService,
      { run } as unknown as GoogleCalendarPublicationService,
    );
    await worker.onModuleInit();
    expect(repo.recoverStaleJobs).not.toHaveBeenCalled();
    expect(await worker.runBatch()).toEqual({ processed: 1 });
    expect(run).toHaveBeenCalledWith("connection", {});
    expect(repo.completeJob).not.toHaveBeenCalled();
    expect(repo.failJob.mock.calls[0]?.[2]).not.toContain("provider secret");
    await worker.runBatch();
    expect(repo.recoverStaleJobs).toHaveBeenCalledTimes(2);
  });

  it("allows overlapping queue batches to claim different durable jobs", async () => {
    const jobs = [
      {
        id: "job-1",
        connectionId: "connection",
        jobType: "publish_session",
        payload: {},
      },
      {
        id: "job-2",
        connectionId: "connection",
        jobType: "publish_session",
        payload: {},
      },
    ];
    const repository = {
      recoverStaleJobs: mock(async () => {}),
      enqueueDueRenewals: mock(async () => {}),
      claimNextJob: mock(async () => jobs.shift()),
      completeJob: mock(async () => {}),
      failJob: mock(async () => {}),
    };
    let release = () => {};
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const run = mock(async () => {
      started += 1;
      if (started === 2) release();
      await bothStarted;
    });
    const worker = new GoogleCalendarJobRunner(
      { enabled: true, serverless: true } as GoogleCalendarConfig,
      repository as unknown as GoogleCalendarRepository,
      {} as GoogleCalendarService,
      { run } as unknown as GoogleCalendarPublicationService,
    );

    const batches = await Promise.all([worker.runBatch(), worker.runBatch()]);

    expect(batches).toEqual([{ processed: 1 }, { processed: 1 }]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(repository.completeJob).toHaveBeenCalledTimes(2);
  });

  it("rejects missing or wrong scheduler credentials before any work", async () => {
    const runBatch = mock(async () => ({ processed: 0 }));
    const controller = new GoogleCalendarJobsController(
      { cronSecret: "test-scheduler-secret" } as GoogleCalendarConfig,
      new CryptoService(),
      { runBatch } as unknown as GoogleCalendarJobRunner,
    );
    expect(() => controller.run()).toThrow("scheduler authorization");
    expect(() => controller.run("Bearer wrong")).toThrow(
      "scheduler authorization",
    );
    expect(runBatch).not.toHaveBeenCalled();
    expect(await controller.run("Bearer test-scheduler-secret")).toEqual({
      processed: 0,
    });
  });
});
