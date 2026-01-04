import { watch } from "fs";

let buildVersion = Date.now();

async function build() {
  const result = await Bun.build({
    entrypoints: ["./src/main.ts"],
    outdir: "./dist",
    minify: false,
    sourcemap: "inline",
  });

  if (!result.success) {
    console.error("Build failed:", result.logs);
    return false;
  }

  buildVersion = Date.now();
  console.log("Build successful:", new Date().toLocaleTimeString());
  return true;
}

// Initial build
await build();

// Watch for changes
watch("./src", { recursive: true }, async (event, filename) => {
  console.log(`File changed: ${filename}`);
  await build();
});

watch("./public", { recursive: true }, (event, filename) => {
  console.log(`File changed: ${filename}`);
  buildVersion = Date.now();
});

// SSE clients for hot reload
const clients = new Set<ReadableStreamDefaultController>();

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Hot reload SSE endpoint
    if (path === "/__reload") {
      const stream = new ReadableStream({
        start(controller) {
          clients.add(controller);
          // Send current version
          controller.enqueue(`data: ${buildVersion}\n\n`);
        },
        cancel(controller) {
          clients.delete(controller);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Serve index.html for root (with hot reload script injected)
    if (path === "/") {
      const html = await Bun.file("./public/index.html").text();
      const hotReloadScript = `
<script>
  const es = new EventSource('/__reload');
  let lastVersion = null;
  es.onmessage = (e) => {
    if (lastVersion && lastVersion !== e.data) {
      location.reload();
    }
    lastVersion = e.data;
  };
</script>
</head>`;
      const injectedHtml = html.replace("</head>", hotReloadScript);
      return new Response(injectedHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Serve bundled JS for the main script
    if (path === "/src/main.ts") {
      return new Response(Bun.file("./dist/main.js"), {
        headers: { "Content-Type": "application/javascript" },
      });
    }

    // Serve assets
    if (path.startsWith("/assets/")) {
      const file = Bun.file("." + path);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    // Serve other public files
    const publicFile = Bun.file("./public" + path);
    if (await publicFile.exists()) {
      return new Response(publicFile);
    }

    return new Response("Not found", { status: 404 });
  },
});

// Notify clients when build version changes
setInterval(() => {
  const msg = `data: ${buildVersion}\n\n`;
  for (const client of clients) {
    try {
      client.enqueue(msg);
    } catch {
      clients.delete(client);
    }
  }
}, 500);

console.log(`Server running at http://localhost:${server.port}`);
console.log("Hot reload enabled - watching src/ and public/");
