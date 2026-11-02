# REPO_MAP — ai-assistant

> Generado por `npm run db:index-code`. **No editar a mano**: se vuelve a
> escribir solo si cambia algo. Es un índice de orientación del repo (rutas
> y símbolos) pensado para personas y para futuras herramientas: hoy NINGÚN
> código de la app lo lee — la app consulta `search_code`.

- Ficheros indexados: 204
- De ellos, con símbolos: 145
- Trozos: 1246
- Embeddings: `@cf/baai/bge-m3` (1024 dims)

## (raíz)
- `next.config.js` → nextConfig
- `tailwind.config.ts` → config
- `vitest.config.ts` → wasmModuleConvention

## app/
- `app/error.tsx` → clearAndReload, Error
- `app/global-error.tsx` → GlobalError
- `app/layout.tsx` → RootLayout, viewport, metadata, BOOT_WATCHDOG
- `app/manifest.ts` → manifest
- `app/page.tsx` → Home, MemoryInspector, formatRemaining

## app/api/auth/
- `app/api/auth/route.ts` → GET

## app/api/brain/search/
- `app/api/brain/search/route.ts` → POST

## app/api/chat/
- `app/api/chat/route.ts` → POST, detail, NO_TOOLS_NOTICE, streamSimple, reserveInputChars, readable, drain, message, groqErrorResponse

## app/api/conversations/
- `app/api/conversations/route.ts` → POST, GET, DEFAULT_MODEL

## app/api/conversations/[id]/
- `app/api/conversations/[id]/route.ts` → DELETE, GET, PUT

## app/api/github/browse/
- `app/api/github/browse/route.ts` → GET

## app/api/github/repos/
- `app/api/github/repos/route.ts` → POST, DELETE, GET

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
- `app/api/notes/route.ts` → POST, GET

## app/api/notes/[id]/
- `app/api/notes/[id]/route.ts` → GET, DELETE, PUT

## app/api/quota/
- `app/api/quota/route.ts` → GET

## app/api/transcribe/
- `app/api/transcribe/route.ts` → transcribeWithWorkersAI, GROQ_TRANSCRIBE, POST

## app/api/vault/index/
- `app/api/vault/index/route.ts` → GET

## app/api/whatsapp/webhook/
- `app/api/whatsapp/webhook/route.ts` → dynamic, getOrCreateWhatsAppConversation, WHATSAPP_TOOLS, handleMessages, POST, GET

## app/components/
- `app/components/AriaMark.tsx` → Props
- `app/components/ChatContainer.tsx` → Props, ChatContainer
- `app/components/ChatInput.tsx` → ChatInput, Props
- `app/components/CodeHighlighter.tsx` → CodeHighlighter, Props
- `app/components/GithubRepos.tsx` → GithubRepos, Repo
- `app/components/InstallButton.tsx` → detectPlatform, InstallButton, readCaptured, BeforeInstallPromptEvent
- `app/components/LoginScreen.tsx` → LoginScreen, Props
- `app/components/MemoryInspector.tsx` → MemoryInspector, StatChip, TYPE_LABELS
- `app/components/MessageBubble.tsx` → CodeHighlighter, CopyButton, SpeakButton, MessageBubble, CodeBlock
- `app/components/ModelSelector.tsx` → ModelSelector, Props
- `app/components/NeuralNetwork.tsx` → NeuralNetwork, Props
- `app/components/NotesPanel.tsx` → Note, NotesPanel, isEditing, noteToMarkdown
- `app/components/PanelLoading.tsx` → PanelLoading
- `app/components/QuotaBadge.tsx` → QuotaBadge
- `app/components/ServiceWorkerRegister.tsx` → ServiceWorkerRegister
- `app/components/SidePanel.tsx` → SidePanel, inputStyle
- `app/components/Sidebar.tsx` → Sidebar, timeAgo, Props
- `app/components/SourceChips.tsx` → KIND_META, formatScore, SourceChip, SourceChips
- `app/components/ToolCard.tsx` → formatResult, formatArgs, TOOL_ICONS, ToolCard
- `app/components/TypingIndicator.tsx` → TypingIndicator
- `app/components/WelcomeScreen.tsx` → suggestions, WelcomeScreen, Props

## app/components/scene/
- `app/components/scene/AriaScene.tsx` → AriaScene, ASSEMBLE_SECONDS, AriaSceneProps
- `app/components/scene/CountachViewer.tsx` → CountachViewer, CountachViewerProps, AriaScene

## app/components/scene/car/
- `app/components/scene/car/current-car.ts` → buildCar, CarMaterials
- `app/components/scene/car/lp5000.ts` → buildLp5000, CarPart, WHEELS, addArc, buildShell, buildFlare, buildQuad, bakedGeometry, mergeChildrenByMaterial, Lp5000Materials
- `app/components/scene/car/utils.ts` → CarStats, collectStats, MATERIAL_TEXTURE_KEYS, disposeObject3D

