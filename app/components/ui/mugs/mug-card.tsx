import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";

type MugCardProps = {
  image: string;
  alt: string;
  title: string;
  description: string;
  totalUses: number;
  imageSide?: "left" | "right";
  imageClassName?: string;
};

export function MugCard({
  image,
  alt,
  title,
  description,
  totalUses,
  imageSide = "left",
  imageClassName,
}: MugCardProps) {
  const imageElement = (
    <img
      src={image}
      alt={alt}
      className={cn(
        "h-64 w-full object-cover sm:col-span-1 sm:h-full sm:min-h-72",
        imageClassName,
      )}
    />
  );

  const contentElement = (
    <CardContent className="flex flex-col justify-center px-6 py-8 sm:col-span-2 sm:px-10">
      <h2 className="text-xl font-semibold tracking-[0.2em] uppercase">
        {title}
        <span className="ml-2 text-zinc-500 tracking-tight normal-case">
          {totalUses} uses
        </span>
      </h2>
      <p className="mt-3 leading-7 text-zinc-300">{description}</p>
    </CardContent>
  );

  return (
    <Card className="grid gap-0 overflow-hidden border-zinc-800 bg-zinc-950/80 py-0 ring-0 sm:grid-cols-3">
      {imageSide === "left" ? (
        <>
          {imageElement}
          {contentElement}
        </>
      ) : (
        <>
          {contentElement}
          {imageElement}
        </>
      )}
    </Card>
  );
}
