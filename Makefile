.PHONY: help init build serve dist clean

# Get version from package.json
VERSION := $(shell node -p "require('./package.json').version")

# Show help
help:
	@echo "Chicken Dinner v$(VERSION)"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  init    Install dependencies"
	@echo "  build   Build the project"
	@echo "  serve   Run dev server with hot reload"
	@echo "  dist    Build zip for itch.io + docs/ for GitHub Pages"
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

# Build distribution zip for itch.io and docs for GitHub Pages
dist: build
	@mkdir -p dist-itch
	@cp public/index.html dist-itch/
	@cp dist/main.js dist-itch/
	@cp -r assets dist-itch/
	@sed -i 's|/src/main.ts|main.js|g' dist-itch/index.html
	@sed -i 's|/assets/|assets/|g' dist-itch/main.js
	@cd dist-itch && zip -r ../chicken-dinner-$(VERSION)-itch.zip .
	@rm -rf dist-itch
	@echo "Created chicken-dinner-$(VERSION)-itch.zip"
	@rm -rf docs
	@mkdir -p docs
	@cp public/index.html docs/
	@cp dist/main.js docs/
	@cp -r assets docs/
	@sed -i 's|/src/main.ts|main.js|g' docs/index.html
	@sed -i 's|/assets/|assets/|g' docs/main.js
	@echo "Created docs/ for GitHub Pages"

# Clean build artifacts
clean:
	rm -rf dist dist-itch chicken-dinner-*-itch.zip
