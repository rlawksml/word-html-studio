FROM scratch
COPY rootfs /
WORKDIR /work
USER 65534:65534
ENTRYPOINT ["/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "TZ=UTC", "TMPDIR=/tmp", "/usr/bin/node", "--max-old-space-size=128", "--test", "--test-reporter=tap", "--test-isolation=none", "tests/rollback-readiness.test.mjs"]
