# REPO_MAP — ai-assistant

> Generado por `npm run db:index-code`. **No editar a mano**: se vuelve a
> escribir solo si cambia algo. Es un índice de orientación del repo (rutas
> y símbolos) pensado para personas y para futuras herramientas: hoy NINGÚN
> código de la app lo lee — la app consulta `search_code`.

- Ficheros indexados: 215
- De ellos, con símbolos: 155
- Trozos: 1344
- Embeddings: `@cf/baai/bge-m3` (1024 dims)

## (raíz)
- `next.config.js` → nextConfig
- `tailwind.config.ts` → config
- `vitest.config.ts` → wasmModuleConvention

## app/
- `app/error.tsx` → clearAndReload, Error
- `app/global-error.tsx` → GlobalError
- `app/layout.tsx` → metadata, BOOT_WATCHDOG, viewport, RootLayout
- `app/manifest.ts` → manifest
- `app/page.tsx` → Home, MemoryInspector, formatRemaining

## app/api/auth/
- `app/api/auth/route.ts` → GET

## app/api/brain/search/
- `app/api/brain/search/route.ts` → POST

## app/api/chat/
- `app/api/chat/route.ts` → groqErrorResponse, POST, message

## app/api/conversations/
- `app/api/conversations/route.ts` → POST, DEFAULT_MODEL, GET

## app/api/conversations/[id]/
- `app/api/conversations/[id]/route.ts` → DELETE, PUT, GET

## app/api/github/browse/
- `app/api/github/browse/route.ts` → GET

## app/api/github/repos/
- `app/api/github/repos/route.ts` → GET, POST, DELETE

## app/api/memory/
- `app/api/memory/route.ts` → POST, GET

## app/api/memory/[id]/
- `app/api/memory/[id]/route.ts` → PATCH, DELETE

## app/api/memory/consolidate/
- `app/api/memory/consolidate/route.ts` → POST

## app/api/memory/search/
- `app/api/memory/search/route.ts` → POST

## app/api/models/
- `app/api/models/route.ts` → GET

## app/api/notes/
- `app/api/notes/route.ts` → GET, POST

## app/api/notes/[id]/
- `app/api/notes/[id]/route.ts` → DELETE, GET, PUT

## app/api/quota/
- `app/api/quota/route.ts` → GET

## app/api/transcribe/
- `app/api/transcribe/route.ts` → POST, transcribeWithWorkersAI, GROQ_TRANSCRIBE

## app/api/vault/index/
- `app/api/vault/index/route.ts` → GET

## app/api/whatsapp/webhook/
- `app/api/whatsapp/webhook/route.ts` → dynamic, GET, POST, handleMessages, getOrCreateWhatsAppConversation, WHATSAPP_TOOLS

## app/components/
- `app/components/AriaMark.tsx` → Props
- `app/components/ChatContainer.tsx` → ChatContainer, Props
- `app/components/ChatInput.tsx` → ChatInput, Props
- `app/components/CodeHighlighter.tsx` → Props, CodeHighlighter
- `app/components/GithubRepos.tsx` → GithubRepos, Repo
- `app/components/InstallButton.tsx` → InstallButton, BeforeInstallPromptEvent, readCaptured, detectPlatform
- `app/components/LoginScreen.tsx` → LoginScreen, Props
- `app/components/MemoryInspector.tsx` → MemoryInspector, StatChip, TYPE_LABELS
- `app/components/MessageBubble.tsx` → MessageBubble, CodeHighlighter, CopyButton, CodeBlock, SpeakButton
- `app/components/ModelSelector.tsx` → ModelSelector, Props
- `app/components/NeuralNetwork.tsx` → NeuralNetwork, Props
- `app/components/NotesPanel.tsx` → isEditing, NotesPanel, noteToMarkdown, Note
- `app/components/PanelLoading.tsx` → PanelLoading
- `app/components/QuotaBadge.tsx` → QuotaBadge
- `app/components/ServiceWorkerRegister.tsx` → ServiceWorkerRegister
- `app/components/SidePanel.tsx` → inputStyle, SidePanel
- `app/components/Sidebar.tsx` → Sidebar, timeAgo, Props
- `app/components/SourceChips.tsx` → SourceChips, SourceChip, formatScore, KIND_META
- `app/components/ToolCard.tsx` → TOOL_ICONS, ToolCard, formatResult, formatArgs
- `app/components/TypingIndicator.tsx` → TypingIndicator
- `app/components/WelcomeScreen.tsx` → WelcomeScreen, suggestions, Props