## app/hooks/
- `app/hooks/useEscapeToClose.ts` → useEscapeToClose
- `app/hooks/usePausableInterval.ts` → usePausableInterval
- `app/hooks/useQuota.ts` → useQuota
- `app/hooks/useTTS.ts` → pickSpanishVoice, useTTS, stripMarkdown
- `app/hooks/useVoiceInput.ts` → useVoiceInput, SpeechRecognitionLike, Options, pickAudioMime, VoiceState

## app/lib/
- `app/lib/api.ts` → RouteContext, withAuth, jsonError, readJson
- `app/lib/aria-core.ts` → TOOL_GROUPS, trimMemoryLine, MemoryLine, MEMORY_MAX_LINES, buildContextMessages, compactConversation, RX_CODE_SEARCH, planCompaction, RX_MATH, CompactionPlan, SYSTEM_PROMPT, MIN_COMPACT_MESSAGES, generateSummary, selectTools, GROQ_API, RX_WRITE_VERB, MODEL_CONFIG, LOOKS_LIKE_ORDER, WANTS_CURRENT, wantsWebSearch, RX_GITHUB_WRITE, RX_CODE_REVIEW, RX_NOTE_MENTION, GroqModelConfig, buildAriaContext, AriaContext, rememberTurn, composeMemoryBlock
- `app/lib/aria-reply.ts` → generateTextReply, drainToText, TextReplyOptions
- `app/lib/auth-client.ts` → fetchWithTimeout, fetchAuthRequired, verifyToken, TOKEN_KEY, getToken, setToken, authHeaders, apiFetch
- `app/lib/auth.ts` → getAccessToken, safeEqual, extractToken, isAuthorized, requireAuth
- `app/lib/background.ts` → registerBackground
- `app/lib/base64.ts` → decodeBase64, encodeBase64
- `app/lib/brain.ts` → lexicalSim, RANK_BOOST_MAX, orFuse, normalizeLexical, labelHit, DEDUPE_JACCARD, contentTokens, jaccard, dedupeHits, BrainKind, BrainHit, BrainSearchOptions, rankBoost, Candidate, MemoryRow, safeQuery, vaultCandidate, memoryHit, searchBrain, NOTE_TAG_PREFIX, removeMirroredNote, mirrorNoteToMemory
- `app/lib/changelog.ts` → ChangeEntity, getChange, recordChange, countRecentChanges, jsonParam, toRecord, markReverted, ChangeRecord, latestChange
- `app/lib/chat-client.ts` → streamChat, MODEL_FALLBACK_ORDER, UnauthorizedError, StreamChatOptions, StreamChatResult, isRetryable
- `app/lib/chat-draft.ts` → defaultStorage, DRAFT_PREFIX, draftKey, loadDraft, saveDraft
- `app/lib/code-index.ts` → braceDelta, CodeSearchOptions, LANG_BY_EXT, CodeChunkInput, CodeChunkKind, CODE_SKIP_DIRS, hashContent, isIndexedFile, CODE_INDEX_EXTENSIONS, langFromPath
- `app/lib/context-info.ts` → contextUsagePercent, formatContextUsage
- `app/lib/download.ts` → downloadBlob
- `app/lib/email.ts` → RESEND_API, emailAllowedRecipients, sendEmail
- `app/lib/embeddings.ts` → reindexVaultEmbeddings, MAX_EMBED_CHARS, upsertNote, ReindexResult, ReindexOptions, needsReindex, matchSnippet, semanticSearchDb
- `app/lib/error-message.ts` → ERROR_MESSAGE_PREFIX
- `app/lib/format.ts` → formatCompactNumber, fmtDate
- `app/lib/git-common.ts` → PATCH_SEARCH_MAX_CHARS, PATCH_MAX_REMOVED_LINES
- `app/lib/git-hosts.ts` → parseRepoRef, repoKey, platformStatuses, GitPlatform, GitHost, GIT_HOSTS, RepoRef, PlatformStatus, platformToken, platformFromHost
- `app/lib/git.ts` → gitGetCheckRuns, gitDeleteFiles, gitApplyPatch, gitCreatePullRequest, gitReadFile, GitChange, resolve, gitVerifyRepo, gitListFiles, gitRepoOverview, notImplemented, invalid, gitListIssues, gitMergePullRequest
- `app/lib/github.ts` → removeRepo, listMyRepos, mapRepoSummaries, normalizeGithubUser, GithubRepoSummary, listIssues, readFile, listFiles, repoOverview, getCheckRuns, clip, GhCheckRun, GithubCheckRunsInput, mergePullRequest, GithubMergeInput, deleteFiles, readFileByLines, GithubDeleteInput, applyPatch, GithubApplyPatchInput, GithubPatchOp, createPullRequest, describeError, ghFetch, recordFixAttempt, getFixAttempts, fixAttemptsKey, addRepo, saveRepos, getRepos, parseRepo, githubAutoMergeEnabled, MAX_FIX_ATTEMPTS, GITHUB_LIMITS, verifyRepo, GITHUB_API
- `app/lib/gitlab.ts` → describeError, mergePullRequest, fileBlobId, listIssues, readByLines, readFile, listFiles, repoOverview, verifyRepo, defaultBranch, resolveTargetBranch, glMessage, commit, createPullRequest, glFetch, gitlabWriteEnabled, LIMITS, applyPatch, deleteFiles, pipelineState, getCheckRuns
- `app/lib/llm-embed.ts` → embeddingCacheSet, viaBinding, localEmbed, embed, MODEL, hashEmbedText, embeddingCacheGet, viaRest
- `app/lib/local-agent.ts` → headers, checkLocalAgent, openAppLocally, LocalAgentResult, agentToken, saveLocalToken
- `app/lib/memory-extract.ts` → sanitizeJson, heuristicExtract, extractMemories, sanitizeExtracted, GROQ_API, SYSTEM_PROMPT
- `app/lib/memory.ts` → reinforceMemories, MEMORY_TYPES, StoredMemory, toStored, getMemoryById, findMemoryById, createMemory, MemoryUpdate, updateMemory, searchSemanticMemories, MemoryFilters, searchMemories, ConsolidateOptions, consolidateMemories, getMemoryStats, recordEpisode, updateWorkingMemory, getContext, setContext, maybeConsolidate
- `app/lib/notes.ts` → listNotes, NoteRecord, findNote, saveNote, updateNote, deleteNote, parseTags, toRecord, getNote, tagsJson
- `app/lib/num.ts` → round01, clamp01, round3
- `app/lib/persist-messages.ts` → hydrateMessages, MessageInput, persistMessages
- `app/lib/prisma.ts` → createClient, RequestContext, currentRequestContext, globalForPrisma, getPrisma, prisma, AdapterFactory
- `app/lib/providers.ts` → ProviderId, Provider, WORKERS_AI, GEMINI, OPENROUTER, MODEL_CATALOG, RESERVE_MODEL, groqChatModels, catalogWithAvailability, isModelAvailable
- `app/lib/quota-info.ts` → groqStatusLabel, formatHourMinute, quotaTooltip, formatNeuronsRemaining
- `app/lib/quota.ts` → untilFromError, latestGroqQuotaUntil, FallbackBudget, getFallbackBudget, fallbackBudgetLeft, GROQ_QUOTA_KEY, FALLBACK_NEURON_BUDGET, nextMidnightUtc, parseResetWindow, pruneQuotaMap, estimateNeurons, readQuota, writeQuota, getQuotaMap, modelQuotaUntil, markGroqQuota, firstAvailableGroqModel, chargeFallback, estimateEmbeddingNeurons, chargeEmbedding
- `app/lib/rate-limit.ts` → RateLimitBinding, rateLimit
- `app/lib/scrub.ts` → RULES, ScrubKind, ScrubResult, scrubText
- `app/lib/sources.ts` → toSourceRefs, sourceTitle
- `app/lib/sse.ts` → readSseLines, openAiDelta
- `app/lib/store.ts` → getConversations, createConversation, updateConversation, deleteConversation
- `app/lib/tokens.ts` → estimateTokens, DEFAULT_CONTEXT_BUDGET, CHARS_PER_TOKEN, estimateMessagesTokens
- `app/lib/tools.ts` → revertChangeTool, readNote, updateCloudNoteTool, updateMemoryTool, githubCreatePullRequest, githubListIssues, githubReadFile, githubListFiles, githubRepoOverview, sendEmailTool, openApp, executeToolCall, TOOL_DEFINITIONS, memorySnapshot, readCloudNote, semanticSearchVault, githubApplyPatch, groqFetch, recallMemory, githubGetCheckRuns, githubMergePullRequest, NOTE_READ_MAX, saveCloudNote, listCloudNotes, GROQ_API, bodyModel, githubDeleteFile, MATH_CONSTANTS, MATH_FUNCTIONS, callGroqWithTools, saveNote, searchVault, webSearch, getTime, calculate, MathParser, searchCodeTool, getWeather
- `app/lib/truncate.ts` → TextWindow, stubToolResult, sliceWindow, normalizeOffset
- `app/lib/vault-docs.ts` → firstHeading, PROJECT_DOCS, DocSource, renderDoc, vaultRelPath
- `app/lib/vault-index.ts` → semanticSearch, searchVaultIndex, getVaultIndex, buildIndex, isIndexFresh, INDEX_FILE
- `app/lib/web-search.ts` → searchVersions, OFFICIAL_VERSION_SOURCES, VERSION_INTENT, EolDetail, EolCatalog, searchMdn, MdnSearch, searchHackerNews, RELEASE_NOISE, releaseNotes, HnAlgolia, searchStackOverflow, stackOverflowThrottled, StackExchange, searchWikipedia, officialVersion, splitQualifier, subjectOf, wikiSearch, DISAMBIGUATION, entityCandidates, STOPWORDS, decodeEntities, WebSearchOutcome, USER_AGENT, cache, getJson, WEB_SIGNALS, getCachedJson, recentSearches, RELEASE_INTENT, SOURCES, filterRelevant, searchWeb, CODE_SIGNALS, searchFirecrawl, FirecrawlResponse, looksSpanish, NEWS_INTENT, FIRECRAWL_ENDPOINT, searchReleases, topSections, RELEASE_SOURCES
- `app/lib/whatsapp.ts` → chunkText, markWhatsAppRead, markdownToWhatsApp, safeEqualHex, parseIncoming, allowedNumbers, GRAPH_VERSION, sendWhatsAppText, verifyMetaSignature
- `app/lib/workers-ai.ts` → AiBinding, workersAiChatStream, normalizeToOpenAiSse, LT, ThinkFilter
- `app/lib/zip.ts` → createZip, encoder, getCrcTable, crc32, safeFileName

