import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
import { logger } from "../logger/logger";
import { logMessage } from "../utils/logMessage";
import { hasSongMetadata, getVideoDuration } from "../utils/utils";
import { AgentExecutionStatus, generateStepId } from "@nevermined-io/payments";
import { uploadVideoToIPFS } from "../utils/uploadVideoToIPFS";
import { sendFriendlySseEvent } from "../utils/sseFriendly";
import { retryOperation } from "../utils/retryOperation";
import { getBlockNumber } from "../payments/blockchain";

import {
  MUSIC_SCRIPT_GENERATOR_DID,
  SONG_GENERATOR_DID,
  VIDEO_GENERATOR_DID,
  SONG_GENERATOR_PLAN_DID,
  MUSIC_SCRIPT_GENERATOR_PLAN_DID,
  VIDEO_GENERATOR_PLAN_DID,
} from "../config/env";

import {
  validateMusicScriptTask,
  validateSongGenerationTask,
  validateImageGenerationTask,
  validateVideoGenerationTask,
} from "./taskValidation";
import { setUserRequest } from "../utils/conversationStore";
import { PlanDDOHelper } from "../payments/PlanDDOHelper";
import { ensureSufficientBalance } from "../payments/planService";

/* -------------------------------------
   Helper Functions
------------------------------------- */

/**
 * Updates the given step to a failure status with the provided error message.
 *
 * @param step - The current step object.
 * @param payments - The Payments instance.
 * @param errorMessage - The error message to output.
 * @returns {Promise<void>}
 */
async function updateStepFailure(
  step: any,
  payments: any,
  errorMessage: string
): Promise<void> {
  await logMessage(payments, {
    task_id: step.task_id,
    level: "error",
    message: errorMessage,
  });

  await payments.query.updateStep(step.did, {
    ...step,
    step_status: AgentExecutionStatus.Failed,
    output: errorMessage,
  });
}

/**
 * Executes a task using payments.query.createTask and validates it via the provided validation function.
 * If burn parameters are passed, it searches for the burn event after creating the task.
 *
 * @param payments - The Payments instance.
 * @param agentDid - The DID of the external agent.
 * @param taskData - The data payload for creating the task.
 * @param accessConfig - The access configuration for the agent.
 * @param validationFn - A function that validates the task output. It receives (taskId, agentDid, accessConfig, step, payments, extraArgs) and returns a promise with the validated artifacts.
 * @param step - The current step object.
 * @param [extraArgs] - (Optional) Additional arguments to pass to the validation function.
 * @returns {Promise<any>} - A promise that resolves with the validated task artifacts.
 */
async function executeTaskWithValidation(
  payments: any,
  agentDid: string,
  taskData: any,
  accessConfig: any,
  validationFn: (
    taskId: string,
    agentDid: string,
    accessConfig: any,
    step: any,
    payments: any,
    extraArgs?: any
  ) => Promise<any>,
  step: any,
  extraArgs?: any
): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const result = await payments.query.createTask(
      agentDid,
      taskData,
      accessConfig,
      async (cbData: any) => {
        try {
          const taskLog = JSON.parse(cbData);
          if (taskLog.task_status === AgentExecutionStatus.Completed) {
            const artifacts = await validationFn(
              taskLog.task_id,
              agentDid,
              accessConfig,
              step,
              payments,
              extraArgs
            );
            resolve(artifacts);
          } else if (taskLog.task_status === AgentExecutionStatus.Failed) {
            reject(
              new Error(
                `Task ${taskLog.task_id} failed with status: ${taskLog.task_status}`
              )
            );
          }
        } catch (err) {
          reject(err);
        }
      }
    );
    if (result.status !== 201) {
      reject(new Error(`Error creating task: ${JSON.stringify(result.data)}`));
    }
  });
}

/* -------------------------------------
   Main Event Handler
------------------------------------- */

