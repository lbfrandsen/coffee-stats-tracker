import type { Route } from "./+types/status";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Raspberry Pi Status | Kaffe Mændene" },
    {
      name: "description",
      content: "Check the status of the Raspberry Pi in our kitchen.",
    },
  ];
}

export default function Status() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Status</h1>

      <div className="mt-6 space-y-4 text-sm leading-7 text-zinc-300">
        <p>Placeholder</p>

        <p>Placeholder</p>
      </div>
    </section>
  );
}