## app/components/scene/
- `app/components/scene/AriaScene.tsx` → AriaScene, ASSEMBLE_SECONDS, AriaSceneProps
- `app/components/scene/CountachViewer.tsx` → AriaScene, CountachViewer, CountachViewerProps

## app/components/scene/car/
- `app/components/scene/car/current-car.ts` → buildCar, CarMaterials
- `app/components/scene/car/lp5000.ts` → mergeChildrenByMaterial, Lp5000Materials, CarPart, WHEELS, addArc, buildShell, buildFlare, buildQuad, bakedGeometry, buildLp5000
- `app/components/scene/car/utils.ts` → CarStats, collectStats, disposeObject3D, MATERIAL_TEXTURE_KEYS

## app/hooks/
- `app/hooks/useEscapeToClose.ts` → useEscapeToClose
- `app/hooks/usePausableInterval.ts` → usePausableInterval
- `app/hooks/useQuota.ts` → useQuota
- `app/hooks/useTTS.ts` → pickSpanishVoice, stripMarkdown, useTTS
- `app/hooks/useVoiceInput.ts` → useVoiceInput, pickAudioMime, SpeechRecognitionLike, Options, VoiceState

## app/lib/
- `app/lib/api.ts` → readJson, jsonError, withAuth, RouteContext
- `app/lib/aria-core.ts` → AriaContext, buildAriaContext, MEMORY_MAX_LINES, trimMemoryLine, composeMemoryBlock, rememberTurn, MIN_COMPACT_MESSAGES, CompactionPlan, planCompaction, compactConversation, buildContextMessages, MemoryLine, GROQ_API, SYSTEM_PROMPT, GroqModelConfig, MODEL_CONFIG, LOOKS_LIKE_ORDER, WANTS_CURRENT, wantsWebSearch, TOOL_GROUPS, RX_CODE_REVIEW, RX_CODE_SEARCH, RX_GITHUB_WRITE, RX_MATH, RX_WRITE_VERB, RX_NOTE_MENTION, selectTools, generateSummary
- `app/lib/aria-reply.ts` → TextReplyOptions, drainToText, generateTextReply
- `app/lib/auth-client.ts` → apiFetch, TOKEN_KEY, getToken, setToken, authHeaders, fetchWithTimeout, fetchAuthRequired, verifyToken
- `app/lib/auth.ts` → getAccessToken, isAuthorized, extractToken, safeEqual, requireAuth
- `app/lib/background.ts` → registerBackground
- `app/lib/base64.ts` → decodeBase64, encodeBase64
- `app/lib/brain.ts` → vaultCandidate, safeQuery, MemoryRow, Candidate, rankBoost, RANK_BOOST_MAX, BrainSearchOptions, BrainHit, BrainKind, mirrorNoteToMemory, jaccard, contentTokens, DEDUPE_JACCARD, labelHit, normalizeLexical, lexicalSim, orFuse, dedupeHits, removeMirroredNote, NOTE_TAG_PREFIX, searchBrain, memoryHit
- `app/lib/changelog.ts` → ChangeEntity, ChangeRecord, toRecord, jsonParam, countRecentChanges, recordChange, getChange, latestChange, markReverted
- `app/lib/chat-client.ts` → isRetryable, streamChat, MODEL_FALLBACK_ORDER, UnauthorizedError, StreamChatOptions, StreamChatResult
- `app/lib/chat-draft.ts` → saveDraft, DRAFT_PREFIX, draftKey, defaultStorage, loadDraft
- `app/lib/chat-events.ts` → sourcesEvent, contextEvent, modelSwitchEvent, ModelSwitchReason
- `app/lib/code-index.ts` → CODE_SKIP_DIRS, codeChunkText, chunkCode, CODE_INDEX_EXTENSIONS, fuseCodeScores, CodeChunkKind, CodeChunkInput, CodeSearchOptions, LANG_BY_EXT, langFromPath, isIndexedFile, hashContent, regexEnd, startsRegex, braceDelta, splitLong, searchCode, safeCodeQuery, Row, declInfo, formatCodeLocation
- `app/lib/context-info.ts` → formatContextUsage, contextUsagePercent
- `app/lib/download.ts` → downloadBlob
- `app/lib/email.ts` → emailAllowedRecipients, sendEmail, RESEND_API
- `app/lib/embeddings.ts` → reindexVaultEmbeddings, ReindexOptions, ReindexResult, upsertNote, MAX_EMBED_CHARS, semanticSearchDb, needsReindex, matchSnippet
- `app/lib/error-message.ts` → ERROR_MESSAGE_PREFIX
- `app/lib/format.ts` → fmtDate, formatCompactNumber
- `app/lib/git-common.ts` → PATCH_MAX_REMOVED_LINES, PATCH_SEARCH_MAX_CHARS
- `app/lib/git-hosts.ts` → platformToken, repoKey, parseRepoRef, platformFromHost, RepoRef, GIT_HOSTS, GitHost, GitPlatform, platformStatuses, PlatformStatus
- `app/lib/git.ts` → GitChange, gitMergePullRequest, gitDeleteFiles, gitGetCheckRuns, gitApplyPatch, gitCreatePullRequest, gitListIssues, gitReadFile, gitListFiles, gitRepoOverview, gitVerifyRepo, resolve, notImplemented, invalid
- `app/lib/github.ts` → deleteFiles, GithubMergeInput, mergePullRequest, GithubCheckRunsInput, GhCheckRun, clip, getCheckRuns, repoOverview, listFiles, readFile, readFileByLines, listIssues, GithubRepoSummary, normalizeGithubUser, mapRepoSummaries, githubAutoMergeEnabled, listMyRepos, GITHUB_LIMITS, GITHUB_API, MAX_FIX_ATTEMPTS, parseRepo, getRepos, saveRepos, addRepo, removeRepo, verifyRepo, fixAttemptsKey, getFixAttempts, recordFixAttempt, ghFetch, describeError, createPullRequest, GithubPatchOp, GithubApplyPatchInput, applyPatch, GithubDeleteInput
- `app/lib/gitlab.ts` → getCheckRuns, LIMITS, gitlabWriteEnabled, glFetch, glMessage, describeError, defaultBranch, verifyRepo, repoOverview, listFiles, readFile, readByLines, listIssues, fileBlobId, resolveTargetBranch, commit, createPullRequest, applyPatch, deleteFiles, pipelineState, mergePullRequest
- `app/lib/llm-embed.ts` → embeddingCacheGet, hashEmbedText, MODEL, embed, localEmbed, viaRest, viaBinding, embeddingCacheSet
- `app/lib/local-agent.ts` → headers, checkLocalAgent, openAppLocally, LocalAgentResult, agentToken, saveLocalToken
- `app/lib/memory-extract.ts` → sanitizeJson, SYSTEM_PROMPT, GROQ_API, heuristicExtract, extractMemories, sanitizeExtracted
- `app/lib/memory.ts` → MemoryUpdate, setContext, createMemory, findMemoryById, getMemoryById, toStored, StoredMemory, maybeConsolidate, searchMemories, reinforceMemories, MEMORY_TYPES, ConsolidateOptions, consolidateMemories, recordEpisode, getMemoryStats, updateWorkingMemory, getContext, MemoryFilters, searchSemanticMemories, updateMemory
- `app/lib/notes.ts` → deleteNote, NoteRecord, parseTags, toRecord, tagsJson, listNotes, getNote, findNote, saveNote, updateNote
- `app/lib/num.ts` → clamp01, round01, round3
- `app/lib/persist-messages.ts` → persistMessages, hydrateMessages, MessageInput
- `app/lib/prisma.ts` → getPrisma, prisma, AdapterFactory, createClient, RequestContext, currentRequestContext, globalForPrisma
- `app/lib/providers.ts` → isModelAvailable, ProviderId, Provider, WORKERS_AI, RESERVE_MODEL, MODEL_CATALOG, OPENROUTER, GEMINI, catalogWithAvailability, groqChatModels
- `app/lib/quota-info.ts` → groqStatusLabel, formatHourMinute, quotaTooltip, formatNeuronsRemaining
- `app/lib/quota.ts` → writeQuota, GROQ_QUOTA_KEY, FALLBACK_NEURON_BUDGET, nextMidnightUtc, untilFromError, parseResetWindow, pruneQuotaMap, estimateNeurons, readQuota, getQuotaMap, modelQuotaUntil, markGroqQuota, firstAvailableGroqModel, latestGroqQuotaUntil, FallbackBudget, getFallbackBudget, fallbackBudgetLeft, chargeFallback, estimateEmbeddingNeurons, chargeEmbedding
- `app/lib/rate-limit.ts` → rateLimit, RateLimitBinding
- `app/lib/scrub.ts` → scrubText, ScrubResult, RULES, ScrubKind
- `app/lib/sources.ts` → toSourceRefs, sourceTitle
- `app/lib/sse.ts` → readSseLines, openAiDelta
- `app/lib/store.ts` → deleteConversation, getConversations, createConversation, updateConversation
- `app/lib/tokens.ts` → estimateToolDefinitionsTokens, CHARS_PER_TOKEN, DEFAULT_CONTEXT_BUDGET, GROQ_FREE_TPM, estimateTokens, estimateMessagesTokens, trimMessagesToBudget, OutputBudgetOptions, fitOutputTokens
- `app/lib/tools.ts` → sendEmailTool, TOOL_DEFINITIONS, groqFetch, revertChangeTool, getWeather, searchCodeTool, semanticSearchVault, recallMemory, MATH_CONSTANTS, MATH_FUNCTIONS, MathParser, calculate, getTime, webSearch, searchVault, readNote, saveNote, TOOL_INPUT_BUDGET, callGroqWithTools, listCloudNotes, readCloudNote, memorySnapshot, updateMemoryTool, updateCloudNoteTool, githubCreatePullRequest, githubListIssues, githubReadFile, executeToolCall, githubListFiles, githubRepoOverview, openApp, saveCloudNote, NOTE_READ_MAX, githubMergePullRequest, githubDeleteFile, githubGetCheckRuns, githubApplyPatch, GROQ_API, bodyModel
- `app/lib/truncate.ts` → normalizeOffset, TextWindow, sliceWindow, stubToolResult
- `app/lib/vault-docs.ts` → DocSource, PROJECT_DOCS, firstHeading, vaultRelPath, renderDoc
- `app/lib/vault-index.ts` → INDEX_FILE, isIndexFresh, buildIndex, semanticSearch, getVaultIndex, searchVaultIndex
- `app/lib/web-search.ts` → searchWeb, USER_AGENT, WebSearchOutcome, decodeEntities, cache, getCachedJson, getJson, STOPWORDS, entityCandidates, DISAMBIGUATION, wikiSearch, subjectOf, splitQualifier, searchWikipedia, StackExchange, stackOverflowThrottled, searchStackOverflow, HnAlgolia, searchHackerNews, MdnSearch, searchMdn, EolCatalog, EolDetail, VERSION_INTENT, OFFICIAL_VERSION_SOURCES, officialVersion, searchVersions, RELEASE_SOURCES, releaseNotes, RELEASE_NOISE, topSections, searchReleases, FIRECRAWL_ENDPOINT, NEWS_INTENT, looksSpanish, FirecrawlResponse, searchFirecrawl, CODE_SIGNALS, WEB_SIGNALS, recentSearches, RELEASE_INTENT, SOURCES, filterRelevant
- `app/lib/whatsapp-dedupe.ts` → TTL_MS
- `app/lib/whatsapp.ts` → parseIncoming, markdownToWhatsApp, markWhatsAppRead, sendWhatsAppText, chunkText, safeEqualHex, verifyTokenMatches, verifyMetaSignature, allowedNumbers, GRAPH_VERSION
- `app/lib/workers-ai.ts` → AiBinding, workersAiChatStream, ThinkFilter, LT, normalizeToOpenAiSse
- `app/lib/zip.ts` → createZip, safeFileName, encoder, crc32, getCrcTable