/**
 * Processes incoming steps. This function is subscribed to "step-updated" events and routes
 * the step to the appropriate handler based on the step name.
 *
 * @param payments - The Payments instance.
 * @returns {(data: any) => Promise<void>} - An asynchronous function that processes incoming step events.
 */
export function processSteps(payments: any) {
  return async (data: any) => {
    const eventData = JSON.parse(data);
    logger.info(
      `(Music Orchestrator) Received event: ${JSON.stringify(eventData)}`
    );

    const step = await payments.query.getStep(eventData.step_id);

    // Only process steps that are Pending
    if (step.step_status !== AgentExecutionStatus.Pending) {
      logger.warn(`Step ${step.step_id} is not in Pending status. Skipping...`);
      return;
    }

    // Use a mapping of step names to handler functions for cleaner routing.
    const handlers: { [key: string]: Function } = {
      init: handleInitStep,
      callSongGenerator: handleCallSongGenerator,
      generateMusicScript: handleGenerateMusicScript,
      callImagesGenerator: handleCallImagesGenerator,
      callVideoGenerator: handleCallVideoGenerator,
      compileVideo: handleCompileVideo,
    };

    const handler = handlers[step.name];
    if (handler) {
      await handler(step, payments);
    } else {
      logger.warn(`Unrecognized step name: ${step.name}`);
    }
  };
}

/* -------------------------------------
   Step Handlers
------------------------------------- */

/**
 * Handles the "init" step by creating the entire workflow pipeline.
 *
 * @param step - The current step object for initialization.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when the workflow steps have been created and the init step is updated.
 */
export async function handleInitStep(step: any, payments: any) {
  const songStepId = generateStepId();
  const scriptStepId = generateStepId();
  const imagesStepId = generateStepId();
  const videoStepId = generateStepId();
  const compileStepId = generateStepId();

  const steps = [
    {
      step_id: songStepId,
      task_id: step.task_id,
      predecessor: step.step_id,
      name: "callSongGenerator",
      is_last: false,
    },
    {
      step_id: scriptStepId,
      task_id: step.task_id,
      predecessor: songStepId,
      name: "generateMusicScript",
      is_last: false,
    },
    {
      step_id: imagesStepId,
      task_id: step.task_id,
      predecessor: scriptStepId,
      name: "callImagesGenerator",
      is_last: false,
    },
    {
      step_id: videoStepId,
      task_id: step.task_id,
      predecessor: imagesStepId,
      name: "callVideoGenerator",
      is_last: false,
    },
    {
      step_id: compileStepId,
      task_id: step.task_id,
      predecessor: videoStepId,
      name: "compileVideo",
      is_last: true,
    },
  ];
  setUserRequest(step.task_id, step.input_query);

  sendFriendlySseEvent(
    step.task_id,
    "reasoning",
    `I have received the user's request. I will now create the entire workflow pipeline.
    First step: Song Generator.
    Second step: Music Script Generator.
    Third step: Images Generator.
    Fourth step: Video Generator.
    Fifth step: Compile Video.
    Sixth step: Upload to IPFS.`
  );

  await logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating steps for task ${step.task_id}: ${steps
      .map((s) => s.name)
      .join(", ")}`,
  });

  await payments.query.createSteps(step.did, step.task_id, { steps });

  // Mark the init step as completed.
  await payments.query.updateStep(step.did, {
    ...step,
    step_status: AgentExecutionStatus.Completed,
    output: step.input_query,
  });
}

/**
 * Invokes the Song Generator Agent to generate a song based on the provided prompt and optional lyrics.
 *
 * @param step - The current step object.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when the song generation task completes or fails.
 */
export async function handleCallSongGenerator(step: any, payments: any) {
  const planHelper = new PlanDDOHelper(payments, SONG_GENERATOR_PLAN_DID);

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating task for Song Generator Agent with prompt: "${step.input_query}"`,
  });

  sendFriendlySseEvent(
    step.task_id,
    "reasoning",
    `First step: Song generation. I will outsource this task to a Song Generator Agent.`
  );

  const hasBalance = await ensureSufficientBalance(
    planHelper,
    step,
    1,
    "Song Generator"
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    SONG_GENERATOR_DID
  );
  const prompt = step.input_query;
  const input_artifacts = hasSongMetadata(step) ? step.input_artifacts : [];
  const taskData = {
    input_query: prompt,
    name: step.name,
    input_artifacts,
  };

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Calling Song Generator Agent with prompt: "${prompt}"`,
  });

  sendFriendlySseEvent(
    step.task_id,
    "callAgent",
    `Calling Song Generator Agent to generate a song based on the user's request: "${prompt}".`
  );

  const blockNumber = await getBlockNumber();

  try {
    await retryOperation(
      () =>
        executeTaskWithValidation(
          payments,
          SONG_GENERATOR_DID,
          taskData,
          accessConfig,
          validateSongGenerationTask,
          step,
          { blockNumber }
        ),
      2,
      async (err, attempt, maxRetries) => {
        sendFriendlySseEvent(
          step.task_id,
          "warning",
          `Song generation failed (attempt ${attempt + 1}/${maxRetries + 1}): ${
            err.message
          }. Retrying...`
        );
      }
    );
  } catch (error: any) {
    sendFriendlySseEvent(
      step.task_id,
      "error",
      `Song generation task failed: ${error.message || error}`
    );
    await updateStepFailure(
      step,
      payments,
      `Song generation task failed: ${error.message || error}`
    );
  }
}

