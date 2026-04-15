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

const STAGE_FIXTURE_KEY = "kaivu.stageFixture.v1";

let activeController = null;
let activeTimer = null;
let pendingReview = null;
let activeStageOutputHtml = "";
let activeStatusInfo = "";
let activeProgressItems = [];
let activeLiveOutputText = "";
let activeLiveStage = "";
let activeStreamQueue = "";
let activeStreamTimer = null;
let activePendingStageOutputHtml = "";

continueButton.addEventListener("click", () => {
  if (!pendingReview || activeController) return;
  runResearchTurn("", { showUserMessage: false, applyFeedback: false });
});

saveFixtureButton.addEventListener("click", () => {
  if (!pendingReview) return;
  saveStageFixture(pendingReview);
});

loadFixtureButton.addEventListener("click", () => {
  const fixture = loadStageFixture();
  if (!fixture) return;
  pendingReview = {
    task: fixture.task,
    state: fixture.state,
  };
  appendMessage("assistant", "", renderFixtureLoadedMessage(fixture));
  updateContinueButton(true);
  updateFixtureControls();
});

clearFixtureButton.addEventListener("click", () => {
  localStorage.removeItem(STAGE_FIXTURE_KEY);
  updateFixtureControls();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (activeController) {
    activeController.abort();
    return;
  }

  const query = queryInput.value.trim();
  if (!query) return;
  await runResearchTurn(query, { showUserMessage: true });
});

