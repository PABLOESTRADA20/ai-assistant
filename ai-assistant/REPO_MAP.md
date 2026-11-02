# REPO_MAP — ai-assistant

> Generado por `npm run db:index-code`. **No editar a mano**: se vuelve a
> escribir solo si cambia algo. Es un índice de orientación del repo (rutas
> y símbolos) pensado para personas y para futuras herramientas: hoy NINGÚN
> código de la app lo lee — la app consulta `search_code`.

- Ficheros indexados: 204
- De ellos, con símbolos: 145
- Trozos: 1245
- Embeddings: `@cf/baai/bge-m3` (1024 dims)

## (raíz)
- `next.config.js` → nextConfig
- `tailwind.config.ts` → config
- `vitest.config.ts` → wasmModuleConvention

## app/
- `app/error.tsx` → clearAndReload, Error
- `app/global-error.tsx` → GlobalError
- `app/layout.tsx` → BOOT_WATCHDOG, metadata, viewport, RootLayout
- `app/manifest.ts` → manifest
- `app/page.tsx` → Home, formatRemaining, MemoryInspector

## app/api/auth/
- `app/api/auth/route.ts` → GET

## app/api/brain/search/
- `app/api/brain/search/route.ts` → POST

## app/api/chat/
- `app/api/chat/route.ts` → POST, groqErrorResponse, detail, NO_TOOLS_NOTICE, streamSimple, reserveInputChars, readable, drain, message

## app/api/conversations/
- `app/api/conversations/route.ts` → GET, POST, DEFAULT_MODEL

## app/api/conversations/[id]/
- `app/api/conversations/[id]/route.ts` → GET, PUT, DELETE

## app/api/github/browse/
- `app/api/github/browse/route.ts` → GET

## app/api/github/repos/
- `app/api/github/repos/route.ts` → GET, POST, DELETE

## app/api/memory/
- `app/api/memory/route.ts` → GET, POST

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
- `app/api/notes/[id]/route.ts` → PUT, DELETE, GET

## app/api/quota/
- `app/api/quota/route.ts` → GET

## app/api/transcribe/
- `app/api/transcribe/route.ts` → POST, GROQ_TRANSCRIBE, transcribeWithWorkersAI

## app/api/vault/index/
- `app/api/vault/index/route.ts` → GET

## app/api/whatsapp/webhook/
- `app/api/whatsapp/webhook/route.ts` → handleMessages, POST, WHATSAPP_TOOLS, getOrCreateWhatsAppConversation, GET, dynamic

## app/components/
- `app/components/AriaMark.tsx` → Props
- `app/components/ChatContainer.tsx` → Props, ChatContainer
- `app/components/ChatInput.tsx` → ChatInput, Props
- `app/components/CodeHighlighter.tsx` → Props, CodeHighlighter
- `app/components/GithubRepos.tsx` → GithubRepos, Repo
- `app/components/InstallButton.tsx` → detectPlatform, readCaptured, InstallButton, BeforeInstallPromptEvent
- `app/components/LoginScreen.tsx` → LoginScreen, Props
- `app/components/MemoryInspector.tsx` → MemoryInspector, StatChip, TYPE_LABELS
- `app/components/MessageBubble.tsx` → MessageBubble, CodeHighlighter, CopyButton, SpeakButton, CodeBlock
- `app/components/ModelSelector.tsx` → ModelSelector, Props
- `app/components/NeuralNetwork.tsx` → NeuralNetwork, Props
- `app/components/NotesPanel.tsx` → Note, isEditing, NotesPanel, noteToMarkdown
- `app/components/PanelLoading.tsx` → PanelLoading
- `app/components/QuotaBadge.tsx` → QuotaBadge
- `app/components/ServiceWorkerRegister.tsx` → ServiceWorkerRegister
- `app/components/SidePanel.tsx` → inputStyle, SidePanel
- `app/components/Sidebar.tsx` → Props, timeAgo, Sidebar
- `app/components/SourceChips.tsx` → SourceChips, KIND_META, formatScore, SourceChip
- `app/components/ToolCard.tsx` → formatArgs, formatResult, ToolCard, TOOL_ICONS
- `app/components/TypingIndicator.tsx` → TypingIndicator
- `app/components/WelcomeScreen.tsx` → Props, suggestions, WelcomeScreen