## app/types/
- `app/types/index.ts` → SourceRef, ContextInfo, QuotaInfo, Message, MemoryRecord, AVAILABLE_MODELS, AIModel

## local-agent/
- `local-agent/aria-local-agent.mjs` → server, corsHeaders, send, readBody, __dirname, loadEnvFile, TOKEN_FILE, TOKEN, APP_ALIASES, resolveTarget, launch, isOriginAllowed

## scripts/
- `scripts/build-lora-dataset.ts` → aEjemplo, arg, SISTEMA, main, conversacionesFalsas, leerDeBaseDeDatos
- `scripts/docs-to-vault.ts` → Copiado, main, indexar, arg
- `scripts/generate-icons.mjs` → root, jobs
- `scripts/index-code.ts` → buildRepoMap, main, Env, walk
- `scripts/measure-tokens.ts` → invokedDirectly, formatReport, buildTokenReport, SAMPLE_MEMORY, SAMPLE_HISTORY, SAMPLE_SUMMARY, TokenReport
- `scripts/patch-opennext-wasm.mjs` → root, matches, header, copyWasm
- `scripts/reindex.ts` → main
- `scripts/retrieval-eval.ts` → EvalDoc, RankedHit, mrr, NOW, CASES, rankCaseDocs, CaseMetrics, buildRetrievalEvalReport, formatRetrievalReport, invokedDirectly, recallAtK
- `scripts/smoke-brain.ts` → SOURCE
- `scripts/smoke-changelog.ts` → main
- `scripts/smoke-code-search.ts` → main
- `scripts/smoke-memory.ts` → main
- `scripts/test-migrate.mjs` → url, lastError, sleep, opts
- `scripts/wasm-resolver.mjs` → load, resolve

