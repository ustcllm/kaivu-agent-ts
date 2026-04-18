import { marked } from "/vendor/marked.esm.js";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const chatForm = document.querySelector("#chatForm");
const messages = document.querySelector("#messages");
const queryInput = document.querySelector("#queryInput");
const modelSelect = document.querySelector("#modelSelect");
const continueButton = document.querySelector("#continueButton");
const sendButton = document.querySelector("#sendButton");
const saveFixtureButton = document.querySelector("#saveFixtureButton");
const loadFixtureButton = document.querySelector("#loadFixtureButton");
const clearFixtureButton = document.querySelector("#clearFixtureButton");
const fixtureStatus = document.querySelector("#fixtureStatus");
const fixtureSelect = document.querySelector("#fixtureSelect");

const STAGE_FIXTURE_KEY = "kaivu.stageFixture.v1";
const STAGE_FIXTURES_KEY = "kaivu.stageFixtures.v2";

let activeController = null;
let activeTimer = null;
let pendingReview = null;
let activeStageOutputHtml = "";
let activeFinalStageOutputHtml = "";
let activeStatusInfo = "";
let activeProgressItems = [];
let activeSubstageOutputs = [];
let activeRuntimeModel = "";
let activeLiveOutputText = "";
let activeLiveStage = "";
let activeStreamQueue = "";
let activeStreamTimer = null;
let activePendingStageOutputHtml = "";
let activeStageComplete = false;
let processedDetailsOpen = false;
let canSaveCurrentStage = false;

continueButton.addEventListener("click", () => {
  if (!pendingReview || activeController) return;
  const note = queryInput.value.trim();
  runResearchTurn(note, {
    showUserMessage: Boolean(note),
    stageInteractionAction: "proceed_to_next_stage",
  });
});

saveFixtureButton.addEventListener("click", () => {
  if (!pendingReview) return;
  saveStageFixture(pendingReview);
});

loadFixtureButton.addEventListener("click", () => {
  const fixtures = loadStageFixtures();
  if (fixtures.length > 1 && fixtureSelect.hidden) {
    fixtureSelect.hidden = false;
    fixtureSelect.focus();
    updateFixtureControls();
    return;
  }
  const fixture = selectedStageFixture();
  if (!fixture) return;
  loadSelectedFixture(fixture);
});

clearFixtureButton.addEventListener("click", () => {
  const fixture = selectedStageFixture();
  if (fixture?.id) {
    saveStageFixtures(loadStageFixtures().filter((item) => item.id !== fixture.id));
  } else {
    localStorage.removeItem(STAGE_FIXTURE_KEY);
  }
  updateFixtureControls();
});

fixtureSelect.addEventListener("change", () => {
  const fixture = selectedStageFixture();
  if (!fixture) return;
  loadSelectedFixture(fixture);
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (activeController) {
    activeController.abort();
    return;
  }

  const query = queryInput.value.trim();
  if (!query && !pendingReview) return;
  await runResearchTurn(query, {
    showUserMessage: Boolean(query),
    stageInteractionAction: pendingReview ? "revise_current_stage" : undefined,
  });
});

async function runResearchTurn(query, options = {}) {
  const reviewForRequest = pendingReview;
  if (options.showUserMessage !== false) {
    appendMessage("user", query);
  }
  queryInput.value = "";
  updateContinueButton(false);
  activeStageOutputHtml = "";
  activeFinalStageOutputHtml = "";
  activeStatusInfo = `Model: ${selectedModelLabel()}`;
  activeProgressItems = [];
  activeSubstageOutputs = [];
  activeRuntimeModel = selectedModelLabel();
  activeLiveOutputText = "";
  activeLiveStage = "";
  activeStageComplete = false;
  processedDetailsOpen = false;
  canSaveCurrentStage = false;
  resetStreamBuffer();

  const statusMessage = appendMessage("assistant", "");
  renderStatusInto(statusMessage, 0, "Starting");
  setBusy(true);

  activeController = new AbortController();
  const startedAt = Date.now();
  activeTimer = setInterval(() => {
    const elapsed = statusMessage.querySelector(".elapsed-seconds");
    if (elapsed) elapsed.textContent = String(Math.floor((Date.now() - startedAt) / 1000));
  }, 1000);

  try {
    const body = reviewForRequest
      ? {
          model: modelSelect.value,
          task: reviewForRequest.task,
          initialState: reviewForRequest.state,
          mode: "interactive",
          maxIterations: 1,
          pauseAfterStage: true,
          stageInteraction: {
            action: options.stageInteractionAction ?? "revise_current_stage",
            message: query,
          },
        }
        : {
          model: modelSelect.value,
          query,
          mode: "interactive",
          maxIterations: 1,
          pauseAfterStage: true,
        };
    pendingReview = null;

    const result = await postEventStream("/research/run-stream", body, activeController.signal, (entry) => {
      handleConversationEvent(entry, statusMessage, () => Math.floor((Date.now() - startedAt) / 1000));
    });
    recoverFinalStageOutputFromResult(result);
    await waitForStreamDrain(statusMessage, () => Math.floor((Date.now() - startedAt) / 1000));
    refreshStageOutput(statusMessage, Math.floor((Date.now() - startedAt) / 1000), "Stage output ready");

    const paused = String(result.state?.stopReason || "").startsWith("paused_after_");
    if (paused) {
      pendingReview = { task: result.state.task, state: result.state };
      canSaveCurrentStage = true;
      updateFixtureControls();
      updateStatusOnly(
        statusMessage,
        Math.floor((Date.now() - startedAt) / 1000),
        "Paused for review",
      );
      refreshStageOutput(statusMessage, Math.floor((Date.now() - startedAt) / 1000), "Paused for review");
      updateContinueButton(true);
    } else {
      renderFinalInto(statusMessage, result, Math.floor((Date.now() - startedAt) / 1000));
      updateContinueButton(false);
      updateFixtureControls();
    }
  } catch (error) {
    if (reviewForRequest) {
      pendingReview = reviewForRequest;
      canSaveCurrentStage = true;
      updateContinueButton(true);
    }
    if (error instanceof Error && error.name === "AbortError") {
      updateStatusOnly(
        statusMessage,
        Math.floor((Date.now() - startedAt) / 1000),
        "Cancelled",
      );
    } else {
      renderErrorInto(
        statusMessage,
        Math.floor((Date.now() - startedAt) / 1000),
        error,
      );
    }
  } finally {
    clearInterval(activeTimer);
    activeTimer = null;
    activeController = null;
    setBusy(false);
    updateFixtureControls();
  }
}