async function runResearchTurn(query, options = {}) {
  if (options.showUserMessage !== false) {
    appendMessage("user", query);
  }
  queryInput.value = "";
  updateContinueButton(false);
  activeStageOutputHtml = "";
  activeStatusInfo = `Model: ${selectedModelLabel()}`;
  activeProgressItems = [];
  activeLiveOutputText = "";
  activeLiveStage = "";
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
    const body = pendingReview
      ? {
          model: modelSelect.value,
          task: options.applyFeedback === false ? pendingReview.task : taskWithFeedback(pendingReview.task, query),
          initialState: pendingReview.state,
          mode: "interactive",
          maxIterations: 1,
          pauseAfterStage: true,
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
    await waitForStreamDrain(statusMessage, () => Math.floor((Date.now() - startedAt) / 1000));

    const paused = String(result.state?.stopReason || "").startsWith("paused_after_");
    if (paused) {
      pendingReview = { task: result.state.task, state: result.state };
      updateFixtureControls();
      updateStatusOnly(
        statusMessage,
        Math.floor((Date.now() - startedAt) / 1000),
        "Paused for review",
      );
      updateContinueButton(true);
    } else {
      renderFinalInto(statusMessage, result, Math.floor((Date.now() - startedAt) / 1000));
      updateContinueButton(false);
      updateFixtureControls();
    }
  } catch (error) {
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

function taskWithFeedback(task, feedback) {
  const existing = Array.isArray(task?.constraints?.reviewFeedback) ? task.constraints.reviewFeedback : [];
  return {
    ...task,
    constraints: {
      ...(task?.constraints || {}),
      reviewFeedback: [...existing, feedback],
    },
  };
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
    if (activeLiveOutputText || activeStreamQueue) {
      activePendingStageOutputHtml = rendered;
      return;
    }
    activeStageOutputHtml = rendered;
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
  progress.innerHTML = activeProgressItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  progress.hidden = activeProgressItems.length === 0;
}

function renderStageOutputInto(container) {
  const host = container.querySelector(".stage-output-host");
  if (!host || !activeStageOutputHtml) return;
  host.innerHTML = `<hr class="stage-divider" />${activeStageOutputHtml}`;
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
  if (latest.event === "stage progress") {
    activeProgressItems.push(progressLine(latest.output));
    const groundingHtml = renderGroundingProgressOutput(latest.output);
    if (groundingHtml) {
      activeStageOutputHtml = appendStageOutputHtml(activeStageOutputHtml, groundingHtml);
    }
  }
  if (latest.event === "model delta") {
    enqueueModelDelta(String(latest.output?.delta || ""), String(latest.stage || activeLiveStage || "stage"), container, seconds);
  }
  activeStatusInfo = [
    displayModelLine(runtime, latest),
    runtime.tools ? `Tools: ${compactToolNames(runtime.tools) || "none"}` : "",
    retryNote(latest),
  ].filter(Boolean).join(" | ");
  renderStatusInto(container, currentSeconds(seconds), status);
}

function appendStageOutputHtml(existing, next) {
  if (!next) return existing || "";
  return existing ? `${existing}${next}` : next;
}

function enqueueModelDelta(delta, stage, container, seconds) {
  if (!delta) return;
  activeLiveStage = stage;
  activeStreamQueue += delta;
  if (activeStreamTimer) return;
  activeStreamTimer = setInterval(() => {
    const nextChunk = activeStreamQueue.slice(0, 6);
    activeStreamQueue = activeStreamQueue.slice(nextChunk.length);
    activeLiveOutputText += nextChunk;
    activeStageOutputHtml = renderLiveStageOutput(activeLiveStage, activeLiveOutputText);
    renderStatusInto(container, currentSeconds(seconds), "Generating output");
    if (!activeStreamQueue) {
      clearInterval(activeStreamTimer);
      activeStreamTimer = null;
      if (activePendingStageOutputHtml) {
        setTimeout(() => {
          if (activeStreamQueue || activeStreamTimer) return;
          activeStageOutputHtml = activePendingStageOutputHtml;
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
      activeStageOutputHtml = activePendingStageOutputHtml;
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
        activeStageOutputHtml = activePendingStageOutputHtml;
        activePendingStageOutputHtml = "";
        renderStatusInto(container, currentSeconds(seconds), "Stage output ready");
      }
      resolve();
    }, 25);
  });
}

function resetStreamBuffer() {
  activeStreamQueue = "";
  activePendingStageOutputHtml = "";
  if (activeStreamTimer) {
    clearInterval(activeStreamTimer);
    activeStreamTimer = null;
  }
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
  const text = output?.summary || output?.decision?.reason || "This stage completed, but no concise output summary was returned.";
  return `${renderGroundingTrail(output?.process)}<div class="stage-markdown">${renderMarkdown(String(text))}</div>`;
}

function renderGroundingTrail(process) {
  const grounding = Array.isArray(process)
    ? process.find((item) => String(item?.label || "").toLowerCase().includes("ground"))
    : null;
  const data = grounding?.data || {};
  const terms = Array.isArray(data.candidateTerms) ? data.candidateTerms : [];
  const results = Array.isArray(data.groundingResults) ? data.groundingResults : [];
  if (terms.length === 0 && results.length === 0) return "";
  return `
    <section class="grounding-trail">
      <h4>Grounding Process</h4>
      ${terms.length ? `<p class="muted">Detected terms: ${escapeHtml(terms.join(", "))}</p>` : ""}
      ${results.length ? `<ol>${results.map(renderGroundingResult).join("")}</ol>` : `<p class="muted">No grounding lookup was needed.</p>`}
    </section>
  `;
}

function renderGroundingProgressOutput(output) {
  const data = output?.data || {};
  if (!data || typeof data !== "object") return "";
  const tool = String(data.tool || "");
  const status = String(data.status || "");
  const hasGroundingResult = tool.includes("web_search") || tool.includes("literature_wiki") || data.note || data.resultCount !== undefined;
  if (!hasGroundingResult || status === "started") return "";
  const result = {
    tool,
    status: status || "completed",
    summary: data.summary || data.note || JSON.stringify({
      results: Array.isArray(data.topResults) ? data.topResults : [],
      note: data.note,
    }),
  };
  return `
    <section class="stage-output-inline grounding-live">
      <h3>Grounding Output</h3>
      <section class="grounding-trail">
        <ol>${renderGroundingResult(result)}</ol>
      </section>
    </section>
  `;
}

function renderGroundingResult(result) {
  const parsed = parseMaybeJson(result?.summary);
  const count = Array.isArray(parsed?.results) ? parsed.results.length : undefined;
  const top = Array.isArray(parsed?.results) ? parsed.results.slice(0, 3) : [];
  const markdown = groundingResultMarkdown(result, parsed);
  return `
    <li>
      <strong>${escapeHtml(result?.tool || "tool")}</strong>
      <span class="muted">${escapeHtml(result?.status || "unknown")}${count !== undefined ? `, ${count} result(s)` : ""}</span>
      ${parsed?.note ? `<p>${escapeHtml(parsed.note)}</p>` : ""}
      ${top.length ? `<ul>${top.map((item) => `<li>${renderSearchResultLink(item)}</li>`).join("")}</ul>` : ""}
      ${markdown ? `<div class="grounding-markdown stage-markdown">${renderMarkdown(markdown)}</div>` : ""}
    </li>
  `;
}

function renderSearchResultLink(item) {
  const title = escapeHtml(item?.title || item?.id || "Untitled result");
  const link = item?.link || item?.id;
  const summary = typeof item?.summary === "string" ? `<div class="muted search-result-summary">${renderMarkdown(item.summary)}</div>` : "";
  const titleHtml = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${title}</a>` : title;
  return `${titleHtml}${summary}`;
}

function groundingResultMarkdown(result, parsed) {
  if (typeof parsed?.summary === "string") return parsed.summary;
  if (typeof result?.summary === "string" && !parsed) return result.summary;
  return "";
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(3, heading[1].length + 3);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return html.join("") || `<p>${escapeHtml(markdown)}</p>`;
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
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
  sendButton.textContent = busy ? "Cancel" : "Send";
  queryInput.disabled = busy;
  continueButton.disabled = busy || !pendingReview;
  saveFixtureButton.disabled = busy || !pendingReview;
  loadFixtureButton.disabled = busy || !loadStageFixture();
  clearFixtureButton.disabled = busy || !loadStageFixture();
}

function updateContinueButton(visible) {
  continueButton.hidden = !visible;
  continueButton.disabled = !visible || Boolean(activeController);
}

function saveStageFixture(review) {
  const fixture = {
    version: 1,
    savedAt: new Date().toISOString(),
    task: review.task,
    state: review.state,
    resumeStage: review.state?.currentStage,
    completedStages: review.state?.completedStages || [],
  };
  localStorage.setItem(STAGE_FIXTURE_KEY, JSON.stringify(fixture));
  appendMessage("assistant", "", renderFixtureSavedMessage(fixture));
  updateFixtureControls();
}

function loadStageFixture() {
  const raw = localStorage.getItem(STAGE_FIXTURE_KEY);
  if (!raw) return null;
  try {
    const fixture = JSON.parse(raw);
    if (!fixture?.task || !fixture?.state) return null;
    return fixture;
  } catch {
    return null;
  }
}

function updateFixtureControls() {
  const fixture = loadStageFixture();
  const resumeStage = fixture?.resumeStage || fixture?.state?.currentStage;
  fixtureStatus.textContent = fixture
    ? `Saved fixture: resume at ${humanizeKey(String(resumeStage || "next stage"))}.`
    : "No saved stage fixture.";
  if (!activeController) {
    saveFixtureButton.disabled = !pendingReview;
    loadFixtureButton.disabled = !fixture;
    clearFixtureButton.disabled = !fixture;
  }
}

function renderFixtureSavedMessage(fixture) {
  return `
    <strong>Kaivu</strong>
    <p>Saved a stage fixture. Next debug run can resume at <code>${escapeHtml(String(fixture.resumeStage || "next stage"))}</code> without rerunning previous stages.</p>
  `;
}

function renderFixtureLoadedMessage(fixture) {
  return `
    <strong>Kaivu</strong>
    <p>Loaded saved fixture. Click <b>Continue next stage</b> to run <code>${escapeHtml(String(fixture.resumeStage || "next stage"))}</code> using the frozen upstream state.</p>
  `;
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
