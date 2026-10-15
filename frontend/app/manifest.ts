import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Brick Chamber ERP",
    short_name: "Brick ERP",
    description: "Operations and finance management for brick chamber businesses.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f2f4ed",
    theme_color: "#263f30",
    lang: "en-IN",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
