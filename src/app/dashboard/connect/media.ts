export const stickers = {
  celebrate: { glyph: "🎉", label: "Celebrate" },
  thanks: { glyph: "🙌", label: "Thanks" },
  "great-work": { glyph: "🌟", label: "Great work" },
  team: { glyph: "🤝", label: "Teamwork" },
  hello: { glyph: "👋", label: "Hello" },
  laugh: { glyph: "😂", label: "Laughing" },
  love: { glyph: "❤️", label: "Love" },
  yes: { glyph: "👍", label: "Yes" },
  no: { glyph: "👎", label: "No" },
  wow: { glyph: "😮", label: "Wow" },
  fire: { glyph: "🔥", label: "On fire" },
  idea: { glyph: "💡", label: "Idea" },
  coffee: { glyph: "☕", label: "Coffee break" },
  rocket: { glyph: "🚀", label: "Launch" },
  party: { glyph: "🥳", label: "Party" },
  clap: { glyph: "👏", label: "Applause" },
  strong: { glyph: "💪", label: "Stay strong" },
  happy: { glyph: "😊", label: "Happy" },
  focus: { glyph: "🎯", label: "Focus" },
  done: { glyph: "✅", label: "Done" },
  cheers: { glyph: "🥂", label: "Cheers" },
  "good-morning": { glyph: "🌞", label: "Good morning" },
  "heart-eyes": { glyph: "😍", label: "Heart eyes" },
  sparkle: { glyph: "✨", label: "Sparkle" },
};

export const emojis = ["😀", "😃", "😄", "😁", "😂", "🤣", "😊", "🙂", "😉", "😍", "🥰", "😎",
  "🤔", "🤩", "😅", "😮", "😢", "😭", "🙃", "😇", "😴", "🤯", "👀", "👋", "👍", "👎", "👏",
  "🙌", "🙏", "🤝", "💪", "👌", "✌️", "🤞", "❤️", "💚", "💛", "🔥", "✨", "⭐", "🎉", "🎯",
  "💡", "🚀", "✅", "📌", "☕", "💬"];

export const audioTypes = ["audio/webm", "audio/ogg", "audio/mp4"];
export const maxAudioBytes = 750000;

export function isSticker(value: string): value is keyof typeof stickers {
  return Object.hasOwn(stickers, value);
}
