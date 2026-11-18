import type { CSSProperties } from "react";

const words = [
  [
    { letter: "E", decoys: ["F", "R", "L"] },
    { letter: "B", decoys: ["P", "D", "R"] },
    { letter: "A", decoys: ["V", "N", "M"] },
  ],
  [
    { letter: "H", decoys: ["N", "K", "M"] },
    { letter: "u", decoys: ["n", "o", "v"] },
    { letter: "b", decoys: ["d", "p", "h"] },
  ],
];

// Reuse the wordmark's CSS-only letter stream without shipping animation JS.
export function EbaAnimatedText({ text }: { text: string }) {
  const copyWords = text.split(" ");
  return <>
    <span className="eba-copy__accessible">{text}</span>
    <span className="eba-copy" aria-hidden="true">{copyWords.map((word, wordIndex) => {
      const start = copyWords.slice(0,wordIndex).reduce((length,previous)=>length+previous.length+1,0);
      return <span key={wordIndex}>{wordIndex > 0 && " "}<span className="eba-copy__word">
        {Array.from(word).map((letter, index) => <span className="eba-home__letter" key={index}
          style={{ "--letter-index": start + index } as CSSProperties}>
          <span className="eba-home__locked">{letter}</span>
          <span className="eba-home__stream">
            <span>{letter === letter.toUpperCase() ? "N" : "n"}</span>
            <span className="eba-home__incoming">{letter}</span>
            <span>{letter === letter.toUpperCase() ? "R" : "r"}</span>
            <span>{letter === letter.toUpperCase() ? "M" : "m"}</span>
          </span>
        </span>)}
      </span></span>;
    })}</span>
  </>;
}

export function EbaWordmark({ animated = false }: { animated?: boolean }) {
  const Tag = animated ? "h1" : "div";

  return (
    <Tag className="eba-home__wordmark" aria-label={animated ? "EBA Hub" : undefined} aria-hidden={!animated || undefined}>
      {words.map((word, wordIndex) => (
        <span aria-hidden="true" className="eba-home__word" key={word[0].letter}>
          {word.map(({ letter, decoys }, letterIndex) => (
            <span
              className="eba-home__letter"
              key={letter}
              style={{ "--letter-index": wordIndex * 3 + letterIndex } as CSSProperties}
            >
              <span className="eba-home__locked">{letter}</span>
              {animated && (
                <span className="eba-home__stream">
                  <span>{decoys[0]}</span>
                  <span className="eba-home__incoming">{letter}</span>
                  <span>{decoys[1]}</span>
                  <span>{decoys[2]}</span>
                </span>
              )}
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}
