import { AgentExecutionStatus } from "@nevermined-io/payments";
import { logger } from "../logger/logger";
import { logMessage } from "../utils/logMessage";
import { sendFriendlySseEvent } from "../utils/sseFriendly";

/**
 * Validates the result of a song generation task, marking the step as completed with song details.
 *
 * @async
 * @function validateSongGenerationTask
 * @param {string} taskId - The ID of the sub-task.
 * @param {string} agentDid - The DID of the agent that generated the song.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} parentStep - The parent step to update.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function validateSongGenerationTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  parentStep: any,
  payments: any
) {
  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );

  const [{ title, tags, lyrics, songUrl, duration }] =
    taskResult.data.task.output_artifacts;
  const idea = parentStep.input_query;

  const result = await payments.query.updateStep(parentStep.did, {
    ...parentStep,
    step_status: AgentExecutionStatus.Completed,
    output: title,
    output_artifacts: { title, tags, lyrics, songUrl, duration, idea },
  });
  if (result.status === 201) {
    sendFriendlySseEvent(
      parentStep.task_id,
      "answer",
      `Song ${title} generated successfully: ${songUrl}`,
      { agentDID: agentDid },
      { mimeType: "audio/mp3", parts: [songUrl] }
    );
  } else {
    sendFriendlySseEvent(
      parentStep.task_id,
      "error",
      `Error generating song: ${JSON.stringify(result.data)}`
    );
  }

  logMessage(payments, {
    task_id: parentStep.task_id,
    level: result.status === 201 ? "info" : "error",
    message:
      result.status === 201
        ? `Song ${title} generated successfully: ${songUrl}`
        : `Error storing generated song data: ${JSON.stringify(result.data)}`,
  });
}

/**
 * Validates the result of a music script generation task, marking the parent step as completed if successful.
 *
 * @async
 * @function validateMusicScriptTask
 * @param {string} taskId - The ID of the sub-task in question.
 * @param {string} agentDid - The DID of the agent that executed the task.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} parentStep - The parent step that initiated this task.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function validateMusicScriptTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  parentStep: any,
  payments: any
) {
  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );
  const taskData = taskResult.data;

  if (taskData.task.task_status !== AgentExecutionStatus.Completed) {
    return;
  }
  const [{ script, transformedScenes, characters, settings }] =
    taskData.task.output_artifacts;
  const { tags, lyrics, duration, songUrl, title } = parentStep.input_artifacts;

  const result = await payments.query.updateStep(parentStep.did, {
    ...parentStep,
    step_status: AgentExecutionStatus.Completed,
    output:
      taskData.task.output || "Music script generation encountered an error.",
    output_artifacts: [
      {
        tags,
        lyrics,
        duration,
        settings,
        songUrl,
        prompts: transformedScenes,
        characters,
        title,
        script,
      },
    ],
  });
  if (result.status === 201) {
    sendFriendlySseEvent(
      parentStep.task_id,
      "answer",
      `Script and prompts generated successfully for song ${title}.`,
      { agentDID: agentDid },
      {
        mimeType: "text/plain",
        parts: [script],
      }
    );
  } else {
    sendFriendlySseEvent(
      parentStep.task_id,
      "error",
      `Error generating music script data: ${JSON.stringify(result.data)}`
    );
  }

  logMessage(payments, {
    task_id: parentStep.task_id,
    level: result.status === 201 ? "info" : "error",
    message:
      result.status === 201
        ? `Music script generated successfully for song ${title}`
        : `Error generating music script data: ${JSON.stringify(result.data)}`,
  });
}
/**
 * Validates the result of a single image generation task, returning the artifacts produced (e.g., image url).
 *
 * @async
 * @function validateImageGenerationTask
 * @param {string} taskId - The ID of the sub-task.
 * @param {string} agentDid - The DID of the agent that generated the image.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} parentStep - The parent step that initiated this task.
 * @param {any} payments - The Nevermined Payments instance.
 * @param {string} id - The ID of the subject.
 * @param {string} subjectType - The type of subject (setting or character).
 * @returns {Promise<{ id: string; subjectType: string; url: string }>} - Returns the ID, type, and URL of the generated image.
 */
export async function validateImageGenerationTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  payments: any,
  id: string,
  subjectType: "setting" | "character"
): Promise<{ id: string; subjectType: string; url: string }> {
  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );
  const url = taskResult.data.task.output_artifacts[0];

  return {
    id,
    subjectType,
    url,
  };
}

/**
 * Validates the result of a single video generation task, returning the artifacts produced (e.g., video URLs, durations).
 *
 * @async
 * @function validateVideoGenerationTask
 * @param {string} taskId - The ID of the sub-task.
 * @param {string} agentDid - The DID of the agent that generated the video.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<string[]>} - Returns the artifacts array from the video generator (URLs, durations, etc.).
 */
export async function validateVideoGenerationTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  payments: any
): Promise<string[]> {
  logger.info(`Validating video generation task ${taskId}...`);

  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );
  const artifacts = taskResult.data.task.output_artifacts;

  return artifacts[0] ?? null;
}

/**
 * Validates the final compilation step that combines video clips and overlays the audio track.
 *
 * @async
 * @function validateCompileVideoTask
 * @param {string} taskId - The ID of the sub-task.
 * @param {string} agentDid - The DID of the agent that performed the compilation.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} parentStep - The parent step to update.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function validateCompileVideoTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  parentStep: any,
  payments: any
) {
  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );
  const taskData = taskResult.data;

  if (taskData.task.task_status !== AgentExecutionStatus.Completed) {
    return;
  }

  const result = await payments.query.updateStep(parentStep.did, {
    ...parentStep,
    step_status: AgentExecutionStatus.Completed,
    output: "Final compiled music video ready",
    output_artifacts: taskData.task.output_artifacts || [],
  });

  logMessage(payments, {
    task_id: parentStep.task_id,
    level: result.status === 201 ? "info" : "error",
    message:
      result.status === 201
        ? `Final music video is available at step ${parentStep.step_id}.`
        : `Error storing final music video data: ${JSON.stringify(
            result.data
          )}`,
  });
}
