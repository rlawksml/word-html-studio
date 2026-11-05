// Audit-only prep profile: no volume/bind mounts; /scratch is the sole RW
// data tmpfs. Shared exact ownership, bounded control and cleanup stay intact.
import assert from "node:assert/strict";
import { LABEL } from "./offline-baseline.mjs";
import { OwnedDocker } from "./offline-host-docker.mjs";

const ID = /^[a-f0-9]{64}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const TMPFS = Object.freeze({
  "/scratch": "rw,nosuid,nodev,size=512m,uid=65534,gid=65534,mode=0700",
  "/dev/shm": "ro,noexec,nosuid,nodev,size=4096,mode=000",
  "/dev/pts": "ro,noexec,nosuid,nodev,size=4096,mode=000",
  "/dev/mqueue": "ro,noexec,nosuid,nodev,size=4096,mode=000",
});

export class AuditDocker extends OwnedDocker {
  async sealedStatus() {
    assert.equal(this.prepSealed, true);
    const value = await this.inspect("prep");
    assert.ok(value.State.Running && !value.State.OOMKilled);
    const args = this.argv("prep");
    args[args.length - 2] = "sealed-status";
    return this.command(["container", "exec", value.Id, "/usr/bin/env", ...args]);
  }

  async create(role, image) {
    assert.equal(role, "prep");
    assert.ok(IMAGE.test(image) && !this.containers.has(role));
    assert.equal(this.volumeAttempted, false);
    const entry = { name: `bookstore-offline-prep-${this.nonce}`, role, image, id: null, attempted: false };
    this.containers.set(role, entry);
    assert.ok(await this.absentContainer(entry.name));
    entry.attempted = true;
    const id = await this.output(["container", "create", "--pull=never", "--network=bridge",
      "--ipc=none", "--cgroupns=private", "--read-only", "--user=65534:65534", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--memory=3g", "--memory-swap=3g", "--cpus=2", "--pids-limit=128",
      "--ulimit=cpu=180:180", "--ulimit=fsize=268435456:268435456", "--ulimit=nofile=512:512", "--ulimit=core=0:0",
      ...Object.entries(TMPFS).map(([path, flags]) => `--tmpfs=${path}:${flags}`),
      "--log-driver=none", "--name", entry.name, "--label", `${LABEL}=${this.nonce}`, image, ...this.argv(role)], "CONTAINER_CREATION_UNCONFIRMED");
    assert.match(id, ID);
    entry.id = id;
    await this.inspect(role);
    return id;
  }

  async inspect(role) {
    assert.equal(role, "prep");
    assert.equal(this.volumeAttempted, false);
    const value = await this.owned(role); // inherited exact ID/name/nonce/image
    assert.equal(value.Config.User, "65534:65534");
    assert.deepEqual(value.Config.Entrypoint, ["/usr/bin/env"]);
    assert.deepEqual(value.Config.Cmd, this.argv(role));
    const config = value.HostConfig;
    assert.ok(config.ReadonlyRootfs && !config.Privileged && !config.PublishAllPorts);
    assert.ok(!config.Binds?.length && !config.Devices?.length && !config.CapAdd?.length && !Object.keys(config.PortBindings ?? {}).length);
    assert.deepEqual(config.CapDrop, ["ALL"]);
    assert.deepEqual(config.SecurityOpt, ["no-new-privileges"]);
    assert.equal(config.LogConfig.Type, "none");
    assert.equal(config.NetworkMode, "bridge");
    if (value.State.Running) assert.deepEqual(Object.keys(value.NetworkSettings.Networks).sort(), this.prepSealed ? [] : ["bridge"]);
    assert.equal(config.IpcMode, "none");
    assert.equal(config.CgroupnsMode, "private");
    assert.equal(config.Memory, 3 * 1024 ** 3);
    assert.equal(config.MemorySwap, config.Memory);
    assert.equal(config.NanoCpus, 2e9);
    assert.equal(config.PidsLimit, 128);
    assert.deepEqual(config.Tmpfs, TMPFS);
    // Docker may omit its empty Mounts API field; neither null nor [] permits
    // any explicit mount. The effective list may contain only fixed tmpfs.
    assert.deepEqual(config.Mounts ?? [], []);
    assert.ok(Array.isArray(value.Mounts));
    const seen = new Set();
    for (const mount of value.Mounts) {
      assert.equal(mount.Type, "tmpfs");
      assert.ok(Object.hasOwn(TMPFS, mount.Destination) && !seen.has(mount.Destination));
      assert.equal(mount.RW, mount.Destination === "/scratch");
      seen.add(mount.Destination);
    }
    assert.deepEqual(config.Ulimits.map(({ Name, Soft, Hard }) => [Name, Soft, Hard]).sort(),
      [["core", 0, 0], ["cpu", 180, 180], ["fsize", 268435456, 268435456], ["nofile", 512, 512]].sort());
    return value;
  }
}