function loadSelectedFixture(fixture) {
  pendingReview = {
    task: fixture.task,
    state: fixture.state,
  };
  canSaveCurrentStage = false;
  fixtureSelect.hidden = true;
  appendMessage("assistant", "", renderFixtureLoadedMessage(fixture));
  updateContinueButton(true);
  updateFixtureControls();
}

function appendMessage(role, content, html) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `<div class="bubble">${html ?? `${role === "assistant" ? "<strong>Kaivu</strong>" : ""}<p>${escapeHtml(content)}</p>`}</div>`;
  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
  return article;
}

async function postEventStream(url, body, signal, onEvent) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // keep default
    }
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = splitSseFrames(buffer);
    buffer = parts.pop() || "";
    for (const part of parts) {
      const parsed = parseSseEvent(part);
      if (!parsed) continue;
      if (parsed.event === "trajectory" || parsed.event === "status") onEvent(parsed.data);
      if (parsed.event === "result") finalResult = parsed.data;
      if (parsed.event === "error") throw new Error(parsed.data?.error || "Research stream failed.");
    }
  }

  if (!finalResult) throw new Error("Research stream ended without a final result.");
  return finalResult;
}

function splitSseFrames(buffer) {
  const frames = [];
  let rest = buffer;
  while (true) {
    const match = /\r?\n\r?\n/.exec(rest);
    if (!match) break;
    frames.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }
  frames.push(rest);
  return frames;
}

function parseSseEvent(chunk) {
  const lines = chunk.split(/\r?\n/);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!eventLine || dataLines.length === 0) return null;
  const event = eventLine.slice("event:".length).trim();
  const rawData = dataLines.map((line) => line.slice("data:".length).trim()).join("\n");
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: { message: rawData } };
  }
}

function handleConversationEvent(entry, statusMessage, seconds) {
  const type = entry?.event?.type;
  if (type === "stage_plan") {
    activeStatusInfo = `Model: ${selectedModelLabel()}`;
    activeLiveStage = String(entry.event.payload?.stage || "stage");
    updateStatusOnly(statusMessage, currentSeconds(seconds), `Planning ${entry.event.payload?.stage || "stage"}`);
    return;
  }
  if (type === "runtime_events") {
    renderRuntimeStatus(statusMessage, entry, seconds);
    return;
  }
  if (type === "stage_output") {
    const rendered = renderStageConversation(entry);
    activeFinalStageOutputHtml = rendered;
    activePendingStageOutputHtml = "";
    activeStageComplete = true;
    clearStreamBuffer();
    activeStageOutputHtml = composeStageOutput();
    renderStatusInto(statusMessage, currentSeconds(seconds), "Stage output ready");
    return;
  }
  if (type === "memory_commit" || type === "graph_update") return;
  if (type === "final_result") updateStatusOnly(statusMessage, currentSeconds(seconds), "Finishing");
}

function renderStatusInto(container, seconds, status) {
  ensureAssistantShell(container);
  updateStatusOnly(container, seconds, status);
  renderProgressInto(container);
  renderStageOutputInto(container);
}

