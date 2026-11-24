VERSION := $(shell cat VERSION)
ARCH    ?= aarch64_cortex-a53
ROUTER  ?= root@192.168.1.1

.PHONY: all apk deploy clean version

all: apk

apk:
	ARCH=$(ARCH) sh scripts/build-apk.sh

deploy: apk
	scp "dist/luci-app-mlo-$(VERSION)-$(ARCH).apk" "$(ROUTER):/tmp/"
	ssh "$(ROUTER)" "apk add --allow-untrusted /tmp/luci-app-mlo-$(VERSION)-$(ARCH).apk"

clean:
	rm -rf dist

version:
	@echo $(VERSION)
