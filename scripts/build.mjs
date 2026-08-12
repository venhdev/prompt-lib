import { build } from "esbuild";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";

const root = process.cwd();
const outputDir = path.join(root, "dist");

const localEnvFile = path.join(root, ".env.local");
if (existsSync(localEnvFile)) loadEnvFile(localEnvFile);

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);
if (missingEnvironment.length) {
  throw new Error(`Missing build environment: ${missingEnvironment.join(", ")}`);
}

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
if (configuredAppUrl) new URL(configuredAppUrl);

await rm(outputDir, { recursive: true, force: true });

const result = await build({
  entryPoints: [path.join(root, "client/main.jsx")],
  bundle: true,
  minify: true,
  write: false,
  outdir: path.join(root, ".bundle"),
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  loader: {
    ".js": "jsx",
    ".css": "css",
  },
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL),
    __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    __APP_URL__: JSON.stringify(configuredAppUrl),
  },
});

const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"));
const stylesheet = result.outputFiles.find((file) => file.path.endsWith(".css"));

if (!javascript || !stylesheet) {
  throw new Error("Client bundle did not produce JavaScript and CSS outputs.");
}

const themeBootstrap = `<script>
  (() => {
    try {
      const storedTheme = localStorage.getItem("prompt-lib:theme");
      document.documentElement.dataset.theme = storedTheme === "light" ? "light" : "dark";
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  })();
</script>`;

const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Prompt Library</title>
    <meta name="description" content="A personal library for reusable AI prompts and version history." />
    ${themeBootstrap}
    <style>${stylesheet.text}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${javascript.text.replaceAll("</script", "<\\/script")}</script>
  </body>
</html>`;

const workerSource = `const html = ${JSON.stringify(html)};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
      },
    });
  },
};
`;

await mkdir(path.join(outputDir, "client"), { recursive: true });
await mkdir(path.join(outputDir, "server"), { recursive: true });
await mkdir(path.join(outputDir, ".openai"), { recursive: true });

await writeFile(path.join(outputDir, "client/index.html"), html);
await writeFile(path.join(outputDir, "server/index.js"), workerSource);
const hostingConfig = path.join(root, ".openai/hosting.json");
try {
  await access(hostingConfig);
  await writeFile(
    path.join(outputDir, ".openai/hosting.json"),
    await readFile(hostingConfig),
  );
} catch {
  // Vercel deployments do not include the ChatGPT Sites project metadata.
}

console.log(`Built Prompt Library (${Buffer.byteLength(html)} byte HTML payload).`);