function updateStatusOnly(container, seconds, status) {
  ensureAssistantShell(container);
  const statusElement = container.querySelector(".thinking");
  if (statusElement) {
    statusElement.innerHTML = `${escapeHtml(statusLine(status))} <span class="elapsed-seconds">${seconds}</span>s`;
  } else {
    renderStatusInto(container, seconds, status);
  }
  const noteElement = container.querySelector(".status-note");
  if (noteElement) {
    noteElement.textContent = activeStatusInfo;
    noteElement.hidden = !activeStatusInfo;
  }
}

function ensureAssistantShell(container) {
  const bubble = container.querySelector(".bubble");
  if (!bubble || bubble.querySelector(".stage-output-host")) return;
  bubble.innerHTML = `
    <strong>Kaivu</strong>
    <p class="thinking"></p>
    <p class="status-note"></p>
    <ol class="stage-progress"></ol>
    <div class="stage-output-host"></div>
  `;
}

function renderProgressInto(container) {
  const progress = container.querySelector(".stage-progress");
  if (!progress) return;
  progress.innerHTML = "";
  progress.hidden = true;
}

function renderStageOutputInto(container) {
  const host = container.querySelector(".stage-output-host");
  if (!host) return;
  rememberProcessedDetailsState(host);
  if (!activeStageOutputHtml) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `<hr class="stage-divider" />${activeStageOutputHtml}`;
  bindProcessedDetailsState(host);
}

function refreshStageOutput(container, seconds, status) {
  if (activePendingStageOutputHtml) {
    activeFinalStageOutputHtml = activePendingStageOutputHtml;
    activePendingStageOutputHtml = "";
  }
  if (activeFinalStageOutputHtml || activeSubstageOutputs.length > 0) {
    activeStageOutputHtml = composeStageOutput();
    renderStatusInto(container, seconds, status);
  } else {
    updateStatusOnly(container, seconds, status);
  }
}

function recoverFinalStageOutputFromResult(result) {
  if (activeFinalStageOutputHtml) return;
  const exchanges = Array.isArray(result?.state?.exchangeViews) ? result.state.exchangeViews : [];
  const latest = exchanges.at(-1);
  if (!latest?.summary) return;
  activeFinalStageOutputHtml = `
    <section class="stage-output-inline">
      <h3>${escapeHtml(humanizeKey(String(latest.stage || "stage")))} Output</h3>
      <div class="stage-markdown">${renderMarkdown(String(latest.summary))}</div>
    </section>
  `;
  activeStageComplete = true;
  clearStreamBuffer();
  activeStageOutputHtml = composeStageOutput();
}

function renderErrorInto(container, seconds, error) {
  renderStatusInto(container, seconds, "Stopped with error");
  const host = container.querySelector(".stage-output-host");
  if (!host) return;
  const existingOutput = activeStageOutputHtml
    ? `<hr class="stage-divider" />${activeStageOutputHtml}`
    : host.innerHTML;
  host.innerHTML = `${existingOutput}<p class="error">${escapeHtml(errorMessage(error))}</p>${renderRecoveryHint()}`;
}

function renderRuntimeStatus(container, entry, seconds) {
  const runtimeEvents = entry?.details?.output?.events || [];
  const latest = runtimeEvents.at(-1) || {};
  const runtime = latest.runtime || {};
  const status = runtimeStatusLabel(latest);
  if (activeStageComplete && latest.event !== "stage progress") return;
  const modelLine = displayModelLine(runtime, latest);
  if (modelLine) activeRuntimeModel = modelLine.replace(/^Model:\s*/, "");
  if (latest.event === "stage progress") {
    activeProgressItems.push(progressLine(latest.output));
    recordSubstageOutput(latest);
    activeStageOutputHtml = composeStageOutput(
      activeFinalStageOutputHtml
        ? undefined
        : activeLiveOutputText
          ? renderLiveStageOutput(activeLiveStage, activeLiveOutputText)
          : undefined,
    );
  }
  if (latest.event === "model delta") {
    enqueueModelDelta(String(latest.output?.delta || ""), String(latest.stage || activeLiveStage || "stage"), container, seconds);
  }
  activeStatusInfo = [
    modelLine,
    runtime.tools ? `Tools: ${compactToolNames(runtime.tools) || "none"}` : "",
    retryNote(latest),
  ].filter(Boolean).join(" | ");
  renderStatusInto(container, currentSeconds(seconds), status);
}

function composeStageOutput(mainHtml) {
  const body = mainHtml ?? activeFinalStageOutputHtml;
  return `${renderIntermediateResults()}${body || ""}`;
}

