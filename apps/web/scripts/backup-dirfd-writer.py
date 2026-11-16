"""POSIX-only writer for a newly owned backup root; no SDK, keys or network."""
import hashlib
import json
import os
import stat
import sys
import time

MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 4 * 1024 * 1024 * 1024
MAX_FILES = 10000
MAX_DIRECTORIES = 10000
MAX_DEPTH = 16
MAX_HEADER = 8192
MAX_ACK = 2048
WALL_SECONDS = 15 * 60
PREFIX = b"backup-writer-ledger-v1\n"
MARKER = b"Backup did not finish. Do not restore it.\n"
CORE = {"database/" + name + ".json" for name in (
    "bookstores", "submissions", "editing_leases", "improvement_requests")}
TABLES = CORE | {"database/" + name + ".json" for name in (
    "app_schema_versions", "news_schedule_ranges", "monthly_digest_orders")}
BUCKETS = {"bookstore-news", "bookstore-news-originals", "bookstore-news-previews"}


class Failure(Exception):
    def __init__(self, code):
        self.code = "BACKUP_WRITER_" + code


def require(value, code):
    if not value:
        raise Failure(code)


def identity(info):
    return (info.st_dev, info.st_ino)


def directory(info, private=False):
    require(stat.S_ISDIR(info.st_mode), "DIRECTORY_INVALID")
    if private:
        require(info.st_uid in (0, os.geteuid()) and not info.st_mode & 0o022,
                "ANCESTOR_PERMISSIONS")


def not_backup_ancestor(fd):
    # Metadata-only: never open or inspect any pre-existing backup payload.
    for name in ("INCOMPLETE", "manifest.json"):
        try:
            os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            continue
        raise Failure("EXISTING_BACKUP_ANCESTOR")


def regular(info, size=None, expected=None):
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600,
            "FILE_IDENTITY")
    if size is not None:
        require(info.st_size == size, "FILE_SIZE")
    if expected is not None:
        require(identity(info) == expected, "FILE_IDENTITY")


def components(value, absolute=False):
    require(type(value) is str and value and len(value.encode("utf-8")) <= 4096,
            "PATH_INVALID")
    require(not any(ord(char) < 32 or ord(char) == 127 for char in value)
            and "\\" not in value and value.startswith("/") == absolute,
            "PATH_INVALID")
    parts = value[1:].split("/") if absolute else value.split("/")
    require(len(parts) <= (64 if absolute else MAX_DEPTH)
            and all(part not in ("", ".", "..") and len(part.encode("utf-8")) <= 255
                    for part in parts), "PATH_INVALID")
    return parts


