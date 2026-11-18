"use client";

import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { initialProgress, isSolved, puzzles, restoreProgress, type GameProgress } from "./puzzles";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function Sudoku({ userId }: { userId: string }) {
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return ready ? <SudokuBoard userId={userId} /> : <p role="status">Loading your puzzle…</p>;
}

function SudokuBoard({ userId }: { userId: string }) {
  const storageKey = "eba-hub:sudoku:v1:" + userId;
  const [progress, setProgress] = useState<GameProgress>(() => {
    try { return restoreProgress(localStorage.getItem(storageKey)); }
    catch { return initialProgress(); }
  });
  const [selected, setSelected] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<"restart" | "new" | null>(null);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const puzzle = puzzles.find(({ id }) => id === progress.puzzleId) ?? puzzles[0];
  const board = progress.entries.map((entry, index) => puzzle.clues[index] === "0" ? entry : puzzle.clues[index]);
  const solved = isSolved(puzzle.clues, progress.entries, puzzle.solution);
  const remaining = board.filter((value) => !value).length;
  const selectedClue = puzzle.clues[selected] !== "0";

  function save(next: GameProgress) {
    setProgress(next);
    setNotice("");
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  function enter(value: string) {
    if (selectedClue) {
      setNotice("This cell is a fixed clue. Choose an empty cell.");
      return;
    }
    save({ ...progress, entries: progress.entries.map((entry, index) => index === selected ? value : entry) });
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      enter(event.key);
      return;
    }
    if (["Backspace", "Delete", "0"].includes(event.key)) {
      event.preventDefault();
      enter("");
      return;
    }
    const row = Math.floor(index / 9);
    const column = index % 9;
    let next = index;
    switch (event.key) {
      case "ArrowLeft": next = row * 9 + Math.max(0, column - 1); break;
      case "ArrowRight": next = row * 9 + Math.min(8, column + 1); break;
      case "ArrowUp": next = Math.max(0, row - 1) * 9 + column; break;
      case "ArrowDown": next = Math.min(8, row + 1) * 9 + column; break;
      case "Home": next = row * 9; break;
      case "End": next = row * 9 + 8; break;
      default: return;
    }
    event.preventDefault();
    setSelected(next);
    cells.current[next]?.focus();
  }

  function reset() {
    const nextIndex = confirm === "new" ? (puzzles.findIndex(({ id }) => id === puzzle.id) + 1) % puzzles.length : puzzles.findIndex(({ id }) => id === puzzle.id);
    save(initialProgress(nextIndex));
    setSelected(0);
    setConfirm(null);
    cells.current[0]?.focus();
  }

  return (
    <div className="eba-sudoku">
      <div className="eba-sudoku__play">
        <div className="eba-sudoku__caption"><h2>{puzzle.name}</h2><span>{remaining} cells left</span></div>
        <p id="sudoku-instructions">Select a cell, then enter 1–9. Use arrow keys to move and Delete to clear.</p>
        <div className="eba-sudoku__board" role="group" aria-label="Sudoku board" aria-describedby="sudoku-instructions">
          {board.map((value, index) => (
            <button type="button" key={index} ref={(element) => { cells.current[index] = element; }}
              tabIndex={selected === index ? 0 : -1} aria-pressed={selected === index}
              aria-label={"Row " + (Math.floor(index / 9) + 1) + ", column " + (index % 9 + 1) + ", " + (value || "empty") + (puzzle.clues[index] === "0" ? ", editable" : ", fixed clue")}
              data-clue={puzzle.clues[index] !== "0"}
              data-box-right={index % 9 === 2 || index % 9 === 5}
              data-box-bottom={Math.floor(index / 9) === 2 || Math.floor(index / 9) === 5}
              onFocus={() => setSelected(index)} onClick={() => setSelected(index)} onKeyDown={(event) => handleKey(event, index)}>
              {value}
            </button>
          ))}
        </div>
        <p className="eba-sudoku__result" role="status">
          {solved ? "Puzzle complete. Well done!" : notice}
        </p>
      </div>
      <aside className="eba-sudoku__controls" aria-label="Puzzle controls">
        <h2>Make your move</h2>
        <p>{selectedClue ? "Choose an editable cell." : "Selected row " + (Math.floor(selected / 9) + 1) + ", column " + (selected % 9 + 1) + "."}</p>
        <div className="eba-sudoku__pad" aria-label="Number pad">
          {Array.from({ length: 9 }, (_, index) => <button type="button" key={index}
            aria-label={"Enter " + (index + 1)} disabled={selectedClue} onClick={() => enter(String(index + 1))}>{index + 1}</button>)}
        </div>
        <button type="button" disabled={selectedClue || !progress.entries[selected]} onClick={() => enter("")}>Clear cell</button>
        <button type="button" className="eba-games__primary" onClick={() => setNotice(
          solved ? "Puzzle complete. Well done!" : remaining ? "There are still empty cells. Keep going." : "The board has some incorrect entries. Try again."
        )}>Check board</button>
        <div className="eba-sudoku__reset-actions">
          <button type="button" onClick={() => setConfirm("restart")}>Restart puzzle</button>
          <button type="button" onClick={() => setConfirm("new")}>New puzzle</button>
        </div>
        {confirm && <div className="eba-sudoku__confirm" role="group" aria-label="Confirm puzzle reset">
          <p>{confirm === "new" ? "Start the next puzzle? This replaces your current progress." : "Clear all your entries and restart this puzzle?"}</p>
          <button type="button" onClick={reset}>Confirm</button>
          <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
        </div>}
        <p>{storageError ? "Browser saving is unavailable. Progress will last for this visit only." : "Progress is saved in this browser for your account."}</p>
      </aside>
    </div>
  );
}