function enqueueModelDelta(delta, stage, container, seconds) {
  if (activeStageComplete || activeFinalStageOutputHtml) return;
  if (!delta) return;
  activeLiveStage = stage;
  activeStreamQueue += delta;
  if (activeStreamTimer) return;
  activeStreamTimer = setInterval(() => {
    const nextChunk = activeStreamQueue.slice(0, 6);
    activeStreamQueue = activeStreamQueue.slice(nextChunk.length);
    activeLiveOutputText += nextChunk;
    activeStageOutputHtml = composeStageOutput(
      activeFinalStageOutputHtml ? undefined : renderLiveStageOutput(activeLiveStage, activeLiveOutputText),
    );
    renderStatusInto(container, currentSeconds(seconds), "Generating output");
    if (!activeStreamQueue) {
      clearInterval(activeStreamTimer);
      activeStreamTimer = null;
      if (activePendingStageOutputHtml) {
        setTimeout(() => {
          if (activeStreamQueue || activeStreamTimer) return;
          activeFinalStageOutputHtml = activePendingStageOutputHtml;
          activeStageOutputHtml = composeStageOutput();
          activePendingStageOutputHtml = "";
          renderStatusInto(container, currentSeconds(seconds), "Stage output ready");
        }, 180);
      }
    }
  }, 24);
}

function waitForStreamDrain(container, seconds) {
  if (!activeStreamQueue && !activeStreamTimer) {
    if (activePendingStageOutputHtml) {
      activeFinalStageOutputHtml = activePendingStageOutputHtml;
      activeStageOutputHtml = composeStageOutput();
      activePendingStageOutputHtml = "";
      renderStatusInto(container, currentSeconds(seconds), "Stage output ready");
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (activeStreamQueue || activeStreamTimer) return;
      clearInterval(timer);
      if (activePendingStageOutputHtml) {
        activeFinalStageOutputHtml = activePendingStageOutputHtml;
        activeStageOutputHtml = composeStageOutput();
        activePendingStageOutputHtml = "";
        renderStatusInto(container, currentSeconds(seconds), "Stage output ready");
      }
      resolve();
    }, 25);
  });
}

function resetStreamBuffer() {
  clearStreamBuffer();
}

function clearStreamBuffer() {
  activeStreamQueue = "";
  activePendingStageOutputHtml = "";
  if (activeStreamTimer) {
    clearInterval(activeStreamTimer);
    activeStreamTimer = null;
  }
}

function rememberProcessedDetailsState(host) {
  const details = host.querySelector(".processed-steps");
  if (details) processedDetailsOpen = details.open;
}

function bindProcessedDetailsState(host) {
  const details = host.querySelector(".processed-steps");
  if (!details) return;
  details.open = processedDetailsOpen;
  details.addEventListener("toggle", () => {
    processedDetailsOpen = details.open;
  });
}

function currentSeconds(value) {
  return typeof value === "function" ? value() : value;
}

function renderStatus(seconds, status = "Running", infoLine = "", progressItems = [], stageOutputHtml = "") {
  return `
    <strong>Kaivu</strong>
    <p class="thinking">${escapeHtml(statusLine(status))} <span class="elapsed-seconds">${seconds}</span>s</p>
    ${infoLine ? `<p class="status-note">${escapeHtml(infoLine)}</p>` : ""}
    ${progressItems.length ? renderProgressList(progressItems) : ""}
    ${stageOutputHtml ? `<hr class="stage-divider" />${stageOutputHtml}` : ""}
  `;
}

function statusLine(status) {
  const normalized = String(status || "Running");
  if (/ready|paused|cancelled|stopped|finishing|generating|thinking|connecting|reconnecting|preparing|planning|working/i.test(normalized)) {
    return `${normalized}...`;
  }
  return `${normalized} the scientific loop...`;
}

function runtimeStatusLabel(event) {
  const name = String(event?.event || "");
  const status = String(event?.output?.status || "");
  if (name === "stage started") return "Preparing stage";
  if (name === "model call") return "Connecting to model";
  if (name === "model prompt") return "Thinking";
  if (name === "model delta") return "Generating output";
  if (name === "stage completed") return "Preparing stage output";
  if (name === "stage progress") return String(event?.output?.label || "Working");
  if (name === "model status") {
    if (status === "model_attempt") return "Connecting to model";
    if (status === "model_retry") return "Reconnecting to model";
    if (status === "model_reconnected") return "Model reconnected";
    if (status === "model_fallback") return "Switching model route";
  }
  return humanizeKey(name || "running");
}

function progressLine(output) {
  const label = output?.label ? String(output.label) : "Progress";
  const detail = output?.detail ? String(output.detail) : "";
  const data = progressDataText(output?.data);
  return [label, detail, data].filter(Boolean).join(": ");
}

function progressDataText(data) {
  if (!data || typeof data !== "object") return "";
  if (data.tool || data.resultCount !== undefined || Array.isArray(data.topResults)) {
    const parts = [];
    if (data.tool) parts.push(`tool=${data.tool}`);
    if (data.status) parts.push(`status=${data.status}`);
    if (data.resultCount !== undefined) parts.push(`results=${data.resultCount}`);
    if (data.note) parts.push(String(data.note));
    if (Array.isArray(data.topResults) && data.topResults.length > 0) {
      parts.push(`top=${data.topResults.map((item) => item.title || item.link || "result").join(" | ")}`);
    }
    return parts.join("; ");
  }
  if (Array.isArray(data.queries) && data.queries.length > 0) {
    return data.queries.join(" | ");
  }
  if (Array.isArray(data.tools) && data.tools.length > 0) {
    return `tools=${data.tools.join(", ")}${data.status ? `; ${data.status}` : ""}`;
  }
  if (Array.isArray(data.providedSources) && data.providedSources.length > 0) {
    return `sources=${data.providedSources.join(", ")}`;
  }
  if (data.digestTool) {
    return `digest=${data.digestTool}`;
  }
  return "";
}