## app/types/
- `app/types/index.ts` → ContextInfo, QuotaInfo, Message, SourceRef, AVAILABLE_MODELS, MemoryRecord, AIModel

## local-agent/
- `local-agent/aria-local-agent.mjs` → send, loadEnvFile, __dirname, server, readBody, TOKEN_FILE, corsHeaders, isOriginAllowed, launch
- `local-agent/target-policy.mjs` → APP_ALIASES, isExecutablePath, isValidArgument, resolveTarget, validateOpenRequest, tokenMatches, loadAgentToken, ALLOWED_URI_SCHEMES, EXECUTABLE_EXTENSIONS, CONSOLE_COMMANDS

## scripts/
- `scripts/build-lora-dataset.ts` → main, leerDeBaseDeDatos, arg, opcionesDesdeArgs, conversacionesFalsas
- `scripts/docs-to-vault.ts` → Copiado, main, arg, indexar
- `scripts/generate-icons.mjs` → jobs, root
- `scripts/index-code.ts` → buildRepoMap, main, Env, walk
- `scripts/lora-dataset-lib.ts` → OpcionesDataset, crearInforme, opcionesPorDefecto, texto, formatearHerramientas, acumularRedacciones, limpiarMensajes, construirEjemplos, aJsonl, DEFAULT_SYSTEM, Informe
- `scripts/lora-seed.ts` → definiciones, Par, SYNTHETIC_EXAMPLES
- `scripts/measure-tokens.ts` → formatReport, invokedDirectly, buildTokenReport, TokenReport, SAMPLE_SUMMARY, SAMPLE_HISTORY, SAMPLE_MEMORY
- `scripts/patch-opennext-wasm.mjs` → root, copyWasm, matches, header
- `scripts/reindex.ts` → main
- `scripts/retrieval-eval.ts` → RankedHit, recallAtK, mrr, NOW, EvalDoc, CASES, rankCaseDocs, CaseMetrics, buildRetrievalEvalReport, formatRetrievalReport, invokedDirectly
- `scripts/smoke-brain.ts` → SOURCE
- `scripts/smoke-changelog.ts` → main
- `scripts/smoke-code-search.ts` → main
- `scripts/smoke-memory.ts` → main
- `scripts/test-migrate.mjs` → lastError, url, opts, sleep
- `scripts/wasm-resolver.mjs` → load, resolve

