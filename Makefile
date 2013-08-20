BUILD_DIR := BUILD
PACKAGE_DIR := feeds@jonbrettdev.wordpress.com
VERSION := $(shell git describe --tags 2>/dev/null)

ZIP_FILE := $(PACKAGE_DIR)-$(VERSION).zip
EXCLUDES := .git Makefile

.PHONY: all clean

all: $(BUILD_DIR)
	-rm -rf $(BUILD_DIR)/$(PACKAGE_DIR)
	git clone $(CURDIR) $(BUILD_DIR)/$(PACKAGE_DIR)
	rm -rf $(addprefix $(BUILD_DIR)/$(PACKAGE_DIR)/, $(EXCLUDES))
	cd $(BUILD_DIR) && zip -r $(ZIP_FILE) $(PACKAGE_DIR)

$(BUILD_DIR):
	mkdir -p $@

clean:
	-rm -rf $(BUILD_DIR)