function renderProgressList(items) {
  return `
    <ol class="stage-progress">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ol>
  `;
}

function retryNote(event) {
  const output = event?.output || {};
  if (!output.attempt || !output.maxAttempts) return "";
  const base = `Attempt ${output.attempt}/${output.maxAttempts}`;
  return output.delayMs ? `${base}, retrying after ${output.delayMs}ms` : base;
}

function displayModelLine(runtime, event) {
  const status = String(event?.output?.status || "");
  if (runtime.fallbackModel && status === "model_fallback") {
    return `Model: ${cleanModelLabel(runtime.fallbackModel)}`;
  }
  if (!runtime.model) return "";
  return `Model: ${cleanModelLabel(runtime.model)}`;
}

function cleanModelLabel(label) {
  const raw = String(label).replace(/^retry\((.*)\)$/, "$1");
  if (!raw.includes(" -> ")) return raw;
  return raw.split(" -> ")[0];
}

function renderStageConversation(entry) {
  const details = entry?.details || {};
  const stage = entry?.event?.payload?.stage || "stage";
  const output = details.output || {};
  const review = details.review || {};
  return `
    <section class="stage-output-inline">
      <h3>${escapeHtml(humanizeKey(String(stage)))} Output</h3>
      ${stageOutputHtml(output)}
    </section>
    ${review.required ? `<p class="review-note">${escapeHtml(review.message || "Please review before continuing.")}</p>` : ""}
  `;
}

function renderLiveStageOutput(stage, text) {
  return `
    <section class="stage-output-inline">
      <h3>${escapeHtml(humanizeKey(String(stage)))} Output</h3>
      <div class="stage-markdown live-output">${renderMarkdown(text)}<span class="stream-cursor"></span></div>
    </section>
  `;
}

function stageOutputHtml(output) {
  const text = output?.summary || output?.decision?.reason || output?.status || "This stage completed, but no concise output summary was returned.";
  return `<div class="stage-markdown">${renderMarkdown(String(text))}</div>`;
}

function recordSubstageOutput(event) {
  const output = event?.output || {};
  const data = output?.data && typeof output.data === "object" ? output.data : {};
  const label = String(output?.label || "Substage");
  const detail = String(output?.detail || "");
  const status = String(data.status || output.status || "");
  if (label === "Ground selected term") return;
  if (!isDisplayableSubstage(label, detail, data)) return;
  const key = substageKey(event, label, data);
  const next = {
    key,
    stage: String(event?.stage || activeLiveStage || "stage"),
    label,
    detail,
    status,
    data,
    model: activeRuntimeModel || selectedModelLabel(),
  };
  const existingIndex = activeSubstageOutputs.findIndex((item) => item.key === key);
  if (existingIndex >= 0) {
    activeSubstageOutputs[existingIndex] = { ...activeSubstageOutputs[existingIndex], ...next };
    return;
  }
  activeSubstageOutputs.push(next);
}

function isDisplayableSubstage(label, detail, data) {
  if (label || detail) return true;
  if (!data || typeof data !== "object") return false;
  return Object.keys(data).length > 0;
}

function substageKey(event, label, data) {
  const discriminator = data.term || data.query || data.step || data.tool || data.digestTool || "";
  return [
    event?.stage || activeLiveStage || "stage",
    label,
    discriminator,
  ].map((item) => String(item).trim().toLowerCase()).join("::");
}

function renderIntermediateResults() {
  const items = activeSubstageOutputs
    .filter((item) => isMeaningfulIntermediateResult(item))
    .map(renderIntermediateNarrative)
    .filter(Boolean);
  if (items.length === 0) return "";
  return `
    <details class="processed-steps"${processedDetailsOpen ? " open" : ""}>
      <summary>Processed ${items.length} intermediate result${items.length === 1 ? "" : "s"}</summary>
      <div class="processed-steps-body">
        ${items.map((item) => `<div class="processed-step stage-markdown">${renderMarkdown(compactNarrative(item))}</div>`).join("")}
      </div>
    </details>
  `;
}

function isMeaningfulIntermediateResult(item) {
  const label = String(item.label || "").toLowerCase();
  const data = item.data || {};
  if (String(item.status || data.status || "") === "started") return false;
  if (label.includes("interpret user query")) return false;
  if (label === "ground selected term") return false;
  return true;
}

