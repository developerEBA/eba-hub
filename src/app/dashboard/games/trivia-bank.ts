
import "server-only";
export const triviaQuestions = [
  { text: "What does the A in RGB stand for?", options: ["Alpha", "Nothing — RGB is red, green, blue", "Amber", "Alignment"], correct: 1 },
  { text: "Which format is designed for scalable vector graphics?", options: ["JPEG", "MP3", "SVG", "TXT"], correct: 2 },
  { text: "Which city is Nigeria’s federal capital?", options: ["Lagos", "Ibadan", "Kano", "Abuja"], correct: 3 },
  { text: "What does a call to action primarily help a reader do?", options: ["Choose a next step", "Count words", "Identify a font", "Change a password"], correct: 0 },
  { text: "Which is a primary colour of light?", options: ["Cyan", "Yellow", "Red", "Magenta"], correct: 2 },
  { text: "What does HTTPS add to HTTP?", options: ["Larger images", "Transport encryption", "Offline browsing", "Unlimited storage"], correct: 1 },
  { text: "Which document commonly describes a project’s goals and scope?", options: ["A project brief", "A receipt", "A boarding pass", "A timesheet"], correct: 0 },
  { text: "How many sides does a hexagon have?", options: ["Four", "Five", "Six", "Eight"], correct: 2 },
] as const;
