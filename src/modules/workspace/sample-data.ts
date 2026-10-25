export type SampleRow = { title: string; detail: string; status: string };
export const sampleData: Record<string, SampleRow[]> = {
  tasks: [
    {
      title: "Review brand discovery deck",
      detail: "Brand refresh · Design · Due Monday",
      status: "In progress",
    },
    {
      title: "Prepare campaign concept notes",
      detail: "Launch campaign · Strategy · Due Tuesday",
      status: "To do",
    },
    {
      title: "Share weekly delivery summary",
      detail: "Operations · Due Friday",
      status: "To do",
    },
  ],
  projects: [
    {
      title: "Brand refresh",
      detail: "Strategy & Design · 3 of 8 milestones complete",
      status: "In progress",
    },
    {
      title: "Launch campaign",
      detail: "Communications · Concept development",
      status: "Planning",
    },
    {
      title: "Studio knowledge library",
      detail: "Operations · Internal initiative",
      status: "In review",
    },
  ],
  chat: [
    {
      title: "# studio",
      detail: "Sample teammate: The concept deck is ready for review.",
      status: "Channel",
    },
    {
      title: "# announcements",
      detail: "Sample operations: Please add topics for the team check-in.",
      status: "Channel",
    },
  ],
  meetings: [
    {
      title: "Studio check-in",
      detail: "Monday · 09:30–10:00 WAT · Example schedule",
      status: "Internal",
    },
    {
      title: "Concept review",
      detail: "Tuesday · 14:00–15:00 WAT · No meeting created",
      status: "Review",
    },
  ],
  recognition: [
    {
      title: "Thoughtful collaboration",
      detail:
        "Sample teammate A thanked Sample teammate B for clear creative feedback.",
      status: "Teamwork",
    },
    {
      title: "Going the extra mile",
      detail: "Sample teammate C supported the studio knowledge library.",
      status: "Appreciation",
    },
  ],
  directory: [
    {
      title: "Sample teammate A",
      detail: "Brand strategist · Strategy department",
      status: "Fictional profile",
    },
    {
      title: "Sample teammate B",
      detail: "Visual designer · Design department",
      status: "Fictional profile",
    },
    {
      title: "Sample teammate C",
      detail: "Operations coordinator · Operations department",
      status: "Fictional profile",
    },
  ],
  announcements: [
    {
      title: "A shared home for our work",
      detail:
        "Sample announcement · Explore the workspace and share ideas with your team.",
      status: "Studio news",
    },
  ],
};