/**
 * Handles the generation of a music script by invoking the Music Script Generator Agent.
 *
 * @param step - The current step object.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when the music script generation task completes or fails.
 */
export async function handleGenerateMusicScript(step: any, payments: any) {
  const planHelper = new PlanDDOHelper(
    payments,
    MUSIC_SCRIPT_GENERATOR_PLAN_DID
  );

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating task for Music Script Generator Agent with input_query: "${step.input_query}"`,
  });

  sendFriendlySseEvent(
    step.task_id,
    "reasoning",
    `Second step: Music Script Generator.`
  );

  const hasBalance = await ensureSufficientBalance(planHelper, step);
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    MUSIC_SCRIPT_GENERATOR_DID
  );
  const taskData = {
    input_query: step.input_query,
    name: step.name,
    input_artifacts: step.input_artifacts,
  };

  const blockNumber = await getBlockNumber();
  try {
    sendFriendlySseEvent(
      step.task_id,
      "callAgent",
      `Calling Music Script Generator Agent to generate a music script based on the user's request: "${step.input_query}".`
    );
    await retryOperation(
      () =>
        executeTaskWithValidation(
          payments,
          MUSIC_SCRIPT_GENERATOR_DID,
          taskData,
          accessConfig,
          validateMusicScriptTask,
          step,
          { blockNumber }
        ),
      2,
      async (err, attempt, maxRetries) => {
        sendFriendlySseEvent(
          step.task_id,
          "warning",
          `Music script generation failed (attempt ${attempt + 1}/${
            maxRetries + 1
          }): ${err.message}. Retrying...`
        );
      }
    );
  } catch (error: any) {
    sendFriendlySseEvent(
      step.task_id,
      "error",
      `Failed to generate the task for the Music Script Generator.`
    );
    await updateStepFailure(
      step,
      payments,
      `Music script task failed: ${error.message || error}`
    );
  }
}

/**
 * Invokes the Images Generator Agent to generate images for characters and settings.
 *
 * @param step - The current step object.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when all image generation tasks complete or fail.
 */