function renderIntermediateNarrative(item) {
  const label = String(item.label || "").toLowerCase();
  const data = item.data || {};
  if (label.includes("select grounding")) return renderGroundingSelectionIntermediate(item, data);
  if (label.includes("search web") || String(data.tool || "").includes("web_search")) {
    return renderWebGroundingIntermediate(item, data);
  }
  return renderGenericIntermediate(item, data);
}

function renderGroundingSelectionIntermediate(item, data) {
  const terms = Array.isArray(data.terms) ? data.terms.filter(Boolean) : [];
  const discipline = data.provisionalDiscipline && typeof data.provisionalDiscipline === "object"
    ? data.provisionalDiscipline
    : {};
  const lines = [
    `During term identification, ${item.model || selectedModelLabel()} selected the terms that need grounding.`,
    terms.length ? `Selected terms: ${terms.map((term) => `\`${term}\``).join(", ")}.` : `No grounding terms were selected.${data.noGroundingReason ? ` ${data.noGroundingReason}` : ""}`,
    discipline.label ? `Provisional discipline: ${discipline.label}${discipline.confidence !== undefined ? `, confidence ${Number(discipline.confidence).toFixed(2)}` : ""}.` : "",
    data.rationale ? `Selection rationale: ${data.rationale}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function renderWebGroundingIntermediate(item, data) {
  const lines = [
    `Using ${item.model || selectedModelLabel()} with ${data.tool || "hosted web search"}, Kaivu grounded ${data.term ? `\`${data.term}\`` : "the selected term"}.`,
    data.status ? `Search status: ${data.status}${data.resultCount !== undefined ? `, ${data.resultCount} result(s)` : ""}.` : "",
    data.note ? `Note: ${data.note}` : "",
  ];
  const topResults = Array.isArray(data.topResults) ? data.topResults.filter(hasUsefulReferenceLink) : [];
  if (topResults.length > 0) {
    lines.push("Top references:");
    for (const result of topResults) {
      const title = result?.title || result?.id || "Untitled result";
      const link = result?.link || result?.id;
      lines.push(link ? `- [${title}](${link})` : `- ${title}`);
    }
  }
  if (data.summary) {
    lines.push("Grounding result:");
    lines.push(normalizeGroundingSummary(data.summary));
  }
  return lines.filter(Boolean).join("\n");
}

function renderGenericIntermediate(item, data) {
  const lines = [
    `${humanizeKey(String(item.label || "step"))} completed.`,
    item.detail ? String(item.detail) : "",
  ];
  const compact = compactSubstageData(data);
  if (compact) lines.push(compact);
  return lines.filter(Boolean).join("\n");
}

function normalizeGroundingSummary(value) {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\[Kaivu note:[\s\S]*?\]$/i, "")
    .trim();
}

function hasUsefulReferenceLink(result) {
  const link = result?.link || result?.id;
  return typeof link === "string" && /^https?:\/\//i.test(link);
}

function compactNarrative(text) {
  const lines = [];
  for (const rawLine of String(text).replace(/\r\n/g, "\n").split("\n")) {
    const line = cleanNarrativeLine(rawLine);
    if (!line) continue;
    if (rawLine.trim().startsWith(",") && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}, ${line}`;
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function cleanNarrativeLine(value) {
  return String(value)
    .trim()
    .replace(/^([#>*\-\d.)\s]+),\s*/, "$1")
    .replace(/^,\s*/, "")
    .trim();
}

function renderMarkdown(markdown) {
  const html = marked.parse(String(markdown || ""), { async: false });
  return sanitizeMarkdownHtml(html) || `<p>${escapeHtml(markdown)}</p>`;
}

function sanitizeMarkdownHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html);
  const allowedTags = new Set(["A", "P", "UL", "OL", "LI", "STRONG", "EM", "CODE", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "HR"]);
  for (const element of [...template.content.querySelectorAll("*")]) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(document.createTextNode(element.textContent || ""));
      continue;
    }
    const href = element.tagName === "A" ? element.getAttribute("href") || "" : "";
    for (const attribute of [...element.attributes]) {
      element.removeAttribute(attribute.name);
    }
    if (element.tagName === "A") {
      if (/^https?:\/\//i.test(href)) {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noreferrer");
      }
    }
  }
  return template.innerHTML;
}

function renderConversationBlock(title, value, omitKeys = []) {
  if (!value || typeof value !== "object") return "";
  const entries = Object.entries(value).filter(([key]) => !omitKeys.includes(key));
  if (entries.length === 0) return "";
  return `
    <section class="conversation-block">
      <h4>${escapeHtml(title)}</h4>
      <dl class="process-details">${entries.map(([key, item]) => renderDetailRow(key, item)).join("")}</dl>
    </section>
  `;
}

function renderRuntimeBlock(runtime) {
  if (!runtime || typeof runtime !== "object" || Object.keys(runtime).length === 0) return "";
  return `
    <details class="runtime-meta">
      <summary>Model / Tools / Prompt</summary>
      <dl class="process-details">${Object.entries(runtime).map(([key, value]) => renderDetailRow(key, key === "tools" ? compactToolNames(value) || value : value)).join("")}</dl>
    </details>
  `;
}