## app/components/scene/
- `app/components/scene/AriaScene.tsx` → AriaScene, AriaSceneProps, ASSEMBLE_SECONDS
- `app/components/scene/CountachViewer.tsx` → CountachViewer, AriaScene, CountachViewerProps

## app/components/scene/car/
- `app/components/scene/car/current-car.ts` → buildCar, CarMaterials
- `app/components/scene/car/lp5000.ts` → buildLp5000, Lp5000Materials, CarPart, WHEELS, addArc, buildShell, buildFlare, buildQuad, bakedGeometry, mergeChildrenByMaterial
- `app/components/scene/car/utils.ts` → MATERIAL_TEXTURE_KEYS, disposeObject3D, CarStats, collectStats

## app/hooks/
- `app/hooks/useEscapeToClose.ts` → useEscapeToClose
- `app/hooks/usePausableInterval.ts` → usePausableInterval
- `app/hooks/useQuota.ts` → useQuota
- `app/hooks/useTTS.ts` → useTTS, stripMarkdown, pickSpanishVoice
- `app/hooks/useVoiceInput.ts` → SpeechRecognitionLike, Options, useVoiceInput, VoiceState, pickAudioMime

## app/lib/
- `app/lib/api.ts` → readJson, jsonError, withAuth, RouteContext
- `app/lib/aria-core.ts` → LOOKS_LIKE_ORDER, SYSTEM_PROMPT, GROQ_API, RX_WRITE_VERB, MODEL_CONFIG, GroqModelConfig, WANTS_CURRENT, wantsWebSearch, TOOL_GROUPS, RX_MATH, RX_GITHUB_WRITE, RX_CODE_REVIEW, selectTools, generateSummary, MIN_COMPACT_MESSAGES, CompactionPlan, planCompaction, compactConversation, buildContextMessages, MEMORY_MAX_LINES, MemoryLine, trimMemoryLine, composeMemoryBlock, rememberTurn, AriaContext, buildAriaContext, RX_CODE_SEARCH, RX_NOTE_MENTION
- `app/lib/aria-reply.ts` → drainToText, generateTextReply, TextReplyOptions
- `app/lib/auth-client.ts` → apiFetch, setToken, getToken, TOKEN_KEY, verifyToken, fetchAuthRequired, fetchWithTimeout, authHeaders
- `app/lib/auth.ts` → getAccessToken, requireAuth, isAuthorized, extractToken, safeEqual
- `app/lib/background.ts` → registerBackground
- `app/lib/base64.ts` → encodeBase64, decodeBase64
- `app/lib/brain.ts` → MemoryRow, vaultCandidate, memoryHit, searchBrain, NOTE_TAG_PREFIX, removeMirroredNote, RANK_BOOST_MAX, mirrorNoteToMemory, orFuse, lexicalSim, normalizeLexical, labelHit, DEDUPE_JACCARD, contentTokens, jaccard, dedupeHits, BrainKind, BrainHit, BrainSearchOptions, rankBoost, Candidate, safeQuery
- `app/lib/changelog.ts` → countRecentChanges, ChangeRecord, ChangeEntity, latestChange, getChange, markReverted, recordChange, jsonParam, toRecord
- `app/lib/chat-client.ts` → streamChat, isRetryable, StreamChatResult, StreamChatOptions, UnauthorizedError, MODEL_FALLBACK_ORDER
- `app/lib/chat-draft.ts` → defaultStorage, draftKey, DRAFT_PREFIX, saveDraft, loadDraft
- `app/lib/code-index.ts` → CodeChunkKind, CODE_INDEX_EXTENSIONS, CODE_SKIP_DIRS, CodeChunkInput, CodeSearchOptions, LANG_BY_EXT, langFromPath, isIndexedFile, hashContent, braceDelta
- `app/lib/context-info.ts` → formatContextUsage, contextUsagePercent
- `app/lib/download.ts` → downloadBlob
- `app/lib/email.ts` → sendEmail, emailAllowedRecipients, RESEND_API
- `app/lib/embeddings.ts` → semanticSearchDb, upsertNote, MAX_EMBED_CHARS, reindexVaultEmbeddings, ReindexOptions, matchSnippet, needsReindex, ReindexResult
- `app/lib/error-message.ts` → ERROR_MESSAGE_PREFIX
- `app/lib/format.ts` → fmtDate, formatCompactNumber
- `app/lib/git-common.ts` → PATCH_MAX_REMOVED_LINES, PATCH_SEARCH_MAX_CHARS
- `app/lib/git-hosts.ts` → GitPlatform, platformStatuses, PlatformStatus, platformToken, repoKey, parseRepoRef, platformFromHost, RepoRef, GIT_HOSTS, GitHost
- `app/lib/git.ts` → gitDeleteFiles, gitGetCheckRuns, gitListFiles, gitRepoOverview, resolve, gitVerifyRepo, gitCreatePullRequest, gitListIssues, notImplemented, invalid, gitMergePullRequest, GitChange, gitReadFile, gitApplyPatch
- `app/lib/github.ts` → applyPatch, GithubDeleteInput, deleteFiles, readFileByLines, fixAttemptsKey, addRepo, saveRepos, getRepos, githubAutoMergeEnabled, parseRepo, MAX_FIX_ATTEMPTS, GITHUB_LIMITS, GithubMergeInput, listMyRepos, verifyRepo, GITHUB_API, mergePullRequest, GithubCheckRunsInput, GhCheckRun, clip, getCheckRuns, getFixAttempts, mapRepoSummaries, recordFixAttempt, ghFetch, normalizeGithubUser, GithubRepoSummary, listIssues, readFile, listFiles, repoOverview, describeError, createPullRequest, removeRepo, GithubPatchOp, GithubApplyPatchInput
- `app/lib/gitlab.ts` → getCheckRuns, applyPatch, deleteFiles, listIssues, fileBlobId, resolveTargetBranch, commit, createPullRequest, LIMITS, gitlabWriteEnabled, glFetch, glMessage, describeError, defaultBranch, verifyRepo, repoOverview, listFiles, readFile, pipelineState, mergePullRequest, readByLines
- `app/lib/llm-embed.ts` → MODEL, localEmbed, viaBinding, embeddingCacheSet, embeddingCacheGet, hashEmbedText, viaRest, embed
- `app/lib/local-agent.ts` → openAppLocally, checkLocalAgent, headers, saveLocalToken, agentToken, LocalAgentResult
- `app/lib/memory-extract.ts` → extractMemories, heuristicExtract, GROQ_API, SYSTEM_PROMPT, sanitizeJson, sanitizeExtracted
- `app/lib/memory.ts` → updateWorkingMemory, toStored, recordEpisode, getMemoryStats, consolidateMemories, ConsolidateOptions, reinforceMemories, searchMemories, MemoryFilters, searchSemanticMemories, updateMemory, MemoryUpdate, createMemory, findMemoryById, getMemoryById, getContext, setContext, maybeConsolidate, StoredMemory, MEMORY_TYPES
- `app/lib/notes.ts` → getNote, listNotes, NoteRecord, findNote, saveNote, updateNote, deleteNote, tagsJson, toRecord, parseTags
- `app/lib/num.ts` → round3, round01, clamp01
- `app/lib/persist-messages.ts` → persistMessages, hydrateMessages, MessageInput
- `app/lib/prisma.ts` → RequestContext, currentRequestContext, globalForPrisma, getPrisma, prisma, AdapterFactory, createClient
- `app/lib/providers.ts` → OPENROUTER, Provider, GEMINI, isModelAvailable, RESERVE_MODEL, MODEL_CATALOG, ProviderId, WORKERS_AI, groqChatModels, catalogWithAvailability
- `app/lib/quota-info.ts` → groqStatusLabel, formatNeuronsRemaining, formatHourMinute, quotaTooltip
- `app/lib/quota.ts` → writeQuota, GROQ_QUOTA_KEY, FALLBACK_NEURON_BUDGET, nextMidnightUtc, untilFromError, parseResetWindow, pruneQuotaMap, estimateNeurons, readQuota, getQuotaMap, modelQuotaUntil, markGroqQuota, firstAvailableGroqModel, chargeFallback, estimateEmbeddingNeurons, chargeEmbedding, latestGroqQuotaUntil, FallbackBudget, getFallbackBudget, fallbackBudgetLeft
- `app/lib/rate-limit.ts` → RateLimitBinding, rateLimit
- `app/lib/scrub.ts` → RULES, scrubText, ScrubKind, ScrubResult
- `app/lib/sources.ts` → toSourceRefs, sourceTitle
- `app/lib/sse.ts` → openAiDelta, readSseLines
- `app/lib/store.ts` → deleteConversation, createConversation, updateConversation, getConversations
- `app/lib/tokens.ts` → CHARS_PER_TOKEN, estimateMessagesTokens, estimateTokens, DEFAULT_CONTEXT_BUDGET
- `app/lib/tools.ts` → callGroqWithTools, updateMemoryTool, githubCreatePullRequest, githubListIssues, githubReadFile, githubListFiles, githubRepoOverview, sendEmailTool, openApp, executeToolCall, TOOL_DEFINITIONS, readCloudNote, groqFetch, bodyModel, GROQ_API, listCloudNotes, saveCloudNote, NOTE_READ_MAX, githubMergePullRequest, githubDeleteFile, githubGetCheckRuns, githubApplyPatch, semanticSearchVault, MATH_FUNCTIONS, updateCloudNoteTool, readNote, revertChangeTool, getWeather, MATH_CONSTANTS, searchCodeTool, MathParser, calculate, getTime, recallMemory, webSearch, searchVault, saveNote, memorySnapshot
- `app/lib/truncate.ts` → sliceWindow, stubToolResult, normalizeOffset, TextWindow
- `app/lib/vault-docs.ts` → PROJECT_DOCS, DocSource, firstHeading, vaultRelPath, renderDoc
- `app/lib/vault-index.ts` → getVaultIndex, isIndexFresh, buildIndex, searchVaultIndex, INDEX_FILE, semanticSearch
- `app/lib/web-search.ts` → searchHackerNews, RELEASE_NOISE, decodeEntities, searchReleases, topSections, RELEASE_SOURCES, searchVersions, OFFICIAL_VERSION_SOURCES, VERSION_INTENT, EolDetail, EolCatalog, searchMdn, MdnSearch, recentSearches, WEB_SIGNALS, CODE_SIGNALS, searchFirecrawl, FirecrawlResponse, looksSpanish, NEWS_INTENT, FIRECRAWL_ENDPOINT, STOPWORDS, entityCandidates, WebSearchOutcome, USER_AGENT, DISAMBIGUATION, wikiSearch, subjectOf, cache, releaseNotes, splitQualifier, searchWikipedia, officialVersion, HnAlgolia, StackExchange, stackOverflowThrottled, searchStackOverflow, getJson, getCachedJson, searchWeb, filterRelevant, SOURCES, RELEASE_INTENT
- `app/lib/whatsapp.ts` → sendWhatsAppText, safeEqualHex, parseIncoming, allowedNumbers, GRAPH_VERSION, verifyMetaSignature, markWhatsAppRead, markdownToWhatsApp, chunkText
- `app/lib/workers-ai.ts` → normalizeToOpenAiSse, LT, workersAiChatStream, AiBinding, ThinkFilter
- `app/lib/zip.ts` → encoder, createZip, crc32, getCrcTable, safeFileName

