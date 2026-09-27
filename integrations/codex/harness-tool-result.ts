import type { CallToolResult, TextContent } from "@modelcontextprotocol/server";
import { Cause, Exit, Option } from "effect";
import type { HarnessFailure, NativeReceipt } from "./harness-domain.ts";

const retry =
  "Not confirmed. Local connection unavailable, revoked, or this id conflicts with an earlier note. Preserve the original id and text; inspect AI Harness in Wellspent.";

function unconfirmed(): CallToolResult {
  return { isError: true, content: [{ type: "text", text: retry }] };
}

function receiptResult(id: string, receipt: NativeReceipt): CallToolResult {
  const content: TextContent[] = [
    {
      type: "text",
      text: JSON.stringify({
        id: id.toLowerCase(),
        status: receipt.status,
        reason: receipt.reason,
        nativeReceivedAt: receipt.nativeReceivedAt,
      }),
    },
  ];
  if (receipt.status !== "acknowledged")
    content.push({ type: "text", text: retry });
  return { isError: receipt.status !== "acknowledged", content };
}

export function logWorkToolResult(
  id: string,
  exit: Exit.Exit<NativeReceipt, HarnessFailure>,
): CallToolResult {
  if (Exit.isSuccess(exit)) return receiptResult(id, exit.value);
  // Interruption and defects never imply rollback or expose private causes.
  if (Cause.hasInterrupts(exit.cause)) return unconfirmed();
  if (Cause.hasDies(exit.cause)) return unconfirmed();
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure) && failure.value.receipt) {
    return receiptResult(id, failure.value.receipt);
  }
  return unconfirmed();
}
