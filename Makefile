.PHONY: init build serve dist clean

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
	@cd dist-itch && zip -r ../foxes-itch.zip .
	@rm -rf dist-itch
	@echo "Created foxes-itch.zip"

# Clean build artifacts
clean:
	rm -rf dist dist-itch foxes-itch.zip