## app/types/
- `app/types/index.ts` → AVAILABLE_MODELS, Message, AIModel, MemoryRecord, SourceRef, ContextInfo, QuotaInfo

## local-agent/
- `local-agent/aria-local-agent.mjs` → server, resolveTarget, APP_ALIASES, TOKEN, TOKEN_FILE, readBody, send, corsHeaders, isOriginAllowed, launch, __dirname, loadEnvFile

## scripts/
- `scripts/build-lora-dataset.ts` → SISTEMA, arg, conversacionesFalsas, aEjemplo, leerDeBaseDeDatos, main
- `scripts/docs-to-vault.ts` → main, Copiado, arg, indexar
- `scripts/generate-icons.mjs` → jobs, root
- `scripts/index-code.ts` → main, walk, Env, buildRepoMap
- `scripts/measure-tokens.ts` → SAMPLE_MEMORY, SAMPLE_HISTORY, buildTokenReport, formatReport, invokedDirectly, TokenReport, SAMPLE_SUMMARY
- `scripts/patch-opennext-wasm.mjs` → copyWasm, header, matches, root
- `scripts/reindex.ts` → main
- `scripts/retrieval-eval.ts` → EvalDoc, RankedHit, NOW, mrr, CASES, rankCaseDocs, CaseMetrics, buildRetrievalEvalReport, formatRetrievalReport, invokedDirectly, recallAtK
- `scripts/smoke-brain.ts` → SOURCE
- `scripts/smoke-changelog.ts` → main
- `scripts/smoke-code-search.ts` → main
- `scripts/smoke-memory.ts` → main
- `scripts/test-migrate.mjs` → sleep, lastError, url, opts
- `scripts/wasm-resolver.mjs` → load, resolve

