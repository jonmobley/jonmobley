// jonmobley.com/mcp — lets AI assistants (ChatGPT, Claude, …) book Jon. See /agents/.
import type { Env } from "../server/env";
import { mcp } from "../server/agentBooking";

export const onRequest: PagesFunction<Env> = ({ request, env }) => mcp(request, env);
