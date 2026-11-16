FROM scratch
COPY rootfs /
WORKDIR /work
USER 65534:65534
ENTRYPOINT ["/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "TZ=UTC", "HOME=/scratch", "TMPDIR=/scratch", "XDG_CACHE_HOME=/scratch", "UV_THREADPOOL_SIZE=2", "/usr/bin/node", "--max-old-space-size=128", "/usr/bin/source-policy-launcher.mjs"]
