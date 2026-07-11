import type { Route } from "./+types/info";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Info | Kaffe Mændene" },
    {
      name: "description",
      content: "Information about Kaffe Mændene.",
    },
  ];
}

export default function Info() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Hvad foregår der her?
      </h1>

      <div className="mt-6 space-y-4 text-sm leading-7 text-zinc-300">
        <p>
          Velkommen til projektet, hvor vi besvarer spørgsmålet, som ingen har
          stillet: Hvem drikker egentlig mest kaffe herhjemme?
        </p>

        <p>
          Hver af vores kaffekopper har fået monteret en NFC-chip i bunden. Når
          en ny kop kaffe bliver lavet, bliver koppen scannet, tidspunktet
          registreret, og misbruget er hermed dokumenteret forevigt i skyen.
        </p>

        <p>
          Dermed registrerer vi ikke blot hvor mange kopper og hvornår, vi
          drikker, vi registrerer fra præcis hvilken kop der bliver drukket - og
          dermed også hvem der drikker mest, og hvilken kop der er
          yndlingskoppen.
        </p>

        <p>
          En Raspberry Pi holder øje med scannerens aktivitet og sender
          registreringerne videre til vores database i skyen. Herfra bliver de
          omdannet til statistikker, historik og rangliste over husstandens
          kaffeforbrug.
        </p>

        <p>
          Siden er derfor både et dashboard, et unødvendigt avanceret
          hjemmeprojekt og et digitalt bevismateriale til næste gang jeg får
          lort for at drikke uproportionelt mere kaffe end min roomie.
        </p>

        <p>Tallene lyver ikke. Det gør kaffedrikkere til gengæld indimellem.</p>
      </div>
    </section>
  );
}
