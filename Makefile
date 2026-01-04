.PHONY: help init build serve dist clean

# Get version from package.json
VERSION := $(shell node -p "require('./package.json').version")

# Show help
help:
	@echo "Foxes v$(VERSION)"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  init    Install dependencies"
	@echo "  build   Build the project"
	@echo "  serve   Run dev server with hot reload"
	@echo "  dist    Build zip for itch.io (foxes-$(VERSION)-itch.zip)"
	@echo "  clean   Remove build artifacts"
	@echo "  help    Show this help message"

# Install dependencies
init:
	bun install

# Build the project
build:
	bun build ./src/main.ts --outdir ./dist --minify

# Run development server with hot reload
serve:
	bun run server.ts

# Build distribution zip for itch.io
dist: build
	@mkdir -p dist-itch
	@cp public/index.html dist-itch/
	@cp dist/main.js dist-itch/
	@cp -r assets dist-itch/
	@sed -i 's|/src/main.ts|main.js|g' dist-itch/index.html
	@cd dist-itch && zip -r ../foxes-$(VERSION)-itch.zip .
	@rm -rf dist-itch
	@echo "Created foxes-$(VERSION)-itch.zip"

# Clean build artifacts
clean:
	rm -rf dist dist-itch foxes-*-itch.zip
