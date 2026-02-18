import type z from "zod";
import type { ReactNode } from "react";
import type {
  ToolConfig,
  ToolDisplay,
  TypedDisplay,
  SlotDisplayStrategy,
  ToolResultData,
} from "./types";

interface DefineToolConfig<
  I extends z.ZodType,
  D extends z.ZodType,
  R extends z.ZodType = z.ZodVoid,
> {
  name: string;
  description: string;
  inputSchema: I;
  displayPropsSchema?: D;
  resolveSchema?: R;
  displayStrategy?: SlotDisplayStrategy;
  requiresPermission?: boolean;
  do: (
    input: z.infer<I>,
    display: TypedDisplay<z.infer<D>, z.infer<R>>,
  ) => Promise<unknown>;
  render?: (props: {
    props: z.infer<D>;
    resolve: (value: z.infer<R>) => void;
    reject: (reason?: string) => void;
  }) => ReactNode;
  renderResult?: (props: {
    data: unknown;
    output?: string;
    status: "success" | "error";
  }) => ReactNode;
}

export function defineTool<
  I extends z.ZodType,
  D extends z.ZodType,
  R extends z.ZodType = z.ZodVoid,
>(config: DefineToolConfig<I, D, R>): ToolConfig<z.infer<I>> {
  return {
    name: config.name,
    description: config.description,
    // Safe cast: I extends z.ZodType, so I is assignable to z.ZodType<z.infer<I>>
    // but Zod v4 internals make this hard to express generically
    inputSchema: config.inputSchema as any,
    requiresPermission: config.requiresPermission,
    displayStrategy: config.displayStrategy,

    do: async (input: z.infer<I>, display: ToolDisplay): Promise<ToolResultData> => {
      const typed: TypedDisplay<z.infer<D>, z.infer<R>> = {
        pushAndWait: (data) => display.pushAndWait({ input: data }),
        pushAndForget: (data) => display.pushAndForget({ input: data }),
      };

      const result = await config.do(input, typed);

      // Auto-wrap raw return values into ToolResultData
      if (
        result !== null &&
        typeof result === "object" &&
        "status" in result &&
        "data" in result
      ) {
        return result as ToolResultData;
      }
      return { status: "success", data: result };
    },

    render: config.render
      ? (slotProps) =>
          config.render!({
            props: slotProps.data,
            resolve: slotProps.resolve as (value: z.infer<R>) => void,
            reject: slotProps.reject,
          })
      : undefined,

    renderResult: config.renderResult,
  };
}
