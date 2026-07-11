import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Kaffe Maendene" },
    {
      name: "description",
      content: "Coffee tracking dashboard",
    },
  ];
}

export default function Home() {
  return (
    <>
      <section
        id="leaderboard"
        className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
      />
    </>
  );
}
