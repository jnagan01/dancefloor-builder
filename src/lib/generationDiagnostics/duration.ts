/** Presentation only: stored/copy values remain exact seconds and milliseconds. */
export function activityDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), remainder = total % 60;
  return [hours ? `${hours} hr` : '', minutes ? `${minutes} min` : '', remainder || !total ? `${remainder} sec` : ''].filter(Boolean).join(' ');
}