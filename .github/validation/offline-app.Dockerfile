FROM scratch
COPY rootfs/ /
USER 65534:65534
WORKDIR /
ENTRYPOINT ["/usr/bin/env"]