## tests/integration/
- `tests/integration/brain.test.ts` → marker, RUN
- `tests/integration/conversations-persist.test.ts` → auth, RUN
- `tests/integration/embedding-cache.test.ts` → vec, RUN
- `tests/integration/memory.test.ts` → marker, RUN
- `tests/integration/quota-api.test.ts` → RUN
- `tests/integration/working-memory.test.ts` → marker, RUN

## tests/unit/
- `tests/unit/aria-core.test.ts` → user
- `tests/unit/auth.test.ts` → saved, req
- `tests/unit/brain.test.ts` → hitAt, makeHit
- `tests/unit/build-scripts.test.ts` → here, deployWorkflow
- `tests/unit/chat-draft.test.ts` → fakeStorage
- `tests/unit/code-index.test.ts` → fn
- `tests/unit/context-info.test.ts` → base
- `tests/unit/data-change.test.ts` → changeRow, memoryMod, changeMod, call, memoryRow, noteRow
- `tests/unit/github-checks.test.ts` → stubChecks, json, Handlers
- `tests/unit/github-limits.test.ts` → stubGithub, b64
- `tests/unit/github-patch.test.ts` → json, b64
- `tests/unit/github-write.test.ts` → enableWrite, json, restoreEnv
- `tests/unit/local-agent-policy.test.ts` → existsOnly
- `tests/unit/lora-dataset.test.ts` → a, conv
- `tests/unit/quota-info.test.ts` → quota
- `tests/unit/select-tools.test.ts` → user, names
- `tests/unit/sources.test.ts` → vaultHit, messageHit, noteHit, memHit
- `tests/unit/sse.test.ts` → streamOf, collect
- `tests/unit/tools-rounds.test.ts` → finalText, ReqMessage, toolCallTurn
- `tests/unit/whatsapp-dedupe.test.ts` → create, SEVEN_DAYS_MS
- `tests/unit/whatsapp-webhook.test.ts` → validPost, getRequest, postRequest, sign, replyMock, prismaMock, payload
- `tests/unit/whatsapp.test.ts` → sign

## training/
- `training/upload-lora.mjs` → listar, cf, leerEnv, args, DESDE_UNSLOTH, BASES, id, existente, modelo, base, baseOriginal, mb, creado
