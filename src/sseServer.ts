import express from "express";
import cors from "cors";
import { Request, Response } from "express";

/**
 * In-memory structure to keep track of SSE clients per taskId.
 * { [taskId: string]: Response[] }
 */
const clients: Record<string, Response[]> = {};

/**
 * Express app for SSE.
 */
const app = express();
app.use(cors());

/**
 * SSE endpoint for task events.
 * @route GET /tasks/events/:taskId
 */
app.get("/tasks/events/:taskId", (req: Request, res: Response) => {
  const { taskId } = req.params;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  // Add this client to the list for this taskId
  if (!clients[taskId]) clients[taskId] = [];
  clients[taskId].push(res);

  // Remove client on close
  req.on("close", () => {
    clients[taskId] = clients[taskId].filter((client) => client !== res);
  });
});

/**
 * Send an SSE event to all clients listening to a specific taskId.
 * @param taskId - The task ID
 * @param event - The event object { content, type }
 */
export function sendSseEvent(
  taskId: string,
  event: {
    content: string;
    type:
      | "reasoning"
      | "answer"
      | "final-answer"
      | "transaction"
      | "nvm-transaction-agent"
      | "error"
      | "warning"
      | "callAgent";
    planDID?: string;
    agentDID?: string;
    txHash?: string;
    [key: string]: any;
  }
) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  if (clients[taskId]) {
    clients[taskId].forEach((res) => res.write(data));
  }
}

/**
 * Start the SSE server.
 * @param port - Port to listen on
 */
export function startSseServer(port: number = 3001) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`SSE server listening on port ${port}`);
  });
}
