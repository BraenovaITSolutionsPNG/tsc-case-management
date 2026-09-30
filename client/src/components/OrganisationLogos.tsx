import nationalEmblem from "@assets/logos-img/National_emblem_of_Papua_New_Guinea.png";
import tscLogo from "@assets/logos-img/tsc-logo.png";
import { cn } from "@/lib/utils";
import Image from "next/image";

/**
 * The two organisation marks, shown together at the head of the navigation.
 *
 * Both source images are 4:3 landscape artwork rather than square emblems, so
 * every slot renders them with `object-contain`. A logo stretched to fill its
 * box is the single most recognisable way to make a government system look
 * unofficial, and the letterboxing is the cheaper of the two mistakes.
 *
 * They are imported as modules rather than referenced from `public/` so the
 * build can fingerprint and optimise them. The national emblem is a 695 KB PNG,
 * which is over 100× the pixels any of these slots can show, so serving it
 * unoptimised would push nearly a megabyte onto an officer's first page load
 * for a 40-pixel image.
 *
 * The two slots that use this (the expanded header and the collapsed footer) are
 * the same pair at two sizes, so the marks are defined once here rather than
 * repeated — the placeholder boxes this replaced had drifted into describing the
 * second mark as a Department of Education logo, which it is not.
 */

const MARKS = [
  {
    src: tscLogo,
    alt: "Teachers Service Commission logo",
    short: "TSC",
    title: "Kenya Teachers Service Commission",
  },
  {
    src: nationalEmblem,
    alt: "National emblem of Papua New Guinea",
    short: "PNG",
    title: "National emblem of Papua New Guinea",
  },
] as const;

export function OrganisationLogos({
  className,
  markClassName,
  sizes = "96px",
  width = 96,
  height = 72,
  framed = true,
}: {
  className?: string;
  /** Sized per slot: the expanded header and the collapsed footer differ. */
  markClassName?: string;
  /**
   * The width the marks actually paint at, which is what lets the browser pick
   * a small candidate from the srcset.
   *
   * Both slots fix the *height* and letterbox horizontally, so the painted
   * width is the height scaled by each source's aspect ratio — about 64px for
   * the header and 43px for the footer, against sources of 800 and 1720px
   * wide. Without this the optimiser falls back to the intrinsic size and
   * serves a 3840px-wide emblem into a 48px box, which is the exact cost the
   * module import was meant to avoid.
   */
  sizes?: string;
  /**
   * Nominal paint size, 4:3 to match both sources. `sizes` alone is not enough:
   * it governs the srcset but leaves `src` pointing at the largest candidate,
   * and `src` is what a client without srcset support actually downloads.
   * The CSS in `markClassName` still governs layout — these only feed the
   * optimiser and the intrinsic aspect ratio.
   */
  width?: number;
  height?: number;
  /**
   * Whether each mark sits in a bordered white tile.
   *
   * True in the navigation, where the marks have to hold their own against the
   * sidebar. False on the sign-in screen, where they stand directly on the
   * colour field of the brand panel and a tile around each one reads as a
   * third box in a composition that has two.
   */
  framed?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {MARKS.map(mark => (
        <span
          key={mark.short}
          title={mark.title}
          className={cn(
            "flex min-w-0 items-center justify-center",
            framed &&
              "overflow-hidden rounded-md border border-slate-200 bg-white",
            markClassName
          )}
        >
          <Image
            src={mark.src}
            alt={mark.alt}
            width={width}
            height={height}
            sizes={sizes}
            className={
              framed
                ? "h-full w-full object-contain"
                : // Unframed, the slot is as wide as the mark's own aspect makes
                  // it: two marks sharing one 4:3 box would letterbox the
                  // narrower one to a third of its height, which is how a pair
                  // of crests ends up looking like one crest and a squint.
                  "h-full w-auto object-contain"
            }
          />
        </span>
      ))}
    </div>
  );
}
