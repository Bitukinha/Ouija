import { fileURLToPath } from "node:url";
import type { ConfigEnv, UserConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default async function config({ command }: ConfigEnv): Promise<UserConfig> {
  const plugins = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({ server: { entry: "server" } }),
  ];

  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ preset: "vercel" }));
  }

  plugins.push(viteReact());

  return {
    resolve: { alias: { "@": srcDir } },
    css: { transformer: "lightningcss" },
    server: { host: "::", port: 8080 },
    plugins,
  };
}
