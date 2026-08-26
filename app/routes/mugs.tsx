import { env } from "cloudflare:workers";

import type { Route } from "./+types/mugs";
import { MugCard } from "~/components/ui/mugs/mug-card";

type CupUsageRow = {
  name: string;
  total_uses: number;
};

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Kopper | Kaffe Mændene" },
    {
      name: "description",
      content: "Historien bag vores kopper",
    },
  ];
}

export async function loader() {
  const { results } = await env.DB.prepare(
    `
      SELECT c.name, COUNT(d.id) AS total_uses
      FROM cups c
      LEFT JOIN drinks d ON d.cup_id = c.id
      GROUP BY c.id, c.name
    `,
  ).all<CupUsageRow>();

  return { cupUsage: results };
}

export default function Mugs({ loaderData }: Route.ComponentProps) {
  const totalUsesByName = Object.fromEntries(
    loaderData.cupUsage.map((cup) => [cup.name, cup.total_uses]),
  );
  const getTotalUses = (cupName: string) => totalUsesByName[cupName] ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* <h1 className="text-2xl font-semibold tracking-tight">Vores kopper</h1> */}

      <section className="mt-6 space-y-6" aria-label="Kopper">
        <MugCard
          image="https://assets.kaffe.lucasfrandsen.dk/mugs-pics/fck-kop.webp"
          alt="fck-kop"
          title="F.C. København Koppen"
          totalUses={getTotalUses("FCK Kop")}
          description="Det er uvist, hvor længe Paven har ejet FCK koppen, men det er tæt på at være lige så mange år, som han har tilbragt på denne Jord.
          Et kvalificeret gæt er, at koppen er fra 2007-8 stykker, og dermed selvsagt har stor affektionsværdi for manden, som pt. har det største koffeinproblem i lejligheden.
          I dens spæde tid blev koppen mest brugt til sodavand og kakao, især når onkel Stig var på besøg, eftersom manden er Brøndby fan. I disse dage bruges den udelukkende til misbruget, og udgør en uproprtionel stor andel af det totale antal serveringer sammenlignet med antal kopper til rådighed.
          Naturligvis står den også tilbage som minde om en tid, hvor FCK lignede et hold, som på et tidspunkt havde set en fodbold før i deres liv. Det var tider."
        />

        <MugCard
          image="https://assets.kaffe.lucasfrandsen.dk/mugs-pics/blå-ikea-cup.webp"
          alt="blå-ikea-kop"
          title="Den Blå IKEA Kop"
          totalUses={getTotalUses("Blå IKEA Kop")}
          description="I sommeren 2026 får Burger Lars et nyt bekendtskab, som, i modsætning til ham selv, har to X-kromosomer og ikke ét af hver. Hun viser sig at være rigtig dygtig til det såkaldte latté art - så selvfølgelig skal Burger Lars dermed være barista.
          Førnævnte kvinde har ladet sig fortælle, at en lavere og bredere kop (samt mælk med høj fedtprocent) er idéel til latté arten - og hermed er Den Blå IKEA kop født. Hvad man ikke gør for kvinder."
          imageSide="right"
        />

        <MugCard
          image="https://assets.kaffe.lucasfrandsen.dk/mugs-pics/royal-cph-kop.webp"
          alt="royal-cph-kop"
          title="Royal Copenhagen Koppen"
          totalUses={getTotalUses("Royal Copenhagen Kop")}
          description="Paven har fået (eller, lånt på meget ubestemt tid) to Royal Copenhagen kopper af sin mor, og det er han naturligvis utroligt taknemmelig for - primært fordi der er intet scnearie, hvor han selv ville have haft råd til at købe Royal Copenhagen på SU.
          Når det kommer til det håndmalede Royal Copenhagen, så kan prisen, til en vis grad, retfærdiggøres af arbejdet der ligger heri - men når det gælder helt blanke, hvide kopper, så er prisen totalt til grin, og det er komplet uforståeligt, at den holdning ikke er mere udbredt blandt danskerne. Det burde ikke være muligt at slippe afsted med.
          Med det sure opstød overstået, så er det dog en rigtig fin kop - man brænder sig ikke når man drikker af den, den har overlevet et par klassiske fald fra skabet til vasken - men mest af alt er den til for affektionsværdi: Det er trods alt mor, der har introduceret koppen, og man lytter ALTID til mor."
          imageClassName="object-contain [transform:rotateY(180deg)]"
        />

        <MugCard
          image="https://assets.kaffe.lucasfrandsen.dk/mugs-pics/eva-trio-cup.webp"
          alt="eva-trio-kop"
          title="Eva-Trio Koppen"
          totalUses={getTotalUses("Eva Trio Kop")}
          description="Der er ikke så meget at sige om Eva-Trio koppen. Den tilhører Burgar Lars, og han har fået den af sin familie.
          Den er fin at drikke af, mærket tager grotesk overpris for en gennemsnitlig kop, som er markant mindre værd end den sælges for - minder lidt om et andet mærke, vi har gennemgået allerede."
          imageSide="right"
        />

        <MugCard
          image="https://assets.kaffe.lucasfrandsen.dk/mugs-pics/munchen-kop.webp"
          alt="fck-kop"
          title="München Koppen"
          totalUses={getTotalUses("München Kop")}
          description="I efteråret 2025 er Paven på udveksling i det nordlige Norge, og inden for to uger smadrer han sin eneste kaffekop - med et koffeinproblem af den størrelse her, så er det jo en katastrofe.
          Paven får dog en rigtig tæt ven ved navn Matthias, som er en rigtig bror. Matthias er født og opvokset i München, Tyskland, og giver, uden at tøve, Paven denne kaffekop, som han har tilovers.
          Pavens udvekslingsophold er dermed reddet, og han er forevigt taknemmelig for Matthias' generøsitet. München koppen kom selvfølgelig med hjem til Danmark, først Lyngby, så Frederiksberg og nu endeligt i Lunden, hvor den hører hjemme. Den bærer dermed stor affektionsværdi, og vil forevigt være et højtelsket minde i samlingen."
        />

        <MugCard
          image="https://assets.kaffe.lucasfrandsen.dk/mugs-pics/ruc-kop.webp"
          alt="ruc-kop"
          title="Arbejdsløshedskoppen"
          totalUses={getTotalUses("Arbejdsløshedskoppen")}
          description="Navnet på koppen giver først mening, når man også kan se koppen med dens påførte logo. Umiddelbart behøves der ikke yderligere uddybning..."
          imageSide="right"
        />

        <MugCard
          image="https://assets.kaffe.lucasfrandsen.dk/mugs-pics/dtu-kemi-kop.webp"
          alt="dtu-kemi-kop"
          title="DTU Kemi Koppen"
          totalUses={getTotalUses("DTU Kemi Kop")}
          description="DTU koppen er den mindst brugte kop i samlingen. Paven læser ikke kemi, men fik dog 10 i sit eneste kemikursus, hvilket i nogen grad berettiger dens eksistens. Hvordan den har fundet sin vej ind i samlingen er nok bedst, at man ikke bekymrer sig om."
        />
      </section>
    </main>
  );
}
