import { cn } from "@/lib/utils";

/**
 * A placeholder for content that has not arrived.
 *
 * `motion-safe:` on the pulse, rather than relying on the stylesheet's
 * reduced-motion block alone. The class was previously bare `animate-pulse`, so
 * a person who had asked their operating system to stop motion got it on every
 * page in the platform - the most persistent piece of unwanted motion in the
 * product. Handling it at the point of use as well means the intent travels with
 * the component, so a skeleton rendered somewhere that has opted out of the
 * global stylesheet still behaves.
 *
 * The placeholder stays either way. Without the pulse it is still a grey block
 * in the right place, which is the honest "this is where the data will be" that
 * the movement was only ever emphasising.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-accent motion-safe:animate-pulse rounded-md",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
