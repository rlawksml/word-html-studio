// Only the metadata export command gets a larger pipe. The shared 64KiB
// command runner and every existing offline-app caller remain unchanged.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { OwnedDocker } from "./offline-host-docker.mjs";
import { EXPORT_PACKET_LIMIT, kindForAction } from "./metadata-packet.mjs";

function exportPipe(config, id, args, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve({ code: null, error: false, limited: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }); return; }
    const stdout = [], stderr = [];
    let bytes = 0, limited = false, error = false, child;
    const stop = () => {
      limited = true;
      if (child?.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* close decides */ } }
    };
    try {
      child = spawn("/usr/bin/docker", ["--config", config, "container", "exec", id, "/usr/bin/env", ...args], {
        env: { PATH: "/usr/bin:/bin" }, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch { resolve({ code: null, error: true, limited: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }); return; }
    const timer = setTimeout(stop, 15_000);
    signal?.addEventListener("abort", stop, { once: true });
    const collect = (target) => (part) => {
      bytes += part.length;
      if (bytes > EXPORT_PACKET_LIMIT) { stop(); return; }
      target.push(part);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", () => { error = true; });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve({ code, signal: exitSignal, error, limited, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}
export class MetadataDocker extends OwnedDocker {
  async exportManifest(action) {
    kindForAction(action); // exact enum; no path/command supplied by a packet
    assert.ok(this.prepSealed && this.prepRemoved);
    assert.ok(await this.absentContainer(this.containers.get("prep").id));
    await this.inspectVolume();
    const value = await this.inspect("app");
    assert.ok(value.State.Running && !value.State.OOMKilled);
    const args = this.argv("app");
    args[args.length - 2] = action;
    return exportPipe(this.config, value.Id, args, this.abortSignal);
  }
}
