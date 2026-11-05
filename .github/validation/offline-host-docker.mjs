// Exact-owned Docker lifecycle only. No prune, host mounts, socket or remote image.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { APP_ENV, LABEL, PREP_ENV, VOLUME_OPTIONS } from "./offline-baseline.mjs";
import { bounded, fixedError, requireSuccess } from "./offline-host-support.mjs";

const ID = /^[a-f0-9]{64}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
export class OwnedDocker {
  constructor(scratch, nonce) {
    assert.match(nonce, /^[a-f0-9]{32}$/);
    this.nonce = nonce;
    this.config = `${scratch}/docker-config`;
    mkdirSync(this.config, { mode: 0o700 });
    this.volume = `bookstore-offline-deps-${nonce}`;
    this.volumeAttempted = false;
    this.containers = new Map();
    this.prepRemoved = false;
    this.prepSealed = false;
  }
  async command(args, ms = 10_000) {
    return bounded("/usr/bin/docker", ["--config", this.config, ...args], {
      env: { PATH: "/usr/bin:/bin" }, ms: this.cleaning ? Math.min(ms, 5000) : ms,
      signal: this.cleaning ? undefined : this.abortSignal,
    });
  }
  async output(args, code, ms) { return requireSuccess(await this.command(args, ms), code).trim(); }
  async requireLimits() {
    assert.equal(await this.output(["info", "--format", "{{.MemoryLimit}} {{.SwapLimit}} {{.CPUCfsQuota}} {{.PidsLimit}}"], "DAEMON_LIMITS_UNCONFIRMED"), "true true true true");
  }
  async volumeAbsent() {
    return (await this.output(["volume", "ls", "--filter", `name=${this.volume}`, "--format", "{{.Name}}"], "VOLUME_ABSENCE_UNCONFIRMED")) === "";
  }
  async inspectVolume() {
    const value = JSON.parse(await this.output(["volume", "inspect", "--format", "{{json .}}", this.volume], "VOLUME_INSPECTION_UNCONFIRMED"));
    assert.equal(value.Name, this.volume);
    assert.equal(value.Driver, "local");
    assert.equal(value.Scope, "local");
    assert.equal(value.Labels?.[LABEL], this.nonce);
    assert.deepEqual(value.Options, VOLUME_OPTIONS);
    return value;
  }
  async createVolume() {
    assert.ok(await this.volumeAbsent()); // `volume create` silently reuses names!
    this.volumeAttempted = true;
    const name = await this.output(["volume", "create", "--driver", "local", "--label", `${LABEL}=${this.nonce}`,
      ...Object.entries(VOLUME_OPTIONS).flatMap(([key, value]) => ["--opt", `${key}=${value}`]), this.volume], "VOLUME_CREATION_UNCONFIRMED");
    assert.equal(name, this.volume);
    await this.inspectVolume();
  }
  async build(context) {
    const output = await this.output(["build", "--network=none", "--pull=false", "--quiet", "--label", `${LABEL}=${this.nonce}`, context], "IMAGE_BUILD_FAILED_OR_LIMITED", 60_000);
    console.log(`OFFLINE_IMAGE_ID_FORMAT matched=${ID.test(output) || IMAGE.test(output) ? 1 : 0} sha256Prefix=${IMAGE.test(output) ? 1 : 0}`);
    assert.match(output, IMAGE);
    const value = JSON.parse(await this.output(["image", "inspect", "--format", "{{json .}}", output], "IMAGE_INSPECTION_UNCONFIRMED"));
    // Fixed boolean/count metadata only; never echo image IDs, environment
    // values, paths, labels, daemon JSON or raw build output.
    const imageFlags = {
      identity: value.Id === output, owned: value.Config.Labels?.[LABEL] === this.nonce,
      user: value.Config.User === "65534:65534",
      entrypoint: JSON.stringify(value.Config.Entrypoint) === JSON.stringify(["/usr/bin/env"]),
      volumesAbsent: !value.Config.Volumes,
      envAbsent: !value.Config.Env || value.Config.Env.length === 0,
      envCount: Array.isArray(value.Config.Env) ? value.Config.Env.length : -1,
      dockerDefaultPath: JSON.stringify(value.Config.Env) === JSON.stringify(["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"]),
    };
    assert.ok(Number.isSafeInteger(imageFlags.envCount) && imageFlags.envCount >= -1 && imageFlags.envCount <= 100);
    console.log(`OFFLINE_IMAGE_FLAGS ${JSON.stringify(imageFlags)}`);
    assert.equal(value.Id, output);
    assert.equal(value.Config.Labels?.[LABEL], this.nonce);
    assert.equal(value.Config.User, "65534:65534");
    assert.deepEqual(value.Config.Entrypoint, ["/usr/bin/env"]);
    assert.ok(!value.Config.Volumes);
    // Observed Docker build injects exactly its fixed default PATH. Accept no
    // other image env. Entrypoint env -i still erases this before PID1/exec;
    // each launcher separately enforces the exact effective allowlist.
    assert.ok(imageFlags.envAbsent || imageFlags.dockerDefaultPath);
    return output;
  }
  async absentContainer(selector) {
    assert.ok(ID.test(selector) || [...this.containers.values()].some((entry) => entry.name === selector));
    const filter = ID.test(selector) ? `id=${selector}` : `name=${selector}`;
    return (await this.output(["container", "ls", "--all", "--no-trunc", "--filter", filter, "--format", "{{.ID}}"], "CONTAINER_ABSENCE_UNCONFIRMED")) === "";
  }
  argv(role) {
    const prep = role === "prep";
    const env = prep ? PREP_ENV : APP_ENV;
    return ["-i", ...Object.entries(env).map(([key, value]) => `${key}=${value}`), "/usr/bin/node",
      prep ? "/trusted/offline-prep-launcher.mjs" : "/trusted/offline-app-launcher.mjs", prep ? "prepare" : "idle", this.nonce];
  }
  async create(role, image) {
    assert.ok(["prep", "app"].includes(role) && IMAGE.test(image) && !this.containers.has(role));
    const prep = role === "prep";
    const entry = { name: `bookstore-offline-${role}-${this.nonce}`, role, image, id: null, attempted: false };
    this.containers.set(role, entry);
    assert.ok(await this.absentContainer(entry.name));
    entry.attempted = true;
    const memory = prep ? "3g" : "2g";
    const id = await this.output(["container", "create", "--pull=never", `--network=${prep ? "bridge" : "none"}`,
      "--ipc=none", "--cgroupns=private", "--read-only", "--user=65534:65534", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      `--memory=${memory}`, `--memory-swap=${memory}`, "--cpus=2", "--pids-limit=128",
      "--ulimit=cpu=180:180", "--ulimit=fsize=268435456:268435456", "--ulimit=nofile=512:512", "--ulimit=core=0:0",
      "--tmpfs=/scratch:rw,nosuid,nodev,size=512m,uid=65534,gid=65534,mode=0700",
      ...["/dev/shm", "/dev/pts", "/dev/mqueue"].map((path) => `--tmpfs=${path}:ro,noexec,nosuid,nodev,size=4096,mode=000`),
      "--log-driver=none", "--mount", `type=volume,source=${this.volume},destination=/toolchain,volume-nocopy${prep ? "" : ",readonly"}`,
      "--name", entry.name, "--label", `${LABEL}=${this.nonce}`, image, ...this.argv(role)], "CONTAINER_CREATION_UNCONFIRMED");
    assert.match(id, ID);
    entry.id = id;
    await this.inspect(role);
    return id;
  }
  async owned(role) {
    const entry = this.containers.get(role);
    assert.ok(entry?.attempted);
    const value = JSON.parse(await this.output(["container", "inspect", "--format", "{{json .}}", entry.id ?? entry.name], "CONTAINER_INSPECTION_UNCONFIRMED"));
    assert.match(value.Id, ID);
    if (entry.id) assert.equal(value.Id, entry.id);
    assert.equal(value.Name, `/${entry.name}`);
    assert.equal(value.Config.Labels?.[LABEL], this.nonce);
    assert.equal(value.Image, entry.image);
    entry.id = value.Id;
    return value;
  }
  async inspect(role) {
    const value = await this.owned(role);
    assert.equal(value.Config.User, "65534:65534");
    assert.deepEqual(value.Config.Entrypoint, ["/usr/bin/env"]);
    assert.deepEqual(value.Config.Cmd, this.argv(role));
    const config = value.HostConfig;
    assert.ok(config.ReadonlyRootfs && !config.Privileged && !config.PublishAllPorts);
    assert.ok(!config.Binds?.length && !config.Devices?.length && !config.CapAdd?.length && !Object.keys(config.PortBindings ?? {}).length);
    assert.deepEqual(config.CapDrop, ["ALL"]);
    assert.deepEqual(config.SecurityOpt, ["no-new-privileges"]);
    assert.equal(config.LogConfig.Type, "none");
    assert.equal(config.NetworkMode, role === "prep" ? "bridge" : "none");
    if (role === "prep" && value.State.Running) {
      assert.deepEqual(Object.keys(value.NetworkSettings.Networks).sort(), this.prepSealed ? [] : ["bridge"]);
    }
    assert.equal(config.IpcMode, "none");
    assert.equal(config.CgroupnsMode, "private");
    assert.equal(config.Memory, (role === "prep" ? 3 : 2) * 1024 ** 3);
    assert.equal(config.MemorySwap, config.Memory);
    assert.equal(config.NanoCpus, 2e9);
    assert.equal(config.PidsLimit, 128);
    assert.deepEqual(config.Tmpfs, {
      "/scratch": "rw,nosuid,nodev,size=512m,uid=65534,gid=65534,mode=0700",
      "/dev/shm": "ro,noexec,nosuid,nodev,size=4096,mode=000",
      "/dev/pts": "ro,noexec,nosuid,nodev,size=4096,mode=000",
      "/dev/mqueue": "ro,noexec,nosuid,nodev,size=4096,mode=000",
    });
    assert.equal(config.Mounts.length, 1);
    const specification = config.Mounts[0];
    assert.equal(specification.Type, "volume");
    assert.equal(specification.Source, this.volume);
    assert.equal(specification.Target, "/toolchain");
    assert.equal(Boolean(specification.ReadOnly), role === "app");
    assert.equal(specification.VolumeOptions?.NoCopy, true);
    assert.deepEqual(config.Ulimits.map(({ Name, Soft, Hard }) => [Name, Soft, Hard]).sort(),
      [["core", 0, 0], ["cpu", 180, 180], ["fsize", 268435456, 268435456], ["nofile", 512, 512]].sort());
    const volumes = value.Mounts.filter((mount) => mount.Type === "volume");
    assert.equal(volumes.length, 1);
    assert.ok(value.Mounts.every((mount) => mount.Type === "volume"
      || (mount.Type === "tmpfs" && Object.hasOwn(config.Tmpfs, mount.Destination))));
    const mount = volumes[0];
    assert.equal(mount.Type, "volume");
    assert.equal(mount.Name, this.volume);
    assert.equal(mount.Driver, "local");
    assert.equal(mount.Destination, "/toolchain");
    assert.equal(mount.RW, role === "prep");
    return value;
  }
  async start(role) {
    const value = await this.inspect(role);
    assert.ok(!value.State.Running);
    assert.equal(await this.output(["container", "start", value.Id], "CONTAINER_START_UNCONFIRMED"), value.Id);
    const after = await this.inspect(role);
    assert.ok(after.State.Running && !after.State.OOMKilled);
  }
  async exec(role, action, ms = 10_000) {
    assert.ok(role === "prep" ? action === "status" : ["status", "run"].includes(action));
    if (action === "run") assert.ok(this.prepSealed && this.prepRemoved && await this.absentContainer(this.containers.get("prep").id));
    const value = await this.inspect(role);
    assert.ok(value.State.Running && !value.State.OOMKilled);
    const args = this.argv(role);
    args[args.length - 2] = action;
    return this.command(["container", "exec", value.Id, "/usr/bin/env", ...args], ms);
  }
  async sealPrepNetwork() {
    assert.equal(this.prepSealed, false);
    const prep = await this.inspect("prep");
    assert.ok(prep.State.Running && !prep.State.OOMKilled);
    // Keep PID1 and its tmpfs mount alive, but remove the prep-only exception
    // as soon as npm is done. Never disconnect an unowned container/network.
    assert.equal(await this.output(["network", "disconnect", "bridge", prep.Id], "PREP_NETWORK_DISCONNECT_UNCONFIRMED"), "");
    this.prepSealed = true;
    await this.inspect("prep");
  }
  async remove(role) {
    const entry = this.containers.get(role);
    if (!entry?.attempted) return;
    if (await this.absentContainer(entry.id ?? entry.name)) return;
    // Cleanup needs identity, not successful resource preflight. If a daemon
    // control assertion failed, we still remove ONLY this exact owned object.
    const value = await this.owned(role); // exact ID + nonce + name + image
    // Force stops/removes only this confirmed owned container, never by filter.
    assert.equal(await this.output(["container", "rm", "--force", value.Id], "OWNED_CONTAINER_REMOVE_UNCONFIRMED"), value.Id);
    assert.ok(await this.absentContainer(value.Id));
    if (role === "prep") this.prepRemoved = true;
  }
  async cleanup() {
    this.cleaning = true; // cancellation must not cancel exact-owned cleanup
    const failures = [];
    for (const role of ["app", "prep"]) {
      try { await this.remove(role); } catch { failures.push("OWNED_CONTAINER_CLEANUP_UNCONFIRMED"); }
    }
    if (this.volumeAttempted) {
      try {
        if (!(await this.volumeAbsent())) {
          await this.inspectVolume();
          const consumers = await this.output(["container", "ls", "--all", "--no-trunc", "--filter", `volume=${this.volume}`, "--format", "{{.ID}}"], "VOLUME_CONSUMERS_UNCONFIRMED");
          assert.equal(consumers, "");
          assert.equal(await this.output(["volume", "rm", this.volume], "OWNED_VOLUME_REMOVE_UNCONFIRMED"), this.volume);
          assert.ok(await this.volumeAbsent());
        }
      } catch { failures.push("OWNED_VOLUME_CLEANUP_UNCONFIRMED"); }
    }
    if (failures.length) throw fixedError("EXACT_OWNED_CLEANUP_UNCONFIRMED");
  }
}
