import type { Route } from "./+types/mugs";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Kopper | Kaffe Mændene" },
    {
      name: "description",
      content: "Historien bag vores kopper",
    },
  ];
}

export default function Mugs() {
  return <section></section>;
}
