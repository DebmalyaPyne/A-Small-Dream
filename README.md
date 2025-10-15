# A Small Dream

Tiny light. Vast night. A gentle exploration through fading memories.

Made with [LittleJS](https://github.com/KilledByAPixel/LittleJS)

🌙 Theme: SMALL — You are a small spark in a great dream. Gather fragments before the light goes quiet.

## 🎮 Play

- GitHub Pages: [A Small Dream](https://debmalyapyne.github.io/A-Small-Dream/)
- Local: see “Run locally” below

## 🕹️ Controls

- Move: Arrow Keys or WASD
- Continue (menus, act intro, cutscene): Enter / Space / Click
- Restart: R
- Skip cutscene: Enter / Space / Click

## 🚀 Run locally

You need to serve the files over HTTP (browsers restrict some features on file://).

- Option 1 (VS Code): Install the “Live Preview” or “Live Server” extension and open `index.html`.
- Option 2 (Node): Install http-server, then from the project folder:

```powershell
npm install -g http-server
http-server -p 8080
```

Open <http://localhost:8080> in your browser.

## 📁 Project structure

- `index.html` — loads web fonts, the LittleJS engine, and the game script
- `vendor/littlejs.min.js` — local LittleJS engine build
- `src/game.js` — all game code and UI

## ✨ Notes

- No build step — the game runs as static HTML + JS
- Audio starts only after user interaction (browser policy)
- Modern desktop browsers recommended

## 📜 License

- Code: Apache License 2.0 (Apache-2.0) — see `LICENSE`
- Original game assets (art/audio/narrative): Creative Commons Attribution 4.0 (CC BY 4.0) — see `ASSETS-LICENSE`
- Third‑party:
  - LittleJS — MIT License
  - Fonts (Cinzel Decorative, Cinzel, Nunito, Fira Code) — SIL Open Font License 1.1 (served via Google Fonts)

## 🙏 Credits

- Game design, code, and writing: Debmalya Pyne
- Built with LittleJS by Frank Force
