import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventAutosave } from "../src/lib/eventAutosave";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const write = vi.fn<(id: string | null, snapshot: { name: string; lists?: unknown }) => Promise<{ id: string }>>()
    .mockResolvedValue({ id: "A" });
  const onState = vi.fn();
  const onId = vi.fn();
  const onError = vi.fn();
  const queue = createEventAutosave({ write, onState, onId, onError });
  return { queue, write, onState, onId, onError };
}
describe("event autosave recovery and isolation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries on subsequent editing after a failed write", async () => {
    const { queue, write, onState } = setup();
    write.mockRejectedValueOnce(new Error("offline"));
    queue.schedule({ name: "old" }, "A", () => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onState).toHaveBeenLastCalledWith("error");
    queue.schedule({ name: "edited" }, "A", () => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenLastCalledWith("A", { name: "edited" });
    expect(onState).toHaveBeenLastCalledWith("saved");
  });

  it.each(["online", "explicit Retry"])("recovers the failed latest snapshot via %s without more edits", async () => {
    const { queue, write, onState } = setup();
    const snapshot = { name: "latest", lists: { selections: { "warmUp:0:old-key": { paths: ["Music/song.mp3"], excluded: true } } } };
    write.mockRejectedValueOnce(new Error("offline"));
    queue.schedule(snapshot, "A", () => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    // Both the online listener and the Retry button invoke this same recovery API.
    queue.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenLastCalledWith("A", snapshot);
    expect(write).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith("saved");
    queue.retry();
    await vi.advanceTimersByTimeAsync(10000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("serializes in-flight writes and coalesces edits; stale success cannot mark newer edits saved", async () => {
    const { queue, write, onState } = setup();
    const first = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    queue.schedule({ name: "v1" }, "A", () => true);
    await vi.advanceTimersByTimeAsync(1000);
    queue.schedule({ name: "v2" }, "A", () => true);
    queue.schedule({ name: "v3" }, "A", () => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve({ id: "A" });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("A", { name: "v3" });
    expect(onState.mock.calls.flat()).not.toContain("saved");
    second.resolve({ id: "A" });
    await vi.advanceTimersByTimeAsync(0);
    expect(onState).toHaveBeenLastCalledWith("saved");
  });

  it("ignores a superseded failure and saves the newest edit", async () => {
    const { queue, write, onError, onState } = setup();
    const first = deferred<{ id: string }>();
    write.mockReturnValueOnce(first.promise);
    queue.schedule({ name: "old" }, "A", () => true);
    await vi.advanceTimersByTimeAsync(1000);
    queue.schedule({ name: "new" }, "A", () => true);
    await vi.advanceTimersByTimeAsync(1000);
    first.reject(new Error("network"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).not.toHaveBeenCalled();
    expect(write).toHaveBeenLastCalledWith("A", { name: "new" });
    expect(onState).toHaveBeenLastCalledWith("saved");
  });

  it.each(["success", "failure"])("switching events ignores stale %s and never carries retry work into B", async outcome => {
    const { queue, write, onId, onError } = setup();
    const first = deferred<{ id: string }>();
    write.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ id: "B" });
    let active = "A";
    queue.schedule({ name: "A edit" }, "A", () => active === "A");
    await vi.advanceTimersByTimeAsync(1000);
    queue.schedule({ name: "A queued" }, "A", () => active === "A");
    active = "B";
    queue.reset();
    queue.retry();
    queue.schedule({ name: "B edit" }, "B", () => active === "B");
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    if (outcome === "success") first.resolve({ id: "A" });
    else first.reject(new Error("stale failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("B", { name: "B edit" });
    expect(onId.mock.calls).toEqual([["B"]]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("invalidates a scheduled save immediately when the route changes before reset runs", async () => {
    const { queue, write } = setup();
    let active = "A";
    queue.schedule({ name: "A" }, "A", () => active === "A");
    active = "B";
    await vi.advanceTimersByTimeAsync(1000);
    queue.retry();
    expect(write).not.toHaveBeenCalled();
  });

  it("drops timers and failed pending snapshots on reset/unmount", async () => {
    const { queue, write } = setup();
    write.mockRejectedValueOnce(new Error("offline"));
    queue.schedule({ name: "A" }, "A", () => true);
    await vi.advanceTimersByTimeAsync(1000);
    queue.reset();
    queue.retry();
    queue.schedule({ name: "B" }, "B", () => true);
    queue.reset();
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("uses the newly created ID for edits queued during the initial save", async () => {
    const { queue, write } = setup();
    const first = deferred<{ id: string }>();
    write.mockReturnValueOnce(first.promise);
    queue.schedule({ name: "new event" }, null, () => true);
    await vi.advanceTimersByTimeAsync(1000);
    queue.schedule({ name: "edited while creating" }, null, () => true);
    await vi.advanceTimersByTimeAsync(1000);
    first.resolve({ id: "created" });
    await vi.advanceTimersByTimeAsync(0);
    expect(write.mock.calls[0][0]).toBeNull();
    expect(write).toHaveBeenLastCalledWith("created", { name: "edited while creating" });
  });
});