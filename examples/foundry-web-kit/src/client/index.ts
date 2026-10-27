// The browser half of the kit. Components read the --kit-* CSS variables
// (see theme.ts); the products set them with their own colours.

export { Chip, Message, Turn, avatarStyle, type Author, type MessageProps } from "./Message";
export { Thread, type ThreadProps } from "./Thread";
export { Composer, type ComposerProps } from "./Composer";
export { ApprovalCard, type ApprovalCardProps } from "./ApprovalCard";
export { useLiveRun, type LiveRun, type LiveRunOptions, type LiveStatus } from "./useLiveRun";
export { AppsScreen, type AppsScreenProps } from "./AppsScreen";
export { themeStyle, token, type KitTheme } from "./theme";
export { DeliveryLog, MockChat, MockMail, useDemoState, type MockChatProps, type MockMailInput, type MockMailProps } from "./Mock";
export type { ApprovalDecision, ApprovalView, AppSummary, DeliveryHop, DisplayMessage, DisplayTool, LiveEvent, MockBubble } from "../shared";
