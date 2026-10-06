import { Star } from "lucide-react";
import { cn } from "cn";

/**
 * Five stars, filled to the rating. A number is also printed for screen
 * readers and for anyone who cannot tell 3.5 filled stars from 4 at 12px.
 */
export function RatingStars({ rating, size = 12, className }: { rating: number | null | undefined; size?: number; className?: string }) {
  if (rating === null || rating === undefined) {
    return <span className={cn("text-muted-foreground/70 text-xs", className)}>No rating</span>;
  }
  const rounded = Math.round(rating);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${rating} out of 5`} title={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map((step) => (
        <Star
          key={step}
          aria-hidden
          style={{ width: size, height: size }}
          className={step <= rounded ? "fill-warning text-warning" : "text-muted-foreground/30"}
        />
      ))}
      <span className="sr-only">{rating} out of 5</span>
    </span>
  );
}