function compactToolNames(value) {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).map(([capability, item]) => {
    const tools = Array.isArray(item?.tools) ? item.tools.join(", ") : "";
    return `${capability}${tools ? `: ${tools}` : ""}`;
  }).join(" | ");
}

function renderDetailRow(key, value) {
  return `
    <div class="detail-row">
      <dt>${escapeHtml(humanizeKey(key))}</dt>
      <dd>${renderDetailValue(value)}</dd>
    </div>
  `;
}

function renderDetailValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return `<span class="muted">none</span>`;
    if (value.every((item) => typeof item !== "object" || item === null)) {
      return `<ul>${value.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>`;
    }
    return value.map((item) => `<div class="nested-detail">${renderDetailValue(item)}</div>`).join("");
  }
  if (value && typeof value === "object") {
    return `<dl class="nested-details">${Object.entries(value).map(([key, item]) => renderDetailRow(key, item)).join("")}</dl>`;
  }
  if (value === undefined || value === null || value === "") return `<span class="muted">none</span>`;
  return `<span>${escapeHtml(String(value))}</span>`;
}

function renderFinalInto(container, result, seconds = 0) {
  activeStatusInfo = [activeStatusInfo, finalConclusion(result.state || {})].filter(Boolean).join(" | ");
  updateStatusOnly(container, seconds, "Stopped");
}

function renderFinalConversation(result) {
  const state = result.state || {};
  return `
    <strong>Kaivu</strong>
    <p>${escapeHtml(finalConclusion(state))}</p>
  `;
}

function finalConclusion(state) {
  if (state.stopReason === "max_iterations_reached") {
    return "This research turn reached its stage limit.";
  }
  if (state.stopReason) return String(state.stopReason);
  return "Research loop completed.";
}

function setBusy(busy) {
  document.body.classList.toggle("is-running", busy);
  sendButton.textContent = busy ? "Cancel" : pendingReview ? "Continue current stage" : "Start research";
  queryInput.disabled = busy;
  continueButton.disabled = busy || !pendingReview;
  saveFixtureButton.disabled = busy || !pendingReview || !canSaveCurrentStage;
  loadFixtureButton.disabled = busy || !loadStageFixture();
  clearFixtureButton.disabled = busy || !loadStageFixture();
}

function updateContinueButton(visible) {
  continueButton.hidden = !visible;
  continueButton.disabled = !visible || Boolean(activeController);
  sendButton.textContent = activeController ? "Cancel" : pendingReview ? "Continue current stage" : "Start research";
  queryInput.placeholder = pendingReview
    ? "Add notes for the current stage, or write handoff notes before continuing to the next stage..."
    : "Ask Kaivu to investigate a scientific question...";
}

