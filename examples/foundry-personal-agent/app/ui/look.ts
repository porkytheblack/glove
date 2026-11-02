// What the person can pick for their agent's look. Stored on the instance as
// `context.persona.avatar` (the key); the app draws the colour.

export const AVATARS = [
  { key: "green", label: "Green", color: "#1F6B4E" },
  { key: "blue", label: "Blue", color: "#2E5E8C" },
  { key: "amber", label: "Amber", color: "#9A6416" },
  { key: "plum", label: "Plum", color: "#6B3E6E" },
] as const;

export type AvatarKey = (typeof AVATARS)[number]["key"];

export const isAvatar = (value: unknown): value is AvatarKey => AVATARS.some((avatar) => avatar.key === value);

export const avatarColor = (key: string | undefined): string => AVATARS.find((avatar) => avatar.key === key)?.color ?? AVATARS[0].color;