def open_absolute(parts, private=False, forbidden=None):
    fd = os.open("/", DIR_FLAGS)
    identities = []
    try:
        for part in [None] + parts:
            if part is not None:
                next_fd = os.open(part, DIR_FLAGS, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            info = os.fstat(fd)
            directory(info, private)
            if private:
                not_backup_ancestor(fd)
            require(identity(info) != forbidden, "REPOSITORY_CONTAINMENT")
            identities.append(identity(info))
        return fd, identities
    except BaseException:
        os.close(fd)
        raise


def no_duplicates(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "HEADER_INVALID")
        value[key] = item
    return value


def invalid_constant(_value):
    raise Failure("HEADER_INVALID")


def emit(value):
    payload = (json.dumps(value, separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")
    require(len(payload) <= MAX_ACK, "ACK_LIMIT")
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


class Writer:
    def __init__(self):
        self.root = None
        self.parent = None
        self.marker = None
        self.started = time.monotonic()
        self.last_id = 0
        self.files = {}
        self.dirs = {}
        self.total = 0
        self.ledger = hashlib.sha256(PREFIX)

    def deadline(self):
        require(time.monotonic() - self.started <= WALL_SECONDS, "DEADLINE")

    def init(self, request):
        require(self.root is None, "STATE_INVALID")
        source = components(request["repository"], True)
        destination = components(request["destination"], True)
        source_fd, self.source_ids = open_absolute(source)
        try:
            self.source_identity = identity(os.fstat(source_fd))
        finally:
            os.close(source_fd)
        self.source_parts = source
        self.parent_parts = destination[:-1]
        self.leaf = destination[-1]
        self.parent, self.parent_ids = open_absolute(
            self.parent_parts, True, self.source_identity)
        os.mkdir(self.leaf, 0o700, dir_fd=self.parent)  # EEXIST is terminal.
        self.root = os.open(self.leaf, DIR_FLAGS, dir_fd=self.parent)
        root_info = os.fstat(self.root)
        directory(root_info, True)
        require(root_info.st_uid == os.geteuid() and stat.S_IMODE(root_info.st_mode) == 0o700
                and not os.listdir(self.root), "ROOT_INVALID")
        self.root_identity = identity(root_info)
        self.dirs[""] = self.root_identity
        self.check_path()
        self.marker = os.open("INCOMPLETE", WRITE_FLAGS, 0o600, dir_fd=self.root)
        self.write_all(self.marker, MARKER)
        os.fsync(self.marker)
        regular(os.fstat(self.marker), len(MARKER))
        self.marker_identity = identity(os.fstat(self.marker))
        os.fsync(self.root)
        os.fsync(self.parent)

    def check_path(self):
        # Reopened descriptors are identity checks only, never write handles.
        source_fd, source_ids = open_absolute(self.source_parts)
        try:
            require(source_ids == self.source_ids, "SOURCE_DRIFT")
        finally:
            os.close(source_fd)
        parent_fd, parent_ids = open_absolute(self.parent_parts, True, self.source_identity)
        try:
            require(parent_ids == self.parent_ids
                    and identity(os.fstat(self.parent)) == parent_ids[-1], "ROOT_DRIFT")
            info = os.stat(self.leaf, dir_fd=parent_fd, follow_symlinks=False)
            directory(info, True)
            require(identity(info) == self.root_identity == identity(os.fstat(self.root))
                    and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                    "ROOT_DRIFT")
        finally:
            os.close(parent_fd)

    def parent_for(self, parts, create):
        fd = os.dup(self.root)
        next_fd = None
        relative = ""
        try:
            for part in parts[:-1]:
                relative = relative + "/" + part if relative else part
                if relative not in self.dirs:
                    require(create and len(self.dirs) < MAX_DIRECTORIES, "DIRECTORY_LIMIT")
                    os.mkdir(part, 0o700, dir_fd=fd)
                    os.fsync(fd)
                    next_fd = os.open(part, DIR_FLAGS, dir_fd=fd)
                    info = os.fstat(next_fd)
                    directory(info, True)
                    require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                            "DIRECTORY_IDENTITY")
                    self.dirs[relative] = identity(info)
                else:
                    next_fd = os.open(part, DIR_FLAGS, dir_fd=fd)
                    info = os.fstat(next_fd)
                    directory(info, True)
                    require(identity(info) == self.dirs[relative]
                            and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                            "DIRECTORY_IDENTITY")
                os.close(fd)
                fd = next_fd
                next_fd = None
            return fd
        except BaseException:
            if next_fd is not None:
                os.close(next_fd)
            os.close(fd)
            raise

    def write_all(self, fd, payload):
        view = memoryview(payload)
        while view:
            self.deadline()
            written = os.write(fd, view)
            require(written > 0, "WRITE_FAILED")
            view = view[written:]

    def put(self, request, raw_header):
        require(self.root is not None and self.marker is not None, "STATE_INVALID")
        relative = request["path"]
        parts = components(relative)
        require(relative not in self.files and self.allowed_file(relative, parts), "FILE_PATH_INVALID")
        size = request["bytes"]
        require(type(size) is int and 0 <= size <= MAX_FILE
                and len(self.files) < MAX_FILES and self.total + size <= MAX_TOTAL, "PAYLOAD_LIMIT")
        expected_hash = request["sha256"]
        require(type(expected_hash) is str and len(expected_hash) == 64
                and all(char in "0123456789abcdef" for char in expected_hash), "HASH_INVALID")
        self.check_path()
        parent = self.parent_for(parts, True)
        fd = None
        try:
            fd = os.open(parts[-1], WRITE_FLAGS, 0o600, dir_fd=parent)
            info = os.fstat(fd)
            regular(info, 0)
            opened_identity = identity(info)
            digest = hashlib.sha256()
            remaining = size
            while remaining:
                self.deadline()
                payload = sys.stdin.buffer.read(min(65536, remaining))
                require(payload, "PAYLOAD_TRUNCATED")
                self.write_all(fd, payload)
                digest.update(payload)
                remaining -= len(payload)
            require(digest.hexdigest() == expected_hash, "HASH_MISMATCH")
            os.fsync(fd)
            regular(os.fstat(fd), size, opened_identity)
            os.fsync(parent)
            self.files[relative] = (opened_identity, size, expected_hash)
            self.total += size
            self.ledger.update(raw_header)
        finally:
            if fd is not None:
                os.close(fd)
            os.close(parent)

    @staticmethod
    def allowed_file(relative, parts):
        return (relative in {"manifest.json", "README.txt"} or relative in TABLES
                or (len(parts) == 2 and parts[0] == "migrations" and parts[1].endswith(".sql"))
                or (len(parts) >= 3 and parts[0] == "storage" and parts[1] in BUCKETS))

    def verify_own_file(self, relative, expected):
        parts = components(relative)
        parent = self.parent_for(parts, False)
        fd = None
        try:
            fd = os.open(parts[-1], READ_FLAGS, dir_fd=parent)
            file_identity, size, expected_hash = expected
            regular(os.fstat(fd), size, file_identity)
            digest = hashlib.sha256()
            remaining = size
            while remaining:
                self.deadline()
                payload = os.read(fd, min(65536, remaining))
                require(payload, "FILE_CHANGED")
                digest.update(payload)
                remaining -= len(payload)
            require(not os.read(fd, 1) and digest.hexdigest() == expected_hash, "FILE_CHANGED")
            regular(os.fstat(fd), size, file_identity)
        finally:
            if fd is not None:
                os.close(fd)
            os.close(parent)

    def finish(self, request):
        require(self.root is not None and self.marker is not None, "STATE_INVALID")
        required = request["required"]
        require(type(required) is list and len(required) <= len(TABLES) + 2
                and all(type(item) is str for item in required) and len(set(required)) == len(required),
                "REQUIRED_FILES")
        expected_required = (set(self.files) & TABLES) | {"manifest.json", "README.txt"}
        require(CORE <= set(required) and set(required) == expected_required
                and set(required) <= set(self.files), "REQUIRED_FILES")
        require(type(request["files"]) is int and request["files"] == len(self.files)
                and type(request["bytes"]) is int and request["bytes"] == self.total
                and request["ledger"] == self.ledger.hexdigest(), "LEDGER_MISMATCH")
        # FINISH is sealed by EOF before any completion marker is removed.
        require(sys.stdin.buffer.read(1) == b"", "TRAILING_INPUT")
        self.check_path()
        for relative, expected in self.files.items():
            self.verify_own_file(relative, expected)
        self.verify_own_file("INCOMPLETE", (self.marker_identity, len(MARKER), hashlib.sha256(MARKER).hexdigest()))
        regular(os.fstat(self.marker), len(MARKER), self.marker_identity)
        self.check_path()
        os.unlink("INCOMPLETE", dir_fd=self.root)
        os.fsync(self.root)
        # A pipe failure after this commit leaves a valid retained backup but
        # no client success. Never recreate a marker or delete committed data.

    def ack(self, request):
        value = {"v": 1, "id": request["id"], "ok": True, "op": request["op"]}
        if request["op"] != "init":
            value.update(files=len(self.files), bytes=self.total, ledger=self.ledger.hexdigest())
        emit(value)

    def close(self):
        for name in ("marker", "root", "parent"):
            fd = getattr(self, name)
            if fd is not None:
                os.close(fd)
                setattr(self, name, None)

    def run(self):
        while True:
            self.deadline()
            raw = sys.stdin.buffer.readline(MAX_HEADER + 1)
            require(raw and len(raw) <= MAX_HEADER and raw.endswith(b"\n"), "HEADER_INVALID")
            request = json.loads(raw.decode("utf-8"), object_pairs_hook=no_duplicates,
                                 parse_constant=invalid_constant)
            require(type(request) is dict and type(request.get("v")) is int and request["v"] == 1
                    and type(request.get("id")) is int and request["id"] == self.last_id + 1,
                    "HEADER_INVALID")
            self.last_id = request["id"]
            operation = request.get("op")
            fields = {"init": {"repository", "destination"}, "put": {"path", "bytes", "sha256"},
                      "finish": {"files", "bytes", "ledger", "required"}}
            require(type(operation) is str and operation in fields
                    and set(request) == {"v", "id", "op"} | fields[operation], "HEADER_INVALID")
            if operation == "init":
                self.init(request)
            elif operation == "put":
                self.put(request, raw)
            else:
                self.finish(request)
            self.ack(request)
            if operation == "finish":
                return


writer = Writer()
exit_code = 1
try:
    require(os.name == "posix" and all(hasattr(os, name) for name in
            ("O_DIRECTORY", "O_NOFOLLOW", "O_CLOEXEC", "O_NONBLOCK"))
            and all(call in os.supports_dir_fd for call in (os.open, os.mkdir, os.stat, os.unlink))
            and os.stat in os.supports_follow_symlinks, "PLATFORM_UNSUPPORTED")
    os.umask(0o077)
    DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    WRITE_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
    READ_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
    writer.run()
    exit_code = 0
except BaseException as error:
    try:
        emit({"v": 1, "id": writer.last_id, "ok": False,
              "code": error.code if isinstance(error, Failure) else "BACKUP_WRITER_IO_FAILED"})
    except BaseException:
        pass
finally:
    try:
        writer.close()
    except BaseException:
        exit_code = 1
sys.exit(exit_code)
