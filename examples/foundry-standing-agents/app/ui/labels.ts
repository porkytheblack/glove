/** Actions as a person reads them, by rule name. */
export const ACTION_LABELS: Readonly<Record<string, string>> = {
  send_email: "Send email",
  open_draft_pr: "Open a draft pull request",
  merge_pr: "Merge a pull request",
  change_password: "Change a password",
  transfer_money: "Move money",
  delete_permanently: "Delete something for good",
  install_software: "Install software",
  buy_with_saved_card: "Buy with a saved card",
};

export const actionLabel = (name: string): string => ACTION_LABELS[name] ?? name.replaceAll("_", " ");

/** "3 minutes ago", for times the server sent. */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
