# CLIP Image Search

Local, offline AI-powered image search for product catalogs. Built with Electron, React, CLIP (ONNX), and SQLite.

## What it does

- Scans a folder of product images (10k–100k+)
- Generates CLIP embeddings locally (no cloud, no API)
- Lets users search with natural language ("wood handle caddy", "gold metal bowl")
- Watches folders for new images automatically

## Tech

Electron 32 · React 18 · Tailwind 3 · better-sqlite3 · onnxruntime-node · CLIP ViT-B/32 (quantized) · sharp · chokidar

## Development

```bash
npm install
npm run download-models   # one-time, downloads CLIP ONNX (~82 MB)
npm run dev               # launches Electron + Vite
```

## Build Windows .exe

```bash
npm run build:win
```

Output: `release/CLIP Image Search Setup 1.0.0.exe`

## Architecture

- **Main process** (Electron): SQLite, CLIP inference (worker thread), folder watcher, IPC
- **Renderer** (React): UI, search input, image grid, modal
- **Worker thread**: CLIP image + text embedding via onnxruntime-node

## Status

Work in progress. Currently in Phase 1 of 8.