export async function handleCallImagesGenerator(step: any, payments: any) {
  const [{ characters, settings, duration, songUrl, prompts, title }] =
    step.input_artifacts;

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating image generation tasks for ${characters.length} characters and ${settings.length} settings...`,
  });

  sendFriendlySseEvent(
    step.task_id,
    "reasoning",
    `Third step: Images Generator. Generating ${characters.length} characters and ${settings.length} settings...`
  );

  const planHelper = new PlanDDOHelper(payments, VIDEO_GENERATOR_PLAN_DID);
  const hasBalance = await ensureSufficientBalance(
    planHelper,
    step,
    characters.length + settings.length
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    VIDEO_GENERATOR_DID
  );

  /**
   * Creates an image generation task for a given subject.
   *
   * @param subject - The subject object (character or setting).
   * @param subjectType - The type of the subject, either "character" or "setting".
   * @param id - The ID of the subject.
   * @returns {Promise<any>} - A promise that resolves with the validated task artifacts.
   */
  async function createImageTask(
    subject: any,
    subjectType: "character" | "setting",
    id?: string
  ): Promise<any> {
    const taskData = {
      name: step.name,
      input_query: subject.imagePrompt,
      input_artifacts: [{ inference_type: "text2image", id }],
    };
    return executeTaskWithValidation(
      payments,
      VIDEO_GENERATOR_DID,
      taskData,
      accessConfig,
      (taskId, agentDid, accessCfg, _step, payments) =>
        validateImageGenerationTask(
          taskId,
          agentDid,
          accessCfg,
          payments,
          subject.id || subject.name,
          subjectType
        ),
      step
    );
  }

  try {
    sendFriendlySseEvent(
      step.task_id,
      "callAgent",
      `Calling Images Generator Agent to generate ${characters.length} images for characters and ${settings.length} images for settings...`
    );
    const charactersPromises = characters.map((character: any, index: number) =>
      retryOperation(
        () =>
          createImageTask(
            character,
            "character",
            "character-" + index.toString()
          ),
        2,
        async (err, attempt, maxRetries) => {
          sendFriendlySseEvent(
            step.task_id,
            "warning",
            `Image generation failed for character "${
              character.name
            }" (attempt ${attempt + 1}/${maxRetries + 1}): ${
              err.message
            }. Retrying...`
          );
        }
      )
    );
    const settingsPromises = settings.map((setting: any, index: number) =>
      retryOperation(
        () =>
          createImageTask(setting, "setting", "setting-" + index.toString()),
        2,
        async (err, attempt, maxRetries) => {
          sendFriendlySseEvent(
            step.task_id,
            "warning",
            `Image generation failed for setting "${setting.id}" (attempt ${
              attempt + 1
            }/${maxRetries + 1}): ${err.message}. Retrying...`
          );
        }
      )
    );

    const results = await Promise.all([
      ...charactersPromises,
      ...settingsPromises,
    ]);

    // Update the subjects with their generated image URL.
    results.forEach((result) => {
      if (result.subjectType === "character") {
        const char = characters.find((c: any) => c.name === result.id);
        if (char) char.imageUrl = result.url;
      } else if (result.subjectType === "setting") {
        const sett = settings.find((s: any) => s.id === result.id);
        if (sett) sett.imageUrl = result.url;
      }
    });

    sendFriendlySseEvent(
      step.task_id,
      "answer",
      `All image generation tasks completed successfully.`,
      {},
      {
        mimeType: "image/png",
        parts: [
          ...characters.map((c: any) => c.imageUrl),
          ...settings.map((s: any) => s.imageUrl),
        ],
      }
    );

    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `All image generation tasks completed successfully: 
        characters:
        ${characters.map((c: any) => c.imageUrl).join(", ")}
        settings:
        ${settings.map((s: any) => s.imageUrl).join(", ")}`,
    });

    await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      output: "All image generation tasks completed",
      cost: characters.length + settings.length,
      output_artifacts: [
        { characters, settings, duration, songUrl, prompts, title },
      ],
    });
  } catch (error: any) {
    logger.error(
      `Image generation failed: ${error.message || error}. Aborting task`
    );
    sendFriendlySseEvent(
      step.task_id,
      "error",
      `Image generation failed: ${error.message || error}. Aborting task`
    );
    await updateStepFailure(
      step,
      payments,
      `Image generation failed: ${error.message || error}`
    );
  }
}

/**
 * Creates a video generation task for a single prompt.
 *
 * This function performs one attempt to create a task. If any error occurs,
 * it is thrown so that the caller can retry as needed.
 *
 * @param promptObject - The prompt object containing video generation parameters.
 * @param settings - Array of available setting objects.
 * @param characters - Array of available character objects.
 * @param accessConfig - The access configuration for the Video Generator Agent.
 * @param payments - The Payments instance.
 * @param step - The current step object.
 * @returns {Promise<any>} - A promise resolving with validated task artifacts.
 * @throws {Error} - If the task creation or validation fails.
 */
async function createVideoTaskForPrompt(
  promptObject: any,
  settings: any[],
  characters: any[],
  accessConfig: any,
  payments: any,
  step: any,
  id?: string
): Promise<any> {
  // Select a setting: try to match promptObject.settingId; otherwise choose one at random.
  let setting = settings.find((s: any) => s.id === promptObject.settingId);
  if (!setting) {
    setting = settings[Math.floor(Math.random() * settings.length)];
  }
  // Filter characters that are included in the scene.
  const charactersInScene = characters.filter((c: any) =>
    promptObject.charactersInScene.includes(c.name)
  );

  // Build task data.
  const taskData = {
    name: step.name,
    input_query: promptObject.prompt,
    input_artifacts: [
      {
        inference_type: "text2video",
        id,
        images: [
          setting.imageUrl,
          ...charactersInScene.map((c: any) => c.imageUrl),
        ],
        duration: promptObject.duration,
      },
    ],
  };

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating video generation task for prompt: "${promptObject.prompt}"`,
  });

  // Attempt to create the task.
  return new Promise<any>((resolve, reject) => {
    payments.query
      .createTask(
        VIDEO_GENERATOR_DID,
        taskData,
        accessConfig,
        async (cbData: any) => {
          try {
            const taskLog = JSON.parse(cbData);
            if (taskLog.task_status === AgentExecutionStatus.Completed) {
              const artifacts = await validateVideoGenerationTask(
                taskLog.task_id,
                VIDEO_GENERATOR_DID,
                accessConfig,
                payments
              );
              resolve(artifacts);
            } else if (taskLog.task_status === AgentExecutionStatus.Failed) {
              reject(new Error(`Task ${taskLog.task_id} failed`));
            }
          } catch (err) {
            reject(err);
          }
        }
      )
      .then((result: any) => {
        if (result.status !== 201) {
          reject(
            new Error(
              `Error creating video generation task: ${JSON.stringify(
                result.data
              )}`
            )
          );
        }
      })
      .catch((err: any) => {
        reject(err);
      });
  });
}