## tests/integration/
- `tests/integration/brain.test.ts` → marker, RUN
- `tests/integration/conversations-persist.test.ts` → RUN, auth
- `tests/integration/embedding-cache.test.ts` → RUN, vec
- `tests/integration/memory.test.ts` → marker, RUN
- `tests/integration/quota-api.test.ts` → RUN
- `tests/integration/working-memory.test.ts` → marker, RUN

## tests/unit/
- `tests/unit/aria-core.test.ts` → user
- `tests/unit/auth.test.ts` → req, saved
- `tests/unit/brain.test.ts` → hitAt, makeHit
- `tests/unit/chat-draft.test.ts` → fakeStorage
- `tests/unit/code-index.test.ts` → fn
- `tests/unit/context-info.test.ts` → base
- `tests/unit/data-change.test.ts` → memoryRow, changeRow, call, noteRow, memoryMod, changeMod
- `tests/unit/github-checks.test.ts` → stubChecks, Handlers, json
- `tests/unit/github-limits.test.ts` → stubGithub, b64
- `tests/unit/github-patch.test.ts` → json, b64
- `tests/unit/github-write.test.ts` → enableWrite, restoreEnv, json
- `tests/unit/quota-info.test.ts` → quota
- `tests/unit/select-tools.test.ts` → user, names
- `tests/unit/sources.test.ts` → vaultHit, memHit, noteHit, messageHit
- `tests/unit/sse.test.ts` → streamOf, collect
- `tests/unit/tools-rounds.test.ts` → toolCallTurn, finalText, ReqMessage
- `tests/unit/whatsapp.test.ts` → sign

## training/
- `training/upload-lora.mjs` → creado, cf, listar, mb, BASES, DESDE_UNSLOTH, leerEnv, baseOriginal, base, modelo, id, existente, args
