/** True if the JSON-RPC endpoint answers eth_blockNumber within timeoutMs. */
export async function rpcReachable(url: string, timeoutMs = 1000): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: unknown };
    return typeof body.result === "string";
  } catch {
    return false;
  }
}
