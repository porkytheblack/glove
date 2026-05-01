import { glovebox } from "glovebox"

const fakeRunnable = {
  __isFake: true,
  processRequest: async () => ({ messages: [], tokens_in: 0, tokens_out: 0 }),
  setSystemPrompt: () => undefined,
  getSystemPrompt: () => "",
  setModel: () => undefined,
  addSubscriber: () => undefined,
  removeSubscriber: () => undefined,
  fold: () => fakeRunnable,
  defineHook: () => fakeRunnable,
  defineSkill: () => fakeRunnable,
  defineMention: () => fakeRunnable,
  displayManager: {} as any,
  model: {} as any,
  serverMode: true,
}

export default glovebox.wrap(fakeRunnable, {
  name: "smoke",
  base: "glovebox/base",
  packages: { apt: ["ffmpeg"] },
})