/**
 * Handles video generation tasks for multiple prompts.
 *
 * @param step - The current step data.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when all video tasks complete or fails.
 */
export async function handleCallVideoGenerator(step: any, payments: any) {
  const [{ prompts, characters, settings, duration, ...inputArtifacts }] =
    step.input_artifacts;

  sendFriendlySseEvent(
    step.task_id,
    "reasoning",
    `Fourth step: Video Generator. Creating video generation tasks for ${prompts.length} scenes. each executed concurrently using the same subscription plan. This task may take a while to complete.`
  );

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating video generation tasks for ${prompts.length} scenes...`,
  });

  const planHelper = new PlanDDOHelper(payments, VIDEO_GENERATOR_PLAN_DID);
  const hasBalance = await ensureSufficientBalance(
    planHelper,
    step,
    prompts.length
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    VIDEO_GENERATOR_DID
  );

  sendFriendlySseEvent(
    step.task_id,
    "callAgent",
    `Calling Video Generator Agent to generate videos for ${prompts.length} scenes...`
  );

  // Use retryOperation to handle retries for each prompt
  const videoTaskPromises = prompts.map(
    async (promptObject: any, index: number) => {
      try {
        return await retryOperation(
          () =>
            createVideoTaskForPrompt(
              promptObject,
              settings,
              characters,
              accessConfig,
              payments,
              step,
              index.toString()
            ),
          2,
          async (err, attempt, maxRetries) => {
            sendFriendlySseEvent(
              step.task_id,
              "warning",
              `Video generation failed for prompt "${
                promptObject.prompt
              }" (attempt ${attempt + 1}/${maxRetries + 1}): ${
                err.message
              }. Retrying...`
            );
          }
        );
      } catch (error) {
        // Log the error but don't fail the entire step
        logger.error(
          `Video generation failed for prompt "${promptObject.prompt}" after all retries: ${error}`
        );
        return null;
      }
    }
  );

  try {
    const results = await Promise.all(videoTaskPromises);

    // Filter out failed attempts and count them
    const successfulVideos = results.filter(
      (result): result is string => result !== null
    );
    const failedCount = results.length - successfulVideos.length;

    if (failedCount > 3) {
      sendFriendlySseEvent(
        step.task_id,
        "error",
        `Video generation step failed: Too many video generation failures: ${failedCount} videos failed after retries`
      );
      throw new Error(
        `Too many video generation failures: ${failedCount} videos failed after retries`
      );
    }
    sendFriendlySseEvent(
      step.task_id,
      "answer",
      `Video generation completed. The final set is complete and ready for merging with the audio track.`
    );

    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `Video generation completed. Successfully generated ${successfulVideos.length} videos, ${failedCount} failed.`,
    });

    await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      cost: successfulVideos.length * 5,
      output: `Video generation completed with ${successfulVideos.length} successful videos`,
      output_artifacts: [
        { ...inputArtifacts, duration, generatedVideos: successfulVideos },
      ],
    });
  } catch (error: any) {
    sendFriendlySseEvent(
      step.task_id,
      "error",
      `Video generation step failed: ${error.message || error}. Aborting task`
    );
    logger.error(
      `Video generation step failed: ${error.message || error}. Aborting task`
    );
    await updateStepFailure(
      step,
      payments,
      `Video generation step failed: ${error.message || error}`
    );
  }
}

/* -------------------------------------
   Video Compilation Helpers
------------------------------------- */

/**
 * Retrieves durations for a list of video URLs and returns valid videos.
 *
 * @param videoUrls - Array of video URLs.
 * @returns {Promise<Array<{url: string, duration: number}>>} - Array of valid video objects.
 */
async function getValidVideos(
  videoUrls: string[]
): Promise<Array<{ url: string; duration: number }>> {
  const videoList = await Promise.all(
    videoUrls.map(async (videoUrl: string) => {
      try {
        const dur = await getVideoDuration(videoUrl);
        return { url: videoUrl, duration: dur };
      } catch (err) {
        logger.warn(
          `Skipping ${videoUrl}, failed to retrieve duration: ${
            (err as Error).message
          }`
        );
        return null;
      }
    })
  );
  return videoList.filter(
    (v): v is { url: string; duration: number } => v !== null
  );
}

/**
 * Merges multiple video clips using FFmpeg.
 *
 * @param videos - Array of valid video objects.
 * @param outputPath - The temporary output file path.
 * @returns {Promise<void>}
 */
async function mergeVideos(
  videos: Array<{ url: string; duration: number }>,
  outputPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let ffmpegChain = ffmpeg();
    videos.forEach((clip) => {
      ffmpegChain = ffmpegChain.input(clip.url);
    });
    ffmpegChain
      .complexFilter([
        { filter: "concat", options: { n: videos.length, v: 1, a: 0 } },
      ])
      .on("start", (cmd) => {
        logger.info(`FFmpeg merge (video only) started with command: ${cmd}`);
      })
      .on("error", (err) => {
        logger.error(`Error merging videos: ${(err as Error).message}`);
        reject(err);
      })
      .on("end", () => {
        logger.info("Video-only merge completed successfully.");
        resolve();
      })
      .save(outputPath);
  });
}

/**
 * Overlays an audio track onto a video using FFmpeg, trimming the audio to the specified duration.
 *
 * @param videoPath - The path of the video file.
 * @param audioUrl - The URL of the audio track.
 * @param outputPath - The final output file path.
 * @param duration - The desired duration for the audio (in seconds).
 * @returns {Promise<void>}
 */
async function addAudioToVideo(
  videoPath: string,
  audioUrl: string,
  outputPath: string,
  duration?: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let command = ffmpeg()
      .input(videoPath)
      .input(audioUrl)
      .videoCodec("copy")
      .audioCodec("aac");

    if (duration) {
      command = command.inputOptions([`-t ${duration}`]);
    }

    command
      .on("start", (cmd) => {
        logger.info(`FFmpeg final merge (audio) started with command: ${cmd}`);
      })
      .on("error", (err) => {
        logger.error(`Error adding audio track: ${(err as Error).message}`);
        reject(err);
      })
      .on("end", () => {
        logger.info("Final video with audio merged successfully.");
        resolve();
      })
      .save(outputPath);
  });
}

/**
 * Handles the "compileVideo" step by concatenating video clips,
 * overlaying audio, uploading the final output to IPFS, and updating the step.
 *
 * @param step - The current step data.
 * @param payments - The Payments instance.
 * @returns {Promise<void>}
 */
export async function handleCompileVideo(
  step: any,
  payments: any
): Promise<void> {
  try {
    const [{ generatedVideos, duration, songUrl, title }] =
      step.input_artifacts;
    sendFriendlySseEvent(
      step.task_id,
      "reasoning",
      `Fifth step: Compile Video. Compiling video clips with audio for "${title}"...`
    );
    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `Compiling video clips with audio for "${title}"...`,
    });

    if (
      !generatedVideos ||
      !Array.isArray(generatedVideos) ||
      generatedVideos.length === 0
    ) {
      throw new Error("No generated videos found for compilation.");
    }
    if (!duration || duration <= 0) {
      throw new Error("Invalid or missing song duration for compilation.");
    }
    if (!songUrl) {
      throw new Error("No song/audio URL provided for final compilation.");
    }

    const validVideos = await getValidVideos(generatedVideos);
    if (validVideos.length === 0) {
      throw new Error("No valid videos with durations were found.");
    }

    const tempOutputPath = path.join(
      "/tmp",
      `final_compilation_${Date.now()}.mp4`
    );
    await mergeVideos(validVideos, tempOutputPath);

    const finalOutputPath = path.join(
      "/tmp",
      `final_with_audio_${Date.now()}.mp4`
    );
    await addAudioToVideo(tempOutputPath, songUrl, finalOutputPath, duration);
    const convertedTitle =
      title.replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".mp4";

    sendFriendlySseEvent(
      step.task_id,
      "reasoning",
      `Compilation completed for "${title}". Uploading to IPFS...`
    );

    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `Compilation completed for "${title}". Uploading to IPFS...`,
    });

    const finalVideoUrl = await uploadVideoToIPFS(
      finalOutputPath,
      convertedTitle
    );

    sendFriendlySseEvent(
      step.task_id,
      "final-answer",
      `The final video for '${title}' is ready. Here is the link: ${finalVideoUrl}`,
      {},
      { mimeType: "video/mp4", parts: [finalVideoUrl] }
    );

    await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      cost: 1,
      output: "Video clip compilation completed",
      output_artifacts: [finalVideoUrl],
    });

    fs.unlinkSync(tempOutputPath);
    fs.unlinkSync(finalOutputPath);
  } catch (err: any) {
    sendFriendlySseEvent(
      step.task_id,
      "error",
      `Compilation failed: ${err.message || JSON.stringify(err)}`
    );
    await updateStepFailure(
      step,
      payments,
      `Compilation failed: ${err.message || JSON.stringify(err)}`
    );
  }
}
