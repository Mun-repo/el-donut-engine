<p align="center"><img src="extension/icons/512.png" width="140"></p>
<h1 align="center">El Donut Engine 🍩</h1>
<p align="center">A pink pastel mod menu for <b>games against chess.com bots</b>, powered by Stockfish 17.1 and running 100% locally.</p>

> ⚠️ **Bots only.** The extension only turns on at `chess.com/play/computer`. It does not work in live games against humans, and it never will. Automation may still go against chess.com's Terms of Service, so use it at your own risk (ideally on a secondary account).

---

## 📥 Installation tutorial (2 minutes, no coding)

**Step 1: Download**
- Click the green **`<> Code`** button at the top of this page, then **Download ZIP**.
- Unzip the file somewhere you'll keep it, like `Documents/el-donut-engine`. Don't delete this folder afterwards, because Chrome loads the extension from it.

**Step 2: Open the extensions page**
- In Chrome, type `chrome://extensions` in the address bar and press Enter.

**Step 3: Turn on Developer mode**
- Click the **Developer mode** switch in the top-right corner.

**Step 4: Load the extension**
- Click **Load unpacked** (top-left).
- Select the **`extension`** folder inside the unzipped folder. This is the folder that contains `manifest.json`.

**Step 5: Pin it**
- Click the puzzle icon 🧩 in the toolbar, then the pin next to **El Donut Engine**.

**Step 6: Play**
- Go to <https://www.chess.com/play/computer> and start a game. The menu shows up in the top-right corner.

✅ This also works in **Edge** (`edge://extensions`), **Brave** (`brave://extensions`), **Opera** and **Arc**, using the same steps.

**Updating:** download the new ZIP, replace the folder, then click ↻ on the extension card in `chrome://extensions`.

---

## ✨ Features
| | |
|---|---|
| **Highlight** | Shows the best move on the board (the from-square plus a 🍩 on the target square) on your turn. |
| **Auto** | Plays the move for you after your chosen delay. Promotes to a queen automatically. |
| **Move delay** | 0 to 10 seconds between moves in Auto mode. |
| **Human delay** | Varies the delay by ±30% for a less mechanical rhythm. |
| **Engine Elo** | 1320 to 3190 (Max means full strength), using Stockfish's `UCI_LimitStrength`. |
| **Depth** | 4 to 22 plies. Higher is stronger but slower. |
| **Multi-line** | Up to 3 best moves at once, each with its own evaluation. |
| **Arrows** | Pink gradient arrows on the board. The darkest one is the best move. |
| **Eval bar** | An evaluation bar next to the board, oriented to your color, including mate scores. |
| **Hotkeys** | `Alt+H` highlight · `Alt+A` auto · `Alt+D` show/hide the menu. |
| **Menu** | Draggable, can be minimized, and remembers your settings. Clicking the 🍩 icon shows or hides it. |

## 🎮 Usage
1. Pick a bot and start the game.
2. In the menu, choose **Highlight** or **Auto**.
3. Set the Elo, depth, delay and number of lines. Changes apply from the next move.
4. **Off** pauses everything without closing the menu.

## 🛠️ Architecture
```
extension/
├── manifest.json     # Manifest V3, injected on chess.com only
├── background.js     # toolbar icon → show/hide the menu
├── content.js        # reads the board (DOM), builds the FEN, draws highlights/arrows/eval bar, plays moves
├── content.css       # overlay styles
├── panel.html/css/js # menu (isolated iframe) + Stockfish Web Worker
├── engine/           # Stockfish 17.1 lite single-thread (WASM, GPL-3)
└── icons/            # 🍩
```
- **Board reading:** pieces are `.piece.wp.square-52` elements (file 5, rank 2) inside `wc-chess-board`. The side to move comes from the last-move `.highlight` squares, and your color from the `flipped` class.
- **Engine:** runs in a Web Worker inside the menu iframe (extension origin), which avoids the page's CSP. It makes no network requests.
- **Auto moves:** simulated pointer events on the from-square, then on the to-square.
- **Safeguard:** `content.js` tears everything down as soon as the URL leaves `/play/computer`.

## ❓ Troubleshooting
| Problem | Fix |
|---|---|
| The menu doesn't appear | Make sure the URL is `/play/computer`, then reload the page. |
| It stays on "Loading engine…" | Reload the extension in `chrome://extensions`. |
| "Manifest file is missing" | You selected the wrong folder. Pick the one that contains `manifest.json`. |
| Auto mode doesn't move | chess.com may have changed its page layout. Open an issue; Highlight mode still works. |
| A wrong move early in the game | Castling rights and en passant are estimated from the board. It's rare, but it can happen. |

## 📜 License
GPL-3.0 (Stockfish is GPL-3). Not affiliated with chess.com.
