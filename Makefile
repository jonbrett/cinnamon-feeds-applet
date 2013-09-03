BUILD_DIR := BUILD
PACKAGE_DIR := feeds@jonbrettdev.wordpress.com
VERSION := $(shell git describe --tags 2>/dev/null)
INSTALL_DIR := ~/.local/share/cinnamon/applets/$(PACKAGE_DIR)

ZIP_FILE := $(PACKAGE_DIR)-$(VERSION).zip
EXCLUDES := .git Makefile

.PHONY: all clean install

all: $(BUILD_DIR)
	-rm -rf $(BUILD_DIR)/$(PACKAGE_DIR)
	git clone $(CURDIR) $(BUILD_DIR)/$(PACKAGE_DIR)
	rm -rf $(addprefix $(BUILD_DIR)/$(PACKAGE_DIR)/, $(EXCLUDES))
	cd $(BUILD_DIR) && zip -r $(ZIP_FILE) $(PACKAGE_DIR)

install:
ifneq "$(wildcard $(INSTALL_DIR))" ""
	@echo "WARNING: Replacing installed applet: $(INSTALL_DIR)"
	rm -rfI $(INSTALL_DIR)
endif
	ln -s $(CURDIR) $(INSTALL_DIR)

$(BUILD_DIR):
	mkdir -p $@

clean:
	-rm -rf $(BUILD_DIR)
