import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  ...(process.env.THICC_RUNTIME==="node"?{
    output:"standalone" as const,
    distDir:".next-dokploy",
    typescript:{tsconfigPath:"tsconfig.dokploy.json"},
    outputFileTracingRoot:path.resolve("."),
    webpack(config,{webpack}){
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/,path.resolve("lib/dokploy-env.ts")));
      return config;
    },
  }:{}),
};

export default nextConfig;