function saveStageFixture(review) {
  if (!canSaveCurrentStage) return;
  const fixture = {
    version: 1,
    id: `fixture_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    savedAt: new Date().toISOString(),
    task: review.task,
    state: review.state,
    resumeStage: review.state?.currentStage,
    completedStages: review.state?.completedStages || [],
  };
  const fixtures = [fixture, ...loadStageFixtures()].slice(0, 20);
  saveStageFixtures(fixtures);
  fixtureSelect.value = fixture.id;
  appendMessage("assistant", "", renderFixtureSavedMessage(fixture));
  updateFixtureControls();
}

function loadStageFixture() {
  return selectedStageFixture();
}

function selectedStageFixture() {
  const fixtures = loadStageFixtures();
  const selectedId = fixtureSelect.value;
  return fixtures.find((fixture) => fixture.id === selectedId) || fixtures[0] || null;
}

function loadStageFixtures() {
  const rawList = localStorage.getItem(STAGE_FIXTURES_KEY);
  const fixtures = parseFixtureList(rawList);
  const legacy = loadLegacyStageFixture();
  const merged = legacy && !fixtures.some((fixture) => fixture.id === legacy.id)
    ? [legacy, ...fixtures]
    : fixtures;
  return merged.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
}

function saveStageFixtures(fixtures) {
  localStorage.setItem(STAGE_FIXTURES_KEY, JSON.stringify(fixtures));
  localStorage.removeItem(STAGE_FIXTURE_KEY);
}

function parseFixtureList(raw) {
  if (!raw) return [];
  try {
    const fixtures = JSON.parse(raw);
    return Array.isArray(fixtures)
      ? fixtures.filter((fixture) => fixture?.task && fixture?.state).map(ensureFixtureId)
      : [];
  } catch {
    return [];
  }
}

function loadLegacyStageFixture() {
  const raw = localStorage.getItem(STAGE_FIXTURE_KEY);
  if (!raw) return null;
  try {
    const fixture = JSON.parse(raw);
    if (!fixture?.task || !fixture?.state) return null;
    return ensureFixtureId(fixture);
  } catch {
    return null;
  }
}

function ensureFixtureId(fixture) {
  return {
    ...fixture,
    id: fixture.id || `legacy_${String(fixture.savedAt || Date.now()).replace(/[^a-z0-9]/gi, "_")}`,
  };
}

function updateFixtureControls() {
  const fixtures = loadStageFixtures();
  const previousSelection = fixtureSelect.value;
  fixtureSelect.innerHTML = fixtures.length
    ? fixtures.map((fixture) => `<option value="${escapeHtml(fixture.id)}">${escapeHtml(fixtureLabel(fixture))}</option>`).join("")
    : `<option value="">No saved fixtures</option>`;
  if (fixtures.some((fixture) => fixture.id === previousSelection)) {
    fixtureSelect.value = previousSelection;
  }
  const fixture = selectedStageFixture();
  const resumeStage = fixture?.resumeStage || fixture?.state?.currentStage;
  fixtureStatus.textContent = fixture
    ? `${fixtures.length} saved fixture(s). ${fixtures.length > 1 ? "Click Load fixture to choose one." : `Ready to resume at ${humanizeKey(String(resumeStage || "next stage"))}.`}`
    : "No saved stage fixture.";
  fixtureSelect.disabled = fixtures.length === 0 || Boolean(activeController);
  if (fixtures.length <= 1) fixtureSelect.hidden = true;
  if (!activeController) {
    saveFixtureButton.disabled = !pendingReview || !canSaveCurrentStage;
    loadFixtureButton.disabled = !fixture;
    clearFixtureButton.disabled = !fixture;
  }
}

function fixtureLabel(fixture) {
  const stage = humanizeKey(String(fixture.resumeStage || fixture.state?.currentStage || "next stage"));
  const question = String(fixture.task?.question || fixture.task?.title || "untitled").slice(0, 42);
  return `${formatFixtureDate(fixture.savedAt)} | ${stage} | ${question}`;
}

function renderFixtureSavedMessage(fixture) {
  return `
    <strong>Kaivu</strong>
    <p>Saved a stage fixture. Next debug run can resume at <code>${escapeHtml(String(fixture.resumeStage || "next stage"))}</code> without rerunning previous stages.</p>
  `;
}

function renderFixtureLoadedMessage(fixture) {
  const state = fixture.state || {};
  const task = fixture.task || state.task || {};
  const latestExchange = Array.isArray(state.exchangeViews) ? state.exchangeViews.at(-1) : undefined;
  const completedStages = Array.isArray(fixture.completedStages) ? fixture.completedStages : state.completedStages || [];
  const artifactCount = Array.isArray(state.artifactRefs) ? state.artifactRefs.length : Array.isArray(state.artifacts) ? state.artifacts.length : 0;
  const evidenceCount = Array.isArray(state.evidence) ? state.evidence.length : 0;
  const hypothesisCount = Array.isArray(state.hypotheses) ? state.hypotheses.length : 0;
  return `
    <strong>Kaivu</strong>
    <p>Loaded saved fixture. Use <b>Continue current stage</b> to revise the last completed stage, or <b>Continue next stage</b> to run <code>${escapeHtml(String(fixture.resumeStage || "next stage"))}</code> using the frozen upstream state.</p>
    <section class="fixture-summary">
      <dl class="process-details">
        ${renderDetailRow("saved at", formatFixtureDate(fixture.savedAt))}
        ${renderDetailRow("resume stage", humanizeKey(String(fixture.resumeStage || state.currentStage || "next stage")))}
        ${renderDetailRow("completed stages", completedStages.length ? completedStages.map((stage) => humanizeKey(String(stage))) : ["none"])}
        ${renderDetailRow("question", task.question || task.title || "unknown")}
        ${renderDetailRow("discipline", task.discipline || "unknown")}
        ${renderDetailRow("state counts", {
          evidence: evidenceCount,
          hypotheses: hypothesisCount,
          artifacts: artifactCount,
          iteration: state.iteration ?? 0,
        })}
      </dl>
      ${latestExchange ? `
        <details class="fixture-output" open>
          <summary>Latest saved stage output: ${escapeHtml(humanizeKey(String(latestExchange.stage || "stage")))}</summary>
          <div class="stage-markdown">${renderMarkdown(String(latestExchange.summary || "No saved summary."))}</div>
        </details>
      ` : ""}
    </section>
  `;
}

function formatFixtureDate(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function selectedModelLabel() {
  return modelSelect.options[modelSelect.selectedIndex]?.textContent || modelSelect.value;
}

updateFixtureControls();

function humanizeKey(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

function renderRecoveryHint() {
  return `<p class="status-note">Try "Codex CLI gpt-5.4" or "Local Echo" if the direct OAuth backend is slow or blocked.</p>`;
}

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "AbortError") return "Request cancelled.";
  if (error.message.includes("fetch failed")) {
    return "Model API connection failed. Use Local Echo to test the UI, or check network/API key/server logs for the real model.";
  }
  return error.message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