## tests/integration/
- `tests/integration/brain.test.ts` → marker, RUN
- `tests/integration/conversations-persist.test.ts` → auth, RUN
- `tests/integration/embedding-cache.test.ts` → vec, RUN
- `tests/integration/memory.test.ts` → marker, RUN
- `tests/integration/quota-api.test.ts` → RUN
- `tests/integration/working-memory.test.ts` → RUN, marker

## tests/unit/
- `tests/unit/aria-core.test.ts` → user
- `tests/unit/auth.test.ts` → saved, req
- `tests/unit/brain.test.ts` → hitAt, makeHit
- `tests/unit/chat-draft.test.ts` → fakeStorage
- `tests/unit/code-index.test.ts` → fn
- `tests/unit/context-info.test.ts` → base
- `tests/unit/data-change.test.ts` → memoryRow, changeRow, call, changeMod, memoryMod, noteRow
- `tests/unit/github-checks.test.ts` → Handlers, json, stubChecks
- `tests/unit/github-limits.test.ts` → stubGithub, b64
- `tests/unit/github-patch.test.ts` → json, b64
- `tests/unit/github-write.test.ts` → enableWrite, json, restoreEnv
- `tests/unit/quota-info.test.ts` → quota
- `tests/unit/select-tools.test.ts` → names, user
- `tests/unit/sources.test.ts` → noteHit, messageHit, vaultHit, memHit
- `tests/unit/sse.test.ts` → streamOf, collect
- `tests/unit/tools-rounds.test.ts` → finalText, toolCallTurn, ReqMessage
- `tests/unit/whatsapp.test.ts` → sign

## training/
- `training/upload-lora.mjs` → base, DESDE_UNSLOTH, BASES, args, id, leerEnv, cf, creado, existente, listar, mb, baseOriginal, modelo
