Stockfish 19.0.1 Lite browser engine assets

These files are the single-threaded Lite WebAssembly build from Stockfish.js
19.0.1 (about 1.7 MB for the JavaScript and WebAssembly files together). The
Lite network is smaller and weaker than the full build. The engine is licensed
under GPL-3.0; see Copying.txt.

Stockfish.js release:
https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1

Stockfish source:
https://github.com/official-stockfish/Stockfish

The game uses Stockfish as a candidate-move source for Grandmaster. Its moves
are filtered through Blast Chess legal moves and the built-in variant search,
because Stockfish does not implement Mimics or explosions.
