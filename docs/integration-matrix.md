# Integration Matrix

| Integration | Status | Primary path | Notes |
|---|---|---|---|
| Node.js SDK | Supported | `createAgentGate`, `protect`, `createRuntime` | Primary developer experience |
| TypeScript | Supported via Node API | SDK exports | Types can be layered by the consuming project |
| MCP | Supported | MCP Gateway | Runtime enforcement + approval |
| HTTP Control Plane | Supported | `/api/*` | Auth/tenant scoping required in production |
| PostgreSQL | Supported | `PostgresStoreAdapter` | RLS + tenant scope |
| Supabase | Supported | `createSupabaseAdapter` | Use RLS and tenant predicates |
| OpenAI Agents | Integration pattern | Protect the side-effecting tool | No vendor lock-in claim |
| Anthropic agents | Integration pattern | Protect the side-effecting tool/MCP path | Validate SDK/tool adapter in pilot |
| LangChain | Integration pattern | Protect the tool boundary | Validate in pilot |
| Vercel AI | Integration pattern | Protect server-side tool handlers | Do not expose server secrets to browser |
| Python/.NET/Go | Not first-class SDKs | HTTP/MCP boundary | Use Control Plane/MCP until native SDK exists |

AgentGate should not claim native framework support unless the integration has a maintained example and release test.
